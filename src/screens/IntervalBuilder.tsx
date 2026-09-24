import { useRef, useState } from 'react';
import {
  X,
  Plus,
  Timer,
  Ruler,
  DotsSixVertical,
  Watch,
  Backspace,
  Trash,
  Check,
  PencilSimple,
} from '@phosphor-icons/react';
import { savePlan } from '@/db/db';
import type { HrZone, IntervalPlan, PlanStepDef, RepeatBlock, StepKind, StepTarget } from '@/model/intervalPlan';
import { flattenPlan, planEstimate, fmtPlanMeta, fmtTarget, paceFor } from '@/model/intervalPlan';
import type { Sport } from '@/model/workout';
import { pushOnePlan } from '@/sync/planSync';
import {
  pushKey,
  backspace as kpBackspace,
  timeBufferToSec,
  fmtTimeBuffer,
  secToBuffer,
  distanceBufferToMeters,
  metersToBuffer,
} from '@/ui/keypad';
import type { StepPath } from '@/model/builderOps';
import {
  pathEq,
  stepAt,
  replaceStep,
  removeStep,
  moveStep,
  isContiguous,
  wrapRange,
  unwrapBlock,
  setBlockRepeat,
} from '@/model/builderOps';

const SPORTS: Sport[] = ['run', 'walk', 'ride'];
const SPORT_LABEL: Record<Sport, string> = { run: 'Run', walk: 'Walk', ride: 'Ride' };

const CHIP_KINDS: StepKind[] = ['warmup', 'walk', 'run', 'recovery', 'cooldown'];
const CHIP_LABEL: Record<StepKind, string> = {
  warmup: 'Warm-up',
  walk: 'Walk',
  run: 'Run',
  work: 'Run',
  recovery: 'Recovery',
  cooldown: 'Cooldown',
};

type TargetType = 'time' | 'distance' | 'either' | 'manual';

/** Flat, numbered list of authored steps (repeat-block members counted once, not ×repeat) for
 * the sheet's "Step N" header and "after <prev>" lookup. */
function authoredStepList(steps: (PlanStepDef | RepeatBlock)[]): { path: StepPath; step: PlanStepDef }[] {
  const out: { path: StepPath; step: PlanStepDef }[] = [];
  steps.forEach((it, i) => {
    if ('repeat' in it) it.steps.forEach((s, j) => out.push({ path: [i, j], step: s }));
    else out.push({ path: i, step: it });
  });
  return out;
}

// Per-step estimate, used only to weight the timeline bar.
function estStepSec(kind: StepKind, target: StepTarget): number {
  const pace = paceFor(kind);
  if (target.type === 'time') return target.sec;
  if (target.type === 'distance') return (target.m / 1000) * pace;
  if (target.type === 'either') return Math.min(target.sec, (target.m / 1000) * pace);
  return 20; // manual: nominal weight so it still shows a sliver
}

function newPlan(sport: Sport): IntervalPlan {
  return { id: '', name: '', sport, steps: [], autoFinish: true, createdAt: '' };
}

/** Editor for a reusable interval template — 2a builder + 2b add/edit-step sheet. */
export function IntervalBuilder({
  onClose,
  onSaved,
  plan,
}: {
  onClose: () => void;
  onSaved: () => void;
  plan?: IntervalPlan;
}) {
  const [draft, setDraft] = useState<IntervalPlan>(() => plan ?? newPlan('run'));
  const [editingPath, setEditingPath] = useState<StepPath | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]); // top-level indices only
  const isEditingExisting = !!plan;

  const est = planEstimate(draft);
  const timelineSteps = flattenPlan(draft);
  const authored = authoredStepList(draft.steps);

  function cycleSport() {
    const i = SPORTS.indexOf(draft.sport);
    setDraft((d) => ({ ...d, sport: SPORTS[(i + 1) % SPORTS.length] }));
  }

  function openAddSheet() {
    setEditingPath(null);
    setSheetOpen(true);
  }

  function openEditSheet(path: StepPath) {
    setEditingPath(path);
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setEditingPath(null);
  }

  function commitStep(step: PlanStepDef) {
    if (editingPath !== null) {
      setDraft((d) => ({ ...d, steps: replaceStep(d.steps, editingPath, step) }));
    } else {
      setDraft((d) => ({ ...d, steps: [...d.steps, step] }));
    }
    closeSheet();
  }

  function deleteEditingStep() {
    if (editingPath === null) return;
    setDraft((d) => ({ ...d, steps: removeStep(d.steps, editingPath) }));
    closeSheet();
  }

  function deleteStepAt(path: StepPath) {
    setDraft((d) => ({ ...d, steps: removeStep(d.steps, path) }));
  }

  function reorderTop(from: number, to: number) {
    setDraft((d) => ({ ...d, steps: moveStep(d.steps, null, from, to) }));
  }

  function reorderInBlock(blockIndex: number, from: number, to: number) {
    setDraft((d) => ({ ...d, steps: moveStep(d.steps, blockIndex, from, to) }));
  }

  function toggleSelectMode() {
    setSelectMode((on) => !on);
    setSelected([]);
  }

  function toggleSelected(path: StepPath) {
    if (typeof path !== 'number') return; // only top-level steps are selectable
    setSelected((sel) => (sel.includes(path) ? sel.filter((i) => i !== path) : [...sel, path]));
  }

  const canConfirmWrap = isContiguous(selected);

  function confirmWrap() {
    if (!canConfirmWrap) return;
    const from = Math.min(...selected);
    const to = Math.max(...selected);
    setDraft((d) => ({ ...d, steps: wrapRange(d.steps, from, to) }));
    setSelectMode(false);
    setSelected([]);
  }

  function unwrap(blockIndex: number) {
    setDraft((d) => ({ ...d, steps: unwrapBlock(d.steps, blockIndex) }));
  }

  function setRepeat(blockIndex: number, repeat: number) {
    setDraft((d) => ({ ...d, steps: setBlockRepeat(d.steps, blockIndex, repeat) }));
  }

  async function submit() {
    const toSave: IntervalPlan = {
      ...draft,
      id: draft.id || crypto.randomUUID(),
      name: draft.name.trim() || defaultName(draft),
      createdAt: draft.createdAt || new Date().toISOString(),
    };
    const saved = await savePlan(toSave);
    pushOnePlan(saved);
    onSaved();
  }

  const editingStepNumber =
    editingPath !== null ? authored.findIndex((a) => pathEq(a.path, editingPath)) + 1 : authored.length + 1;
  const prevStep = editingStepNumber > 1 ? authored[editingStepNumber - 2]?.step : undefined;

  return (
    <div className="overlay builder-2a">
      <div className={`builder-body ${sheetOpen ? 'builder-dimmed' : ''}`}>
        <header className="builder-topbar">
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <span className="builder-topbar-title">{isEditingExisting ? 'Edit workout' : 'New workout'}</span>
          <button className="builder-save" onClick={submit} disabled={draft.steps.length === 0}>
            Save
          </button>
        </header>

        {/* Visibly editable (pencil + underline): a borderless field showing the auto
            name as placeholder read as a fixed title, so plans never got renamed. */}
        <label className="builder-name-wrap">
          <input
            className="builder-name"
            value={draft.name}
            placeholder="Name this workout"
            aria-label="Workout name"
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
          <PencilSimple size={18} className="builder-name-icon" />
        </label>
        <div className="builder-meta">
          <button className="tag tag-accent builder-sport-tag" onClick={cycleSport}>
            {SPORT_LABEL[draft.sport]}
          </button>
          <span className="muted small">{fmtPlanMeta(est)}</span>
        </div>

        {timelineSteps.length > 0 && (
          <div className="builder-timeline">
            {timelineSteps.map((s, i) => (
              <span
                key={i}
                className={`builder-timeline-bar builder-timeline-${s.kind === 'work' ? 'run' : s.kind}`}
                style={{ flex: Math.max(1, estStepSec(s.kind, s.target)) }}
              />
            ))}
          </div>
        )}

        {draft.steps.length === 0 && (
          <p className="muted small builder-empty">No steps yet — tap "+ Add step" to build your workout.</p>
        )}
        {draft.steps.length > 0 && (
          <TopLevelList
            items={draft.steps}
            selectMode={selectMode}
            selectedPaths={selected}
            onToggleSelect={toggleSelected}
            onEdit={openEditSheet}
            onDelete={deleteStepAt}
            onReorderTop={reorderTop}
            onReorderInBlock={reorderInBlock}
            onUnwrap={unwrap}
            onSetRepeat={setRepeat}
          />
        )}

        <div className="builder-actions">
          {selectMode ? (
            <>
              <button className="btn" onClick={confirmWrap} disabled={!canConfirmWrap}>
                <Check size={16} /> Wrap {selected.length || ''} in repeat
              </button>
              <button className="btn-ghost" onClick={toggleSelectMode}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={openAddSheet}>
                <Plus size={16} /> Add step
              </button>
              <button
                className="btn-ghost"
                onClick={toggleSelectMode}
                disabled={draft.steps.filter((it) => !('repeat' in it)).length < 2}
              >
                Repeat block
              </button>
            </>
          )}
        </div>
        {selectMode && !canConfirmWrap && selected.length > 0 && (
          <p className="muted small">Selection must be contiguous — pick steps next to each other.</p>
        )}

        <label className="builder-autofinish">
          <span>Save and stop when the last step ends</span>
          <input
            type="checkbox"
            className="toggle"
            checked={draft.autoFinish}
            onChange={(e) => setDraft((d) => ({ ...d, autoFinish: e.target.checked }))}
          />
        </label>

        <p className="builder-footer muted small">
          <Watch size={14} /> Syncs to Watch4 when saved
        </p>
      </div>

      {sheetOpen && (
        <StepSheet
          stepNumber={editingStepNumber}
          prevStep={prevStep}
          initial={editingPath !== null ? stepAt(draft.steps, editingPath) : undefined}
          isEditing={editingPath !== null}
          onClose={closeSheet}
          onSubmit={commitStep}
          onDelete={editingPath !== null ? deleteEditingStep : undefined}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drag reorder + swipe delete for one flat list of rows (top level, or a
// single repeat block's inner steps — moving a step between lists is not
// supported, only within one).
// ---------------------------------------------------------------------------

const SWIPE_DELETE_PX = 80; // ponytail: fixed threshold, no velocity/fling detection
const LONG_PRESS_MS = 400;

/** Drag-to-reorder for a flat list: reorders live as the dragged row crosses another
 * row's midpoint, so other rows shift to show the drop slot as you drag. */
function useDragReorder(itemIds: string[], onReorder: (from: number, to: number) => void) {
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragY, setDragY] = useState(0);
  // grabOffset = pointer Y minus the row's natural (untransformed) top at grab time.
  const start = useRef<{ grabOffset: number } | null>(null);
  const dragYRef = useRef(0);

  function setRowRef(id: string, el: HTMLElement | null) {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }

  function setY(y: number) {
    dragYRef.current = y;
    setDragY(y);
  }

  function begin(id: string, clientY: number) {
    const el = rowRefs.current.get(id);
    start.current = { grabOffset: clientY - (el ? el.getBoundingClientRect().top : clientY) };
    setDraggingId(id);
    setY(0);
  }

  function move(clientY: number) {
    if (!draggingId || !start.current) return;
    const el = rowRefs.current.get(draggingId);
    if (!el) return;
    // Keep the row under the finger even after it has moved to a new slot.
    const naturalTop = el.getBoundingClientRect().top - dragYRef.current;
    setY(clientY - start.current.grabOffset - naturalTop);
    // Target slot = how many *other* rows have their midpoint above the pointer.
    // (The dragged row follows the pointer, so it must not take part.)
    const fromIndex = itemIds.indexOf(draggingId);
    let toIndex = 0;
    itemIds.forEach((id) => {
      if (id === draggingId) return;
      const r = rowRefs.current.get(id)?.getBoundingClientRect();
      if (r && r.top + r.height / 2 < clientY) toIndex++;
    });
    if (toIndex !== fromIndex) onReorder(fromIndex, toIndex);
  }

  function end() {
    setDraggingId(null);
    start.current = null;
    setY(0);
  }

  return { draggingId, dragY, setRowRef, begin, move, end };
}

function StepRow({
  step,
  selectable,
  selected,
  onToggleSelect,
  onClick,
  onDelete,
  dragActive,
  dragY,
  rowRef,
  onHandlePointerDown,
  onBodyPointerDown,
}: {
  step: PlanStepDef;
  selectable: boolean; // selection-mode: show a checkbox instead of the drag handle
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onDelete: () => void;
  dragActive: boolean;
  dragY: number;
  rowRef: (el: HTMLElement | null) => void;
  onHandlePointerDown: (e: React.PointerEvent) => void;
  onBodyPointerDown: (e: React.PointerEvent) => void;
}) {
  const isDistanceRun = (step.kind === 'run' || step.kind === 'work') && step.target.type === 'distance';
  const TypeIcon = step.target.type === 'distance' ? Ruler : Timer;
  const [swipeX, setSwipeX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const swipe = useRef<{ x: number; y: number; axis: 'h' | 'v' | null } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (selectable) return; // no swipe/drag while picking steps for a repeat block
    swipe.current = { x: e.clientX, y: e.clientY, axis: null };
    onBodyPointerDown(e);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!swipe.current || dragActive) return;
    const dx = e.clientX - swipe.current.x;
    const dy = e.clientY - swipe.current.y;
    if (swipe.current.axis === null && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
      swipe.current.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (swipe.current.axis === 'h') (e.target as Element).setPointerCapture?.(e.pointerId);
    }
    if (swipe.current.axis === 'h') {
      e.preventDefault();
      setSwipeX(Math.max(-96, Math.min(0, (revealed ? -72 : 0) + dx)));
    }
  }
  function onPointerUp() {
    const s = swipe.current;
    swipe.current = null;
    if (dragActive) return;
    if (!s || s.axis === null) {
      if (!revealed) onClick(); // plain tap: open the edit sheet
      else setRevealed(false), setSwipeX(0);
      return;
    }
    if (s.axis === 'h') {
      if (swipeX <= -SWIPE_DELETE_PX) {
        onDelete();
        return;
      }
      const reveal = swipeX < -36;
      setRevealed(reveal);
      setSwipeX(reveal ? -72 : 0);
    }
  }

  return (
    <li
      className={`builder-step-row ${isDistanceRun ? 'builder-step-row-dist' : ''} ${dragActive ? 'builder-step-row-dragging' : ''}`}
      ref={rowRef as React.Ref<HTMLLIElement>}
      style={dragActive ? { transform: `translateY(${dragY}px)`, zIndex: 2 } : undefined}
    >
      <div className="builder-step-swipe-delete" style={{ opacity: swipeX < -8 ? 1 : 0 }}>
        <button className="builder-step-trash" onClick={onDelete} aria-label="Delete step">
          <Trash size={16} />
        </button>
      </div>
      <div
        className="builder-step-swipe-content"
        style={{ transform: `translateX(${swipeX}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {selectable && (
          <button
            className={`builder-step-radio ${selected ? 'builder-step-radio-selected' : ''}`}
            onClick={onToggleSelect}
            aria-label={selected ? 'Deselect step' : 'Select step'}
          />
        )}
        <button className="builder-step-main" onClick={selectable ? onToggleSelect : undefined}>
          <span className={`builder-step-stripe builder-step-stripe-${step.kind === 'work' ? 'run' : step.kind}`} />
          <div className="builder-step-info">
            <span className="builder-step-kind">{CHIP_LABEL[step.kind]}</span>
            <span className="builder-step-type muted small">
              {step.target.type !== 'manual' && <TypeIcon size={12} />}
              {step.target.type === 'time'
                ? 'Time'
                : step.target.type === 'distance'
                  ? 'Distance'
                  : step.target.type === 'either'
                    ? 'Either'
                    : 'Tap'}
            </span>
          </div>
          <span className="builder-step-value">
            {fmtTarget(step.target)}
            {step.hrZone && <span className="tag tag-outline builder-step-zone">Z{step.hrZone}</span>}
          </span>
        </button>
        {!selectable && (
          <DotsSixVertical
            size={18}
            className="builder-step-handle"
            onPointerDown={onHandlePointerDown}
          />
        )}
      </div>
    </li>
  );
}

/** A flat, draggable/swipeable list of plain steps — used for a repeat block's inner steps. */
function StepList({
  items,
  selectMode,
  selectedPaths,
  onToggleSelect,
  onEdit,
  onDelete,
  onReorder,
  pathFor,
}: {
  items: PlanStepDef[];
  selectMode: boolean;
  selectedPaths: StepPath[];
  onToggleSelect: (path: StepPath) => void;
  onEdit: (path: StepPath) => void;
  onDelete: (path: StepPath) => void;
  onReorder: (from: number, to: number) => void;
  pathFor: (index: number) => StepPath;
}) {
  const ids = items.map((it) => it.id);
  const dnd = useDragReorder(ids, onReorder);
  const longPress = useRef<number | null>(null);

  function startDrag(id: string, e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dnd.begin(id, e.clientY);
  }
  function cancelLongPress() {
    if (longPress.current !== null) {
      window.clearTimeout(longPress.current);
      longPress.current = null;
    }
  }

  return (
    <ul
      className="builder-steps"
      onPointerMove={(e) => dnd.move(e.clientY)}
      onPointerUp={() => {
        cancelLongPress();
        dnd.end();
      }}
      onPointerCancel={() => {
        cancelLongPress();
        dnd.end();
      }}
    >
      {items.map((step, i) => {
        const path = pathFor(i);
        return (
          <StepRow
            key={step.id}
            step={step}
            selectable={selectMode}
            selected={selectedPaths.some((p) => pathEq(p, path))}
            onToggleSelect={() => onToggleSelect(path)}
            onClick={() => onEdit(path)}
            onDelete={() => onDelete(path)}
            dragActive={dnd.draggingId === step.id}
            dragY={dnd.dragY}
            rowRef={(el) => dnd.setRowRef(step.id, el)}
            onHandlePointerDown={(e) => startDrag(step.id, e)}
            onBodyPointerDown={(e) => {
              // Touch only: long-press the row body to start a drag (mouse/pen use the handle).
              if (e.pointerType !== 'touch') return;
              const { clientX, clientY, pointerId } = e;
              longPress.current = window.setTimeout(() => {
                longPress.current = null;
                dnd.begin(step.id, clientY);
                (e.target as Element).setPointerCapture?.(pointerId);
              }, LONG_PRESS_MS);
              const cancel = () => cancelLongPress();
              window.addEventListener('pointermove', (ev) => {
                if (Math.hypot(ev.clientX - clientX, ev.clientY - clientY) > 8) cancel();
              }, { once: true });
              window.addEventListener('pointerup', cancel, { once: true });
            }}
          />
        );
      })}
    </ul>
  );
}

/** Top-level list: renders plain steps and repeat-block containers in authored order.
 * Drag reorder covers the whole top-level array (a block moves as one row); reordering
 * steps inside a block is handled by that block's own nested StepList. */
function TopLevelList({
  items,
  selectMode,
  selectedPaths,
  onToggleSelect,
  onEdit,
  onDelete,
  onReorderTop,
  onReorderInBlock,
  onUnwrap,
  onSetRepeat,
}: {
  items: (PlanStepDef | RepeatBlock)[];
  selectMode: boolean;
  selectedPaths: StepPath[];
  onToggleSelect: (path: StepPath) => void;
  onEdit: (path: StepPath) => void;
  onDelete: (path: StepPath) => void;
  onReorderTop: (from: number, to: number) => void;
  onReorderInBlock: (blockIndex: number, from: number, to: number) => void;
  onUnwrap: (blockIndex: number) => void;
  onSetRepeat: (blockIndex: number, repeat: number) => void;
}) {
  const ids = items.map((it) => it.id);
  const dnd = useDragReorder(ids, onReorderTop);
  const longPress = useRef<number | null>(null);

  function startDrag(id: string, e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dnd.begin(id, e.clientY);
  }
  function cancelLongPress() {
    if (longPress.current !== null) {
      window.clearTimeout(longPress.current);
      longPress.current = null;
    }
  }

  return (
    <ul
      className="builder-steps"
      onPointerMove={(e) => dnd.move(e.clientY)}
      onPointerUp={() => {
        cancelLongPress();
        dnd.end();
      }}
      onPointerCancel={() => {
        cancelLongPress();
        dnd.end();
      }}
    >
      {items.map((item, i) => {
        if ('repeat' in item) {
          return (
            <li
              key={item.id}
              className={`builder-repeat-block ${dnd.draggingId === item.id ? 'builder-step-row-dragging' : ''}`}
              ref={(el) => dnd.setRowRef(item.id, el)}
              style={dnd.draggingId === item.id ? { transform: `translateY(${dnd.dragY}px)`, zIndex: 2 } : undefined}
            >
              <div className="builder-repeat-head">
                <DotsSixVertical size={16} className="builder-step-handle" onPointerDown={(e) => startDrag(item.id, e)} />
                <span>{item.repeat}×</span>
                <div className="builder-repeat-stepper">
                  <button onClick={() => onSetRepeat(i, item.repeat - 1)} disabled={item.repeat <= 2} aria-label="Fewer repeats">
                    −
                  </button>
                  <button onClick={() => onSetRepeat(i, item.repeat + 1)} disabled={item.repeat >= 50} aria-label="More repeats">
                    +
                  </button>
                </div>
                <button className="builder-repeat-unwrap" onClick={() => onUnwrap(i)}>
                  Unwrap
                </button>
              </div>
              <StepList
                items={item.steps}
                selectMode={false}
                selectedPaths={[]}
                onToggleSelect={() => {}}
                onEdit={onEdit}
                onDelete={onDelete}
                onReorder={(from, to) => onReorderInBlock(i, from, to)}
                pathFor={(j) => [i, j] as StepPath}
              />
            </li>
          );
        }
        const path: StepPath = i;
        return (
          <StepRow
            key={item.id}
            step={item}
            selectable={selectMode}
            selected={selectedPaths.some((p) => pathEq(p, path))}
            onToggleSelect={() => onToggleSelect(path)}
            onClick={() => onEdit(path)}
            onDelete={() => onDelete(path)}
            dragActive={dnd.draggingId === item.id}
            dragY={dnd.dragY}
            rowRef={(el) => dnd.setRowRef(item.id, el)}
            onHandlePointerDown={(e) => startDrag(item.id, e)}
            onBodyPointerDown={(e) => {
              if (e.pointerType !== 'touch') return;
              const { clientX, clientY, pointerId } = e;
              longPress.current = window.setTimeout(() => {
                longPress.current = null;
                dnd.begin(item.id, clientY);
                (e.target as Element).setPointerCapture?.(pointerId);
              }, LONG_PRESS_MS);
              const cancel = () => cancelLongPress();
              window.addEventListener('pointermove', (ev) => {
                if (Math.hypot(ev.clientX - clientX, ev.clientY - clientY) > 8) cancel();
              }, { once: true });
              window.addEventListener('pointerup', cancel, { once: true });
            }}
          />
        );
      })}
    </ul>
  );
}

function defaultName(p: IntervalPlan): string {
  const est = planEstimate(p);
  return p.steps.length === 0
    ? `${SPORT_LABEL[p.sport]} workout`
    : `${SPORT_LABEL[p.sport]} · ${fmtPlanMeta(est)}`;
}

// ---------------------------------------------------------------------------
// 2b · Add / edit step sheet
// ---------------------------------------------------------------------------

function targetType(t: StepTarget): TargetType {
  return t.type;
}

function StepSheet({
  stepNumber,
  prevStep,
  initial,
  isEditing,
  onClose,
  onSubmit,
  onDelete,
}: {
  stepNumber: number;
  prevStep: PlanStepDef | undefined;
  initial: PlanStepDef | undefined;
  isEditing: boolean;
  onClose: () => void;
  onSubmit: (step: PlanStepDef) => void;
  onDelete?: () => void;
}) {
  // Legacy 'work' displays as Run-selected but the kind is preserved unless the user picks a chip.
  const [kind, setKind] = useState<StepKind>(initial?.kind ?? 'run');
  const [type, setType] = useState<TargetType>(initial ? targetType(initial.target) : 'time');
  const [unit, setUnit] = useState<'m' | 'km'>(
    initial?.target.type === 'distance' && initial.target.m < 1000 ? 'm' : 'km',
  );
  const [timeBuf, setTimeBuf] = useState(
    initial?.target.type === 'time'
      ? secToBuffer(initial.target.sec)
      : initial?.target.type === 'either'
        ? secToBuffer(initial.target.sec)
        : '',
  );
  const [distBuf, setDistBuf] = useState(
    initial?.target.type === 'distance'
      ? metersToBuffer(initial.target.m, unit)
      : initial?.target.type === 'either'
        ? metersToBuffer(initial.target.m, unit)
        : '',
  );
  const [eitherFocus, setEitherFocus] = useState<'time' | 'distance'>('time');
  const [hrZone, setHrZone] = useState<HrZone | null>(initial?.hrZone ?? null);
  // The shown value acts "selected" until the first key: typing replaces it rather
  // than appending (reset on type/unit/preset/field switch).
  const [fresh, setFresh] = useState(true);

  const chipKind: StepKind = kind === 'work' ? 'run' : kind;

  const target: StepTarget =
    type === 'time'
      ? { type: 'time', sec: timeBufferToSec(timeBuf) }
      : type === 'distance'
        ? { type: 'distance', m: distanceBufferToMeters(distBuf, unit) }
        : type === 'either'
          ? { type: 'either', sec: timeBufferToSec(timeBuf), m: distanceBufferToMeters(distBuf, unit) }
          : { type: 'manual' };

  const valid =
    type === 'manual' ||
    (type === 'time' && target.type === 'time' && target.sec > 0) ||
    (type === 'distance' && target.type === 'distance' && target.m > 0) ||
    (type === 'either' && target.type === 'either' && target.sec > 0 && target.m > 0);

  function pickType(next: TargetType) {
    setType(next);
    setFresh(true);
    if (next === 'time' && !timeBuf) setTimeBuf('100');
    if (next === 'distance' && !distBuf) setDistBuf(unit === 'km' ? '1' : '400');
    if (next === 'either') {
      if (!timeBuf) setTimeBuf('100');
      if (!distBuf) setDistBuf(unit === 'km' ? '1' : '400');
    }
  }

  function pressKey(key: string) {
    const editingTime = type === 'time' || (type === 'either' && eitherFocus === 'time');
    const wasFresh = fresh;
    setFresh(false);
    if (key === 'back') {
      if (editingTime) setTimeBuf((b) => (wasFresh ? '' : kpBackspace(b)));
      else setDistBuf((b) => (wasFresh ? '' : kpBackspace(b)));
      return;
    }
    if (editingTime) {
      setTimeBuf((b) => pushKey(wasFresh ? '' : b, key, { maxDigits: 4 }));
    } else {
      setDistBuf((b) => pushKey(wasFresh ? '' : b, key, { decimal: unit === 'km', maxDigits: 5 }));
    }
  }

  function applyTimePreset(sec: number) {
    setFresh(true);
    setTimeBuf(secToBuffer(sec));
  }
  function applyDistPreset(m: number, u: 'm' | 'km') {
    setFresh(true);
    setUnit(u);
    setDistBuf(metersToBuffer(m, u));
  }

  function submit() {
    if (!valid) return;
    onSubmit({ id: initial?.id ?? crypto.randomUUID(), kind, target, hrZone: hrZone ?? undefined });
  }

  const primaryLabel = isEditing ? 'Update step' : `+ Add ${CHIP_LABEL[chipKind]} · ${fmtTarget(target)}`;

  return (
    <div className="builder-sheet-backdrop" onClick={onClose}>
      <div className="builder-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="builder-sheet-handle" />
        <div className="builder-sheet-head">
          <h3>Step {stepNumber}</h3>
          {prevStep && (
            <span className="muted small">
              after {CHIP_LABEL[prevStep.kind]} {fmtTarget(prevStep.target)}
            </span>
          )}
        </div>

        <div className="builder-sheet-section">
          <span className="field-label">Type</span>
          <div className="builder-chip-row">
            {CHIP_KINDS.map((k) => (
              <button
                key={k}
                className={`tag ${chipKind === k ? 'tag-accent builder-chip-active' : 'tag-outline'}`}
                onClick={() => setKind(k)}
              >
                {CHIP_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="builder-sheet-section">
          <span className="field-label">Ends after</span>
          <div className="seg">
            <button className={`seg-opt ${type === 'time' ? 'seg-opt-active' : ''}`} onClick={() => pickType('time')}>
              <Timer size={14} /> Time
            </button>
            <button
              className={`seg-opt ${type === 'distance' ? 'seg-opt-active' : ''}`}
              onClick={() => pickType('distance')}
            >
              <Ruler size={14} /> Distance
            </button>
            <button className={`seg-opt ${type === 'either' ? 'seg-opt-active' : ''}`} onClick={() => pickType('either')}>
              Either
            </button>
            <button className={`seg-opt ${type === 'manual' ? 'seg-opt-active' : ''}`} onClick={() => pickType('manual')}>
              Tap
            </button>
          </div>
        </div>

        {type !== 'manual' && (
          <>
            <div className="builder-sheet-section builder-value-block">
              {(type === 'time' || type === 'either') && (
                <ValueRow
                  big={type === 'time'}
                  focused={type === 'either' ? eitherFocus === 'time' : true}
                  onFocus={() => { setEitherFocus('time'); setFresh(true); }}
                  value={fmtTimeBuffer(timeBuf)}
                  unitControl={<span className="builder-unit-label">mm:ss</span>}
                />
              )}
              {(type === 'distance' || type === 'either') && (
                <ValueRow
                  big={type === 'distance'}
                  focused={type === 'either' ? eitherFocus === 'distance' : true}
                  onFocus={() => { setEitherFocus('distance'); setFresh(true); }}
                  value={unit === 'km' ? (parseFloat(distBuf) || 0).toString() : (parseFloat(distBuf) || 0).toString()}
                  unitControl={
                    <div className="seg seg-sm">
                      <button
                        className={`seg-opt ${unit === 'm' ? 'seg-opt-active' : ''}`}
                        onClick={() => {
                          setUnit('m'); setFresh(true);
                          setDistBuf((b) => metersToBuffer(distanceBufferToMeters(b, unit), 'm'));
                        }}
                      >
                        m
                      </button>
                      <button
                        className={`seg-opt ${unit === 'km' ? 'seg-opt-active' : ''}`}
                        onClick={() => {
                          setUnit('km'); setFresh(true);
                          setDistBuf((b) => metersToBuffer(distanceBufferToMeters(b, unit), 'km'));
                        }}
                      >
                        km
                      </button>
                    </div>
                  }
                />
              )}
            </div>

            <div className="builder-presets">
              {type === 'distance' || (type === 'either' && eitherFocus === 'distance') ? (
                <>
                  <PresetChip onClick={() => applyDistPreset(400, 'm')}>400 m</PresetChip>
                  <PresetChip onClick={() => applyDistPreset(800, 'm')}>800 m</PresetChip>
                  <PresetChip onClick={() => applyDistPreset(1000, 'km')}>1 km</PresetChip>
                  <PresetChip onClick={() => applyDistPreset(1500, 'km')}>1.5 km</PresetChip>
                  <PresetChip onClick={() => applyDistPreset(5000, 'km')}>5 km</PresetChip>
                </>
              ) : (
                <>
                  <PresetChip onClick={() => applyTimePreset(60)}>1:00</PresetChip>
                  <PresetChip onClick={() => applyTimePreset(120)}>2:00</PresetChip>
                  <PresetChip onClick={() => applyTimePreset(300)}>5:00</PresetChip>
                  <PresetChip onClick={() => applyTimePreset(600)}>10:00</PresetChip>
                  <PresetChip onClick={() => applyTimePreset(1200)}>20:00</PresetChip>
                </>
              )}
            </div>

            <div className="builder-keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((k) => (
                <button key={k} className="builder-keypad-key" onClick={() => pressKey(k)}>
                  {k === 'back' ? <Backspace size={18} /> : k}
                </button>
              ))}
            </div>
          </>
        )}
        {type === 'manual' && <p className="muted small">Ends when you tap Next during the workout.</p>}

        <div className="builder-sheet-section">
          <span className="field-label">HR zone</span>
          <div className="builder-chip-row">
            <button className={`tag ${hrZone == null ? 'tag-accent builder-chip-active' : 'tag-outline'}`} onClick={() => setHrZone(null)}>
              Off
            </button>
            {([1, 2, 3, 4, 5] as HrZone[]).map((z) => (
              <button
                key={z}
                className={`tag ${hrZone === z ? 'tag-accent builder-chip-active' : 'tag-outline'}`}
                onClick={() => setHrZone(z)}
              >
                Z{z}
              </button>
            ))}
          </div>
        </div>

        <button className="btn" onClick={submit} disabled={!valid}>
          {primaryLabel}
        </button>
        {isEditing && onDelete && (
          <button className="btn-ghost builder-delete-step" onClick={onDelete}>
            Delete step
          </button>
        )}
      </div>
    </div>
  );
}

function ValueRow({
  big,
  focused,
  onFocus,
  value,
  unitControl,
}: {
  big: boolean;
  focused: boolean;
  onFocus: () => void;
  value: string;
  unitControl: React.ReactNode;
}) {
  return (
    <div className={`builder-value-row ${focused ? 'builder-value-row-focused' : ''}`} onClick={onFocus}>
      <span className={`builder-value ${big ? 'builder-value-big' : ''}`}>{value}</span>
      {unitControl}
    </div>
  );
}

function PresetChip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="tag tag-outline builder-preset" onClick={onClick}>
      {children}
    </button>
  );
}

// Kept for Record.tsx's own mm:ss goal input (unrelated to the 2b keypad above).
export function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function parseSec(text: string): number {
  if (text.includes(':')) {
    const [m, s] = text.split(':').map((n) => parseInt(n, 10) || 0);
    return m * 60 + s;
  }
  return parseInt(text, 10) || 0;
}
