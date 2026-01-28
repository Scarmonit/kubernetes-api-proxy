## 2024-05-22 - Friendly 502s for API Proxies
**Learning:** Raw 502/500 errors from proxies break the frontend experience and look unprofessional. Returning a structured JSON error with `Access-Control-Allow-Origin: *` allows the frontend to display a nice "Service Unavailable" message instead of crashing or showing a network error.
**Action:** Wrap all proxy `fetch` calls in `try/catch` blocks and return formatted error responses.
