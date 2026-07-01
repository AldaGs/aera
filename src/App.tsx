import { useState } from 'react';
import { GradientDefs } from '@/ui/Icon';
import { TabBar, type Tab } from '@/nav/TabBar';
import { Home } from '@/screens/Home';
import { Record } from '@/screens/Record';
import { Stats } from '@/screens/Stats';
import { Profile } from '@/screens/Profile';
import { WorkoutDetail } from '@/screens/WorkoutDetail';
import { ShareComposer } from '@/screens/ShareComposer';

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [openWorkoutId, setOpenWorkoutId] = useState<string | null>(null);
  const [shareWorkoutId, setShareWorkoutId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // Bumped whenever data changes so lists re-fetch.
  const [reloadKey, setReloadKey] = useState(0);

  function bump() {
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="app">
      <GradientDefs />

      <main className="app-main">
        {tab === 'home' && (
          <Home
            reloadKey={reloadKey}
            onOpenWorkout={setOpenWorkoutId}
            onShareWorkout={setShareWorkoutId}
            onOpenProfile={() => setProfileOpen(true)}
          />
        )}
        {tab === 'record' && (
          <Record
            onRecorded={() => {
              bump();
              setTab('home');
            }}
          />
        )}
        {tab === 'stats' && (
          <Stats reloadKey={reloadKey} onOpenWorkout={setOpenWorkoutId} />
        )}
      </main>

      <TabBar active={tab} onChange={setTab} />

      {openWorkoutId && (
        <WorkoutDetail
          id={openWorkoutId}
          onClose={() => setOpenWorkoutId(null)}
          onShare={setShareWorkoutId}
        />
      )}
      {shareWorkoutId && (
        <ShareComposer id={shareWorkoutId} onClose={() => setShareWorkoutId(null)} />
      )}
      {profileOpen && <Profile onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
