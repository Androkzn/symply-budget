# Inspection Report Processor - Lambda Function

AWS Lambda function for processing home inspection reports with AI-powered analysis.

## Quick Start

### Deploy Code Changes (Fast!)

**Single Environment (Default - Production):**
```bash
./deploy-code-only
```

**Multi-Environment:**
```bash
./deploy-dev          # Deploy to DEV
./deploy-staging      # Deploy to STAGING
./deploy-prod         # Deploy to PRODUCTION
```
**Time:** ~10 seconds | **Size:** 26KB

### First Time / Dependency Changes

**Single Environment:**
```bash
./deploy-with-layer
```

**Multi-Environment:**
```bash
./deploy-dev-layer      # Deploy with layer to DEV
./deploy-staging-layer  # Deploy with layer to STAGING
./deploy-prod-layer     # Deploy with layer to PRODUCTION
```
**Time:** ~2-3 minutes | **Includes:** Dependencies layer

## Project Structure

```
lambda-processor/
├── handler.py                 # Main Lambda handler
├── job_state.py              # Job state management
├── structured_logger.py      # Logging utilities
├── batch_processor.py        # Batch processing logic
├── requirements.txt          # Python dependencies
├── requirements-layer.txt    # Layer-only dependencies
├── docs/                     # Documentation
│   ├── DEPLOYMENT-SUCCESS.md # Deployment system overview
│   ├── QUICK-START.md        # Quick reference guide
│   ├── deploy.md             # Detailed deployment guide
│   └── README-DOCKER-DEPLOY.md # Docker deployment
└── scripts/                  # Deployment scripts
    ├── create-and-deploy-layer.sh  # Create layer + deploy
    ├── deploy-code-only.sh         # Fast code deployment
    ├── docker-deploy.sh            # Docker-based deploy
    ├── native-deploy.sh            # Native build
    └── install-docker.sh           # Docker installation help
```

## Deployment Options

| Method | Command | Speed | Best For |
|--------|---------|-------|----------|
| **Code-only (Single)** | `./deploy-code-only` | 10s | Regular updates (prod) |
| **Code-only (Multi)** ⭐ | `./deploy-dev` | 10s | Environment-specific |
| **Full Layer (Single)** | `./deploy-with-layer` | 2-3m | First time / deps (prod) |
| **Full Layer (Multi)** | `./deploy-dev-layer` | 2-3m | First time / deps (env) |
| **Docker** | `./scripts/docker-deploy.sh --env=dev` | 1-2m | Production builds |
| **CloudShell** | See [deploy.md](../../documents/engineering/lambda-processor/deploy.md) | 5m | Manual fallback |

### Advanced Options

**Deploy with automatic testing:**
```bash
./deploy-dev --test           # Deploy to DEV and run tests
./deploy-staging --test       # Deploy to STAGING and run tests
./deploy-prod --test          # Deploy to PROD and run tests
```

**Deploy with custom environment:**
```bash
./scripts/deploy-code-only.sh --env=dev           # Custom env
./scripts/deploy-code-only.sh --env=staging       # Custom env
```

## Multi-Environment Support

Deploy to different environments with a single command:

| Environment | Function Name | Command |
|-------------|---------------|---------|
| **DEV** | `inspection-report-processor-dev` | `./deploy-dev` |
| **STAGING** | `inspection-report-processor-staging` | `./deploy-staging` |
| **PROD** | `inspection-report-processor` | `./deploy-prod` |

All environments use:
- **Region:** `us-east-1`
- **Runtime:** Python 3.11
- **Code Size:** 26KB
- **Layer:** Environment-specific layer (34MB)

### Environment Configuration

Environments are configured in `scripts/env-config.sh`:
- Function names
- Layer names
- AWS account IDs
- Region settings

Default environment is PRODUCTION if not specified.

## Features

- PDF processing and image extraction
- AI-powered image analysis using Claude (Anthropic)
- Batch processing for large files
- Structured logging
- State management
- Cloudflare D1 database integration
- R2 storage integration

## Environment Variables

Required environment variables (configured in AWS Lambda):
- `ANTHROPIC_API_KEY` - Claude API key
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account
- `CLOUDFLARE_D1_DATABASE_ID` - D1 database ID
- `CLOUDFLARE_API_TOKEN` - Cloudflare API token
- `R2_BUCKET_NAME` - R2 bucket name
- `R2_ENDPOINT_URL` - R2 endpoint
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key

## Documentation

- **[Deployment Success Guide](../../documents/engineering/lambda-processor/DEPLOYMENT-SUCCESS.md)** - Complete deployment system overview
- **[Quick Start](../../documents/engineering/lambda-processor/QUICK-START.md)** - Quick reference for deployments
- **[Full Deployment Guide](../../documents/engineering/lambda-processor/deploy.md)** - Detailed deployment instructions
- **[Docker Deployment](../../documents/engineering/lambda-processor/README-DOCKER-DEPLOY.md)** - Docker-based deployment

## Development

### Local Testing
```bash
# Install dependencies
pip install -r requirements.txt

# Run tests (if available)
python -m pytest
```

### Code Changes
1. Make your changes to Python files
2. Test locally (if possible)
3. Deploy: `./deploy-code-only`
4. Verify in AWS Lambda console

### Dependency Changes
1. Update `requirements.txt` or `requirements-layer.txt`
2. Deploy: `./deploy-with-layer`
3. Wait for layer to publish (~2-3 minutes)

## Troubleshooting

### Package too large
Use layer-based deployment:
```bash
./deploy-with-layer
```

### Deployment fails
Check AWS credentials:
```bash
aws sts get-caller-identity
```

### Layer issues
Recreate the layer:
```bash
./scripts/create-and-deploy-layer.sh
```

### View Logs
```bash
aws logs tail /aws/lambda/inspection-report-processor --follow
```

## Recent Changes

- **2026-01-28:** Fixed SQL NULL handling for `ai_description`
- **2026-01-28:** Implemented layer-based deployment (55MB → 26KB)
- **2026-01-28:** Created automated deployment scripts
- **2026-01-27:** Implemented batch processing for large PDFs

## Support

For issues or questions:
1. Check [docs/](docs/) folder for detailed guides
2. Review AWS Lambda logs
3. Verify environment variables are set correctly

---

**Last Updated:** 2026-01-28
**Current Version:** Layer-based deployment with automated scripts
