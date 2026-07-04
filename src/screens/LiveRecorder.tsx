import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Square, Flag, X, Satellite } from 'lucide-react';
import type { LatLngBounds, Sport } from '@/model/workout';
import { RecordingEngine, type LiveStats } from '@/record/engine';
import { startLocationUpdates, type LocationWatcher } from '@/record/location';
import { RouteMap } from '@/ui/RouteMap';
import { fmtDistance, fmtDuration, fmtPace, fmtSpeed } from '@/format';

/**
 * Full-screen live recording view. Owns a RecordingEngine + a location stream,
 * ticks a 1 s timer, and renders live stats over a growing route map. On stop it
 * saves the workout and hands the id back.
 */
export function LiveRecorder({
  sport,
  resumeEngine,
  onDone,
  onCancel,
}: {
  sport: Sport;
  resumeEngine?: RecordingEngine | null;
  onDone: (workoutId: string | null) => void;
  onCancel: () => void;
}) {
  const engineRef = useRef<RecordingEngine>(
    resumeEngine ?? new RecordingEngine(sport),
  );
  const watcherRef = useRef<LocationWatcher | null>(null);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const engine = engineRef.current;
    const unsub = engine.subscribe(setStats);
    if (engine.status === 'idle') engine.start();

    let active = true;
    startLocationUpdates(
      (s) => engine.addSample(s),
      (msg) => setGeoError(msg),
    ).then((w) => {
      if (active) watcherRef.current = w;
      else w.stop();
    });

    // 1 s ticker so the timer advances between GPS fixes.
    const timer = setInterval(() => engine.tick(), 1000);

    return () => {
      active = false;
      unsub();
      clearInterval(timer);
      watcherRef.current?.stop();
    };
  }, []);

  const usesPace = sport === 'run' || sport === 'walk';
  const points = stats?.points ?? [];
  const path = points.map((p) => [p.lat, p.lng] as [number, number]);
  const bounds = boundsOf(path);

  async function stop() {
    if (saving) return;
    setSaving(true);
    await watcherRef.current?.stop();
    const w = await engineRef.current.finish();
    onDone(w?.id ?? null);
  }

  function cancel() {
    if (!confirm('Discard this recording?')) return;
    watcherRef.current?.stop();
    engineRef.current.discard();
    onCancel();
  }

  const paused = stats?.status === 'paused';

  return (
    <div className="overlay recorder">
      <header className="overlay-head">
        <button className="icon-btn" onClick={cancel} aria-label="Discard">
          <X size={24} />
        </button>
        <h2>{sportName(sport)}</h2>
        <span className={`gps-chip ${geoError ? 'gps-bad' : path.length ? 'gps-ok' : 'gps-wait'}`}>
          <Satellite size={14} /> {geoError ? 'No GPS' : path.length ? 'GPS' : 'Acquiring…'}
        </span>
      </header>

      <div className="recorder-body">
        <div className="recorder-primary">
          <span className="recorder-metric-value">{fmtDistance(stats?.distanceM ?? 0)}</span>
          <span className="stat-label">Distance</span>
        </div>

        <div className="recorder-secondary">
          <Metric label="Time" value={fmtDuration(stats?.elapsedSec ?? 0)} />
          <Metric
            label={usesPace ? 'Avg pace' : 'Avg speed'}
            value={usesPace ? fmtPace(stats?.paceSecPerKm ?? null) : fmtSpeed(stats?.speedKmh ?? null)}
          />
          {usesPace && (
            <Metric label="Now" value={fmtPace(stats?.currentPaceSecPerKm ?? null)} />
          )}
          {(stats?.lapCount ?? 1) > 1 && (
            <Metric label="Laps" value={`${(stats?.lapCount ?? 1) - 1}`} />
          )}
        </div>

        <div className="recorder-map">
          <RouteMap path={path} bounds={bounds} height={240} strokeWidth={4} showEndpoints />
        </div>

        {geoError && <p className="muted small center">{geoError}</p>}
      </div>

      <div className="recorder-controls">
        <button className="rec-btn rec-lap" onClick={() => engineRef.current.lap()} disabled={paused}>
          <Flag size={22} />
          <span>Lap</span>
        </button>
        {paused ? (
          <button className="rec-btn rec-main" onClick={() => engineRef.current.resume()}>
            <Play size={30} fill="currentColor" />
            <span>Resume</span>
          </button>
        ) : (
          <button className="rec-btn rec-main" onClick={() => engineRef.current.pause()}>
            <Pause size={30} fill="currentColor" />
            <span>Pause</span>
          </button>
        )}
        <button className="rec-btn rec-stop" onClick={stop} disabled={saving}>
          <Square size={22} fill="currentColor" />
          <span>{saving ? 'Saving…' : 'Finish'}</span>
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="recorder-metric">
      <span className="recorder-metric-sub">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function boundsOf(path: [number, number][]): LatLngBounds | null {
  if (path.length === 0) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lat, lng] of path) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function sportName(s: Sport): string {
  return s === 'run' ? 'Run' : s === 'walk' ? 'Walk' : 'Ride';
}
