# Google Places API Setup

## Overview
The address autocomplete feature uses Google Places API to provide intelligent address suggestions when creating a new household. This is a free service with generous limits.

## Free Tier Details
- **$200 free credit per month** from Google Cloud
- Address autocomplete costs **$2.83 per 1,000 requests**
- This gives you approximately **70,000 free requests per month**
- More than enough for personal use and small-scale applications

## Setup Instructions

### 1. Get Your API Key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Places API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Places API"
   - Click "Enable"
4. Create credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "API Key"
   - Copy your new API key

### 2. Secure Your API Key (Recommended)

1. Click on your API key in the credentials list
2. Under "Application restrictions":
   - Select "iOS apps"
   - Add your bundle identifier: `fox-family.simple-house`
3. Under "API restrictions":
   - Select "Restrict key"
   - Choose "Places API"
4. Save changes

### 3. Add to Your App

1. Open `src/config/env.ts`
2. Find the line: `GOOGLE_PLACES_API_KEY: '',`
3. Paste your API key between the quotes:
   ```typescript
   GOOGLE_PLACES_API_KEY: 'your-api-key-here',
   ```
4. Save the file

### 4. Restart Your App

After adding the API key, restart your development server:
```bash
# Stop the current server (Ctrl+C)
# Then restart
npx expo start
```

## Features

Once configured, the address autocomplete will:
- Show suggestions as you type the street address
- Auto-fill city, state/province, and postal code
- Support both US and Canadian addresses
- Work offline with manual entry if needed

## Troubleshooting

**Autocomplete not working?**
- Verify your API key is correctly pasted in `src/config/env.ts`
- Check that Places API is enabled in Google Cloud Console
- Ensure your API key restrictions allow iOS apps
- Check the console for error messages

**Getting billing errors?**
- You need to enable billing in Google Cloud Console (required even for free tier)
- You won't be charged unless you exceed $200/month in usage
- Set up billing alerts if concerned about costs

## Cost Monitoring

To monitor your usage:
1. Go to Google Cloud Console
2. Navigate to "Billing" > "Reports"
3. Filter by "Places API"
4. Set up budget alerts (recommended: alert at $50, $100, $150)

## Alternative: Manual Entry

If you prefer not to use Google Places API, you can still manually enter addresses. The autocomplete field will work as a regular text input without an API key.
