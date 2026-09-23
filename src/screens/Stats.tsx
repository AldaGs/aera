import { useEffect, useMemo, useState } from 'react';
import {
  Medal,
  TrendUp,
  CaretRight,
  CaretLeft,
  Fire,
  Mountains,
  Timer,
  Path,
  SneakerMove,
  PersonSimpleWalk,
  Bicycle,
  Watch,
  DeviceMobile,
} from '@phosphor-icons/react';
import { listWorkouts, type WorkoutMeta } from '@/db/db';
import {
  sumTotals,
  filterByRange,
  type Range,
} from '@/metrics/aggregate';
import {
  buildWeeklyBars,
  buildMonthGrid,
  daySizeBucket,
  monthTotals,
  routePreviewPath,
  isWatchRecorded,
  type WeekBar,
  type DayCell,
} from '@/metrics/statsView';
import { computeRecords } from '@/metrics/records';
import { InsightsSection } from '@/screens/Insights';
import { GoalsSection } from '@/screens/Goals';
import { fmtDistance, fmtDuration } from '@/format';

const RANGES: { id: Range; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'all', label: 'All' },
];

const SPORT_ICON = { run: SneakerMove, walk: PersonSimpleWalk, ride: Bicycle } as const;

type View = 'summary' | 'calendar';

export function Stats({
  onOpenWorkout,
  reloadKey,
}: {
  onOpenWorkout: (id: string) => void;
  reloadKey: number;
}) {
  const [all, setAll] = useState<WorkoutMeta[]>([]);
  const [range, setRange] = useState<Range>('month');
  const [view, setView] = useState<View>('summary');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    listWorkouts().then(setAll);
  }, [reloadKey]);

  const inRange = useMemo(() => filterByRange(all, range), [all, range]);
  const totals = sumTotals(inRange);
  const bars = useMemo(() => buildWeeklyBars(all, 8), [all]);
  const records = useMemo(() => computeRecords(all), [all]);

  return (
    <div className="screen">
      <header className="app-header">
        <h1 className="wordmark">Stats</h1>
      </header>

      <div className="seg seg-sm" style={{ marginBottom: 18 }}>
        <button
          className={`seg-opt ${view === 'summary' ? 'seg-opt-active' : ''}`}
          onClick={() => setView('summary')}
        >
          Summary
        </button>
        <button
          className={`seg-opt ${view === 'calendar' ? 'seg-opt-active' : ''}`}
          onClick={() => setView('calendar')}
        >
          Calendar
        </button>
      </div>

      {view === 'summary' ? (
        <>
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
            <BigStat icon={Path} value={fmtDistance(totals.distanceM)} label="Distance" />
            <BigStat icon={Timer} value={fmtHm(totals.durationSec)} label="Moving time" />
            <BigStat icon={Fire} value={`${totals.count}`} label="Activities" />
            <BigStat icon={Mountains} value={`${Math.round(totals.elevGainM)} m`} label="Elevation" />
          </div>

          <section className="panel">
            <div className="panel-head">
              <TrendUp size={18} className="icon-grad" />
              <h2>Weekly distance</h2>
            </div>
            <TrendBars bars={bars} />
          </section>

          <section className="panel">
            <div className="panel-head">
              <Path size={18} className="icon-grad" />
              <h2>All activities</h2>
            </div>
            <ul className="activity-list">
              {inRange.map((w) => (
                <li key={w.id}>
                  <ActivityRow w={w} onOpen={() => onOpenWorkout(w.id)} />
                </li>
              ))}
              {inRange.length === 0 && <p className="muted center">No activities in range.</p>}
            </ul>
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
                  {r.workoutId ? (
                    <button
                      className="record-value record-link"
                      onClick={() => onOpenWorkout(r.workoutId!)}
                    >
                      {r.value}
                    </button>
                  ) : (
                    <span className="record-value">{r.value}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>


          <InsightsSection workouts={all} />
          <GoalsSection workouts={all} />
        </>
      ) : (
        <CalendarView
          all={all}
          month={month}
          setMonth={setMonth}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          onOpenWorkout={onOpenWorkout}
        />
      )}
    </div>
  );
}

function ActivityRow({ w, onOpen }: { w: WorkoutMeta; onOpen: () => void }) {
  const SportIcon = SPORT_ICON[w.sport];
  return (
    <button className="activity-row" onClick={onOpen}>
      <SportIcon size={20} className="muted" />
      <div className="activity-info">
        <span className="activity-title">{w.title}</span>
        <span className="muted small">{fmtDayMonth(w.startedAt)}</span>
      </div>
      <span className="activity-dist">{fmtDistance(w.summary.distanceM)}</span>
      <CaretRight size={18} className="muted" />
    </button>
  );
}

function BigStat({
  icon: IconCmp,
  value,
  label,
}: {
  icon: typeof Path;
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

function TrendBars({ bars }: { bars: WeekBar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.km));
  return (
    <div className="trend">
      {bars.map((b, i) => (
        <div key={i} className="trend-col">
          <div className="trend-bar-wrap">
            <div
              className={`trend-bar trend-bar-${b.tier}`}
              style={{ height: `${(b.km / max) * 100}%` }}
              title={`${b.km.toFixed(1)} km`}
            />
          </div>
          <span className={`trend-label ${b.tier === 'current' ? 'trend-label-current' : ''}`}>
            {b.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 1f · Calendar history: month grid of activity-scaled dots + a day-filtered
 * session list below it. */
function CalendarView({
  all,
  month,
  setMonth,
  selectedDay,
  setSelectedDay,
  onOpenWorkout,
}: {
  all: WorkoutMeta[];
  month: Date;
  setMonth: (d: Date) => void;
  selectedDay: string | null;
  setSelectedDay: (iso: string | null) => void;
  onOpenWorkout: (id: string) => void;
}) {
  const grid = useMemo(() => buildMonthGrid(all, month), [all, month]);
  const totals = useMemo(() => monthTotals(all, month), [all, month]);
  const maxDay = Math.max(0, ...grid.map((c) => c.distanceM));

  const sessions = useMemo(() => {
    const y = month.getFullYear();
    const m = month.getMonth();
    return all
      .filter((w) => {
        const d = new Date(w.startedAt);
        if (d.getFullYear() !== y || d.getMonth() !== m) return false;
        if (selectedDay) return w.startedAt.slice(0, 10) === selectedDay;
        return true;
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [all, month, selectedDay]);

  function changeMonth(delta: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
    setSelectedDay(null);
  }

  return (
    <>
      <div className="cal-header">
        <button className="icon-btn" onClick={() => changeMonth(-1)} aria-label="Previous month">
          <CaretLeft size={18} className="muted" />
        </button>
        <h2 className="cal-month-title">
          {month.toLocaleDateString(undefined, { month: 'long' })}
        </h2>
        <button className="icon-btn" onClick={() => changeMonth(1)} aria-label="Next month">
          <CaretRight size={18} className="muted" />
        </button>
      </div>
      <p className="cal-totals">
        {totals.count} session{totals.count === 1 ? '' : 's'} · {fmtDistance(totals.distanceM)} ·{' '}
        {fmtHm(totals.durationSec)}
      </p>

      <div className="cal-weekdays">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="cal-grid">
        {grid.map((cell, i) => (
          <CalDay
            key={i}
            cell={cell}
            maxDay={maxDay}
            selected={!!cell.iso && cell.iso === selectedDay}
            onTap={() =>
              cell.iso && setSelectedDay(selectedDay === cell.iso ? null : cell.iso)
            }
          />
        ))}
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <ul className="activity-list">
          {sessions.map((w) => (
            <li key={w.id}>
              <SessionRow w={w} onOpen={() => onOpenWorkout(w.id)} />
            </li>
          ))}
          {sessions.length === 0 && <p className="muted center">No activities.</p>}
        </ul>
      </section>
    </>
  );
}

function CalDay({
  cell,
  maxDay,
  selected,
  onTap,
}: {
  cell: DayCell;
  maxDay: number;
  selected: boolean;
  onTap: () => void;
}) {
  if (!cell.date) return <div className="cal-day cal-day-pad" />;
  const bucket = daySizeBucket(cell.distanceM, maxDay);
  const classes = [
    'cal-day',
    bucket ? `cal-day-${bucket}` : '',
    cell.isToday ? 'cal-day-today' : '',
    cell.isFuture ? 'cal-day-future' : '',
    !bucket && !cell.isToday && !cell.isFuture ? 'cal-day-empty' : '',
    selected ? 'cal-day-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={classes} onClick={onTap} disabled={!bucket && !cell.isToday}>
      {cell.date.getDate()}
    </button>
  );
}

function SessionRow({ w, onOpen }: { w: WorkoutMeta; onOpen: () => void }) {
  const path = routePreviewPath(w.summary.routePreview);
  const zones = w.summary.hrZones;
  const zoneTotal = zones ? zones.reduce((a, b) => a + b, 0) : 0;
  const watch = isWatchRecorded(w.source);
  const d = new Date(w.startedAt);
  const day = `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}`;

  return (
    <button className="activity-row session-row" onClick={onOpen}>
      <span className="route-thumb">
        {path && (
          <svg viewBox="0 0 44 44" width={44} height={44}>
            <polyline points={path} fill="none" stroke="var(--color-accent-400)" strokeWidth={1.6} />
          </svg>
        )}
      </span>
      <div className="activity-info">
        <span className="activity-title">
          {w.title} · <span className="muted">{fmtDistance(w.summary.distanceM)}</span>
        </span>
        {zones && zoneTotal > 0 && (
          <div className="zone-strip">
            {zones.map((secs, i) =>
              secs > 0 ? (
                <span
                  key={i}
                  className={`zone-strip-seg zone-fill-${i + 1}`}
                  style={{ flex: secs }}
                />
              ) : null,
            )}
          </div>
        )}
        <span className="muted small">
          {day} · {fmtDuration(w.summary.durationMovingSec)}
          {w.summary.avgHr != null ? ` · avg ${Math.round(w.summary.avgHr)} bpm` : ''}
          {' · '}
          {watch ? <Watch size={12} weight="fill" /> : <DeviceMobile size={12} weight="fill" />}
        </span>
      </div>
      <CaretRight size={18} className="muted" />
    </button>
  );
}

/** "9h 02m" (or "41m") for period totals. */
function fmtHm(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** "Tue 22 Sep" */
function fmtDayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`;
}
