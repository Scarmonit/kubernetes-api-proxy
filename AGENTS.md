# AGENTS.md — kubernetes-api-proxy

## Project Overview

A lightweight Cloudflare Worker that acts as an **API proxy/gateway** for Kubernetes endpoints. Routes requests from `scarmonit.com/kubernetes/*` to a backend Kubernetes API at `api.scarmonit.com`, adding CORS support and security headers.

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Language:** JavaScript (ES modules)
- **Config:** Wrangler (`wrangler.toml`)
- **Dependencies:** Managed via `package.json`
- **Linting:** ESLint

## Project Structure

```
kubernetes-api-proxy/
├── worker.js              # Worker entry point (fetch handler)
├── wrangler.toml          # Worker config (name, route, zone)
├── package.json           # Dependencies and scripts
├── eslint.config.mjs      # Linter configuration
└── test/                  # Automated tests
    └── worker.test.js
```

## How the Proxy Works

1. Intercepts requests to `scarmonit.com/kubernetes/*`
2. **Robots.txt:** Serves `Disallow: /` to prevent indexing.
3. **CORS:** Handles preflight requests with configurable origins.
4. **Routing:**
   - `/kubernetes/proxy-health` → Returns worker status and version.
   - `/kubernetes/api/*` → Proxy to `api.scarmonit.com/api/*`.
   - `/kubernetes` and `/kubernetes/dashboard*` → Passthrough to origin (dashboard UI).
   - Other `/kubernetes/*` paths → 404.
5. **Request Modification:**
   - Strips `/kubernetes` prefix.
   - Injects `Host` and `Authorization` headers.
   - Adds `User-Agent: Kubernetes-API-Proxy/1.0.1`.
6. **Response Hardening:** Adds strict security headers (HSTS, X-Frame-Options, etc.).

## Route Pattern

```
scarmonit.com/kubernetes/* → api.scarmonit.com/*
```

## Conventions

- **Linting:** Run `npm run lint` before committing.
- **Testing:** Run `npm test` to verify logic.
- **CORS:** Controlled via `ALLOWED_ORIGIN` env var (default `*`).
- **Auth:** Bearer token injected from `K8S_BEARER_TOKEN` secret.

## Deployment

Push to `scarmonit` branch to trigger GitHub Actions deployment.

```bash
git push origin scarmonit
```

## Testing

Automated tests via Node.js Test Runner:
```bash
npm test
```