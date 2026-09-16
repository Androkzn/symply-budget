# Automated CloudShell Build - Complete Steps

I've opened AWS CloudShell for you. Here are the exact steps to complete the build:

## Step 1: Prepare Directory (Already in CloudShell)

In the CloudShell terminal, run:
```bash
mkdir -p lambda-processor
cd lambda-processor
```

## Step 2: Upload Files

1. Click the **"Actions"** button (top right of CloudShell)
2. Select **"Upload file"**
3. Upload `handler.py` from: `/Users/andreitekhtelev/Desktop/Simple House/lambda-processor/handler.py`
4. Click **"Actions"** again → **"Upload file"**
5. Upload `requirements.txt` from: `/Users/andreitekhtelev/Desktop/Simple House/lambda-processor/requirements.txt`

## Step 3: Build Package

In CloudShell terminal, run:
```bash
cd ~/lambda-processor
rm -rf package lambda-function.zip
mkdir -p package
pip3 install --target package/ -r requirements.txt
cp handler.py package/
cd package && zip -r ../lambda-function.zip . && cd ..
ls -lh lambda-function.zip
```

## Step 4: Download Package

1. Click **"Actions"** → **"Download file"**
2. Enter: `lambda-function.zip`
3. Click **Download**
4. Save it to your Downloads folder

## Step 5: Deploy to Lambda

Run this command locally (in your terminal):
```bash
cd ~/Downloads
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-function.zip \
  --region us-east-1
```

## Step 6: Verify

Check the logs to confirm it's working:
```bash
aws logs tail /aws/lambda/inspection-report-processor --follow --region us-east-1
```

You should see the handler importing successfully without the `pydantic_core` error!
