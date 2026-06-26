# AI Video Studio API

FastAPI backend for the AI Video Generation Studio. The full generation pipeline uses Redis, Celery, and external AI/stock-media APIs. For local UI/API development, it can also run with in-memory storage and mock generation.

## Architecture

### Data Storage
- **Primary Database**: Redis (DB 0) - Stores all project and generation data
- **Cache Layer**: Redis (DB 1) - Caches frequently accessed data
- **Message Queue**: Redis (DB 0) - Used by Celery for task queue

### Redis Data Structure

#### Projects
- **Key Pattern**: `project:{project_id}`
- **Storage**: JSON string
- **Index**: `projects:index` (Sorted Set) - Indexes project IDs by creation timestamp

#### Generations
- **Key Pattern**: `generation:{task_id}`
- **Storage**: JSON string
- **Project Link**: `project:{project_id}:generations` (Set) - Links generations to projects

#### Cache
- **Key Pattern**: `cache:{resource_type}:{id}`
- **TTL**: 
  - Projects: 5 minutes
  - Generations: 2 minutes

## API Endpoints

### Video Generation
- `POST /generate` - Generate a video from request
- `GET /status/{task_id}` - Get generation status

### Projects
- `POST /projects` - Create a new project
- `GET /projects` - List all projects (paginated)
- `GET /projects/{project_id}` - Get a specific project
- `PUT /projects/{project_id}` - Update a project
- `DELETE /projects/{project_id}` - Delete a project
- `POST /projects/{project_id}/generate` - Generate video from project
- `GET /projects/{project_id}/generations` - Get all generations for a project

### System
- `GET /health` - Health check with Redis status
- `GET /stats` - Database statistics

## Environment Variables

```bash
REDIS_URL=redis://redis:6379/0          # Redis connection URL
CELERY_BROKER_URL=redis://redis:6379/0   # Celery broker
CELERY_RESULT_BACKEND=redis://redis:6379/0  # Celery results
OUTPUT_DIR=/app/output                   # Video output directory
OPENAI_API_KEY=your_key                  # Required for TTS, transcription, and vision validation
PEXELS_API_KEY=your_key                  # Required when STOCK_PROVIDER=pexels
PIXABAY_API_KEY=your_key                 # Required when STOCK_PROVIDER=pixabay
STOCK_PROVIDER=pexels                    # pexels or pixabay
USE_IN_MEMORY_DB=0                       # Set to 1 to avoid Redis locally
DEV_MOCK_GENERATION=auto                 # auto, 1, or 0
MOCK_VIDEO_PATH=                         # Optional sample mp4 for mock generation
REQUIRE_REDIS=0                          # Set to 1 to fail startup when Redis is down
```

## Running Locally

### Mock mode: no Redis or API keys

```bash
cd apps/api
USE_IN_MEMORY_DB=1 DEV_MOCK_GENERATION=1 uvicorn main:app --reload
```

This mode stores projects/tasks in memory and simulates `/generate` progress. If `MOCK_VIDEO_PATH` points to a local `.mp4`, the mock task returns it as the generated video. In this workspace, the API also checks the sibling `video-composer/test_footage` folders for a sample clip.

### Full generation mode

```bash
# Install dependencies
pip install -r requirements.txt

# Start Redis (if not using Docker)
redis-server

# Run the API
uvicorn main:app --reload
```

## Redis Benefits

1. **Performance**: In-memory storage provides sub-millisecond latency
2. **Simplicity**: No schema migrations or ORM complexity
3. **Caching**: Built-in caching layer for frequently accessed data
4. **Scalability**: Redis can handle millions of operations per second
5. **Flexibility**: Easy to add new data structures and indexes

## Data Persistence

Redis is configured with:
- **AOF (Append-Only File)**: Enabled for durability
- **Memory Policy**: `allkeys-lru` - Evicts least recently used keys when memory limit is reached
- **Max Memory**: 512MB (configurable)
