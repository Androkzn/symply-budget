.PHONY: build deploy build-deploy clean test

# Configuration
FUNCTION_NAME = inspection-report-processor
REGION = us-east-1
PACKAGE_NAME = lambda-function.zip

# Build Lambda package locally (requires Docker)
build-docker:
	@echo "Building Lambda package with Docker..."
	@./build-lambda-docker.sh
	@echo "✅ Package built: $(PACKAGE_NAME)"

# Build Lambda package using CloudShell (manual)
build-cloudshell:
	@echo "📋 Instructions for CloudShell build:"
	@echo "1. Open: https://console.aws.amazon.com/cloudshell/"
	@echo "2. Run: mkdir -p lambda-processor && cd lambda-processor"
	@echo "3. Upload handler.py and requirements.txt"
	@echo "4. Run: pip3 install --target package/ -r requirements.txt"
	@echo "5. Run: cp handler.py package/ && cd package && zip -r ../lambda-function.zip ."
	@echo "6. Download lambda-function.zip"

# Deploy existing package
deploy:
	@if [ ! -f $(PACKAGE_NAME) ]; then \
		echo "❌ $(PACKAGE_NAME) not found. Run 'make build' first."; \
		exit 1; \
	fi
	@echo "Deploying to Lambda..."
	@aws lambda update-function-code \
		--function-name $(FUNCTION_NAME) \
		--zip-file fileb://$(PACKAGE_NAME) \
		--region $(REGION)
	@echo "✅ Deployment complete!"

# Build and deploy in one step (automated)
build-deploy: build-docker deploy
	@echo "✅ Build and deployment complete!"

# Automated build using EC2 + SSM
build-automated:
	@echo "Building using automated EC2 method..."
	@chmod +x automated-build.sh
	@./automated-build.sh

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf package $(PACKAGE_NAME) venv __pycache__ *.pyc
	@echo "✅ Clean complete!"

# Test Lambda function
test:
	@echo "Testing Lambda function..."
	@aws lambda invoke \
		--function-name $(FUNCTION_NAME) \
		--payload '{"jobId":"test-123","reportId":"test-456","householdId":"test-789","pdfS3Bucket":"test","pdfS3Key":"test.pdf"}' \
		--region $(REGION) \
		response.json
	@cat response.json | jq .
	@rm -f response.json

# Check Lambda logs
logs:
	@aws logs tail /aws/lambda/$(FUNCTION_NAME) --follow --region $(REGION)

# Check Lambda status
status:
	@aws lambda get-function \
		--function-name $(FUNCTION_NAME) \
		--region $(REGION) \
		--query 'Configuration.[LastUpdateStatus,State,Runtime,MemorySize,Timeout]' \
		--output table

# Help
help:
	@echo "Lambda Build & Deploy Makefile"
	@echo ""
	@echo "Available targets:"
	@echo "  make build-docker      - Build package using Docker (requires Docker)"
	@echo "  make build-cloudshell  - Show instructions for CloudShell build"
	@echo "  make build-automated  - Build using EC2 + SSM (fully automated)"
	@echo "  make deploy           - Deploy existing package to Lambda"
	@echo "  make build-deploy     - Build and deploy in one step"
	@echo "  make test             - Test Lambda function with sample event"
	@echo "  make logs             - Tail Lambda logs"
	@echo "  make status           - Check Lambda function status"
	@echo "  make clean            - Clean build artifacts"
	@echo "  make help             - Show this help message"
