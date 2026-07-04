import type { Lap, Sport, TrackPoint, Workout } from '@/model/workout';
import { deriveSummary, haversine } from '@/metrics/deriveSummary';
import { saveWorkout } from '@/db/db';
import { effectiveMaxHr, loadProfile } from '@/store/profile';
import type { LocationSample } from './location';

export type RecStatus = 'idle' | 'recording' | 'paused';

/** Live read-out pushed to the UI on every sample / tick. */
export interface LiveStats {
  status: RecStatus;
  elapsedSec: number; // wall time since start, excluding paused spans
  distanceM: number;
  paceSecPerKm: number | null; // run/walk
  speedKmh: number | null; // ride
  currentPaceSecPerKm: number | null; // last ~30s
  points: TrackPoint[];
  lapCount: number;
}

const RESUME_KEY = 'aera.activeRecording';

interface Persisted {
  sport: Sport;
  startedAtMs: number;
  pausedMs: number;
  points: TrackPoint[];
  lapStartsMs: number[];
  status: RecStatus;
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

  constructor(sport: Sport) {
    this.sport = sport;
  }

  subscribe(fn: (s: LiveStats) => void): () => void {
    this.listeners.add(fn);
    fn(this.stats());
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (this.status !== 'idle') return;
    this.startedAtMs = Date.now();
    this.status = 'recording';
    this.emit();
  }

  /** Elapsed recording ms (excludes paused spans, including one in progress). */
  private elapsedMs(now = Date.now()): number {
    const inProgressPause = this.status === 'paused' ? now - this.pauseStartedMs : 0;
    return now - this.startedAtMs - this.pausedMs - inProgressPause;
  }

  addSample(s: LocationSample): void {
    if (this.status !== 'recording') return;
    const t = this.elapsedMs(s.ts);
    if (t < 0) return;
    const prev = this.points[this.points.length - 1];
    if (prev) this.distanceM += haversine(prev.lat, prev.lng, s.lat, s.lng);
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
    this.maybePersist();
    this.emit();
  }

  pause(): void {
    if (this.status !== 'recording') return;
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

  /** Mark a manual lap boundary at the current elapsed time. */
  lap(): void {
    if (this.status === 'idle') return;
    this.lapStartsMs.push(this.elapsedMs());
    this.emit();
  }

  /** A short "ticker" nudge so the timer advances without new GPS fixes. */
  tick(): void {
    if (this.status === 'recording') this.emit();
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
    // Manual laps override the derived interval split when the user tapped Lap.
    if (this.lapStartsMs.length > 1) {
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
