import { denoiseTrack } from '../src/metrics/denoiseTrack';
import type { TrackPoint } from '../src/model/workout';

function assert(c: boolean, m: string) {
  if (!c) throw new Error('FAIL: ' + m);
  console.log('ok: ' + m);
}
const pt = (t: number, lat: number, lng: number, speed: number | null = null): TrackPoint =>
  ({ t, lat, lng, alt: null, hr: 120, cad: null, speed, power: null });

// Standing still: ±2 m wobble every second → pinned to the first position.
const still = [0, 1, 2, 3, 4].map((i) => pt(i * 1000, 19.0 + (i % 2) * 0.00002, -98.3, 0.2));
const d1 = denoiseTrack(still, 'run');
assert(d1.every((p) => p.lat === still[0].lat && p.lng === still[0].lng), 'standing wobble is pinned');
assert(d1.every((p, i) => p.t === still[i].t && p.hr === 120), 'time + HR kept');

// Running ~3 m/s north: every point moves.
const run = [0, 1, 2, 3].map((i) => pt(i * 2000, 19.0 + i * 0.000054, -98.3, 3));
const d2 = denoiseTrack(run, 'run');
assert(d2.every((p, i) => p.lat === run[i].lat), 'real movement kept');

// Teleport (1 km in 1 s) ignored.
const tp = [pt(0, 19.0, -98.3, 3), pt(1000, 19.009, -98.3, 3)];
assert(denoiseTrack(tp, 'run')[1].lat === 19.0, 'teleport pinned');
console.log('denoise checks passed');
