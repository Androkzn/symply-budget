/**
 * Test Script: AI Housekeeper API Endpoints
 * Tests all AI Housekeeper endpoints on production
 */


const API_BASE = 'https://simple-house-api.a-tekhtelev.workers.dev';

// IMPORTANT: Set your test JWT token here
// To get a token: Login to the app, open browser dev tools,
// check localStorage for 'authToken' or network requests for Authorization header
const TEST_JWT_TOKEN = process.env.TEST_JWT_TOKEN || '';
const TEST_HOUSEHOLD_ID = process.env.TEST_HOUSEHOLD_ID || '';

interface TestResult {
  endpoint: string;
  method: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  statusCode?: number;
  error?: string;
  response?: any;
}

const results: TestResult[] = [];

async function testEndpoint(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any,
  requiresAuth: boolean = true
): Promise<TestResult> {
  if (requiresAuth && !TEST_JWT_TOKEN) {
    return {
      endpoint,
      method,
      status: 'SKIP',
      error: 'No JWT token provided. Set TEST_JWT_TOKEN environment variable.',
    };
  }

  try {
    const url = `${API_BASE}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (TEST_JWT_TOKEN) {
      headers.Authorization = `Bearer ${TEST_JWT_TOKEN}`;
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }

    console.log(`Testing ${method} ${endpoint}...`);
    const response = await fetch(url, options);
    const data = await response.json();

    if (response.ok) {
      console.log(`✅ ${method} ${endpoint} - ${response.status}`);
      return {
        endpoint,
        method,
        status: 'PASS',
        statusCode: response.status,
        response: data,
      };
    } else {
      console.log(`❌ ${method} ${endpoint} - ${response.status}`);
      return {
        endpoint,
        method,
        status: 'FAIL',
        statusCode: response.status,
        error: JSON.stringify(data),
      };
    }
  } catch (error) {
    console.log(`❌ ${method} ${endpoint} - Error`);
    return {
      endpoint,
      method,
      status: 'FAIL',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runTests() {
  console.log('🧪 AI Housekeeper API Endpoint Tests\n');
  console.log(`API Base: ${API_BASE}`);
  console.log(`JWT Token: ${TEST_JWT_TOKEN ? '✅ Provided' : '❌ Missing'}`);
  console.log(`Household ID: ${TEST_HOUSEHOLD_ID || '❌ Missing'}\n`);

  // ============ HEALTH CHECK ============
  console.log('\n📊 Health Check:');
  results.push(await testEndpoint('/health', 'GET', undefined, false));

  // ============ PREFERENCES ============
  console.log('\n📊 Testing Preferences Endpoints:');

  // GET preferences
  const prefsResult = await testEndpoint('/api/ai-housekeeper/preferences', 'GET');
  results.push(prefsResult);

  // PUT preferences
  if (prefsResult.status === 'PASS') {
    results.push(
      await testEndpoint('/api/ai-housekeeper/preferences', 'PUT', {
        enabled: true,
        notification_frequency: 'daily',
        ai_personality: 'friendly',
      })
    );
  }

  // ============ SUGGESTIONS ============
  if (TEST_HOUSEHOLD_ID) {
    console.log('\n📊 Testing Suggestions Endpoints:');

    // GET suggestions
    const suggestionsResult = await testEndpoint(
      `/api/ai-housekeeper/households/${TEST_HOUSEHOLD_ID}/suggestions`,
      'GET'
    );
    results.push(suggestionsResult);

    // Test suggestion actions if we have suggestions
    if (suggestionsResult.status === 'PASS' && suggestionsResult.response?.length > 0) {
      const suggestionId = suggestionsResult.response[0].id;

      results.push(
        await testEndpoint(`/api/ai-housekeeper/suggestions/${suggestionId}/feedback`, 'POST', {
          feedback: 'helpful',
        })
      );
    }

    // ============ PREDICTIONS ============
    console.log('\n📊 Testing Predictions Endpoints:');
    results.push(
      await testEndpoint(`/api/ai-housekeeper/households/${TEST_HOUSEHOLD_ID}/predictions`, 'GET')
    );

    // ============ SEASONAL CHECKLISTS ============
    console.log('\n📊 Testing Seasonal Checklist Endpoints:');
    results.push(
      await testEndpoint(
        `/api/ai-housekeeper/households/${TEST_HOUSEHOLD_ID}/seasonal-checklist`,
        'GET'
      )
    );

    // ============ INSIGHTS ============
    console.log('\n📊 Testing Insights Endpoints:');
    results.push(
      await testEndpoint(`/api/ai-housekeeper/households/${TEST_HOUSEHOLD_ID}/insights`, 'GET')
    );

    // ============ ANALYZE ============
    console.log('\n📊 Testing Analysis Endpoint:');
    results.push(
      await testEndpoint(`/api/ai-housekeeper/households/${TEST_HOUSEHOLD_ID}/analyze`, 'POST')
    );
  } else {
    console.log('\n⚠️  Skipping household-specific endpoints (no TEST_HOUSEHOLD_ID provided)');
  }

  // ============ SUMMARY ============
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;

  console.log(`\n✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`📊 Total: ${results.length}`);

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results
      .filter((r) => r.status === 'FAIL')
      .forEach((r) => {
        console.log(`  ${r.method} ${r.endpoint}`);
        console.log(`    Status: ${r.statusCode || 'N/A'}`);
        console.log(`    Error: ${r.error}`);
      });
  }

  if (skipped > 0) {
    console.log('\n⏭️  Skipped Tests:');
    results
      .filter((r) => r.status === 'SKIP')
      .forEach((r) => {
        console.log(`  ${r.method} ${r.endpoint}`);
        console.log(`    Reason: ${r.error}`);
      });
  }

  console.log('\n' + '='.repeat(60));

  // Exit with error code if tests failed
  if (failed > 0) {
    process.exit(1);
  }
}

// Check for required environment variables
if (!TEST_JWT_TOKEN) {
  console.log('\n⚠️  WARNING: No JWT token provided!');
  console.log('Set TEST_JWT_TOKEN environment variable to test authenticated endpoints.\n');
  console.log('Example:');
  console.log('  export TEST_JWT_TOKEN="eyJhbGc..."');
  console.log('  export TEST_HOUSEHOLD_ID="household-uuid"');
  console.log('  tsx backend/src/scripts/test-ai-api-endpoints.ts\n');
}

runTests().catch(console.error);
