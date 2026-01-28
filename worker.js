export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Only handle /kubernetes/* paths
    if (!path.startsWith('/kubernetes')) {
      return new Response('Not Found', { status: 404 });
    }

    // Pass through to origin for the main dashboard page
    // Let Cloudflare Pages serve /kubernetes and /kubernetes/
    if (path === '/kubernetes' || path === '/kubernetes/') {
      return fetch(request);
    }

    // Define API paths that should be proxied
    const apiPaths = ['/health', '/api/', '/swagger', '/api'];
    const strippedPath = path.replace('/kubernetes', '');

    // Check if this is an API path that should be proxied
    const isApiPath = apiPaths.some(apiPath =>
      strippedPath === apiPath || strippedPath.startsWith(apiPath)
    );

    if (!isApiPath) {
      // Not an API path, pass through to origin
      return fetch(request);
    }

    // Proxy to the API
    const apiUrl = `https://api.scarmonit.com${strippedPath}${url.search}`;

    // Clone the request with the new URL
    const apiRequest = new Request(apiUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    // Forward to the API and return the response
    const response = await fetch(apiRequest);

    // Return response with CORS headers
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
