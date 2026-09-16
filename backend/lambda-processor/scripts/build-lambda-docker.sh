#!/bin/bash
# Build Lambda package using Docker (Linux-compatible)
# This ensures pydantic_core and other native extensions are built for Linux

set -e

echo "=========================================="
echo "Building Lambda package with Docker"
echo "=========================================="

# Create a temporary Dockerfile for building
cat > /tmp/Dockerfile.lambda-build <<'EOF'
FROM public.ecr.aws/lambda/python:3.11

WORKDIR /build

# Copy requirements
COPY requirements.txt .

# Install dependencies
RUN pip install --target /build/package -r requirements.txt

# Copy handler
COPY handler.py /build/package/

WORKDIR /build/package
RUN zip -r /build/lambda-function.zip .

CMD ["echo", "Build complete"]
EOF

# Build the package
echo "Building Lambda package in Docker container..."
docker build -f /tmp/Dockerfile.lambda-build -t lambda-builder .

# Extract the zip file
docker create --name lambda-builder-temp lambda-builder
docker cp lambda-builder-temp:/build/lambda-function.zip ./lambda-function.zip
docker rm lambda-builder-temp

echo "Package created: lambda-function.zip ($(du -h lambda-function.zip | cut -f1))"
echo ""
echo "Deploy with:"
echo "  aws lambda update-function-code \\"
echo "    --function-name inspection-report-processor \\"
echo "    --zip-file fileb://lambda-function.zip \\"
echo "    --region us-east-1"
