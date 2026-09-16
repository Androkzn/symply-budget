# Lambda Deployment - Quick Reference

**All environments are now deployed and ready! 🚀**

## ✅ Current Status

| Environment | Function | Layer | Status |
|-------------|----------|-------|--------|
| **DEV** | inspection-report-processor-dev | v3 | ✅ Live |
| **STAGING** | inspection-report-processor-staging | v1 | ✅ Live |
| **PROD** | inspection-report-processor | v3 | ✅ Live |

## 🚀 Deploy Commands

```bash
# Fast code-only deployment (10 seconds)
./deploy-dev          # DEV
./deploy-staging      # STAGING
./deploy-prod         # PROD

# Full deployment with layer (2-3 minutes)
./deploy-dev-layer
./deploy-staging-layer
./deploy-prod-layer

# With automatic testing
./deploy-dev --test
./deploy-staging --test
./deploy-prod --test
```

## 📖 Documentation

- [README.md](../../backend/lambda-processor/README.md) - Main project readme
- [MULTI-ENVIRONMENT.md](MULTI-ENVIRONMENT.md) - Multi-environment guide
- [TESTING.md](TESTING.md) - Testing guide
- [SETUP-ENVIRONMENTS.md](SETUP-ENVIRONMENTS.md) - Environment setup
- [QUICK-START.md](QUICK-START.md) - Quick start guide

## 🔍 Monitoring

```bash
# View logs
aws logs tail /aws/lambda/inspection-report-processor-dev --follow
aws logs tail /aws/lambda/inspection-report-processor-staging --follow
aws logs tail /aws/lambda/inspection-report-processor --follow

# Check function status
aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `inspection-report`)].{Name:FunctionName,State:State}'
```

## 💡 Common Tasks

**Make code changes:**
```bash
vim handler.py
./deploy-dev --test
```

**Update dependencies:**
```bash
vim requirements-layer.txt
./deploy-dev-layer
```

**Promote DEV → STAGING → PROD:**
```bash
./deploy-dev --test
./deploy-staging --test
./deploy-prod --test
```

## 🆘 Troubleshooting

**Deployment fails:**
```bash
# Check CloudWatch logs
aws logs tail /aws/lambda/inspection-report-processor-dev --since 5m

# Rebuild layer if needed
./scripts/rebuild-layer-fix.sh --env=dev
```

**Need to recreate environments:**
```bash
./scripts/setup-all-environments.sh
```

---

**Last Updated:** 2026-01-28
**All Environments:** Deployed & Tested ✅
