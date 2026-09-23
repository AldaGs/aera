/**
 * Tiny self-check for Phase 1 engine logic: 'either' goal advance + auto-pause
 * gating by step target type. Run with `npx tsx scripts/check-engine-goals.ts`.
 * No framework; asserts and exits non-zero on failure.
 */
import { RecordingEngine } from '../src/record/engine';
import type { PlanStep, IntervalPlan } from '../src/model/intervalPlan';
import { migratePlan, flattenPlan, planSummary } from '../src/model/intervalPlan';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

// --- 'either' advances on whichever is reached first (distance here) ---
{
  const steps: PlanStep[] = [
    { kind: 'work', target: { type: 'either', sec: 3600, m: 100 }, label: 'Work' },
  ];
  const engine = new RecordingEngine('run');
  engine.setPlan(steps, true);
  engine.start();
  // Sample timestamps must track real wall-clock time: elapsedMs() measures
  // against Date.now(), not the sample's own ts.
  const base = Date.now();
  // Walk ~6m every second at a plausible 3 m/s (stays under the teleport guard),
  // crossing the 100m distance leg in ~17s — far short of the 1h time leg.
  for (let i = 0; i <= 20; i++) {
    engine.addSample({
      lat: i * 0.00005,
      lng: 0,
      ts: base + i * 1000,
      accuracy: 5,
      speed: 3,
    });
  }
  let complete = false;
  engine.subscribe((s) => {
    complete = !!s.plan?.complete;
  });
  assert(complete, "'either' step advances (and completes, single-step plan) on distance-first");
}

// --- auto-pause gating: disabled for 'time' step, allowed with no plan ---
{
  const steps: PlanStep[] = [
    { kind: 'work', target: { type: 'time', sec: 600 }, label: 'Work' },
  ];
  const engine = new RecordingEngine('run');
  engine.setPlan(steps, false);
  engine.start();
  // Simulate "stationary for a while": force lastMoveWall into the past via addSample,
  // then let tick() evaluate. Cast to any to reach the private field for the test.
  (engine as any).lastMoveWall = Date.now() - 7000;
  engine.tick();
  let autoPausedDuringTime = false;
  engine.subscribe((s) => (autoPausedDuringTime = s.autoPaused));
  assert(!autoPausedDuringTime, 'auto-pause stays off during a time step');

  const engine2 = new RecordingEngine('run');
  engine2.start(); // no plan
  (engine2 as any).lastMoveWall = Date.now() - 7000;
  engine2.tick();
  let autoPausedNoPlan = false;
  engine2.subscribe((s) => (autoPausedNoPlan = s.autoPaused));
  assert(autoPausedNoPlan, 'auto-pause fires with no plan');
}

// --- migratePlan: legacy shape -> steps, and idempotent ---
{
  const legacy: IntervalPlan = {
    id: 'p1', name: 'Legacy', sport: 'run',
    steps: [],
    warmup: { type: 'time', sec: 300 },
    work: { type: 'time', sec: 135 },
    recovery: { type: 'time', sec: 105 },
    repeats: 3,
    cooldown: { type: 'time', sec: 300 },
    autoFinish: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const migrated = migratePlan(legacy);
  assert(migrated.warmup === undefined, 'migratePlan strips legacy warmup field');
  assert(migrated.steps.length === 3, 'migratePlan: warmup + repeat-block + cooldown = 3 top-level steps');
  const block = migrated.steps[1];
  assert('repeat' in block && block.repeat === 3, 'migratePlan wraps work/recovery in a repeat block');
  assert('repeat' in block && block.steps.length === 2, 'repeat block holds work + recovery');

  const twice = migratePlan(migrated);
  assert(JSON.stringify(twice.steps) === JSON.stringify(migrated.steps), 'migratePlan is idempotent');
}

// --- flattenPlan: per-kind counting labels ---
{
  const p: IntervalPlan = {
    id: 'p2', name: 'Mixed', sport: 'run', autoFinish: true, createdAt: '',
    steps: [
      { id: 'wu', kind: 'warmup', target: { type: 'time', sec: 300 } },
      { id: 'w1', kind: 'walk', target: { type: 'time', sec: 120 } },
      { id: 'r1', kind: 'run', target: { type: 'distance', m: 1000 } },
      { id: 'w2', kind: 'walk', target: { type: 'time', sec: 120 } },
      { id: 'r2', kind: 'run', target: { type: 'distance', m: 1500 } },
      { id: 'rec', kind: 'recovery', target: { type: 'time', sec: 300 } },
    ],
  };
  const flat = flattenPlan(p);
  const labels = flat.map((s) => s.label);
  assert(
    JSON.stringify(labels) ===
      JSON.stringify(['Warm-up', 'Walk 1/2', 'Run 1/2', 'Walk 2/2', 'Run 2/2', 'Recovery']),
    `flattenPlan labels per-kind counts: ${labels.join(', ')}`,
  );
}

// --- flattenPlan: repeat block expands with 'Work i/n' labels ---
{
  const p: IntervalPlan = {
    id: 'p3', name: 'Repeats', sport: 'run', autoFinish: true, createdAt: '',
    steps: [
      {
        id: 'block', repeat: 3,
        steps: [
          { id: 'w', kind: 'work', target: { type: 'time', sec: 120 } },
          { id: 'r', kind: 'recovery', target: { type: 'time', sec: 60 } },
        ],
      },
    ],
  };
  const flat = flattenPlan(p);
  assert(flat.length === 6, 'repeat block of 3x(work,recovery) flattens to 6 steps');
  assert(flat[0].label === 'Work 1/3' && flat[4].label === 'Work 3/3', 'legacy work labels count i/n');
  assert(flat[1].label === 'Recovery 1/3', 'recovery inside a repeat block also counts i/n');
}

// --- planSummary: repeat block formatting + truncation after 4 items ---
{
  const p: IntervalPlan = {
    id: 'p4', name: 'Long', sport: 'run', autoFinish: true, createdAt: '',
    steps: [
      { id: 'wu', kind: 'warmup', target: { type: 'time', sec: 300 } },
      {
        id: 'block', repeat: 5,
        steps: [
          { id: 'r', kind: 'run', target: { type: 'distance', m: 800 } },
          { id: 'rec', kind: 'recovery', target: { type: 'time', sec: 90 } },
        ],
      },
      { id: 'w1', kind: 'walk', target: { type: 'time', sec: 120 } },
      { id: 'w2', kind: 'walk', target: { type: 'time', sec: 120 } },
      { id: 'cd', kind: 'cooldown', target: { type: 'time', sec: 300 } },
    ],
  };
  const summary = planSummary(p);
  assert(summary.includes('5×(Run 800 m / Rec 1:30)'), `planSummary formats repeat block: ${summary}`);
  assert(summary.endsWith('+1'), `planSummary truncates after 4 items: ${summary}`);
}

if (process.exitCode) {
  console.error('\nSome checks failed.');
} else {
  console.log('\nAll checks passed.');
}
