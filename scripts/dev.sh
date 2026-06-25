#!/bin/bash
# Start both frontend and backend development servers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== AI Video Studio - Full Development Environment ==="
echo ""
echo "This will start both the backend and frontend servers."
echo ""

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    echo "Stopping servers..."
    kill $API_PID $WEB_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start backend in background
echo "Starting backend server..."
"$SCRIPT_DIR/dev-api.sh" &
API_PID=$!

# Wait a moment for backend to start
sleep 3

# Start frontend in background
echo ""
echo "Starting frontend server..."
"$SCRIPT_DIR/dev-web.sh" &
WEB_PID=$!

echo ""
echo "========================================"
echo "Both servers are starting..."
echo ""
echo "Backend:  http://localhost:8000"
echo "API Docs: http://localhost:8000/docs"
echo "Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all servers"
echo "========================================"

# Wait for both processes
wait $API_PID $WEB_PID
