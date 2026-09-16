# Simple Upload Guide for CloudShell

## Step 1: In CloudShell (already open)

**First, create the directory:**
```bash
mkdir -p lambda-processor && cd lambda-processor
```

## Step 2: Upload Files via CloudShell UI

**Upload handler.py:**
1. Click the **"Actions"** button (top right, blue button with dropdown arrow)
2. Click **"Upload file"** from the dropdown menu
3. In the file picker, navigate to:
   ```
   /Users/andreitekhtelev/Desktop/Simple House/lambda-processor/handler.py
   ```
4. Select `handler.py` and click **"Open"** or **"Upload"**
5. Wait for upload to complete (you'll see a confirmation)

**Upload requirements.txt:**
1. Click **"Actions"** button again
2. Click **"Upload file"**
3. Navigate to:
   ```
   /Users/andreitekhtelev/Desktop/Simple House/lambda-processor/requirements.txt
   ```
4. Select `requirements.txt` and click **"Open"**
5. Wait for upload to complete

**Verify files are uploaded:**
```bash
ls -la
```
You should see both `handler.py` and `requirements.txt`

## Step 3: Build the Package

**Copy and paste this entire block:**
```bash
cd ~/lambda-processor
rm -rf package lambda-function.zip
mkdir -p package
pip3 install --target package/ -r requirements.txt
cp handler.py package/
cd package && zip -r ../lambda-function.zip . && cd ..
ls -lh lambda-function.zip
```

**Wait 1-2 minutes for the build to complete**

## Step 4: Download the Package

1. Click **"Actions"** button
2. Click **"Download file"**
3. Enter: `lambda-function.zip`
4. Click **"Download"**
5. Save it to your Downloads folder

## Step 5: Deploy to Lambda

**In your local terminal (not CloudShell), run:**
```bash
cd ~/Downloads
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-function.zip \
  --region us-east-1
```

## Step 6: Verify It Works

```bash
aws logs tail /aws/lambda/inspection-report-processor --follow --region us-east-1
```

**You should see:** ✅ No more `pydantic_core` errors!

---

## Quick Checklist

- [ ] CloudShell is open (✅ already done)
- [ ] Created `lambda-processor` directory
- [ ] Uploaded `handler.py` via Actions → Upload file
- [ ] Uploaded `requirements.txt` via Actions → Upload file
- [ ] Ran build commands
- [ ] Downloaded `lambda-function.zip`
- [ ] Deployed using AWS CLI
- [ ] Verified logs show no errors

**Total time: ~5 minutes**
