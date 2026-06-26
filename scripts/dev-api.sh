#!/bin/bash
# Start the FastAPI backend development server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
API_DIR="$PROJECT_ROOT/apps/api"

echo "=== AI Video Studio - Backend Development Server ==="
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not installed."
    exit 1
fi

# Check for virtual environment
VENV_DIR="$API_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# Activate virtual environment
source "$VENV_DIR/bin/activate"

# Install dependencies if requirements changed
REQUIREMENTS_HASH=$(md5 -q "$API_DIR/requirements.txt" 2>/dev/null || md5sum "$API_DIR/requirements.txt" | cut -d' ' -f1)
HASH_FILE="$VENV_DIR/.requirements_hash"

if [ ! -f "$HASH_FILE" ] || [ "$(cat "$HASH_FILE")" != "$REQUIREMENTS_HASH" ]; then
    echo "Installing Python dependencies..."
    pip install -r "$API_DIR/requirements.txt" --quiet
    echo "$REQUIREMENTS_HASH" > "$HASH_FILE"
fi

# Check if Redis is running. The API can fall back to in-memory storage for local UI work.
echo "Checking Redis connection..."
REDIS_AVAILABLE=false
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo "Redis is running."
        REDIS_AVAILABLE=true
    else
        echo ""
        echo "WARNING: Redis is not running!"
        echo "The API will use in-memory storage and mock generation."
        echo ""
        echo "To use the real Celery/video generation pipeline, start Redis:"
        echo "  - macOS: brew services start redis"
        echo "  - Linux: sudo systemctl start redis"
        echo "  - Docker: docker run -d -p 6379:6379 redis:alpine"
    fi
else
    echo "WARNING: redis-cli not found. Cannot verify Redis connection."
    echo "The API can still start and will fall back if Redis is unavailable."
fi

# Create .env file if it doesn't exist
ENV_FILE="$API_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo ""
    echo "Creating .env file with defaults..."
    cat > "$ENV_FILE" << 'EOF'
# Redis Configuration
REDIS_URL=redis://localhost:6379/0

# API Configuration
OUTPUT_DIR=./output
TEMP_DIR=./temp

# Video Composer Settings (optional - for video generation)
OPENAI_API_KEY=
PEXELS_API_KEY=
PIXABAY_API_KEY=
STOCK_PROVIDER=pixabay

# Local development fallback
USE_IN_MEMORY_DB=0
DEV_MOCK_GENERATION=auto
MOCK_VIDEO_PATH=
REQUIRE_REDIS=0
EOF
    echo "Created $ENV_FILE"
fi

# Load local environment variables if present.
set -a
source "$ENV_FILE"
set +a

if [ "$REDIS_AVAILABLE" != "true" ]; then
    export USE_IN_MEMORY_DB="${USE_IN_MEMORY_DB:-1}"
fi

# Create output directory
mkdir -p "$API_DIR/output"

cd "$API_DIR"

echo ""
echo "Starting FastAPI server on http://localhost:8000"
echo "API docs available at http://localhost:8000/docs"
echo "Press Ctrl+C to stop"
echo ""

# Start uvicorn with hot reload
exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload
