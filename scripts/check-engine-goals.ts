/**
 * Tiny self-check for Phase 1 engine logic: 'either' goal advance + auto-pause
 * gating by step target type. Run with `npx tsx scripts/check-engine-goals.ts`.
 * No framework; asserts and exits non-zero on failure.
 */
import { RecordingEngine } from '../src/record/engine';
import type { PlanStep } from '../src/model/intervalPlan';

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

if (process.exitCode) {
  console.error('\nSome checks failed.');
} else {
  console.log('\nAll checks passed.');
}
