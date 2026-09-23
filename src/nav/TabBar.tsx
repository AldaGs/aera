import { House, PlayCircle, ChartBar } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

export type Tab = 'home' | 'record' | 'stats';

const TABS: { id: Tab; label: string; icon: Icon }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'record', label: 'Record', icon: PlayCircle },
  { id: 'stats', label: 'Stats', icon: ChartBar },
];

export function TabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <nav className="tabbar">
      {TABS.map(({ id, label, icon: IconCmp }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            className={`tab ${isActive ? 'tab-active' : ''}`}
            onClick={() => onChange(id)}
            aria-current={isActive ? 'page' : undefined}
          >
            <IconCmp size={22} weight={isActive ? 'fill' : 'regular'} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
