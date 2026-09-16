#!/bin/bash

# 🚀 Visit Checklist Feature - Automated Deployment Script
# This script automates the deployment of the visit checklist feature to all environments

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_step() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}!${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Verify prerequisites
print_step "Checking prerequisites..."

if ! command_exists npm; then
    print_error "npm is not installed"
    exit 1
fi

if ! command_exists wrangler; then
    print_error "wrangler is not installed. Run: npm install -g wrangler"
    exit 1
fi

if ! command_exists eas; then
    print_warning "eas-cli is not installed. Frontend deployment will be skipped."
    print_warning "Install with: npm install -g eas-cli"
fi

print_success "Prerequisites check passed"

# Parse arguments
ENVIRONMENT=${1:-staging}  # Default to staging
SKIP_MIGRATION=${2:-false}
SKIP_BACKEND=${3:-false}
SKIP_FRONTEND=${4:-false}

print_step "Deployment Configuration:"
echo "  Environment: $ENVIRONMENT"
echo "  Skip Migration: $SKIP_MIGRATION"
echo "  Skip Backend: $SKIP_BACKEND"
echo "  Skip Frontend: $SKIP_FRONTEND"
echo ""

# Confirm production deployment
if [ "$ENVIRONMENT" == "production" ]; then
    print_warning "⚠️  You are about to deploy to PRODUCTION!"
    read -p "Are you sure you want to continue? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        print_error "Deployment cancelled"
        exit 1
    fi
fi

# Step 1: Install frontend dependencies
if [ "$SKIP_FRONTEND" != "true" ]; then
    print_step "Step 1: Installing frontend dependencies..."

    if ! npm list expo-image-picker >/dev/null 2>&1; then
        print_warning "expo-image-picker not installed, installing..."
        npm install expo-image-picker
    fi

    if ! npm list expo-av >/dev/null 2>&1; then
        print_warning "expo-av not installed, installing..."
        npm install expo-av
    fi

    if ! npm list expo-file-system >/dev/null 2>&1; then
        print_warning "expo-file-system not installed, installing..."
        npm install expo-file-system
    fi

    print_success "Frontend dependencies installed"

    # iOS: Install pods
    if [ -d "ios" ]; then
        print_step "Installing iOS pods..."
        # Via the resolver, not bare `pod` — see scripts/ios/pod.sh.
        cd ios && ../scripts/ios/pod.sh install && cd ..
        print_success "iOS pods installed"
    fi
else
    print_warning "Skipping frontend dependency installation"
fi

# Step 2: Run database migration
if [ "$SKIP_MIGRATION" != "true" ]; then
    print_step "Step 2: Running database migration for $ENVIRONMENT..."

    cd backend

    if [ "$ENVIRONMENT" == "development" ]; then
        npm run db:migrate || print_error "Migration failed (development)"
    else
        npm run db:migrate:remote -- --env $ENVIRONMENT || print_error "Migration failed ($ENVIRONMENT)"
    fi

    cd ..

    print_success "Database migration completed for $ENVIRONMENT"
else
    print_warning "Skipping database migration"
fi

# Step 3: Deploy backend
if [ "$SKIP_BACKEND" != "true" ]; then
    print_step "Step 3: Deploying backend to $ENVIRONMENT..."

    cd backend

    if [ "$ENVIRONMENT" == "development" ]; then
        npm run deploy || print_error "Backend deployment failed (development)"
    elif [ "$ENVIRONMENT" == "staging" ]; then
        npm run deploy:staging || print_error "Backend deployment failed (staging)"
    elif [ "$ENVIRONMENT" == "production" ]; then
        npm run deploy:production || print_error "Backend deployment failed (production)"
    else
        print_error "Unknown environment: $ENVIRONMENT"
        exit 1
    fi

    cd ..

    print_success "Backend deployed to $ENVIRONMENT"
else
    print_warning "Skipping backend deployment"
fi

# Step 4: Test backend deployment
print_step "Step 4: Testing backend deployment..."

# Get API URL based on environment
if [ "$ENVIRONMENT" == "production" ]; then
    API_URL="https://api.simplehouse.app"
elif [ "$ENVIRONMENT" == "staging" ]; then
    API_URL="https://api-staging.simplehouse.app"
else
    API_URL="http://localhost:8787"
fi

# Health check
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health")
if [ "$HTTP_CODE" == "200" ]; then
    print_success "Backend health check passed ($API_URL)"
else
    print_error "Backend health check failed ($API_URL) - HTTP $HTTP_CODE"
fi

# Step 5: Build and deploy frontend
if [ "$SKIP_FRONTEND" != "true" ] && command_exists eas; then
    print_step "Step 5: Building frontend..."

    if [ "$ENVIRONMENT" == "production" ]; then
        print_warning "Production frontend build requires manual EAS submission"
        print_warning "Run the following commands manually:"
        echo "  eas build --platform all --profile production"
        echo "  eas submit --platform all"
    else
        print_warning "Frontend deployment for $ENVIRONMENT requires manual action"
        print_warning "Run: npm run android (or npm run ios) for local testing"
    fi
else
    print_warning "Skipping frontend deployment"
fi

# Final summary
echo ""
print_step "Deployment Summary:"
echo "  ✓ Environment: $ENVIRONMENT"
if [ "$SKIP_MIGRATION" != "true" ]; then
    echo "  ✓ Database migration: COMPLETED"
else
    echo "  ⊘ Database migration: SKIPPED"
fi
if [ "$SKIP_BACKEND" != "true" ]; then
    echo "  ✓ Backend deployment: COMPLETED"
else
    echo "  ⊘ Backend deployment: SKIPPED"
fi
if [ "$SKIP_FRONTEND" != "true" ]; then
    echo "  ⊘ Frontend deployment: MANUAL ACTION REQUIRED"
else
    echo "  ⊘ Frontend deployment: SKIPPED"
fi
echo ""

print_success "Deployment completed successfully!"
echo ""
print_warning "Next Steps:"
echo "  1. Verify API endpoints are working correctly"
echo "  2. Test frontend features in development mode"
echo "  3. Run through the testing checklist in DEPLOYMENT_CHECKLIST.md"
echo "  4. Monitor for errors in production"
echo ""
