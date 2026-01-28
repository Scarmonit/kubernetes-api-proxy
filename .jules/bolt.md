## 2024-05-22 - [Edge CORS Handling]
**Learning:** In Cloudflare Worker proxies, handling `OPTIONS` requests at the edge prevents unnecessary round-trips to the origin, significantly reducing preflight latency.
**Action:** Always check proxy workers for missed opportunities to handle standard protocol responses (like CORS or specific error codes) directly at the edge.
