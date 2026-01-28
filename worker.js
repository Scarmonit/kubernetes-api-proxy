export default {
  async fetch(request, env, ctx) {
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

      // 2. CORS Preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-CSRF-Token, Upgrade, Connection',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      // 3. Routing - Proxy Health Check
      if (url.pathname === '/kubernetes/proxy-health') {
        return new Response(JSON.stringify({ status: 'ok', version: '1.0.0', env: env.ENVIRONMENT || 'production' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 4. Routing - Kubernetes Check
      if (!url.pathname.startsWith('/kubernetes')) {
        return new Response('Not Found', { status: 404 });
      }

      // 5. Pass-through for Dashboard/Static Assets
      // If the path matches exact /kubernetes, /kubernetes/, or /kubernetes/dashboard*, we assume it's the UI served by Pages
      if (url.pathname === '/kubernetes' || url.pathname === '/kubernetes/' || url.pathname.startsWith('/kubernetes/dashboard')) {
        return fetch(request);
      }

      // 6. Proxy Logic
      // Remove '/kubernetes' prefix (11 chars) to match upstream structure
      const strippedPath = url.pathname.slice(11); 
      const targetUrl = new URL(strippedPath, UPSTREAM_URL).toString() + url.search;

      log('info', 'Proxying request', {
        method: request.method,
        path: url.pathname,
        target: targetUrl,
        clientIp: request.headers.get('CF-Connecting-IP')
      });

      // 7. WebSocket Support
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader?.toLowerCase() === 'websocket') {
        log('info', 'WebSocket upgrade detected');
        return await fetch(targetUrl, request);
      }

      // 8. Headers & Auth Injection
      const newHeaders = new Headers(request.headers);
      const upstreamHost = new URL(UPSTREAM_URL).host;
      newHeaders.set('Host', upstreamHost);

      if (env.K8S_BEARER_TOKEN) {
        newHeaders.set('Authorization', `Bearer ${env.K8S_BEARER_TOKEN}`);
      }

      // 9. Forward Request
      const apiRequest = new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
        redirect: 'follow',
      });

      const response = await fetch(apiRequest);

      // 10. Harden Response Headers
      const resHeaders = new Headers(response.headers);
      resHeaders.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
      resHeaders.set('X-Content-Type-Options', 'nosniff');
      resHeaders.set('X-Frame-Options', 'DENY');
      resHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      resHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      
      // Log success/failure from upstream
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
