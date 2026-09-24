import { PersonSimpleBike, PersonSimpleRun, PersonSimpleWalk, type IconProps } from '@phosphor-icons/react';
import type { Sport } from '@/model/workout';

/** One icon set for sports everywhere (feed, plans, stats, detail, toggles). */
export const SPORT_ICON = { run: PersonSimpleRun, walk: PersonSimpleWalk, ride: PersonSimpleBike } as const;

export function SportIcon({ sport, ...props }: { sport: Sport } & IconProps) {
  const Cmp = SPORT_ICON[sport] ?? PersonSimpleRun;
  return <Cmp {...props} />;
}
