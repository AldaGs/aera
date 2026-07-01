import { useEffect, useState } from 'react';
import { listWorkouts, saveWorkout, type WorkoutMeta } from '@/db/db';
import { makeSampleWorkout } from '@/importers/sampleData';
import { fmtDate, fmtDistance, fmtDuration, fmtPace, fmtSpeed } from '@/format';

export function Home() {
  const [workouts, setWorkouts] = useState<WorkoutMeta[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setWorkouts(await listWorkouts());
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function addSample() {
    const sport = Math.random() > 0.5 ? 'run' : 'ride';
    await saveWorkout(makeSampleWorkout(sport, Math.floor(Math.random() * 14)));
    await refresh();
  }

  return (
    <div className="feed">
      <header className="app-header">
        <h1>aera</h1>
        <button className="btn" onClick={addSample}>
          + Sample workout
        </button>
      </header>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : workouts.length === 0 ? (
        <p className="muted">
          No workouts yet. Add a sample to see the feed, or wait for the Health
          Connect importer.
        </p>
      ) : (
        <ul className="card-list">
          {workouts.map((w) => (
            <li key={w.id} className="card">
              <div className="card-top">
                <span className={`sport sport-${w.sport}`}>
                  {w.sport === 'run' ? '🏃' : '🚴'} {w.title}
                </span>
                <span className="muted">{fmtDate(w.startedAt)}</span>
              </div>
              <div className="stats">
                <Stat label="Distance" value={fmtDistance(w.summary.distanceM)} />
                <Stat label="Time" value={fmtDuration(w.summary.durationMovingSec)} />
                <Stat
                  label={w.sport === 'run' ? 'Pace' : 'Speed'}
                  value={
                    w.sport === 'run'
                      ? fmtPace(w.summary.avgPaceSecPerKm)
                      : fmtSpeed(w.summary.avgSpeedKmh)
                  }
                />
                <Stat label="Elev" value={`${Math.round(w.summary.elevGainM)} m`} />
                <Stat
                  label="Avg HR"
                  value={w.summary.avgHr ? `${Math.round(w.summary.avgHr)}` : '—'}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
