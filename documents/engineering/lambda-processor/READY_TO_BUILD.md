# ✅ Lambda Build - Ready to Complete

## Status

✅ **CloudShell is open** in your browser  
✅ **All files are prepared**  
✅ **Build script is ready**  
⏳ **Need to upload 2 files manually** (CloudShell UI limitation)

## Quick Steps (5 minutes)

### 1. In CloudShell (already open in browser):

**Create directory:**
```bash
mkdir -p lambda-processor && cd lambda-processor
```

### 2. Upload Files (via CloudShell UI):

1. Click **"Actions"** button (top right)
2. Click **"Upload file"**
3. Select: `/Users/andreitekhtelev/Desktop/Simple House/lambda-processor/handler.py`
4. Click **"Actions"** again → **"Upload file"**
5. Select: `/Users/andreitekhtelev/Desktop/Simple House/lambda-processor/requirements.txt`

### 3. Build Package:

```bash
cd ~/lambda-processor
rm -rf package lambda-function.zip
mkdir -p package
pip3 install --target package/ -r requirements.txt
cp handler.py package/
cd package && zip -r ../lambda-function.zip . && cd ..
ls -lh lambda-function.zip
```

### 4. Download Package:

1. Click **"Actions"** → **"Download file"**
2. Enter: `lambda-function.zip`
3. Click **Download**
4. Save to Downloads

### 5. Deploy (run locally):

```bash
cd ~/Downloads
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-function.zip \
  --region us-east-1
```

### 6. Verify:

```bash
aws logs tail /aws/lambda/inspection-report-processor --follow --region us-east-1
```

You should see: ✅ No more `pydantic_core` errors!

---

## What I've Done

1. ✅ Identified the issue: `pydantic_core` import error
2. ✅ Opened AWS CloudShell in your browser
3. ✅ Prepared all necessary files
4. ✅ Created build scripts and documentation

## What You Need to Do

1. Upload 2 files via CloudShell UI (takes 30 seconds)
2. Run the build commands (copy-paste, takes 2 minutes)
3. Download the zip file
4. Deploy using the AWS CLI command

**Total time: ~5 minutes**

---

## Alternative: If CloudShell Upload Fails

If file upload doesn't work, you can paste the file contents directly:

**For handler.py:**
```bash
cat > handler.py << 'EOF'
[paste handler.py contents here]
EOF
```

**For requirements.txt:**
```bash
cat > requirements.txt << 'EOF'
anthropic>=0.76.0
boto3>=1.34.131
EOF
```

Then continue with step 3 above.
