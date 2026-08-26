import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api.web';

// Trip Mode's client-side throttle -- matches the server-side constants
// in backend/src/utils/geoPresence.ts (TRIP_MODE_UPDATE_INTERVAL_MS /
// TRIP_MODE_UPDATE_DISTANCE_M). Don't POST on every raw GPS tick; only
// when 5 minutes have passed or the device has moved 250m, whichever
// comes first.
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const UPDATE_DISTANCE_M = 250;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Trip Mode means "live while Drift is open in this tab" -- web
// geolocation has no background mode. watchPosition pauses the moment
// the tab closes or the phone locks; that's a browser limit, not a bug
// here, and callers should say so in their copy rather than imply more.
export function useTripMode() {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPostRef = useRef<{ lat: number; lng: number; at: number } | null>(null);

  const postLocation = useCallback((lat: number, lng: number) => {
    const now = Date.now();
    const last = lastPostRef.current;
    if (last) {
      const elapsed = now - last.at;
      const moved = haversineMeters(last.lat, last.lng, lat, lng);
      if (elapsed < UPDATE_INTERVAL_MS && moved < UPDATE_DISTANCE_M) return;
    }
    lastPostRef.current = { lat, lng, at: now };
    api.post('/safety/location', { latitude: lat, longitude: lng }).catch(() => {});
  }, []);

  const enable = useCallback(async () => {
    setError(null);
    try {
      await api.post('/safety/location/trip-mode', { enabled: true });
    } catch {
      setError('Could not enable Trip Mode. Please try again.');
      return;
    }
    if (!navigator.geolocation) {
      setError('Location is not supported in this browser.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => postLocation(pos.coords.latitude, pos.coords.longitude),
      (err) => setError(err.message || 'Could not get location'),
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 },
    );
    watchIdRef.current = id;
    setEnabled(true);
  }, [postLocation]);

  const disable = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    lastPostRef.current = null;
    setEnabled(false);
    // Immediate server-side purge -- don't wait on the Redis TTL for opt-out.
    api.post('/safety/location/trip-mode', { enabled: false }).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  return { enabled, error, enable, disable };
}
