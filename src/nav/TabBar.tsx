import { House, CirclePlay, ChartColumn } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type Tab = 'home' | 'record' | 'stats';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'record', label: 'Record', icon: CirclePlay },
  { id: 'stats', label: 'Stats', icon: ChartColumn },
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
            <IconCmp
              size={24}
              strokeWidth={isActive ? 2.4 : 2}
              className={isActive ? 'icon-grad' : ''}
            />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
