import { GeoLocation, OverviewPayload } from '../types/env';

const LAST_LOCATION_KEY = 'ecointel_last_location_v1';
const OVERVIEW_CACHE_PREFIX = 'ecointel_overview_cache_v1_';
const PENDING_SYNC_QUEUE_KEY = 'ecointel_pending_firebase_sync_v1';

export interface PendingSyncItem {
  id: string;
  uid: string;
  location: GeoLocation;
  queuedAt: string;
}

export function saveCachedLocation(loc: GeoLocation): void {
  try {
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(loc));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadCachedLocation(): GeoLocation | null {
  try {
    const raw = localStorage.getItem(LAST_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GeoLocation;
    if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number' && parsed.name) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function overviewCacheKey(loc: GeoLocation): string {
  return `${OVERVIEW_CACHE_PREFIX}${loc.latitude.toFixed(2)}_${loc.longitude.toFixed(2)}`;
}

export function saveCachedOverview(loc: GeoLocation, payload: OverviewPayload): void {
  try {
    localStorage.setItem(
      overviewCacheKey(loc),
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        payload,
      })
    );
  } catch {
    // Ignore quota limits
  }
}

export function loadCachedOverview(loc: GeoLocation): { cachedAt: string; payload: OverviewPayload } | null {
  try {
    const raw = localStorage.getItem(overviewCacheKey(loc));
    if (!raw) return null;
    return JSON.parse(raw) as { cachedAt: string; payload: OverviewPayload };
  } catch {
    return null;
  }
}

export function getPendingLocationSyncQueue(): PendingSyncItem[] {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingSyncItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function enqueuePendingLocationSync(uid: string, location: GeoLocation): PendingSyncItem[] {
  const existing = getPendingLocationSyncQueue().filter((item) => item.uid !== uid || item.location.name !== location.name);
  const next: PendingSyncItem[] = [
    ...existing.slice(-9),
    {
      id: `sync-${Date.now()}`,
      uid,
      location,
      queuedAt: new Date().toISOString(),
    },
  ];
  try {
    localStorage.setItem(PENDING_SYNC_QUEUE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota
  }
  return next;
}

export function removePendingLocationSync(itemId: string): PendingSyncItem[] {
  const next = getPendingLocationSyncQueue().filter((item) => item.id !== itemId);
  try {
    localStorage.setItem(PENDING_SYNC_QUEUE_KEY, JSON.stringify(next));
  } catch {
    // Ignore
  }
  return next;
}
