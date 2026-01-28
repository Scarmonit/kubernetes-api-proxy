import assert from 'assert';
import worker from './worker.js';

const workerFetch = worker.fetch;

// Store original globals
const originalFetch = global.fetch;

// Mock Environment
const mockEnv = {
  ALLOWED_ORIGIN: '*',
  K8S_BEARER_TOKEN: 'test-token'
};

// Set up default mock
global.fetch = async (request) => {
  if (request.url.startsWith('https://api.scarmonit.com')) {
    return new Response('proxied', { status: 200 });
  }
  return new Response('passthrough', { status: 200 });
};

async function runTest(name, testFunction) {
  try {
    await testFunction();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error);
    process.exit(1);
  }
}

async function run() {
    await runTest('handles CORS preflight requests', async () => {
        const request = new Request('https://scarmonit.com/kubernetes/api/v1', {
          method: 'OPTIONS',
          headers: {
            'Access-Control-Request-Headers': 'Content-Type',
          },
        });
        const response = await workerFetch(request, mockEnv);
        assert.strictEqual(response.status, 204);
        assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
      });

      await runTest('returns 404 for non-kubernetes paths', async () => {
        const request = new Request('https://scarmonit.com/other/path');
        const response = await workerFetch(request, mockEnv);
        assert.strictEqual(response.status, 404);
      });

      await runTest('proxies API paths to the correct origin', async () => {
          const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods');
          const response = await workerFetch(request, mockEnv);
          const text = await response.text();
          assert.strictEqual(response.status, 200);
          assert.strictEqual(text, 'proxied');
        });

      await runTest('passes through non-API paths to the origin', async () => {
        const request = new Request('https://scarmonit.com/kubernetes/dashboard');
        const response = await workerFetch(request, mockEnv);
        const text = await response.text();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(text, 'passthrough');
      });

      // This test needs special handling because it modifies mocks and expects errors
      await runTest('handles upstream API errors gracefully', async () => {
        const originalFetchForThisTest = global.fetch;
        const originalConsoleError = console.error;

        global.fetch = async (request) => {
            if (request.url.startsWith('https://api.scarmonit.com')) {
              throw new Error('Upstream error');
            }
            return new Response('passthrough', { status: 200 });
          };
        console.error = () => {}; // suppress error logging for this test

        try {
            const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods');
            const response = await workerFetch(request, mockEnv);
            const json = await response.json();
            assert.strictEqual(response.status, 502);
            assert.deepStrictEqual(json.error, "Gateway Error");
        } finally {
            // restore mocks
            global.fetch = originalFetchForThisTest;
            console.error = originalConsoleError;
        }
      });
}

run().finally(() => {
    // Restore original fetch after all tests
    global.fetch = originalFetch;
});