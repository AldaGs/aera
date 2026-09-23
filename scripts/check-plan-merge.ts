/**
 * Tiny self-check for Phase 2 plan sync: last-writer-wins merge by updatedAt.
 * Run with `npx tsx scripts/check-plan-merge.ts`. No framework; asserts and
 * exits non-zero on failure.
 */
import { mergePlan } from '../src/sync/planSync';
import type { IntervalPlan } from '../src/model/intervalPlan';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

function plan(id: string, updatedAt: string, deleted?: boolean): IntervalPlan {
  return {
    id,
    name: id,
    sport: 'run',
    steps: [{ id: 'w', kind: 'work', target: { type: 'time', sec: 60 } }],
    autoFinish: true,
    createdAt: updatedAt,
    updatedAt,
    deleted,
  };
}

// --- no local row: remote always wins ---
{
  const remote = plan('a', '2026-01-01T00:00:00.000Z');
  assert(mergePlan(undefined, remote) === remote, 'no local -> remote wins');
}

// --- remote newer: remote wins ---
{
  const local = plan('a', '2026-01-01T00:00:00.000Z');
  const remote = plan('a', '2026-01-02T00:00:00.000Z');
  assert(mergePlan(local, remote) === remote, 'remote newer -> remote wins');
}

// --- local newer: local wins ---
{
  const local = plan('a', '2026-01-02T00:00:00.000Z');
  const remote = plan('a', '2026-01-01T00:00:00.000Z');
  assert(mergePlan(local, remote) === local, 'local newer -> local wins');
}

// --- tie: local wins (kept) ---
{
  const local = plan('a', '2026-01-01T00:00:00.000Z');
  const remote = plan('a', '2026-01-01T00:00:00.000Z');
  assert(mergePlan(local, remote) === local, 'tie -> local kept');
}

// --- tombstone propagates like any other update ---
{
  const local = plan('a', '2026-01-01T00:00:00.000Z');
  const remoteDeleted = plan('a', '2026-01-02T00:00:00.000Z', true);
  const winner = mergePlan(local, remoteDeleted);
  assert(winner === remoteDeleted && !!winner.deleted, 'newer tombstone wins');
}

// --- missing updatedAt falls back to createdAt ---
{
  const local: IntervalPlan = { ...plan('a', '2026-01-01T00:00:00.000Z'), updatedAt: undefined };
  const remote = plan('a', '2026-01-02T00:00:00.000Z');
  assert(mergePlan(local, remote) === remote, 'missing updatedAt falls back to createdAt');
}

if (process.exitCode) {
  console.error('\nplan merge check FAILED');
} else {
  console.log('\nplan merge check passed');
}
