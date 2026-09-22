# Plan: goal-based workouts on phone + watch

Goal: record workouts with time/distance goals (single or combined), auto-pause,
auto-stop on goal, authored on phone **or** watch, synced on reconnect.

Status as of 2026-09-22: phone engine already supports sequenced time/distance/manual
steps, `autoFinish`, and GPS auto-pause (disabled during plans). Watch is an HR
sensor + step mirror only.

Commit or drop the uncommitted Wear companion changes before starting.

---

## Phase 1 — Phone gaps (≈1 day)

1. **Auto-pause during plans** — `src/record/engine.ts` `tick()`
   - Allow auto-pause when the current step target is `distance` (or no plan).
   - Keep it off for `time` steps (recovery must keep ticking).
   - Check: stationary 7 s in a distance step → `autoPaused` true; in a time step → false.
2. **"First of" goal** — `src/model/intervalPlan.ts`
   - Add `StepTarget` variant `{ type: 'either'; sec: number; m: number }`.
   - `checkPlanAdvance`: met if time OR distance reached.
   - `PlanProgress.remaining`: report whichever is closer (fraction = max of both).
   - Builder + LiveRecorder labels.
3. **Quick goal** — `src/screens/Record.tsx`
   - Picker: None / Time / Distance / Both(first of). Builds a 1-step plan
     (`kind: 'work'`, `autoFinish: true`) on the fly; not saved.
4. **km/m units** — `IntervalBuilder.tsx`: unit toggle, store meters.

Done when: a "5 km or 30 min" quick run auto-pauses at lights and auto-saves on goal.

## Phase 2 — Plan sync phone ⇄ watch

- Add `updatedAt` + `deleted` (tombstone) to `IntervalPlan`; bump Dexie schema.
- Transport: Wear **DataClient** (persisted, delivered on reconnect), one DataItem
  per plan at `/aera/plan/{id}` with the plan JSON.
- Phone: `WearBridgePlugin` gets `putPlan(json)` / `deletePlan(id)` + emits
  `planChanged` from `WearMessageListener.onDataChanged`.
- Merge rule: last-writer-wins on `updatedAt` per plan id.
- On app start and on `isWatchConnected` → push all local plans (idempotent).
- Watch: stores plans from DataClient (it's already a local cache; no DB needed).

Done when: plan edited on phone while watch is off appears on watch after reconnect,
and vice versa.

## Phase 3 — Watch plan picker + editor (minimal)

- Watch screen: list plans → start. Start sends `/aera/cmd start:{planId}` if phone
  connected (phone records, watch mirrors as today), else Phase 4 standalone.
- Editor on watch: only Quick goal (time / distance / first-of) — full interval
  authoring stays on phone. Quick goals saved as plans sync back via Phase 2.

## Phase 4 — Standalone watch recording

- Use **Health Services `ExerciseClient`**: gives GPS, distance, duration, HR,
  built-in auto-pause (`setIsAutoPauseAndResumeEnabled`) and `ExerciseGoal`s
  (distance/duration milestones) → no engine port for single goals.
- Step walking for interval plans: small Kotlin loop on `ExerciseUpdate`
  (duration/distance deltas per step), same rules as `engine.ts`.
- On goal complete + `autoFinish` → `endExercise()`.
- Ongoing Activity + foreground service (reuse `HrService` pattern).

## Phase 5 — Watch → phone workout upload

- On finish, write workout JSON (points, laps, HR samples) to DataClient
  `/aera/workout/{id}`; phone listener imports via existing `saveWorkout`,
  then deletes the DataItem (ack).
- Dedup by id. Large tracks: use `Asset` if payload > 100 KB.

---

## Out of scope (add when needed)
- Full interval editor on the watch.
- Conflict UI (LWW is enough for one user).
- Cloud sync / Health Connect export from watch.

## Verification per phase
- Phase 1: unit check in `engine.ts` companion test (fake samples + ticks).
- Phases 2–5: manual on device pair; toggle Bluetooth to test reconnect.
