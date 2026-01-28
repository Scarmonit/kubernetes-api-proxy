/**
 * @typedef {Object} Env
 * @property {string} [K8S_API_URL] - Upstream Kubernetes API URL
 * @property {string} [ALLOWED_ORIGIN] - Allowed CORS Origin
 * @property {string} [K8S_BEARER_TOKEN] - Bearer token for authentication
 * @property {string} [ENVIRONMENT] - Deployment environment name
 */

export default {
  /**
   * Main fetch handler
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContext} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, _ctx) {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);

    // Helper for structured logging
    const log = (level, message, data = {}) => {
      console.log(JSON.stringify({
        level,
        message,
        timestamp: new Date().toISOString(),
        requestId,
        ...data
      }));
    };

    try {
      // 1. Configuration Validation
      const UPSTREAM_URL = env.K8S_API_URL || 'https://api.scarmonit.com';
      const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || '*';

      // 2. Robots.txt - Prevent indexing
      if (url.pathname === '/robots.txt') {
        return new Response('User-agent: *\nDisallow: /', { status: 200 });
      }

      // 3. CORS Preflight
      if (request.method === 'OPTIONS') {
        return handleCorsPreflight(ALLOWED_ORIGIN);
      }

      // 4. Routing - Proxy Health Check
      if (url.pathname === '/kubernetes/proxy-health') {
        return new Response(JSON.stringify({
          status: 'ok',
          version: '1.0.1',
          env: env.ENVIRONMENT || 'production',
          requestId
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 5. Routing - Kubernetes Check
      if (!url.pathname.startsWith('/kubernetes')) {
        return new Response('Not Found', { status: 404 });
      }

      // 6. Pass-through for Dashboard/Static Assets
      if (isDashboardPath(url.pathname)) {
        return fetch(request);
      }

      // 7. Proxy Logic
      const strippedPath = url.pathname.slice(11); 
      const targetUrl = new URL(strippedPath, UPSTREAM_URL).toString() + url.search;

      log('info', 'Proxying request', {
        method: request.method,
        path: url.pathname,
        target: targetUrl,
        clientIp: request.headers.get('CF-Connecting-IP')
      });

      // 8. WebSocket Support
      if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        log('info', 'WebSocket upgrade detected');
        return await fetch(targetUrl, request);
      }

      // 9. Headers & Auth Injection
      const newHeaders = new Headers(request.headers);
      const upstreamHost = new URL(UPSTREAM_URL).host;
      newHeaders.set('Host', upstreamHost);
      newHeaders.set('User-Agent', 'Kubernetes-API-Proxy/1.0.1');

      if (env.K8S_BEARER_TOKEN) {
        newHeaders.set('Authorization', `Bearer ${env.K8S_BEARER_TOKEN}`);
      }

      // 10. Forward Request
      const apiRequest = new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
        redirect: 'follow',
      });

      const response = await fetch(apiRequest);

      // 11. Harden Response Headers
      const resHeaders = hardenHeaders(response.headers, ALLOWED_ORIGIN);
      
      log('info', 'Upstream response', { status: response.status, durationMs: Date.now() - startTime });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
      });

    } catch (err) {
      log('error', 'Worker exception', { error: err.message, stack: err.stack });

      return new Response(JSON.stringify({
        error: 'Gateway Error',
        message: 'The Kubernetes API server could not be reached.',
        details: err.message,
        requestId
      }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': env?.ALLOWED_ORIGIN || '*',
        },
      });
    }
  },
};

/**
 * Handles CORS OPTIONS requests
 * @param {string} allowedOrigin 
 * @returns {Response}
 */
function handleCorsPreflight(allowedOrigin) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-CSRF-Token, Upgrade, Connection',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Checks if path is for dashboard or static assets
 * @param {string} pathname 
 * @returns {boolean}
 */
function isDashboardPath(pathname) {
  return pathname === '/kubernetes' || 
         pathname === '/kubernetes/' || 
         pathname.startsWith('/kubernetes/dashboard');
}

/**
 * Hardens response headers for security
 * @param {Headers} headers 
 * @param {string} allowedOrigin 
 * @returns {Headers}
 */
function hardenHeaders(headers, allowedOrigin) {
  const resHeaders = new Headers(headers);
  resHeaders.set('Access-Control-Allow-Origin', allowedOrigin);
  resHeaders.set('X-Content-Type-Options', 'nosniff');
  resHeaders.set('X-Frame-Options', 'DENY');
  resHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  resHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return resHeaders;
}
