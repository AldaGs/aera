import type { Lap, Sport, TrackPoint, Workout } from '@/model/workout';
import type { PlanStep, StepKind } from '@/model/intervalPlan';
import { deriveSummary, haversine } from '@/metrics/deriveSummary';
import { saveWorkout } from '@/db/db';
import { effectiveMaxHr, loadProfile } from '@/store/profile';
import type { LocationSample } from './location';

export type RecStatus = 'idle' | 'recording' | 'paused';

/** Live progress through the active interval plan. */
export interface PlanProgress {
  stepIndex: number;
  total: number;
  kind: StepKind;
  label: string;
  targetType: 'time' | 'distance' | 'manual';
  remaining: number | null; // seconds (time) or meters (distance) left; null for manual
  fraction: number; // 0..1 progress through the current step
  rep: number; // current work rep (1-based)
  reps: number; // total work reps
  next: string | null; // next step label
  complete: boolean;
}

/** Live read-out pushed to the UI on every sample / tick. */
export interface LiveStats {
  status: RecStatus;
  elapsedSec: number; // moving time since start, excluding manual + auto pauses
  distanceM: number;
  paceSecPerKm: number | null; // run/walk
  speedKmh: number | null; // ride
  currentPaceSecPerKm: number | null; // last ~30s
  points: TrackPoint[];
  lapCount: number;
  autoPaused: boolean; // GPS says you've stopped moving
  plan?: PlanProgress; // present while a structured plan is running
}

const RESUME_KEY = 'aera.activeRecording';

// GPS quality / movement gates.
const MAX_ACCURACY_M = 25; // drop fixes less certain than this (indoors, cold GPS)
const STATIONARY_SPEED_MS = 0.5; // below this we're standing still, not moving
const AUTO_PAUSE_AFTER_MS = 6000; // stationary this long → auto-pause the clock

interface LapMeta {
  kind: StepKind;
  label: string;
}

interface Persisted {
  sport: Sport;
  startedAtMs: number;
  pausedMs: number;
  points: TrackPoint[];
  lapStartsMs: number[];
  status: RecStatus;
  plan?: PlanStep[] | null;
  planAutoFinish?: boolean;
  stepIndex?: number;
  stepStartMs?: number;
  stepStartDist?: number;
  lapMeta?: LapMeta[];
  planComplete?: boolean;
}

/**
 * Records a live GPS workout. Framework-agnostic: feed it `addSample()` from the
 * location stream and subscribe for live stats. Optionally supply an `hrProvider`
 * (a future BLE-strap / watch source) to stamp heart rate onto each point.
 */
export class RecordingEngine {
  sport: Sport;
  status: RecStatus = 'idle';
  hrProvider: (() => number | null) | null = null;

  private points: TrackPoint[] = [];
  private startedAtMs = 0;
  private pausedMs = 0;
  private pauseStartedMs = 0;
  private lapStartsMs: number[] = [0];
  private distanceM = 0;
  private listeners = new Set<(s: LiveStats) => void>();
  private lastPersist = 0;
  // Movement filtering / auto-pause bookkeeping (wall-clock ms).
  private lastFixWall = 0; // last accepted fix
  private lastMoveWall = 0; // last accepted *moving* fix
  private autoPaused = false;
  private autoPauseStartedMs = 0;
  // Structured interval plan (optional).
  private plan: PlanStep[] | null = null;
  private planAutoFinish = true;
  private stepIndex = 0;
  private stepStartMs = 0; // elapsed ms at current step start
  private stepStartDist = 0;
  private lapMeta: LapMeta[] = []; // one per lapStartsMs boundary
  private planComplete = false;
  /** Fired on each step transition (entering `kind`, or 'done' at plan end). */
  onCue: ((kind: StepKind | 'done') => void) | null = null;

  constructor(sport: Sport) {
    this.sport = sport;
  }

  /** Attach a structured interval plan; call before start(). */
  setPlan(steps: PlanStep[], autoFinish: boolean): void {
    this.plan = steps.length ? steps : null;
    this.planAutoFinish = autoFinish;
    this.stepIndex = 0;
    this.stepStartMs = 0;
    this.stepStartDist = 0;
    this.planComplete = false;
    this.lapMeta = this.plan
      ? [{ kind: this.plan[0].kind, label: this.plan[0].label }]
      : [];
  }

  subscribe(fn: (s: LiveStats) => void): () => void {
    this.listeners.add(fn);
    fn(this.stats());
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (this.status !== 'idle') return;
    this.startedAtMs = Date.now();
    this.lastMoveWall = this.startedAtMs;
    this.status = 'recording';
    this.emit();
  }

  /** Moving-time ms — excludes manual pause + auto-pause (incl. ones in progress). */
  private elapsedMs(now = Date.now()): number {
    let pause = this.pausedMs;
    if (this.status === 'paused') pause += now - this.pauseStartedMs;
    if (this.autoPaused) pause += now - this.autoPauseStartedMs;
    return now - this.startedAtMs - pause;
  }

  private maxSpeedMs(): number {
    return this.sport === 'ride' ? 30 : 12.5; // teleport guard (GPS jumps)
  }

  addSample(s: LocationSample): void {
    if (this.status !== 'recording') return;
    // Drop low-confidence fixes outright (cold GPS, indoors, urban canyon).
    if (s.accuracy != null && s.accuracy > MAX_ACCURACY_M) {
      this.emit();
      return;
    }

    const now = s.ts;
    const prev = this.points[this.points.length - 1];

    if (prev) {
      const segDist = haversine(prev.lat, prev.lng, s.lat, s.lng);
      const wallDt = (now - this.lastFixWall) / 1000;
      const derivedSpeed = wallDt > 0 ? segDist / wallDt : 0;
      // Prefer the GPS chip's Doppler speed — it reads ~0 when stationary even
      // as the position wobbles, which is exactly the couch-drift case.
      const speed = s.speed != null && s.speed >= 0 ? s.speed : derivedSpeed;
      const noiseFloor = Math.max(4, (s.accuracy ?? 0) * 0.5);

      const teleport = derivedSpeed > this.maxSpeedMs();
      const stationary = speed < STATIONARY_SPEED_MS || segDist < noiseFloor;
      if (teleport || stationary) {
        this.emit(); // keep the timer ticking; just don't log noise/drift
        return;
      }
      // Genuine movement: resume from any auto-pause and count the segment.
      this.clearAutoPause();
      this.lastMoveWall = Date.now();
      this.distanceM += segDist;
    } else {
      this.lastMoveWall = Date.now();
    }

    this.lastFixWall = now;
    const t = this.elapsedMs(now);
    if (t < 0) return;
    this.points.push({
      t,
      lat: s.lat,
      lng: s.lng,
      alt: s.alt != null && Number.isFinite(s.alt) ? s.alt : null,
      hr: this.hrProvider?.() ?? null,
      cad: null,
      speed: s.speed,
      power: null,
    });
    this.checkPlanAdvance();
    this.maybePersist();
    this.emit();
  }

  /** Advance the plan when the current step's time/distance target is met. */
  private checkPlanAdvance(): void {
    if (!this.plan || this.status !== 'recording' || this.planComplete) return;
    const target = this.plan[this.stepIndex].target;
    let met = false;
    if (target.type === 'time') {
      met = this.elapsedMs() - this.stepStartMs >= target.sec * 1000;
    } else if (target.type === 'distance') {
      met = this.distanceM - this.stepStartDist >= target.m;
    }
    // 'manual' steps advance via lap()/next().
    if (met) this.advanceStep();
  }

  private advanceStep(): void {
    if (!this.plan || this.planComplete) return;
    const nextIdx = this.stepIndex + 1;
    if (nextIdx >= this.plan.length) {
      this.planComplete = true;
      this.onCue?.('done');
      // Keep-recording mode: drop the plan and continue as a free run.
      if (!this.planAutoFinish) this.plan = null;
      this.persist();
      this.emit();
      return;
    }
    const now = this.elapsedMs();
    this.lapStartsMs.push(now);
    const next = this.plan[nextIdx];
    this.lapMeta.push({ kind: next.kind, label: next.label });
    this.stepIndex = nextIdx;
    this.stepStartMs = now;
    this.stepStartDist = this.distanceM;
    this.onCue?.(next.kind);
    this.emit();
  }

  private clearAutoPause(): void {
    if (this.autoPaused) {
      this.pausedMs += Date.now() - this.autoPauseStartedMs;
      this.autoPaused = false;
    }
  }

  pause(): void {
    if (this.status !== 'recording') return;
    this.clearAutoPause();
    this.pauseStartedMs = Date.now();
    this.status = 'paused';
    this.persist();
    this.emit();
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.pausedMs += Date.now() - this.pauseStartedMs;
    this.status = 'recording';
    this.emit();
  }

  /** Mark a lap boundary / advance the plan (manual steps, or skip early). */
  lap(): void {
    if (this.status === 'idle') return;
    if (this.plan && !this.planComplete) {
      this.advanceStep();
      return;
    }
    this.lapStartsMs.push(this.elapsedMs());
    this.emit();
  }

  /** A 1 s ticker: advances the timer, trips auto-pause, and steps the plan. */
  tick(): void {
    if (this.status !== 'recording') return;
    // Auto-pause is disabled during a plan: standing still in a timed recovery
    // must not freeze the interval clock.
    if (
      !this.plan &&
      !this.autoPaused &&
      this.lastMoveWall > 0 &&
      Date.now() - this.lastMoveWall > AUTO_PAUSE_AFTER_MS
    ) {
      this.autoPaused = true;
      this.autoPauseStartedMs = Date.now();
    }
    this.checkPlanAdvance();
    this.emit();
  }

  /** Finish, persist a normalized Workout, and clear resume state. Null if too short. */
  async finish(): Promise<Workout | null> {
    this.status = 'idle';
    clearResume();
    if (this.points.length < 2) return null;

    const profile = loadProfile();
    const summary = deriveSummary(this.points, this.sport, {
      maxHr: effectiveMaxHr(profile),
      restingHr: profile.restingHr,
      weightKg: profile.weightKg,
    });
    // Planned interval laps (typed + labeled) win; else manual laps; else the
    // derived split from deriveSummary.
    if (this.lapMeta.length > 0) {
      summary.laps = this.buildPlannedLaps();
    } else if (this.lapStartsMs.length > 1) {
      summary.laps = this.buildManualLaps();
    }

    const startISO = new Date(this.startedAtMs).toISOString();
    const workout: Workout = {
      id: crypto.randomUUID(),
      sport: this.sport,
      source: 'manual',
      startedAt: startISO,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      track: this.points,
      summary,
      title: `${partOfDay(this.startedAtMs)} ${sportLabel(this.sport)}`,
      notes: '',
      athleteId: 'me',
      externalId: null,
    };
    await saveWorkout(workout);
    return workout;
  }

  discard(): void {
    this.status = 'idle';
    clearResume();
  }

  private buildManualLaps(): Lap[] {
    const bounds = [...this.lapStartsMs, this.elapsedMs()];
    const laps: Lap[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const startMs = bounds[i];
      const endMs = bounds[i + 1];
      const seg = this.points.filter((p) => p.t >= startMs && p.t <= endMs);
      let dist = 0;
      const hrs: number[] = [];
      for (let j = 1; j < seg.length; j++) {
        dist += haversine(seg[j - 1].lat, seg[j - 1].lng, seg[j].lat, seg[j].lng);
        if (seg[j].hr != null) hrs.push(seg[j].hr!);
      }
      const durationSec = (endMs - startMs) / 1000;
      const km = dist / 1000;
      laps.push({
        index: i,
        type: this.sport,
        startMs,
        endMs,
        distanceM: dist,
        durationSec,
        avgPaceSecPerKm: km > 0 ? durationSec / km : null,
        avgHr: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null,
      });
    }
    return laps;
  }

  /** Type + label the plan boundaries into laps (recovery → 'rest', else sport). */
  private buildPlannedLaps(): Lap[] {
    const base = this.buildManualLaps();
    return base.map((lap, i) => {
      const meta = this.lapMeta[i];
      if (!meta) return lap;
      return {
        ...lap,
        type: meta.kind === 'recovery' ? 'rest' : this.sport,
        label: meta.label,
      };
    });
  }

  private planProgress(): PlanProgress | undefined {
    if (!this.plan) return undefined;
    const step = this.plan[this.stepIndex];
    const t = step.target;
    let remaining: number | null = null;
    let fraction = 0;
    if (t.type === 'time') {
      remaining = Math.max(0, t.sec - (this.elapsedMs() - this.stepStartMs) / 1000);
      fraction = t.sec > 0 ? 1 - remaining / t.sec : 0;
    } else if (t.type === 'distance') {
      remaining = Math.max(0, t.m - (this.distanceM - this.stepStartDist));
      fraction = t.m > 0 ? 1 - remaining / t.m : 0;
    }
    const reps = this.plan.filter((s) => s.kind === 'work').length;
    const rep = this.plan
      .slice(0, this.stepIndex + 1)
      .filter((s) => s.kind === 'work').length;
    const next = this.plan[this.stepIndex + 1];
    return {
      stepIndex: this.stepIndex,
      total: this.plan.length,
      kind: step.kind,
      label: step.label,
      targetType: t.type,
      remaining,
      fraction,
      rep,
      reps,
      next: next ? next.label : null,
      complete: this.planComplete,
    };
  }

  private stats(): LiveStats {
    const elapsedSec = this.status === 'idle' ? 0 : this.elapsedMs() / 1000;
    const km = this.distanceM / 1000;
    const usesPace = this.sport === 'run' || this.sport === 'walk';
    return {
      status: this.status,
      elapsedSec,
      distanceM: this.distanceM,
      paceSecPerKm: usesPace && km > 0 ? elapsedSec / km : null,
      speedKmh: !usesPace && elapsedSec > 0 ? km / (elapsedSec / 3600) : null,
      currentPaceSecPerKm: this.recentPace(),
      points: this.points,
      lapCount: this.lapStartsMs.length,
      autoPaused: this.status === 'recording' && this.autoPaused,
      plan: this.planProgress(),
    };
  }

  /** Pace over roughly the last 30 seconds of movement. */
  private recentPace(): number | null {
    if (this.sport === 'ride') return null;
    const n = this.points.length;
    if (n < 2) return null;
    const cutoff = this.points[n - 1].t - 30000;
    let dist = 0;
    let i = n - 1;
    while (i > 0 && this.points[i - 1].t >= cutoff) {
      dist += haversine(
        this.points[i - 1].lat,
        this.points[i - 1].lng,
        this.points[i].lat,
        this.points[i].lng,
      );
      i--;
    }
    const dt = (this.points[n - 1].t - this.points[i].t) / 1000;
    const km = dist / 1000;
    return km > 0.005 ? dt / km : null;
  }

  private emit(): void {
    const s = this.stats();
    for (const fn of this.listeners) fn(s);
  }

  private maybePersist(): void {
    const now = Date.now();
    if (now - this.lastPersist > 5000) this.persist();
  }

  private persist(): void {
    this.lastPersist = Date.now();
    const data: Persisted = {
      sport: this.sport,
      startedAtMs: this.startedAtMs,
      pausedMs: this.pausedMs,
      points: this.points,
      lapStartsMs: this.lapStartsMs,
      status: this.status,
      plan: this.plan,
      planAutoFinish: this.planAutoFinish,
      stepIndex: this.stepIndex,
      stepStartMs: this.stepStartMs,
      stepStartDist: this.stepStartDist,
      lapMeta: this.lapMeta,
      planComplete: this.planComplete,
    };
    try {
      localStorage.setItem(RESUME_KEY, JSON.stringify(data));
    } catch {
      // storage full / unavailable — recording continues in memory
    }
  }

  /** Rehydrate an interrupted recording (e.g. app was killed mid-run). */
  static resumeFromStorage(): RecordingEngine | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(RESUME_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const d = JSON.parse(raw) as Persisted;
      if (!d.points?.length) return null;
      const e = new RecordingEngine(d.sport);
      e.startedAtMs = d.startedAtMs;
      e.pausedMs = d.pausedMs;
      e.points = d.points;
      e.lapStartsMs = d.lapStartsMs ?? [0];
      e.status = d.status === 'paused' ? 'paused' : 'recording';
      e.lastMoveWall = Date.now();
      e.lastFixWall = Date.now();
      e.plan = d.plan ?? null;
      e.planAutoFinish = d.planAutoFinish ?? true;
      e.stepIndex = d.stepIndex ?? 0;
      e.stepStartMs = d.stepStartMs ?? 0;
      e.stepStartDist = d.stepStartDist ?? 0;
      e.lapMeta = d.lapMeta ?? [];
      e.planComplete = d.planComplete ?? false;
      for (let i = 1; i < e.points.length; i++) {
        e.distanceM += haversine(
          e.points[i - 1].lat,
          e.points[i - 1].lng,
          e.points[i].lat,
          e.points[i].lng,
        );
      }
      return e;
    } catch {
      return null;
    }
  }
}

export function hasResumableRecording(): boolean {
  try {
    return !!localStorage.getItem(RESUME_KEY);
  } catch {
    return false;
  }
}

function clearResume(): void {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    // ignore
  }
}

function sportLabel(s: Sport): string {
  return s === 'run' ? 'Run' : s === 'walk' ? 'Walk' : 'Ride';
}

function partOfDay(ms: number): string {
  const h = new Date(ms).getHours();
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Night';
}
