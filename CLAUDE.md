# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**intentcity** is a campsite reservation reminder app for Washington State — a React SPA that displays campsites on a Mapbox map with agency-based filtering and optional backend integration for reservation dates.

## Commands

All commands run from the `web/` directory (or use root shortcuts):

```bash
./dev.sh start     # (Root) Start dev server in background + output URLs
./dev.sh stop      # (Root) Stop background dev server
./dev.sh status    # (Root) Check if dev server is running
npm run dev        # Start dev server (use -- --host for network access)
npm run build      # Production build (also triggers e2e tests via postbuild)
npm run test       # Run vitest unit tests
npm run e2e        # Run Playwright e2e tests
npm run lint       # ESLint
npm run preview    # Preview production build locally
```

## Verification Workflow

Standard steps for all feature development:
1. **Lint**: `npm run lint`
2. **Unit Test**: `npm run test`
3. **Build**: `npm run build`
4. **Local Deploy**: `npm run preview` (verify at http://localhost:4173)

## Architecture

### Dual-Mode Design

The app runs in two modes controlled by `VITE_STANDALONE`:
- **Connected mode** (default): GeoJSON for map markers, backend at `:8787` for reservation dates
- **Standalone mode** (`VITE_STANDALONE=true`): All data embedded in GeoJSON properties, no backend needed

### Data

`data/campsites.json` is a GeoJSON FeatureCollection of campsite Points. It is managed externally.
- **Availability Windows**: Replaces `year_round`/`open_month`. Array of windows with `start`, `end`, and `booking_advance_days`.
- **Real-time Metadata**: Includes `rec_gov_id`, `wa_park_id`, and `availability` summaries (first available date, etc.).

### Frontend (`web/src/App.jsx`)

Single component (~412 lines) managing:
- Mapbox map lifecycle via refs (`mapRef`, `mapContainerRef`, `hoveredIdRef`)
- Agency filter state → Mapbox filter expressions on layer `campsite-circles`
- Campsite selection → detail panel + optional backend fetch to `GET /campsite/{id}`
- Debug mode via `?debug` URL param (shows zoom/lat/lng, click to copy JSON)

Agency color coding (Monokai theme):
- WA State Parks: `#A6E22E`, NPS: `#FD971F`, USFS: `#66D9EF`, BLM: `#E6DB74`

### CI/CD

- **Push to main** → `deploy-spa.yaml` → builds with `--base=/intentcity/` → deploys to `gh-pages` branch
- **Pull request** → `deploy-staging.yaml` → builds with `--base=/intentcity/staging/` → deploys to `gh-pages/staging/`, comments URL on PR

### Testing

- **Unit tests** (vitest + jsdom): mapboxgl is mocked in `web/src/setupTests.js`
- **E2E tests** (Playwright, Chromium only): base URL `http://localhost:5173`, retries 2x in CI

### Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `VITE_MAPBOX_ACCESS_TOKEN` | Yes | Mapbox API token |
| `VITE_STANDALONE` | No | Set to `true` for embedded-data mode |
