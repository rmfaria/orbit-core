# @orbit/ui — Claude Code Instructions

## Overview
React Single-Page Application. The entire UI lives in `src/ui/App.tsx` (~6200 lines).

## Key Facts
- **Single-file SPA**: all components, state, and routing in App.tsx
- **No router library**: tab-based navigation with internal state
- **Styling**: Tailwind CSS (dark theme)
- **Auth**: stores API key in localStorage, checks `/api/v1/auth/status` on mount
- **Charts**: orbit-viz.js (vanilla JS engine in `public/orbit-viz.js`)

## orbit-viz.js
- Standalone IIFE exposing `window.OrbitViz`
- 8 renderers: line, area, bar, gauge, kpi, events, eps, donut
- Used by Smart Dashboards — AI generates HTML calling OrbitViz methods
- Auto-refresh every 30s, DPR-aware canvas, dark theme
- Served with 5min cache, injected via iframe with `?v=` cache-bust

## Conventions
- When editing App.tsx, be precise — the file is large
- UI text can be in English (labels, buttons)
- Component sections are separated by comment headers inside App.tsx
- API calls use fetch with `X-Api-Key` from localStorage

## Dev
```bash
pnpm --filter @orbit/ui dev    # or from root: pnpm ui:dev
```
