import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Stop, Flag, X, GpsFix, SkipForward, Heart } from '@phosphor-icons/react';
import type { LatLngBounds, Sport } from '@/model/workout';
import type { HrZone, StepKind } from '@/model/intervalPlan';
import { RecordingEngine, type LiveStats, type PlanProgress } from '@/record/engine';
import { hrZoneIndex } from '@/metrics/deriveSummary';
import { startLocationUpdates, type LocationWatcher } from '@/record/location';
import { fireCue } from '@/record/cues';
import { startWatchSensors, type WatchSensors } from '@/record/hr';
import { WearBridge } from '@/plugins/wearHr';
import type { PluginListenerHandle } from '@capacitor/core';
import { RouteMap } from '@/ui/RouteMap';
import { fmtDistance, fmtDuration, fmtPace, fmtSpeed } from '@/format';
import { effectiveMaxHr, loadProfile } from '@/store/profile';

// Same names as the watch (handoff 1h): Easy / Endurance / Tempo / Threshold / Max.
const ZONE_NAMES = ['Z1 · Easy', 'Z2 · Endurance', 'Z3 · Tempo', 'Z4 · Threshold', 'Z5 · Max'];
function hrZone(hr: number | null, maxHr: number | null): { index: number; name: string } | null {
  if (hr == null || !maxHr) return null;
  const index = hrZoneIndex(hr, maxHr);
  return { index, name: ZONE_NAMES[index] };
}

const ZONE_BOUNDS: Record<HrZone, [number, number]> = { 1: [0, 0.6], 2: [0.6, 0.7], 3: [0.7, 0.8], 4: [0.8, 0.9], 5: [0.9, 1.1] };
function targetZoneLabel(z: HrZone, maxHr: number | null): string {
  if (!maxHr) return `Target Z${z}`;
  const [lo, hi] = ZONE_BOUNDS[z];
  const loBpm = Math.round(maxHr * lo);
  const hiBpm = z === 5 ? Math.round(maxHr) : Math.round(maxHr * hi);
  return `Target Z${z} · ${loBpm}–${hiBpm}`;
}

const KIND_LABEL: Record<StepKind, string> = {
  warmup: 'Warm-up',
  walk: 'Walk',
  run: 'Run',
  work: 'Work',
  recovery: 'Recovery',
  cooldown: 'Cool-down',
};

// Finish requires a deliberate double-tap within this window (or the caller
// can hold — the button itself absorbs a long-press via the same state).
const FINISH_CONFIRM_MS = 3000;

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
  const watchSensorsRef = useRef<WatchSensors | null>(null);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [watchConnected, setWatchConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finishArmed, setFinishArmed] = useState(false);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxHr = effectiveMaxHr(loadProfile());
  const countdownCfg = useRef({ start: loadProfile().startCountdownSec, step: loadProfile().stepCountdownSec }).current;
  // Pre-start countdown: GPS/HR warm up meanwhile; the engine ignores fixes until start().
  const [startCd, setStartCd] = useState<number | null>(null);
  useEffect(() => {
    if (startCd == null) return;
    if (startCd <= 0) {
      engineRef.current.start();
      void fireCue(stats?.plan?.kind ?? 'run');
      // eslint-disable-next-line react-hooks/exhaustive-deps
      setStartCd(null);
      return;
    }
    void fireCue('countdown');
    WearBridge.sendLive({ json: JSON.stringify({ countdown: startCd }) }).catch(() => {});
    const t = setTimeout(() => setStartCd((c) => (c == null ? c : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [startCd]);
  const [zoneBanner, setZoneBanner] = useState<'high' | 'low' | null>(null);
  const zoneBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const engine = engineRef.current;
    engine.onCue = (kind) => {
      void fireCue(kind);
      if (kind === 'zone-high' || kind === 'zone-low') {
        setZoneBanner(kind === 'zone-high' ? 'high' : 'low');
        if (zoneBannerTimerRef.current) clearTimeout(zoneBannerTimerRef.current);
        zoneBannerTimerRef.current = setTimeout(() => setZoneBanner(null), 3000);
      }
    };
    const unsub = engine.subscribe(setStats);
    if (engine.status === 'idle') {
      if (countdownCfg.start > 0) setStartCd(countdownCfg.start);
      else engine.start();
    }

    let active = true;
    startLocationUpdates(
      (s) => engine.addSample(s),
      (msg) => setGeoError(msg),
    ).then((w) => {
      if (active) watcherRef.current = w;
      else w.stop();
    });

    // Live HR and cadence from the watch companion (no-op without one) → stamp each point.
    startWatchSensors().then((sensors) => {
      if (!active) {
        sensors.stop();
        return;
      }
      watchSensorsRef.current = sensors;
      if (sensors.connected) {
        engine.hrProvider = () => sensors.latestHr();
        engine.cadProvider = () => sensors.latestCadence();
        setWatchConnected(true);
      }
    });

    // 250 ms ticker so the timer flips seconds on time (and the watch mirror with it).
    const timer = setInterval(() => engine.tick(), 250);

    return () => {
      active = false;
      unsub();
      clearInterval(timer);
      watcherRef.current?.stop();
      watchSensorsRef.current?.stop();
    };
  }, []);

  // Auto-finish when a plan completes in auto-finish mode (engine keeps
  // stats.plan and sets complete; keep-recording mode clears the plan instead).
  const autoStopped = useRef(false);
  useEffect(() => {
    if (stats?.plan?.complete && !autoStopped.current) {
      autoStopped.current = true;
      stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.plan?.complete]);

  // Mirror the whole live screen to the watch (~1 Hz: elapsedSec changes once a second).
  useEffect(() => {
    if (!watchConnected || !stats || stats.status === 'idle') return;
    const p = stats.plan && !stats.plan.complete ? stats.plan : null;
    WearBridge.sendLive({
      json: JSON.stringify({
        paused: stats.status === 'paused' || stats.autoPaused,
        autoPaused: stats.autoPaused,
        elapsedSec: Math.floor(stats.elapsedSec),
        elapsedMs: Math.round(stats.elapsedSec * 1000), // watch extrapolates from this
        distanceM: stats.distanceM,
        paceSecPerKm: Math.round(stats.currentPaceSecPerKm ?? stats.paceSecPerKm ?? 0),
        hr: Math.round(stats.liveHr ?? 0),
        stepLabel: p?.label ?? '',
        stepKind: p?.kind ?? '',
        stepIndex: p?.stepIndex ?? 0,
        stepTotal: p?.total ?? 0,
        rep: p?.rep ?? 1,
        reps: p?.reps ?? 1,
        fraction: p?.fraction ?? 0,
        remainingSec: p?.remainingUnit === 'sec' ? Math.round(p.remaining ?? 0) : 0,
        remainingM: p?.remainingUnit === 'm' ? Math.round(p.remaining ?? 0) : 0,
        targetM: p?.remainingUnit === 'm' ? Math.round(p.stepTarget ?? 0) : 0,
        next: p?.next ?? '',
        targetZone: stats.targetHrZone ?? 0,
        zoneStatus: stats.hrZoneStatus,
        maxHr: maxHr ?? 0,
      }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchConnected, Math.floor(stats?.elapsedSec ?? 0), stats?.status, stats?.autoPaused, stats?.plan?.stepIndex]);

  // Mirror the current interval step to the watch on each transition; the watch
  // counts the remaining time down locally.
  useEffect(() => {
    const p = stats?.plan;
    if (watchConnected && p && !p.complete) {
      WearBridge.sendStep({
        label: p.label,
        kind: p.kind,
        remainingSec: Math.round(p.remaining ?? 0),
        targetZone: targetHrZone ?? 0,
        maxHr: maxHr ?? 0,
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.plan?.stepIndex, stats?.plan?.complete, watchConnected]);

  const usesPace = sport === 'run' || sport === 'walk';
  const plan = stats?.plan;
  const points = stats?.points ?? [];
  // ponytail: time-based remaining only; distance steps would need a pace estimate.
  const stepCd =
    countdownCfg.step > 0 && plan && !plan.complete && plan.next && stats?.status === 'recording' &&
    !stats.autoPaused && plan.remainingUnit === 'sec' && plan.remaining != null &&
    plan.remaining > 0 && plan.remaining <= countdownCfg.step
      ? Math.ceil(plan.remaining)
      : null;
  useEffect(() => {
    if (stepCd != null) void fireCue('countdown');
  }, [stepCd]);
  const liveHr = stats?.liveHr ?? null;
  const targetHrZone = stats?.targetHrZone ?? null;
  const hrZoneStatus = stats?.hrZoneStatus ?? 'none';
  const path = points.map((p) => [p.lat, p.lng] as [number, number]);
  const bounds = boundsOf(path);

  async function stop() {
    if (saving) return;
    setSaving(true);
    await watcherRef.current?.stop();
    const w = await engineRef.current.finish();
    onDone(w?.id ?? null);
  }

  // Watch Stop (/aera/cmd "stop") finishes + saves the phone run, same as Finish.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    let handle: PluginListenerHandle | null = null;
    let active = true;
    WearBridge.addListener('cmd', (e) => {
      const eng = engineRef.current;
      if (e.cmd === 'stop') stopRef.current();
      else if (e.cmd === 'pause') eng.pause();
      else if (e.cmd === 'resume') eng.resume();
      else if (e.cmd === 'lap') eng.lap();
    })
      .then((h) => {
        if (active) handle = h;
        else h.remove();
      })
      .catch(() => {}); // web: no native bridge
    return () => {
      active = false;
      handle?.remove();
    };
  }, []);

  function cancel() {
    if (!confirm('Discard this recording?')) return;
    watcherRef.current?.stop();
    engineRef.current.discard();
    onCancel();
  }

  function tapFinish() {
    if (saving) return;
    if (finishArmed) {
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
      stop();
      return;
    }
    setFinishArmed(true);
    finishTimerRef.current = setTimeout(() => setFinishArmed(false), FINISH_CONFIRM_MS);
  }

  useEffect(() => () => {
    if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    if (zoneBannerTimerRef.current) clearTimeout(zoneBannerTimerRef.current);
  }, []);

  const paused = stats?.status === 'paused';
  const dimmed = paused && !!plan;
  const zone = hrZone(liveHr, maxHr);

  return (
    <div className="overlay recorder">
      <header className="overlay-head recorder-topbar">
        <button className="icon-btn" onClick={cancel} aria-label="Discard">
          <X size={22} />
        </button>
        <span className="overlay-title">{sportName(sport)}</span>
        <div className="recorder-chips">
          {watchConnected && (
            <span className="rec-chip">
              <Heart size={12} weight="fill" /> Watch
            </span>
          )}
          <span className={`rec-chip ${geoError ? 'rec-chip-bad' : ''}`}>
            <GpsFix size={12} /> {geoError
              ? 'No GPS'
              : plan && !plan.complete && plan.kind === 'warmup' && (plan.targetType === 'time' || plan.targetType === 'manual')
                ? 'GPS off · warm-up'
                : path.length
                  ? 'GPS'
                  : 'Acquiring…'}
          </span>
        </div>
      </header>

      <div className="recorder-body">
        {plan && !plan.complete ? (
          <IntervalHero plan={plan} paused={paused} autoPaused={!!stats?.autoPaused} />
        ) : (
          <div className="recorder-hero">
            <span className="recorder-hero-value">{fmtDuration(stats?.elapsedSec ?? 0)}</span>
            {paused ? (
              <span className="rec-pause-label">
                {stats?.autoPaused ? 'Auto-paused · standing still' : 'Paused'}
              </span>
            ) : (
              <span className="stat-label">Elapsed</span>
            )}
          </div>
        )}

        <div className={`recorder-grid ${dimmed ? 'recorder-dim' : ''}`}>
          <Metric label="Distance" value={fmtDistance(stats?.distanceM ?? 0)} />
          <Metric label="Time" value={fmtDuration(stats?.elapsedSec ?? 0)} />
          <Metric
            label={usesPace ? 'Avg pace' : 'Avg speed'}
            value={usesPace ? fmtPace(stats?.paceSecPerKm ?? null) : fmtSpeed(stats?.speedKmh ?? null)}
          />
          <div className={`recorder-metric hr-status-${hrZoneStatus}`}>
            <span className="recorder-metric-sub">
              {zone && <span className={`zone-dot zone-fill-${zone.index + 1}`} />}
              {liveHr != null ? `${Math.round(liveHr)} bpm` : '—'}
            </span>
            <span className="stat-label">{zone ? zone.name : 'Heart rate'}</span>
            {targetHrZone && <span className="muted small hr-target-line">{targetZoneLabel(targetHrZone, maxHr)}</span>}
          </div>
        </div>

        {zoneBanner && (
          <p className={`zone-banner zone-banner-${zoneBanner}`}>{zoneBanner === 'high' ? 'Slow down' : 'Speed up'}</p>
        )}

        <div className="recorder-map">
          <RouteMap path={path} bounds={bounds} height={120} strokeWidth={3} showEndpoints />
        </div>

        {geoError && <p className="muted small center">{geoError}</p>}
      </div>

      <div className="recorder-controls">
        <button className="rec-btn-round" onClick={() => engineRef.current.lap()} disabled={paused} aria-label={plan ? "Next step" : "Lap"}>
          {plan ? <SkipForward size={20} /> : <Flag size={20} />}
        </button>
        {paused ? (
          <button className="rec-btn-main" onClick={() => engineRef.current.resume()} aria-label="Resume">
            <Play size={26} weight="fill" />
          </button>
        ) : (
          <button className="rec-btn-main" onClick={() => engineRef.current.pause()} aria-label="Pause">
            <Pause size={26} weight="fill" />
          </button>
        )}
        <button
          className={`rec-btn-round rec-btn-finish ${finishArmed ? 'rec-btn-finish-armed' : ''}`}
          onClick={tapFinish}
          disabled={saving}
          aria-label="Finish"
        >
          <Stop size={20} weight="fill" />
        </button>
      </div>
      {finishArmed && !saving && <p className="muted small center rec-finish-hint">Tap again to finish</p>}
      {startCd != null && startCd > 0 && (
        <button className="countdown-overlay" onClick={() => setStartCd(0)} aria-label="Start now">
          <span className="countdown-num">{startCd}</span>
          <span className="muted small">Tap to start now</span>
        </button>
      )}
      {stepCd != null && (
        <div className="countdown-toast">
          {plan?.next} in <b>{stepCd}</b>
        </div>
      )}
    </div>
  );
}

function IntervalHero({
  plan,
  paused,
  autoPaused,
}: {
  plan: PlanProgress;
  paused: boolean;
  autoPaused: boolean;
}) {
  const big =
    plan.targetType === 'manual'
      ? 'Tap Next'
      : plan.remainingUnit === 'm'
        ? `${Math.round(plan.remaining ?? 0)} m`
        : fmtDuration(plan.remaining ?? 0);
  const total = plan.stepTarget;
  const ofLabel =
    total != null
      ? plan.remainingUnit === 'm'
        ? `left of ${Math.round(total)} m`
        : `of ${fmtDuration(total)}`
      : null;

  const r = 78;
  const c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, plan.fraction)) * c;

  return (
    <div className={`recorder-hero ${paused ? 'recorder-dim' : ''}`}>
      <svg className="interval-ring" viewBox="0 0 176 176">
        <circle className="interval-ring-track" cx="88" cy="88" r={r} />
        <circle
          className="interval-ring-fill"
          cx="88"
          cy="88"
          r={r}
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 88 88)"
        />
        <text x="88" y="70" textAnchor="middle" className="interval-ring-kind">
          {KIND_LABEL[plan.kind].toUpperCase()} {plan.rep > 0 ? `${plan.rep} / ${plan.reps}` : ''}
        </text>
        <text x="88" y="102" textAnchor="middle" className="interval-ring-remaining">
          {big}
        </text>
        {ofLabel && (
          <text x="88" y="122" textAnchor="middle" className="interval-ring-of">
            {ofLabel}
          </text>
        )}
      </svg>
      {paused ? (
        <span className="rec-pause-label">{autoPaused ? 'Auto-paused · standing still' : 'Paused'}</span>
      ) : (
        plan.next && <span className="interval-next">Next · {plan.next}</span>
      )}
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
