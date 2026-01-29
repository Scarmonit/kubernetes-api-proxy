# Kubernetes API Proxy

A secure, observable Cloudflare Worker that acts as a proxy for the Kubernetes API. It handles authentication injection, CORS, header hardening, and proper routing, allowing frontend applications to interact with Kubernetes clusters securely.

## Features

*   **Secure Proxying:** Hides upstream API details and handles CORS.
*   **Auth Injection:** Injects `Authorization: Bearer <token>` from secrets, keeping tokens out of the client.
*   **Observability:** Structured JSON logging with Request IDs and log levels.
*   **Health Checks:** `/kubernetes/proxy-health` endpoint to verify worker status (v1.0.2).
*   **WebSocket Support:** Fully supports `kubectl exec` and `logs` via WebSocket upgrades.
*   **Hardened Security:** Adds strict security headers (HSTS, X-Frame-Options, etc.) and blocks indexing via `robots.txt`.
*   **Traceability:** Adds `User-Agent: Kubernetes-API-Proxy/1.0.2` and `X-Request-ID` to all requests.
*   **Input Validation:** Validates URLs, origins, and sanitizes paths.

## Security

### CORS Configuration

The proxy supports strict CORS validation:

| Configuration | Behavior |
| :--- | :--- |
| `ALLOWED_ORIGIN=*` | Allows all origins (development only) |
| `ALLOWED_ORIGIN=https://app.example.com` | Single origin allowlist |
| `ALLOWED_ORIGIN=https://a.com, https://b.com` | Multiple allowed origins |
| `ALLOWED_ORIGIN=*.example.com` | Wildcard subdomain matching |

When strict mode is enabled (non-`*` origin), the proxy:
- Rejects CORS preflight from unauthorized origins with `403 Forbidden`
- Rejects actual requests with `Origin` header from unauthorized sources
- Returns the matched origin (not `*`) in `Access-Control-Allow-Origin`

### URL Validation

The `K8S_API_URL` is validated on every request:
- Must be a valid HTTPS URL
- Cannot point to `localhost`, `127.0.0.1`, or private networks (`192.168.*`, `10.*`)
- Malformed URLs result in `500 Configuration Error`

### Path Sanitization

All proxied paths are sanitized to prevent:
- Path traversal attacks (`../../../etc/passwd`)
- Double-slash normalization issues

### Security Headers

All proxied responses include:

| Header | Value |
| :--- | :--- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Cache-Control` | `no-store, no-cache, must-revalidate` |
| `X-Request-ID` | Unique request identifier for tracing |

Potentially sensitive headers (`Server`, `X-Powered-By`) are removed from responses.

### Error Handling

Error responses are sanitized based on environment:

| Environment | Error Details |
| :--- | :--- |
| `production` (default) | Generic error message only |
| `development` | Includes `details` and `stack` trace |

All errors include a `requestId` for debugging without exposing internals.

## Configuration

The worker is configured via `wrangler.toml` and Environment Variables.

### Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `K8S_API_URL` | The upstream Kubernetes API URL (must be HTTPS) | `https://api.scarmonit.com` |
| `ALLOWED_ORIGIN` | Allowed Origin for CORS (comma-separated or `*`) | `*` |
| `ENVIRONMENT` | `development` or `production` (controls error verbosity) | `production` |
| `K8S_BEARER_TOKEN` | (Secret) Service Account Token for the cluster | *(None)* |

### Secrets

Set the following secrets in Cloudflare or GitHub:

*   `K8S_BEARER_TOKEN`: The sensitive Service Account token.
*   `CF_API_TOKEN`: For GitHub Actions deployment.
*   `CF_ACCOUNT_ID`: For GitHub Actions deployment.

## Observability

### Structured Logging

All logs are JSON-formatted with consistent fields:

```json
{
  "level": "info",
  "message": "Proxying request",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "environment": "production",
  "method": "GET",
  "path": "/kubernetes/api/v1/pods",
  "clientIp": "203.0.113.42",
  "durationMs": 145
}
```

### Log Levels

| Level | Description |
| :--- | :--- |
| `debug` | Verbose debugging (development only) |
| `info` | Normal operations (request proxying, responses) |
| `warn` | CORS rejections, suspicious requests |
| `error` | Exceptions, configuration errors |

### Request Tracing

Every request receives a unique `X-Request-ID` header that:
- Is included in all log entries
- Is returned to clients in response headers
- Can be used to correlate frontend errors with backend logs

## Development

1.  Install dependencies:
    ```bash
    npm install
    ```

2.  Run tests:
    ```bash
    npm test
    ```

3.  Deploy manually:
    ```bash
    npx wrangler deploy
    ```

## API Routes

*   `/kubernetes/proxy-health`: Returns `{ "status": "ok", ... }`.
*   `/kubernetes/api/*`: Proxies to `$K8S_API_URL/api/*`.
*   `/kubernetes/dashboard*`: Passes through to the serving origin (e.g. Cloudflare Pages).

## Deployment

Pushing to the `scarmonit` branch triggers a GitHub Action to deploy to Cloudflare Workers.