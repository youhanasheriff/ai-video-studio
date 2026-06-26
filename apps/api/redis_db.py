"""Redis database and cache layer for AI Video Studio."""
import json
import os
from typing import Optional, List, Dict, Any
from datetime import datetime
from redis import Redis
from redis.connection import ConnectionPool
import uuid


class RedisDB:
    """Redis-based database and cache manager."""
    backend = "redis"
    
    # Key prefixes
    PROJECT_PREFIX = "project:"
    GENERATION_PREFIX = "generation:"
    PROJECT_INDEX = "projects:index"  # Sorted set for project IDs by created_at
    CACHE_PREFIX = "cache:"
    
    def __init__(self, redis_url: Optional[str] = None):
        """Initialize Redis connection."""
        redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379/0")
        
        # Create connection pool
        pool = ConnectionPool.from_url(redis_url, decode_responses=True, max_connections=50)
        self.redis: Redis = Redis(connection_pool=pool)
        
        # Use separate database for cache (db 1) and data (db 0)
        cache_url = redis_url.rsplit("/", 1)[0] + "/1"
        cache_pool = ConnectionPool.from_url(cache_url, decode_responses=True, max_connections=50)
        self.cache: Redis = Redis(connection_pool=cache_pool)
    
    def ping(self) -> bool:
        """Check Redis connection."""
        try:
            return self.redis.ping()
        except Exception:
            return False
    
    # ==================== Project Operations ====================
    
    def create_project(self, project_data: Dict[str, Any]) -> str:
        """Create a new project and return its ID."""
        project_id = str(uuid.uuid4())
        key = f"{self.PROJECT_PREFIX}{project_id}"
        
        # Add timestamps
        project_data["id"] = project_id
        project_data["created_at"] = datetime.utcnow().isoformat()
        project_data["updated_at"] = datetime.utcnow().isoformat()
        project_data.setdefault("status", "draft")
        
        # Store as JSON
        self.redis.set(key, json.dumps(project_data))
        
        # Add to index (sorted set by timestamp)
        timestamp = datetime.utcnow().timestamp()
        self.redis.zadd(self.PROJECT_INDEX, {project_id: timestamp})
        
        return project_id
    
    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Get a project by ID with caching."""
        # Check cache first
        cache_key = f"{self.CACHE_PREFIX}project:{project_id}"
        cached = self.cache.get(cache_key)
        if cached:
            return json.loads(cached)
        
        # Get from Redis
        key = f"{self.PROJECT_PREFIX}{project_id}"
        data = self.redis.get(key)
        
        if data:
            project = json.loads(data)
            # Cache for 5 minutes
            self.cache.setex(cache_key, 300, data)
            return project
        
        return None
    
    def update_project(self, project_id: str, updates: Dict[str, Any]) -> bool:
        """Update a project."""
        project = self.get_project(project_id)
        if not project:
            return False
        
        # Merge updates
        project.update(updates)
        project["updated_at"] = datetime.utcnow().isoformat()
        
        # Save
        key = f"{self.PROJECT_PREFIX}{project_id}"
        self.redis.set(key, json.dumps(project))
        
        # Invalidate cache
        cache_key = f"{self.CACHE_PREFIX}project:{project_id}"
        self.cache.delete(cache_key)
        
        return True
    
    def delete_project(self, project_id: str) -> bool:
        """Delete a project and its generations."""
        key = f"{self.PROJECT_PREFIX}{project_id}"
        deleted = bool(self.redis.delete(key))
        
        if deleted:
            # Remove from index
            self.redis.zrem(self.PROJECT_INDEX, project_id)
            
            # Invalidate cache
            cache_key = f"{self.CACHE_PREFIX}project:{project_id}"
            self.cache.delete(cache_key)
            
            # Delete related generations
            self._delete_project_generations(project_id)
        
        return deleted
    
    def list_projects(self, skip: int = 0, limit: int = 100) -> List[Dict[str, Any]]:
        """List projects with pagination (newest first)."""
        # Get project IDs from sorted set (reverse order = newest first)
        project_ids = self.redis.zrevrange(self.PROJECT_INDEX, skip, skip + limit - 1)
        
        projects = []
        for project_id in project_ids:
            project = self.get_project(project_id)
            if project:
                projects.append(project)
        
        return projects
    
    def count_projects(self) -> int:
        """Get total number of projects."""
        return self.redis.zcard(self.PROJECT_INDEX)
    
    # ==================== Generation Operations ====================
    
    def create_generation(self, generation_data: Dict[str, Any]) -> str:
        """Create a new video generation record."""
        task_id = generation_data.get("task_id") or str(uuid.uuid4())
        key = f"{self.GENERATION_PREFIX}{task_id}"
        
        generation_data["task_id"] = task_id
        generation_data["created_at"] = datetime.utcnow().isoformat()
        generation_data.setdefault("status", "PENDING")
        generation_data.setdefault("progress", 0)
        
        # Store as JSON
        self.redis.set(key, json.dumps(generation_data))
        
        # If linked to project, add to project's generation list
        if project_id := generation_data.get("project_id"):
            project_gens_key = f"{self.PROJECT_PREFIX}{project_id}:generations"
            self.redis.sadd(project_gens_key, task_id)
        
        return task_id
    
    def get_generation(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get a generation by task_id with caching."""
        # Check cache first
        cache_key = f"{self.CACHE_PREFIX}generation:{task_id}"
        cached = self.cache.get(cache_key)
        if cached:
            return json.loads(cached)
        
        key = f"{self.GENERATION_PREFIX}{task_id}"
        data = self.redis.get(key)
        
        if data:
            generation = json.loads(data)
            # Cache for 2 minutes (generations change more frequently)
            self.cache.setex(cache_key, 120, data)
            return generation
        
        return None
    
    def update_generation(self, task_id: str, updates: Dict[str, Any]) -> bool:
        """Update a generation record."""
        generation = self.get_generation(task_id)
        if not generation:
            return False
        
        # Merge updates
        generation.update(updates)
        
        # Add completed_at if status is SUCCESS or FAILURE
        if generation.get("status") in ["SUCCESS", "FAILURE"]:
            generation["completed_at"] = datetime.utcnow().isoformat()
        
        # Save
        key = f"{self.GENERATION_PREFIX}{task_id}"
        self.redis.set(key, json.dumps(generation))
        
        # Invalidate cache
        cache_key = f"{self.CACHE_PREFIX}generation:{task_id}"
        self.cache.delete(cache_key)
        
        # Update project status if linked
        if project_id := generation.get("project_id"):
            if generation.get("status") == "SUCCESS":
                self.update_project(project_id, {
                    "status": "completed",
                    "output_url": generation.get("output_url"),
                    "task_id": task_id
                })
            elif generation.get("status") == "FAILURE":
                self.update_project(project_id, {"status": "failed"})
        
        return True
    
    def get_project_generations(self, project_id: str) -> List[Dict[str, Any]]:
        """Get all generations for a project."""
        project_gens_key = f"{self.PROJECT_PREFIX}{project_id}:generations"
        task_ids = self.redis.smembers(project_gens_key)
        
        generations = []
        for task_id in task_ids:
            generation = self.get_generation(task_id)
            if generation:
                generations.append(generation)
        
        # Sort by created_at (newest first)
        generations.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return generations
    
    def _delete_project_generations(self, project_id: str):
        """Delete all generations for a project."""
        project_gens_key = f"{self.PROJECT_PREFIX}{project_id}:generations"
        task_ids = self.redis.smembers(project_gens_key)
        
        for task_id in task_ids:
            key = f"{self.GENERATION_PREFIX}{task_id}"
            self.redis.delete(key)
            cache_key = f"{self.CACHE_PREFIX}generation:{task_id}"
            self.cache.delete(cache_key)
        
        self.redis.delete(project_gens_key)
    
    # ==================== Cache Operations ====================
    
    def cache_set(self, key: str, value: Any, ttl: int = 300):
        """Set a cache value with TTL (default 5 minutes)."""
        cache_key = f"{self.CACHE_PREFIX}{key}"
        self.cache.setex(cache_key, ttl, json.dumps(value) if not isinstance(value, str) else value)
    
    def cache_get(self, key: str) -> Optional[Any]:
        """Get a cached value."""
        cache_key = f"{self.CACHE_PREFIX}{key}"
        data = self.cache.get(cache_key)
        if data:
            try:
                return json.loads(data)
            except json.JSONDecodeError:
                return data
        return None
    
    def cache_delete(self, key: str):
        """Delete a cached value."""
        cache_key = f"{self.CACHE_PREFIX}{key}"
        self.cache.delete(cache_key)
    
    def cache_clear_pattern(self, pattern: str):
        """Clear all cache keys matching a pattern."""
        cache_key_pattern = f"{self.CACHE_PREFIX}{pattern}"
        keys = self.cache.keys(cache_key_pattern)
        if keys:
            self.cache.delete(*keys)
    
    # ==================== Utility Methods ====================
    
    def flush_all(self):
        """Flush all data (use with caution!)."""
        self.redis.flushdb()
        self.cache.flushdb()
    
    def get_stats(self) -> Dict[str, Any]:
        """Get database statistics."""
        return {
            "projects_count": self.count_projects(),
            "redis_info": self.redis.info(),
            "cache_info": self.cache.info(),
        }


class InMemoryDB:
    """Process-local database for Redis-free development."""
    backend = "memory"

    def __init__(self):
        self.projects: Dict[str, Dict[str, Any]] = {}
        self.generations: Dict[str, Dict[str, Any]] = {}
        self.project_generations: Dict[str, set[str]] = {}
        self.cache: Dict[str, Any] = {}

    def ping(self) -> bool:
        return True

    def create_project(self, project_data: Dict[str, Any]) -> str:
        project_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        project = {
            **project_data,
            "id": project_id,
            "created_at": now,
            "updated_at": now,
        }
        project.setdefault("status", "draft")
        self.projects[project_id] = project
        return project_id

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        project = self.projects.get(project_id)
        return dict(project) if project else None

    def update_project(self, project_id: str, updates: Dict[str, Any]) -> bool:
        project = self.projects.get(project_id)
        if not project:
            return False

        project.update(updates)
        project["updated_at"] = datetime.utcnow().isoformat()
        return True

    def delete_project(self, project_id: str) -> bool:
        if project_id not in self.projects:
            return False

        del self.projects[project_id]
        for task_id in self.project_generations.pop(project_id, set()):
            self.generations.pop(task_id, None)
        return True

    def list_projects(self, skip: int = 0, limit: int = 100) -> List[Dict[str, Any]]:
        projects = sorted(
            self.projects.values(),
            key=lambda project: project.get("created_at", ""),
            reverse=True,
        )
        return [dict(project) for project in projects[skip:skip + limit]]

    def count_projects(self) -> int:
        return len(self.projects)

    def create_generation(self, generation_data: Dict[str, Any]) -> str:
        task_id = generation_data.get("task_id") or str(uuid.uuid4())
        generation = {
            **generation_data,
            "task_id": task_id,
            "created_at": datetime.utcnow().isoformat(),
        }
        generation.setdefault("status", "PENDING")
        generation.setdefault("progress", 0)
        self.generations[task_id] = generation

        if project_id := generation.get("project_id"):
            self.project_generations.setdefault(project_id, set()).add(task_id)

        return task_id

    def get_generation(self, task_id: str) -> Optional[Dict[str, Any]]:
        generation = self.generations.get(task_id)
        return dict(generation) if generation else None

    def update_generation(self, task_id: str, updates: Dict[str, Any]) -> bool:
        generation = self.generations.get(task_id)
        if not generation:
            return False

        generation.update(updates)
        if generation.get("status") in ["SUCCESS", "FAILURE"]:
            generation["completed_at"] = datetime.utcnow().isoformat()

        if project_id := generation.get("project_id"):
            if generation.get("status") == "SUCCESS":
                self.update_project(project_id, {
                    "status": "completed",
                    "output_url": generation.get("output_url"),
                    "task_id": task_id,
                })
            elif generation.get("status") == "FAILURE":
                self.update_project(project_id, {"status": "failed"})

        return True

    def get_project_generations(self, project_id: str) -> List[Dict[str, Any]]:
        generations = [
            self.generations[task_id]
            for task_id in self.project_generations.get(project_id, set())
            if task_id in self.generations
        ]
        generations.sort(key=lambda generation: generation.get("created_at", ""), reverse=True)
        return [dict(generation) for generation in generations]

    def cache_set(self, key: str, value: Any, ttl: int = 300):
        self.cache[key] = value

    def cache_get(self, key: str) -> Optional[Any]:
        return self.cache.get(key)

    def cache_delete(self, key: str):
        self.cache.pop(key, None)

    def cache_clear_pattern(self, pattern: str):
        for key in list(self.cache):
            if pattern in key:
                self.cache.pop(key, None)

    def flush_all(self):
        self.projects.clear()
        self.generations.clear()
        self.project_generations.clear()
        self.cache.clear()

    def get_stats(self) -> Dict[str, Any]:
        return {
            "projects_count": self.count_projects(),
            "redis_info": {"used_memory_human": "N/A"},
            "cache_info": {"used_memory_human": "N/A"},
        }


DataStore = RedisDB | InMemoryDB


# Global database instance
_redis_db: Optional[DataStore] = None


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def get_redis_db() -> DataStore:
    """Get or create the configured database instance."""
    global _redis_db
    if _redis_db is None:
        if _env_flag("USE_IN_MEMORY_DB") or _env_flag("DEV_MOCK_GENERATION"):
            _redis_db = InMemoryDB()
            return _redis_db

        redis_url = os.getenv("REDIS_URL", os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0"))
        redis_db = RedisDB(redis_url)

        if redis_db.ping() or _env_flag("REQUIRE_REDIS"):
            _redis_db = redis_db
        else:
            print("Redis is unavailable; using in-memory development storage.")
            _redis_db = InMemoryDB()

    return _redis_db
