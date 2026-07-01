# aera — Architecture

A personal, Strava-like native app to record, analyze, compare, and share running
and cycling workouts. Built for a two-person audience (you on Android, Erika on
iPhone later), aiming at **Premium Strava** quality of presentation and analysis —
not just raw health-app numbers.

---

## 1. Guiding principles

1. **The Workout model is the contract.** Every screen, stat, and share image reads
   from one normalized `Workout` shape. Platform health data (Health Connect,
   HealthKit) is mapped *into* it by importers and is never touched directly by the
   rest of the app.
2. **Store the raw track once; derive everything else.** The recorded GPS/HR stream
   is the source of truth. All summary metrics are computed by pure functions and
   cached. Better math later = re-run over stored tracks, never re-record.
3. **Offline-first, local-first.** Dexie/IndexedDB is the primary store (the TinyPOS
   pattern). Cloud sync (Supabase) is optional and only needed for a *shared* feed.
4. **The value is the layer on top.** Basic numbers are commodity. aera's worth is in
   derived metrics, the comparison engine, progress trends, and the share/animation
   presentation layer.
5. **Two ecosystems, one app.** Health Connect (Android) and HealthKit (iOS) are
   swappable ingestion adapters behind the same Workout model. iOS is additive, not a
   rewrite.

---

## 2. Platform & stack

- **Shell:** Capacitor (React + TypeScript web app in a native container). One
  codebase, Android + iOS build targets.
- **UI:** React + TypeScript.
- **Local storage:** Dexie (IndexedDB). Tracks stored in a separate table keyed by
  workout id so list views stay fast.
- **Maps / rendering:** MapLibre or Leaflet as the renderer.
  - v1 default: minimalist (no-basemap) route render + free **OpenStreetMap** tiles
    when streets are wanted (attribution required).
  - Premium toggle: **Mapbox** Static Images API for polished map PNGs (generous free
    tier). Renderer is swappable via config.
  - **Google Maps is ruled out** — its ToS forbids saving/redistributing map imagery,
    which breaks the PNG-to-Instagram feature.
- **Sharing:** Capacitor Share plugin → native share sheet → Instagram (no Instagram
  API needed for personal use).
- **Cloud (optional, later):** Supabase for a shared you+Erika feed across devices.

### Data source per athlete

| | You | Erika (later) |
|---|---|---|
| Phone | Android | iPhone |
| Watch | Galaxy Watch 4 (Wear OS 3) | Apple Watch |
| Records via | Samsung Health | Apple Fitness / Workout |
| aera reads from | **Health Connect** | **HealthKit** |
| Capacitor plugin | Health Connect plugin | HealthKit plugin |

Recording flow (v1): start workout on the watch → run/ride → auto-sync to phone →
aera imports the finished workout from Health Connect. This is *auto-record* but
*not live* (stats arrive after sync, not real-time mid-run) — acceptable for a
personal history/comparison app, and it sidesteps the background-GPS problem.

---

## 3. Data model

The normalized contract both ingestion adapters must produce.

```typescript
// The raw recorded stream — one entry per GPS sample (~1/sec)
interface TrackPoint {
  t: number;          // ms offset from workout start
  lat: number;
  lng: number;
  alt: number | null; // meters
  hr: number | null;  // bpm, if watch paired HR
  cad: number | null; // cadence (steps/min run, rpm bike) — optional
}

interface Workout {
  id: string;                  // uuid
  sport: 'run' | 'ride';       // v1 two types
  source: 'health-connect' | 'healthkit' | 'manual';
  startedAt: string;           // ISO, with timezone
  timezone: string;

  track: TrackPoint[];         // the raw stream — source of truth

  // --- everything below is DERIVED from track, cached for fast lists ---
  summary: WorkoutSummary;

  // user layer
  title: string;               // "Morning Run", editable
  notes: string;
  athleteId: string;           // you vs Erika, for the shared-history phase
}

interface WorkoutSummary {
  durationMovingSec: number;   // excludes auto-pause
  durationElapsedSec: number;
  distanceM: number;
  avgPaceSecPerKm: number | null;   // run
  avgSpeedKmh: number | null;       // ride
  elevGainM: number;
  elevLossM: number;
  avgHr: number | null;
  maxHr: number | null;
  calories: number | null;
  splits: Split[];             // per-km (or per-mile)
  maxSpeedKmh: number | null;

  // Strava-flavored extras:
  gradeAdjustedPaceSecPerKm: number | null; // run — pace normalized for hills
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

interface Split {
  index: number;
  distanceM: number;
  durationSec: number;
  paceSecPerKm: number | null;
  elevChangeM: number;
  avgHr: number | null;
}
```

**Rule:** store the raw `track` once; compute `summary` with a pure
`deriveSummary(track, sport)` function.

---

## 4. Derived-metrics engine (the "premium" layer)

All computable from `track` — the things a basic health app won't give:

- **Grade-adjusted pace** — effort pace accounting for hills (Strava's signature).
- **Elevation smoothing** — raw GPS altitude is noisy; a smoothing pass yields
  believable gain/loss.
- **Best-effort segments** — fastest 1k / 5k / 10k *within* a single workout.
- **HR zones** — time in each of 5 zones (needs configured max HR).
- **Auto-pause detection** — strip stopped time for honest moving pace.
- **Personal records** — fastest 1k/5k/10k ever, longest, biggest climb — a records
  table updated on each import.

---

## 5. Screens (v1)

1. **Home / Feed** — reverse-chronological cards; mini-map thumbnail + key stats;
   filter by sport.
2. **Workout Detail** — full map; interactive elevation/pace/HR charts (tap chart →
   marker moves on map); splits table; HR zones.
3. **Compare** — pick 2+ workouts on a similar route → overlaid pace/elevation,
   side-by-side deltas ("Faster by 1:20 vs last week").
4. **Progress / Trends** — weekly & monthly rollups (distance, time, elevation);
   day-to-day streak; PR timeline.
5. **Share composer** — the map PNG / Instagram / animation pipeline.
6. **Import** — trigger/confirm pulling new workouts from Health Connect.

---

## 6. Sharing pipeline

A distinct subsystem, designed to output PNG now and video later.

- **Static map render:** draw route polyline onto a canvas over a tile background or
  a clean no-basemap style; composite a stats overlay → export **PNG**.
- **Instagram:** Capacitor Share plugin hands the PNG to the native share sheet.
- **Animation (v2):** route "draw-on" animation with counting-up stats, rendered to a
  short video/GIF for Stories. Share composer is designed to output either PNG (v1) or
  video (v2).

---

## 7. Storage detail

- **Dexie/IndexedDB** for workouts + tracks locally — offline-first, instant.
- Tracks are large (1-hr run ≈ 3,600 points); store compressed and in a separate
  Dexie table keyed by workout id so list views stay fast.
- **Supabase** optional later — only for a shared you+Erika feed across devices. Not
  required for v1.

---

## 8. Roadmap

**v1 — Android only**
- Define Workout model + Dexie storage.
- Health Connect importer → normalized Workout.
- `deriveSummary` metrics engine.
- Home, Workout Detail, Compare, Progress screens.
- Share composer with PNG export → Instagram.

**v2 — iOS / Erika**
- HealthKit importer (maps into the same Workout model).
- Reuse all UI, stats, and sharing unchanged.
- Optional: animated video share, Mapbox premium maps, Supabase shared feed.
