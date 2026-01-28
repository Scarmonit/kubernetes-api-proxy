import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import worker from '../worker.js';

describe('Worker Logic', () => {
  const workerFetch = worker.fetch;
  let originalFetch;

  const mockEnv = {
    ALLOWED_ORIGIN: '*',
    K8S_BEARER_TOKEN: 'test-token',
    K8S_API_URL: 'https://api.scarmonit.com'
  };

  // Mock crypto.randomUUID
  Object.defineProperty(global, 'crypto', {
    value: {
      randomUUID: () => 'test-uuid-1234'
    },
    writable: true,
    configurable: true
  });

  before(() => {
    originalFetch = global.fetch;
    global.fetch = async (request) => {
      if (request.url.startsWith('https://api.scarmonit.com')) {
        return new Response('proxied', { status: 200 });
      }
      return new Response('passthrough', { status: 200 });
    };
  });

  after(() => {
    global.fetch = originalFetch;
  });

  it('handles CORS preflight requests', async () => {
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

  it('returns health check', async () => {
    const request = new Request('https://scarmonit.com/kubernetes/proxy-health');
    const response = await workerFetch(request, mockEnv);
    const json = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(json.status, 'ok');
  });

  it('returns 404 for non-kubernetes paths', async () => {
    const request = new Request('https://scarmonit.com/other/path');
    const response = await workerFetch(request, mockEnv);
    assert.strictEqual(response.status, 404);
  });

  it('proxies API paths to the correct origin', async () => {
    const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods');
    const response = await workerFetch(request, mockEnv);
    const text = await response.text();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(text, 'proxied');
  });

  it('passes through non-API paths to the origin', async () => {
    const request = new Request('https://scarmonit.com/kubernetes/dashboard');
    const response = await workerFetch(request, mockEnv);
    const text = await response.text();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(text, 'passthrough');
  });

  it('handles upstream API errors gracefully', async () => {
      // Temporarily override fetch for this test
      const tempFetch = global.fetch;
      global.fetch = async (request) => {
          if (request.url.startsWith('https://api.scarmonit.com')) {
              throw new Error('Upstream error');
          }
          return new Response('passthrough', { status: 200 });
      };

      // Suppress logging for this error case
      const originalConsoleError = console.log;
      const originalConsoleLog = console.log;
      console.error = () => {};
      console.log = () => {};

      try {
        const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods');
        const response = await workerFetch(request, mockEnv);
        const json = await response.json();
        assert.strictEqual(response.status, 502);
        assert.strictEqual(json.error, "Gateway Error");
        assert.strictEqual(json.requestId, 'test-uuid-1234');
      } finally {
        global.fetch = tempFetch;
        console.error = originalConsoleError;
        console.log = originalConsoleLog;
      }
  });
});
