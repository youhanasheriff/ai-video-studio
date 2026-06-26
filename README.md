# AI Video Generation Studio

A full-stack monorepo application aimed at automating vertical video creation using AI tools. This project features a modern Next.js 14 frontend and a robust FastAPI backend orchestrating complex video processing tasks via Celery and Redis.

## 🏗 Architecture

The project is built as a **Monorepo** using **Turborepo** to manage the workspace.

### **1. Apps**
- **`apps/web` (Next.js 14)**:
  - **Framework**: Next.js App Router (TypeScript).
  - **Styling**: Tailwind CSS + Shadcn UI (Radix Primitives).
  - **Key Features**:
    - 3-Column Studio Layout (Tools, Preview, Settings).
    - Status polling for long-running generation tasks.
    - Responsive video player integration.
    - Configuration form using `react-hook-form` and `zod`.

- **`apps/api` (FastAPI)**:
  - **Framework**: FastAPI (Python 3.11+).
  - **Async Processing**: Celery + Redis for handling video rendering in the background to avoid blocking API requests.
  - **Endpoints**:
    - `POST /generate`: Enqueues a video generation task.
    - `GET /status/{task_id}`: Checks the progress/result of a task.
  - **Integration**: Wraps the correctly integrated `video-composer` tool.

### **2. Core Video Package**
- **`video-composer`**:
  - A separate open-source Python package and CLI installed from `https://github.com/youhanasheriff/video-composer`.
  - Responsible for:
    - Text-to-Speech (OpenAI TTS).
    - Stock Footage retrieval (Pexels or Pixabay).
    - Subtitle generation (Whisper timestamps).
    - Video assembly (MoviePy).

## 🚀 Getting Started

### Prerequisites
- Docker & Docker Compose
- Node.js & pnpm (optional, for local dev)
- Python 3.11+ (optional, for local dev)

### Running with Docker (Recommended)
This will start the Web App, API, Celery Worker, and Redis.

```bash
# In the root 'ai-video-studio' directory
docker-compose up --build
```

Access the services:
- **Frontend**: [http://localhost:3000](http://localhost:3000)
- **Backend Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)

### Development Workflow

#### 0. Desktop App
The local-first desktop app runs without Redis, Celery, or API keys.

```bash
cd apps/desktop
npm install --legacy-peer-deps
npm run dev
```

From the repository root:

```bash
npm run dev:desktop
```

Desktop v1 stores projects in SQLite under the app data folder, imports local clips into managed project folders, checks local dependencies such as SQLite/FFmpeg/Ollama/Piper/Whisper, and can render a local MP4 preview with FFmpeg.

#### 1. Backend Development
To run the backend locally without Docker in mock mode, no Redis or API keys are required:
```bash
cd apps/api
USE_IN_MEMORY_DB=1 DEV_MOCK_GENERATION=1 uvicorn main:app --reload
```

For the full video generation pipeline:
```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```
*Full generation requires Redis on localhost:6379 plus the OpenAI and stock-media API keys.*

You can also use the helper script from the repository root:

```bash
./scripts/dev-api.sh
```

#### 2. Frontend Development
```bash
cd apps/web
pnpm install
pnpm dev
```

## 📂 Directory Structure

```text
ai-video-studio/
├── apps/
│   ├── api/            # FastAPI Backend
│   │   ├── main.py     # API Routes
│   │   ├── tasks.py    # Celery video generation tasks
│   │   └── models.py   # Pydantic Schemas
│   └── web/            # Next.js Frontend
│       ├── app/        # Pages & Layouts
│       ├── components/ # React Components (UI)
│       └── lib/        # Utilities
├── docker-compose.yml  # Container Orchestration
├── turbo.json          # Monorepo Build Pipeline
└── package.json        # Root Scripts
```

## 🔧 Configuration

- **Environment Variables**:
  - `apps/web`: `NEXT_PUBLIC_API_URL` (Defaults to `http://localhost:8000`)
  - `apps/api`:
    - `CELERY_BROKER_URL`: Redis URL.
    - `CELERY_RESULT_BACKEND`: Redis URL.
    - `OPENAI_API_KEY`: Required for TTS, Whisper transcription, and vision validation.
    - `PEXELS_API_KEY`: Required when `STOCK_PROVIDER=pexels`.
    - `PIXABAY_API_KEY`: Required when `STOCK_PROVIDER=pixabay`.
    - `STOCK_PROVIDER`: `pexels` or `pixabay` (defaults to `pexels` in `video-composer`).
    - `USE_IN_MEMORY_DB`: Set to `1` to run without Redis.
    - `DEV_MOCK_GENERATION`: `auto`, `1`, or `0`; mock mode avoids Celery/API-key generation.
    - `MOCK_VIDEO_PATH`: Optional local `.mp4` returned by mock generation.
    - `REQUIRE_REDIS`: Set to `1` to fail startup when Redis is unavailable.

## Developing the CLI Tool

`video-composer` is developed in its own repository:

```bash
git clone https://github.com/youhanasheriff/video-composer.git
cd video-composer
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
video-composer version
pytest
```

`ai-video-studio` consumes it from Git in `apps/api/requirements.txt`. For stable deployments, pin that dependency to a release tag instead of `main`.
