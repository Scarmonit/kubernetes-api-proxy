export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. CORS Preflight - Early return for OPTIONS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-CSRF-Token',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 2. Routing Logic - Only handle /kubernetes/* paths
    if (!url.pathname.startsWith('/kubernetes')) {
      return new Response('Not Found', { status: 404 });
    }

    // 3. Pass through to Pages/Static origin for the dashboard UI
    if (url.pathname === '/kubernetes' || url.pathname === '/kubernetes/') {
      return fetch(request);
    }

    // 4. Prepare Upstream Request
    const strippedPath = url.pathname.slice(11); // Safe slice of "/kubernetes"
    const targetUrl = `https://api.scarmonit.com${strippedPath}${url.search}`;

    // 5. Check for WebSocket upgrade (Essential for kubectl logs/exec)
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader?.toLowerCase() === 'websocket') {
      return await fetch(targetUrl, request);
    }

    // 6. Clone headers and set Host header (CRITICAL FIX)
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', 'api.scarmonit.com');

    // ADVANCED: Inject ServiceAccount Token from Secrets
    // This allows the frontend to stay "token-less"
    if (env.K8S_BEARER_TOKEN) {
      newHeaders.set('Authorization', `Bearer ${env.K8S_BEARER_TOKEN}`);
    }

    // 7. Create API request (conditionally add body for non-GET/HEAD)
    const apiRequest = new Request(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
      redirect: 'follow',
    });

    try {
      // 8. Forward to the API
      const response = await fetch(apiRequest);

      // 9. Harden Response Headers
      const resHeaders = new Headers(response.headers);
      resHeaders.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*');
      resHeaders.set('X-Content-Type-Options', 'nosniff');
      resHeaders.set('X-Frame-Options', 'DENY');
      resHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      resHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

      // Handle Kubernetes "Watch" streaming (Content-Type: application/json;stream=watch)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
      });
    } catch (err) {
      console.error('Worker error:', err);

      // 10. Friendly error handling with details
      return new Response(JSON.stringify({
        error: 'Gateway Error',
        message: 'The Kubernetes API server could not be reached. It may be down or experiencing high traffic.',
        details: err.message,
      }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
        },
      });
    }
  },
};
