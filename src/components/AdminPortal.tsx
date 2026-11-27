import React, { useCallback, useEffect, useState } from 'react';
import { multiFactor, TotpMultiFactorGenerator } from 'firebase/auth';
import { addDoc, collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Globe2,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  MapPin,
  Menu,
  Play,
  RefreshCw,
  Scale,
  Server,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { AdminTab, AppView } from '../types/env';
import { StatusBadge } from './StatusBadge';
import { useToast } from './ToastProvider';

interface AdminPortalProps {
  onNavigate: (view: AppView) => void;
  onSignOut: () => void;
}

interface AdminOverviewData {
  monitoredLocations: Array<{ id: string; name: string; countryCode: string; latitude: number; longitude: number }>;
  providers: Array<{
    id: string;
    name: string;
    category: string;
    endpoint: string;
    authType: string;
    envVarName?: string;
    hasKeyConfigured: boolean;
    refreshIntervalMinutes: number;
    enabled: boolean;
    status: string;
    healthStatus?: string;
    fallbackProvider?: string;
    fallbackDescription?: string;
    isSampleData?: boolean;
    lastSyncAt: string | null;
    lastError: string | null;
  }>;
  syncLogs: Array<{ id: string; providerName: string; locationName: string; status: string; recordsIngested: number; message: string; syncedAt: string }>;
  importHistory: Array<{ id: string; fileName: string; category: string; locationName: string; totalRows: number; acceptedRows: number; rejectedRows: number; uploadedBy: string; uploadedAt: string }>;
  aiLogs: Array<{ id: string; userEmail: string; locationName: string; promptPreview: string; status: string; latencyMs: number; error?: string; timestamp: string }>;
  alerts: Array<{ id: string; locationName: string; title: string; severity: string; timestamp: string }>;
  systemConfig: {
    forecastingEnabled: boolean;
    anomalyZThreshold: number;
    defaultPollIntervalMin: number;
    wmiWeights: Record<string, number>;
    wmiMethodologyVersion: string;
    lastJobRunAt: string | null;
    lastJobStatus: string;
    totalIngestedRecords: number;
    processingErrors: number;
  };
  cachedSnapshotsCount: number;
}

interface FirestoreUserRecord {
  id: string;
  fullName: string;
  email: string;
  country?: string;
  role: string;
  status: string;
  createdAt: string;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({ onNavigate, onSignOut }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const { showToast } = useToast();

  // Firestore Users & Audit Logs
  const [usersList, setUsersList] = useState<FirestoreUserRecord[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; actorEmail?: string; action: string; targetType: string; details?: string; createdAt: string }>>([]);

  // API Provider Secret / New Provider Forms
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [newProv, setNewProv] = useState({ name: '', category: 'air', endpoint: '', authType: 'api_key_header', refreshIntervalMinutes: 60, apiKey: '' });

  // New Location Form
  const [newLoc, setNewLoc] = useState({ name: '', city: '', state: '', country: '', countryCode: '', latitude: '', longitude: '' });

  // WMI Weights Editor
  const [wmiWeightsDraft, setWmiWeightsDraft] = useState<Record<string, number>>({});
  const [wmiChangeReason, setWmiChangeReason] = useState('');

  // MFA Enrollment State
  const [totpSecretUrl, setTotpSecretUrl] = useState<string | null>(null);
  const [totpSecretKey, setTotpSecretKey] = useState<string | null>(null);
  const [totpSecretObj, setTotpSecretObj] = useState<Awaited<ReturnType<typeof TotpMultiFactorGenerator.generateSecret>> | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);

  const fetchAdminOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Admin session token unavailable.');
      const res = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as AdminOverviewData & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to load admin overview');
      setData(json);
      setWmiWeightsDraft(json.systemConfig.wmiWeights);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admin portal error');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFirestoreAdminCollections = useCallback(async () => {
    try {
      const [uSnap, aSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'auditLogs')),
      ]);
      setUsersList(uSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FirestoreUserRecord, 'id'>) })));
      setAuditLogs(
        aSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as { actorEmail?: string; action: string; targetType: string; details?: string; createdAt: string }) }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );
    } catch {
      // Non-bootstrapped admins may only inspect server-side telemetry if Firestore list rule restricts
    }
  }, []);

  useEffect(() => {
    void fetchAdminOverview();
    void loadFirestoreAdminCollections();
  }, [fetchAdminOverview, loadFirestoreAdminCollections]);

  // 30-Minute Admin Inactivity Session Expiration
  useEffect(() => {
    let timer = setTimeout(() => {
      onSignOut();
    }, 30 * 60 * 1000);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onSignOut(), 30 * 60 * 1000);
    };
    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [onSignOut]);

  const recordAudit = async (action: string, targetType: string, targetId: string, details: string) => {
    if (!auth.currentUser) return;
    try {
      await addDoc(collection(db, 'auditLogs'), {
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || '',
        action,
        targetType,
        targetId,
        details: details.slice(0, 500),
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Ignore if unverified
    }
  };

  const handleTestProvider = async (id: string) => {
    setActionMsg(null);
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch(`/api/admin/providers/${id}/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as { ok: boolean; message: string; status?: string };
    const summary = `${id}: ${json.message}`;
    setActionMsg(summary);
    showToast({ type: json.ok ? 'success' : 'info', title: 'Connection Check', message: summary });
    await recordAudit('TEST_API_PROVIDER', 'apiProvider', id, json.message);
    void fetchAdminOverview();
  };

  const handleSaveProviderSecret = async (id: string, enabled?: boolean) => {
    const token = await auth.currentUser?.getIdToken();
    const body: Record<string, unknown> = {};
    if (keyInputs[id] !== undefined) body.apiKey = keyInputs[id];
    if (enabled !== undefined) body.enabled = enabled;
    await fetch(`/api/admin/providers/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    setKeyInputs((prev) => ({ ...prev, [id]: '' }));
    const msg = `Updated provider configuration for ${id}.`;
    setActionMsg(msg);
    showToast({ type: 'success', title: 'Provider Updated', message: msg });
    await recordAudit('UPDATE_API_PROVIDER', 'apiProvider', id, 'Updated provider credentials or status');
    void fetchAdminOverview();
  };

  const handleAddCustomProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch('/api/admin/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(newProv),
    });
    if (res.ok) {
      setNewProv({ name: '', category: 'air', endpoint: '', authType: 'api_key_header', refreshIntervalMinutes: 60, apiKey: '' });
      setActionMsg('Registered new environmental API provider.');
      await recordAudit('REGISTER_API_PROVIDER', 'apiProvider', newProv.name, newProv.endpoint);
      void fetchAdminOverview();
    }
  };

  const handleToggleUserStatus = async (u: FirestoreUserRecord) => {
    const nextStatus = u.status === 'active' ? 'suspended' : 'active';
    try {
      await updateDoc(doc(db, 'users', u.id), {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      await recordAudit('UPDATE_USER_STATUS', 'user', u.id, `Changed status to ${nextStatus}`);
      void loadFirestoreAdminCollections();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${u.id}`);
    }
  };

  const handleUpdateWmiMethodology = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wmiChangeReason.trim() || wmiChangeReason.trim().length < 5) {
      setActionMsg('Please enter a brief justification (5+ chars) for modifying WMI weights.');
      return;
    }
    const token = await auth.currentUser?.getIdToken();
    const nextVersion = `EcoWMI-v1.${Math.floor(Date.now() / 10000) % 1000}`;
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ wmiWeights: wmiWeightsDraft, wmiMethodologyVersion: nextVersion }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setActionMsg(json.error || 'Weight update failed');
      return;
    }
    if (auth.currentUser) {
      await addDoc(collection(db, 'methodologyVersions'), {
        indexType: 'WMI',
        version: nextVersion,
        changedByUid: auth.currentUser.uid,
        changedByEmail: auth.currentUser.email || '',
        reason: wmiChangeReason.trim(),
        isPublic: true,
        changedAt: new Date().toISOString(),
      });
    }
    await recordAudit('UPDATE_WMI_WEIGHTS', 'methodology', nextVersion, wmiChangeReason.trim());
    setWmiChangeReason('');
    setActionMsg(`Saved WMI methodology ${nextVersion} with full audit record.`);
    void fetchAdminOverview();
  };

  const handleStartTotpEnroll = async () => {
    setMfaError(null);
    if (!auth.currentUser) return;
    try {
      const mfaSession = await multiFactor(auth.currentUser).getSession();
      const totpSecret = await TotpMultiFactorGenerator.generateSecret(mfaSession);
      const uri = totpSecret.generateQrCodeUrl(auth.currentUser.email || 'admin', 'EcoIntelligence');
      setTotpSecretObj(totpSecret);
      setTotpSecretUrl(uri);
      setTotpSecretKey(totpSecret.secretKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to initialize TOTP MFA.';
      setMfaError(
        `${msg} Note: TOTP Multi-Factor Authentication requires Identity Platform / TOTP MFA enabled in the Firebase Console Authentication Settings.`
      );
    }
  };

  const handleFinalizeTotpEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !totpSecretObj) return;
    setMfaError(null);
    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecretObj, totpVerifyCode.trim());
      await multiFactor(auth.currentUser).enroll(assertion, 'Admin Authenticator App');
      setTotpSecretUrl(null);
      setTotpSecretObj(null);
      setTotpVerifyCode('');
      setActionMsg('TOTP Multifactor Authentication enrolled for this administrator account.');
      await recordAudit('ENROLL_ADMIN_MFA', 'adminSecurity', auth.currentUser.uid, 'Enrolled TOTP second factor');
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : 'Invalid verification code.');
    }
  };

  const adminNav: Array<{ id: AdminTab; label: string; Icon: React.FC<{ className?: string }> }> = [
    { id: 'overview', label: 'Admin Overview', Icon: LayoutDashboard },
    { id: 'users', label: 'User Management', Icon: Users },
    { id: 'locations', label: 'Location Management', Icon: MapPin },
    { id: 'apis', label: 'API Management', Icon: Server },
    { id: 'datasets', label: 'Dataset Management', Icon: FileSpreadsheet },
    { id: 'methodology', label: 'WQI & WMI Standards', Icon: Scale },
    { id: 'ai-config', label: 'AI & Anomaly Config', Icon: Bot },
    { id: 'alerts', label: 'Alerts & System Logs', Icon: Activity },
    { id: 'security', label: 'Audit & MFA Security', Icon: Lock },
  ];

  const enrolledMfaCount = auth.currentUser ? multiFactor(auth.currentUser).enrolledFactors.length : 0;

  return (
    <div className="min-h-screen bg-[#F6F8F7] flex">
      {/* Admin Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 bg-[#0F172A] text-slate-100 sticky top-0 h-screen">
        <div className="h-16 px-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            <span className="font-bold tracking-tight font-display">EcoAdmin</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1" aria-label="Administrator Navigation">
          {adminNav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeTab === item.id ? 'bg-[#0F766E] text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <item.Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-800 space-y-2">
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-slate-800 rounded-lg"
          >
            <Globe2 className="w-4 h-4" />
            <span>Switch to User Workspace</span>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 rounded-lg"
          >
            <LogOut className="w-4 h-4" />
            <span>End Admin Session</span>
          </button>
        </div>
      </aside>

      {/* Mobile Admin Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-900/50" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-72 bg-[#0F172A] text-slate-100 h-full z-10 flex flex-col">
            <div className="h-16 px-4 border-b border-slate-800 flex items-center justify-between">
              <span className="font-bold">EcoAdmin Portal</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {adminNav.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-lg ${
                    activeTab === item.id ? 'bg-[#0F766E] text-white' : 'text-slate-300'
                  }`}
                >
                  <item.Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Admin Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 border border-slate-200 rounded-lg"
              aria-label="Open admin menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base font-bold text-slate-900">Administrator Governance Console</h1>
              <p className="text-xs text-slate-500">
                Signed in as {auth.currentUser?.email} · MFA Factors: {enrolledMfaCount}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void fetchAdminOverview()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-6">
          {actionMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center justify-between">
              <span>{actionMsg}</span>
              <button type="button" onClick={() => setActionMsg(null)} className="font-semibold">
                Dismiss
              </button>
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}

          {data && activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-500">Registered Users</div>
                  <div className="text-2xl font-bold font-mono-tabular">{usersList.length}</div>
                  <div className="text-[11px] text-slate-500">Active: {usersList.filter((u) => u.status === 'active').length}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-500">Operational Data Adapters</div>
                  <div className="text-2xl font-bold font-mono-tabular">
                    {data.providers.filter((p) => p.healthStatus !== 'Error').length} / {data.providers.length}
                  </div>
                  <div className="text-[11px] text-slate-500">Monitored Locations: {data.monitoredLocations.length}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-500">Background Ingestion Job</div>
                  <div className="text-lg font-bold capitalize">{data.systemConfig.lastJobStatus}</div>
                  <div className="text-[11px] text-slate-500 font-mono-tabular">
                    Last Run: {data.systemConfig.lastJobRunAt ? new Date(data.systemConfig.lastJobRunAt).toLocaleTimeString() : 'Pending'}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-500">Ingested Records &amp; Errors</div>
                  <div className="text-2xl font-bold font-mono-tabular">{data.systemConfig.totalIngestedRecords}</div>
                  <div className="text-[11px] text-slate-500">Processing Errors: {data.systemConfig.processingErrors}</div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Manual Ingestion Scheduler Trigger</h2>
                  <p className="text-xs text-slate-500">Execute an immediate multi-city Open-Meteo telemetry sync and anomaly check.</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const token = await auth.currentUser?.getIdToken();
                    await fetch('/api/admin/scheduler/run', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
                    setActionMsg('Manual background ingestion cycle completed.');
                    void fetchAdminOverview();
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F766E] rounded-lg hover:bg-[#0D9488]"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Run Ingestion Now</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">User Management</h2>
                  <p className="text-xs text-slate-500">View account statuses and suspend/reactivate accounts. Plain-text passwords are never stored or accessible.</p>
                </div>
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search name or email..."
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3">Full Name</th>
                      <th className="py-2.5 px-3">Email</th>
                      <th className="py-2.5 px-3">Country</th>
                      <th className="py-2.5 px-3">Role</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {usersList
                      .filter(
                        (u) =>
                          u.fullName.toLowerCase().includes(userSearch.toLowerCase()) ||
                          u.email.toLowerCase().includes(userSearch.toLowerCase())
                      )
                      .map((u) => (
                        <tr key={u.id}>
                          <td className="py-2.5 px-3 font-medium text-slate-900">{u.fullName}</td>
                          <td className="py-2.5 px-3 text-slate-600">{u.email}</td>
                          <td className="py-2.5 px-3 text-slate-600">{u.country || '—'}</td>
                          <td className="py-2.5 px-3 font-mono-tabular">{u.role}</td>
                          <td className="py-2.5 px-3">
                            <StatusBadge level={u.status === 'active' ? 'good' : 'severe'} label={u.status} />
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => void handleToggleUserStatus(u)}
                              className="px-2.5 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50"
                            >
                              {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data && activeTab === 'locations' && (
            <div className="space-y-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const token = await auth.currentUser?.getIdToken();
                  const res = await fetch('/api/admin/locations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                      ...newLoc,
                      latitude: Number(newLoc.latitude),
                      longitude: Number(newLoc.longitude),
                    }),
                  });
                  if (res.ok) {
                    setNewLoc({ name: '', city: '', state: '', country: '', countryCode: '', latitude: '', longitude: '' });
                    setActionMsg('Added monitored location.');
                    void fetchAdminOverview();
                  }
                }}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
              >
                <h2 className="text-sm font-bold text-slate-900">Add Monitored Node</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <input required placeholder="Display Name (e.g. Pune, IN)" value={newLoc.name} onChange={(e) => setNewLoc({ ...newLoc, name: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg" />
                  <input required placeholder="City" value={newLoc.city} onChange={(e) => setNewLoc({ ...newLoc, city: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg" />
                  <input required placeholder="Country" value={newLoc.country} onChange={(e) => setNewLoc({ ...newLoc, country: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg" />
                  <input required placeholder="ISO Code (e.g. IN)" value={newLoc.countryCode} onChange={(e) => setNewLoc({ ...newLoc, countryCode: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg" />
                  <input required type="number" step="any" placeholder="Latitude" value={newLoc.latitude} onChange={(e) => setNewLoc({ ...newLoc, latitude: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg font-mono-tabular" />
                  <input required type="number" step="any" placeholder="Longitude" value={newLoc.longitude} onChange={(e) => setNewLoc({ ...newLoc, longitude: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg font-mono-tabular" />
                </div>
                <button type="submit" className="px-4 py-2 text-xs font-semibold text-white bg-[#14532D] rounded-lg">
                  Add Location Node
                </button>
              </form>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-4">Location</th>
                        <th className="py-2.5 px-4">Country Code</th>
                        <th className="py-2.5 px-4">Coordinates</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.monitoredLocations.map((l) => (
                        <tr key={l.id}>
                          <td className="py-2.5 px-4 font-medium text-slate-900">{l.name}</td>
                          <td className="py-2.5 px-4 font-mono-tabular">{l.countryCode}</td>
                          <td className="py-2.5 px-4 font-mono-tabular">{l.latitude.toFixed(4)}, {l.longitude.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {data && activeTab === 'apis' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h2 className="text-base font-bold text-slate-900">API Provider Adapters &amp; Server-Side Secrets</h2>
                <div className="space-y-3">
                  {data.providers.map((p) => {
                    const effectiveStatus = p.healthStatus || (p.status === 'connected' ? 'Live' : 'Fallback');
                    const badgeLevel =
                      effectiveStatus === 'Live'
                        ? 'good'
                        : effectiveStatus === 'Sample data'
                          ? 'sample'
                          : effectiveStatus === 'Fallback'
                            ? 'moderate'
                            : 'severe';
                    const badgeLabel =
                      effectiveStatus === 'Fallback' && p.fallbackProvider
                        ? `Fallback: ${p.fallbackProvider}`
                        : effectiveStatus;
                    return (
                      <div key={p.id} className="p-4 border border-slate-200 rounded-lg space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-900 flex flex-wrap items-center gap-2">
                              <span>{p.name}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono-tabular break-all">{p.endpoint}</div>
                            {p.fallbackDescription && (
                              <div className="text-[11px] text-slate-600 mt-0.5">{p.fallbackDescription}</div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge level={badgeLevel} label={badgeLabel} />
                            <button
                              type="button"
                              onClick={() => void handleTestProvider(p.id)}
                              className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg"
                            >
                              Test connection
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveProviderSecret(p.id, !p.enabled)}
                              className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg"
                            >
                              {p.enabled ? 'Disable' : 'Enable'}
                            </button>
                          </div>
                        </div>

                        {p.authType !== 'none' && (
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                            <input
                              type="password"
                              placeholder={`Enter ${p.envVarName || 'API Key'} (stored server-side only)`}
                              value={keyInputs[p.id] || ''}
                              onChange={(e) => setKeyInputs({ ...keyInputs, [p.id]: e.target.value })}
                              className="w-full sm:flex-1 min-w-0 min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                            />
                            <button
                              type="button"
                              onClick={() => void handleSaveProviderSecret(p.id)}
                              className="min-h-[44px] sm:min-h-[36px] px-3.5 py-1.5 text-xs font-medium bg-[#0F766E] text-white rounded-lg whitespace-nowrap"
                            >
                              Save Server Secret
                            </button>
                          </div>
                        )}
                        {p.lastError && <div className="text-[11px] text-amber-800">{p.lastError}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <form onSubmit={handleAddCustomProvider} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Register Additional Provider Adapter</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <input required placeholder="Provider Name" value={newProv.name} onChange={(e) => setNewProv({ ...newProv, name: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg" />
                  <select value={newProv.category} onChange={(e) => setNewProv({ ...newProv, category: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="air">Air</option>
                    <option value="water">Water</option>
                    <option value="waste">Waste</option>
                    <option value="energy">Energy</option>
                    <option value="weather">Weather</option>
                  </select>
                  <input required type="url" placeholder="https://api.example.org/v1/..." value={newProv.endpoint} onChange={(e) => setNewProv({ ...newProv, endpoint: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <button type="submit" className="px-4 py-2 text-xs font-semibold text-white bg-[#14532D] rounded-lg">
                  Add Provider Adapter
                </button>
              </form>
            </div>
          )}

          {data && activeTab === 'datasets' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h2 className="text-base font-bold text-slate-900">Dataset Import Audit History</h2>
              {data.importHistory.length === 0 ? (
                <p className="text-xs text-slate-500">No CSV/Excel datasets have been imported in the current runtime session yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">File</th>
                        <th className="py-2 px-3">Category</th>
                        <th className="py-2 px-3">Location</th>
                        <th className="py-2 px-3 text-right">Accepted / Rejected</th>
                        <th className="py-2 px-3">Uploaded By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.importHistory.map((h) => (
                        <tr key={h.id}>
                          <td className="py-2 px-3 font-medium">{h.fileName}</td>
                          <td className="py-2 px-3 capitalize">{h.category}</td>
                          <td className="py-2 px-3">{h.locationName}</td>
                          <td className="py-2 px-3 text-right font-mono-tabular">
                            {h.acceptedRows} / {h.rejectedRows}
                          </td>
                          <td className="py-2 px-3">{h.uploadedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {data && activeTab === 'methodology' && (
            <form onSubmit={handleUpdateWmiMethodology} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-slate-900">WMI Weight &amp; Methodology Versioning</h2>
                <p className="text-xs text-slate-600">
                  Weights must sum to 1.00. Every change requires an audit justification and records a permanent version entry.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(wmiWeightsDraft).map(([k, val]) => (
                  <div key={k}>
                    <label className="block text-xs font-medium text-slate-700 capitalize mb-1">{k}</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={val}
                      onChange={(e) => setWmiWeightsDraft({ ...wmiWeightsDraft, [k]: Number(e.target.value) })}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg font-mono-tabular"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Change Reason (Audit Required)</label>
                <input
                  type="text"
                  required
                  value={wmiChangeReason}
                  onChange={(e) => setWmiChangeReason(e.target.value)}
                  placeholder="e.g. Increased recycling weight per municipal circularity review"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <button type="submit" className="px-4 py-2 text-xs font-semibold text-white bg-[#14532D] rounded-lg">
                Save &amp; Record Methodology Version
              </button>
            </form>
          )}

          {data && activeTab === 'ai-config' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h2 className="text-base font-bold text-slate-900">AI Forecasting &amp; Anomaly Threshold Settings</h2>
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={data.systemConfig.forecastingEnabled}
                      onChange={async (e) => {
                        const token = await auth.currentUser?.getIdToken();
                        await fetch('/api/admin/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ forecastingEnabled: e.target.checked }),
                        });
                        void fetchAdminOverview();
                      }}
                    />
                    <span>Enable Statistical Time-Series Forecasting</span>
                  </label>
                  <span className="font-mono-tabular">Active Z-Score Threshold: {data.systemConfig.anomalyZThreshold}</span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Recent EcoAI Request &amp; Error Logs</h3>
                {data.aiLogs.length === 0 ? (
                  <p className="text-xs text-slate-500">No EcoAI chatbot requests recorded yet.</p>
                ) : (
                  <div className="space-y-2 text-xs">
                    {data.aiLogs.map((l) => (
                      <div key={l.id} className="p-2.5 border border-slate-200 rounded-lg flex flex-wrap justify-between gap-2">
                        <div>
                          <strong>{l.userEmail}</strong> ({l.locationName}): {l.promptPreview}
                        </div>
                        <span className="font-mono-tabular">
                          {l.status} · {l.latencyMs}ms
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {data && activeTab === 'alerts' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h2 className="text-base font-bold text-slate-900">API Synchronization &amp; System Logs</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3">Provider</th>
                      <th className="py-2 px-3">Location</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Message</th>
                      <th className="py-2 px-3">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.syncLogs.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2 px-3 font-medium">{s.providerName}</td>
                        <td className="py-2 px-3">{s.locationName}</td>
                        <td className="py-2 px-3">{s.status}</td>
                        <td className="py-2 px-3 text-slate-600">{s.message}</td>
                        <td className="py-2 px-3 font-mono-tabular">{new Date(s.syncedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-[#0F766E]" />
                      <span>Firebase Administrator MFA (TOTP Authenticator)</span>
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Enrolled Factors: <strong className="font-mono-tabular">{enrolledMfaCount}</strong> · Idle session expiration: 30 minutes
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleStartTotpEnroll()}
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-[#0F766E] rounded-lg hover:bg-[#0D9488]"
                  >
                    Enroll TOTP Authenticator
                  </button>
                </div>

                {mfaError && <div className="p-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg">{mfaError}</div>}

                {totpSecretUrl && (
                  <form onSubmit={handleFinalizeTotpEnroll} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3 text-xs">
                    <div>
                      <strong>Secret Key (add to Google Authenticator / Authy):</strong>{' '}
                      <code className="font-mono-tabular bg-white px-2 py-0.5 border rounded">{totpSecretKey}</code>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        required
                        placeholder="Enter 6-digit TOTP code"
                        value={totpVerifyCode}
                        onChange={(e) => setTotpVerifyCode(e.target.value)}
                        className="px-3 py-1.5 border border-slate-300 rounded-lg font-mono-tabular"
                      />
                      <button type="submit" className="px-3 py-1.5 bg-[#14532D] text-white font-semibold rounded-lg">
                        Confirm MFA Enrollment
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#14532D]" />
                  <span>Immutable Administrative Audit Logs</span>
                </h3>
                {auditLogs.length === 0 ? (
                  <p className="text-xs text-slate-500">No audit entries recorded yet.</p>
                ) : (
                  <div className="space-y-2 text-xs">
                    {auditLogs.slice(0, 20).map((log) => (
                      <div key={log.id} className="p-2.5 border border-slate-200 rounded-lg flex flex-wrap justify-between gap-2">
                        <div>
                          <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5 text-emerald-700" />
                          <strong>{log.action}</strong> ({log.targetType}) by {log.actorEmail || 'Admin'} — {log.details}
                        </div>
                        <span className="font-mono-tabular text-slate-500">{new Date(log.createdAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
