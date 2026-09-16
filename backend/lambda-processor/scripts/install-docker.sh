#!/bin/bash

echo "🐳 Docker Desktop Installation Helper"
echo "====================================="
echo ""

# Check if Docker is already installed
if [ -d "/Applications/Docker.app" ]; then
    echo "✓ Docker Desktop is already installed!"
    echo ""
    echo "Starting Docker Desktop..."
    open -a Docker
    echo ""
    echo "⏳ Waiting for Docker to start (this may take 30-60 seconds)..."

    # Wait for Docker to start
    for i in {1..30}; do
        if docker info > /dev/null 2>&1; then
            echo "✅ Docker is running!"
            docker --version
            exit 0
        fi
        sleep 2
        echo -n "."
    done

    echo ""
    echo "⚠️  Docker is starting but not ready yet. Please wait a moment and try again."
    exit 0
fi

echo "Docker Desktop is not installed."
echo ""
echo "Please install Docker Desktop using ONE of these methods:"
echo ""
echo "Method 1: Download from website (Recommended)"
echo "  1. Visit: https://www.docker.com/products/docker-desktop"
echo "  2. Click 'Download for Mac' (choose Apple Silicon if M1/M2/M3)"
echo "  3. Open the downloaded .dmg file"
echo "  4. Drag Docker to Applications folder"
echo "  5. Open Docker from Applications"
echo ""
echo "Method 2: Using Homebrew (requires password)"
echo "  Run in Terminal:"
echo "  $ brew install --cask docker"
echo ""
echo "After installation, run this script again or run:"
echo "  $ open -a Docker"
echo ""

# Try to open the download page
read -p "Open Docker download page in browser? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    open "https://www.docker.com/products/docker-desktop"
fi
