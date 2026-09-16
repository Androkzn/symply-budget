#!/bin/bash

# Deploy backend to both staging and production
# Requires Node.js 20+ and wrangler CLI

set -e

echo "=========================================="
echo "Deploying Simple House Backend"
echo "=========================================="
echo ""

# Check Node version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "❌ Error: Node.js 20+ required. Current version: $(node --version)"
    echo ""
    echo "Please upgrade Node.js:"
    echo "  nvm install 20"
    echo "  nvm use 20"
    echo ""
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Error: wrangler CLI not found"
    echo "Install with: npm install -g wrangler"
    exit 1
fi

echo "✅ Wrangler CLI found"
echo ""

# Deploy to staging
echo "=========================================="
echo "Deploying to STAGING..."
echo "=========================================="
wrangler deploy --env staging

echo ""
echo "=========================================="
echo "Deploying to PRODUCTION..."
echo "=========================================="
wrangler deploy --env production

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Staging: https://simple-house-api-staging.a-tekhtelev.workers.dev"
echo "Production: https://simple-house-api.a-tekhtelev.workers.dev"
echo ""
echo "⚠️  Remember to configure AWS secrets if not already set:"
echo "   - AWS_LAMBDA_ARN"
echo "   - AWS_ACCESS_KEY_ID"
echo "   - AWS_SECRET_ACCESS_KEY"
echo "   - AWS_REGION"
echo ""
echo "Run: ./setup-lambda-secrets.sh"
