import { Capacitor, registerPlugin } from '@capacitor/core';

/** One raw location fix from whichever source is active. */
export interface LocationSample {
  lat: number;
  lng: number;
  alt: number | null; // meters, null if the fix has no altitude
  ts: number; // epoch ms
  accuracy: number | null; // meters
  speed: number | null; // m/s from the GPS chip, if available
}

export type LocationCallback = (s: LocationSample) => void;

/** Handle to stop an active location stream. */
export interface LocationWatcher {
  stop(): Promise<void>;
}

// --- Native: @capacitor-community/background-geolocation -------------------
// A foreground-service GPS watcher that keeps delivering fixes while the app is
// backgrounded or the screen is locked. We type only what we use.
interface BgPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  time: number | null;
}
interface BgError {
  code: string;
  message: string;
}
interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (position?: BgPosition, error?: BgError) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
}
const BackgroundGeolocation =
  registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

/**
 * Start streaming location fixes. On device this spins up a foreground service
 * (survives lock/background); on the web it falls back to the browser's
 * `watchPosition` so recording can be exercised in the preview.
 */
export async function startLocationUpdates(
  cb: LocationCallback,
  onError?: (message: string) => void,
): Promise<LocationWatcher> {
  if (Capacitor.isNativePlatform()) {
    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'Recording your workout',
        backgroundTitle: 'aera is tracking your activity',
        requestPermissions: true,
        stale: false,
        distanceFilter: 4, // meters between fixes — trims GPS jitter at rest
      },
      (position, error) => {
        if (error) {
          onError?.(error.message);
          return;
        }
        if (!position) return;
        cb({
          lat: position.latitude,
          lng: position.longitude,
          alt: position.altitude,
          ts: position.time ?? Date.now(),
          accuracy: position.accuracy,
          speed: position.speed,
        });
      },
    );
    return { stop: () => BackgroundGeolocation.removeWatcher({ id }) };
  }

  // Web fallback.
  if (!('geolocation' in navigator)) {
    onError?.('Geolocation is not available in this browser.');
    return { stop: async () => {} };
  }
  const id = navigator.geolocation.watchPosition(
    (p) =>
      cb({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        alt: p.coords.altitude,
        ts: p.timestamp,
        accuracy: p.coords.accuracy,
        speed: p.coords.speed,
      }),
    (e) => onError?.(e.message),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
  return { stop: async () => navigator.geolocation.clearWatch(id) };
}
