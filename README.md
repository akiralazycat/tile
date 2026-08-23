# Tile

**Web → Widget.** Tile turns a website, RSS/Atom feed, or JSON Feed into a normalized, glanceable widget recipe.

## What is implemented

- URL-first source inspector with automatic RSS / Atom / JSON Feed discovery
- Generic web-page fallback that extracts metadata and useful headings
- Server-side fetching with redirect validation, DNS checks, private-network blocking, timeouts, and response-size limits
- One normalized data model regardless of source format
- Live small / medium / large widget previews
- Focus, Stack, and Brief information layouts
- Ink, Paper, and Glass surfaces with signal-color selection
- Adaptive refresh recommendations based on feed freshness
- Shareable recipe links with no account requirement
- Portable Tile JSON configuration
- Generated iOS Scriptable bridge code that calls Tile's normalized source endpoint
- Responsive UI designed for desktop and mobile

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Validation

```bash
npm run typecheck
npm run build
```

## API

`GET /api/inspect?url=https%3A%2F%2Fexample.com`

The endpoint returns a compact normalized source object containing source metadata, detected format, refresh guidance, and up to twelve items. Tile does not intentionally persist fetched page content.

## Security notes

The source inspector only accepts HTTP(S), follows a limited number of redirects, resolves hosts before fetching, rejects localhost/private/link-local destinations, limits payload size, and applies a request timeout. This keeps the public inspector useful without turning it into an unrestricted internal-network fetcher.

## Widget bridges

The first practical bridge is **Scriptable on iOS**: Tile generates a script that fetches the normalized endpoint and renders it as a Home Screen widget. The normalized JSON model is intentionally client-agnostic so native iOS/Android bridges can be added without changing source ingestion.
