# Kubernetes API Proxy

A secure, observable Cloudflare Worker that acts as a proxy for the Kubernetes API. It handles authentication injection, CORS, header hardening, and proper routing, allowing frontend applications to interact with Kubernetes clusters securely.

## Features

*   **Secure Proxying:** Hides upstream API details and handles CORS.
*   **Auth Injection:** Injects `Authorization: Bearer <token>` from secrets, keeping tokens out of the client.
*   **Observability:** Structured JSON logging and Request IDs.
*   **Health Checks:** `/kubernetes/proxy-health` endpoint to verify worker status.
*   **WebSocket Support:** Fully supports `kubectl exec` and `logs` via WebSocket upgrades.
*   **Hardened Security:** Adds strict security headers (HSTS, X-Frame-Options, etc.).

## Configuration

The worker is configured via `wrangler.toml` and Environment Variables.

### Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `K8S_API_URL` | The upstream Kubernetes API URL (e.g. `https://api.example.com`) | `https://api.scarmonit.com` |
| `ALLOWED_ORIGIN` | Allowed Origin for CORS (e.g. `https://dashboard.example.com`) | `*` |
| `K8S_BEARER_TOKEN` | (Secret) Service Account Token for the cluster | *(None)* |

### Secrets

Set the following secrets in Cloudflare or GitHub:

*   `K8S_BEARER_TOKEN`: The sensitive Service Account token.
*   `CF_API_TOKEN`: For GitHub Actions deployment.
*   `CF_ACCOUNT_ID`: For GitHub Actions deployment.

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