import type { Sport } from './workout';

/** A phase of a structured interval workout. */
export type StepKind = 'warmup' | 'work' | 'recovery' | 'cooldown';

/** How a step ends: after a time, after a distance, or on a manual tap. */
export type StepTarget =
  | { type: 'time'; sec: number }
  | { type: 'distance'; m: number }
  | { type: 'manual' };

/**
 * A reusable interval template: warm-up + N×(work + recovery) + optional cooldown.
 * Authoring shape (what the builder edits & stores); flattened to `PlanStep[]` for
 * the recording engine via `flattenPlan`.
 */
export interface IntervalPlan {
  id: string;
  name: string;
  sport: Sport;
  warmup: StepTarget | null;
  work: StepTarget; // per rep
  recovery: StepTarget | null; // per rep
  repeats: number; // N
  cooldown: StepTarget | null;
  autoFinish: boolean; // stop+save on completion, vs keep recording untimed
  createdAt: string;
}

/** One concrete step the engine walks through. */
export interface PlanStep {
  kind: StepKind;
  target: StepTarget;
  label: string; // e.g. "Warm-up", "Work 3/5", "Recovery 3/5", "Cooldown"
}

const KIND_LABEL: Record<StepKind, string> = {
  warmup: 'Warm-up',
  work: 'Work',
  recovery: 'Recovery',
  cooldown: 'Cooldown',
};

/** Expand an authored plan into the flat ordered step list the engine runs. */
export function flattenPlan(p: IntervalPlan): PlanStep[] {
  const steps: PlanStep[] = [];
  if (p.warmup) steps.push({ kind: 'warmup', target: p.warmup, label: KIND_LABEL.warmup });
  const n = Math.max(1, p.repeats);
  for (let i = 1; i <= n; i++) {
    steps.push({ kind: 'work', target: p.work, label: `Work ${i}/${n}` });
    if (p.recovery) {
      steps.push({ kind: 'recovery', target: p.recovery, label: `Recovery ${i}/${n}` });
    }
  }
  if (p.cooldown) steps.push({ kind: 'cooldown', target: p.cooldown, label: KIND_LABEL.cooldown });
  return steps;
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
  return 'manual';
}

/** One-line summary for the plan list, e.g. "WU 5:00 · 5×(2:15 / 1:45) · CD 5:00". */
export function planSummary(p: IntervalPlan): string {
  const parts: string[] = [];
  if (p.warmup) parts.push(`WU ${fmtTarget(p.warmup)}`);
  const rep = p.recovery
    ? `${fmtTarget(p.work)} / ${fmtTarget(p.recovery)}`
    : fmtTarget(p.work);
  parts.push(`${Math.max(1, p.repeats)}×(${rep})`);
  if (p.cooldown) parts.push(`CD ${fmtTarget(p.cooldown)}`);
  return parts.join(' · ');
}
