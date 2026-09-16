#!/bin/bash

# Recipe Migration Script
# This script applies the recipe/meal/water tracking migration

echo "🚀 Applying Recipe Migration..."

# Check if wrangler is available
if ! command -v wrangler &> /dev/null; then
    echo "❌ Error: wrangler is not installed"
    echo "Please install with: npm install -g wrangler"
    exit 1
fi

# Apply migration to local database
echo "📦 Applying to local database..."
wrangler d1 execute simple-house-db --local --file=./migrations/0004_recipe_meal_water_tracking.sql

if [ $? -eq 0 ]; then
    echo "✅ Local migration applied successfully!"
else
    echo "❌ Local migration failed. Check Node.js version (requires v20+)"
    echo "Current Node version: $(node --version)"
    exit 1
fi

# Optionally apply to remote
read -p "Apply to remote database? (y/N): " apply_remote

if [[ $apply_remote =~ ^[Yy]$ ]]; then
    echo "📦 Applying to remote database..."
    wrangler d1 execute simple-house-db --remote --file=./migrations/0004_recipe_meal_water_tracking.sql

    if [ $? -eq 0 ]; then
        echo "✅ Remote migration applied successfully!"
    else
        echo "❌ Remote migration failed"
        exit 1
    fi
else
    echo "ℹ️  Skipped remote migration"
fi

echo ""
echo "✅ Recipe flow migration complete!"
echo ""
echo "Next steps:"
echo "1. Start the dev server: npm run dev"
echo "2. Test the API endpoint: POST /households/:id/recipes/chat"
echo "3. See RECIPE_FLOW_GUIDE.md for usage examples"
