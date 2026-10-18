# FUF Browser Runtime MCP

The Worker exposes the MCP tools and a temporary mobile-friendly noVNC page. Runtime sessions are local; the Cloudflare Worker only relays the authenticated WebSocket.

## Session lifecycle

Human sessions default to 15 minutes. The local Runtime owns the TTL and deletes the session URL, token, VNC password and passfile during cleanup. The Bridge rejects VNC opens when the token is missing, expired, or no longer matches the active session.

The Worker UI supports mobile viewport scaling, touch input, a virtual text-input helper, and direct noVNC key events. Publish the Worker after each `src/worker.js` change, then create a fresh HIL session for testing.
