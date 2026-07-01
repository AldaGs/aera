# aera

A personal, Strava-like app to record, analyze, compare, and share running and
cycling workouts. Android-first (Galaxy Watch 4 via Health Connect); iOS/Apple Watch
(HealthKit) planned as an additive phase.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Stack

- Capacitor (React + TypeScript) native shell — _added in a later step_
- React 19 + Vite
- Dexie / IndexedDB — offline-first local storage
- MapLibre/Leaflet + OpenStreetMap (Mapbox as premium toggle)

## Current status — v1 scaffold

Implemented:

- Normalized `Workout` data model (`src/model/workout.ts`)
- Pure metrics engine `deriveSummary()` — distance (haversine), moving time /
  auto-pause, elevation gain/loss, per-km splits, HR, avg pace / speed
  (`src/metrics/deriveSummary.ts`)
- Dexie storage with tracks split into their own table (`src/db/db.ts`)
- Home feed screen with sample-data generator (`src/screens/Home.tsx`)

Not yet built: Health Connect importer, Workout Detail, Compare, Progress, share
composer, Capacitor native shell.

## Develop

```bash
npm install
npm run dev        # Vite dev server
npm run build      # typecheck + production build
npm run typecheck
```
