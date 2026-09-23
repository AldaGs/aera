/**
 * Tiny self-check for planEstimate/fmtPlanMeta against the README sample plan
 * (WU 5:00, Walk 2:00, Run 1 km, Walk 2:00, Run 1500 m, Rec 5:00 at default
 * paces). Run with `npx tsx scripts/check-plan-estimate.ts`.
 */
import type { IntervalPlan } from '../src/model/intervalPlan';
import { planEstimate, fmtPlanMeta } from '../src/model/intervalPlan';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

const plan: IntervalPlan = {
  id: 'p1',
  name: 'Run-walk 1k / 1.5k',
  sport: 'run',
  autoFinish: true,
  createdAt: new Date().toISOString(),
  steps: [
    { id: '1', kind: 'warmup', target: { type: 'time', sec: 300 } },
    { id: '2', kind: 'walk', target: { type: 'time', sec: 120 } },
    { id: '3', kind: 'run', target: { type: 'distance', m: 1000 } },
    { id: '4', kind: 'walk', target: { type: 'time', sec: 120 } },
    { id: '5', kind: 'run', target: { type: 'distance', m: 1500 } },
    { id: '6', kind: 'recovery', target: { type: 'time', sec: 300 } },
  ],
};

const est = planEstimate(plan);
assert(est.steps === 6, `6 steps (got ${est.steps})`);
assert(est.approx, 'estimate is approx (mixes time + distance targets)');

const min = Math.round(est.sec / 60);
assert(min === 29, `~29 min time (got ${min} min = ${est.sec}s)`);

const km = est.m / 1000;
if (km.toFixed(1) !== '3.9') throw new Error(`expected ~3.9 km, got ${km}`);
console.log(`km estimate: ${km.toFixed(2)}`);

console.log(fmtPlanMeta(est));
