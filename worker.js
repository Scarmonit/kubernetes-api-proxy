/**
 * @typedef {Object} Env
 * @property {string} [K8S_API_URL] - Upstream Kubernetes API URL (must be valid HTTPS URL)
 * @property {string} [ALLOWED_ORIGIN] - Allowed CORS Origin (comma-separated list or '*')
 * @property {string} [K8S_BEARER_TOKEN] - Bearer token for authentication
 * @property {string} [ENVIRONMENT] - Deployment environment ('development' or 'production')
 */

/**
 * @typedef {Object} LogData
 * @property {string} [method] - HTTP method
 * @property {string} [path] - Request path
 * @property {string} [target] - Target URL
 * @property {string} [clientIp] - Client IP address
 * @property {number} [status] - Response status code
 * @property {number} [durationMs] - Request duration in milliseconds
 * @property {string} [error] - Error message
 * @property {string} [stack] - Error stack trace
 * @property {string} [reason] - Rejection reason
 * @property {string} [origin] - Request origin
 */

/** @type {string} */
const VERSION = '1.0.2';

/** @type {string} */
const DEFAULT_UPSTREAM_URL = 'https://api.scarmonit.com';

/**
 * Validates that a URL is a properly formatted HTTPS URL
 * @param {string} urlString - URL to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
export function validateApiUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, error: 'URL is required and must be a string' };
  }
  
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'https:') {
      return { valid: false, error: 'URL must use HTTPS protocol' };
    }
    if (!url.hostname || url.hostname.length === 0) {
      return { valid: false, error: 'URL must have a valid hostname' };
    }
    // Prevent localhost/private IPs in production
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
      return { valid: false, error: 'URL cannot point to localhost or private networks' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'URL is malformed' };
  }
}

/**
 * Validates the request origin against allowed origins
 * @param {string|null} origin - Request origin header
 * @param {string} allowedOrigins - Comma-separated list of allowed origins or '*'
 * @returns {{allowed: boolean, matchedOrigin: string}} Validation result
 */
export function validateOrigin(origin, allowedOrigins) {
  // If allowed is '*', allow all
  if (allowedOrigins === '*') {
    return { allowed: true, matchedOrigin: '*' };
  }
  
  // If no origin header, reject for strict CORS
  if (!origin) {
    return { allowed: false, matchedOrigin: '' };
  }
  
  // Parse allowed origins list
  const allowedList = allowedOrigins.split(',').map(o => o.trim().toLowerCase());
  const requestOrigin = origin.toLowerCase();
  
  // Check for exact match
  if (allowedList.includes(requestOrigin)) {
    return { allowed: true, matchedOrigin: origin };
  }
  
  // Check for wildcard subdomain matching (e.g., *.example.com)
  for (const allowed of allowedList) {
    if (allowed.startsWith('*.')) {
      const baseDomain = allowed.slice(2);
      try {
        const originUrl = new URL(requestOrigin);
        if (originUrl.hostname.endsWith('.' + baseDomain) || originUrl.hostname === baseDomain) {
          return { allowed: true, matchedOrigin: origin };
        }
      } catch {
        // Invalid origin URL, continue checking
      }
    }
  }
  
  return { allowed: false, matchedOrigin: '' };
}

/**
 * Sanitizes path to prevent traversal attacks
 * @param {string} path - Path to sanitize
 * @returns {string} Sanitized path
 */
export function sanitizePath(path) {
  // Remove any path traversal attempts
  let sanitized = path.replace(/\.\./g, '').replace(/\/+/g, '/');
  // Ensure path starts with /
  if (!sanitized.startsWith('/')) {
    sanitized = '/' + sanitized;
  }
  return sanitized;
}

/**
 * Creates a sanitized error response based on environment
 * @param {Error} err - The error object
 * @param {string} requestId - Request ID for tracking
 * @param {string} environment - Current environment (development/production)
 * @param {string} allowedOrigin - CORS allowed origin
 * @returns {Response} Error response
 */
export function createErrorResponse(err, requestId, environment, allowedOrigin) {
  const isDev = environment === 'development';
  
  /** @type {Object} */
  const errorBody = {
    error: 'Gateway Error',
    message: 'The Kubernetes API server could not be reached.',
    requestId
  };
  
  // Only include details in development mode
  if (isDev) {
    errorBody.details = err.message;
    errorBody.stack = err.stack;
  }
  
  return new Response(JSON.stringify(errorBody), {
    status: 502,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin || '*',
    },
  });
}

export default {
  /**
   * Main fetch handler for the Kubernetes API Proxy
   * @param {Request} request - Incoming request
   * @param {Env} env - Environment variables
   * @param {ExecutionContext} _ctx - Execution context (unused)
   * @returns {Promise<Response>} Response to return
   */
  async fetch(request, env, _ctx) {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const environment = env.ENVIRONMENT || 'production';

    /**
     * Helper for structured logging with levels
     * @param {'debug'|'info'|'warn'|'error'} level - Log level
     * @param {string} message - Log message
     * @param {LogData} [data] - Additional log data
     */
    const log = (level, message, data = {}) => {
      // Skip debug logs in production
      if (level === 'debug' && environment !== 'development') {
        return;
      }
      console.log(JSON.stringify({
        level,
        message,
        timestamp: new Date().toISOString(),
        requestId,
        environment,
        ...data
      }));
    };

    try {
      // 1. Configuration Validation
      const UPSTREAM_URL = env.K8S_API_URL || DEFAULT_UPSTREAM_URL;
      const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || '*';
      
      // Validate K8S_API_URL format
      const urlValidation = validateApiUrl(UPSTREAM_URL);
      if (!urlValidation.valid) {
        log('error', 'Invalid K8S_API_URL configuration', { error: urlValidation.error });
        return new Response(JSON.stringify({
          error: 'Configuration Error',
          message: environment === 'development' ? urlValidation.error : 'Server misconfigured',
          requestId
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 2. Robots.txt - Prevent indexing
      if (url.pathname === '/robots.txt') {
        return new Response('User-agent: *\nDisallow: /', { 
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      // 3. CORS Origin Validation & Preflight
      const requestOrigin = request.headers.get('Origin');
      const corsValidation = validateOrigin(requestOrigin, ALLOWED_ORIGIN);
      
      if (request.method === 'OPTIONS') {
        if (!corsValidation.allowed && ALLOWED_ORIGIN !== '*') {
          log('warn', 'CORS preflight rejected', { origin: requestOrigin, reason: 'Origin not allowed' });
          return new Response(null, { status: 403 });
        }
        return handleCorsPreflight(corsValidation.matchedOrigin || ALLOWED_ORIGIN);
      }

      // 4. Routing - Proxy Health Check
      if (url.pathname === '/kubernetes/proxy-health') {
        return new Response(JSON.stringify({
          status: 'ok',
          version: VERSION,
          env: environment,
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

      // 7. CORS validation for non-preflight requests (strict mode)
      if (ALLOWED_ORIGIN !== '*' && requestOrigin && !corsValidation.allowed) {
        log('warn', 'Request rejected - invalid origin', { origin: requestOrigin });
        return new Response(JSON.stringify({
          error: 'Forbidden',
          message: 'Origin not allowed',
          requestId
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 8. Proxy Logic with path sanitization
      const rawPath = url.pathname.slice(11); // Remove '/kubernetes'
      const strippedPath = sanitizePath(rawPath);
      const targetUrl = new URL(strippedPath, UPSTREAM_URL).toString() + url.search;

      log('info', 'Proxying request', {
        method: request.method,
        path: url.pathname,
        target: targetUrl,
        clientIp: request.headers.get('CF-Connecting-IP')
      });

      // 9. WebSocket Support
      if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        log('info', 'WebSocket upgrade detected');
        return await fetch(targetUrl, request);
      }

      // 10. Headers & Auth Injection
      const newHeaders = new Headers(request.headers);
      const upstreamHost = new URL(UPSTREAM_URL).host;
      newHeaders.set('Host', upstreamHost);
      newHeaders.set('User-Agent', `Kubernetes-API-Proxy/${VERSION}`);
      newHeaders.set('X-Request-ID', requestId);

      if (env.K8S_BEARER_TOKEN) {
        newHeaders.set('Authorization', `Bearer ${env.K8S_BEARER_TOKEN}`);
      }

      // 11. Forward Request
      /** @type {RequestInit} */
      const requestInit = {
        method: request.method,
        headers: newHeaders,
        redirect: 'follow',
      };
      
      // Add body for non-GET/HEAD methods
      if (!['GET', 'HEAD'].includes(request.method)) {
        requestInit.body = request.body;
        // @ts-ignore - duplex is needed for Node.js fetch with streaming body
        requestInit.duplex = 'half';
      }

      const apiRequest = new Request(targetUrl, requestInit);

      const response = await fetch(apiRequest);

      // 12. Harden Response Headers
      const effectiveOrigin = corsValidation.matchedOrigin || (ALLOWED_ORIGIN === '*' ? '*' : '');
      const resHeaders = hardenHeaders(response.headers, effectiveOrigin, requestId);
      
      const durationMs = Date.now() - startTime;
      log('info', 'Upstream response', { status: response.status, durationMs });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
      });

    } catch (err) {
      const durationMs = Date.now() - startTime;
      log('error', 'Worker exception', { 
        error: err.message, 
        stack: environment === 'development' ? err.stack : undefined,
        durationMs 
      });

      return createErrorResponse(
        err,
        requestId,
        environment,
        env?.ALLOWED_ORIGIN || '*'
      );
    }
  },
};

/**
 * Handles CORS OPTIONS preflight requests
 * @param {string} allowedOrigin - The origin to allow
 * @returns {Response} 204 No Content with CORS headers
 */
function handleCorsPreflight(allowedOrigin) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-CSRF-Token, X-Request-ID, Upgrade, Connection',
      'Access-Control-Expose-Headers': 'X-Request-ID',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Checks if path is for dashboard or static assets (passthrough)
 * @param {string} pathname - The request pathname
 * @returns {boolean} True if path should passthrough to origin
 */
function isDashboardPath(pathname) {
  return pathname === '/kubernetes' || 
         pathname === '/kubernetes/' || 
         pathname.startsWith('/kubernetes/dashboard');
}

/**
 * Hardens response headers for security
 * @param {Headers} headers - Original response headers
 * @param {string} allowedOrigin - CORS allowed origin
 * @param {string} requestId - Request ID to expose
 * @returns {Headers} Hardened headers
 */
function hardenHeaders(headers, allowedOrigin, requestId) {
  const resHeaders = new Headers(headers);
  resHeaders.set('Access-Control-Allow-Origin', allowedOrigin);
  resHeaders.set('Access-Control-Expose-Headers', 'X-Request-ID');
  resHeaders.set('X-Content-Type-Options', 'nosniff');
  resHeaders.set('X-Frame-Options', 'DENY');
  resHeaders.set('X-XSS-Protection', '1; mode=block');
  resHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  resHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  resHeaders.set('X-Request-ID', requestId);
  resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  resHeaders.set('Pragma', 'no-cache');
  // Remove potentially sensitive headers
  resHeaders.delete('Server');
  resHeaders.delete('X-Powered-By');
  return resHeaders;
}
