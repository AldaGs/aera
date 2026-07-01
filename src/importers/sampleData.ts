import type { TrackPoint, Workout } from '@/model/workout';
import { deriveSummary } from '@/metrics/deriveSummary';
import { effectiveMaxHr, loadProfile } from '@/store/profile';

/**
 * Generates a synthetic workout so the UI has data before the Health Connect
 * importer exists. Simulates a loop run with gentle hills and a wandering HR.
 */
export function makeSampleWorkout(
  sport: 'run' | 'ride' = 'run',
  daysAgo = 0,
): Workout {
  const points: TrackPoint[] = [];
  const durationSec = sport === 'run' ? 30 * 60 : 60 * 60;
  const stepMs = 1000;
  const baseLat = 19.4326;
  const baseLng = -99.1332;
  const speedMs = sport === 'run' ? 3.0 : 7.0; // ~5:30/km run, ~25km/h ride

  let heading = 0;
  let lat = baseLat;
  let lng = baseLng;
  for (let s = 0; s <= durationSec; s++) {
    heading += Math.sin(s / 40) * 0.05;
    const dLat = (Math.cos(heading) * speedMs) / 111000;
    const dLng =
      (Math.sin(heading) * speedMs) / (111000 * Math.cos((baseLat * Math.PI) / 180));
    lat += dLat;
    lng += dLng;
    points.push({
      t: s * stepMs,
      lat,
      lng,
      // rolling hills: a long climb + short undulations, plus a little GPS noise
      alt:
        2240 +
        Math.sin(s / 300) * 40 +
        Math.sin(s / 45) * 6 +
        (Math.random() - 0.5) * 2,
      hr: Math.round(150 + Math.sin(s / 90) * 18),
      cad: sport === 'run' ? 168 : 85,
    });
  }

  const maxHr = effectiveMaxHr(loadProfile()) ?? 190;

  const startedAt = new Date(Date.now() - daysAgo * 86400000);
  return {
    id: crypto.randomUUID(),
    sport,
    source: 'manual',
    startedAt: startedAt.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    track: points,
    summary: deriveSummary(points, sport, { maxHr }),
    title: sport === 'run' ? 'Sample Run' : 'Sample Ride',
    notes: '',
    athleteId: 'me',
  };
}
