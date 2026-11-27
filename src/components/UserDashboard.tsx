import React, { useCallback, useEffect, useRef, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import {
  Bell,
  BookmarkPlus,
  Bot,
  Compass,
  Droplets,
  FileBarChart2,
  GitCompare,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Recycle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  enqueuePendingLocationSync,
  getPendingLocationSyncQueue,
  loadCachedLocation,
  loadCachedOverview,
  removePendingLocationSync,
  saveCachedLocation,
  saveCachedOverview,
} from '../lib/offlineCache';
import { AppView, DashboardTab, GeoLocation, OverviewPayload } from '../types/env';
import { OfflineIndicator, PWAInstallButton } from './PWAStatusUI';
import { useToast } from './ToastProvider';
import { AirQualityModule } from './modules/AirQualityModule';
import { AlertsModule, AlertViewItem } from './modules/AlertsModule';
import { EcoAiChatbotModule } from './modules/EcoAiChatbotModule';
import { EnergyModule } from './modules/EnergyModule';
import { OverviewModule } from './modules/OverviewModule';
import { ProfileSettingsModule } from './modules/ProfileSettingsModule';
import { ReportsComparisonModule } from './modules/ReportsComparisonModule';
import { WasteManagementModule } from './modules/WasteManagementModule';
import { WaterQualityModule } from './modules/WaterQualityModule';

interface UserDashboardProps {
  isAdmin: boolean;
  onNavigate: (view: AppView) => void;
  onSignOut: () => void;
}

const DEFAULT_LOCATION: GeoLocation = {
  id: 'loc-1273294',
  name: 'Delhi, Delhi, India',
  city: 'Delhi',
  state: 'Delhi',
  country: 'India',
  countryCode: 'IN',
  latitude: 28.65195,
  longitude: 77.23149,
  population: 16787941,
};

export const UserDashboard: React.FC<UserDashboardProps> = ({ isAdmin, onNavigate, onSignOut }) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [selectedLocation, setSelectedLocation] = useState<GeoLocation>(() => loadCachedLocation() ?? DEFAULT_LOCATION);
  const userPickedLocationRef = useRef(false);
  const [pastDays, setPastDays] = useState<number>(7);
  const [overview, setOverview] = useState<OverviewPayload | null>(() => {
    const initialLoc = loadCachedLocation() ?? DEFAULT_LOCATION;
    return loadCachedOverview(initialLoc)?.payload ?? null;
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() => getPendingLocationSyncQueue().length);

  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<GeoLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);

  const [savedLocations, setSavedLocations] = useState<GeoLocation[]>([]);
  const [readAlertIds, setReadAlertIds] = useState<Set<string>>(new Set());
  const { showToast } = useToast();

  const user = auth.currentUser;

  const syncLocationToFirebaseAndServer = useCallback(
    async (loc: GeoLocation, makePrimary = true) => {
      saveCachedLocation(loc);
      if (!user) return;

      if (!navigator.onLine) {
        const q = enqueuePendingLocationSync(user.uid, loc);
        setPendingSyncCount(q.length);
      }

      if (user.emailVerified) {
        const primaryDocId = `primary_${user.uid}`;
        const docRef = doc(db, 'savedLocations', primaryDocId);
        const now = new Date().toISOString();
        try {
          if (makePrimary) {
            const existing = await getDoc(docRef).catch(() => null);
            if (existing?.exists()) {
              await updateDoc(docRef, {
                name: loc.name.slice(0, 160),
                city: (loc.city || loc.name).slice(0, 120),
                state: (loc.state || '').slice(0, 120),
                country: (loc.country || 'Unknown').slice(0, 100),
                countryCode: (loc.countryCode || 'US').slice(0, 10),
                latitude: loc.latitude,
                longitude: loc.longitude,
                isPrimary: true,
              });
            } else {
              await setDoc(docRef, {
                userId: user.uid,
                name: loc.name.slice(0, 160),
                city: (loc.city || loc.name).slice(0, 120),
                state: (loc.state || '').slice(0, 120),
                country: (loc.country || 'Unknown').slice(0, 100),
                countryCode: (loc.countryCode || 'US').slice(0, 10),
                latitude: loc.latitude,
                longitude: loc.longitude,
                isPrimary: true,
                createdAt: now,
              });
            }

            // Also update preferredLocation on user profile document
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef).catch(() => null);
            if (userSnap?.exists()) {
              await updateDoc(userRef, {
                preferredLocation: loc.name.slice(0, 160),
                country: (loc.country || 'India').slice(0, 100),
                updatedAt: now,
              });
            }
          }
        } catch {
          // Firestore persistentLocalCache automatically queues writes when offline;
          // if permission/validation rejects, fall back to local queue.
        }
      }

      if (navigator.onLine) {
        try {
          const token = await user.getIdToken();
          const res = await fetch('/api/locations/sync-monitor', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              name: loc.name,
              city: loc.city || loc.name,
              state: loc.state || '',
              country: loc.country || 'Unknown',
              countryCode: loc.countryCode || 'US',
              latitude: loc.latitude,
              longitude: loc.longitude,
            }),
          });
          if (res.ok) {
            setSyncNotice(`Connected "${loc.city || loc.name}" to Firebase Console & continuous background monitoring.`);
          }
        } catch {
          const q = enqueuePendingLocationSync(user.uid, loc);
          setPendingSyncCount(q.length);
        }
      } else {
        setSyncNotice(`Offline mode: saved "${loc.city || loc.name}" to local Firebase cache. Will sync automatically when online.`);
      }
    },
    [user]
  );

  // Replay pending offline sync queue whenever connectivity returns or app reopens online
  const flushPendingSyncQueue = useCallback(async () => {
    if (!navigator.onLine || !user) return;
    const queueItems = getPendingLocationSyncQueue().filter((item) => item.uid === user.uid);
    if (queueItems.length === 0) {
      setPendingSyncCount(0);
      return;
    }

    for (const item of queueItems) {
      let resolvedLoc = item.location;
      if (resolvedLoc.country === 'Unknown' || resolvedLoc.name.startsWith('Coordinates (')) {
        try {
          const rev = await fetch(`/api/locations/reverse?lat=${resolvedLoc.latitude}&lon=${resolvedLoc.longitude}`);
          if (rev.ok) {
            const j = (await rev.json()) as { location?: GeoLocation };
            if (j.location) resolvedLoc = j.location;
          }
        } catch {
          // Keep coordinate fallback
        }
      }
      await syncLocationToFirebaseAndServer(resolvedLoc, true);
      const next = removePendingLocationSync(item.id);
      setPendingSyncCount(next.length);
    }
  }, [syncLocationToFirebaseAndServer, user]);

  useEffect(() => {
    void flushPendingSyncQueue();
    const handleOnline = () => {
      void flushPendingSyncQueue();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [flushPendingSyncQueue]);

  const fetchOverview = useCallback(async (loc: GeoLocation, days: number) => {
    setLoading(true);
    setError(null);
    saveCachedLocation(loc);
    try {
      const qs = new URLSearchParams({
        lat: String(loc.latitude),
        lon: String(loc.longitude),
        countryCode: loc.countryCode,
        name: loc.name,
        pastDays: String(days),
      });
      const res = await fetch(`/api/env/overview?${qs.toString()}`);
      const json = (await res.json()) as OverviewPayload & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to retrieve environmental data');
      setOverview(json);
      saveCachedOverview(loc, json);
    } catch (err) {
      const cached = loadCachedOverview(loc);
      if (cached) {
        setOverview(cached.payload);
        setError(`Showing cached telemetry from ${new Date(cached.cachedAt).toLocaleString()} (offline or unreachable).`);
      } else {
        setError(err instanceof Error ? err.message : 'Unable to fetch environmental overview');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview(selectedLocation, pastDays);
  }, [selectedLocation, pastDays, fetchOverview]);

  // Listen to user's savedLocations & notifications in Firestore (reads from IndexedDB cache when offline!)
  useEffect(() => {
    if (!user) return;
    const locQ = query(collection(db, 'savedLocations'), where('userId', '==', user.uid));
    const unsubLoc = onSnapshot(
      locQ,
      (snap) => {
        const list: GeoLocation[] = snap.docs.map((d) => {
          const data = d.data() as Omit<GeoLocation, 'id'>;
          return { id: d.id, ...data };
        });
        setSavedLocations(list);
        if (!userPickedLocationRef.current && list.length > 0 && !loadCachedLocation()) {
          const primary = list.find((l) => (l as GeoLocation & { isPrimary?: boolean }).isPrimary) ?? list[0];
          setSelectedLocation(primary);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'savedLocations')
    );

    const notifQ = query(collection(db, 'notifications'), where('userId', '==', user.uid));
    const unsubNotif = onSnapshot(
      notifQ,
      (snap) => {
        const readSet = new Set<string>();
        snap.docs.forEach((d) => {
          const data = d.data() as { isRead?: boolean };
          if (data.isRead) readSet.add(d.id);
        });
        setReadAlertIds(readSet);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    );

    return () => {
      unsubLoc();
      unsubNotif();
    };
  }, [user]);

  const handleLocationSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/locations/search?q=${encodeURIComponent(searchInput.trim())}`);
      const json = (await res.json()) as { results?: GeoLocation[]; error?: string };
      if (!res.ok) throw new Error(json.error || 'Location lookup failed');
      const results = json.results ?? [];
      setSearchResults(results);
      if (results.length === 0) {
        showToast({ type: 'info', title: 'No Matching Locations', message: `No cities matched "${searchInput.trim()}". Try a broader region or country.` });
      }
    } catch (err) {
      showToast({ type: 'error', title: 'Location Search Error', message: err instanceof Error ? err.message : 'Unable to search locations right now.' });
    } finally {
      setSearching(false);
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      const msg = 'Geolocation is not supported by your browser.';
      setError(msg);
      showToast({ type: 'error', title: 'Geolocation Unavailable', message: msg });
      return;
    }
    setGeoLoading(true);
    setSyncNotice(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        let resolved: GeoLocation = {
          id: `geo-${lat.toFixed(3)}-${lon.toFixed(3)}`,
          name: `Coordinates (${lat.toFixed(3)}, ${lon.toFixed(3)})`,
          city: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
          country: 'Unknown',
          countryCode: 'US',
          latitude: lat,
          longitude: lon,
        };

        if (navigator.onLine) {
          try {
            const res = await fetch(`/api/locations/reverse?lat=${lat}&lon=${lon}`);
            const json = (await res.json()) as { location?: GeoLocation };
            if (json.location) resolved = json.location;
          } catch {
            // Keep offline GPS coordinate fallback cleanly
          }
        }

        userPickedLocationRef.current = true;
        setSelectedLocation(resolved);
        setSearchResults([]);
        await syncLocationToFirebaseAndServer(resolved, true);
        setGeoLoading(false);
      },
      () => {
        setGeoLoading(false);
        const msg = 'Location permission denied. Use the search bar to select a city or district manually.';
        setError(msg);
        showToast({ type: 'error', title: 'Location Permission Denied', message: msg });
      }
    );
  };

  const handleSaveCurrentLocation = async () => {
    if (!user?.emailVerified) return;
    if (savedLocations.some((l) => l.name === selectedLocation.name)) {
      await syncLocationToFirebaseAndServer(selectedLocation, true);
      showToast({ type: 'success', title: 'Location Synced', message: `Synced "${selectedLocation.city || selectedLocation.name}" to your saved locations.` });
      return;
    }
    try {
      await addDoc(collection(db, 'savedLocations'), {
        userId: user.uid,
        name: selectedLocation.name.slice(0, 160),
        city: (selectedLocation.city || selectedLocation.name).slice(0, 120),
        state: (selectedLocation.state || '').slice(0, 120),
        country: (selectedLocation.country || 'Unknown').slice(0, 100),
        countryCode: (selectedLocation.countryCode || 'US').slice(0, 10),
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
        isPrimary: savedLocations.length === 0,
        createdAt: new Date().toISOString(),
      });
      await syncLocationToFirebaseAndServer(selectedLocation, true);
      showToast({ type: 'success', title: 'Location Saved', message: `Saved "${selectedLocation.city || selectedLocation.name}" to your Firebase profile.` });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'savedLocations');
    }
  };

  const handleRemoveSavedLocation = async (locId: string) => {
    try {
      await deleteDoc(doc(db, 'savedLocations', locId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `savedLocations/${locId}`);
    }
  };

  const combinedAlerts: AlertViewItem[] = (overview?.alerts ?? []).map((a) => ({
    ...a,
    isRead: readAlertIds.has(a.id),
  }));
  const unreadCount = combinedAlerts.filter((a) => !a.isRead).length;

  const handleMarkAlertRead = async (alertId: string) => {
    setReadAlertIds((prev) => new Set(prev).add(alertId));
    if (user?.emailVerified) {
      try {
        await updateDoc(doc(db, 'notifications', alertId), { isRead: true }).catch(() => {});
      } catch {
        // Alert originated from live server feed; local state updated cleanly
      }
    }
  };

  const navItems: Array<{ id: DashboardTab; label: string; Icon: React.FC<{ className?: string }>; badge?: number }> = [
    { id: 'overview', label: 'Overview Dashboard', Icon: LayoutDashboard },
    { id: 'air', label: 'Air Quality', Icon: Wind },
    { id: 'water', label: 'Water Quality', Icon: Droplets },
    { id: 'waste', label: 'Waste Management', Icon: Recycle },
    { id: 'energy', label: 'Energy Monitoring', Icon: Zap },
    { id: 'chatbot', label: 'EcoAI Chatbot', Icon: Bot },
    { id: 'reports', label: 'Environmental Reports', Icon: FileBarChart2 },
    { id: 'compare', label: 'Location Comparison', Icon: GitCompare },
    { id: 'alerts', label: 'Alerts & Notifications', Icon: Bell, badge: unreadCount },
    { id: 'profile', label: 'Profile & Settings', Icon: Settings },
  ];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigate('landing')}
          className="text-lg font-bold text-[#14532D] tracking-tight font-display whitespace-nowrap"
        >
          EcoIntelligence
        </button>
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1" aria-label="Workspace Navigation">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                active ? 'bg-[#14532D] text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <item.Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </span>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`px-1.5 py-0.5 text-[11px] font-mono-tabular rounded ${
                    active ? 'bg-white/20 text-white' : 'bg-red-100 text-red-800'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-200 space-y-2">
        {isAdmin && (
          <button
            type="button"
            onClick={() => onNavigate('admin')}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#0F766E] bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100"
          >
            <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Open Admin Portal</span>
          </button>
        )}
        <div className="px-2 py-1 text-xs text-slate-600 truncate">
          {user?.displayName || user?.email || 'Authenticated User'}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
        >
          <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F6F8F7] flex overflow-x-clip">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] bg-white h-full border-r border-slate-200 z-10">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Location & Telemetry Toolbar */}
        <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-3 sm:px-6 py-3 space-y-2">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-3">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  aria-label="Open navigation menu"
                  onClick={() => setMobileMenuOpen(true)}
                  className="lg:hidden min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg shrink-0"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900 truncate">
                    <MapPin className="w-4 h-4 text-[#14532D] shrink-0" aria-hidden="true" />
                    <span className="truncate">{selectedLocation.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono-tabular">
                    {new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void fetchOverview(selectedLocation, pastDays)}
                aria-label="Refresh telemetry"
                className="md:hidden min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 shrink-0"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Search & Geolocation Controls */}
            <div className="flex flex-wrap items-center gap-2 flex-1 md:justify-end max-w-2xl min-w-0">
              <form onSubmit={handleLocationSearch} className="flex items-center gap-1.5 w-full sm:w-auto sm:flex-1 sm:min-w-[200px] sm:max-w-sm min-w-0">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3 sm:top-2.5" aria-hidden="true" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="City, district, state or country..."
                    aria-label="Search location"
                    className="w-full min-h-[44px] sm:min-h-[36px] pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching}
                  className="min-h-[44px] sm:min-h-[36px] px-3.5 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  {searching ? '...' : 'Search'}
                </button>
              </form>

              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={geoLoading}
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#14532D] bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 whitespace-nowrap shrink-0"
              >
                <Compass className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{geoLoading ? 'Syncing...' : 'Sync Location'}</span>
              </button>

              {user?.emailVerified && (
                <button
                  type="button"
                  onClick={handleSaveCurrentLocation}
                  title="Save location to Firebase profile"
                  className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Save</span>
                </button>
              )}

              <div className="hidden sm:block">
                <PWAInstallButton compact />
              </div>

              <button
                type="button"
                onClick={() => void fetchOverview(selectedLocation, pastDays)}
                aria-label="Refresh telemetry"
                className="hidden md:inline-flex items-center justify-center min-w-[36px] min-h-[36px] p-1.5 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 shrink-0"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {syncNotice && (
            <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2">
              <span>{syncNotice}</span>
              <button type="button" onClick={() => setSyncNotice(null)} className="text-emerald-700 font-semibold">
                Dismiss
              </button>
            </div>
          )}

          {/* Search Dropdown Results */}
          {searchResults.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    userPickedLocationRef.current = true;
                    setSelectedLocation(r);
                    setSearchResults([]);
                    setSearchInput('');
                    void syncLocationToFirebaseAndServer(r, false);
                  }}
                  className="text-left px-3 py-2 text-xs rounded-md hover:bg-emerald-50 border border-transparent hover:border-emerald-200"
                >
                  <div className="font-semibold text-slate-900 truncate">{r.city}</div>
                  <div className="text-[11px] text-slate-500 truncate">{[r.state, r.country].filter(Boolean).join(', ')}</div>
                </button>
              ))}
            </div>
          )}

          {/* Quick Location Switcher Pills (Interactive buttons) */}
          {savedLocations.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-[11px]">
              <span className="text-slate-400 shrink-0">Saved:</span>
              {savedLocations.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => {
                    userPickedLocationRef.current = true;
                    setSelectedLocation(loc);
                  }}
                  className={`px-2.5 py-1 rounded-md border whitespace-nowrap ${
                    selectedLocation.name === loc.name
                      ? 'bg-[#14532D] text-white border-[#14532D]'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {loc.city || loc.name}
                </button>
              ))}
            </div>
          )}
          {/* Tablet Top Navigation Bar (md to lg, when sidebar & bottom nav are hidden) */}
          <nav
            aria-label="Tablet Navigation"
            className="hidden md:flex lg:hidden items-center gap-1 overflow-x-auto pt-1.5 border-t border-slate-100"
          >
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                    active ? 'bg-[#14532D] text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <item.Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{item.label.replace(' Dashboard', '').replace(' Management', '').replace(' Monitoring', '').replace('Environmental ', '').replace('Location ', '').replace(' & Notifications', '').replace(' & Settings', '')}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span
                      className={`px-1 py-0.5 text-[10px] font-mono-tabular rounded ${
                        active ? 'bg-white/20 text-white' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </header>

        {/* Active Module Viewport */}
        <main className="flex-1 p-3 sm:p-6 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:pb-6 max-w-[1440px] w-full mx-auto min-w-0">
          {activeTab === 'overview' && (
            <OverviewModule
              data={overview}
              loading={loading}
              error={error}
              onRetry={() => void fetchOverview(selectedLocation, pastDays)}
              onOpenTab={setActiveTab}
            />
          )}
          {activeTab === 'air' && (
            <AirQualityModule
              data={overview}
              pastDays={pastDays}
              onChangePastDays={(d) => setPastDays(d)}
            />
          )}
          {activeTab === 'water' && (
            <WaterQualityModule
              location={selectedLocation}
              initialWqi={overview?.water.wqi ?? null}
              onDatasetUploaded={() => void fetchOverview(selectedLocation, pastDays)}
            />
          )}
          {activeTab === 'waste' && (
            <WasteManagementModule
              location={selectedLocation}
              initialWmi={overview?.waste.wmi ?? null}
              onDatasetUploaded={() => void fetchOverview(selectedLocation, pastDays)}
            />
          )}
          {activeTab === 'energy' && (
            <EnergyModule
              location={selectedLocation}
              data={overview}
              onDatasetUploaded={() => void fetchOverview(selectedLocation, pastDays)}
            />
          )}
          {activeTab === 'chatbot' && <EcoAiChatbotModule location={selectedLocation} overview={overview} />}
          {activeTab === 'reports' && (
            <ReportsComparisonModule
              mode="reports"
              primaryLocation={selectedLocation}
              overview={overview}
              overviewLoading={loading}
              overviewError={error}
              onRetryOverview={() => void fetchOverview(selectedLocation, pastDays)}
            />
          )}
          {activeTab === 'compare' && (
            <ReportsComparisonModule
              mode="compare"
              primaryLocation={selectedLocation}
              overview={overview}
              overviewLoading={loading}
              overviewError={error}
              onRetryOverview={() => void fetchOverview(selectedLocation, pastDays)}
            />
          )}
          {activeTab === 'alerts' && <AlertsModule alerts={combinedAlerts} onMarkRead={handleMarkAlertRead} />}
          {activeTab === 'profile' && (
            <ProfileSettingsModule
              savedLocations={savedLocations}
              currentLocation={selectedLocation}
              pendingSyncCount={pendingSyncCount}
              onSyncCurrentLocation={() => void handleUseCurrentLocation()}
              onSelectLocation={(loc) => {
                userPickedLocationRef.current = true;
                setSelectedLocation(loc);
                setActiveTab('overview');
              }}
              onRemoveSavedLocation={handleRemoveSavedLocation}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (< md) */}
      <nav
        aria-label="Mobile Quick Navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 grid grid-cols-5 h-[calc(4rem+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)]"
      >
        {(
          [
            { id: 'overview' as const, label: 'Overview', Icon: LayoutDashboard },
            { id: 'air' as const, label: 'Air', Icon: Wind },
            { id: 'water' as const, label: 'Water', Icon: Droplets },
            { id: 'reports' as const, label: 'Report', Icon: FileBarChart2 },
          ] as const
        ).map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-medium ${
                active ? 'text-[#14532D] font-semibold' : 'text-slate-600'
              }`}
            >
              <item.Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-medium text-slate-600"
        >
          <Menu className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      <OfflineIndicator pendingSyncCount={pendingSyncCount} />
    </div>
  );
};
