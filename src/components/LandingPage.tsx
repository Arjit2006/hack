import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Database, Globe2, ShieldCheck, Wind, Droplets, Recycle, Zap } from 'lucide-react';
import { AppView } from '../types/env';
import { PWAInstallButton } from './PWAStatusUI';

interface ProviderStatus {
  id: string;
  name: string;
  category: string;
  status: string;
  fallbackProvider?: string;
  fallbackDescription?: string;
  isSampleData?: boolean;
  isCached?: boolean;
  cacheAgeMinutes?: number;
  lastSyncAt: string | null;
  documentationUrl: string;
}

interface LandingPageProps {
  onNavigate: (view: AppView) => void;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

function providerStatusLevel(status: string): 'good' | 'moderate' | 'sample' | 'severe' | 'unavailable' {
  if (status === 'Live' || status === 'connected') return 'good';
  if (status === 'Fallback') return 'moderate';
  if (status === 'Sample data') return 'sample';
  if (status === 'Error' || status === 'error') return 'severe';
  return 'unavailable';
}

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate, isAuthenticated, isAdmin }) => {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [stationImgFailed, setStationImgFailed] = useState(false);

  useEffect(() => {
    fetch('/api/env/providers-status')
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((d: { providers?: ProviderStatus[] }) => setProviders(d.providers ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#0F172A] overflow-x-hidden">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-8">
          <a href="#top" className="text-lg sm:text-xl font-bold tracking-tight text-[#14532D] whitespace-nowrap shrink-0 font-display">
            EcoIntelligence
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600" aria-label="Primary">
            <a href="#capabilities" className="hover:text-[#14532D] transition-colors whitespace-nowrap shrink-0">
              Capabilities
            </a>
            <a href="#methodology" className="hover:text-[#14532D] transition-colors whitespace-nowrap shrink-0">
              Methodology
            </a>
            <a href="#sources" className="hover:text-[#14532D] transition-colors whitespace-nowrap shrink-0">
              Data Sources
            </a>
            <button
              type="button"
              onClick={() => onNavigate(isAdmin ? 'admin' : 'admin-login')}
              className="hover:text-[#14532D] transition-colors whitespace-nowrap shrink-0 min-h-[44px] inline-flex items-center"
            >
              Admin Portal
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton compact />
            </div>
            <button
              type="button"
              onClick={() => onNavigate(isAuthenticated ? 'dashboard' : 'login')}
              className="min-h-[44px] px-3.5 sm:px-4 py-2 text-sm font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14532D]"
            >
              {isAuthenticated ? 'Open Dashboard' : 'Sign In'}
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12 sm:pt-10 sm:pb-14 lg:pt-16 lg:pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center space-y-5 sm:space-y-6">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span>Global Environmental Telemetry</span>
                <span aria-hidden="true">·</span>
                <span>Jurisdiction-Aware Indices</span>
                <span aria-hidden="true">·</span>
                <span>Grounded AI Reports</span>
              </div>

              <h1
                className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 leading-tight"
                style={{ textWrap: 'balance' }}
              >
                Measure local environmental risk with transparent scientific precision.
              </h1>

              <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
                EcoIntelligence aggregates verified air quality, weather, hydrological, waste-flow, and national energy datasets for any city or district worldwide—computing AQI, WAWQI, and WMI with full methodological clarity.
              </p>

              <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onNavigate(isAuthenticated ? 'dashboard' : 'register')}
                  className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] transition-colors whitespace-nowrap"
                >
                  <span>{isAuthenticated ? 'Go to Workspace' : 'Create Free Account'}</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate(isAuthenticated ? 'dashboard' : 'login')}
                  className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  Sign In to Monitor
                </button>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="h-full min-h-[240px] sm:min-h-[300px] lg:min-h-[420px] rounded-xl border border-slate-200 bg-white overflow-hidden">
                {!heroImgFailed ? (
                  <img
                    src="/src/assets/images/hero_ecointelligence_globe_1795709877322.jpg"
                    alt="Global atmospheric and river watershed monitoring visualization"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#14532D] to-[#0F766E] flex flex-col items-center justify-center text-white p-8 text-center">
                    <Globe2 className="w-12 h-12 mb-3 opacity-90" aria-hidden="true" />
                    <p className="text-base font-semibold">Global Environmental Sensor Grid</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 4-Column Quantitative Capabilities Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">01. Air Quality</span>
                <Wind className="w-4 h-4 text-[#0F766E]" aria-hidden="true" />
              </div>
              <p className="text-lg font-bold text-slate-900">CPCB, US EPA &amp; EAQI</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                Applies the country-appropriate official AQI breakpoints for PM2.5, PM10, NO2, SO2, CO, and O3.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">02. Water Quality</span>
                <Droplets className="w-4 h-4 text-[#0F766E]" aria-hidden="true" />
              </div>
              <p className="text-lg font-bold text-slate-900">Direction-Aware WAWQI</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                Weighted Arithmetic WQI with temperature-adjusted DO saturation and isolated coliform alerts.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">03. Waste Management</span>
                <Recycle className="w-4 h-4 text-[#14532D]" aria-hidden="true" />
              </div>
              <p className="text-lg font-bold text-slate-900">6-Component WMI</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                Proposed 0–100 composite index auditing collection, segregation, recycling, treatment, and mass balance.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">04. Energy &amp; Climate</span>
                <Zap className="w-4 h-4 text-[#0F766E]" aria-hidden="true" />
              </div>
              <p className="text-lg font-bold text-slate-900">Renewables &amp; Forecasts</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                National renewable generation share, statistical Z-score anomaly detection, and validated forecasts.
              </p>
            </div>
          </div>
        </section>

        {/* Methodology & Transparency Section */}
        <section id="methodology" className="bg-white border-y border-slate-200 py-14">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5">
              <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50 aspect-[4/3]">
                {!stationImgFailed ? (
                  <img
                    src="/src/assets/images/eco_station_sensor_1795709877961.jpg"
                    alt="Urban environmental monitoring station along a green riverfront"
                    referrerPolicy="no-referrer"
                    onError={() => setStationImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    <Database className="w-10 h-10" aria-hidden="true" />
                  </div>
                )}
              </div>
            </div>

            <div id="capabilities" className="lg:col-span-7 space-y-5">
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                Scientific accountability built into every reading
              </h2>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                Unlike generic dashboards that fabricate placeholder numbers when local sensors are offline, EcoIntelligence enforces strict data transparency across every index and AI report.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <CheckCircle2 className="w-4 h-4 text-[#14532D]" aria-hidden="true" />
                    <span>Zero Unlabeled Fallbacks</span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Missing readings are never zeroed out. Fallback and reference water/waste datasets display clear provenance labels.
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <CheckCircle2 className="w-4 h-4 text-[#14532D]" aria-hidden="true" />
                    <span>Grounded EcoAI Assistant</span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Gemini analyzes verified backend readings and exact WQI/WMI outputs without inventing metrics.
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <CheckCircle2 className="w-4 h-4 text-[#14532D]" aria-hidden="true" />
                    <span>Inline Report &amp; Export Engine</span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Inspect full KPI cards, anomaly tables, and recommendations inline on the dashboard, with optional PDF &amp; CSV export.
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ShieldCheck className="w-4 h-4 text-[#14532D]" aria-hidden="true" />
                    <span>Role-Based Admin Governance</span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Separate MFA-protected administrator portal for API credentials, dataset audits, and weight versioning.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Live Data Sources Registry */}
        <section id="sources" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Connected Data Integrations</h2>
              <p className="text-sm text-slate-600 mt-1">
                Operational status across all 8 adapters with automatic 10-minute caching and resilient fallbacks.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('admin-login')}
              className="min-h-[44px] inline-flex items-center text-sm font-medium text-[#14532D] hover:underline whitespace-nowrap"
            >
              Manage Providers in Admin Portal →
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Mobile Stacked Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {providers.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-sm">Loading provider integration status...</div>
              ) : (
                providers.map((p) => {
                  const lvl = providerStatusLevel(p.status);
                  const badgeLabel =
                    p.status === 'Fallback' && p.fallbackProvider ? `Fallback: ${p.fallbackProvider}` : p.status;
                  return (
                    <div key={p.id} className="p-4 space-y-2">
                      <div className="flex flex-col gap-1.5">
                        <div>
                          <div className="font-semibold text-sm text-slate-900">{p.name}</div>
                          <div className="text-xs text-slate-500 capitalize">{p.category}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`text-xs font-semibold px-2 py-1 rounded-md border whitespace-nowrap ${
                              lvl === 'good'
                                ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                                : lvl === 'moderate'
                                  ? 'text-amber-800 bg-amber-50 border-amber-200'
                                  : lvl === 'sample'
                                    ? 'text-sky-800 bg-sky-50 border-sky-200'
                                    : 'text-red-800 bg-red-50 border-red-200'
                            }`}
                          >
                            {badgeLabel}
                          </span>
                          {p.isCached && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 text-[11px] font-mono-tabular whitespace-nowrap">
                              cached · {p.cacheAgeMinutes ?? 0}m ago
                            </span>
                          )}
                        </div>
                      </div>
                      {p.fallbackDescription && <p className="text-xs text-slate-600">{p.fallbackDescription}</p>}
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                        <span className="font-mono-tabular">
                          {p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleTimeString() : 'Ready'}
                        </span>
                        <a
                          href={p.documentationUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-[#0F766E] hover:underline min-h-[44px] inline-flex items-center"
                        >
                          Documentation
                        </a>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Provider</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Status &amp; Active Mode</th>
                    <th className="py-3 px-4">Last Updated</th>
                    <th className="py-3 px-4">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {providers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 px-4 text-center text-slate-500 text-sm">
                        Loading provider integration status...
                      </td>
                    </tr>
                  ) : (
                    providers.map((p) => {
                      const lvl = providerStatusLevel(p.status);
                      const badgeLabel =
                        p.status === 'Fallback' && p.fallbackProvider ? `Fallback: ${p.fallbackProvider}` : p.status;
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-medium text-slate-900">
                            <div>{p.name}</div>
                          </td>
                          <td className="py-3 px-4 text-slate-600 capitalize">{p.category}</td>
                          <td className="py-3 px-4">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`inline-block text-xs font-semibold px-2 py-0.5 rounded border whitespace-nowrap ${
                                    lvl === 'good'
                                      ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                                      : lvl === 'moderate'
                                        ? 'text-amber-800 bg-amber-50 border-amber-200'
                                        : lvl === 'sample'
                                          ? 'text-sky-800 bg-sky-50 border-sky-200'
                                          : 'text-red-800 bg-red-50 border-red-200'
                                  }`}
                                >
                                  {badgeLabel}
                                </span>
                                {p.isCached && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 text-[11px] font-mono-tabular whitespace-nowrap">
                                    cached · {p.cacheAgeMinutes ?? 0}m ago
                                  </span>
                                )}
                              </div>
                              {p.fallbackDescription && (
                                <div className="text-[11px] text-slate-500">{p.fallbackDescription}</div>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-500 font-mono-tabular whitespace-nowrap">
                            {p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleTimeString() : 'Ready'}
                          </td>
                          <td className="py-3 px-4">
                            <a
                              href={p.documentationUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-[#0F766E] hover:underline"
                            >
                              Documentation
                            </a>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>EcoIntelligence — Environmental Monitoring, Analytics &amp; Risk Prediction</span>
          <div className="flex flex-wrap items-center justify-center gap-6">
            <button type="button" onClick={() => onNavigate('login')} className="hover:text-slate-800 min-h-[44px] px-1">
              User Sign In
            </button>
            <button type="button" onClick={() => onNavigate('register')} className="hover:text-slate-800 min-h-[44px] px-1">
              Register
            </button>
            <button type="button" onClick={() => onNavigate('admin-login')} className="hover:text-slate-800 min-h-[44px] px-1">
              Administrator Portal
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
