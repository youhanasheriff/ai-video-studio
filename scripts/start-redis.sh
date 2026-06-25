#!/bin/bash
# Start Redis server for local development

set -e

echo "=== AI Video Studio - Redis Setup ==="
echo ""

# Check if Redis is already running
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo "Redis is already running!"
        redis-cli INFO server | grep redis_version
        exit 0
    fi
fi

# Try different methods to start Redis
if command -v brew &> /dev/null; then
    echo "Starting Redis via Homebrew..."
    brew services start redis
    sleep 2
    if redis-cli ping &> /dev/null; then
        echo "Redis started successfully!"
        exit 0
    fi
fi

if command -v docker &> /dev/null; then
    echo "Starting Redis via Docker..."

    # Check if container already exists
    if docker ps -a --format '{{.Names}}' | grep -q '^ai-video-studio-redis$'; then
        docker start ai-video-studio-redis
    else
        docker run -d --name ai-video-studio-redis -p 6379:6379 redis:alpine
    fi

    sleep 2
    echo "Redis container started!"
    echo "To stop: docker stop ai-video-studio-redis"
    exit 0
fi

if command -v redis-server &> /dev/null; then
    echo "Starting Redis server directly..."
    redis-server --daemonize yes
    sleep 2
    if redis-cli ping &> /dev/null; then
        echo "Redis started successfully!"
        exit 0
    fi
fi

echo ""
echo "Could not automatically start Redis."
echo ""
echo "Please install Redis using one of these methods:"
echo "  - macOS: brew install redis && brew services start redis"
echo "  - Ubuntu: sudo apt install redis-server && sudo systemctl start redis"
echo "  - Docker: docker run -d -p 6379:6379 redis:alpine"
echo ""
exit 1
