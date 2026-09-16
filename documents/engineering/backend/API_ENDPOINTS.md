# Simple House API Endpoints Documentation

**Base URL (Production):** `https://simple-house-api.a-tekhtelev.workers.dev`

**Environment:** Production
**Database:** Cloudflare D1 (simple-house-db)
**Storage:** Cloudflare R2 (simple-house-reports)
**Last Updated:** 2026-01-20

## Status: ✅ All Services Online

---

## Authentication

All authenticated endpoints require a Bearer token in the Authorization header:
```
Authorization: Bearer <access_token>
```

---

## 1. Health & Info

### GET /health
Check API health status.

**Response:**
```json
{
  "status": "ok"
}
```

### GET /
Get API information and version.

**Response:**
```json
{
  "name": "Simple House API",
  "version": "1.0.0",
  "status": "healthy",
  "environment": "production"
}
```

---

## 2. Authentication Endpoints

### POST /auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "Test123!@#",
  "display_name": "John Doe"
}
```

**Password Requirements:**
- Minimum 8 characters
- At least one number
- At least one special character

**Response (201):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "email_verified": false,
    "display_name": "John Doe",
    "avatar_url": null,
    "has_password": true,
    "has_apple": false,
    "has_google": false,
    "created_at": "2026-01-20T10:00:00.000Z",
    "updated_at": "2026-01-20T10:00:00.000Z"
  },
  "access_token": "eyJhbGc...",
  "refresh_token": "abc123...",
  "expires_in": 900
}
```

**Rate Limit:** 3 requests per hour

---

### POST /auth/login
Login with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "Test123!@#"
}
```

**Response (200):**
```json
{
  "user": { /* User object */ },
  "access_token": "eyJhbGc...",
  "refresh_token": "abc123...",
  "expires_in": 900
}
```

**Error (401):**
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Invalid email or password"
  }
}
```

**Rate Limit:** 5 requests per 15 minutes

---

### POST /auth/refresh
Refresh access token using refresh token.

**Request Body:**
```json
{
  "refresh_token": "abc123..."
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "def456...",
  "expires_in": 900
}
```

---

### POST /auth/logout
Revoke refresh token (logout).

**Request Body:**
```json
{
  "refresh_token": "abc123..."
}
```

**Response (204):** No content

---

### POST /auth/forgot-password
Request password reset email.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "message": "If an account exists with this email, a password reset link has been sent."
}
```

**Rate Limit:** 3 requests per hour

---

### POST /auth/reset-password
Reset password using token from email.

**Request Body:**
```json
{
  "token": "reset_token_from_email",
  "password": "NewPassword123!@#"
}
```

**Response (200):**
```json
{
  "message": "Password has been reset successfully"
}
```

---

### POST /auth/verify-email
Verify email address using token.

**Request Body:**
```json
{
  "token": "verification_token_from_email"
}
```

**Response (200):**
```json
{
  "message": "Email verified successfully"
}
```

---

### POST /auth/resend-verification
Resend email verification (requires authentication).

**Response (200):**
```json
{
  "message": "Verification email sent"
}
```

---

### POST /auth/change-password
Change password (requires authentication).

**Request Body:**
```json
{
  "current_password": "OldPassword123!@#",
  "new_password": "NewPassword123!@#"
}
```

**Response (200):**
```json
{
  "message": "Password changed successfully"
}
```

---

### DELETE /auth/account
Delete user account (requires authentication).

**Response (200):**
```json
{
  "message": "Account deleted successfully"
}
```

---

## 3. User Management

### GET /users/me
Get current authenticated user profile.

**Auth:** Required

**Response (200):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "email_verified": true,
  "display_name": "John Doe",
  "avatar_url": "https://...",
  "has_password": true,
  "has_apple": false,
  "has_google": false,
  "created_at": "2026-01-20T10:00:00.000Z",
  "updated_at": "2026-01-20T10:00:00.000Z"
}
```

---

### PATCH /users/me
Update current user profile.

**Auth:** Required

**Request Body:**
```json
{
  "display_name": "Jane Doe",
  "avatar_url": "https://..."
}
```

**Response (200):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  /* ... updated user fields */
}
```

---

### GET /users/:userId
Get user by ID.

**Auth:** Required

**Response (200):** User object

---

## 4. Household Management

### GET /households
List all households for current user.

**Auth:** Required

**Response (200):**
```json
[
  {
    "id": "uuid",
    "name": "My Home",
    "address": "123 Main St",
    "city": "San Francisco",
    "state": "CA",
    "zip_code": "94102",
    "country": "USA",
    "created_at": "2026-01-20T10:00:00.000Z",
    "updated_at": "2026-01-20T10:00:00.000Z"
  }
]
```

---

### POST /households
Create a new household.

**Auth:** Required

**Request Body:**
```json
{
  "name": "My Home",
  "address": "123 Main St",
  "city": "San Francisco",
  "state": "CA",
  "zip_code": "94102",
  "country": "USA"
}
```

**Response (201):** Household object

---

### GET /households/:householdId
Get household details.

**Auth:** Required

**Response (200):** Household object

---

### PATCH /households/:householdId
Update household details.

**Auth:** Required (must be owner or admin)

**Request Body:**
```json
{
  "name": "Updated Home Name"
}
```

**Response (200):** Updated household object

---

### DELETE /households/:householdId
Delete household.

**Auth:** Required (must be owner)

**Response (204):** No content

---

### GET /households/:householdId/members
Get all members of a household.

**Auth:** Required

**Response (200):**
```json
[
  {
    "id": "uuid",
    "household_id": "uuid",
    "user_id": "uuid",
    "role": "owner",
    "joined_at": "2026-01-20T10:00:00.000Z",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "John Doe",
      "avatar_url": null
    }
  }
]
```

---

### PATCH /households/:householdId/members/:userId
Update member role.

**Auth:** Required (must be owner or admin)

**Request Body:**
```json
{
  "role": "admin"
}
```

**Response (200):** Updated member object

---

### DELETE /households/:householdId/members/:userId
Remove member from household.

**Auth:** Required (must be owner or admin)

**Response (204):** No content

---

## 5. Invitations

### GET /invitations
List invitations (sent or received).

**Auth:** Required

**Query Parameters:**
- `household_id` (optional): Filter by household

**Response (200):**
```json
[
  {
    "id": "uuid",
    "household_id": "uuid",
    "email": "invited@example.com",
    "role": "member",
    "status": "pending",
    "invited_by": "uuid",
    "created_at": "2026-01-20T10:00:00.000Z",
    "expires_at": "2026-01-27T10:00:00.000Z"
  }
]
```

---

### POST /invitations
Create a new invitation.

**Auth:** Required (must be owner or admin)

**Request Body:**
```json
{
  "household_id": "uuid",
  "email": "invited@example.com",
  "role": "member"
}
```

**Response (201):** Invitation object

---

### POST /invitations/:invitationId/accept
Accept an invitation.

**Auth:** Required

**Response (200):**
```json
{
  "message": "Invitation accepted",
  "household": { /* household object */ }
}
```

---

### POST /invitations/:invitationId/decline
Decline an invitation.

**Auth:** Required

**Response (200):**
```json
{
  "message": "Invitation declined"
}
```

---

### DELETE /invitations/:invitationId
Cancel/revoke an invitation.

**Auth:** Required (must be sender or admin)

**Response (204):** No content

---

## 6. Reports

### GET /households/:householdId/reports
List all reports for a household.

**Auth:** Required

**Response (200):**
```json
[
  {
    "id": "uuid",
    "household_id": "uuid",
    "uploaded_by": "uuid",
    "status": "completed",
    "file_key": "reports/...",
    "file_size": 1024000,
    "uploaded_at": "2026-01-20T10:00:00.000Z",
    "processed_at": "2026-01-20T10:05:00.000Z"
  }
]
```

---

### POST /households/:householdId/reports/upload
Upload a new report (PDF).

**Auth:** Required

**Content-Type:** multipart/form-data

**Form Data:**
- `file`: PDF file

**Response (201):**
```json
{
  "id": "uuid",
  "household_id": "uuid",
  "status": "processing",
  "file_key": "reports/...",
  "uploaded_at": "2026-01-20T10:00:00.000Z"
}
```

**Rate Limit:** 10 uploads per hour

---

### GET /households/:householdId/reports/:reportId
Get report details.

**Auth:** Required

**Response (200):** Report object with extracted data

---

### DELETE /households/:householdId/reports/:reportId
Delete a report.

**Auth:** Required (must be uploader or admin)

**Response (204):** No content

---

## 7. Action Items

### GET /households/:householdId/action-items
List action items for a household.

**Auth:** Required

**Query Parameters:**
- `status` (optional): Filter by status (pending, in_progress, completed)
- `priority` (optional): Filter by priority (low, medium, high, critical)
- `category` (optional): Filter by category

**Response (200):**
```json
[
  {
    "id": "uuid",
    "household_id": "uuid",
    "title": "Fix Leaky Faucet",
    "description": "Kitchen sink is dripping",
    "status": "pending",
    "priority": "high",
    "category": "plumbing",
    "assigned_to": "uuid",
    "due_date": "2026-02-01",
    "created_at": "2026-01-20T10:00:00.000Z",
    "updated_at": "2026-01-20T10:00:00.000Z"
  }
]
```

---

### POST /households/:householdId/action-items
Create a new action item.

**Auth:** Required

**Request Body:**
```json
{
  "title": "Fix Leaky Faucet",
  "description": "Kitchen sink is dripping",
  "priority": "high",
  "category": "plumbing",
  "assigned_to": "uuid",
  "due_date": "2026-02-01"
}
```

**Response (201):** Action item object

---

### GET /households/:householdId/action-items/:actionItemId
Get action item details.

**Auth:** Required

**Response (200):** Action item object

---

### PATCH /households/:householdId/action-items/:actionItemId
Update action item.

**Auth:** Required

**Request Body:**
```json
{
  "status": "in_progress",
  "assigned_to": "uuid"
}
```

**Response (200):** Updated action item object

---

### DELETE /households/:householdId/action-items/:actionItemId
Delete action item.

**Auth:** Required

**Response (204):** No content

---

## 8. Maintenance Tasks

### GET /households/:householdId/maintenance-tasks
List maintenance tasks.

**Auth:** Required

**Response (200):**
```json
[
  {
    "id": "uuid",
    "household_id": "uuid",
    "title": "HVAC Filter Replacement",
    "description": "Replace air filter quarterly",
    "schedule_type": "quarterly",
    "next_due_date": "2026-04-01",
    "last_completed": "2026-01-01",
    "created_at": "2026-01-20T10:00:00.000Z"
  }
]
```

---

### POST /households/:householdId/maintenance-tasks
Create maintenance task.

**Auth:** Required

**Request Body:**
```json
{
  "title": "HVAC Filter Replacement",
  "description": "Replace air filter quarterly",
  "schedule_type": "quarterly",
  "next_due_date": "2026-04-01"
}
```

**Schedule Types:** `monthly`, `quarterly`, `biannual`, `yearly`, `custom`

**Response (201):** Maintenance task object

---

### GET /households/:householdId/maintenance-tasks/:taskId
Get maintenance task details.

**Auth:** Required

**Response (200):** Maintenance task object

---

### PATCH /households/:householdId/maintenance-tasks/:taskId
Update maintenance task.

**Auth:** Required

**Response (200):** Updated task object

---

### POST /households/:householdId/maintenance-tasks/:taskId/complete
Mark task as completed.

**Auth:** Required

**Request Body:**
```json
{
  "completed_by": "uuid",
  "completion_notes": "Replaced with MERV 13 filter"
}
```

**Response (200):**
```json
{
  "message": "Task marked as completed",
  "next_due_date": "2026-07-01"
}
```

---

### DELETE /households/:householdId/maintenance-tasks/:taskId
Delete maintenance task.

**Auth:** Required

**Response (204):** No content

---

## 9. Notifications

### GET /notifications
Get user notifications.

**Auth:** Required

**Query Parameters:**
- `unread_only` (optional): boolean

**Response (200):**
```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "type": "action_item_assigned",
    "title": "New task assigned",
    "message": "You've been assigned a new task",
    "read": false,
    "created_at": "2026-01-20T10:00:00.000Z"
  }
]
```

---

### PATCH /notifications/:notificationId/read
Mark notification as read.

**Auth:** Required

**Response (200):** Updated notification

---

### POST /notifications/read-all
Mark all notifications as read.

**Auth:** Required

**Response (200):**
```json
{
  "message": "All notifications marked as read"
}
```

---

## 10. Jobs

### GET /jobs
List processing jobs for user's households.

**Auth:** Required

**Response (200):**
```json
[
  {
    "id": "uuid",
    "household_id": "uuid",
    "type": "pdf_processing",
    "status": "processing",
    "progress": 50,
    "created_at": "2026-01-20T10:00:00.000Z",
    "updated_at": "2026-01-20T10:01:00.000Z"
  }
]
```

---

### GET /jobs/:jobId
Get job status.

**Auth:** Required

**Response (200):** Job object with detailed status

---

## Error Responses

All endpoints may return these error formats:

### 400 Bad Request
```json
{
  "error": {
    "code": "validation_error",
    "message": "Validation failed",
    "details": {
      "email": ["Invalid email format"],
      "password": ["Password must be at least 8 characters"]
    }
  }
}
```

### 401 Unauthorized
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Invalid or expired token"
  }
}
```

### 403 Forbidden
```json
{
  "error": {
    "code": "forbidden",
    "message": "You don't have permission to perform this action"
  }
}
```

### 404 Not Found
```json
{
  "error": {
    "code": "not_found",
    "message": "Resource not found"
  }
}
```

### 409 Conflict
```json
{
  "error": {
    "code": "conflict",
    "message": "Resource already exists"
  }
}
```

### 429 Rate Limited
```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests. Please try again later.",
    "details": {
      "retry_after": ["3600"]
    }
  }
}
```

### 500 Internal Server Error
```json
{
  "error": {
    "code": "internal_error",
    "message": "An unexpected error occurred"
  }
}
```

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| POST /auth/register | 3 per hour |
| POST /auth/login | 5 per 15 minutes |
| POST /auth/forgot-password | 3 per hour |
| POST /auth/verify-email | 10 per hour |
| POST /households/:id/reports/upload | 10 per hour |
| General API | 100 per minute |

Rate limit headers are included in responses:
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Unix timestamp when limit resets
- `Retry-After`: Seconds until you can retry (when rate limited)

---

## Testing

A comprehensive test script is available at:
```bash
./backend/test-endpoints.sh
```

This script tests all endpoints and validates responses.

---

## Support

For issues or questions, open an issue at:
https://github.com/anthropics/symply-house/issues
