from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from celery_app import celery_app
from tasks import generate_video_task
from models import GenerateRequest, TaskStatusResponse
from celery.result import AsyncResult
from redis_db import get_redis_db, RedisDB
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel as PydanticBaseModel
import os

app = FastAPI(title="AI Video Studio API", version="1.0.0")

# Create output directory for generated videos
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./output"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Mount static files for serving generated videos
app.mount("/static", StaticFiles(directory=str(OUTPUT_DIR)), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic models for API
class ProjectCreate(PydanticBaseModel):
    name: str
    script: str
    language: str = "en"
    voice: str = "nova"
    voice_speed: float = 1.0
    aspect_ratio: str = "9:16"
    subtitles_enabled: bool = True
    subtitle_style: str = "default"


class ProjectResponse(PydanticBaseModel):
    id: str
    name: str
    script: str
    language: str
    voice: str = "nova"
    voice_speed: float = 1.0
    aspect_ratio: str
    subtitles_enabled: bool
    subtitle_style: str
    status: str
    output_url: Optional[str] = None
    task_id: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


@app.on_event("startup")
async def startup_event():
    """Initialize Redis connection on startup."""
    redis_db = get_redis_db()
    if not redis_db.ping():
        raise RuntimeError("Failed to connect to Redis")


@app.post("/generate", response_model=TaskStatusResponse)
async def generate_video(request: GenerateRequest, redis_db: RedisDB = Depends(get_redis_db)):
    """Generate a video from the request."""
    # Create a project record in Redis
    project_data = {
        "name": f"Video {request.script[:30]}...",
        "script": request.script,
        "language": request.language,
        "voice": request.voice,
        "voice_speed": request.voice_speed,
        "aspect_ratio": request.aspect_ratio,
        "subtitles_enabled": request.subtitles_enabled,
        "subtitle_style": request.subtitle_style,
        "status": "processing",
    }
    project_id = redis_db.create_project(project_data)

    # Create generation task
    task = generate_video_task.delay(request.model_dump(), generation_id=None)

    # Create generation record in Redis
    generation_data = {
        "project_id": project_id,
        "task_id": task.id,
        "status": "PENDING",
        "progress": 0,
        "current_step": "Queued for processing...",
    }
    redis_db.create_generation(generation_data)

    # Update project with task_id
    redis_db.update_project(project_id, {"task_id": task.id})

    return TaskStatusResponse(task_id=task.id, status="PENDING", progress=0, current_step="Queued for processing...")


@app.get("/status/{task_id}", response_model=TaskStatusResponse)
async def get_status(task_id: str, redis_db: RedisDB = Depends(get_redis_db)):
    """Get the status of a video generation task."""
    # Try to get from Redis first
    generation = redis_db.get_generation(task_id)

    if generation:
        return TaskStatusResponse(
            task_id=task_id,
            status=generation.get("status", "PENDING"),
            output_url=generation.get("output_url"),
            progress=generation.get("progress", 0),
            error=generation.get("error_message"),
            current_step=generation.get("current_step"),
        )

    # Fallback to Celery result
    task_result = AsyncResult(task_id, app=celery_app)
    result = task_result.result if task_result.ready() else None

    if isinstance(result, dict) and "status" in result:
        return TaskStatusResponse(
            task_id=task_id,
            status=result["status"],
            output_url=result.get("output_url"),
            progress=result.get("progress"),
            error=result.get("error"),
            current_step=result.get("current_step"),
        )

    return TaskStatusResponse(
        task_id=task_id,
        status=task_result.status,
        output_url=result if task_result.status == "SUCCESS" else None,
    )


@app.post("/projects", response_model=ProjectResponse)
async def create_project(project: ProjectCreate, redis_db: RedisDB = Depends(get_redis_db)):
    """Create a new project."""
    project_data = project.model_dump()
    project_id = redis_db.create_project(project_data)
    created_project = redis_db.get_project(project_id)
    return ProjectResponse(**created_project)


@app.get("/projects", response_model=List[ProjectResponse])
async def list_projects(redis_db: RedisDB = Depends(get_redis_db), skip: int = 0, limit: int = 100):
    """List all projects."""
    projects = redis_db.list_projects(skip=skip, limit=limit)
    return [ProjectResponse(**p) for p in projects]


@app.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, redis_db: RedisDB = Depends(get_redis_db)):
    """Get a specific project."""
    project = redis_db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectResponse(**project)


@app.put("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, project: ProjectCreate, redis_db: RedisDB = Depends(get_redis_db)):
    """Update a project."""
    updates = project.model_dump()
    if redis_db.update_project(project_id, updates):
        updated_project = redis_db.get_project(project_id)
        return ProjectResponse(**updated_project)
    raise HTTPException(status_code=404, detail="Project not found")


@app.delete("/projects/{project_id}")
async def delete_project(project_id: str, redis_db: RedisDB = Depends(get_redis_db)):
    """Delete a project."""
    if redis_db.delete_project(project_id):
        return {"message": "Project deleted successfully"}
    raise HTTPException(status_code=404, detail="Project not found")


@app.post("/projects/{project_id}/generate", response_model=TaskStatusResponse)
async def generate_from_project(project_id: str, redis_db: RedisDB = Depends(get_redis_db)):
    """Generate video from an existing project."""
    project = redis_db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    request = GenerateRequest(
        script=project["script"],
        language=project.get("language", "en"),
        voice=project.get("voice", "nova"),
        voice_speed=project.get("voice_speed", 1.0),
        aspect_ratio=project.get("aspect_ratio", "9:16"),
        subtitles_enabled=project.get("subtitles_enabled", True),
        subtitle_style=project.get("subtitle_style", "default"),
    )

    redis_db.update_project(project_id, {"status": "processing"})
    task = generate_video_task.delay(request.model_dump())

    generation_data = {
        "project_id": project_id,
        "task_id": task.id,
        "status": "PENDING",
        "progress": 0,
        "current_step": "Queued for processing...",
    }
    redis_db.create_generation(generation_data)
    redis_db.update_project(project_id, {"task_id": task.id})

    return TaskStatusResponse(task_id=task.id, status="PENDING", progress=0, current_step="Queued for processing...")


@app.get("/projects/{project_id}/generations", response_model=List[dict])
async def get_project_generations(project_id: str, redis_db: RedisDB = Depends(get_redis_db)):
    """Get all generations for a project."""
    project = redis_db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    generations = redis_db.get_project_generations(project_id)
    return generations


@app.get("/health")
def health_check(redis_db: RedisDB = Depends(get_redis_db)):
    """Health check endpoint with Redis status."""
    redis_healthy = redis_db.ping()
    return {
        "status": "ok" if redis_healthy else "degraded",
        "service": "ai-video-studio-api",
        "redis": "connected" if redis_healthy else "disconnected"
    }


@app.get("/stats")
def get_stats(redis_db: RedisDB = Depends(get_redis_db)):
    """Get database statistics."""
    stats = redis_db.get_stats()
    return {
        "projects_count": stats["projects_count"],
        "redis_memory": stats["redis_info"].get("used_memory_human", "N/A"),
        "cache_memory": stats["cache_info"].get("used_memory_human", "N/A"),
    }
