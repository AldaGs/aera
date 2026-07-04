import {
  Lightbulb,
  TrendingUp,
  TrendingDown,
  Flame,
  Activity,
  Calendar,
  Route,
} from 'lucide-react';
import type { WorkoutMeta } from '@/db/db';
import { computeInsights, type Insight } from '@/metrics/insights';

const ICONS: Record<string, typeof Lightbulb> = {
  'trending-up': TrendingUp,
  'trending-down': TrendingDown,
  flame: Flame,
  activity: Activity,
  calendar: Calendar,
  route: Route,
};

export function InsightsSection({ workouts }: { workouts: WorkoutMeta[] }) {
  const insights = computeInsights(workouts);
  if (insights.length === 0) return null;

  return (
    <section className="panel">
      <div className="panel-head">
        <Lightbulb size={18} className="icon-grad" />
        <h2>Insights</h2>
      </div>
      <div className="insight-list">
        {insights.map((i) => (
          <InsightCard key={i.id} insight={i} />
        ))}
      </div>
    </section>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const IconCmp = ICONS[insight.icon] ?? Lightbulb;
  return (
    <div className={`insight-card insight-${insight.tone}`}>
      <IconCmp size={18} className="insight-icon" />
      <div>
        <div className="insight-title">{insight.title}</div>
        <div className="insight-body muted small">{insight.body}</div>
      </div>
    </div>
  );
}
