import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import worker, { validateApiUrl, validateOrigin, sanitizePath, createErrorResponse } from '../worker.js';

describe('Worker Logic', () => {
  const workerFetch = worker.fetch;
  let originalFetch;
  let capturedRequest;

  const mockEnv = {
    ALLOWED_ORIGIN: '*',
    K8S_BEARER_TOKEN: 'test-token',
    K8S_API_URL: 'https://api.scarmonit.com',
    ENVIRONMENT: 'production'
  };

  const devEnv = {
    ...mockEnv,
    ENVIRONMENT: 'development'
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
  });

  beforeEach(() => {
    capturedRequest = null;
    global.fetch = async (request) => {
      if (typeof request === 'string') {
        if (request.startsWith('https://api.scarmonit.com')) {
          return new Response('proxied', { status: 200 });
        }
      } else if (request.url?.startsWith('https://api.scarmonit.com')) {
        capturedRequest = request;
        return new Response('proxied', { status: 200 });
      }
      return new Response('passthrough', { status: 200 });
    };
  });

  after(() => {
    global.fetch = originalFetch;
  });

  // ============== Basic Functionality Tests ==============

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

  it('returns health check with correct version', async () => {
    const request = new Request('https://scarmonit.com/kubernetes/proxy-health');
    const response = await workerFetch(request, mockEnv);
    const json = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(json.status, 'ok');
    assert.strictEqual(json.version, '1.0.2');
    assert.strictEqual(json.requestId, 'test-uuid-1234');
  });

  it('serves robots.txt with correct content-type', async () => {
    const request = new Request('https://scarmonit.com/robots.txt');
    const response = await workerFetch(request, mockEnv);
    const text = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(text.includes('Disallow: /'));
    assert.strictEqual(response.headers.get('Content-Type'), 'text/plain');
  });

  it('adds User-Agent and X-Request-ID headers to upstream requests', async () => {
    const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods');
    await workerFetch(request, mockEnv);
    
    assert.ok(capturedRequest);
    assert.strictEqual(capturedRequest.headers.get('User-Agent'), 'Kubernetes-API-Proxy/1.0.2');
    assert.strictEqual(capturedRequest.headers.get('X-Request-ID'), 'test-uuid-1234');
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

  // ============== Security Headers Tests ==============

  it('adds security headers to proxied responses', async () => {
    const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods');
    const response = await workerFetch(request, mockEnv);
    
    assert.strictEqual(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.strictEqual(response.headers.get('X-Frame-Options'), 'DENY');
    assert.strictEqual(response.headers.get('X-XSS-Protection'), '1; mode=block');
    assert.ok(response.headers.get('Strict-Transport-Security').includes('max-age=31536000'));
    assert.strictEqual(response.headers.get('X-Request-ID'), 'test-uuid-1234');
    assert.strictEqual(response.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate');
  });

  it('exposes X-Request-ID header via CORS', async () => {
    const request = new Request('https://scarmonit.com/kubernetes/api/v1', {
      method: 'OPTIONS',
    });
    const response = await workerFetch(request, mockEnv);
    assert.ok(response.headers.get('Access-Control-Expose-Headers').includes('X-Request-ID'));
  });

  // ============== Error Handling Tests ==============

  it('handles upstream API errors gracefully in production (no details)', async () => {
    global.fetch = async (request) => {
      if (typeof request === 'string' || request.url?.startsWith('https://api.scarmonit.com')) {
        throw new Error('Upstream connection failed');
      }
      return new Response('passthrough', { status: 200 });
    };

    const originalLog = console.log;
    console.log = () => {};

    try {
      const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods');
      const response = await workerFetch(request, mockEnv);
      const json = await response.json();
      
      assert.strictEqual(response.status, 502);
      assert.strictEqual(json.error, 'Gateway Error');
      assert.strictEqual(json.requestId, 'test-uuid-1234');
      // Should NOT include details in production
      assert.strictEqual(json.details, undefined);
      assert.strictEqual(json.stack, undefined);
    } finally {
      console.log = originalLog;
    }
  });

  it('includes error details in development mode', async () => {
    global.fetch = async (request) => {
      if (typeof request === 'string' || request.url?.startsWith('https://api.scarmonit.com')) {
        throw new Error('Upstream connection failed');
      }
      return new Response('passthrough', { status: 200 });
    };

    const originalLog = console.log;
    console.log = () => {};

    try {
      const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods');
      const response = await workerFetch(request, devEnv);
      const json = await response.json();
      
      assert.strictEqual(response.status, 502);
      assert.strictEqual(json.error, 'Gateway Error');
      // Should include details in development
      assert.strictEqual(json.details, 'Upstream connection failed');
      assert.ok(json.stack);
    } finally {
      console.log = originalLog;
    }
  });

  // ============== CORS Validation Tests ==============

  it('rejects preflight from non-allowed origin in strict mode', async () => {
    const strictEnv = { ...mockEnv, ALLOWED_ORIGIN: 'https://allowed.example.com' };
    const request = new Request('https://scarmonit.com/kubernetes/api/v1', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://evil.com'
      }
    });
    
    const originalLog = console.log;
    console.log = () => {};
    
    try {
      const response = await workerFetch(request, strictEnv);
      assert.strictEqual(response.status, 403);
    } finally {
      console.log = originalLog;
    }
  });

  it('allows preflight from valid origin in strict mode', async () => {
    const strictEnv = { ...mockEnv, ALLOWED_ORIGIN: 'https://allowed.example.com' };
    const request = new Request('https://scarmonit.com/kubernetes/api/v1', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://allowed.example.com'
      }
    });
    const response = await workerFetch(request, strictEnv);
    assert.strictEqual(response.status, 204);
    assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), 'https://allowed.example.com');
  });

  it('supports comma-separated allowed origins', async () => {
    const multiEnv = { ...mockEnv, ALLOWED_ORIGIN: 'https://a.com, https://b.com, https://c.com' };
    const request = new Request('https://scarmonit.com/kubernetes/api/v1', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://b.com'
      }
    });
    const response = await workerFetch(request, multiEnv);
    assert.strictEqual(response.status, 204);
    assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), 'https://b.com');
  });

  it('rejects non-preflight requests from invalid origin in strict mode', async () => {
    const strictEnv = { ...mockEnv, ALLOWED_ORIGIN: 'https://allowed.example.com' };
    const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods', {
      headers: {
        'Origin': 'https://evil.com'
      }
    });
    
    const originalLog = console.log;
    console.log = () => {};
    
    try {
      const response = await workerFetch(request, strictEnv);
      assert.strictEqual(response.status, 403);
      const json = await response.json();
      assert.strictEqual(json.error, 'Forbidden');
    } finally {
      console.log = originalLog;
    }
  });

  // ============== URL Validation Tests ==============

  it('rejects invalid K8S_API_URL (non-HTTPS)', async () => {
    const badEnv = { ...mockEnv, K8S_API_URL: 'http://insecure.example.com' };
    const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods');
    
    const originalLog = console.log;
    console.log = () => {};
    
    try {
      const response = await workerFetch(request, badEnv);
      assert.strictEqual(response.status, 500);
      const json = await response.json();
      assert.strictEqual(json.error, 'Configuration Error');
    } finally {
      console.log = originalLog;
    }
  });

  it('rejects K8S_API_URL pointing to localhost', async () => {
    const badEnv = { ...mockEnv, K8S_API_URL: 'https://localhost:8080' };
    const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods');
    
    const originalLog = console.log;
    console.log = () => {};
    
    try {
      const response = await workerFetch(request, badEnv);
      assert.strictEqual(response.status, 500);
    } finally {
      console.log = originalLog;
    }
  });

  it('shows detailed error for invalid URL in development mode', async () => {
    const badDevEnv = { ...devEnv, K8S_API_URL: 'not-a-url' };
    const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods');
    
    const originalLog = console.log;
    console.log = () => {};
    
    try {
      const response = await workerFetch(request, badDevEnv);
      assert.strictEqual(response.status, 500);
      const json = await response.json();
      assert.ok(json.message.includes('malformed'));
    } finally {
      console.log = originalLog;
    }
  });

  // ============== Path Security Tests ==============

  it('handles query strings correctly', async () => {
    const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods?namespace=default&limit=10');
    await workerFetch(request, mockEnv);
    
    assert.ok(capturedRequest);
    assert.ok(capturedRequest.url.includes('namespace=default'));
    assert.ok(capturedRequest.url.includes('limit=10'));
  });

  it('handles different HTTP methods', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods', {
        method,
        body: method !== 'GET' ? '{}' : undefined,
        headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {}
      });
      const response = await workerFetch(request, mockEnv);
      assert.strictEqual(response.status, 200, `${method} should succeed`);
    }
  });

  it('detects WebSocket upgrade requests', async () => {
    global.fetch = async () => {
      return new Response('ok', { status: 200 });
    };

    const request = new Request('https://scarmonit.com/kubernetes/api/v1/pods/exec', {
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade'
      }
    });
    await workerFetch(request, mockEnv);
    // WebSocket path should be triggered without error
    assert.ok(true);
  });

  // ============== Dashboard Passthrough Tests ==============

  it('passes through /kubernetes root path', async () => {
    const request = new Request('https://scarmonit.com/kubernetes');
    const response = await workerFetch(request, mockEnv);
    const text = await response.text();
    assert.strictEqual(text, 'passthrough');
  });

  it('passes through /kubernetes/ with trailing slash', async () => {
    const request = new Request('https://scarmonit.com/kubernetes/');
    const response = await workerFetch(request, mockEnv);
    const text = await response.text();
    assert.strictEqual(text, 'passthrough');
  });

  it('passes through /kubernetes/dashboard/* paths', async () => {
    const request = new Request('https://scarmonit.com/kubernetes/dashboard/workloads');
    const response = await workerFetch(request, mockEnv);
    const text = await response.text();
    assert.strictEqual(text, 'passthrough');
  });
});

// ============== Unit Tests for Exported Functions ==============

describe('validateApiUrl', () => {
  it('accepts valid HTTPS URLs', () => {
    const result = validateApiUrl('https://api.example.com');
    assert.strictEqual(result.valid, true);
  });

  it('rejects HTTP URLs', () => {
    const result = validateApiUrl('http://api.example.com');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('HTTPS'));
  });

  it('rejects localhost', () => {
    const result = validateApiUrl('https://localhost:8080');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('localhost'));
  });

  it('rejects private IPs', () => {
    const result = validateApiUrl('https://192.168.1.1');
    assert.strictEqual(result.valid, false);
  });

  it('rejects malformed URLs', () => {
    const result = validateApiUrl('not-a-url');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('malformed'));
  });

  it('rejects empty/null input', () => {
    assert.strictEqual(validateApiUrl('').valid, false);
    assert.strictEqual(validateApiUrl(null).valid, false);
    assert.strictEqual(validateApiUrl(undefined).valid, false);
  });
});

describe('validateOrigin', () => {
  it('allows all origins when configured as *', () => {
    const result = validateOrigin('https://any.com', '*');
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.matchedOrigin, '*');
  });

  it('rejects missing origin in strict mode', () => {
    const result = validateOrigin(null, 'https://allowed.com');
    assert.strictEqual(result.allowed, false);
  });

  it('matches exact origins', () => {
    const result = validateOrigin('https://allowed.com', 'https://allowed.com');
    assert.strictEqual(result.allowed, true);
  });

  it('supports comma-separated origins', () => {
    const result = validateOrigin('https://b.com', 'https://a.com, https://b.com, https://c.com');
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.matchedOrigin, 'https://b.com');
  });

  it('supports wildcard subdomain matching', () => {
    const result = validateOrigin('https://app.example.com', '*.example.com');
    assert.strictEqual(result.allowed, true);
  });

  it('case-insensitive origin matching', () => {
    const result = validateOrigin('https://ALLOWED.COM', 'https://allowed.com');
    assert.strictEqual(result.allowed, true);
  });
});

describe('sanitizePath', () => {
  it('removes path traversal attempts', () => {
    assert.strictEqual(sanitizePath('/api/../../../etc/passwd'), '/api/etc/passwd');
  });

  it('normalizes multiple slashes', () => {
    assert.strictEqual(sanitizePath('/api//v1///pods'), '/api/v1/pods');
  });

  it('ensures path starts with slash', () => {
    assert.strictEqual(sanitizePath('api/v1'), '/api/v1');
  });

  it('handles empty paths', () => {
    assert.strictEqual(sanitizePath(''), '/');
  });
});

describe('createErrorResponse', () => {
  it('hides details in production', async () => {
    const err = new Error('Secret database connection failed');
    err.stack = 'at file.js:123';
    const response = createErrorResponse(err, 'req-123', 'production', '*');
    const json = await response.json();
    
    assert.strictEqual(json.error, 'Gateway Error');
    assert.strictEqual(json.details, undefined);
    assert.strictEqual(json.stack, undefined);
    assert.strictEqual(json.requestId, 'req-123');
  });

  it('includes details in development', async () => {
    const err = new Error('Secret database connection failed');
    err.stack = 'at file.js:123';
    const response = createErrorResponse(err, 'req-123', 'development', '*');
    const json = await response.json();
    
    assert.strictEqual(json.details, 'Secret database connection failed');
    assert.strictEqual(json.stack, 'at file.js:123');
  });
});
