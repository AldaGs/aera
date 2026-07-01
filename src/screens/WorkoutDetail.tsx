import { useEffect, useState } from 'react';
import { X, Share2, Mountain, Heart, Timer, Gauge, MapPin, Flame } from 'lucide-react';
import { getWorkout } from '@/db/db';
import type { Workout } from '@/model/workout';
import { RouteMap } from '@/ui/RouteMap';
import { fmtDate, fmtDistance, fmtDuration, fmtPace, fmtSpeed } from '@/format';

export function WorkoutDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [w, setW] = useState<Workout | undefined>();

  useEffect(() => {
    getWorkout(id).then(setW);
  }, [id]);

  if (!w) {
    return (
      <div className="overlay">
        <OverlayHead onClose={onClose} title="Activity" />
        <p className="muted center">Loading…</p>
      </div>
    );
  }

  const isRun = w.sport === 'run';
  const s = w.summary;

  return (
    <div className="overlay">
      <OverlayHead onClose={onClose} title={w.title} />
      <div className="overlay-body">
        <p className="muted small">
          {w.sport === 'run' ? '🏃 Run' : '🚴 Ride'} · {fmtDate(w.startedAt)}
        </p>

        <div className="detail-map">
          <RouteMap path={s.routePreview} bounds={s.bounds} height={220} strokeWidth={4} />
        </div>

        <div className="stat-grid detail-grid">
          <BigStat icon={MapPin} value={fmtDistance(s.distanceM)} label="Distance" />
          <BigStat icon={Timer} value={fmtDuration(s.durationMovingSec)} label="Moving" />
          <BigStat
            icon={Gauge}
            value={isRun ? fmtPace(s.avgPaceSecPerKm) : fmtSpeed(s.avgSpeedKmh)}
            label={isRun ? 'Avg pace' : 'Avg speed'}
          />
          <BigStat icon={Mountain} value={`${Math.round(s.elevGainM)} m`} label="Elev gain" />
          <BigStat icon={Heart} value={s.avgHr ? `${Math.round(s.avgHr)}` : '—'} label="Avg HR" />
          <BigStat icon={Flame} value={s.maxHr ? `${Math.round(s.maxHr)}` : '—'} label="Max HR" />
          {isRun && s.gradeAdjustedPaceSecPerKm != null && (
            <BigStat
              icon={Gauge}
              value={fmtPace(s.gradeAdjustedPaceSecPerKm)}
              label="Grade-adj pace"
            />
          )}
        </div>

        {s.elevGainM > 0 && (
          <section className="panel">
            <div className="panel-head">
              <Mountain size={18} className="icon-grad" />
              <h2>Elevation</h2>
            </div>
            <Sparkline values={w.track.map((p) => p.alt).filter((v): v is number => v != null)} />
          </section>
        )}

        {s.avgHr != null && (
          <section className="panel">
            <div className="panel-head">
              <Heart size={18} className="icon-grad" />
              <h2>Heart rate</h2>
            </div>
            <Sparkline
              values={w.track.map((p) => p.hr).filter((v): v is number => v != null)}
              color="#ff5a1f"
            />
          </section>
        )}

        {s.hrZones && s.hrZones.some((z) => z > 0) && (
          <section className="panel">
            <div className="panel-head">
              <Heart size={18} className="icon-grad" />
              <h2>HR zones</h2>
            </div>
            <HrZones zones={s.hrZones} />
          </section>
        )}

        {(s.bestEfforts?.length ?? 0) > 0 && (
          <section className="panel">
            <div className="panel-head">
              <Flame size={18} className="icon-grad" />
              <h2>Best efforts</h2>
            </div>
            <ul className="record-list">
              {s.bestEfforts.map((e) => (
                <li key={e.distanceM} className="record-row">
                  <span className="record-label">{effortLabel(e.distanceM)}</span>
                  <span className="record-value">{fmtDuration(e.durationSec)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {s.splits.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <Gauge size={18} className="icon-grad" />
              <h2>Splits</h2>
            </div>
            <SplitsTable splits={s.splits} isRun={isRun} />
          </section>
        )}

        <button className="btn" disabled>
          <Share2 size={18} /> Share (coming soon)
        </button>
      </div>
    </div>
  );
}

function OverlayHead({ onClose, title }: { onClose: () => void; title: string }) {
  return (
    <header className="overlay-head">
      <button className="icon-btn" onClick={onClose} aria-label="Close">
        <X size={24} />
      </button>
      <h2 className="overlay-title">{title}</h2>
      <span style={{ width: 24 }} />
    </header>
  );
}

function BigStat({
  icon: IconCmp,
  value,
  label,
}: {
  icon: typeof MapPin;
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

const ZONE_META = [
  { name: 'Z1', desc: 'Recovery' },
  { name: 'Z2', desc: 'Endurance' },
  { name: 'Z3', desc: 'Tempo' },
  { name: 'Z4', desc: 'Threshold' },
  { name: 'Z5', desc: 'Anaerobic' },
];

function effortLabel(m: number): string {
  if (m === 21097) return 'Half marathon';
  return m >= 1000 ? `Fastest ${m / 1000}K` : `Fastest ${m} m`;
}

function HrZones({ zones }: { zones: number[] }) {
  const total = zones.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="zones">
      {zones.map((secs, i) => (
        <div key={i} className="zone-row">
          <span className="zone-name">{ZONE_META[i].name}</span>
          <div className="zone-track">
            <div
              className={`zone-fill zone-fill-${i + 1}`}
              style={{ width: `${(secs / total) * 100}%` }}
            />
          </div>
          <span className="zone-time">{fmtDuration(secs)}</span>
        </div>
      ))}
    </div>
  );
}

/** Downsampled line chart from a value series. */
function Sparkline({ values, color = 'url(#aera-grad)' }: { values: number[]; color?: string }) {
  const W = 400;
  const H = 90;
  if (values.length < 2) return <div className="route-empty" style={{ height: H }} />;

  const maxPts = 120;
  const step = values.length > maxPts ? (values.length - 1) / (maxPts - 1) : 1;
  const sampled =
    values.length > maxPts
      ? Array.from({ length: maxPts }, (_, i) => values[Math.round(i * step)])
      : values;

  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const span = Math.max(max - min, 1e-6);
  const pad = 6;

  const d = sampled
    .map((v, i) => {
      const x = pad + (i / (sampled.length - 1)) * (W - pad * 2);
      const y = pad + (1 - (v - min) / span) * (H - pad * 2);
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  );
}

function SplitsTable({ splits, isRun }: { splits: import('@/model/workout').Split[]; isRun: boolean }) {
  const max = Math.max(...splits.map((s) => s.paceSecPerKm ?? 0), 1);
  return (
    <table className="splits">
      <thead>
        <tr>
          <th>km</th>
          <th>{isRun ? 'Pace' : 'Time'}</th>
          <th></th>
          <th>Elev</th>
          <th>HR</th>
        </tr>
      </thead>
      <tbody>
        {splits.map((s) => (
          <tr key={s.index}>
            <td>{s.index + 1}</td>
            <td>{isRun ? fmtPace(s.paceSecPerKm) : fmtDuration(s.durationSec)}</td>
            <td className="split-bar-cell">
              <div
                className="split-bar"
                style={{ width: `${((s.paceSecPerKm ?? 0) / max) * 100}%` }}
              />
            </td>
            <td>{s.elevChangeM >= 0 ? '+' : ''}{Math.round(s.elevChangeM)} m</td>
            <td>{s.avgHr ? Math.round(s.avgHr) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
