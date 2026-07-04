import type { TrackPoint, Workout, Sport } from '@/model/workout';
import { deriveSummary } from '@/metrics/deriveSummary';
import { effectiveMaxHr, loadProfile } from '@/store/profile';

/**
 * Generates a synthetic workout so the UI has data before the Health Connect
 * importer exists. Simulates a loop run/walk/ride with gentle hills and a wandering HR.
 */
export function makeSampleWorkout(
  sport: Sport = 'run',
  daysAgo = 0,
): Workout {
  const points: TrackPoint[] = [];
  const durationSec = sport === 'ride' ? 60 * 60 : sport === 'walk' ? 40 * 60 : 30 * 60;
  const stepMs = 1000;
  const baseLat = 19.4326;
  const baseLng = -99.1332;
  const speedMs = sport === 'ride' ? 7.0 : sport === 'walk' ? 1.4 : 3.0;

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

    // Sport-specific cadence and power
    const cadence = sport === 'ride' ? 85 : sport === 'walk' ? 110 : 168;
    const power = sport === 'ride' ? Math.round(180 + Math.sin(s / 60) * 40) : null;

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
      hr: Math.round(
        sport === 'walk'
          ? 110 + Math.sin(s / 90) * 12
          : 150 + Math.sin(s / 90) * 18,
      ),
      cad: cadence,
      speed: speedMs + Math.sin(s / 50) * 0.3,
      power,
    });
  }

  const maxHr = effectiveMaxHr(loadProfile()) ?? 190;

  const sportLabel = sport === 'run' ? 'Run' : sport === 'walk' ? 'Walk' : 'Ride';
  const startedAt = new Date(Date.now() - daysAgo * 86400000);
  return {
    id: crypto.randomUUID(),
    sport,
    source: 'manual',
    startedAt: startedAt.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    track: points,
    summary: deriveSummary(points, sport, { maxHr }),
    title: `Sample ${sportLabel}`,
    notes: '',
    athleteId: 'me',
    externalId: null,
  };
}
