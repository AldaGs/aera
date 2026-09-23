# Handoff: aera — Record flow, History, Workout Builder + Galaxy Watch4 companion

## Overview
Redesign of the aera phone app's **Record** start sheet and **Stats/history**, a new **mixed time/distance workout builder**, and the **Wear OS companion** screens (Galaxy Watch4, round 450×450 @ 44 mm). Recording can happen on either device; plans sync both ways.

Target repo: `AldaGs/aera` (branch `main`) — React 19 + Vite + Capacitor (phone), Kotlin Wear OS module `android/wear/` (watch).

In scope (ids match badges in the HTML file):
- Phone: **1c** Start run (device hand-off), **1d** Stats, **1f** Calendar history, **2a** Workout builder, **2b** Add-step sheet
- Watch: **1h** Live – zone arc, **1i** Live – metric stack, **1j** Live – interval step, **1l** Paused, **1m** Summary, **2c** Step list, **2d** Edit step

Out of scope (present in the file, ignore): 1a, 1b, 1e, 1g, 1k.

## About the Design Files
`aera Screens.dc.html` is a **design reference built in HTML** — static mockups showing intended look and layout, not production code. Recreate these screens in the existing codebase:
- Phone → React components in `src/screens/` using the app's patterns (Dexie, `RecordingEngine`, `WearBridge`).
- Watch → **Jetpack Compose for Wear OS** in `android/wear/` (the HTML cannot be ported; rebuild natively with `ScalingLazyColumn`, `CircularProgressIndicator`, `rotaryScrollable`/`onRotaryScrollEvent` for the bezel).

Open the HTML in a browser (keep `support.js` and `_ds/` beside it). It's a pan/zoom canvas; each screen has an id badge.

## Fidelity
**High-fidelity.** Colors, type, radii and spacing are final and come from the Nocturne token sheet (`_ds/.../styles.css`). Copy the tokens into `src/styles.css` `:root` and style against variables. Data shown is sample data.

---

## Design Tokens (Nocturne)
Colors
- `--color-bg` #161826 · `--color-surface` #232532 · `--color-text` #e9e9ed · `--color-accent` #9184d9
- `--color-divider` = `color-mix(in srgb, #e9e9ed 16%, transparent)`
- Neutral ramp 100→900: #f3f5fe #e4e7f5 #cfd3e5 #b2b6ca #9397ab #75798c #595d6c #3f424d #292b31
- Accent ramp 100→900: #f5f4ff #e7e5fe #d2cefd #b5abfc #968ae0 #796cbf #5d5294 #423a6a #2b2741
- Watch screen ground (OLED): `color-mix(in oklch, #161826 50%, black)` (≈ #0b0c14)

HR zone colors (used everywhere zones appear)
- Z1 neutral-700 #595d6c · Z2 accent-800 #423a6a · Z3 accent-600 #796cbf · Z4 accent-400 #b5abfc · Z5 accent-200 #e7e5fe
- Step kinds: Warm-up/Recovery/Cooldown neutral-600/700; Walk neutral-700/800; Run (work) accent-500 #968ae0

Type — Inter (400/500 only; headings never above 500). Numerals use `font-variant-numeric: tabular-nums`.
- Phone: screen title 26/500 · sheet title 18–20/500 · row title 13–14 · meta 11–12 · big metric 44–52/400, letter-spacing −0.02 to −0.03em
- Watch: hero metric 56–68/400 −0.03em · secondary 20–30/400 · labels 10–13

Spacing (density 0.7×): 2.8 · 5.6 · 8.4 · 11.2 · 16.8 · 22.4 px. Screens use 20px side padding, 6–18px gaps.
Radius: sm 4 · md 8 · lg 14 · sheet 22 (top corners) · pills 18–28 on watch.
Shadows: sm `0 0 0 1px #3f424d` · md `0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,.55)` · lg `0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,.65)`.
Accent glow (selected/primary): `box-shadow: 0 0 0 1px var(--color-accent), 0 0 22px -8px var(--color-accent)` on `--color-accent-900` fill.

Rules/dividers: 1px, fade to transparent over 48px each end:
`linear-gradient(90deg, transparent, var(--color-divider) 48px, var(--color-divider) calc(100% - 48px), transparent)`.

Buttons: primary = 1px accent outline on transparent, never filled (`.btn .btn-primary`); secondary/ghost per `styles.css`. Hover = accent tint, pressed = accent-400, focus = `outline: 2px solid var(--color-accent); outline-offset: 2px`. Disabled 45% opacity.

Icons: **Phosphor** (replace `lucide-react` with `@phosphor-icons/react`; on watch use Phosphor SVGs as vector drawables). Regular weight; fill weight for play/stop/heart/status icons.

Phone chrome: status bar 12/500; bottom TabBar (Home / Record / Stats) — 22px icons, 11px labels, active = accent-300 + fill icon, inactive = neutral-500, top border `--color-divider`, padding 10px 0 16px.

---

## Screens — Phone

### 1c · Start run (device hand-off)
Replaces the start area of `src/screens/Record.tsx` as a full-screen "New run" sheet opened from Record.
Background: `radial-gradient(90% 40% at 100% 100%, accent-900, bg 70%)`. Column, 20px padding, 18px gap.
1. Header: close X (20px, neutral-400) + "New run" 20/500.
2. Goal block: label "Goal · first of" 12 neutral-500; value row `5.00 km or 30:00` — numbers 44/400, units 14 neutral-400, "or" neutral-600. Below: tags Time / Distance / **Either** (tag-accent) / Plan… (tag-neutral). Maps to existing `goalType` none/time/distance/either; "Plan…" opens plan list.
3. "Record on" (12 neutral-400) + two radio cards (padding 14, radius md, gap 12):
   - **Phone** (selected: accent glow, accent-900 fill, icon accent-300): "Phone GPS · live HR from watch · cues on both"
   - **Watch only** (surface fill): "Leave the phone · watch GPS · uploads when back in range"
   - Radio: 16px circle; selected = inset 5px accent ring, unselected = inset 1.5px neutral-600.
4. Status list (12px, 8px gap): dot 6px + label + right value neutral-500:
   - "Galaxy Watch4 connected" · "82%" (dot accent-400 with glow) — from `WearBridge.isWatchConnected` + battery
   - "GPS locked" · "±4 m" — from `location.ts` accuracy
   - "Plans synced" · "2 min ago" (dot neutral-600) — last `syncPlans()` time
5. Bottom: full-width primary button "▶ Start run", 14px padding, 15px, extra glow `0 0 30px -8px accent`; 22px bottom margin.
Behavior: Phone → `new RecordingEngine(sport)` + plan as today. Watch only → send `/aera/cmd start:{planJson}` flagged standalone (Phase 4); disable if watch not connected. Disconnected watch: dot neutral-600, label "Watch not connected", Watch-only card disabled.

### 1d · Stats (evolves `src/screens/Stats.tsx`)
1. Title "Stats" 26/500.
2. Range segmented Week/**Month**/Year/All: surface track, 3px padding, radius md; active = accent-800 fill, accent-100 text; 12px.
3. 2×2 stat grid (gap 8): surface cards, 12 padding: accent-400 icon (path/timer/fire/mountains), value 20 tabular, label 11 neutral-500. Distance, Moving time, Activities, Elevation.
4. "Weekly distance" (trend-up icon, 14/500): 8 bars, 100px tall, gap 8, radius 3 top; past weeks accent-800, last-but-one accent-700, current week accent-500 + glow `0 0 14px -4px accent`. Week labels 9px neutral-600; current accent-300.
5. "All activities" list: sport icon neutral-400, title 13, date 11 neutral-500, distance 13 tabular, caret neutral-600; faded dividers between rows.
Remove emojis from the current list rows; use Phosphor sport icons (sneaker-move / person-simple-walk / bicycle).

### 1f · Calendar history (new, alternate view in Stats)
1. Header: month "September" 26/500 + caret-left/right (neutral-500) to change month.
2. Totals line (12 neutral-400, values 15 text): "14 sessions · 96.4 km · 9h 02m".
3. Weekday row M…S (10 neutral-600); month grid 7 columns, Monday start, cells 34×34.
   - Day with activity: filled circle, accent ramp, **diameter scales with that day's distance** (radial-gradient stop 40%–72% of cell). Color: small = accent-800, medium = accent-700/600, largest = accent-500 with bg-colored numeral.
   - Today: 1px inset accent ring, numeral accent-300. Future days neutral-700. Empty days neutral-500.
   - Tap a day → filters list below.
4. Session rows (gap 12): 44×44 route thumbnail (surface, radius md, polyline accent-400 1.6px from `summary.routePreview`); title + distance (13); **zone strip** 4px tall, flex segments proportional to `summary.hrZones` (Z1–Z5 colors, 1px gaps, radius 2); meta 11 neutral-500 "Tue 22 · 41:08 · avg 154 bpm · [watch]+[phone]" — source icons show which device recorded.

### 2a · Workout builder (replaces `IntervalBuilder.tsx`)
Background `radial-gradient(120% 45% at 0% 0%, accent-900, bg 70%)`.
1. Top bar: X · "New workout" 16/500 · "Save" 14 accent-300.
2. Name "Run-walk 1k / 1.5k" 24/500 (editable inline) + meta row: sport tag (tag-accent, sneaker icon) + "6 steps · ~29 min · ~3.9 km" 12 neutral-400.
3. **Step timeline**: 30px row, flex, gap 2, bars aligned bottom, radius 3. Flex = estimated seconds per step. Height: run 100% accent-500 (first run with glow), warm-up/recovery 45% neutral-700, walk 30% neutral-800.
4. Step list (gap 6). Row: padding 10×12, radius md, surface fill; 3px left kind stripe (stretch); kind name 13 + target type 11 neutral-500 with icon (timer = Time, ruler = Distance); value right 17 tabular (unit 11 neutral-400); drag handle `dots-six-vertical` neutral-600.
   - Distance (run) rows: accent-900 fill, `0 0 0 1px accent-700` edge, stripe accent-400, type label accent-300.
   - Sample: Warm-up 5:00 · Walk 2:00 · Run 1.00 km · Walk 2:00 · Run 1500 m · Recovery 5:00.
   - Tap row → 2b in edit mode. Long-press/drag handle → reorder. Swipe left → delete.
5. Actions (2-col grid, gap 8): secondary "+ Add step" (opens 2b), ghost "Repeat block" (wraps selected steps in N×).
6. Toggle "Save and stop when the last step ends" (= `autoFinish`), default on. Toggle 30×18, on = accent-800 fill + accent ring, knob accent-300.
7. Footer 11 neutral-500: watch icon + "Syncs to Watch4 when saved".
Estimates: time steps exact; distance steps use user's recent avg pace for that kind (fallback 6:00/km run, 10:00/km walk). Prefix "~".

### 2b · Add / edit step sheet
Bottom sheet over dimmed builder (builder at 35% opacity). Sheet: surface fill, radius 22 top, `--shadow-lg`, padding 10×20×22, gap 16; grab handle 36×4 neutral-700.
1. Header: "Step 5" 18/500 · right "after Walk 2:00" 12 neutral-500.
2. Type (12 neutral-400): tag chips Warm-up / Walk / **Run** / Recovery / Cooldown, padding 7×11; selected = tag-accent + 1px accent ring.
3. Ends after: 4-seg on bg track — Time (timer) / **Distance** (ruler) / Either / Tap(manual). Maps to `StepTarget.type` time / distance / either / manual.
4. Value: big 52/400 −0.03em, with 2px accent-400 caret. Unit seg m / km on right (distance) or mm:ss (time). Either shows both fields stacked.
5. Presets (tag-outline): 400 m · 800 m · 1 km · 1.5 km · 5 km (time mode: 1:00 · 2:00 · 5:00 · 10:00 · 20:00).
6. Keypad 3×4 (gap 6, bg cells, radius md, 20px digits): 1–9, ".", 0, backspace.
7. Primary block button "+ Add Run · 1500 m" (label reflects state; edit mode "Update step").
Validation: value > 0 (a zero target would end instantly — see `startRecording` guard). Distance stored in meters regardless of unit.

---

## Screens — Watch (Compose for Wear OS)
All faces: round, drawn in HTML at 280px (scale ×1.607 for 450px). Ground = OLED near-black; optional radial `accent-900 → ground 62%` behind hero metric. Keep content in the inner ~85% circle.
Hardware: Watch4 has a touch bezel (rotary events) + 2 side keys (Top = Home/back-long, Bottom = Back). Suggested mapping during recording: **Top key = lap / pause menu**, swipe right = pause screen, bezel = swipe between live layouts 1h / 1i / 1j.

### 1h · Live A — HR zone arc
- Arc r≈128 (of 140), 240° sweep starting at 150° (gap at bottom), split into 5 zone segments of 44° with 5° gaps, stroke 7 (active zone 9). Inactive zones at 30–60% opacity; active zone full.
- Marker: 7px dot accent-100 with 3px ground stroke at current HR position on the arc.
- Center stack: elapsed "18:24" 13 neutral-400 · heart icon (accent-400) + HR "152" 68/400 · "Z3 · Tempo" 13 accent-300 · row: pace "5:12 /km" and "3.42 km" (20px, unit 10 neutral-500), gap 22.

### 1i · Live B — four-metric stack
- Time "18:24" 34/400 · faded divider (190px) · 2-col: distance "3.42 km", pace "5:12 pace /km" (30/400, labels 10) · divider · heart + "152" 30/400 + mini 5-bar zone meter (5×6–16px, active bar accent-500 with glow, lower zones dim, higher neutral-800).
- Bottom: 5px dot + "GPS · phone" 10 neutral-500 (shows GPS source: phone / watch).

### 1j · Live C — interval step
- Full ring r=128, stroke 8, track neutral-900; progress accent-500 round cap + glow, starts at 12 o'clock, fraction = step progress (`PlanProgress.fraction`).
- "WORK 3 / 5" 13 uppercase +0.06em accent-300 · remaining "212 m" 60/400 (unit 22 neutral-400) — or mm:ss for time steps · "left of 800 m" 12 neutral-400 · pace + HR row 15px · bottom "Next · Recovery 1:30" 11 neutral-500.
- On step change: haptic (existing `/aera/cue` buzz) + ring resets.

### 1l · Paused
- "PAUSED" 12 uppercase +0.08em neutral-400 · time "18:24" 40/400 neutral-300 · "3.42 km · auto-paused at lights" 12 neutral-500 (omit reason if manual).
- Three round buttons, gap 14: Lap 48px (surface, flag icon) · **Resume 64px** (accent outline 1.5px + glow, play fill accent-300) · End 48px (surface, stop fill). Labels 10px below.
- End → confirm (hold 1 s or second tap) → 1m.

### 1m · Summary
- check-circle 24 accent-400 · "Run saved" 13 neutral-300 · 2×2 grid: "5.02 km", "26:11 time" (28/400) and "5:13 avg /km", "149 avg bpm" (18) · zone strip 150×5 · "⟳ Synced to phone" 10 neutral-500.
- Sync states: "Syncing…", "Synced to phone", "Will sync when phone is nearby" (Phase 5 DataClient upload).

### 2c · Watch step list
- Header "Run-walk · 6 steps" 11 neutral-500.
- `ScalingLazyColumn` of pills with the focused item centered: focused pill 210px wide, padding 9×14, radius 22, accent-900 + accent glow, icon (ruler/timer) accent-300, "3 Run" 15 + value 17 · neighbors shrink (200 → 180px) and fade (surface fill, 60% opacity at edges); far items plain text neutral-600.
- Last item: "+ Add step" 12 accent-300.
- Scroll indicator on the right edge: 3px arc track neutral-800 with accent-500 thumb.
- Bezel rotates focus; tap → 2d.

### 2d · Watch edit step
- Tick track: r=126, stroke 10, short neutral-800 ticks over 240° (from 150°). Value arc accent-500, 4px, round cap + glow, length = value / max. Knob 7px accent-100 dot at the arc end.
- "Step 5 · Run" 13 neutral-400 · mini seg Time / **Dist** (11px, active accent-800/accent-100) · value "1.50" 56/400 · "km · 50 m steps" 13 neutral-400 · confirm button 52px circle, 1.5px accent outline, check accent-300.
- Bezel increments: distance 50 m (<2 km), 100 m (<10 km), 500 m above; time 15 s (<5 min), 30 s, 1 min above. Haptic tick per detent. Tap seg to switch Time/Distance. ✓ saves and pushes via DataClient.

---

## Data model changes
Mixed workouts need an ordered step list instead of the fixed shape in `src/model/intervalPlan.ts`:

```ts
export interface PlanStepDef { id: string; kind: 'warmup'|'walk'|'run'|'work'|'recovery'|'cooldown'; target: StepTarget; }
export interface RepeatBlock { id: string; repeat: number; steps: PlanStepDef[]; }
export interface IntervalPlan {
  id: string; name: string; sport: Sport;
  steps: (PlanStepDef | RepeatBlock)[];   // NEW — ordered
  autoFinish: boolean; createdAt: string; updatedAt?: string; deleted?: boolean;
  // legacy: warmup/work/recovery/repeats/cooldown — migrate on read
}
```
- `flattenPlan` walks `steps` (expanding repeat blocks) → existing `PlanStep[]`; engine unchanged.
- Labels: "Run 1/2", "Walk 2/2", etc., per kind count.
- Migration: legacy plans → `[warmup?, repeat{work, recovery?}×N, cooldown?]`. Bump Dexie schema.
- `planSummary`: "WU 5:00 · Walk 2:00 · Run 1 km · Walk 2:00 · Run 1.5 km · Rec 5:00" (truncate after 4 with "+N").
- Watch: same JSON over `/aera/plan/{id}` DataItems (LWW on `updatedAt`, already in `planSync.ts`). Kotlin data class mirrors the TS shape.

## State
Phone — Start (1c): `sport`, `goalType`, `goalSec`, `goalKm`, `recordOn: 'phone'|'watch'`, `watchConnected`, `watchBattery`, `gpsAccuracyM`, `lastPlanSyncAt`.
Stats (1d/1f): `range`, `view: 'summary'|'calendar'`, `month`, `selectedDay`.
Builder (2a/2b): `draftPlan`, `editingStepId | null`, `sheetOpen`, sheet local `{kind, targetType, value, unit}`; Save → `db.plans.put` + `pushOnePlan`.
Watch: `liveLayout: 0|1|2` (persisted), `paused`, `currentStep`, `stepProgress`, `syncState`; editor `focusedIndex`, `editValue`, `editType`.

## Assets
- Icons: Phosphor (sneaker-move, person-simple-walk, bicycle, timer, ruler, path, fire, mountains, heart, flag, play, stop, check, check-circle, arrows-clockwise, watch, device-mobile, plus, repeat, dots-six-vertical, caret-*, x, backspace).
- Font: Inter 400/500.
- No images. Route thumbnails are drawn from `summary.routePreview`.

## Files
- `aera Screens.dc.html` — every screen (open in a browser; badges 1c…2d match this README).
- `_ds/nocturne-…/styles.css` — Nocturne tokens + component classes (`.btn`, `.tag`, `.seg`, `.card`…).
- `support.js`, `_ds/…/_ds_bundle.js` — needed only to open the HTML locally.
- Repo mapping: 1c → `src/screens/Record.tsx`; 1d/1f → `src/screens/Stats.tsx`; 2a/2b → `src/screens/IntervalBuilder.tsx` + `src/model/intervalPlan.ts`; watch → `android/wear/src/…/MainActivity` (split into Compose screens), `src/sync/planSync.ts`.
