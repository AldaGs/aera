import { useEffect, useState } from 'react';
import { X, Play, Watch, DeviceMobile } from '@phosphor-icons/react';
import { Capacitor } from '@capacitor/core';
import type { Sport } from '@/model/workout';
import type { HrZone, IntervalPlan } from '@/model/intervalPlan';
import { planSummary, planEstimate, fmtPlanMeta } from '@/model/intervalPlan';
import { WearBridge } from '@/plugins/wearHr';
import { startLocationUpdates, type LocationWatcher } from '@/record/location';
import { syncPlans, getLastSyncAt } from '@/sync/planSync';
import { fmtSec, parseSec } from '@/screens/IntervalBuilder';
import { effectiveMaxHr, loadProfile } from '@/store/profile';

const ZONE_NAMES: Record<HrZone, string> = { 1: 'Easy', 2: 'Endurance', 3: 'Tempo', 4: 'Threshold', 5: 'Max' };
// Same 5-zone % bands as hrZoneIndex (src/metrics/deriveSummary.ts): <60/<70/<80/<90/>=90% of max HR.
const ZONE_BOUNDS: Record<HrZone, [number, number]> = { 1: [0, 0.6], 2: [0.6, 0.7], 3: [0.7, 0.8], 4: [0.8, 0.9], 5: [0.9, 1.1] };
function zoneBpmLabel(z: HrZone, maxHr: number | null): string {
  if (!maxHr) return `Z${z} · ${ZONE_NAMES[z]}`;
  const [lo, hi] = ZONE_BOUNDS[z];
  const loBpm = Math.round(maxHr * lo);
  const hiBpm = z === 5 ? Math.round(maxHr) : Math.round(maxHr * hi);
  return `Z${z} · ${ZONE_NAMES[z]} · ${loBpm}–${hiBpm} bpm`;
}

type GoalType = 'none' | 'time' | 'distance' | 'either';

const SPORT_LABEL: Record<Sport, string> = { run: 'run', walk: 'walk', ride: 'ride' };
const GOAL_LABEL: Record<GoalType, string> = {
  none: 'No goal',
  time: 'Goal · time',
  distance: 'Goal · distance',
  either: 'Goal · first of',
};

const GPS_LOCKED_M = 25; // accuracy at/below this counts as "locked" per spec

function fmtAgo(iso: string | null): string {
  if (!iso) return 'never';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min <= 0) return 'just now';
  return `${min} min ago`;
}

/**
 * 1c · full-screen "New run" sheet opened from Record's start button. Goal
 * picker lives here (moved out of the Record screen body); plans/status are
 * read live while the sheet is open.
 */
export function StartSheet({
  sport,
  goalType,
  goalSec,
  goalKm,
  onGoalTypeChange,
  onGoalSecChange,
  onGoalKmChange,
  hrZone,
  onHrZoneChange,
  plans,
  onClose,
  onStart,
  onStartPlan,
  onStartWatch,
}: {
  sport: Sport;
  goalType: GoalType;
  goalSec: number;
  goalKm: number;
  onGoalTypeChange: (t: GoalType) => void;
  onGoalSecChange: (sec: number) => void;
  onGoalKmChange: (km: number) => void;
  hrZone: HrZone | null;
  onHrZoneChange: (z: HrZone | null) => void;
  plans: IntervalPlan[];
  onClose: () => void;
  onStart: () => void;
  onStartPlan: (plan: IntervalPlan) => void;
  onStartWatch: (plan: IntervalPlan | null) => Promise<boolean>;
}) {
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<IntervalPlan | null>(null);
  const [watchConnected, setWatchConnected] = useState(false);
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(null);
  const [gpsUnavailable, setGpsUnavailable] = useState(false);
  const [syncedAgo, setSyncedAgo] = useState(fmtAgo(getLastSyncAt()));
  const [recordOn, setRecordOn] = useState<'phone' | 'watch'>('phone');
  const [watchBattery, setWatchBattery] = useState<number | null>(null);
  const [watchBatteryAt, setWatchBatteryAt] = useState<number | null>(null);
  const [watchStart, setWatchStart] = useState<'idle' | 'starting' | 'started' | 'error'>('idle');

  // Watch connection + battery: poll every 5s while the sheet is open (native only).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    const poll = () => {
      WearBridge.isWatchConnected()
        .then((r) => {
          if (!active) return;
          setWatchConnected(r.connected);
          if (r.connected) WearBridge.pingWatch().catch(() => {});
          else setRecordOn((cur) => (cur === 'watch' ? 'phone' : cur));
        })
        .catch(() => active && setWatchConnected(false));
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | null = null;
    let active = true;
    WearBridge.addListener('battery', (e) => {
      if (!active) return;
      setWatchBattery(e.battery);
      setWatchBatteryAt(Date.now());
    }).then((h) => {
      if (active) handle = h;
      else h.remove();
    });
    return () => {
      active = false;
      handle?.remove();
    };
  }, []);

  // GPS: one watcher for the lifetime of the sheet; stopped on close so it
  // never overlaps LiveRecorder's own watcher.
  useEffect(() => {
    let watcher: LocationWatcher | null = null;
    let cancelled = false;
    startLocationUpdates(
      (s) => {
        if (!cancelled) setGpsAccuracyM(s.accuracy);
      },
      () => {
        if (!cancelled) setGpsUnavailable(true);
      },
    ).then((w) => {
      if (cancelled) w.stop();
      else watcher = w;
    });
    return () => {
      cancelled = true;
      watcher?.stop();
    };
  }, []);

  // Refresh the "N min ago" label every 30s while open.
  useEffect(() => {
    const id = setInterval(() => setSyncedAgo(fmtAgo(getLastSyncAt())), 30000);
    return () => clearInterval(id);
  }, []);

  async function handleSyncTap() {
    setSyncedAgo('syncing…');
    await syncPlans();
    setSyncedAgo(fmtAgo(getLastSyncAt()));
  }

  function pickGoalTag(t: GoalType) {
    setSelectedPlan(null);
    onGoalTypeChange(t);
  }

  function pickPlan(p: IntervalPlan) {
    setSelectedPlan(p);
    setPlanPickerOpen(false);
  }

  const goalLabel = selectedPlan ? 'Plan' : GOAL_LABEL[goalType];
  const sportLabel = SPORT_LABEL[sport];

  return (
    <div className="overlay start-sheet">
      <header className="overlay-head start-sheet-head">
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        <span className="overlay-title">New {sportLabel}</span>
        <span style={{ width: 20 }} />
      </header>

      <div className="start-goal-block">
        <span className="start-goal-label">{goalLabel}</span>
        {selectedPlan ? (
          <div className="start-goal-plan">
            <span className="start-goal-plan-name">{selectedPlan.name}</span>
            <span className="muted small">{planSummary(selectedPlan)}</span>
            <span className="muted small">{fmtPlanMeta(planEstimate(selectedPlan))}</span>
          </div>
        ) : (
          <div className="start-goal-value-row">
            {(goalType === 'time' || goalType === 'either') && (
              <span className="start-goal-num-wrap">
                <DraftInput
                  value={fmtSec(goalSec)}
                  onCommit={(t) => onGoalSecChange(parseSec(t))}
                  inputMode="numeric"
                  label="Goal time"
                />
              </span>
            )}
            {goalType === 'either' && <span className="start-goal-or">or</span>}
            {(goalType === 'distance' || goalType === 'either') && (
              <span className="start-goal-num-wrap">
                <DraftInput
                  value={goalKm.toFixed(2)}
                  onCommit={(t) => onGoalKmChange(parseFloat(t.replace(',', '.')) || 0)}
                  inputMode="decimal"
                  label="Goal distance"
                />
                <span className="start-goal-unit">km</span>
              </span>
            )}
            {goalType === 'none' && <span className="start-goal-none">—</span>}
          </div>
        )}

        <div className="start-tag-row">
          <button className={`tag ${goalType === 'none' && !selectedPlan ? 'tag-accent' : 'tag-neutral'}`} onClick={() => pickGoalTag('none')}>
            None
          </button>
          <button className={`tag ${goalType === 'time' && !selectedPlan ? 'tag-accent' : 'tag-neutral'}`} onClick={() => pickGoalTag('time')}>
            Time
          </button>
          <button className={`tag ${goalType === 'distance' && !selectedPlan ? 'tag-accent' : 'tag-neutral'}`} onClick={() => pickGoalTag('distance')}>
            Distance
          </button>
          <button className={`tag ${goalType === 'either' && !selectedPlan ? 'tag-accent' : 'tag-neutral'}`} onClick={() => pickGoalTag('either')}>
            Either
          </button>
          <button className={`tag ${selectedPlan ? 'tag-accent' : 'tag-neutral'}`} onClick={() => setPlanPickerOpen(true)}>
            Plan…
          </button>
        </div>
      </div>

      <div className="start-goal-block">
        <span className="start-goal-label">Heart rate zone</span>
        {selectedPlan ? (
          <span className="muted small">
            {selectedPlan.hrZone
              ? zoneBpmLabel(selectedPlan.hrZone, effectiveMaxHr(loadProfile()))
              : 'No zone target set on this plan'}
          </span>
        ) : (
          <div className="start-tag-row">
            <button className={`tag ${hrZone == null ? 'tag-accent' : 'tag-neutral'}`} onClick={() => onHrZoneChange(null)}>
              Off
            </button>
            {([1, 2, 3, 4, 5] as HrZone[]).map((z) => (
              <button
                key={z}
                className={`tag ${hrZone === z ? 'tag-accent' : 'tag-neutral'}`}
                onClick={() => onHrZoneChange(z)}
              >
                {zoneBpmLabel(z, effectiveMaxHr(loadProfile()))}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="start-record-on">
        <span className="muted small">Record on</span>
        <button
          className={`radio-card ${recordOn === 'phone' ? 'radio-card-selected' : ''}`}
          onClick={() => setRecordOn('phone')}
        >
          <div className="radio-card-icon"><DeviceMobile size={20} className={recordOn === 'phone' ? 'icon-grad' : ''} /></div>
          <div className="radio-card-text">
            <span className="radio-card-title">Phone</span>
            <span className="muted small">Phone GPS · live HR from watch · cues on both</span>
          </div>
          <span className={`radio-dot ${recordOn === 'phone' ? 'radio-dot-selected' : ''}`} />
        </button>
        <button
          className={`radio-card ${recordOn === 'watch' ? 'radio-card-selected' : ''} ${watchConnected ? '' : 'radio-card-disabled'}`}
          onClick={() => watchConnected && setRecordOn('watch')}
          disabled={!watchConnected}
        >
          <div className="radio-card-icon"><Watch size={20} className={recordOn === 'watch' ? 'icon-grad' : ''} /></div>
          <div className="radio-card-text">
            <span className="radio-card-title">Watch only</span>
            <span className="muted small">Leave the phone · watch GPS · uploads when back in range</span>
          </div>
          <span className={`radio-dot ${recordOn === 'watch' ? 'radio-dot-selected' : ''}`} />
        </button>
      </div>

      <div className="status-list">
        <div className="status-row">
          <span className={`status-dot ${watchConnected ? 'status-dot-active' : ''}`} />
          <span className="status-label">
            {watchConnected ? 'Galaxy Watch4 connected' : 'Watch not connected'}
          </span>
          {watchConnected && watchBattery != null && watchBatteryAt != null && Date.now() - watchBatteryAt < 60000 && (
            <span className="status-value">{watchBattery}%</span>
          )}
        </div>
        <div className="status-row">
          <span className={`status-dot ${gpsAccuracyM != null && gpsAccuracyM <= GPS_LOCKED_M ? 'status-dot-active' : ''}`} />
          <span className="status-label">
            {gpsUnavailable
              ? 'GPS unavailable'
              : gpsAccuracyM != null && gpsAccuracyM <= GPS_LOCKED_M
                ? 'GPS locked'
                : 'Searching GPS…'}
          </span>
          {gpsAccuracyM != null && gpsAccuracyM <= GPS_LOCKED_M && (
            <span className="status-value">±{Math.round(gpsAccuracyM)} m</span>
          )}
        </div>
        <button className="status-row status-row-btn" onClick={handleSyncTap}>
          <span className="status-dot" />
          <span className="status-label">Plans synced</span>
          <span className="status-value">{syncedAgo}</span>
        </button>
      </div>

      <button
        className="btn start-cta"
        disabled={watchStart === 'starting'}
        onClick={async () => {
          if (recordOn === 'watch') {
            setWatchStart('starting');
            const ok = await onStartWatch(selectedPlan);
            if (ok) {
              setWatchStart('started');
              setTimeout(onClose, 1200);
            } else {
              setWatchStart('error');
            }
            return;
          }
          if (selectedPlan) onStartPlan(selectedPlan);
          else onStart();
        }}
      >
        <Play size={18} weight="fill" />{' '}
        {recordOn === 'watch'
          ? watchStart === 'starting'
            ? 'Starting on watch…'
            : watchStart === 'started'
              ? 'Started on watch — you can leave your phone'
              : `Start ${sportLabel}`
          : `Start ${sportLabel}`}
      </button>
      {recordOn === 'watch' && watchStart === 'error' && (
        <p className="muted small center">Couldn't reach the watch — try again.</p>
      )}

      {planPickerOpen && (
        <div className="overlay-sub-backdrop" onClick={() => setPlanPickerOpen(false)}>
          <div className="overlay-sub" onClick={(e) => e.stopPropagation()}>
            <span className="overlay-sub-title">Choose a plan</span>
            {plans.length === 0 ? (
              <p className="muted small">No saved plans yet.</p>
            ) : (
              <ul className="plan-list">
                {plans.map((p) => (
                  <li key={p.id} className="plan-row">
                    <button className="plan-main" onClick={() => pickPlan(p)}>
                      <div className="plan-info">
                        <span className="plan-name">{p.name}</span>
                        <span className="muted small">{planSummary(p)}</span>
                        <span className="muted small">{fmtPlanMeta(planEstimate(p))}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Free-typing text field: shows the raw text while editing (so partial input like
 * "25:" isn't clobbered) and only reformats on blur/Enter. */
function DraftInput({
  value,
  onCommit,
  inputMode,
  label,
}: {
  value: string;
  onCommit: (text: string) => void;
  inputMode: 'numeric' | 'decimal';
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      className="start-goal-num"
      value={draft ?? value}
      onFocus={(e) => {
        setDraft(value);
        e.target.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(e.target.value); // parent value is always current, even if Start is hit without a blur
      }}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      inputMode={inputMode}
      aria-label={label}
    />
  );
}
