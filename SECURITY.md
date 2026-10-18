# Security model

`MCP_GATEWAY_SECRET` is only the initial MCP gateway authentication secret. It is not a noVNC password and must not be reused for HIL sessions or website credentials.

Without a valid Bearer token, the Worker returns 401 and does not expose the tool list. The Worker is explicit-activation only. Runtime actions remain unavailable until `RUNTIME_RELAY_URL` points to the authenticated private relay.
