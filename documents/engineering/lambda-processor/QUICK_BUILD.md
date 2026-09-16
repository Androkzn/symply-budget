# Quick Build Options for Lambda Package

## Option 1: Install Docker Desktop (Recommended)

1. **Download Docker Desktop for Mac:**
   - Visit: https://www.docker.com/products/docker-desktop/
   - Download and install Docker Desktop
   - Start Docker Desktop (wait for it to fully start)

2. **Run the build script:**
   ```bash
   cd lambda-processor
   ./build-lambda-docker.sh
   ```

3. **Deploy:**
   ```bash
   aws lambda update-function-code \
     --function-name inspection-report-processor \
     --zip-file fileb://lambda-function.zip \
     --region us-east-1
   ```

## Option 2: Use AWS CloudShell (No Installation Needed)

1. **Open AWS CloudShell:**
   - Go to: https://console.aws.amazon.com/cloudshell/
   - Click "CloudShell" in the top navigation

2. **Upload files:**
   ```bash
   # In CloudShell, create directory
   mkdir -p lambda-processor
   cd lambda-processor
   ```

3. **Upload files via CloudShell UI:**
   - Click Actions → Upload file
   - Upload: `handler.py`, `requirements.txt`

4. **Build:**
   ```bash
   rm -rf package && mkdir -p package
   pip3 install --target package/ -r requirements.txt
   cp handler.py package/
   cd package && zip -r ../lambda-function.zip . && cd ..
   ```

5. **Download and deploy:**
   - Download `lambda-function.zip` from CloudShell
   - Deploy using AWS CLI or console

## Option 3: Use EC2 Instance

1. Launch a Linux EC2 instance (t2.micro is fine)
2. SSH into it
3. Follow the same build steps as CloudShell
4. Download the zip file via SCP

## Current Status

- ❌ Docker not installed
- ✅ Build script ready (`build-lambda-docker.sh`)
- ✅ Handler code updated with correct model name
- ⏳ Waiting for Linux-compatible build

**Next Step:** Choose one of the options above to build the package.
