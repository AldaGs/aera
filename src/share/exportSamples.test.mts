// Standalone verification of the export's sample helpers.
// Run: npx tsx src/share/exportSamples.test.mts
import { carryCadence, distanceSpeeds, downsampleIndexes, staleFixIndexes } from './exportSamples.ts';
import { deriveSummary } from '../metrics/deriveSummary.ts';
import type { TrackPoint } from '../model/workout.ts';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log('  FAIL:', name);
  }
}

// 10 min run at 1 Hz, ~2.7 m/s, with a short HR spike to 183 at t=597 s
// (a finishing surge that a plain "first point per 5 s" pick would skip).
const track: TrackPoint[] = [];
let lat = 19.4326;
for (let s = 0; s <= 600; s++) {
  lat += 0.0000245;
  const hr = s === 597 ? 183 : 140 + Math.round((s / 600) * 40); // tops out at 180 elsewhere
  track.push({ t: s * 1000, lat, lng: -99.1332, alt: 2240, hr, cad: s % 23 === 0 ? 170 : null, speed: 2.5, power: null });
}
const summary = deriveSummary(track, 'run');
const kept = downsampleIndexes(track, 5000);
const exportedMax = Math.max(...kept.map((i) => track[i].hr ?? 0));
check(`max HR in samples (${exportedMax}) equals summary.maxHr (${summary.maxHr})`, exportedMax === summary.maxHr);
check('downsampled to ~1 per 5 s', kept.length >= 120 && kept.length <= 125);
check('indexes are increasing', kept.every((v, i) => i === 0 || v > kept[i - 1]));

// speed_ms integrates back to the summary distance (one pace source).
const speeds = distanceSpeeds(track, kept, 'run');
let integrated = 0;
for (let k = 1; k < kept.length; k++) integrated += (speeds[k] ?? 0) * ((track[kept[k]].t - track[kept[k - 1]].t) / 1000);
check(
  `integrated speed ${integrated.toFixed(0)} m ≈ summary ${summary.distanceM.toFixed(0)} m`,
  Math.abs(integrated - summary.distanceM) / summary.distanceM < 0.005,
);

// Stale fix: same coordinate as the previous fix but speed > 0.
const stale: TrackPoint[] = [
  { t: 0, lat: 1, lng: 1, alt: null, hr: null, cad: null, speed: 0, power: null },
  { t: 1000, lat: 1, lng: 1, alt: null, hr: null, cad: null, speed: 0, power: null }, // standing: fine
  { t: 2000, lat: 1, lng: 1, alt: null, hr: null, cad: null, speed: 2.4, power: null }, // stale
  { t: 3000, lat: 1.00002, lng: 1, alt: null, hr: null, cad: null, speed: 2.4, power: null },
];
const st = staleFixIndexes(stale);
check('flags only the stale fix', st.size === 1 && st.has(2));

// Cadence carry-forward.
const cad = carryCadence(track);
check('cadenceSampleCount counts real readings', cad.sampleCount === track.filter((p) => p.cad != null).length);
check('gaps ≤ 30 s carried and flagged', cad.cad[1] === 170 && cad.carried[1] && !cad.carried[0]);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
