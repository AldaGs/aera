import { useState } from 'react';
import { Footprints, Bike, Smartphone, Watch, Play, Plus, PersonStanding } from 'lucide-react';
import type { Sport } from '@/model/workout';
import { saveWorkout } from '@/db/db';
import { makeSampleWorkout } from '@/importers/sampleData';
import { loadConnectivity, saveConnectivity } from '@/store/profile';
import {
  samsungAvailable,
  requestSamsungAccess,
  importFromSamsungHealth,
} from '@/importers/samsungHealth';

/**
 * Record tab. Live phone-GPS recording is still pending; the working data path
 * is watch → Samsung Health → this Sync button, read directly via the custom
 * Samsung Health Data SDK plugin (native only). On web, Sync is unavailable and
 * the sample seeder stands in.
 */
export function Record({ onRecorded }: { onRecorded: () => void }) {
  const [sport, setSport] = useState<Sport>('run');
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const conn = loadConnectivity();
  const canSync = samsungAvailable();

  async function addSample() {
    await saveWorkout(makeSampleWorkout(sport, Math.floor(Math.random() * 14)));
    onRecorded();
  }

  async function syncWatch() {
    if (syncing) return;
    setSyncing(true);
    setMsg(null);
    try {
      const ok = await requestSamsungAccess();
      if (!ok) {
        setMsg('Samsung Health access was not granted, or the SDK is unavailable.');
        return;
      }
      const r = await importFromSamsungHealth();
      saveConnectivity({
        ...conn,
        healthConnectLinked: true,
        watchName: conn.watchName ?? 'Galaxy Watch 4',
        lastSyncAt: new Date().toISOString(),
      });

      if (r.imported > 0 || r.upgraded > 0) {
        const parts: string[] = [];
        if (r.imported > 0)
          parts.push(`Imported ${r.imported} workout${r.imported > 1 ? 's' : ''}`);
        if (r.upgraded > 0)
          parts.push(`upgraded ${r.upgraded} with GPS route`);
        parts.push(`${r.withRoute} with GPS route total`);
        if (r.skippedDup) parts.push(`${r.skippedDup} already synced`);
        setMsg(parts.join(' · '));
        onRecorded();
      } else if (r.total === 0) {
        setMsg(
          '0 exercise sessions found in Samsung Health.\n' +
            'Record a run on the watch and let it sync to the phone, then try again.',
        );
      } else {
        const typeList = Object.entries(r.types)
          .map(([t, n]) => `${t}×${n}`)
          .join(', ');
        setMsg(
          `Found ${r.total} session${r.total > 1 ? 's' : ''} (${typeList}); ${r.withRoute} with GPS route.\n` +
            `${r.skippedDup} already synced · ${r.skippedUnsupported} unsupported type.`,
        );
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="screen record-screen">
      <header className="app-header">
        <h1 className="wordmark">Record</h1>
      </header>

      <div className="sport-toggle">
        <button
          className={`sport-opt ${sport === 'run' ? 'sport-opt-active' : ''}`}
          onClick={() => setSport('run')}
        >
          <Footprints size={22} className={sport === 'run' ? 'icon-grad' : ''} />
          Run
        </button>
        <button
          className={`sport-opt ${sport === 'walk' ? 'sport-opt-active' : ''}`}
          onClick={() => setSport('walk')}
        >
          <PersonStanding size={22} className={sport === 'walk' ? 'icon-grad' : ''} />
          Walk
        </button>
        <button
          className={`sport-opt ${sport === 'ride' ? 'sport-opt-active' : ''}`}
          onClick={() => setSport('ride')}
        >
          <Bike size={22} className={sport === 'ride' ? 'icon-grad' : ''} />
          Ride
        </button>
      </div>

      <div className="record-hero">
        <button className="record-start" disabled title="Live recording — coming with the GPS backend">
          <Play size={40} fill="currentColor" />
        </button>
        <span className="muted small center">
          Live {sport === 'run' ? 'run' : sport === 'walk' ? 'walk' : 'ride'} tracking arrives with the GPS backend
        </span>
      </div>

      <div className="source-list">
        <SourceRow
          icon={Smartphone}
          title="Record on phone"
          subtitle="GPS tracking from this device"
          status="Coming soon"
          enabled={false}
        />
        <button
          className={`source-row source-row-btn ${canSync ? '' : 'source-row-disabled'}`}
          onClick={syncWatch}
          disabled={!canSync || syncing}
        >
          <div className="source-icon">
            <Watch size={24} className="icon-grad" />
          </div>
          <div className="source-text">
            <span className="source-title">Sync from watch</span>
            <span className="muted small">
              {conn.watchName ?? 'Galaxy Watch 4'} · via Samsung Health
            </span>
          </div>
          <span className="source-status">
            {syncing ? 'Syncing…' : canSync ? 'Sync' : 'Native only'}
          </span>
        </button>
      </div>

      {msg && <p className="muted small center sync-msg">{msg}</p>}

      <button className="btn-ghost" onClick={addSample}>
        <Plus size={18} /> Add sample {sport} (dev)
      </button>
    </div>
  );
}

function SourceRow({
  icon: IconCmp,
  title,
  subtitle,
  status,
  enabled,
}: {
  icon: typeof Smartphone;
  title: string;
  subtitle: string;
  status: string;
  enabled: boolean;
}) {
  return (
    <div className={`source-row ${enabled ? '' : 'source-row-disabled'}`}>
      <div className="source-icon">
        <IconCmp size={24} className="icon-grad" />
      </div>
      <div className="source-text">
        <span className="source-title">{title}</span>
        <span className="muted small">{subtitle}</span>
      </div>
      <span className="source-status">{status}</span>
    </div>
  );
}
