/**
 * Self-check for ZoneGuard. Run with `npx tsx scripts/check-zone-guard.ts`.
 * Mirrors ZoneGuardTest.kt (android/wear) scenario-for-scenario.
 */
import { ZoneGuard } from '../src/record/zoneGuard';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

const maxHr = 190;
// Z2 = 60-70% of max => 114-133 bpm. 150 bpm => ~79% => zone index 2 (Z3) => 'high' vs target Z2.
// 100 bpm => ~53% => zone index 0 (Z1) => 'low' vs target Z2.
// 120 bpm => ~63% => zone index 1 (Z2) => 'in'.

{
  const g = new ZoneGuard();
  // Immediately high, but under 15s: no alert yet.
  assert(g.sample(0, 150, 2, maxHr) === null, 'no alert before 15s continuously out');
  assert(g.getStatus() === 'high', 'status reports high while out');
  assert(g.sample(10_000, 150, 2, maxHr) === null, 'still no alert at 10s');
  assert(g.sample(15_000, 150, 2, maxHr) === 'high', 'alert fires at 15s continuously out');
  // Repeat suppressed until 60s after the alert.
  assert(g.sample(30_000, 150, 2, maxHr) === null, 'repeat suppressed before 60s');
  assert(g.sample(75_000, 150, 2, maxHr) === 'high', 'repeat fires after 60s');
  // Back in zone: one 'back' event, then silence.
  assert(g.sample(80_000, 120, 2, maxHr) === 'back', "'back' fires once on return to zone");
  assert(g.getStatus() === 'in', 'status is in after returning');
  assert(g.sample(85_000, 120, 2, maxHr) === null, 'no repeat back event while staying in zone');
}

{
  const g = new ZoneGuard();
  // Low HR case.
  assert(g.sample(0, 100, 2, maxHr) === null, 'low: no alert before 15s');
  assert(g.sample(15_000, 100, 2, maxHr) === 'low', 'low: alert at 15s');
}

{
  const g = new ZoneGuard();
  // A brief dip back in zone resets the out-timer (must be *continuously* out).
  assert(g.sample(0, 150, 2, maxHr) === null, 'reset scenario: initial out');
  assert(g.sample(10_000, 120, 2, maxHr) === null, 'reset scenario: briefly back in zone');
  assert(g.sample(20_000, 150, 2, maxHr) === null, 'reset scenario: out again, timer restarted (only 10s so far)');
  assert(g.sample(35_000, 150, 2, maxHr) === 'high', 'reset scenario: alert at 15s after the restart');
}

{
  const g = new ZoneGuard();
  // Paused / null HR / null target: ignored, no status change, no alert.
  assert(g.sample(0, 150, 2, maxHr, true) === null, 'paused: ignored');
  assert(g.getStatus() === 'none', 'paused: status stays none');
  assert(g.sample(0, null, 2, maxHr) === null, 'null hr: ignored');
  assert(g.sample(0, 150, null, maxHr) === null, 'null target: ignored');
}

{
  const g = new ZoneGuard();
  // Step change: caller resets — a fresh out-of-zone streak needs its own 15s.
  assert(g.sample(0, 150, 2, maxHr) === null, 'pre-reset: out');
  g.reset();
  assert(g.getStatus() === 'none', 'reset clears status');
  assert(g.sample(1000, 150, 2, maxHr) === null, 'post-reset: fresh streak, no alert yet');
  assert(g.sample(16_000, 150, 2, maxHr) === 'high', 'post-reset: alert at 15s from the new start');
}

{
  const g = new ZoneGuard();
  // Pause time doesn't count: out 10s, paused 30s, resume out → needs a fresh 15s.
  assert(g.sample(0, 150, 2, maxHr) === null, 'pause: out before pause');
  assert(g.sample(10_000, 150, 2, maxHr, true) === null, 'pause: paused');
  assert(g.sample(40_000, 150, 2, maxHr) === null, 'pause: resumed, no instant alert');
  assert(g.sample(55_000, 150, 2, maxHr) === 'high', 'pause: alert 15s after resume');
}

{
  const g = new ZoneGuard();
  // Flip high → low: the low side gets its own 15s wait, not the high streak's time.
  assert(g.sample(0, 150, 2, maxHr) === null, 'flip: high');
  assert(g.sample(15_000, 150, 2, maxHr) === 'high', 'flip: high alert');
  assert(g.sample(20_000, 100, 2, maxHr) === null, 'flip: now low, no instant alert');
  assert(g.sample(35_000, 100, 2, maxHr) === 'low', 'flip: low alert 15s later despite <60s since last');
}
console.log('zone guard edge checks passed');
