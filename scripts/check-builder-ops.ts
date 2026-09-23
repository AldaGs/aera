/**
 * Self-check for the builder's pure array logic (reorder, delete, wrap/unwrap a
 * repeat block). Run with `npx tsx scripts/check-builder-ops.ts`.
 */
import type { PlanStepDef, RepeatBlock } from '../src/model/intervalPlan';
import {
  moveItem,
  moveStep,
  removeStep,
  isContiguous,
  wrapRange,
  unwrapBlock,
  setBlockRepeat,
} from '../src/model/builderOps';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

const s = (id: string): PlanStepDef => ({ id, kind: 'run', target: { type: 'manual' } });

// moveItem: generic array move
assert(moveItem(['a', 'b', 'c'], 0, 2).join() === 'b,c,a', 'moveItem 0->2');
assert(moveItem(['a', 'b', 'c'], 2, 0).join() === 'c,a,b', 'moveItem 2->0');
assert(moveItem(['a', 'b', 'c'], 1, 1).join() === 'a,b,c', 'moveItem no-op same index');

// moveStep: top-level and within-block
const top = [s('1'), s('2'), s('3')];
assert(
  (moveStep(top, null, 0, 2) as PlanStepDef[]).map((x) => x.id).join() === '2,3,1',
  'moveStep top-level',
);
const block: RepeatBlock = { id: 'b1', repeat: 2, steps: [s('a'), s('b')] };
const withBlock = [s('1'), block];
const moved = moveStep(withBlock, 1, 0, 1)[1] as RepeatBlock;
assert(moved.steps.map((x) => x.id).join() === 'b,a', 'moveStep within block');

// removeStep: top-level and inside block (last removal collapses the block)
assert(removeStep(top, 1).map((x: any) => x.id).join() === '1,3', 'removeStep top-level');
const oneStepBlock: RepeatBlock = { id: 'b2', repeat: 3, steps: [s('x')] };
const afterRemove = removeStep([s('1'), oneStepBlock], [1, 0]);
assert(afterRemove.length === 1 && (afterRemove[0] as PlanStepDef).id === '1', 'removeStep collapses empty block');

// isContiguous
assert(isContiguous([0, 1, 2]) === true, 'contiguous 0,1,2');
assert(isContiguous([2, 0, 1]) === true, 'contiguous unsorted 2,0,1');
assert(isContiguous([0, 2]) === false, 'non-contiguous 0,2');
assert(isContiguous([]) === false, 'empty selection not contiguous');

// wrapRange / unwrapBlock
const three = [s('1'), s('2'), s('3')];
const wrapped = wrapRange(three, 0, 1);
assert(wrapped.length === 2, 'wrapRange collapses 2 steps into 1 block + remainder');
assert('repeat' in wrapped[0] && (wrapped[0] as RepeatBlock).repeat === 2, 'wrapRange default repeat=2');
assert(
  (wrapped[0] as RepeatBlock).steps.map((x) => x.id).join() === '1,2',
  'wrapRange preserves order inside block',
);
const unwrapped = unwrapBlock(wrapped, 0);
assert(unwrapped.map((x: any) => x.id).join() === '1,2,3', 'unwrapBlock restores steps inline');
// wrapping a range that already contains a block is a no-op
const withExistingBlock = [s('1'), { id: 'b3', repeat: 2, steps: [s('2')] } as RepeatBlock];
assert(wrapRange(withExistingBlock, 0, 1) === withExistingBlock, 'wrapRange no-ops over an existing block');

// setBlockRepeat clamps to [2, 50]
const rb = [{ id: 'b4', repeat: 2, steps: [s('1')] } as RepeatBlock];
assert((setBlockRepeat(rb, 0, 1)[0] as RepeatBlock).repeat === 2, 'setBlockRepeat clamps min 2');
assert((setBlockRepeat(rb, 0, 99)[0] as RepeatBlock).repeat === 50, 'setBlockRepeat clamps max 50');
assert((setBlockRepeat(rb, 0, 5)[0] as RepeatBlock).repeat === 5, 'setBlockRepeat sets in-range value');
