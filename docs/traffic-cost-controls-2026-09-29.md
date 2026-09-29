# Traffic cost controls — 2026-09-29

Status: complete

## Scope

Reduce high-cardinality URL traffic on `GET /api/inspect`, which can perform DNS, redirects and multi-megabyte remote fetches.

## Change

Add an IP-scoped fixed-window burst guard before DNS/outbound fetch work and return `429` with `Retry-After` when exceeded.

The existing CDN cache still handles repeat requests for identical URLs.

## Progress

| Item | Status |
|---|---|
| Pre-fetch burst guard | done | 20 requests / minute / client key per warm instance; URL capped at 2048 chars |
| Static verification | done | guard runs before DNS and remote fetches |
| Production verification | done | Vercel READY; `tile.manabeakira.com` 200 |
