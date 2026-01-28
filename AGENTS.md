# AGENTS.md — kubernetes-api-proxy

## Project Overview

A lightweight Cloudflare Worker that acts as an **API proxy/gateway** for Kubernetes endpoints. Routes requests from `scarmonit.com/kubernetes/*` to a backend Kubernetes API at `api.scarmonit.com`, adding CORS support.

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Language:** JavaScript (ES modules)
- **Config:** Wrangler (wrangler.toml)
- **Dependencies:** None (vanilla Worker)

## Project Structure

```
kubernetes-api-proxy/
├── worker.js              # Worker entry point (fetch handler)
└── wrangler.toml          # Worker config (name, route, zone)
```

## How the Proxy Works

1. Intercepts requests to `scarmonit.com/kubernetes/*`
2. Validates the `/kubernetes` prefix
3. Routes based on path:
   - `/kubernetes` and `/kubernetes/` → passthrough to origin (dashboard)
   - `/kubernetes/health`, `/kubernetes/api/*`, `/kubernetes/swagger` → proxy to `api.scarmonit.com`
   - Other paths → 404
4. Strips the `/kubernetes` prefix before forwarding
5. Preserves original method, headers, query params, and body
6. Adds `Access-Control-Allow-Origin: *` to all responses

## Route Pattern

```
scarmonit.com/kubernetes/* → api.scarmonit.com/*
```

## Conventions

- **No package.json** — deploy directly with `wrangler deploy`
- **No build step** — plain JavaScript, no bundling
- **CORS:** Permissive (`*`) on all proxied responses
- **No auth logic** — passes through all headers from original request
- **URL rewriting:** Strips `/kubernetes` prefix before forwarding
- **Error handling:** Returns 404 for non-kubernetes paths

## Deployment

```bash
wrangler deploy
```

## Testing

No automated tests. Test manually by hitting endpoints:
- `curl https://scarmonit.com/kubernetes/health`
- `curl https://scarmonit.com/kubernetes/api/v1/pods`
