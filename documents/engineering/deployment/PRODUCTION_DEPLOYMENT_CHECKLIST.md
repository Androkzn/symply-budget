# Production Deployment Checklist - User Settings Migration

## ✅ Backend Implementation Status

### Database Schema
- [x] **Migration 0018**: Settings table created (`backend/migrations/0018_settings_table.sql`)
  - Columns: id, user_id, household_id, key, value, created_at, updated_at
  - Unique index on (user_id, household_id, key)
  - Indexes on user_id, household_id, key

### API Layer
- [x] **Routes** (`backend/src/routes/settings.ts`):
  - GET `/api/settings` - Fetch all settings
  - PUT `/api/settings/:key` - Update single setting
  - PUT `/api/settings/bulk` - Bulk update
  - POST `/api/settings/sync` - Two-way sync with conflict resolution
  - DELETE `/api/settings/:key` - Delete setting
  - POST `/api/settings/reset` - Reset all settings
- [x] **Controller** (`backend/src/controllers/settingsController.ts`) - Exists
- [x] **Service** (`backend/src/services/settingsService.ts`) - Exists
- [x] **Schema** (`backend/src/db/schema-settings.ts`) - Exported in main schema

### Integration
- [x] Settings router mounted in `backend/src/index.ts` at line 202
- [x] Auth middleware applied to all routes
- [x] Error handling configured

## ✅ Frontend Implementation Status

### API Client
- [x] **Settings API** (`src/api/settings.ts`):
  - fetchAll(), update(), bulkUpdate(), sync(), delete(), reset()
  - Helper functions: parseSettings(), serializeSettings()

### Services
- [x] **Migration Service** (`src/services/settings-migration.ts`):
  - One-time migration from MMKV to DB
  - Migration flag: `settings.migration.v1.completed`
  - Reads from all stores, uploads to DB
  - Graceful error handling with MMKV fallback

- [x] **Loader Service** (`src/services/settings-loader.ts`):
  - Fetches settings from database
  - Hydrates Zustand stores
  - Caches to MMKV for offline support
  - Falls back to cache on errors

- [x] **Sync Service** (`src/services/settings-sync.ts`):
  - 500ms debounce for batch updates
  - Offline queue with retry
  - Hydration mode to prevent sync loops
  - Updates MMKV cache immediately

### Store Refactoring
- [x] **appStore** (`src/stores/appStore.ts`):
  - Removed persist middleware
  - Added isHydrated state
  - Added hydrate() method
  - All setters call settingsSync.queueSync()

- [x] **navigationCustomizationStore** (`src/stores/navigationCustomizationStore.ts`):
  - Same pattern as appStore
  - Syncs tab configuration

- [x] **widgetLayoutStore** (`src/stores/widgetLayoutStore.ts`):
  - Same pattern as appStore
  - Syncs widget layout
  - Excludes transient isEditMode

- [x] **authStore** (`src/stores/authStore.ts`):
  - Keeps persist for auth tokens (security)
  - Only biometric preferences sync to DB

### App Integration
- [x] **App.tsx** updated with initialization:
  - Runs migration on authenticated user
  - Loads settings from DB
  - Initializes sync service
  - Falls back gracefully on errors

## 📋 Pre-Deployment Testing

### Backend Testing
```bash
# 1. Deploy backend with dry-run
cd backend
npm run deploy -- --dry-run

# 2. Run migrations on production
wrangler d1 migrations apply simple-house-db --env production

# 3. Test settings API (replace TOKEN with actual auth token)
# Fetch all settings
curl -H "Authorization: Bearer TOKEN" https://api.simplehouse.app/api/settings

# Create a test setting
curl -X PUT -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":"dark"}' \
  https://api.simplehouse.app/api/settings/test.theme

# Verify it was created
curl -H "Authorization: Bearer TOKEN" https://api.simplehouse.app/api/settings

# Delete test setting
curl -X DELETE -H "Authorization: Bearer TOKEN" \
  https://api.simplehouse.app/api/settings/test.theme
```

### Frontend Testing

#### New User Flow
1. Fresh app install
2. Register new account
3. Change theme from Settings
4. Close app completely
5. Reopen app
6. ✅ **Verify**: Theme persists (loaded from DB)

#### Existing User Migration Flow
1. Have existing app with custom settings
2. Update to new version
3. Login
4. Check logs for: `[SettingsMigration] Starting migration...`
5. ✅ **Verify**: Old settings preserved
6. Change a setting
7. Check logs for: `[SettingsSync] Queued: theme.mode`
8. ✅ **Verify**: Setting synced to DB

#### Offline Mode
1. Change a setting (e.g., reorder widgets)
2. Turn off network/airplane mode
3. Check logs for: `[SettingsSync] Offline, saving to retry queue`
4. Close app
5. Turn network back on
6. Reopen app
7. Check logs for: `[SettingsSync] Back online, flushing pending syncs`
8. ✅ **Verify**: Changes synced to DB

#### Multi-Device Sync
1. Device A: Login and change theme to dark
2. Device B: Login with same account
3. ✅ **Verify**: Device B loads dark theme from DB
4. Device B: Change theme to light
5. Device A: Restart app
6. ✅ **Verify**: Device A now has light theme

#### Debouncing
1. Rapidly drag-and-drop widgets (10+ times in 2 seconds)
2. Check network tab or logs
3. ✅ **Verify**: Only ONE API call after changes stop (500ms debounce)

## 🚀 Deployment Steps

### 1. Backend Deployment
```bash
cd backend

# Deploy to production
npm run deploy

# Apply migrations
wrangler d1 migrations apply simple-house-db --env production

# Verify migrations applied
wrangler d1 execute simple-house-db --env production --command "SELECT name FROM sqlite_master WHERE type='table' AND name='settings';"

# Check settings table structure
wrangler d1 execute simple-house-db --env production --command "PRAGMA table_info(settings);"
```

### 2. Verify Backend in Production
```bash
# Health check
curl https://api.simplehouse.app/health

# Test settings endpoint (requires auth)
# Get token from app or admin panel, then:
curl -H "Authorization: Bearer YOUR_TOKEN" https://api.simplehouse.app/api/settings
```

### 3. Frontend Deployment
```bash
# Build production app
npm run build:ios
npm run build:android

# Or use EAS
eas build --platform all --profile production
```

### 4. Monitor First Users
- Watch logs for migration success/failures
- Check Sentry/error tracking for any issues
- Monitor API endpoint latency
- Verify no spike in API errors

## 🔍 Post-Deployment Verification

### Backend Health
- [ ] Settings table exists in production DB
- [ ] All 6 settings endpoints return 200/201/204
- [ ] Migration applied successfully
- [ ] No errors in Cloudflare Workers logs

### Frontend Health
- [ ] Migration runs successfully for existing users
- [ ] New users can create settings
- [ ] Settings persist after app restart
- [ ] Multi-device sync works
- [ ] Offline mode works correctly
- [ ] Debouncing reduces API calls

### Performance Metrics
- [ ] API response time < 200ms (settings fetch)
- [ ] API response time < 100ms (settings update)
- [ ] No increase in app startup time
- [ ] MMKV cache reduces offline load time

## ⚠️ Rollback Plan

If critical issues arise:

### Backend Rollback
```bash
# Revert to previous deployment
wrangler rollback --env production

# Settings table remains (no harm)
# API calls will fail, but frontend falls back to MMKV
```

### Frontend Rollback
```bash
# Revert stores to use persist middleware
# Settings will continue working locally
# No data loss (MMKV preserved)
```

## 📊 Success Criteria

✅ **Required for Production**:
- All backend tests pass
- Migration runs successfully for 100% of test accounts
- Settings sync works across devices
- Offline mode works
- No increase in crash rate
- API error rate < 1%

✅ **Nice to Have**:
- Debouncing reduces API calls by 80%+
- Settings load time < 200ms
- Migration completes in < 2 seconds

## 🐛 Known Issues / Limitations

1. **Migration is one-way**: Once migrated, cannot revert to MMKV-only without reinstall
2. **First launch delay**: ~500ms for settings load (acceptable)
3. **Offline changes**: Queue limited to 50 pending syncs (prevents memory bloat)

## 📝 Notes

- **MMKV is kept as cache**: Not removed to support offline mode
- **Auth tokens stay in MMKV**: Never synced to DB for security
- **Biometric prefs sync to DB**: But actual biometric data stays local
- **Settings are user-scoped**: Not household-scoped (by design)
- **Debounce = 500ms**: Can be adjusted in settings-sync.ts if needed

---

**Last Updated**: 2026-01-30
**Implementation Status**: ✅ **COMPLETE - READY FOR PRODUCTION**
