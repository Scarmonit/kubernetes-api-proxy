# Kubernetes API Proxy Worker

⚡ **Production-grade Cloudflare Worker** for proxying Kubernetes API requests with advanced security, WebSocket support, and edge optimization.

[![Deployed](https://img.shields.io/badge/Deployed-scarmonit.com-blue)](https://scarmonit.com/kubernetes)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com)
[![Status](https://img.shields.io/badge/Status-Live-success)](https://scarmonit.com/kubernetes/health)

---

## 🚀 Features

### ✅ **Security Enhancements**
- **Host Header Rewriting**: Prevents upstream API rejection
- **Conditional CORS Origin**: Configurable via `env.ALLOWED_ORIGIN` (defaults to wildcard)
- **Security Headers**: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS
- **Token Injection**: Optional `K8S_BEARER_TOKEN` environment variable for token-less frontends

### ⚡ **Performance Optimizations**
- **WebSocket Support**: Full support for `kubectl exec`, `logs -f`, and `attach` commands
- **Streaming API**: Handles Kubernetes Watch API for real-time resource updates
- **Optimized Path Handling**: Robust `.slice()` logic (safer than `.replace()`)
- **GET/HEAD Body Fix**: Prevents Worker errors on non-body requests

### 🎯 **Production-Ready**
- **Error Handling**: Comprehensive error messages with stack traces
- **CORS Preflight**: Fast 204 responses for OPTIONS requests
- **Redirect Following**: Automatic redirect handling for API compatibility
- **Live Deployment**: Running at [scarmonit.com/kubernetes/*](https://scarmonit.com/kubernetes)

---

## 📦 Deployment

### 1. Clone Repository
```bash
git clone https://github.com/Scarmonit/kubernetes-api-proxy.git
cd kubernetes-api-proxy
```

### 2. Configure Cloudflare Worker
```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

### 3. Set Environment Variables (Optional)
```bash
wrangler secret put K8S_BEARER_TOKEN
wrangler secret put ALLOWED_ORIGIN
```

### 4. Configure Route
Add route in Cloudflare Dashboard:
- **Route**: `your-domain.com/kubernetes/*`
- **Worker**: `kubernetes-api-proxy`

---

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|----------|
| `K8S_BEARER_TOKEN` | Kubernetes ServiceAccount token (optional) | None |
| `ALLOWED_ORIGIN` | CORS allowed origin | `*` |

### Example: Token-less Frontend
```javascript
// In worker.js, the token is injected automatically
if (env.K8S_BEARER_TOKEN) {
  newHeaders.set('Authorization', `Bearer ${env.K8S_BEARER_TOKEN}`);
}
```

---

## 🧪 Testing

### Health Check
```bash
curl https://scarmonit.com/kubernetes/health
# Expected: "Healthy"
```

### CORS Preflight
```bash
curl -I -X OPTIONS https://scarmonit.com/kubernetes/api
# Expected: 204 No Content with CORS headers
```

### API Request (with token)
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://scarmonit.com/kubernetes/api/v1/namespaces
```

### WebSocket Test (kubectl)
```bash
kubectl --server=https://scarmonit.com/kubernetes/api \
  --token=YOUR_TOKEN \
  --insecure-skip-tls-verify \
  get pods
```

---

## 📊 Architecture

```
┌─────────────┐
│   Client    │
│  (Browser)  │
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────────────────────┐
│  Cloudflare Edge Network    │
│  (kubernetes-api-proxy)     │
│                             │
│  • CORS Handling            │
│  • WebSocket Upgrade        │
│  • Host Header Rewrite      │
│  • Token Injection          │
└──────┬──────────────────────┘
       │ HTTPS/WSS
       ▼
┌─────────────────────────────┐
│  Kubernetes API Server      │
│  (api.scarmonit.com)        │
└─────────────────────────────┘
```

---

## 🛡️ Security Considerations

1. **Wildcard CORS**: Current default (`*`) allows any origin. Set `ALLOWED_ORIGIN` for production.
2. **Token Storage**: Store `K8S_BEARER_TOKEN` as a Cloudflare secret, not in code.
3. **TLS**: Always use HTTPS for API communication.
4. **RBAC**: Use least-privilege Kubernetes ServiceAccount tokens.

### Recommended: Cloudflare Access Integration
Wrap this Worker with **Cloudflare Access** (Zero Trust) to validate `Cf-Access-Jwt-Assertion` headers.

---

## 🔮 Roadmap

- [ ] **Cloudflare Access Integration** (Zero Trust authentication)
- [ ] **Kubernetes Impersonation Headers** (user-based RBAC)
- [ ] **Audit Logging** with `ctx.waitUntil()` for non-blocking logs
- [ ] **Health Check Endpoint** (`/kubernetes/worker-health`)
- [ ] **Cache API** for Kubernetes discovery endpoints
- [ ] **Metrics & Monitoring** (Cloudflare Analytics integration)

---

## 📝 Changelog

### v2.0.0 (Latest) - Production-Grade Upgrade
- ✅ **WebSocket Support** for kubectl exec/logs
- ✅ **Host Header Rewriting** (critical upstream fix)
- ✅ **GET/HEAD Body Handling** (prevents Worker errors)
- ✅ **Improved Path Slicing** (robust .slice() logic)
- ✅ **Enhanced Error Messages** with stack traces
- ✅ **Token Injection** via environment variables
- ✅ **Security Headers** (HSTS, X-Frame-Options, etc.)

### v1.0.0 - Initial Release
- Basic CORS proxy functionality
- Cloudflare Pages integration

---

## 🤝 Contributing

Contributions welcome! This project was enhanced with AI assistance from **Google Gemini 3 Flash** (grounded search).

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- **AI Review**: Google Gemini 3 Flash (identified critical security and performance issues)
- **Tested With**: kubectl, Kubernetes Dashboard, Lens
- **Deployed On**: Cloudflare Workers (scarmonit.com)

---

## 📞 Support

- **Live Demo**: [scarmonit.com/kubernetes](https://scarmonit.com/kubernetes)
- **Issues**: [GitHub Issues](https://github.com/Scarmonit/kubernetes-api-proxy/issues)
- **Email**: scarmonit@gmail.com
