// Pure helpers behind the JSON export's `samples` block — kept free of
// Capacitor imports so they can be tested standalone.
import type { Sport, TrackPoint } from '../model/workout';
import { segmentDistances } from '../metrics/deriveSummary';

const PEAK_MARGIN_BPM = 2;

/**
 * Indexes of the track points kept at roughly one per `everyMs` (the first in
 * each bucket). A bucket's HR peak is kept too when it stands out from the
 * kept points on either side by more than PEAK_MARGIN_BPM — so short surges
 * survive without doubling the rows on a steady climb — and the session's max
 * HR point is always kept, so the export's max equals summary.maxHr.
 */
export function downsampleIndexes(track: TrackPoint[], everyMs: number): number[] {
  const firsts: number[] = [];
  const peaks: number[] = [];
  let i = 0;
  while (i < track.length) {
    const bucketEnd = track[i].t + everyMs;
    let peak = i;
    let j = i + 1;
    for (; j < track.length && track[j].t < bucketEnd; j++) {
      if ((track[j].hr ?? 0) > (track[peak].hr ?? 0)) peak = j;
    }
    firsts.push(i);
    peaks.push(peak);
    i = j;
  }
  let maxIdx = -1;
  track.forEach((p, k) => {
    if ((p.hr ?? 0) > 0 && (maxIdx < 0 || (p.hr ?? 0) > (track[maxIdx].hr ?? 0))) maxIdx = k;
  });
  const hr = (k: number | undefined) => (k == null ? 0 : (track[k].hr ?? 0));
  const keep: number[] = [];
  firsts.forEach((first, n) => {
    keep.push(first);
    const peak = peaks[n];
    if (peak === first) return;
    const neighbours = Math.max(hr(first), hr(firsts[n + 1]));
    if (peak === maxIdx || hr(peak) > neighbours + PEAK_MARGIN_BPM) keep.push(peak);
  });
  return keep;
}

/**
 * Speed (m/s) for each kept sample from the same GPS segment distances that
 * produce the summary distance, laps and pace: the distance covered since the
 * previous kept sample divided by the time between them. Integrating these
 * over time reproduces the summary distance exactly.
 */
export function distanceSpeeds(track: TrackPoint[], kept: number[], sport: Sport): (number | null)[] {
  const { dist } = segmentDistances(track, sport);
  const cum = [0];
  for (let i = 1; i < track.length; i++) cum.push(cum[i - 1] + dist[i]);
  return kept.map((idx, k) => {
    if (k === 0) return null;
    const prev = kept[k - 1];
    const dt = (track[idx].t - track[prev].t) / 1000;
    return dt > 0 ? Math.round(((cum[idx] - cum[prev]) / dt) * 100) / 100 : null;
  });
}

/**
 * Fixes that repeat the previous fix's exact coordinate while claiming to move
 * (speed > 0) — a stale cached position, typically the first fix after GPS was
 * ignored for a warm-up. Returns their track indexes.
 */
export function staleFixIndexes(track: TrackPoint[]): Set<number> {
  const out = new Set<number>();
  let prev: TrackPoint | null = null;
  track.forEach((p, i) => {
    if (p.noFix) return;
    if (prev && p.lat === prev.lat && p.lng === prev.lng && (p.speed ?? 0) > 0) out.add(i);
    prev = p;
  });
  return out;
}

/**
 * Cadence with gaps filled by carrying the last reading forward (for up to
 * `maxCarryMs`). `carried` marks the filled indexes.
 */
export function carryCadence(
  track: TrackPoint[],
  maxCarryMs = 30_000,
): { cad: (number | null)[]; carried: boolean[]; sampleCount: number } {
  let last: { v: number; t: number } | null = null;
  let sampleCount = 0;
  const cad: (number | null)[] = [];
  const carried: boolean[] = [];
  for (const p of track) {
    if (p.cad != null && p.cad > 0) {
      last = { v: p.cad, t: p.t };
      sampleCount++;
      cad.push(p.cad);
      carried.push(false);
    } else if (last && p.t - last.t <= maxCarryMs) {
      cad.push(last.v);
      carried.push(true);
    } else {
      cad.push(null);
      carried.push(false);
    }
  }
  return { cad, carried, sampleCount };
}
