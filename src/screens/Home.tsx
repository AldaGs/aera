import { useEffect, useState } from 'react';
import { Heart, Share2, Mountain, Timer, Gauge, MapPin } from 'lucide-react';
import { listWorkouts, type WorkoutMeta } from '@/db/db';
import { RouteMap } from '@/ui/RouteMap';
import { ProfileButton } from '@/screens/Profile';
import { sumTotals, filterByRange } from '@/metrics/aggregate';
import { loadProfile } from '@/store/profile';
import {
  fmtDate,
  fmtDistance,
  fmtDuration,
  fmtPace,
  fmtSpeed,
} from '@/format';

export function Home({
  onOpenWorkout,
  onOpenProfile,
  reloadKey,
}: {
  onOpenWorkout: (id: string) => void;
  onOpenProfile: () => void;
  reloadKey: number;
}) {
  const [workouts, setWorkouts] = useState<WorkoutMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const profile = loadProfile();

  useEffect(() => {
    listWorkouts().then((w) => {
      setWorkouts(w);
      setLoading(false);
    });
  }, [reloadKey]);

  const week = sumTotals(filterByRange(workouts, 'week'));

  return (
    <div className="screen">
      <header className="app-header">
        <h1 className="wordmark">aera</h1>
        <ProfileButton name={profile.name} onClick={onOpenProfile} />
      </header>

      <section className="week-strip">
        <span className="week-strip-title">This week</span>
        <div className="week-strip-stats">
          <MiniStat value={fmtDistance(week.distanceM)} label="Distance" />
          <MiniStat value={fmtDuration(week.durationSec)} label="Time" />
          <MiniStat value={`${week.count}`} label="Activities" />
          <MiniStat value={`${Math.round(week.elevGainM)} m`} label="Elev" />
        </div>
      </section>

      {loading ? (
        <p className="muted center">Loading…</p>
      ) : workouts.length === 0 ? (
        <EmptyFeed />
      ) : (
        <ul className="card-list">
          {workouts.map((w) => (
            <FeedCard key={w.id} w={w} onOpen={() => onOpenWorkout(w.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedCard({ w, onOpen }: { w: WorkoutMeta; onOpen: () => void }) {
  const isRun = w.sport === 'run';
  return (
    <li className="card feed-card">
      <button className="feed-card-main" onClick={onOpen}>
        <div className="feed-card-head">
          <div className="avatar-sm">{isRun ? '🏃' : '🚴'}</div>
          <div className="feed-card-meta">
            <span className="feed-card-title">{w.title}</span>
            <span className="muted small">{fmtDate(w.startedAt)}</span>
          </div>
        </div>

        <RouteMap path={w.summary.routePreview} bounds={w.summary.bounds} height={150} />

        <div className="feed-stats">
          <FeedStat icon={MapPin} value={fmtDistance(w.summary.distanceM)} label="Distance" />
          <FeedStat icon={Timer} value={fmtDuration(w.summary.durationMovingSec)} label="Time" />
          <FeedStat
            icon={Gauge}
            value={isRun ? fmtPace(w.summary.avgPaceSecPerKm) : fmtSpeed(w.summary.avgSpeedKmh)}
            label={isRun ? 'Pace' : 'Speed'}
          />
          <FeedStat icon={Mountain} value={`${Math.round(w.summary.elevGainM)} m`} label="Elev" />
        </div>
      </button>

      <div className="feed-actions">
        <button className="action-btn">
          <Heart size={18} /> Kudos
        </button>
        <button className="action-btn">
          <Share2 size={18} /> Share
        </button>
      </div>
    </li>
  );
}

function FeedStat({
  icon: IconCmp,
  value,
  label,
}: {
  icon: typeof MapPin;
  value: string;
  label: string;
}) {
  return (
    <div className="feed-stat">
      <IconCmp size={15} className="icon-grad" />
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="mini-stat">
      <span className="mini-stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function EmptyFeed() {
  return (
    <div className="empty">
      <p className="muted center">
        No activities yet. Go to <strong>Record</strong> to start a training, or add a
        sample from there to preview the feed.
      </p>
    </div>
  );
}
