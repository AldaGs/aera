import type { PlanStepDef, RepeatBlock } from './intervalPlan';

/** Path to an authored step: top-level index, or [blockIndex, innerIndex] inside a repeat block. */
export type StepPath = number | [number, number];

export function pathEq(a: StepPath, b: StepPath): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

export function stepAt(steps: (PlanStepDef | RepeatBlock)[], path: StepPath): PlanStepDef {
  if (typeof path === 'number') return steps[path] as PlanStepDef;
  return (steps[path[0]] as RepeatBlock).steps[path[1]];
}

export function replaceStep(
  steps: (PlanStepDef | RepeatBlock)[],
  path: StepPath,
  next: PlanStepDef,
): (PlanStepDef | RepeatBlock)[] {
  const copy = steps.slice();
  if (typeof path === 'number') {
    copy[path] = next;
  } else {
    const [bi, si] = path;
    const block = copy[bi] as RepeatBlock;
    const innerSteps = block.steps.slice();
    innerSteps[si] = next;
    copy[bi] = { ...block, steps: innerSteps };
  }
  return copy;
}

export function removeStep(
  steps: (PlanStepDef | RepeatBlock)[],
  path: StepPath,
): (PlanStepDef | RepeatBlock)[] {
  if (typeof path === 'number') return steps.filter((_, i) => i !== path);
  const [bi, si] = path;
  const copy = steps.slice();
  const block = copy[bi] as RepeatBlock;
  const innerSteps = block.steps.filter((_, i) => i !== si);
  if (innerSteps.length === 0) copy.splice(bi, 1);
  else copy[bi] = { ...block, steps: innerSteps };
  return copy;
}

/** Move an item from index `from` to index `to` within a single list (generic, any array). */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** Reorder within the top-level list, or within a single repeat block's inner list (identified
 * by blockIndex). Moving a step into/out of a block is not supported — that case is a no-op. */
export function moveStep(
  steps: (PlanStepDef | RepeatBlock)[],
  blockIndex: number | null,
  from: number,
  to: number,
): (PlanStepDef | RepeatBlock)[] {
  if (blockIndex === null) return moveItem(steps, from, to);
  const copy = steps.slice();
  const block = copy[blockIndex] as RepeatBlock;
  copy[blockIndex] = { ...block, steps: moveItem(block.steps, from, to) };
  return copy;
}

/** True when `selected` is a non-empty contiguous run of top-level indices. */
export function isContiguous(selected: number[]): boolean {
  if (selected.length === 0) return false;
  const sorted = [...selected].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

/** Wrap the contiguous top-level range [from, to] (inclusive) into a new 2x RepeatBlock.
 * All entries in range must be plain PlanStepDef (not already a RepeatBlock); otherwise
 * the steps are returned unchanged. */
export function wrapRange(
  steps: (PlanStepDef | RepeatBlock)[],
  from: number,
  to: number,
): (PlanStepDef | RepeatBlock)[] {
  const range = steps.slice(from, to + 1);
  if (range.length === 0 || range.some((it) => 'repeat' in it)) return steps;
  const block: RepeatBlock = { id: crypto.randomUUID(), repeat: 2, steps: range as PlanStepDef[] };
  return [...steps.slice(0, from), block, ...steps.slice(to + 1)];
}

/** Restore a block's steps inline at its position, removing the block wrapper. */
export function unwrapBlock(steps: (PlanStepDef | RepeatBlock)[], blockIndex: number): (PlanStepDef | RepeatBlock)[] {
  const block = steps[blockIndex] as RepeatBlock;
  if (!block || !('repeat' in block)) return steps;
  return [...steps.slice(0, blockIndex), ...block.steps, ...steps.slice(blockIndex + 1)];
}

/** Set a block's repeat count, clamped to [2, 50]. */
export function setBlockRepeat(
  steps: (PlanStepDef | RepeatBlock)[],
  blockIndex: number,
  repeat: number,
): (PlanStepDef | RepeatBlock)[] {
  const clamped = Math.max(2, Math.min(50, repeat));
  const copy = steps.slice();
  const block = copy[blockIndex] as RepeatBlock;
  copy[blockIndex] = { ...block, repeat: clamped };
  return copy;
}
