---
name: Raven WebSocket architecture
description: How the WS server is attached, authenticated, and why ws must be esbuild-external.
---

## Setup
- `ws` package attached to the same `http.createServer(app)` server as Express
- Path: `/ws` (configured in WebSocketServer constructor)
- Auth: `?token=<JWT>` query param (WS handshake can't carry Authorization header reliably)
- Clients registered in Map<memberId, Set<WebSocket>> for group broadcast

## Why `ws` must be external in esbuild
`ws` uses optional native addons (`bufferutil`, `utf-8-validate`). When bundled, esbuild fails to resolve it. Fix: add `"ws"` to the `external` array in `artifacts/api-server/build.mjs`.

**Why:** esbuild resolves packages at build time; `ws` has conditional native requires that confuse the resolver even though the pure-JS fallback works fine at runtime.

**How to apply:** Any new native-adjacent package that fails to bundle → add to external list in build.mjs before the `bufferutil` entry.

## Message flow
1. Client sends `{ type: "send_message", groupId, content }` over WS
2. Server verifies group membership, persists to DB, looks up sender name
3. Server broadcasts `{ type: "message", id, groupId, senderId, senderName, content, contentType, createdAt }` to all online members of that group
