# Build Lambda Package Using AWS CloudShell

## Step 1: Open AWS CloudShell

1. Go to: **https://console.aws.amazon.com/cloudshell/**
2. Click the **CloudShell** icon in the top navigation bar (terminal icon)
3. Wait for CloudShell to initialize (takes ~30 seconds)

## Step 2: Prepare the Directory

In CloudShell, run:

```bash
mkdir -p lambda-processor
cd lambda-processor
```

## Step 3: Upload Files

**Upload `handler.py`:**

1. In CloudShell, click **Actions** → **Upload file**
2. Click **Select file** and choose: `lambda-processor/handler.py` from your local machine
3. Wait for upload to complete
4. Verify: `ls -la handler.py`

**Upload `requirements.txt`:**

1. Click **Actions** → **Upload file** again
2. Select: `lambda-processor/requirements.txt`
3. Wait for upload to complete
4. Verify: `ls -la requirements.txt`

## Step 4: Build the Lambda Package

Run these commands in CloudShell:

```bash
# Clean up any previous builds
rm -rf package lambda-function.zip

# Create package directory
mkdir -p package

# Install dependencies (this will take 1-2 minutes)
pip3 install --target package/ -r requirements.txt

# Copy handler
cp handler.py package/

# Create zip file
cd package
zip -r ../lambda-function.zip .
cd ..

# Verify the zip was created
ls -lh lambda-function.zip
```

**Expected output:**
- The zip file should be ~10-20 MB
- You should see: `lambda-function.zip` in the listing

## Step 5: Download the Package

1. In CloudShell, click **Actions** → **Download file**
2. Enter: `lambda-function.zip`
3. Click **Download**
4. Save it to your local machine (e.g., Desktop)

## Step 6: Deploy to Lambda

**Option A: Using AWS CLI (if you have it installed locally):**

```bash
cd ~/Desktop  # or wherever you saved the zip
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-function.zip \
  --region us-east-1
```

**Option B: Using AWS Console:**

1. Go to: **https://console.aws.amazon.com/lambda/**
2. Find function: **inspection-report-processor**
3. Click on the function name
4. Scroll to **Code source**
5. Click **Upload from** → **.zip file**
6. Select `lambda-function.zip` from your Downloads
7. Click **Save**

## Step 7: Verify Deployment

1. Go to Lambda function: **inspection-report-processor**
2. Check **Code** tab - you should see `handler.py` and dependencies
3. Check **Test** tab - create a test event to verify it works
4. Check **Monitor** tab - view CloudWatch logs

## Troubleshooting

**If pip3 is not found:**
```bash
# Use python3 -m pip instead
python3 -m pip install --target package/ -r requirements.txt
```

**If zip command is not found:**
```bash
# Install zip
sudo yum install zip -y  # Amazon Linux
# or
sudo apt-get install zip -y  # Ubuntu
```

**If upload fails:**
- Make sure file size is under 10MB (CloudShell limit)
- Try uploading one file at a time
- Check file names match exactly

## Next Steps

After deployment:
1. Test the Lambda function with a sample event
2. Check CloudWatch logs for any errors
3. Try uploading a report from your app to trigger the Lambda
