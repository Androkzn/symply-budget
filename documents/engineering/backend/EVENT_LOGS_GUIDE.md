# Event Logs Guide

## What Event Logs Are Captured

With observability enabled (`enabled = true`, `head_sampling_rate = 1.0`), Cloudflare Workers automatically captures:

### 1. **Invocation Events**
- Every HTTP request/response
- Request method, URL, headers
- Response status codes
- Request/response timing
- IP addresses and geolocation

### 2. **Console Logs**
- All `console.log()`, `console.error()`, `console.warn()` statements
- Custom logging from your code

### 3. **Error Events**
- Uncaught exceptions
- Error stack traces
- Error messages and context

### 4. **Performance Events**
- Execution time (CPU time, wall time)
- Memory usage
- Request ID for tracing

### 5. **Custom Events**
- Any structured logging you add to your code
- Audit log entries (if you use the audit_log table)

## How to View Event Logs

### Option 1: Cloudflare Dashboard (Recommended)
1. Go to: https://dash.cloudflare.com
2. Navigate to: **Workers & Pages** → **simple-house-api** (or **simple-house-api-staging**)
3. Click on **Logs** tab
4. Filter by:
   - Time range
   - Status codes (200, 401, 500, etc.)
   - Search terms
   - Request IDs

### Option 2: Wrangler Tail (Real-time)
```bash
# Production logs
cd backend
wrangler tail --env production

# Staging logs
wrangler tail --env staging

# With formatting
wrangler tail --env production --format pretty

# Filter by status
wrangler tail --env production --status error
```

### Option 3: Query via API
You can also access logs programmatically via Cloudflare API (requires API token).

## Event Log Structure

Each event log includes:
```json
{
  "message": "PUT /households/.../reports/.../upload",
  "level": "info",
  "$workers": {
    "event": {
      "request": {
        "url": "https://...",
        "method": "PUT",
        "headers": {...},
        "cf": {
          "country": "CA",
          "city": "Vancouver",
          "colo": "YVR",
          ...
        }
      },
      "response": {
        "status": 200
      },
      "rayId": "...",
      "requestId": "...",
      "cpuTimeMs": 3,
      "wallTimeMs": 3
    }
  },
  "timestamp": "2026-01-23T03:19:53.962Z"
}
```

## Current Configuration

✅ **Observability is enabled for all environments:**
- Default (development)
- Staging
- Production

✅ **100% sampling rate** - All requests are logged (no sampling)

## Tips

1. **Search for specific events:**
   - Use request ID to trace a specific request through logs
   - Filter by status code to find errors
   - Search by endpoint path

2. **Monitor errors:**
   - Filter by `level: error` or `status: 500`
   - Check for authentication failures (401, 403)
   - Look for timeout errors

3. **Performance monitoring:**
   - Check `cpuTimeMs` and `wallTimeMs` for slow requests
   - Monitor memory usage
   - Track request volume

4. **Debug specific issues:**
   - Use `rayId` to find all logs for a specific request
   - Check console.log() output for debugging info
   - Review error stack traces

## Example: Finding Upload Errors

To find upload-related errors:
1. Go to Dashboard → Logs
2. Filter: `PUT /households/.../reports/.../upload`
3. Filter by status: `401` or `403` or `500`
4. Review the error details and stack traces

## Log Retention

- Logs are stored in Cloudflare's dashboard
- Retention period depends on your Cloudflare plan
- Free tier: Limited retention
- Paid tiers: Extended retention and export options
