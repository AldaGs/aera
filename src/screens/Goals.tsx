import { useEffect, useState } from 'react';
import { Target, Plus, X, Trash2, Check } from 'lucide-react';
import { listGoals, saveGoal, deleteGoal, type WorkoutMeta } from '@/db/db';
import type { Goal, GoalMetric } from '@/model/goal';
import type { Sport } from '@/model/workout';
import { computeGoalProgress } from '@/metrics/goals';

const METRICS: { id: GoalMetric; label: string; unit: string; hint: string }[] = [
  { id: 'continuous-distance', label: 'Continuous distance', unit: 'km', hint: 'Longest single non-stop effort' },
  { id: 'distance', label: 'Total distance', unit: 'km', hint: 'Summed over the window' },
  { id: 'frequency', label: 'Activities', unit: 'count', hint: 'Number of sessions' },
  { id: 'duration', label: 'Total time', unit: 'min', hint: 'Summed moving time' },
  { id: 'pace', label: 'Avg pace', unit: 'mm:ss/km', hint: 'On a single run' },
];

const SPORTS: { id: Sport | 'any'; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'run', label: 'Run' },
  { id: 'walk', label: 'Walk' },
  { id: 'ride', label: 'Ride' },
];

export function GoalsSection({ workouts }: { workouts: WorkoutMeta[] }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [editing, setEditing] = useState(false);

  function reload() {
    listGoals().then(setGoals);
  }
  useEffect(reload, []);

  async function remove(id: string) {
    await deleteGoal(id);
    reload();
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <Target size={18} className="icon-grad" />
        <h2>Goals</h2>
        <button className="panel-action" onClick={() => setEditing(true)} aria-label="New goal">
          <Plus size={18} />
        </button>
      </div>

      {goals.length === 0 ? (
        <p className="muted small">No goals yet. Tap + to set one — e.g. run 1 continuous km by Aug 30.</p>
      ) : (
        <ul className="goal-list">
          {goals.map((g) => {
            const p = computeGoalProgress(g, workouts);
            return (
              <li key={g.id} className="goal-row">
                <div className="goal-row-top">
                  <span className="goal-title">
                    {p.done && <Check size={14} className="goal-check" />} {g.title}
                  </span>
                  <button className="goal-del" onClick={() => remove(g.id)} aria-label="Delete goal">
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="goal-bar">
                  <div
                    className={`goal-fill ${p.done ? 'goal-fill-done' : ''}`}
                    style={{ width: `${Math.round(p.pct * 100)}%` }}
                  />
                </div>
                <div className="goal-row-bottom muted small">
                  <span>{p.label}</span>
                  {p.daysLeft != null && (
                    <span>{p.daysLeft >= 0 ? `${p.daysLeft}d left` : 'past due'}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <GoalEditor
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
    </section>
  );
}

function GoalEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState<GoalMetric>('continuous-distance');
  const [sport, setSport] = useState<Sport | 'any'>('run');
  const [amount, setAmount] = useState('1');
  const [paceText, setPaceText] = useState('5:30');
  const [deadline, setDeadline] = useState('');

  const spec = METRICS.find((m) => m.id === metric)!;

  function targetValue(): number {
    if (metric === 'pace') {
      const [m, s] = paceText.split(':').map((n) => parseInt(n, 10) || 0);
      return m * 60 + s;
    }
    const n = parseFloat(amount) || 0;
    if (metric === 'distance' || metric === 'continuous-distance') return n * 1000;
    if (metric === 'duration') return n * 60;
    return n; // frequency
  }

  async function submit() {
    const goal: Goal = {
      id: crypto.randomUUID(),
      title: title.trim() || defaultTitle(metric, sport, targetValue(), deadline),
      sport: sport === 'any' ? null : sport,
      metric,
      target: targetValue(),
      deadline: deadline || null,
      createdAt: new Date().toISOString(),
      doneAt: null,
    };
    await saveGoal(goal);
    onSaved();
  }

  return (
    <div className="overlay">
      <header className="overlay-head">
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={24} />
        </button>
        <h2>New goal</h2>
        <span style={{ width: 24 }} />
      </header>
      <div className="overlay-body goal-editor">
        <label className="field">
          <span className="field-label">Title</span>
          <input
            className="input"
            value={title}
            placeholder="Run 1 continuous km"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Metric</span>
          <select className="input" value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)}>
            {METRICS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <span className="muted small">{spec.hint}</span>
        </label>

        <label className="field">
          <span className="field-label">Sport</span>
          <select className="input" value={sport} onChange={(e) => setSport(e.target.value as Sport | 'any')}>
            {SPORTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Target ({spec.unit})</span>
          {metric === 'pace' ? (
            <input className="input" value={paceText} onChange={(e) => setPaceText(e.target.value)} placeholder="5:30" />
          ) : (
            <input
              className="input"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </label>

        <label className="field">
          <span className="field-label">Deadline (optional)</span>
          <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>

        <button className="btn" onClick={submit}>Save goal</button>
      </div>
    </div>
  );
}

function defaultTitle(metric: GoalMetric, sport: Sport | 'any', target: number, deadline: string): string {
  const who = sport === 'any' ? '' : `${sport} `;
  const by = deadline ? ` by ${new Date(deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';
  switch (metric) {
    case 'continuous-distance':
      return `${who}${target / 1000} km non-stop${by}`;
    case 'distance':
      return `${who}${target / 1000} km total${by}`;
    case 'duration':
      return `${who}${Math.round(target / 60)} min${by}`;
    case 'frequency':
      return `${target} ${who}activities${by}`;
    case 'pace':
      return `${who}pace under target${by}`;
  }
}
