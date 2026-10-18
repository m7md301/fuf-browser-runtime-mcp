# Deployment and relay setup

This Worker is a fixed authenticated MCP gateway. It requires `MCP_GATEWAY_SECRET` as a Cloudflare Secret.

Deploy:

```bash
npm install
npx wrangler secret put MCP_GATEWAY_SECRET
npx wrangler deploy
```

The local connector must run with the same secret and the Worker URL:

```bash
export MCP_GATEWAY_SECRET='same value; do not commit it'
export RUNTIME_RELAY_URL='https://fuf-browser-runtime-mcp.gacfzv.workers.dev'
npm run bridge
```

The connector opens an outbound WebSocket to `/relay/connect`; the Worker does not open an inbound connection to the local device.
