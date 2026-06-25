#!/bin/bash
# Start the Celery worker for video processing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
API_DIR="$PROJECT_ROOT/apps/api"

echo "=== AI Video Studio - Celery Worker ==="
echo ""

# Check for virtual environment
VENV_DIR="$API_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "Error: Python virtual environment not found."
    echo "Please run ./scripts/dev-api.sh first to set up the environment."
    exit 1
fi

# Activate virtual environment
source "$VENV_DIR/bin/activate"

# Check if Redis is running
echo "Checking Redis connection..."
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo "Redis is running."
    else
        echo "ERROR: Redis is not running!"
        echo "Please start Redis first: brew services start redis"
        exit 1
    fi
fi

# Load environment variables
if [ -f "$API_DIR/.env" ]; then
    export $(grep -v '^#' "$API_DIR/.env" | xargs)
fi

cd "$API_DIR"

echo ""
echo "Starting Celery worker..."
echo "Ready to process video generation tasks."
echo "Press Ctrl+C to stop"
echo ""

# Start Celery worker
exec celery -A celery_app worker --loglevel=info --concurrency=2
