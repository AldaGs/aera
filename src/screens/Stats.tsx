import { useEffect, useMemo, useState } from 'react';
import { Medal, TrendingUp, ChevronRight, Flame, Mountain, Timer, Route } from 'lucide-react';
import { listWorkouts, type WorkoutMeta } from '@/db/db';
import {
  sumTotals,
  filterByRange,
  weeklyDistanceBuckets,
  type Range,
} from '@/metrics/aggregate';
import { fmtDistance, fmtDuration, fmtDate } from '@/format';

const RANGES: { id: Range; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'all', label: 'All' },
];

export function Stats({
  onOpenWorkout,
  reloadKey,
}: {
  onOpenWorkout: (id: string) => void;
  reloadKey: number;
}) {
  const [all, setAll] = useState<WorkoutMeta[]>([]);
  const [range, setRange] = useState<Range>('month');

  useEffect(() => {
    listWorkouts().then(setAll);
  }, [reloadKey]);

  const inRange = useMemo(() => filterByRange(all, range), [all, range]);
  const totals = sumTotals(inRange);
  const buckets = useMemo(() => weeklyDistanceBuckets(all, 8), [all]);
  const records = useMemo(() => computeRecordsSafe(all), [all]);

  return (
    <div className="screen">
      <header className="app-header">
        <h1 className="wordmark">Stats</h1>
      </header>

      <div className="range-toggle">
        {RANGES.map((r) => (
          <button
            key={r.id}
            className={`range-opt ${range === r.id ? 'range-opt-active' : ''}`}
            onClick={() => setRange(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="stat-grid">
        <BigStat icon={Route} value={fmtDistance(totals.distanceM)} label="Distance" />
        <BigStat icon={Timer} value={fmtDuration(totals.durationSec)} label="Moving time" />
        <BigStat icon={Flame} value={`${totals.count}`} label="Activities" />
        <BigStat icon={Mountain} value={`${Math.round(totals.elevGainM)} m`} label="Elevation" />
      </div>

      <section className="panel">
        <div className="panel-head">
          <TrendingUp size={18} className="icon-grad" />
          <h2>Weekly distance</h2>
        </div>
        <TrendBars buckets={buckets} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <Medal size={18} className="icon-grad" />
          <h2>Personal records</h2>
        </div>
        <ul className="record-list">
          {records.map((r) => (
            <li key={r.label} className="record-row">
              <span className="record-label">{r.label}</span>
              <span className="record-value">{r.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head">
          <Route size={18} className="icon-grad" />
          <h2>All activities</h2>
        </div>
        <ul className="activity-list">
          {inRange.map((w) => (
            <li key={w.id}>
              <button className="activity-row" onClick={() => onOpenWorkout(w.id)}>
                <span className="activity-emoji">{w.sport === 'run' ? '🏃' : '🚴'}</span>
                <div className="activity-info">
                  <span className="activity-title">{w.title}</span>
                  <span className="muted small">{fmtDate(w.startedAt)}</span>
                </div>
                <span className="activity-dist">{fmtDistance(w.summary.distanceM)}</span>
                <ChevronRight size={18} className="muted" />
              </button>
            </li>
          ))}
          {inRange.length === 0 && <p className="muted center">No activities in range.</p>}
        </ul>
      </section>
    </div>
  );
}

function BigStat({
  icon: IconCmp,
  value,
  label,
}: {
  icon: typeof Route;
  value: string;
  label: string;
}) {
  return (
    <div className="big-stat">
      <IconCmp size={20} className="icon-grad" />
      <span className="big-stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function TrendBars({ buckets }: { buckets: { label: string; km: number }[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.km));
  return (
    <div className="trend">
      {buckets.map((b, i) => (
        <div key={i} className="trend-col">
          <div className="trend-bar-wrap">
            <div
              className="trend-bar"
              style={{ height: `${(b.km / max) * 100}%` }}
              title={`${b.km.toFixed(1)} km`}
            />
          </div>
          <span className="trend-label">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

interface PR {
  label: string;
  value: string;
}

function computeRecordsSafe(all: WorkoutMeta[]): PR[] {
  if (all.length === 0) {
    return [
      { label: 'Longest run', value: '—' },
      { label: 'Longest ride', value: '—' },
      { label: 'Most elevation', value: '—' },
      { label: 'Longest session', value: '—' },
    ];
  }
  const runs = all.filter((w) => w.sport === 'run');
  const rides = all.filter((w) => w.sport === 'ride');
  const longestRun = Math.max(0, ...runs.map((w) => w.summary.distanceM));
  const longestRide = Math.max(0, ...rides.map((w) => w.summary.distanceM));
  const mostElev = Math.max(0, ...all.map((w) => w.summary.elevGainM));
  const longestTime = Math.max(0, ...all.map((w) => w.summary.durationMovingSec));
  return [
    { label: 'Longest run', value: longestRun ? fmtDistance(longestRun) : '—' },
    { label: 'Longest ride', value: longestRide ? fmtDistance(longestRide) : '—' },
    { label: 'Most elevation', value: `${Math.round(mostElev)} m` },
    { label: 'Longest session', value: fmtDuration(longestTime) },
  ];
}
