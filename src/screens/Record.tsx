import { useState } from 'react';
import { Footprints, Bike, Smartphone, Watch, Play, Plus } from 'lucide-react';
import type { Sport } from '@/model/workout';
import { saveWorkout } from '@/db/db';
import { makeSampleWorkout } from '@/importers/sampleData';
import { loadConnectivity } from '@/store/profile';

/**
 * Record tab. v1 is UI-only: it presents the two capture sources (phone GPS,
 * watch) and the sport toggle. Actual recording / Health Connect import is wired
 * in the backend phase. The "Add sample" affordance seeds data meanwhile.
 */
export function Record({ onRecorded }: { onRecorded: () => void }) {
  const [sport, setSport] = useState<Sport>('run');
  const conn = loadConnectivity();

  async function addSample() {
    await saveWorkout(makeSampleWorkout(sport, Math.floor(Math.random() * 14)));
    onRecorded();
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
        <SourceRow
          icon={Watch}
          title="Record on watch"
          subtitle={
            conn.watchName
              ? `${conn.watchName} · via Health Connect`
              : 'Galaxy Watch 4 · not connected'
          }
          status={conn.watchName ? 'Ready' : 'Connect in Profile'}
          enabled={false}
        />
      </div>

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
