#!/bin/bash
# Start the Next.js frontend development server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$PROJECT_ROOT/apps/web"

echo "=== AI Video Studio - Frontend Development Server ==="
echo ""

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is required but not installed."
    echo "Install it with: npm install -g pnpm"
    exit 1
fi

cd "$WEB_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    pnpm install
fi

# Create .env.local if it doesn't exist
ENV_FILE="$WEB_DIR/.env.local"
if [ ! -f "$ENV_FILE" ]; then
    echo "Creating .env.local..."
    cat > "$ENV_FILE" << 'EOF'
NEXT_PUBLIC_API_URL=http://localhost:8000
EOF
    echo "Created $ENV_FILE"
fi

echo ""
echo "Starting Next.js dev server on http://localhost:3000"
echo "Press Ctrl+C to stop"
echo ""

# Start Next.js dev server
exec pnpm dev
