import { useState } from 'react';
import { X, Minus, Plus } from 'lucide-react';
import { savePlan } from '@/db/db';
import type { IntervalPlan, StepTarget } from '@/model/intervalPlan';
import { planSummary } from '@/model/intervalPlan';
import type { Sport } from '@/model/workout';

const SPORTS: { id: Sport; label: string }[] = [
  { id: 'run', label: 'Run' },
  { id: 'walk', label: 'Walk' },
  { id: 'ride', label: 'Ride' },
];

/** Editor for a reusable interval template. */
export function IntervalBuilder({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [sport, setSport] = useState<Sport>('run');
  const [warmup, setWarmup] = useState<StepTarget | null>({ type: 'time', sec: 300 });
  const [work, setWork] = useState<StepTarget>({ type: 'time', sec: 135 });
  const [recovery, setRecovery] = useState<StepTarget | null>({ type: 'time', sec: 105 });
  const [repeats, setRepeats] = useState(5);
  const [cooldown, setCooldown] = useState<StepTarget | null>({ type: 'time', sec: 300 });
  const [autoFinish, setAutoFinish] = useState(true);

  const preview: IntervalPlan = {
    id: '', name, sport, warmup, work, recovery, repeats, cooldown, autoFinish,
    createdAt: '',
  };

  async function submit() {
    const plan: IntervalPlan = {
      ...preview,
      id: crypto.randomUUID(),
      name: name.trim() || defaultName(preview),
      createdAt: new Date().toISOString(),
    };
    await savePlan(plan);
    onSaved();
  }

  return (
    <div className="overlay">
      <header className="overlay-head">
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={24} />
        </button>
        <h2>New interval</h2>
        <span style={{ width: 24 }} />
      </header>

      <div className="overlay-body goal-editor">
        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={name}
            placeholder="Walk / Run intervals"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Sport</span>
          <div className="seg">
            {SPORTS.map((s) => (
              <button
                key={s.id}
                className={`seg-opt ${sport === s.id ? 'seg-opt-active' : ''}`}
                onClick={() => setSport(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </label>

        <TargetEditor label="Warm-up" value={warmup} onChange={setWarmup} allowNone allowDistance />
        <TargetEditor label="Work" value={work} onChange={(v) => v && setWork(v)} allowDistance allowManual />
        <TargetEditor label="Recovery" value={recovery} onChange={setRecovery} allowNone />

        <div className="field">
          <span className="field-label">Repeats</span>
          <div className="stepper">
            <button className="stepper-btn" onClick={() => setRepeats((n) => Math.max(1, n - 1))} aria-label="Fewer">
              <Minus size={16} />
            </button>
            <span className="stepper-value">{repeats}</span>
            <button className="stepper-btn" onClick={() => setRepeats((n) => Math.min(30, n + 1))} aria-label="More">
              <Plus size={16} />
            </button>
          </div>
        </div>

        <TargetEditor label="Cooldown" value={cooldown} onChange={setCooldown} allowNone allowDistance />

        <label className="field">
          <span className="field-label">Auto-finish when done</span>
          <input type="checkbox" checked={autoFinish} onChange={(e) => setAutoFinish(e.target.checked)} />
        </label>

        <p className="muted small plan-preview">{planSummary(preview)}</p>

        <button className="btn" onClick={submit}>Save interval</button>
      </div>
    </div>
  );
}

/** Segmented target editor: None / Time / Distance / Manual + a value input. */
function TargetEditor({
  label,
  value,
  onChange,
  allowNone,
  allowDistance,
  allowManual,
}: {
  label: string;
  value: StepTarget | null;
  onChange: (v: StepTarget | null) => void;
  allowNone?: boolean;
  allowDistance?: boolean;
  allowManual?: boolean;
}) {
  const type = value?.type ?? 'none';

  function pick(next: string) {
    if (next === 'none') onChange(null);
    else if (next === 'time') onChange({ type: 'time', sec: 120 });
    else if (next === 'distance') onChange({ type: 'distance', m: 400 });
    else onChange({ type: 'manual' });
  }

  return (
    <div className="field target-field">
      <div className="target-head">
        <span className="field-label">{label}</span>
        <div className="seg seg-sm">
          {allowNone && <TypeOpt id="none" cur={type} onPick={pick} text="Off" />}
          <TypeOpt id="time" cur={type} onPick={pick} text="Time" />
          {allowDistance && <TypeOpt id="distance" cur={type} onPick={pick} text="Dist" />}
          {allowManual && <TypeOpt id="manual" cur={type} onPick={pick} text="Lap" />}
        </div>
      </div>
      {value?.type === 'time' && (
        <input
          className="input"
          value={fmtSec(value.sec)}
          onChange={(e) => onChange({ type: 'time', sec: parseSec(e.target.value) })}
          placeholder="mm:ss"
          inputMode="numeric"
        />
      )}
      {value?.type === 'distance' && (
        <input
          className="input"
          type="number"
          value={value.m}
          onChange={(e) => onChange({ type: 'distance', m: parseInt(e.target.value, 10) || 0 })}
          placeholder="meters"
          inputMode="numeric"
        />
      )}
      {value?.type === 'manual' && <span className="muted small">Ends when you tap Next</span>}
    </div>
  );
}

function TypeOpt({ id, cur, onPick, text }: { id: string; cur: string; onPick: (v: string) => void; text: string }) {
  return (
    <button className={`seg-opt ${cur === id ? 'seg-opt-active' : ''}`} onClick={() => onPick(id)}>
      {text}
    </button>
  );
}

function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function parseSec(text: string): number {
  if (text.includes(':')) {
    const [m, s] = text.split(':').map((n) => parseInt(n, 10) || 0);
    return m * 60 + s;
  }
  return parseInt(text, 10) || 0;
}

function defaultName(p: IntervalPlan): string {
  return `${p.repeats}× ${p.sport} intervals`;
}
