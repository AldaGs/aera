// Athlete profile + app settings. Small single-object state, persisted to
// localStorage (not workout data — that lives in Dexie).

export type Units = 'metric' | 'imperial';
export type HrZoneMethod = 'pct_max_hr' | 'thresholds';
export type Sex = 'male' | 'female' | 'unspecified';

export interface Profile {
  name: string;
  sex: Sex;
  birthDate: string | null; // ISO date
  weightKg: number | null;
  heightCm: number | null;
  maxHr: number | null; // for HR zones; null = estimate from age
  /** True when maxHr was raised automatically from a recorded sustained peak. */
  maxHrAuto: boolean;
  restingHr: number | null;
  /** 'pct_max_hr' = 60/70/80/90 % of max HR; 'thresholds' = built from AT/AnT. */
  hrZoneMethod: HrZoneMethod;
  aerobicThresholdHr: number | null; // AT, bpm (e.g. from a Samsung watch test)
  anaerobicThresholdHr: number | null; // AnT, bpm
  units: Units;
  startCountdownSec: number; // 0 = off
  stepCountdownSec: number; // 0 = off; final seconds of a timed step
}

export interface Connectivity {
  healthConnectLinked: boolean;
  watchName: string | null; // e.g. "Galaxy Watch 4"
  lastSyncAt: string | null;
}

const PROFILE_KEY = 'aera.profile';
const CONNECTIVITY_KEY = 'aera.connectivity';

export const defaultProfile: Profile = {
  name: 'Athlete',
  sex: 'unspecified',
  birthDate: null,
  weightKg: null,
  heightCm: null,
  maxHr: null,
  maxHrAuto: false,
  restingHr: null,
  hrZoneMethod: 'pct_max_hr',
  aerobicThresholdHr: null,
  anaerobicThresholdHr: null,
  units: 'metric',
  startCountdownSec: 0,
  stepCountdownSec: 0,
};

export const defaultConnectivity: Connectivity = {
  healthConnectLinked: false,
  watchName: null,
  lastSyncAt: null,
};

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? { ...defaultProfile, ...JSON.parse(raw) } : defaultProfile;
  } catch {
    return defaultProfile;
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable (tests, private mode) — keep running on defaults
  }
}

export function loadConnectivity(): Connectivity {
  try {
    const raw = localStorage.getItem(CONNECTIVITY_KEY);
    return raw ? { ...defaultConnectivity, ...JSON.parse(raw) } : defaultConnectivity;
  } catch {
    return defaultConnectivity;
  }
}

export function saveConnectivity(c: Connectivity): void {
  localStorage.setItem(CONNECTIVITY_KEY, JSON.stringify(c));
}

/** Max HR: explicit override, else the 208 - 0.7*age estimate, else null. */
export function effectiveMaxHr(p: Profile): number | null {
  if (p.maxHr) return p.maxHr;
  if (!p.birthDate) return null;
  const age = (Date.now() - new Date(p.birthDate).getTime()) / (365.25 * 86400000);
  return Math.round(208 - 0.7 * age);
}

export interface ZoneModel {
  method: HrZoneMethod;
  maxHr: number | null;
  /** Z1 < b[0] ≤ Z2 < b[1] ≤ Z3 < b[2] ≤ Z4 < b[3] ≤ Z5 (bpm). */
  boundaries: [number, number, number, number];
}

/**
 * The athlete's HR zone boundaries. Threshold zones (AT/AnT) win when the
 * profile asks for them and both thresholds are set; otherwise % of max HR.
 * Null when neither is available.
 */
export function zoneModel(p: Profile): ZoneModel | null {
  const maxHr = effectiveMaxHr(p);
  const at = p.aerobicThresholdHr;
  const ant = p.anaerobicThresholdHr;
  if (p.hrZoneMethod === 'thresholds' && at && ant && ant > at) {
    // Z1 recovery below AT-10, Z2 up to AT, Z3 AT..mid, Z4 mid..AnT, Z5 above AnT.
    return {
      method: 'thresholds',
      maxHr,
      boundaries: [at - 10, at, Math.round((at + ant) / 2), ant],
    };
  }
  if (!maxHr) return null;
  return {
    method: 'pct_max_hr',
    maxHr,
    boundaries: [0.6, 0.7, 0.8, 0.9].map((f) => Math.round(f * maxHr)) as ZoneModel['boundaries'],
  };
}

/** Highest HR held for ~sustainSec (a single-sample spike doesn't count). */
export function sustainedPeakHr(samples: { t: number; hr: number | null }[], sustainSec = 10): number | null {
  const pts = samples.filter((s): s is { t: number; hr: number } => s.hr != null && s.hr > 0);
  let best: number | null = null;
  for (let i = 0; i < pts.length; i++) {
    // Min HR over the window starting at i — the level actually held.
    let lo = pts[i].hr;
    let j = i;
    while (j + 1 < pts.length && pts[j + 1].t - pts[i].t <= sustainSec * 1000) {
      j++;
      lo = Math.min(lo, pts[j].hr);
    }
    if (pts[j].t - pts[i].t < sustainSec * 1000 * 0.5) continue; // window too sparse
    if (best == null || lo > best) best = lo;
  }
  return best;
}

/**
 * Raise the stored max HR when a workout held a higher HR than it allows (the
 * age estimate / old value was too low). Returns the new max HR, or null if
 * nothing changed. Never lowers it.
 */
export function maybeRaiseMaxHr(samples: { t: number; hr: number | null }[]): number | null {
  const peak = sustainedPeakHr(samples);
  if (peak == null || peak > 230) return null; // >230 is sensor garbage
  const p = loadProfile();
  const cur = effectiveMaxHr(p);
  if (cur != null && peak <= cur) return null;
  saveProfile({ ...p, maxHr: peak, maxHrAuto: true });
  return peak;
}

/** deriveSummary options from the profile (zones, resting HR, weight). */
export function deriveOptions(
  p: Profile,
  timeline?: { elapsedSec: number; movingSec: number } | null,
) {
  const zones = zoneModel(p);
  return {
    maxHr: effectiveMaxHr(p),
    zoneBounds: zones?.boundaries ?? null,
    restingHr: p.restingHr,
    weightKg: p.weightKg,
    timeline: timeline ?? null,
  };
}
