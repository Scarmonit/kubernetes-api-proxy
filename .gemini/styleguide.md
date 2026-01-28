# Code Review Style Guide - Kubernetes API Proxy

## JavaScript Guidelines
- Use modern ES6+ syntax (arrow functions, destructuring, template literals)
- Prefer `const` over `let`, avoid `var`
- Use async/await for asynchronous operations
- Handle promises properly with try/catch

## Cloudflare Workers Specific
- Handle all edge cases in fetch handlers
- Use proper Response objects with correct status codes
- Implement comprehensive error handling
- Be mindful of execution time limits

## API Proxy Best Practices
- Validate incoming requests thoroughly
- Sanitize and forward headers appropriately
- Handle timeouts and network errors gracefully
- Log errors for debugging (but not sensitive data)

## Security (Critical for API Proxy)
- Never expose Kubernetes credentials in responses
- Validate authentication on every request
- Implement proper rate limiting if needed
- Sanitize all user input before proxying
- Never log sensitive headers or tokens
