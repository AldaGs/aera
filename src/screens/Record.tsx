import { useState } from 'react';
import { Footprints, Bike, Smartphone, Watch, Play, Plus } from 'lucide-react';
import type { Sport } from '@/model/workout';
import { saveWorkout } from '@/db/db';
import { makeSampleWorkout } from '@/importers/sampleData';
import { loadConnectivity, saveConnectivity } from '@/store/profile';
import {
  healthAvailable,
  requestHealthAccess,
  importFromHealthConnect,
} from '@/importers/healthConnect';

/**
 * Record tab. Live phone-GPS recording is still pending; the working data path
 * is watch → Samsung Health → Health Connect → this Sync button (native only).
 * On web, Sync is unavailable and the sample seeder stands in.
 */
export function Record({ onRecorded }: { onRecorded: () => void }) {
  const [sport, setSport] = useState<Sport>('run');
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const conn = loadConnectivity();
  const canSync = healthAvailable();

  async function addSample() {
    await saveWorkout(makeSampleWorkout(sport, Math.floor(Math.random() * 14)));
    onRecorded();
  }

  async function syncWatch() {
    if (syncing) return;
    setSyncing(true);
    setMsg(null);
    try {
      const ok = await requestHealthAccess();
      if (!ok) {
        setMsg('Health Connect is not available on this device.');
        return;
      }
      const r = await importFromHealthConnect();
      saveConnectivity({
        ...conn,
        healthConnectLinked: true,
        watchName: conn.watchName ?? 'Galaxy Watch 4',
        lastSyncAt: new Date().toISOString(),
      });
      setMsg(
        r.imported > 0
          ? `Imported ${r.imported} workout${r.imported > 1 ? 's' : ''}` +
              (r.skipped ? ` · ${r.skipped} already synced` : '')
          : `No new workouts (${r.total} found)`,
      );
      if (r.imported > 0) onRecorded();
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
          Live {sport === 'run' ? 'run' : 'ride'} tracking arrives with the GPS backend
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
              {conn.watchName ?? 'Galaxy Watch 4'} · via Health Connect
            </span>
          </div>
          <span className="source-status">
            {syncing ? 'Syncing…' : canSync ? 'Sync' : 'Native only'}
          </span>
        </button>
      </div>

      {msg && <p className="muted small center">{msg}</p>}

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
