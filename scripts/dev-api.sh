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

# Check if Redis is running
echo "Checking Redis connection..."
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo "Redis is running."
    else
        echo ""
        echo "WARNING: Redis is not running!"
        echo "The API requires Redis for full functionality."
        echo ""
        echo "To start Redis:"
        echo "  - macOS: brew services start redis"
        echo "  - Linux: sudo systemctl start redis"
        echo "  - Docker: docker run -d -p 6379:6379 redis:alpine"
        echo ""
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
else
    echo "WARNING: redis-cli not found. Cannot verify Redis connection."
    echo "Make sure Redis is running on localhost:6379"
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
OPENAI_API_KEY=your_openai_api_key_here
PEXELS_API_KEY=your_pexels_api_key_here
PIXABAY_API_KEY=your_pixabay_api_key_here
STOCK_PROVIDER=pixabay
EOF
    echo "Created $ENV_FILE - please update with your API keys"
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
