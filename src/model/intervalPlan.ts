import type { Sport } from './workout';

/** A phase of a structured interval workout. 'work' is legacy; 'run' is its replacement. */
export type StepKind = 'warmup' | 'walk' | 'run' | 'work' | 'recovery' | 'cooldown';

/** How a step ends: after a time, after a distance, or on a manual tap. */
export type StepTarget =
  | { type: 'time'; sec: number }
  | { type: 'distance'; m: number }
  | { type: 'either'; sec: number; m: number } // whichever is reached first
  | { type: 'manual' };

/** One authored step in a plan's ordered `steps` list. */
export interface PlanStepDef {
  id: string;
  kind: StepKind;
  target: StepTarget;
}

/** N repetitions of a small group of steps (e.g. work + recovery). */
export interface RepeatBlock {
  id: string;
  repeat: number;
  steps: PlanStepDef[];
}

/**
 * A reusable interval template, authored as an ordered list of steps (and
 * repeat blocks). Flattened to `PlanStep[]` for the recording engine via
 * `flattenPlan`.
 */
export interface IntervalPlan {
  id: string;
  name: string;
  sport: Sport;
  steps: (PlanStepDef | RepeatBlock)[];
  autoFinish: boolean; // stop+save on completion, vs keep recording untimed
  createdAt: string;
  /** ISO timestamp of the last edit; missing on old rows (fall back to createdAt). */
  updatedAt?: string;
  /** Tombstone: deleted locally or remotely, kept around so sync can propagate it. */
  deleted?: boolean;

  // --- legacy shape (pre-`steps`), kept optional for reading old rows only ---
  warmup?: StepTarget | null;
  work?: StepTarget;
  recovery?: StepTarget | null;
  repeats?: number;
  cooldown?: StepTarget | null;
}

/** `updatedAt`, defaulting to `createdAt` for plans saved before it existed. */
export function planUpdatedAt(p: IntervalPlan): string {
  return p.updatedAt ?? p.createdAt;
}

/**
 * Convert a legacy-shaped plan (warmup/work/recovery/repeats/cooldown) into
 * the `steps` shape, dropping the legacy fields. Pure and idempotent: a plan
 * that already has `steps` is returned with only the legacy fields stripped.
 */
export function migratePlan(p: IntervalPlan): IntervalPlan {
  const { warmup, work, recovery, repeats, cooldown, ...rest } = p;
  // New shape: has steps (possibly empty, e.g. a fresh draft) and no legacy work field.
  if (Array.isArray(p.steps) && (p.steps.length || !work)) return { ...rest, steps: p.steps };

  const steps: (PlanStepDef | RepeatBlock)[] = [];
  if (warmup) steps.push({ id: crypto.randomUUID(), kind: 'warmup', target: warmup });
  const n = Math.max(1, repeats ?? 1);
  const workTarget = work ?? { type: 'manual' as const };
  const repSteps: PlanStepDef[] = [{ id: crypto.randomUUID(), kind: 'work', target: workTarget }];
  if (recovery) repSteps.push({ id: crypto.randomUUID(), kind: 'recovery', target: recovery });
  if (n <= 1) {
    steps.push(...repSteps);
  } else {
    steps.push({ id: crypto.randomUUID(), repeat: n, steps: repSteps });
  }
  if (cooldown) steps.push({ id: crypto.randomUUID(), kind: 'cooldown', target: cooldown });

  return { ...rest, steps };
}

/** One concrete step the engine walks through. */
export interface PlanStep {
  kind: StepKind;
  target: StepTarget;
  label: string; // e.g. "Warm-up", "Run 1/2", "Work 3/5", "Cooldown"
}

const KIND_LABEL: Record<StepKind, string> = {
  warmup: 'Warm-up',
  walk: 'Walk',
  run: 'Run',
  work: 'Work',
  recovery: 'Recovery',
  cooldown: 'Cooldown',
};

/** Expand an authored plan into the flat ordered step list the engine runs. */
export function flattenPlan(p: IntervalPlan): PlanStep[] {
  const m = migratePlan(p);
  const flat: { kind: StepKind; target: StepTarget }[] = [];
  const walk = (items: (PlanStepDef | RepeatBlock)[]) => {
    for (const it of items) {
      if ('repeat' in it) {
        for (let i = 0; i < Math.max(1, it.repeat); i++) walk(it.steps);
      } else {
        flat.push({ kind: it.kind, target: it.target });
      }
    }
  };
  walk(m.steps);

  const totals: Partial<Record<StepKind, number>> = {};
  for (const s of flat) totals[s.kind] = (totals[s.kind] ?? 0) + 1;
  const counters: Partial<Record<StepKind, number>> = {};
  return flat.map((s) => {
    const n = totals[s.kind]!;
    const i = (counters[s.kind] = (counters[s.kind] ?? 0) + 1);
    // Legacy 'work' always shows "Work i/n" (as before); others only when count > 1.
    const label =
      s.kind === 'work' ? `Work ${i}/${n}` : n > 1 ? `${KIND_LABEL[s.kind]} ${i}/${n}` : KIND_LABEL[s.kind];
    return { kind: s.kind, target: s.target, label };
  });
}

/** Short human-readable target, e.g. "2:15", "400 m", "manual". */
export function fmtTarget(t: StepTarget): string {
  if (t.type === 'time') {
    const m = Math.floor(t.sec / 60);
    const s = t.sec % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  }
  if (t.type === 'distance') {
    return t.m >= 1000 ? `${(t.m / 1000).toFixed(2)} km` : `${t.m} m`;
  }
  if (t.type === 'either') {
    const dist = t.m >= 1000 ? `${(t.m / 1000).toFixed(2)} km` : `${t.m} m`;
    return `${fmtTarget({ type: 'time', sec: t.sec })} or ${dist}`;
  }
  return 'manual';
}

const KIND_ABBR: Record<StepKind, string> = {
  warmup: 'WU',
  walk: 'Walk',
  run: 'Run',
  work: 'Work',
  recovery: 'Rec',
  cooldown: 'CD',
};

/** One-line summary for the plan list, e.g. "WU 5:00 · Walk 2:00 · Run 1 km · …". */
export function planSummary(p: IntervalPlan): string {
  const m = migratePlan(p);
  const parts: string[] = [];
  for (const it of m.steps) {
    if ('repeat' in it) {
      const inner = it.steps.map((s) => `${KIND_ABBR[s.kind]} ${fmtTarget(s.target)}`).join(' / ');
      parts.push(`${Math.max(1, it.repeat)}×(${inner})`);
    } else {
      parts.push(`${KIND_ABBR[it.kind]} ${fmtTarget(it.target)}`);
    }
  }
  if (parts.length > 4) return `${parts.slice(0, 4).join(' · ')} +${parts.length - 4}`;
  return parts.join(' · ');
}

const DEFAULT_RUN_PACE_SEC_PER_KM = 360; // 6:00/km
const DEFAULT_WALK_PACE_SEC_PER_KM = 600; // 10:00/km

/** run/work/warmup/cooldown use run pace; walk/recovery use walk pace. */
export function paceFor(kind: StepKind, pace?: { run?: number; walk?: number }): number {
  const run = pace?.run ?? DEFAULT_RUN_PACE_SEC_PER_KM;
  const walk = pace?.walk ?? DEFAULT_WALK_PACE_SEC_PER_KM;
  // Easy steps (warm-up, walk, recovery, cooldown) at walk pace; run/work at run pace.
  return kind === 'run' || kind === 'work' ? run : walk;
}

export interface PlanEstimate {
  steps: number;
  sec: number;
  m: number;
  approx: boolean; // true when any step's number comes from a pace estimate, not an exact target
}

/**
 * Estimated duration/distance for a plan, for the builder meta row. Time
 * targets are exact for `sec`; every target also gets an `m` estimate via
 * pace (so a time-only plan still shows a distance), which is why the whole
 * estimate is `approx` unless every step is a bare distance target.
 */
export function planEstimate(p: IntervalPlan, pace?: { run?: number; walk?: number }): PlanEstimate {
  const steps = flattenPlan(p);
  let sec = 0;
  let m = 0;
  let approx = false;
  for (const s of steps) {
    const t = s.target;
    const stepPace = paceFor(s.kind, pace);
    if (t.type === 'time') {
      sec += t.sec;
      m += (t.sec / stepPace) * 1000;
      approx = true; // distance side is estimated
    } else if (t.type === 'distance') {
      m += t.m;
      sec += (t.m / 1000) * stepPace;
      approx = true; // time side is estimated
    } else if (t.type === 'either') {
      const distSec = (t.m / 1000) * stepPace;
      const useSec = Math.min(t.sec, distSec);
      sec += useSec;
      m += (useSec / stepPace) * 1000;
      approx = true;
    } else {
      approx = true; // manual: no target, contributes nothing
    }
  }
  return { steps: steps.length, sec, m, approx };
}

/** "6 steps · ~29 min · ~3.9 km" — ~ only when approx; km part omitted when 0. */
export function fmtPlanMeta(est: PlanEstimate): string {
  const tilde = est.approx ? '~' : '';
  const min = Math.round(est.sec / 60);
  const parts = [`${est.steps} ${est.steps === 1 ? 'step' : 'steps'}`, `${tilde}${min} min`];
  if (est.m > 0) parts.push(`${tilde}${(est.m / 1000).toFixed(1)} km`);
  return parts.join(' · ');
}
