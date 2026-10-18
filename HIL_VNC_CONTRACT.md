# Temporary HIL VNC contract

## Operating model

The runtime is started by the assistant when a browser task begins. The human channel is not exposed and is not created until the assistant needs user intervention.

`browser_request_human` creates one temporary intervention session with a hard maximum TTL of 900 seconds (15 minutes). The assistant receives the Worker URL and the one-time password. The password is for the human operator only; the assistant does not need it to use the browser runtime through CDP.

## Session lifecycle

```text
browser_runtime_enable
  -> Chromium/CDP ready; no public HIL endpoint
browser_request_human(reason)
  -> create session, start VNC bridge, return URL + password + expiresAt
human opens URL and enters password
browser_human_done
  -> revoke session and close VNC channel
browser_runtime_disable
  -> stop runtime and clean all temporary state
```

## Security invariants

- Default TTL is exactly 900 seconds; requested values are clamped to 60..900.
- One active HIL session per runtime.
- Session IDs and passwords are generated with cryptographically secure randomness.
- The password is returned once and is never sent over the MCP relay as the gateway secret.
- Store only a password verifier, never plaintext, in Durable Object state.
- The HIL URL cannot access `/mcp`, `/relay/action`, CDP, or local files.
- Expiry, `human_done`, bridge disconnect, and runtime disable all revoke the session.
- No Quick Tunnel is used. VNC is reachable only through the authenticated Worker/DO WebSocket relay.

## Relay messages

Bridge to Worker/DO messages use JSON control frames and binary VNC frames:

```json
{"type":"vnc_open","sessionId":"...","id":"..."}
{"type":"vnc_close","sessionId":"...","id":"..."}
```

The VNC data path is binary after the authenticated session is accepted. Control messages are scoped to the session ID and rejected after expiry or revocation.

## Returned response

```json
{
  "ok": true,
  "status": "active",
  "sessionId": "...",
  "humanUrl": "https://fuf-browser-runtime-mcp.gacfzv.workers.dev/human/...",
  "password": "...",
  "expiresAt": "...",
  "ttlSeconds": 900
}
```
