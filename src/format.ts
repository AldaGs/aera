// Small display formatters shared across screens.

import type { Sport } from '@/model/workout';

export function fmtDistance(m: number): string {
  return `${(m / 1000).toFixed(2)} km`;
}

export function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}:${String(min).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  return `${min}:${String(rem).padStart(2, '0')}`;
}

export function fmtPace(secPerKm: number | null): string {
  if (secPerKm == null) return '—';
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')} /km`;
}

export function fmtSpeed(kmh: number | null): string {
  return kmh == null ? '—' : `${kmh.toFixed(1)} km/h`;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function fmtPower(watts: number | null): string {
  return watts == null ? '—' : `${Math.round(watts)} W`;
}

/** Cadence display: spm for run/walk (Strava style), rpm for ride. */
export function fmtCadence(value: number | null, sport: Sport): string {
  if (value == null) return '—';
  return `${Math.round(value)} ${sport === 'ride' ? 'rpm' : 'spm'}`;
}

export function fmtSteps(count: number | null): string {
  if (count == null) return '—';
  return count.toLocaleString();
}
