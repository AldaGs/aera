import { useState } from 'react';
import {
  X,
  Plus,
  Timer,
  Ruler,
  DotsSixVertical,
  Watch,
  Backspace,
} from '@phosphor-icons/react';
import { savePlan } from '@/db/db';
import type { IntervalPlan, PlanStepDef, RepeatBlock, StepKind, StepTarget } from '@/model/intervalPlan';
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

/** Path to an authored step: top-level index, or [blockIndex, innerIndex] inside a repeat block. */
type StepPath = number | [number, number];

function stepAt(steps: (PlanStepDef | RepeatBlock)[], path: StepPath): PlanStepDef {
  if (typeof path === 'number') return steps[path] as PlanStepDef;
  return (steps[path[0]] as RepeatBlock).steps[path[1]];
}

function replaceStep(
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

function removeStep(steps: (PlanStepDef | RepeatBlock)[], path: StepPath): (PlanStepDef | RepeatBlock)[] {
  if (typeof path === 'number') return steps.filter((_, i) => i !== path);
  const [bi, si] = path;
  const copy = steps.slice();
  const block = copy[bi] as RepeatBlock;
  const innerSteps = block.steps.filter((_, i) => i !== si);
  if (innerSteps.length === 0) copy.splice(bi, 1);
  else copy[bi] = { ...block, steps: innerSteps };
  return copy;
}

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

        <input
          className="builder-name"
          value={draft.name}
          placeholder={defaultName(draft)}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
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

        <ul className="builder-steps">
          {draft.steps.length === 0 && (
            <li className="muted small builder-empty">
              No steps yet — tap "+ Add step" to build your workout.
            </li>
          )}
          {draft.steps.map((item, i) =>
            'repeat' in item ? (
              <li key={item.id} className="builder-repeat-block">
                <div className="builder-repeat-head">{item.repeat}×</div>
                <ul className="builder-steps">
                  {item.steps.map((s, j) => (
                    <StepRow key={s.id} step={s} onClick={() => openEditSheet([i, j])} />
                  ))}
                </ul>
              </li>
            ) : (
              <StepRow key={item.id} step={item} onClick={() => openEditSheet(i)} />
            ),
          )}
        </ul>

        <div className="builder-actions">
          <button className="btn" onClick={openAddSheet}>
            <Plus size={16} /> Add step
          </button>
          <button className="btn-ghost" disabled title="Coming soon">
            Repeat block
          </button>
        </div>

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

function pathEq(a: StepPath, b: StepPath): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

function StepRow({ step, onClick }: { step: PlanStepDef; onClick: () => void }) {
  const isDistanceRun = (step.kind === 'run' || step.kind === 'work') && step.target.type === 'distance';
  const TypeIcon = step.target.type === 'distance' ? Ruler : Timer;
  return (
    <li className={`builder-step-row ${isDistanceRun ? 'builder-step-row-dist' : ''}`}>
      <button className="builder-step-main" onClick={onClick}>
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
        <span className="builder-step-value">{fmtTarget(step.target)}</span>
      </button>
      <DotsSixVertical size={18} className="builder-step-handle" />
    </li>
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
    onSubmit({ id: initial?.id ?? crypto.randomUUID(), kind, target });
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
