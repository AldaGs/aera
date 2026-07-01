// Standalone verification of the Health Connect → Workout mapper.
// Run: npx tsx src/importers/mapWorkout.test.mts
import { mapHealthWorkout, mapSport, externalKey, type HealthWorkout } from './mapWorkout.ts';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log('  FAIL:', name);
  }
}

// sport mapping
check('running → run', mapSport('RUNNING') === 'run');
check('trail running → run', mapSport('Trail Running') === 'run');
check('biking → ride', mapSport('BIKING') === 'ride');
check('cycling → ride', mapSport('CYCLING') === 'ride');
check('swimming → null', mapSport('SWIMMING') === null);

// Build a GPS run with route + HR
const start = new Date('2026-06-20T07:00:00Z').getTime();
const route = [];
const heartRate = [];
let lat = 19.4326,
  lng = -99.1332;
for (let s = 0; s <= 600; s++) {
  lat += 0.00002;
  lng += 0.00001;
  route.push({
    timestamp: new Date(start + s * 1000).toISOString(),
    lat,
    lng,
    alt: 2240 + Math.sin(s / 100) * 20,
  });
  if (s % 5 === 0)
    heartRate.push({ timestamp: new Date(start + s * 1000).toISOString(), bpm: 150 + (s % 30) });
}
const hw: HealthWorkout = {
  id: 'hc-abc-123',
  startDate: new Date(start).toISOString(),
  endDate: new Date(start + 600000).toISOString(),
  workoutType: 'RUNNING',
  duration: 600,
  distance: 2500,
  calories: 210,
  route,
  heartRate,
};

const w = mapHealthWorkout(hw, { maxHr: 190 })!;
check('maps to a workout', !!w);
check('sport is run', w.sport === 'run');
check('source is health-connect', w.source === 'health-connect');
check('externalId is session id', w.externalId === 'hc-abc-123');
check('track built from route', w.track.length === 601);
check('track sorted by t', w.track[0].t === 0 && w.track[600].t === 600000);
check('HR attached to points', w.track.some((p) => p.hr != null));
// With a real route present, distance is derived from GPS (not the platform's
// stated 2500 m). The synthetic path is ~1.4–1.5 km.
check('distance derived from GPS route', w.summary.distanceM > 1200 && w.summary.distanceM < 1800);
check('calories from platform', w.summary.calories === 210);
check('has HR zones', Array.isArray(w.summary.hrZones));
check('routePreview populated', w.summary.routePreview.length > 1);

// Routeless (treadmill) workout: no route, platform distance authoritative
const indoor: HealthWorkout = {
  id: 'hc-indoor-9',
  startDate: new Date(start).toISOString(),
  endDate: new Date(start + 1800000).toISOString(),
  workoutType: 'RUNNING',
  duration: 1800,
  distance: 5000,
  calories: 400,
};
const wi = mapHealthWorkout(indoor, { maxHr: 190 })!;
check('routeless: empty track', wi.track.length === 0);
check('routeless: distance from platform', wi.summary.distanceM === 5000);

// dedup key fallback when no id
check(
  'externalKey falls back to dates',
  externalKey({ startDate: 'A', endDate: 'B', workoutType: 'RUNNING', duration: 0, calories: 0 }) ===
    'A_B',
);

// unsupported sport → null
check('swimming maps to null', mapHealthWorkout({ ...indoor, workoutType: 'SWIMMING' }) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
