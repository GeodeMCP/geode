---
id: httpbin
name: httpbin
type: http
description: Sample HTTP tool against httpbin.org — demonstrates server-side per-connection secret injection. Copy into <vault>/tools/httpbin/ to try invoke.
requires: [DEMO_KEY]
connections:
  - { label: default, title: "Demo account", description: "the demo account" }
actions:
  headers:
    description: Echoes request headers back; the injected X-Demo proves the broker supplied DEMO_KEY server-side.
    http:
      method: GET
      url: https://httpbin.org/headers
      headers: { X-Demo: "Bearer ${conn.DEMO_KEY}" }
---
Set the secret with: `npm run secret -- set httpbin__default__DEMO_KEY`
