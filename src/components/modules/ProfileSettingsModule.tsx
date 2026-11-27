import React, { useEffect, useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { CheckCircle2, Cloud, Compass, ExternalLink, KeyRound, MailCheck, MapPin, Trash2, User } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/usePWA';
import {
  auth,
  db,
  FIREBASE_CONSOLE_DB_ID,
  FIREBASE_CONSOLE_PROJECT_ID,
  handleFirestoreError,
  OperationType,
} from '../../lib/firebase';
import { DataSourceReport, GeoLocation } from '../../types/env';
import { PWAInstallButton } from '../PWAStatusUI';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../ToastProvider';

interface ProfileSettingsModuleProps {
  savedLocations: GeoLocation[];
  currentLocation: GeoLocation;
  pendingSyncCount: number;
  onSyncCurrentLocation: () => void;
  onSelectLocation: (loc: GeoLocation) => void;
  onRemoveSavedLocation: (locId: string) => void;
}

const ENV_KEY_GUIDE = [
  {
    envVar: 'OPENAQ_API_KEY',
    provider: 'OpenAQ v3 Ground Stations API',
    purpose: 'Enables station-level ground sensor lookup within 25km.',
    fallback: 'Auto-falls back to Open-Meteo Air Quality (CAMS/ECMWF).',
  },
  {
    envVar: 'DATA_GOV_IN_API_KEY',
    provider: 'CPCB / data.gov.in Open Air & Water Portal',
    purpose: 'Enables live Indian government air & water resource records.',
    fallback: 'Auto-falls back to Open-Meteo Air Quality.',
  },
  {
    envVar: 'EMBER_API_KEY',
    provider: 'Ember Energy Data API',
    purpose: 'Enables monthly power generation and clean electricity mix feeds.',
    fallback: 'Auto-falls back to World Bank Open Data electricity indicators.',
  },
  {
    envVar: 'GEMINI_API_KEY',
    provider: 'EcoAI Grounded Summary & Chat',
    purpose: 'Configured strictly in server-side AI Studio Secrets / environment variables.',
    fallback: 'Auto-falls back to deterministic rule-based environmental synthesis.',
  },
];

export const ProfileSettingsModule: React.FC<ProfileSettingsModuleProps> = ({
  savedLocations,
  currentLocation,
  pendingSyncCount,
  onSyncCurrentLocation,
  onSelectLocation,
  onRemoveSavedLocation,
}) => {
  const user = auth.currentUser;
  const isOnline = useOnlineStatus();
  const { showToast } = useToast();
  const [fullName, setFullName] = useState(user?.displayName || '');
  const [country, setCountry] = useState('India');
  const [preferredLocation, setPreferredLocation] = useState(currentLocation.name || 'Delhi');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [verifySent, setVerifySent] = useState(false);
  const [sources, setSources] = useState<DataSourceReport[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({
      lat: String(currentLocation.latitude),
      lon: String(currentLocation.longitude),
      countryCode: currentLocation.countryCode,
      name: currentLocation.name,
    });
    fetch(`/api/env/sources?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : { sources: [] }))
      .then((d: { sources?: DataSourceReport[] }) => setSources(d.sources ?? []))
      .catch(() => {});
  }, [currentLocation]);

  useEffect(() => {
    if (!user || !user.emailVerified) return;
    getDoc(doc(db, 'users', user.uid))
      .then((snap) => {
        if (snap.exists()) {
          const d = snap.data() as { fullName?: string; country?: string; preferredLocation?: string };
          if (d.fullName) setFullName(d.fullName);
          if (d.country) setCountry(d.country);
          if (d.preferredLocation) setPreferredLocation(d.preferredLocation);
        }
      })
      .catch((err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`));
  }, [user]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!user.emailVerified) {
      setStatusMsg('Verify your email address first before saving profile records to Firestore.');
      return;
    }
    const now = new Date().toISOString();
    try {
      const ref = doc(db, 'users', user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await setDoc(
          ref,
          {
            ...snap.data(),
            fullName: fullName.trim(),
            country: country.trim(),
            preferredLocation: preferredLocation.trim(),
            updatedAt: now,
          },
          { merge: false }
        );
      } else {
        await setDoc(ref, {
          uid: user.uid,
          fullName: fullName.trim() || user.email?.split('@')[0] || 'User',
          email: user.email || '',
          country: country.trim(),
          preferredLocation: preferredLocation.trim(),
          role: 'USER',
          status: 'active',
          termsAccepted: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      setStatusMsg('Profile settings saved to Firestore (queued offline automatically if disconnected).');
      showToast({ type: 'success', title: 'Profile Saved', message: 'Your preferences were updated.' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const handleResendVerification = async () => {
    if (!user) return;
    await sendEmailVerification(user);
    setVerifySent(true);
  };

  const handleTestSource = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/env/sources/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: currentLocation.latitude,
          lon: currentLocation.longitude,
          countryCode: currentLocation.countryCode,
          locationName: currentLocation.name,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string; sourceReport?: DataSourceReport };
      if (json.sourceReport) {
        setSources((prev) => prev.map((s) => (s.id === id ? json.sourceReport! : s)));
      }
      showToast({
        type: json.ok ? 'success' : 'error',
        title: json.sourceReport?.name || id,
        message: json.message || 'Verification complete.',
      });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Test Failed',
        message: err instanceof Error ? err.message : 'Unable to reach server proxy',
      });
    } finally {
      setTestingId(null);
    }
  };

  const consoleLocationsUrl = `https://console.firebase.google.com/project/${FIREBASE_CONSOLE_PROJECT_ID}/firestore/databases/${FIREBASE_CONSOLE_DB_ID}/data/~2FsavedLocations`;

  return (
    <div className="space-y-6 max-w-4xl">
      {user && !user.emailVerified && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900">
          <span>Your email address is not verified yet. Verified emails are required for private Firestore persistence.</span>
          <button
            type="button"
            onClick={handleResendVerification}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 bg-amber-800 text-white rounded-lg font-medium"
          >
            <MailCheck className="w-3.5 h-3.5" />
            <span>{verifySent ? 'Verification Sent' : 'Resend Verification Email'}</span>
          </button>
        </div>
      )}

      {/* Firebase Console & Offline Sync Status Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-[#0F766E] shrink-0" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900">Firebase Console, Offline Persistence &amp; Background Sync</h2>
          </div>
          <PWAInstallButton />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <div className="text-slate-500">Firebase Project</div>
            <div className="font-mono-tabular font-semibold text-slate-900 truncate">{FIREBASE_CONSOLE_PROJECT_ID}</div>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <div className="text-slate-500">Connectivity &amp; Cache</div>
            <div className="font-semibold text-slate-900">
              {isOnline ? 'Online · IndexedDB Sync Active' : 'Offline · IndexedDB Cache Active'}
            </div>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <div className="text-slate-500">Active Location</div>
            <div className="font-semibold text-slate-900 truncate">{currentLocation.name}</div>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <div className="text-slate-500">Pending Sync Queue</div>
            <div className="font-mono-tabular font-semibold text-slate-900">{pendingSyncCount} queued update(s)</div>
          </div>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          Firestore offline persistence (<code className="font-mono-tabular bg-slate-100 px-1 rounded">persistentLocalCache</code>) and the PWA Service Worker cache your active location and telemetry in browser IndexedDB across closed tabs and offline sessions.
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onSyncCurrentLocation}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#14532D] text-white rounded-lg hover:bg-[#166534]"
          >
            <Compass className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sync Current GPS Location to Firebase</span>
          </button>
          <a
            href={consoleLocationsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <span>View Synced Locations in Firebase Console</span>
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>

      {/* Settings & Server Environment Keys Guide */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[#14532D] shrink-0" aria-hidden="true" />
            <span>API Integrations &amp; Server Environment Keys</span>
          </h2>
          <p className="text-xs text-slate-600">
            All external keys stay strictly server-side (never exposed to browser code). EcoIntelligence runs 100% functionally with zero keys via live open-data feeds and verified fallbacks. Add optional keys in AI Studio Secrets or <code className="font-mono-tabular bg-slate-100 px-1 rounded">.env</code> to unlock extra station feeds:
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {ENV_KEY_GUIDE.map((item) => {
            const matched = sources.find((s) => s.envVarName === item.envVar);
            return (
              <div key={item.envVar} className="p-3.5 border border-slate-200 rounded-lg space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono-tabular font-semibold text-[#14532D] bg-emerald-50 px-1.5 py-0.5 rounded">
                    {item.envVar}
                  </code>
                  {matched && (
                    <StatusBadge
                      level={
                        matched.status === 'Live'
                          ? 'good'
                          : matched.status === 'Sample data'
                            ? 'sample'
                            : matched.status === 'Error'
                              ? 'severe'
                              : 'moderate'
                      }
                      label={
                        matched.status === 'Fallback' && matched.fallbackProvider
                          ? `Fallback: ${matched.fallbackProvider}`
                          : matched.status
                      }
                    />
                  )}
                </div>
                <div className="font-semibold text-slate-900">{item.provider}</div>
                <p className="text-slate-600">{item.purpose}</p>
                <p className="text-[11px] text-slate-500">{item.fallback}</p>
              </div>
            );
          })}
        </div>

        {sources.length > 0 && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3">Adapter</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Last Updated</th>
                  <th className="py-2.5 px-3 text-right">Verify</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sources.map((src) => (
                  <tr key={src.id}>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{src.name}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge
                          level={
                            src.status === 'Live'
                              ? 'good'
                              : src.status === 'Sample data'
                                ? 'sample'
                                : src.status === 'Error'
                                  ? 'severe'
                                  : 'moderate'
                          }
                          label={
                            src.status === 'Fallback' && src.fallbackProvider
                              ? `Fallback: ${src.fallbackProvider}`
                              : src.status
                          }
                        />
                        {src.isCached && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 text-[11px] font-mono-tabular whitespace-nowrap">
                            cached · {src.cacheAgeMinutes ?? 0}m ago
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono-tabular text-slate-500">
                      {src.lastUpdated ? new Date(src.lastUpdated).toLocaleTimeString() : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        disabled={testingId === src.id}
                        onClick={() => void handleTestSource(src.id)}
                        className="min-h-[36px] px-2.5 py-1 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
                      >
                        {testingId === src.id ? 'Testing...' : 'Test connection'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form onSubmit={handleSaveProfile} className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <User className="w-5 h-5 text-[#14532D]" aria-hidden="true" />
          <h2 className="text-base font-bold text-slate-900">Profile &amp; Environmental Preferences</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="prof-name" className="block text-xs font-medium text-slate-700 mb-1">
              Full Name
            </label>
            <input
              id="prof-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="prof-email" className="block text-xs font-medium text-slate-700 mb-1">
              Email Address
            </label>
            <input
              id="prof-email"
              type="text"
              disabled
              value={user?.email || ''}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-500"
            />
          </div>
          <div>
            <label htmlFor="prof-country" className="block text-xs font-medium text-slate-700 mb-1">
              Country
            </label>
            <input
              id="prof-country"
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="prof-loc" className="block text-xs font-medium text-slate-700 mb-1">
              Preferred City / Location
            </label>
            <input
              id="prof-loc"
              type="text"
              value={preferredLocation}
              onChange={(e) => setPreferredLocation(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        {statusMsg && (
          <div className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        <button
          type="submit"
          className="min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534]"
        >
          Save Profile Changes
        </button>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-[#0F766E]" aria-hidden="true" />
          <span>Saved Monitoring Locations</span>
        </h3>
        {savedLocations.length === 0 ? (
          <p className="text-xs text-slate-500">No custom locations pinned yet. Use the top location bar to sync or save cities.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {savedLocations.map((loc) => (
              <div key={loc.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => onSelectLocation(loc)}
                  className="min-h-[44px] text-left font-medium text-slate-900 hover:text-[#14532D]"
                >
                  {loc.name} <span className="text-slate-400 font-mono-tabular">({loc.latitude.toFixed(2)}, {loc.longitude.toFixed(2)})</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveSavedLocation(loc.id)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-red-700"
                  aria-label={`Delete ${loc.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
