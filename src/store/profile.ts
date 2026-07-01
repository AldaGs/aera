// Athlete profile + app settings. Small single-object state, persisted to
// localStorage (not workout data — that lives in Dexie).

export type Units = 'metric' | 'imperial';
export type Sex = 'male' | 'female' | 'unspecified';

export interface Profile {
  name: string;
  sex: Sex;
  birthDate: string | null; // ISO date
  weightKg: number | null;
  heightCm: number | null;
  maxHr: number | null; // for HR zones; null = estimate from age
  restingHr: number | null;
  units: Units;
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
  restingHr: null,
  units: 'metric',
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
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
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
