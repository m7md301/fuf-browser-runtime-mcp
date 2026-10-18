# FUF Browser Runtime MCP

This is intentionally a separate private repository from the local Chromium runtime.

## Secret

Create a Cloudflare Worker Secret named:

```text
MCP_GATEWAY_SECRET
```

Generate a value locally:

```bash
openssl rand -hex 32
```

Store it only in Cloudflare Workers → Settings → Variables and Secrets → Secret. The Worker requires `Authorization: Bearer <value>` before exposing the MCP endpoint or tool list.

## Deploy

```bash
npm install
npx wrangler login
npx wrangler secret put MCP_GATEWAY_SECRET
npm run deploy
```

The stable endpoint is:

```text
https://<worker>.<account>.workers.dev/mcp
```

`RUNTIME_RELAY_URL` is intentionally not configured until the private relay is built and tested. The Worker does not start the browser just because someone visits the URL.
