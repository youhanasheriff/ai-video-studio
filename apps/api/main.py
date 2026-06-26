import asyncio
import os
import shutil
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from models import GenerateRequest, TaskStatusResponse
from redis_db import DataStore, get_redis_db
from pydantic import BaseModel as PydanticBaseModel

try:
    from celery.result import AsyncResult
    from celery_app import celery_app
    from tasks import generate_video_task
except ModuleNotFoundError as exc:
    AsyncResult = None
    celery_app = None
    generate_video_task = None
    CELERY_IMPORT_ERROR = exc
else:
    CELERY_IMPORT_ERROR = None

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


def should_use_mock_generation(db: DataStore) -> bool:
    """Use mock generation when local dependencies for the real pipeline are absent."""
    mock_setting = os.getenv("DEV_MOCK_GENERATION", "auto").lower()
    if mock_setting in {"1", "true", "yes", "on"}:
        return True
    if mock_setting in {"0", "false", "no", "off"}:
        return False

    return (
        generate_video_task is None
        or getattr(db, "backend", "redis") == "memory"
        or not os.getenv("OPENAI_API_KEY")
    )


def create_project_from_request(request: GenerateRequest, db: DataStore) -> str:
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
    return db.create_project(project_data)


def maybe_create_mock_video(task_id: str) -> Optional[str]:
    """Copy a local sample video when available so the frontend can preview something."""
    output_path = OUTPUT_DIR / f"mock_{task_id}.mp4"
    candidates = [
        os.getenv("MOCK_VIDEO_PATH"),
        str(Path(__file__).resolve().parents[3] / "video-composer/test_footage/pexels_4763828.mp4"),
        str(Path(__file__).resolve().parents[3] / "video-composer/test_footage2/pixabay_204565.mp4"),
    ]

    for candidate in candidates:
        if candidate and Path(candidate).exists():
            shutil.copyfile(candidate, output_path)
            return f"/static/{output_path.name}"

    return None


async def run_mock_generation(task_id: str, db: DataStore):
    steps = [
        (10, "Mock: generating voiceover..."),
        (35, "Mock: transcribing audio..."),
        (60, "Mock: fetching stock footage..."),
        (85, "Mock: composing preview..."),
    ]

    for progress, current_step in steps:
        db.update_generation(task_id, {
            "status": "STARTED",
            "progress": progress,
            "current_step": current_step,
        })
        await asyncio.sleep(0.4)

    output_url = maybe_create_mock_video(task_id)
    db.update_generation(task_id, {
        "status": "SUCCESS",
        "progress": 100,
        "output_url": output_url,
        "current_step": "Mock complete" if output_url else "Mock complete: no sample video found",
    })


@app.on_event("startup")
async def startup_event():
    """Initialize storage on startup."""
    db = get_redis_db()
    if not db.ping():
        raise RuntimeError("Failed to connect to Redis")


@app.post("/generate", response_model=TaskStatusResponse)
async def generate_video(
    request: GenerateRequest,
    background_tasks: BackgroundTasks,
    db: DataStore = Depends(get_redis_db),
):
    """Generate a video from the request."""
    project_id = create_project_from_request(request, db)

    if should_use_mock_generation(db):
        task_id = f"mock-{uuid.uuid4()}"
        db.create_generation({
            "project_id": project_id,
            "task_id": task_id,
            "status": "PENDING",
            "progress": 0,
            "current_step": "Queued mock generation...",
        })
        db.update_project(project_id, {"task_id": task_id})
        background_tasks.add_task(run_mock_generation, task_id, db)
        return TaskStatusResponse(
            task_id=task_id,
            status="PENDING",
            progress=0,
            current_step="Queued mock generation...",
        )

    if generate_video_task is None:
        raise HTTPException(status_code=503, detail=f"Video worker unavailable: {CELERY_IMPORT_ERROR}")

    task = generate_video_task.delay(request.model_dump(), generation_id=None)
    db.create_generation({
        "project_id": project_id,
        "task_id": task.id,
        "status": "PENDING",
        "progress": 0,
        "current_step": "Queued for processing...",
    })

    db.update_project(project_id, {"task_id": task.id})

    return TaskStatusResponse(task_id=task.id, status="PENDING", progress=0, current_step="Queued for processing...")


@app.get("/status/{task_id}", response_model=TaskStatusResponse)
async def get_status(task_id: str, db: DataStore = Depends(get_redis_db)):
    """Get the status of a video generation task."""
    generation = db.get_generation(task_id)

    if generation:
        return TaskStatusResponse(
            task_id=task_id,
            status=generation.get("status", "PENDING"),
            output_url=generation.get("output_url"),
            progress=generation.get("progress", 0),
            error=generation.get("error_message"),
            current_step=generation.get("current_step"),
        )

    if getattr(db, "backend", "redis") == "memory":
        raise HTTPException(status_code=404, detail="Task not found")

    if AsyncResult is None or celery_app is None:
        raise HTTPException(status_code=503, detail=f"Video worker unavailable: {CELERY_IMPORT_ERROR}")

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
async def create_project(project: ProjectCreate, db: DataStore = Depends(get_redis_db)):
    """Create a new project."""
    project_data = project.model_dump()
    project_id = db.create_project(project_data)
    created_project = db.get_project(project_id)
    return ProjectResponse(**created_project)


@app.get("/projects", response_model=List[ProjectResponse])
async def list_projects(db: DataStore = Depends(get_redis_db), skip: int = 0, limit: int = 100):
    """List all projects."""
    projects = db.list_projects(skip=skip, limit=limit)
    return [ProjectResponse(**p) for p in projects]


@app.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, db: DataStore = Depends(get_redis_db)):
    """Get a specific project."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectResponse(**project)


@app.put("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, project: ProjectCreate, db: DataStore = Depends(get_redis_db)):
    """Update a project."""
    updates = project.model_dump()
    if db.update_project(project_id, updates):
        updated_project = db.get_project(project_id)
        return ProjectResponse(**updated_project)
    raise HTTPException(status_code=404, detail="Project not found")


@app.delete("/projects/{project_id}")
async def delete_project(project_id: str, db: DataStore = Depends(get_redis_db)):
    """Delete a project."""
    if db.delete_project(project_id):
        return {"message": "Project deleted successfully"}
    raise HTTPException(status_code=404, detail="Project not found")


@app.post("/projects/{project_id}/generate", response_model=TaskStatusResponse)
async def generate_from_project(
    project_id: str,
    background_tasks: BackgroundTasks,
    db: DataStore = Depends(get_redis_db),
):
    """Generate video from an existing project."""
    project = db.get_project(project_id)
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

    db.update_project(project_id, {"status": "processing"})

    if should_use_mock_generation(db):
        task_id = f"mock-{uuid.uuid4()}"
        db.create_generation({
            "project_id": project_id,
            "task_id": task_id,
            "status": "PENDING",
            "progress": 0,
            "current_step": "Queued mock generation...",
        })
        db.update_project(project_id, {"task_id": task_id})
        background_tasks.add_task(run_mock_generation, task_id, db)
        return TaskStatusResponse(
            task_id=task_id,
            status="PENDING",
            progress=0,
            current_step="Queued mock generation...",
        )

    if generate_video_task is None:
        raise HTTPException(status_code=503, detail=f"Video worker unavailable: {CELERY_IMPORT_ERROR}")

    task = generate_video_task.delay(request.model_dump())

    db.create_generation({
        "project_id": project_id,
        "task_id": task.id,
        "status": "PENDING",
        "progress": 0,
        "current_step": "Queued for processing...",
    })
    db.update_project(project_id, {"task_id": task.id})

    return TaskStatusResponse(task_id=task.id, status="PENDING", progress=0, current_step="Queued for processing...")


@app.get("/projects/{project_id}/generations", response_model=List[dict])
async def get_project_generations(project_id: str, db: DataStore = Depends(get_redis_db)):
    """Get all generations for a project."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    generations = db.get_project_generations(project_id)
    return generations


@app.get("/health")
def health_check(db: DataStore = Depends(get_redis_db)):
    """Health check endpoint with storage and generation mode."""
    redis_healthy = db.ping()
    backend = getattr(db, "backend", "redis")
    return {
        "status": "ok" if redis_healthy else "degraded",
        "service": "ai-video-studio-api",
        "storage": backend,
        "redis": "connected" if backend == "redis" and redis_healthy else "not-used",
        "mock_generation": should_use_mock_generation(db),
    }


@app.get("/stats")
def get_stats(db: DataStore = Depends(get_redis_db)):
    """Get database statistics."""
    stats = db.get_stats()
    return {
        "projects_count": stats["projects_count"],
        "redis_memory": stats["redis_info"].get("used_memory_human", "N/A"),
        "cache_memory": stats["cache_info"].get("used_memory_human", "N/A"),
    }
