#!/bin/bash
# AWS CloudShell Build Commands
# Copy and paste these commands into CloudShell

# Step 1: Prepare directory
mkdir -p lambda-processor
cd lambda-processor

# Step 2: (Upload handler.py and requirements.txt via CloudShell UI first!)

# Step 3: Build package
rm -rf package lambda-function.zip
mkdir -p package

# Install dependencies
pip3 install --target package/ -r requirements.txt

# Copy handler
cp handler.py package/

# Create zip
cd package
zip -r ../lambda-function.zip .
cd ..

# Verify
ls -lh lambda-function.zip

# Step 4: (Download lambda-function.zip via CloudShell UI)

# Step 5: Deploy (run this locally after downloading)
# aws lambda update-function-code \
#   --function-name inspection-report-processor \
#   --zip-file fileb://lambda-function.zip \
#   --region us-east-1
