# Docker-based Lambda Deployment

Automated deployment script using Docker to build and deploy Lambda function.

## Prerequisites

1. **Docker Desktop** - Must be running
2. **AWS CLI** - Configured with credentials (`aws configure`)
3. **jq** - JSON processor (install with `brew install jq`)

## Quick Start

```bash
cd backend/lambda-processor
./docker-deploy.sh
```

That's it! The script will:
1. Build Lambda package using Docker (correct Python runtime & dependencies)
2. Create deployment zip
3. Deploy to AWS Lambda
4. Clean up build artifacts

## What It Does

1. **Validates environment** - Checks Docker and AWS credentials
2. **Builds with Docker** - Uses `public.ecr.aws/lambda/python:3.11` image
3. **Installs dependencies** - Compiles binary packages for Lambda environment
4. **Creates deployment zip** - Packages everything correctly
5. **Deploys to Lambda** - Uses AWS CLI to update function code
6. **Reports status** - Shows deployment details

## Configuration

Edit these variables in `docker-deploy.sh`:

```bash
FUNCTION_NAME="inspection-report-processor"  # Lambda function name
REGION="us-east-1"                          # AWS region
```

## Files Created

- `Dockerfile.lambda` - Build configuration
- `docker-deploy.sh` - Deployment script
- `lambda-docker-deploy.zip` - Deployment package (kept for debugging)
- `docker-build/` - Build directory (cleaned up automatically)

## Troubleshooting

**Docker not running:**
```bash
# Start Docker Desktop application
open -a Docker
```

**AWS credentials not configured:**
```bash
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1)
```

**jq not installed:**
```bash
brew install jq
```

**Large package size:**
The script optimizes the package but if it's too large (>50MB), you may need to:
1. Remove unused dependencies from `requirements.txt`
2. Use Lambda Layers for large libraries

## Advantages Over CloudShell

- **Faster** - No manual upload/extraction
- **Automated** - One command deployment
- **Consistent** - Same build environment every time
- **Local** - No need for CloudShell access
- **Reliable** - Binary compatibility guaranteed with Lambda runtime

## Manual Deployment (if needed)

```bash
# Build only
docker build -f Dockerfile.lambda -t lambda-builder:latest .

# Extract package
CONTAINER_ID=$(docker create lambda-builder:latest)
docker cp "$CONTAINER_ID:/asset/." ./docker-build/
docker rm "$CONTAINER_ID"

# Create zip
cd docker-build && zip -r9 ../lambda-docker-deploy.zip . && cd ..

# Deploy
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-docker-deploy.zip \
  --region us-east-1
```
