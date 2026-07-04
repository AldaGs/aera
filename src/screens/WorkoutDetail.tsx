import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X, Share2, Mountain, Heart, Timer, Gauge, MapPin, Flame, Trash2, Zap, Activity, Footprints, Repeat, TrendingUp } from 'lucide-react';
import { getWorkout, deleteWorkout } from '@/db/db';
import type { Lap, Sport, Workout } from '@/model/workout';
import { RouteMap } from '@/ui/RouteMap';
import { TrackChart, type ChartPoint } from '@/ui/TrackChart';
import { paceSeries, haversine } from '@/metrics/deriveSummary';
import { fmtDate, fmtDistance, fmtDuration, fmtPace, fmtSpeed, fmtPower, fmtCadence, fmtSteps } from '@/format';

export function WorkoutDetail({
  id,
  onClose,
  onShare,
  onDeleted,
}: {
  id: string;
  onClose: () => void;
  onShare: (id: string) => void;
  onDeleted: () => void;
}) {
  const [w, setW] = useState<Workout | undefined>();
  const [deleting, setDeleting] = useState(false);
  // Shared chart scrubber: the active x (in the chosen domain) and the axis mode.
  const [scrubX, setScrubX] = useState<number | null>(null);
  const [xAxis, setXAxis] = useState<'time' | 'distance'>('time');

  useEffect(() => {
    getWorkout(id).then(setW);
  }, [id]);

  const track = w?.track ?? [];
  // Cumulative distance per track index, for the distance x-axis.
  const cumDist = useMemo(() => {
    const arr = [0];
    for (let i = 1; i < track.length; i++) {
      arr.push(arr[i - 1] + haversine(track[i - 1].lat, track[i - 1].lng, track[i].lat, track[i].lng));
    }
    return arr;
  }, [track]);
  const xs = useMemo(
    () => (xAxis === 'time' ? track.map((p) => p.t) : cumDist),
    [track, cumDist, xAxis],
  );
  const formatX = (x: number) =>
    xAxis === 'time' ? fmtDuration(x / 1000) : `${(x / 1000).toFixed(2)} km`;
  const buildPoints = (values: (number | null)[]): ChartPoint[] =>
    values.map((y, i) => ({ x: xs[i], y }));

  async function handleDelete() {
    if (deleting) return;
    if (!confirm('Delete this activity? This can\u2019t be undone.')) return;
    setDeleting(true);
    await deleteWorkout(id);
    onDeleted();
  }

  if (!w) {
    return (
      <div className="overlay">
        <OverlayHead onClose={onClose} title="Activity" />
        <p className="muted center">Loading…</p>
      </div>
    );
  }

  const isRun = w.sport === 'run';
  const isWalk = w.sport === 'walk';
  const isRide = w.sport === 'ride';
  const showPace = isRun || isWalk;
  const s = w.summary;

  const sportEmoji = isRun ? '🏃' : isWalk ? '🚶' : '🚴';
  const sportLabel = isRun ? 'Run' : isWalk ? 'Walk' : 'Ride';

  return (
    <div className="overlay">
      <OverlayHead onClose={onClose} title={w.title} />
      <div className="overlay-body">
        <p className="muted small">
          {sportEmoji} {sportLabel} · {fmtDate(w.startedAt)}
        </p>

        <div className="detail-map">
          <RouteMap path={s.routePreview} bounds={s.bounds} height={220} strokeWidth={4} />
        </div>

        <div className="stat-grid detail-grid">
          <BigStat icon={MapPin} value={fmtDistance(s.distanceM)} label="Distance" />
          <BigStat icon={Timer} value={fmtDuration(s.durationMovingSec)} label="Moving" />
          <BigStat
            icon={Gauge}
            value={showPace ? fmtPace(s.avgPaceSecPerKm) : fmtSpeed(s.avgSpeedKmh)}
            label={showPace ? 'Avg pace' : 'Avg speed'}
          />
          <BigStat icon={Mountain} value={`${Math.round(s.elevGainM)} m`} label="Elev gain" />
          <BigStat icon={Heart} value={s.avgHr ? `${Math.round(s.avgHr)}` : '—'} label="Avg HR" />
          <BigStat icon={Flame} value={s.maxHr ? `${Math.round(s.maxHr)}` : '—'} label="Max HR" />
          {showPace && s.gradeAdjustedPaceSecPerKm != null && (
            <BigStat
              icon={Gauge}
              value={fmtPace(s.gradeAdjustedPaceSecPerKm)}
              label="Grade-adj pace"
            />
          )}
          {/* Cadence */}
          {s.avgCadence != null && (
            <BigStat
              icon={Activity}
              value={fmtCadence(s.avgCadence, w.sport)}
              label="Avg cadence"
            />
          )}
          {s.maxCadence != null && (
            <BigStat
              icon={Activity}
              value={fmtCadence(s.maxCadence, w.sport)}
              label="Max cadence"
            />
          )}
          {/* Steps (run/walk) */}
          {showPace && s.totalSteps != null && (
            <BigStat
              icon={Footprints}
              value={fmtSteps(s.totalSteps)}
              label="Steps"
            />
          )}
          {/* Power (ride) */}
          {isRide && s.avgPower != null && (
            <BigStat icon={Zap} value={fmtPower(s.avgPower)} label="Avg power" />
          )}
          {isRide && s.maxPower != null && (
            <BigStat icon={Zap} value={fmtPower(s.maxPower)} label="Max power" />
          )}
          {/* VO2 Max */}
          {s.vo2Max != null && (
            <BigStat
              icon={Heart}
              value={`${s.vo2Max.toFixed(1)}`}
              label="VO₂ Max"
            />
          )}
          {s.calories != null && (
            <BigStat icon={Flame} value={`${s.calories}`} label="Calories" />
          )}
          {s.trainingLoad != null && (
            <BigStat icon={TrendingUp} value={`${s.trainingLoad}`} label="Training load" />
          )}
        </div>

        {track.length >= 2 && (
          <>
            <div className="range-toggle chart-axis-toggle">
              {(['time', 'distance'] as const).map((mode) => (
                <button
                  key={mode}
                  className={`range-opt ${xAxis === mode ? 'range-opt-active' : ''}`}
                  onClick={() => setXAxis(mode)}
                >
                  {mode === 'time' ? 'Time' : 'Distance'}
                </button>
              ))}
            </div>

            {showPace && (
              <ChartPanel icon={Gauge} title="Pace">
                <TrackChart
                  points={buildPoints(paceSeries(track))}
                  color="url(#aera-grad)"
                  activeX={scrubX}
                  onScrub={setScrubX}
                  format={(v) => fmtPace(v)}
                  formatX={formatX}
                />
              </ChartPanel>
            )}

            {s.elevGainM > 0 && (
              <ChartPanel icon={Mountain} title="Elevation">
                <TrackChart
                  points={buildPoints(track.map((p) => p.alt))}
                  activeX={scrubX}
                  onScrub={setScrubX}
                  format={(v) => `${Math.round(v)} m`}
                  formatX={formatX}
                />
              </ChartPanel>
            )}

            {s.avgHr != null && (
              <ChartPanel icon={Heart} title="Heart rate">
                <TrackChart
                  points={buildPoints(track.map((p) => p.hr))}
                  color="#ff5a1f"
                  activeX={scrubX}
                  onScrub={setScrubX}
                  format={(v) => `${Math.round(v)} bpm`}
                  formatX={formatX}
                />
              </ChartPanel>
            )}

            {track.some((p) => p.cad != null) && (
              <ChartPanel icon={Activity} title="Cadence">
                <TrackChart
                  points={buildPoints(track.map((p) => p.cad))}
                  color="#35c98d"
                  activeX={scrubX}
                  onScrub={setScrubX}
                  format={(v) => fmtCadence(v, w.sport)}
                  formatX={formatX}
                />
              </ChartPanel>
            )}

            {isRide && track.some((p) => p.speed != null) && (
              <ChartPanel icon={Gauge} title="Speed">
                <TrackChart
                  points={buildPoints(track.map((p) => (p.speed != null ? p.speed * 3.6 : null)))}
                  color="#3ba0ff"
                  activeX={scrubX}
                  onScrub={setScrubX}
                  format={(v) => fmtSpeed(v)}
                  formatX={formatX}
                />
              </ChartPanel>
            )}

            {isRide && track.some((p) => p.power != null) && (
              <ChartPanel icon={Zap} title="Power">
                <TrackChart
                  points={buildPoints(track.map((p) => p.power))}
                  color="#f2c14e"
                  activeX={scrubX}
                  onScrub={setScrubX}
                  format={(v) => fmtPower(v)}
                  formatX={formatX}
                />
              </ChartPanel>
            )}
          </>
        )}

        {/* Show intervals when the laps carry real signal — platform/interval
            laps (real duration) or speed-derived splits (real distance) — but not
            the degenerate all-"rest"/0 fallback. */}
        {s.laps && s.laps.some((l) => l.durationSec > 5 && (l.distanceM > 50 || l.type !== 'rest')) && (
          <section className="panel">
            <div className="panel-head">
              <Repeat size={18} className="icon-grad" />
              <h2>Intervals</h2>
            </div>
            <LapsTable laps={s.laps} />
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

        {/* Splits come from the GPS track; hide them when the track only covers a
            fraction of the real distance (GPS dropout) — otherwise they show a
            single bogus split at an absurd pace. */}
        {s.splits.length > 0 &&
          s.splits.reduce((a, x) => a + x.distanceM, 0) >= s.distanceM * 0.8 && (
            <section className="panel">
              <div className="panel-head">
                <Gauge size={18} className="icon-grad" />
                <h2>Splits</h2>
              </div>
              <SplitsTable splits={s.splits} showPace={showPace} />
            </section>
          )}

        <button className="btn" onClick={() => onShare(id)}>
          <Share2 size={18} /> Share
        </button>
        <button className="btn-ghost btn-danger" onClick={handleDelete} disabled={deleting}>
          <Trash2 size={18} /> {deleting ? 'Deleting…' : 'Delete activity'}
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

/** Panel wrapper for an interactive chart. */
function ChartPanel({
  icon: IconCmp,
  title,
  children,
}: {
  icon: typeof MapPin;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <IconCmp size={18} className="icon-grad" />
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

const LAP_LABEL: Record<Sport | 'rest', string> = {
  run: 'Run',
  walk: 'Walk',
  ride: 'Ride',
  rest: 'Rest',
};

function LapsTable({ laps }: { laps: Lap[] }) {
  return (
    <table className="splits">
      <thead>
        <tr>
          <th>#</th>
          <th>Type</th>
          <th>Dist</th>
          <th>Time</th>
          <th>Pace</th>
          <th>HR</th>
        </tr>
      </thead>
      <tbody>
        {laps.map((l) => (
          <tr key={l.index}>
            <td>{l.index + 1}</td>
            <td>
              <span className={`lap-badge lap-badge-${l.type}`}>{l.label ?? LAP_LABEL[l.type]}</span>
            </td>
            <td>{l.distanceM > 20 ? fmtDistance(l.distanceM) : '—'}</td>
            <td>{fmtDuration(l.durationSec)}</td>
            <td>{l.avgPaceSecPerKm != null ? fmtPace(l.avgPaceSecPerKm) : '—'}</td>
            <td>{l.avgHr ? Math.round(l.avgHr) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SplitsTable({ splits, showPace }: { splits: import('@/model/workout').Split[]; showPace: boolean }) {
  const max = Math.max(...splits.map((s) => s.paceSecPerKm ?? 0), 1);
  return (
    <table className="splits">
      <thead>
        <tr>
          <th>km</th>
          <th>{showPace ? 'Pace' : 'Time'}</th>
          <th></th>
          <th>Elev</th>
          <th>HR</th>
        </tr>
      </thead>
      <tbody>
        {splits.map((s) => (
          <tr key={s.index}>
            <td>{s.index + 1}</td>
            <td>{showPace ? fmtPace(s.paceSecPerKm) : fmtDuration(s.durationSec)}</td>
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
