# 🚀 Visit Checklist Feature - Production Deployment Checklist

## ✅ Pre-Deployment Verification

### 1. Code Quality Checks
- [x] All TypeScript types properly defined (no `any` types)
- [x] All TODO markers replaced with actual implementations
- [x] Photo upload functionality implemented
- [x] Voice recording functionality implemented
- [x] Deep linking configured
- [x] Navigation routes registered
- [x] Error handling implemented

### 2. Database Migration
- [x] Migration file created: `backend/migrations/0032_visit_checklist_enhancements.sql`
- [x] Migration numbered correctly (0032)
- [ ] Migration tested locally
- [ ] Migration reviewed for safety

### 3. Backend Verification
- [x] AI prompts created: `backend/src/ai/prompts/generate-visit-checklist.ts`
- [x] Schema files extended: `backend/src/db/schema-contractors.ts`, `backend/src/db/schema-labor-hub.ts`
- [x] Service layer implemented: `backend/src/services/visit-checklist-service.ts`
- [x] Routes registered in `backend/src/index.ts` (line 152)
- [x] Validation schemas with Zod

### 4. Frontend Verification
- [x] API clients complete: `src/api/visit-checklists.ts`, `src/api/contractors.ts`
- [x] Components created: ChecklistItemCard, AISuggestionSheet
- [x] Screens created: VisitChecklistScreen, ActiveVisitScreen, ContractorComparisonScreen
- [x] Services created: photo-upload.ts, voice-recording.ts
- [x] Navigation types updated
- [x] Deep linking configured

---

## 📦 Deployment Steps

### Step 1: Install Frontend Dependencies

```bash
# Install expo-image-picker for photo selection
npm install expo-image-picker

# Install expo-av for voice recording
npm install expo-av

# Install expo-file-system for file operations
npm install expo-file-system

# iOS: Install pods
cd ios && pod install && cd ..
```

### Step 2: Run Database Migrations

```bash
# Development environment
cd backend
npm run db:migrate

# Staging environment
npm run db:migrate:remote -- --env staging

# Production environment
npm run db:migrate:remote -- --env production
```

### Step 3: Deploy Backend

```bash
cd backend

# Deploy to staging first
npm run deploy:staging

# Verify staging deployment works correctly
# Test API endpoints manually or with Postman

# Deploy to production
npm run deploy:production
```

### Step 4: Build and Deploy Frontend

```bash
# Development build (for testing)
npm run android  # or npm run ios

# Production build
eas build --platform all --profile production

# Submit to app stores
eas submit --platform all
```

---

## 🧪 Testing Checklist

### Backend API Testing

1. **AI Question Generation**
   ```bash
   curl -X POST https://api.simplehouse.app/households/{householdId}/visit-checklists/{checklistId}/generate-ai-suggestions \
     -H "Authorization: Bearer {token}" \
     -H "Content-Type: application/json" \
     -d '{"task_category": "electrical", "task_title": "Replace circuit breaker"}'
   ```

2. **Photo Upload**
   - Test photo upload endpoint
   - Verify photos stored in R2
   - Verify thumbnails generated

3. **Voice Note Upload**
   - Test voice note upload endpoint
   - Verify audio files stored in R2
   - Verify transcription (if enabled)

4. **Multi-Contractor Comparison**
   - Test comparison endpoint
   - Verify data structure returned

### Frontend E2E Testing

1. **Checklist Creation Flow**
   - [ ] Create new checklist
   - [ ] Generate AI suggestions
   - [ ] Accept/dismiss suggestions
   - [ ] Add manual questions
   - [ ] Reorder questions (swipe functionality)

2. **Photo Attachment Flow**
   - [ ] Take photo with camera
   - [ ] Select photo from library
   - [ ] Upload photo to checklist item
   - [ ] View photo gallery
   - [ ] Delete photo

3. **Voice Recording Flow**
   - [ ] Start voice recording
   - [ ] Stop voice recording
   - [ ] Upload voice note
   - [ ] Play voice note
   - [ ] View transcription (if available)

4. **Active Visit Mode**
   - [ ] Start visit mode
   - [ ] Enter contractor rep name
   - [ ] Complete checklist items
   - [ ] Add notes to items
   - [ ] Add general visit notes
   - [ ] Complete visit
   - [ ] Verify data saved

5. **Multi-Contractor Comparison**
   - [ ] Navigate to comparison screen
   - [ ] Switch between contractors
   - [ ] View checklist progress
   - [ ] View key responses
   - [ ] View quotes
   - [ ] Navigate to full checklist

### Performance Testing

1. **AI Generation**
   - [ ] Test with different task categories
   - [ ] Verify response time < 5 seconds
   - [ ] Verify confidence scores make sense

2. **Photo Upload**
   - [ ] Small photos (< 1MB) upload in < 3 seconds
   - [ ] Large photos (5-10MB) upload in < 10 seconds
   - [ ] Progress indicator works correctly

3. **Voice Recording**
   - [ ] Recording starts immediately
   - [ ] Audio quality is acceptable
   - [ ] Upload completes successfully

---

## 🔍 Post-Deployment Verification

### 1. Database Verification

```sql
-- Verify new columns exist
SELECT * FROM contractor_visits LIMIT 1;
SELECT * FROM visit_checklists LIMIT 1;
SELECT * FROM checklist_items LIMIT 1;
SELECT * FROM checklist_item_photos LIMIT 1;
```

### 2. API Endpoint Verification

Test all new endpoints:
- `POST /households/:id/visit-checklists/:id/generate-ai-suggestions`
- `POST /households/:id/visit-checklists/:id/items/:id/accept`
- `POST /households/:id/visit-checklists/:id/items/:id/dismiss`
- `POST /households/:id/visit-checklists/:id/items/:id/photos`
- `GET /households/:id/visit-checklists/:id/items/:id/photos`
- `DELETE /households/:id/visit-checklists/:id/items/:id/photos/:id`
- `GET /households/:id/visit-checklists/for-task/:id`
- `GET /households/:id/visit-checklists/comparison/:id`
- `POST /households/:id/contractors/visits/:id/start`
- `POST /households/:id/contractors/visits/:id/complete`

### 3. Frontend Navigation Verification

Test deep links:
- `simplehouse://visit-checklists/{checklistId}`
- `simplehouse://active-visit/{visitId}/{checklistId}`
- `simplehouse://contractor-comparison/{taskId}`

---

## 🐛 Known Issues & Workarounds

### Issue 1: Voice Note Upload Endpoint
**Status**: Backend endpoint `/households/:id/voice-notes/upload` needs to be created
**Workaround**: Add endpoint to handle voice note uploads with transcription
**File**: `backend/src/routes/voice-notes.ts` (needs to be created)

### Issue 2: Photo Upload Endpoint
**Status**: Backend endpoint `/households/:id/images/upload` needs verification
**Workaround**: Verify endpoint exists or create it
**File**: Check `backend/src/routes/images.ts`

### Issue 3: Expo Dependencies
**Status**: Need to install expo-image-picker, expo-av, expo-file-system
**Impact**: Photo and voice features won't work without these
**Resolution**: Run `npm install` commands listed in Step 1

---

## 📊 Monitoring & Metrics

### Key Metrics to Monitor

1. **AI Generation Success Rate**
   - Target: > 95% successful generations
   - Alert if: < 90%

2. **Photo Upload Success Rate**
   - Target: > 98% successful uploads
   - Alert if: < 95%

3. **Voice Recording Quality**
   - Target: > 90% transcription accuracy
   - Alert if: < 80%

4. **API Response Times**
   - AI Generation: < 5 seconds
   - Photo Upload: < 10 seconds
   - Other endpoints: < 1 second

### Error Tracking

Monitor these error categories:
- AI generation failures
- Photo upload failures
- Voice recording failures
- Permission denied errors
- Network timeout errors

---

## 🔄 Rollback Plan

If issues are discovered post-deployment:

### 1. Backend Rollback

```bash
cd backend

# Rollback to previous deployment
wrangler rollback --env production

# Rollback database migration
# Create a down migration in migrations/0033_rollback_visit_checklist.sql
npm run db:migrate:remote -- --env production
```

### 2. Frontend Rollback

```bash
# Deploy previous build
eas submit --platform all --build-id {previous-build-id}
```

### 3. Database Rollback Migration

Create `backend/migrations/0033_rollback_visit_checklist.sql`:

```sql
-- Rollback visit checklist enhancements

-- Drop new table
DROP TABLE IF EXISTS checklist_item_photos;

-- Remove columns from checklist_items
ALTER TABLE checklist_items DROP COLUMN source;
ALTER TABLE checklist_items DROP COLUMN ai_confidence;
ALTER TABLE checklist_items DROP COLUMN suggested_at;
ALTER TABLE checklist_items DROP COLUMN accepted_at;
ALTER TABLE checklist_items DROP COLUMN dismissed_at;

-- Remove columns from visit_checklists
ALTER TABLE visit_checklists DROP COLUMN task_id;
ALTER TABLE visit_checklists DROP COLUMN source;
ALTER TABLE visit_checklists DROP COLUMN ai_generation_context;

-- Remove columns from contractor_visits
ALTER TABLE contractor_visits DROP COLUMN visit_mode_started_at;
ALTER TABLE contractor_visits DROP COLUMN visit_mode_ended_at;
ALTER TABLE contractor_visits DROP COLUMN contractor_rep_name;
ALTER TABLE contractor_visits DROP COLUMN task_id;
ALTER TABLE contractor_visits DROP COLUMN voice_recording_key;
ALTER TABLE contractor_visits DROP COLUMN voice_recording_transcription;
ALTER TABLE contractor_visits DROP COLUMN voice_recording_duration_seconds;
ALTER TABLE contractor_visits DROP COLUMN voice_recording_analysis;
```

---

## ✅ Sign-Off

- [ ] All tests passing
- [ ] Migration executed successfully on all environments
- [ ] Backend deployed to staging and verified
- [ ] Backend deployed to production and verified
- [ ] Frontend built and submitted to app stores
- [ ] Post-deployment verification complete
- [ ] Monitoring alerts configured
- [ ] Team trained on new features
- [ ] Documentation updated
- [ ] Stakeholders notified

**Deployed by**: _________________
**Date**: _________________
**Version**: 1.0.0 (Visit Checklist Feature)
