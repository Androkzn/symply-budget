# Building Lambda Package for Linux

The Lambda function requires Linux-compatible dependencies (especially `pydantic_core`). Since you're building on macOS, you need to use one of these methods:

## Option 1: Use Docker (Recommended)

If you have Docker installed:

```bash
cd lambda-processor
chmod +x build-lambda-docker.sh
./build-lambda-docker.sh
```

This will build the package in a Linux container, ensuring all native extensions are compatible.

## Option 2: Use AWS SAM CLI

```bash
# Install SAM CLI first
brew install aws-sam-cli  # or download from AWS

# Build
sam build --use-container
```

## Option 3: Build on a Linux Machine/EC2

1. SSH into a Linux machine (or EC2 instance)
2. Install Python 3.11 and pip
3. Run:
   ```bash
   cd lambda-processor
   rm -rf package && mkdir -p package
   pip3 install --target package/ -r requirements.txt
   cp handler.py package/
   cd package && zip -r ../lambda-function.zip . && cd ..
   ```

## Option 4: Use GitHub Actions or CI/CD

Set up a CI/CD pipeline that builds the package in a Linux environment.

## Current Issue

The `pydantic_core` package contains native extensions (`.so` files) that must be compiled for Linux. When building on macOS, you get macOS binaries which don't work on Lambda.

## Quick Fix (Temporary)

If you need a quick workaround, you can try using an older version of `anthropic` that doesn't require `pydantic`:

```bash
# In requirements.txt, temporarily use:
anthropic==0.3.4
```

But this will limit functionality. The proper solution is to build in a Linux environment.
