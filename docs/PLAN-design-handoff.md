# Plan: apply design handoff (Nocturne) — phone + watch

Source: `docs/design_handoff_aera_record_watch/` (README + `aera Screens.dc.html`).
Decisions (2026-09-23): Nocturne tokens + Phosphor **app-wide**; builder **exactly per
handoff** (drag, swipe, custom keypad); watch **rewritten in Compose**; include **1k** lap card.
Not possible as specced: watch Top key = lap (Wear OS reserves it) → on-screen Lap + Bottom key.

Workflow per step: Sonnet subagent implements → Opus reviews diff → build/checks → commit.
Each step is small, builds on its own, and leaves the app working.

---

## A. Foundation (big, app-wide)
- **A1 Tokens** — Nocturne tokens into `src/styles.css :root`; map old vars
  (`--bg/--surface/--accent/--muted/--line`) onto them so every screen re-themes at once.
- **A2 Type** — Inter 400/500 (bundled via npm `@fontsource/inter`, no network), tabular-nums
  on metrics, headings ≤500.
- **A3 Components CSS** — `.btn` (primary = outline), `.tag`, `.seg`, `.card`, faded dividers,
  toggle, radio card, per handoff. Restyle existing classes, not new markup.
- **A4 Icons** — swap `lucide-react` → `@phosphor-icons/react` across all screens; remove lucide.
- **A5 TabBar** — Home / Record / Stats chrome per handoff.

## B. Plan model (big, shared phone+watch)
- **B1 Model** — `IntervalPlan.steps: (PlanStepDef | RepeatBlock)[]`, kinds + walk/run;
  `flattenPlan` walks steps; legacy → steps migration on read; labels "Run 1/2".
  Update `scripts/` checks. Engine unchanged.
- **B2 Dexie + sync** — schema bump, migrate stored plans, bump `updatedAt` so migrated
  plans re-sync.
- **B3 Watch reader** — `PlanRunner.fromJson` reads `steps` (legacy fallback); unit tests.
- **B4 Summaries** — `planSummary` new format, estimates (~min / ~km, avg pace fallback).

## C. Builder (medium)
- **C1 2a list** — new builder screen: name, meta, step timeline, step rows, autoFinish toggle,
  footer. Tap row → sheet. Save → `savePlan` + `pushOnePlan`.
- **C2 2b sheet** — type chips, Ends-after seg, big value, unit seg, presets, keypad,
  add/update button, >0 validation.
- **C3 Reorder/delete** — drag handle reorder (pointer events, no dep), swipe-left delete.
- **C4 Repeat block** — select steps → wrap in N× block; block rendering + edit count.

## D. Record start 1c (medium)
- **D1 New run sheet** — goal block + tags + Plan… opening plan list; Start.
- **D2 Status list** — watch connected, GPS accuracy (location watcher while sheet open),
  plans synced time.
- **D3 Record on: Watch only** — phone sends `/aera/cmd start:{json}` with standalone flag;
  watch listener launches `ExerciseService`. Watch battery via `/aera/battery` message.

## E. Stats (medium)
- **E1 1d** — range seg, 2×2 grid, weekly bars, activity list with Phosphor sport icons.
- **E2 1f calendar** — month grid, scaled day dots, day filter, session rows with route thumb
  + zone strip + source icons.

## F. Watch Compose (big, split small)
- **F1 Setup** — Compose for Wear deps, theme (Nocturne colors, Inter-ish type), one
  Compose Activity host; old Views stay until replaced.
- **F2 Plans list 1g/2c** — ScalingLazyColumn + rotary; replaces PlansActivity.
- **F3 Live 1i** — metric stack reading `RecState` (+ phone-mirror AeraState).
- **F4 Live 1j** — interval ring. **F5 Live 1h** — zone arc. Bezel swaps layouts (persisted).
- **F6 Paused 1l** — hold-to-end. **F7 Summary 1m** — sync state placeholder until G.
- **F8 Lap card 1k** — buzz + 3 s card, vs previous lap.
- **F9 Edit step 2d** — bezel value editor, pushes via DataClient.
- **F10 Quick goal** — restyle in Compose; delete old View activities/layouts.

## G. Phase 5 (from PLAN-goals-and-watch.md)
- Watch → phone workout upload; completes 1m sync states and 1f source icons.

## Small polish (last)
- LiveRecorder phone screen restyle to match (not in handoff).
- Empty states, focus rings, disabled states pass.
