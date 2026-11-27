import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CloudRain,
  Compass,
  Database,
  Droplets,
  Flame,
  RefreshCw,
  Sparkles,
  Thermometer,
  Wind,
  Zap,
} from 'lucide-react';
import { auth } from '../../lib/firebase';
import { apiFetch } from '../../lib/apiFetch';
import { FormattedMarkdown } from '../FormattedMarkdown';
import { AiSummaryResult, DashboardTab, DataSourceReport, OverviewPayload } from '../../types/env';
import { LeafletMap } from '../LeafletMap';
import { originLabelText, StatusBadge } from '../StatusBadge';
import { useToast } from '../ToastProvider';

interface OverviewModuleProps {
  data: OverviewPayload | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenTab: (tab: DashboardTab) => void;
}

function renderSourceStatus(src: DataSourceReport) {
  let primaryBadge: React.ReactNode;
  if (src.status === 'Live') {
    primaryBadge = <StatusBadge level="good" label="Live" />;
  } else if (src.status === 'Fallback') {
    const label = src.fallbackProvider ? `Fallback: ${src.fallbackProvider}` : 'Fallback';
    primaryBadge = <StatusBadge level="moderate" label={label} />;
  } else if (src.status === 'Sample data') {
    primaryBadge = <StatusBadge level="sample" label="Sample data" />;
  } else {
    primaryBadge = <StatusBadge level="severe" label="Error" />;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {primaryBadge}
      {src.isCached && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 text-[11px] font-mono-tabular whitespace-nowrap">
          cached · {src.cacheAgeMinutes ?? 0}m ago
        </span>
      )}
    </div>
  );
}

function buildCompactAiPayload(data: OverviewPayload) {
  const pm25Arr = data.airHourly.filter((h) => h.pm25 !== null).map((h) => h.pm25 as number);
  const avgPm25 = pm25Arr.length ? Number((pm25Arr.reduce((s, v) => s + v, 0) / pm25Arr.length).toFixed(1)) : null;
  const maxPm25 = pm25Arr.length ? Number(Math.max(...pm25Arr).toFixed(1)) : null;
  const trend6hDelta =
    pm25Arr.length >= 6 ? Number((pm25Arr[pm25Arr.length - 1] - pm25Arr[Math.max(0, pm25Arr.length - 6)]).toFixed(1)) : null;

  return {
    aqi: {
      aqi: data.aqi.aqi,
      standardName: data.aqi.standardName,
      category: data.aqi.category,
      dominantPollutant: data.aqi.dominantPollutant,
      pollutants: data.aqi.pollutants.slice(0, 6).map((p) => ({
        parameter: p.parameter,
        value: p.value,
        unit: p.unit,
      })),
    },
    airStats: {
      avgPm25,
      maxPm25,
      trend6hDelta,
    },
    weather: data.weather
      ? {
          temperatureC: data.weather.current.temperatureC,
          humidityPct: data.weather.current.humidityPct,
          windSpeedKmh: data.weather.current.windSpeedKmh,
          weatherLabel: data.weather.current.weatherLabel,
          warningsCount: data.weather.warnings.length,
        }
      : null,
    water: data.water.wqi
      ? {
          wqi: data.water.wqi.wqi,
          classification: data.water.wqi.classification,
          waterUse: data.water.wqi.waterUse,
          isSampleData: Boolean(data.water.isSampleData),
        }
      : null,
    waste: data.waste.wmi
      ? {
          wmi: data.waste.wmi.wmi,
          classification: data.waste.wmi.classification,
          weakestComponent: data.waste.wmi.weakestComponent,
          isSampleData: Boolean(data.waste.isSampleData),
        }
      : null,
    energy: data.energy.worldBank
      ? {
          latestRenewablePct: data.energy.worldBank.latestRenewablePct,
          latestRenewableYear: data.energy.worldBank.latestRenewableYear,
          latestElectricityKwhPerCapita: data.energy.worldBank.latestElectricityKwhPerCapita,
        }
      : null,
    anomalies: data.anomalies.slice(0, 3).map((a) => ({
      parameter: a.parameter,
      observedValue: a.observedValue,
      baselineValue: a.baselineValue,
      unit: a.unit,
      severity: a.severity,
      reason: a.reason,
    })),
  };
}

export const OverviewModule: React.FC<OverviewModuleProps> = ({ data, loading, error, onRetry, onOpenTab }) => {
  const { showToast } = useToast();
  const [aiSummary, setAiSummary] = useState<AiSummaryResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [sources, setSources] = useState<DataSourceReport[]>([]);
  const [testingSourceId, setTestingSourceId] = useState<string | null>(null);
  const lastAutoKeyRef = useRef<string>('');

  useEffect(() => {
    if (data?.dataSources) {
      setSources(data.dataSources);
    }
  }, [data]);

  const handleGenerateSummary = useCallback(
    async (isManual = false) => {
      if (!data) return;
      setAiLoading(true);
      try {
        const token = await auth.currentUser?.getIdToken().catch(() => undefined);
        const json = await apiFetch<Partial<AiSummaryResult>>('/api/ai/summary', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            locationName: data.location.name,
            groundedContext: buildCompactAiPayload(data),
          }),
        });
        setAiSummary({
          summary: json.summary || 'Environmental telemetry summary generated.',
          currentActions: json.currentActions ?? [],
          futureActions: json.futureActions ?? [],
          mode: json.mode || 'rule_based_fallback',
          modelUsed: json.modelUsed,
          modelLabel: json.modelLabel || (json.mode === 'gemini' ? 'Gemini 4 Hydrogen' : 'Basic mode'),
          fallbackReason: json.fallbackReason,
          generatedAt: json.generatedAt || new Date().toISOString(),
        });
        if (isManual) {
          showToast({
            type: 'success',
            title: 'Environmental Summary Updated',
            message:
              json.mode === 'gemini'
                ? `Generated via ${json.modelLabel || 'Gemini EcoAI'} for ${data.location.city}.`
                : `Generated via rule-based data synthesis for ${data.location.city}.`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to synthesize AI summary';
        const pm25Arr = data.airHourly.filter((h) => h.pm25 !== null).map((h) => h.pm25 as number);
        const avgPm25 = pm25Arr.length ? Number((pm25Arr.reduce((s, v) => s + v, 0) / pm25Arr.length).toFixed(1)) : null;
        setAiSummary({
          summary: `${data.location.name} reports AQI ${data.aqi.aqi ?? 'N/A'} (${data.aqi.category}) driven by ${data.aqi.dominantPollutant || 'particulate matter'}${avgPm25 !== null ? ` with ${avgPm25} µg/m³ mean PM2.5` : ''}.`,
          currentActions: [
            data.aqi.healthGuidance || 'Follow local air quality exposure guidance.',
            'Inspect Water and Waste tabs or upload local CSV data for ward-level resolution.',
            'Monitor hourly PM2.5 peaks before scheduling strenuous outdoor activity.',
          ],
          futureActions: [
            'Track the 7-day weather outlook for wind dispersion and rainfall shifts.',
            'Increase local clean energy and waste segregation adoption.',
          ],
          mode: 'rule_based_fallback',
          modelUsed: 'basic-mode',
          modelLabel: 'Basic mode',
          fallbackReason: msg,
          generatedAt: new Date().toISOString(),
        });
        if (isManual) {
          showToast({
            type: 'info',
            title: 'Switched to Rule-Based Summary',
            message: msg,
          });
        }
      } finally {
        setAiLoading(false);
      }
    },
    [data, showToast]
  );

  useEffect(() => {
    if (!data) return;
    const key = `${data.location.name}|${data.retrievedAt}`;
    if (lastAutoKeyRef.current === key) return;
    lastAutoKeyRef.current = key;
    void handleGenerateSummary(false);
  }, [data, handleGenerateSummary]);

  const handleTestSourceConnection = async (sourceId: string) => {
    if (!data) return;
    setTestingSourceId(sourceId);
    try {
      const res = await fetch(`/api/env/sources/${encodeURIComponent(sourceId)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: data.location.latitude,
          lon: data.location.longitude,
          countryCode: data.location.countryCode,
          locationName: data.location.name,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        sourceReport?: DataSourceReport;
      };
      if (json.sourceReport) {
        setSources((prev) => prev.map((s) => (s.id === sourceId ? json.sourceReport! : s)));
      }
      showToast({
        type: json.ok ? 'success' : 'error',
        title: json.sourceReport?.name || sourceId,
        message: json.message || 'Connection test completed.',
      });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Connection Test Failed',
        message: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setTestingSourceId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-44 bg-white border border-slate-200 rounded-xl p-5" />
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2 text-red-700 font-semibold">
          <AlertTriangle className="w-5 h-5" aria-hidden="true" />
          <span>Unable to retrieve environmental telemetry</span>
        </div>
        <p className="text-sm text-slate-600">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] text-sm font-medium bg-[#14532D] text-white rounded-lg hover:bg-[#166534]"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Retry Fetch
        </button>
      </div>
    );
  }

  if (!data) return null;

  const chartPoints = data.airHourly.slice(-36).map((h) => ({
    time: h.timestamp.slice(11, 16),
    pm25: h.pm25,
    pm10: h.pm10,
  }));

  const pm25Arr = data.airHourly.filter((h) => h.pm25 !== null).map((h) => h.pm25 as number);
  const pm25TrendDelta =
    pm25Arr.length >= 6
      ? Number((pm25Arr[pm25Arr.length - 1] - pm25Arr[Math.max(0, pm25Arr.length - 6)]).toFixed(1))
      : null;

  const pinColor =
    data.aqi.severityLevel === 'good'
      ? '#16A34A'
      : data.aqi.severityLevel === 'moderate'
        ? '#D97706'
        : data.aqi.severityLevel === 'poor'
          ? '#EA580C'
          : data.aqi.severityLevel === 'severe'
            ? '#DC2626'
            : '#64748B';

  return (
    <div className="space-y-6">
      {/* Header Metadata Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{data.location.name}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular">
            {data.location.latitude.toFixed(4)}°, {data.location.longitude.toFixed(4)}°
          </span>
          <span aria-hidden="true">·</span>
          <span>Framework: {data.aqi.standardName}</span>
        </div>
        <span className="font-mono-tabular">Retrieved {new Date(data.retrievedAt).toLocaleString()}</span>
      </div>

      {/* 4 Category Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 1. Air Quality Card */}
        <button
          type="button"
          onClick={() => onOpenTab('air')}
          className="text-left bg-white border border-slate-200 hover:border-[#14532D]/40 rounded-xl p-5 space-y-3 transition-colors min-w-0"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              <Wind className="w-4 h-4 text-[#0F766E] shrink-0" aria-hidden="true" />
              Air Quality (AQI)
            </span>
            <StatusBadge level={data.aqi.severityLevel} label={data.aqi.category} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900 font-mono-tabular">
              {data.aqi.aqi !== null ? data.aqi.aqi : '—'}
            </span>
            <span className="text-xs text-slate-500 font-mono-tabular">
              {data.aqi.standardCode === 'EU_EAQI' ? 'EAQI (1–6)' : data.aqi.standardCode === 'UK_DAQI' ? 'DAQI (1–10)' : 'Index'}
            </span>
          </div>
          <div className="text-xs text-slate-600 space-y-1">
            <div>
              Dominant: <span className="font-medium text-slate-800">{data.aqi.dominantPollutant || 'Unavailable'}</span>
              {pm25TrendDelta !== null && (
                <span>
                  {' '}
                  · 6h PM2.5: <strong className="font-mono-tabular">{pm25TrendDelta > 0 ? `+${pm25TrendDelta}` : pm25TrendDelta} µg/m³</strong>
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {originLabelText(data.aqi.originType)} · {data.aqi.source}
            </div>
            <div className="text-[11px] text-slate-500 font-mono-tabular">
              Updated: {data.aqi.lastUpdated ? new Date(data.aqi.lastUpdated).toLocaleString() : 'Unavailable'}
            </div>
          </div>
        </button>

        {/* 2. Water Quality Card */}
        <button
          type="button"
          onClick={() => onOpenTab('water')}
          className="text-left bg-white border border-slate-200 hover:border-[#14532D]/40 rounded-xl p-5 space-y-3 transition-colors min-w-0"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              <Droplets className="w-4 h-4 text-[#0F766E] shrink-0" aria-hidden="true" />
              Water Quality (WAWQI)
            </span>
            <StatusBadge
              level={data.water.wqi ? data.water.wqi.severityLevel : 'unavailable'}
              label={data.water.wqi ? data.water.wqi.classification : 'Unavailable'}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900 font-mono-tabular">
              {data.water.wqi?.wqi !== null && data.water.wqi?.wqi !== undefined ? data.water.wqi.wqi : '—'}
            </span>
            <span className="text-xs text-slate-500">
              {data.water.isSampleData ? 'Sample data · Lower = Better' : 'WAWQI (Lower = Better)'}
            </span>
          </div>
          <div className="text-xs text-slate-600 space-y-1">
            {data.water.wqi ? (
              <>
                <div>
                  Completeness: {data.water.wqi.completenessPct}% ({data.water.wqi.waterUse})
                  {data.water.isSampleData && (
                    <span className="ml-1.5 font-semibold text-amber-800">· Sample data</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {data.water.sourceLabel || `${originLabelText(data.water.wqi.dataOrigin)} · ${data.water.wqi.standardName}`}
                </div>
                <div className="text-[11px] text-slate-500 font-mono-tabular">
                  Updated: {new Date(data.water.wqi.calculatedAt).toLocaleString()}
                </div>
              </>
            ) : (
              <>
                <div>No live water sensor feed connected for {data.location.city}.</div>
                <div className="text-[11px] text-[#14532D] font-medium">Open Water module to calculate or upload CSV →</div>
              </>
            )}
          </div>
        </button>

        {/* 3. Waste Management Card */}
        <button
          type="button"
          onClick={() => onOpenTab('waste')}
          className="text-left bg-white border border-slate-200 hover:border-[#14532D]/40 rounded-xl p-5 space-y-3 transition-colors min-w-0"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-[#14532D] shrink-0" aria-hidden="true" />
              Waste Index (WMI)
            </span>
            <StatusBadge
              level={data.waste.wmi ? data.waste.wmi.severityLevel : 'unavailable'}
              label={data.waste.wmi ? data.waste.wmi.classification : 'Unavailable'}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900 font-mono-tabular">
              {data.waste.wmi?.wmi !== null && data.waste.wmi?.wmi !== undefined ? data.waste.wmi.wmi : '—'}
            </span>
            <span className="text-xs text-slate-500">
              {data.waste.isSampleData ? '/ 100 · Sample data' : '/ 100 (Higher = Better)'}
            </span>
          </div>
          <div className="text-xs text-slate-600 space-y-1">
            {data.waste.wmi ? (
              <>
                <div>
                  Weakest: {data.waste.wmi.weakestComponent || 'N/A'}
                  {data.waste.isSampleData && (
                    <span className="ml-1.5 font-semibold text-amber-800">· Sample data</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {data.waste.sourceLabel || `${originLabelText(data.waste.wmi.dataOrigin)} · ${data.waste.wmi.methodologyVersion}`}
                </div>
                <div className="text-[11px] text-slate-500 font-mono-tabular">
                  Updated: {new Date(data.waste.wmi.calculatedAt).toLocaleString()}
                </div>
              </>
            ) : (
              <>
                <div>No municipal waste dataset uploaded for {data.location.city}.</div>
                <div className="text-[11px] text-[#14532D] font-medium">Open Waste module to compute WMI or import CSV →</div>
              </>
            )}
          </div>
        </button>

        {/* 4. Energy & Renewables Card */}
        <button
          type="button"
          onClick={() => onOpenTab('energy')}
          className="text-left bg-white border border-slate-200 hover:border-[#14532D]/40 rounded-xl p-5 space-y-3 transition-colors min-w-0"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-[#0F766E] shrink-0" aria-hidden="true" />
              Renewable Energy
            </span>
            <StatusBadge
              level={
                data.energy.worldBank?.latestRenewablePct !== null && data.energy.worldBank?.latestRenewablePct !== undefined
                  ? data.energy.worldBank.latestRenewablePct >= 30
                    ? 'good'
                    : 'moderate'
                  : 'unavailable'
              }
              label={
                data.energy.worldBank?.latestRenewablePct !== null && data.energy.worldBank?.latestRenewablePct !== undefined
                  ? `${data.energy.worldBank.latestRenewablePct}% Share`
                  : 'Unavailable'
              }
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900 font-mono-tabular">
              {data.energy.worldBank?.latestRenewablePct !== null && data.energy.worldBank?.latestRenewablePct !== undefined
                ? `${data.energy.worldBank.latestRenewablePct}%`
                : '—'}
            </span>
            <span className="text-xs text-slate-500">
              {data.energy.worldBank?.latestRenewableYear ? `(${data.energy.worldBank.latestRenewableYear})` : ''}
            </span>
          </div>
          <div className="text-xs text-slate-600 space-y-1">
            <div>
              Elec. per capita:{' '}
              <span className="font-mono-tabular font-medium">
                {data.energy.worldBank?.latestElectricityKwhPerCapita
                  ? `${data.energy.worldBank.latestElectricityKwhPerCapita} kWh`
                  : 'Unavailable'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 truncate">Historical / National · World Bank Open Data</div>
            <div className="text-[11px] text-slate-500 font-mono-tabular">
              Country: {data.energy.worldBank?.countryName || data.location.countryCode}
            </div>
          </div>
        </button>
      </div>

      {/* Weather Strip + Map + PM2.5 Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900">Recent Hourly PM2.5 &amp; PM10 Trend</h2>
              <p className="text-xs text-slate-500 truncate">
                Latest measured/modeled hourly values (µg/m³) · {data.aqi.source}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenTab('air')}
              className="min-h-[44px] px-2 text-xs font-medium text-[#14532D] hover:underline whitespace-nowrap"
            >
              Full Air Analysis →
            </button>
          </div>
          <div className="h-64 w-full">
            {chartPoints.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartPoints}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748B' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="pm25" name="PM2.5 (µg/m³)" stroke="#14532D" fill="#14532D" fillOpacity={0.14} strokeWidth={2} />
                  <Area type="monotone" dataKey="pm10" name="PM10 (µg/m³)" stroke="#0F766E" fill="#0F766E" fillOpacity={0.08} strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">
                Hourly particulate series unavailable for this location.
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900">Monitoring Location &amp; Weather</h2>
            {data.weather?.current && (
              <span className="text-xs text-slate-600 font-mono-tabular">
                {data.weather.current.temperatureC ?? '—'}°C · {data.weather.current.weatherLabel}
              </span>
            )}
          </div>
          <LeafletMap
            center={[data.location.latitude, data.location.longitude]}
            zoom={10}
            heightClass="h-52"
            markers={[
              {
                name: data.location.name,
                latitude: data.location.latitude,
                longitude: data.location.longitude,
                subtitle: `AQI: ${data.aqi.aqi ?? 'N/A'} (${data.aqi.category})`,
                color: pinColor,
              },
            ]}
          />
          {data.weather?.current && (
            <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-slate-500 flex items-center gap-1">
                  <Thermometer className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  Temp
                </div>
                <div className="font-semibold font-mono-tabular text-slate-900 mt-0.5">
                  {data.weather.current.temperatureC ?? '—'} °C
                </div>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-slate-500 flex items-center gap-1">
                  <CloudRain className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  Humidity
                </div>
                <div className="font-semibold font-mono-tabular text-slate-900 mt-0.5">
                  {data.weather.current.humidityPct ?? '—'} %
                </div>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-slate-500 flex items-center gap-1">
                  <Compass className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  Wind
                </div>
                <div className="font-semibold font-mono-tabular text-slate-900 mt-0.5">
                  {data.weather.current.windSpeedKmh ?? '—'} km/h
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* EcoAI Auto-Generated Summary & Recommendations + Risk Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#14532D] shrink-0" aria-hidden="true" />
                  <span>EcoAI Environmental Summary &amp; Action Plan</span>
                </h2>
                {aiSummary && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold whitespace-nowrap ${
                      aiSummary.mode === 'gemini'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                  >
                    {aiSummary.modelLabel || (aiSummary.mode === 'gemini' ? 'Gemini 4 Hydrogen' : 'Basic mode')}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {aiSummary?.mode === 'gemini'
                  ? 'Synthesized by Gemini EcoAI from compact backend snapshot'
                  : 'Verified rule-based & fallback environmental synthesis'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleGenerateSummary(true)}
              disabled={aiLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[44px] text-xs font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${aiLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{aiLoading ? 'Generating...' : 'Regenerate'}</span>
            </button>
          </div>

          {aiLoading && !aiSummary ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-5/6" />
              <div className="h-24 bg-slate-100 rounded w-full mt-3" />
            </div>
          ) : aiSummary ? (
            <div className="space-y-4 text-sm">
              {aiSummary.mode === 'rule_based_fallback' && aiSummary.fallbackReason && (
                <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  {aiSummary.fallbackReason}
                </div>
              )}
              <div className="text-slate-700 leading-relaxed">
                <FormattedMarkdown content={aiSummary.summary} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-900">Actions for Current Conditions</h3>
                  <ul className="space-y-1.5 text-xs text-slate-600 list-disc pl-4">
                    {aiSummary.currentActions.map((act, idx) => (
                      <li key={idx}>{act}</li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-900">Preparedness for Predicted Risks</h3>
                  <ul className="space-y-1.5 text-xs text-slate-600 list-disc pl-4">
                    {aiSummary.futureActions.map((act, idx) => (
                      <li key={idx}>{act}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                <span className="font-mono-tabular">Updated {new Date(aiSummary.generatedAt).toLocaleTimeString()}</span>
                <button
                  type="button"
                  onClick={() => onOpenTab('reports')}
                  className="text-[#14532D] font-semibold hover:underline min-h-[36px]"
                >
                  Open Full Inline Report →
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#0F766E] shrink-0" aria-hidden="true" />
              <span>Detected Anomalies &amp; Alerts</span>
            </h2>
            <button
              type="button"
              onClick={() => onOpenTab('alerts')}
              className="min-h-[44px] px-2 text-xs font-medium text-[#14532D] hover:underline whitespace-nowrap"
            >
              All Alerts →
            </button>
          </div>

          {data.anomalies.length === 0 && data.alerts.length === 0 && (data.weather?.warnings.length ?? 0) === 0 ? (
            <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                No abnormal statistical spikes or critical meteorological warnings detected for {data.location.city} in the current window.
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              {data.anomalies.map((anom) => (
                <div key={anom.id} className="p-3 rounded-lg border border-amber-200 bg-amber-50/70 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">{anom.parameter} Statistical Anomaly</span>
                    <StatusBadge
                      level={anom.severity === 'critical' ? 'severe' : anom.severity === 'high' ? 'poor' : 'moderate'}
                      label={anom.severity.toUpperCase()}
                    />
                  </div>
                  <p className="text-xs text-slate-700">{anom.reason}</p>
                  <p className="text-[11px] text-slate-500 font-mono-tabular">
                    Observed: {anom.observedValue} {anom.unit} · Baseline: {anom.baselineValue} {anom.unit} ({anom.detectionMethod})
                  </p>
                </div>
              ))}
              {data.weather?.warnings.map((w, idx) => (
                <div key={idx} className="p-3 rounded-lg border border-orange-200 bg-orange-50/70 space-y-1">
                  <div className="text-xs font-semibold text-orange-900">{w.title}</div>
                  <p className="text-xs text-orange-800">{w.detail}</p>
                  <p className="text-[11px] text-orange-700">Source: {data.weather?.source}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Connected Environmental Data Sources & Adapter Health Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-[#0F766E] shrink-0" aria-hidden="true" />
              <span>Environmental Data Sources &amp; Adapter Connections</span>
            </h2>
            <p className="text-xs text-slate-500">
              All 8 providers use normalized telemetry schemas with a 10-minute server cache and automatic resilient fallbacks.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenTab('profile')}
            className="min-h-[44px] px-3 py-2 text-xs font-medium text-[#14532D] border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
          >
            API Key Setup Guide →
          </button>
        </div>

        {/* Status Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600">
          <span className="font-semibold text-slate-700">Status legend:</span>
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge level="good" label="Live" />
            <span>Provider API responded directly</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge level="moderate" label="Fallback" />
            <span>Key missing or unavailable; served by named backup provider</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge level="sample" label="Sample data" />
            <span>Reference dataset (no public live feed)</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge level="severe" label="Error" />
            <span>All sources failed</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 text-[11px] font-mono-tabular">
              cached · 0m ago
            </span>
            <span>Served from 10-min cache</span>
          </span>
        </div>

        {/* Mobile stacked cards (< md) */}
        <div className="md:hidden space-y-3">
          {sources.map((src) => {
            const topReading = src.readings[0];
            const viaLabel =
              topReading?.viaSource ||
              (src.status === 'Fallback' ? src.fallbackProvider : undefined);
            return (
              <div key={src.id} className="border border-slate-200 rounded-lg p-3.5 space-y-2.5 text-xs">
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{src.name}</div>
                      <div className="text-slate-500 capitalize">{src.category}</div>
                    </div>
                  </div>
                  <div>{renderSourceStatus(src)}</div>
                </div>
                {topReading && (
                  <div className="text-slate-700">
                    <div className="font-mono-tabular">
                      {topReading.metric}: <strong>{topReading.value ?? '—'} {topReading.unit}</strong>
                    </div>
                    {viaLabel && (
                      <div className="text-[11px] text-slate-500 mt-0.5">via {viaLabel}</div>
                    )}
                  </div>
                )}
                {src.fallbackDescription && <div className="text-[11px] text-slate-500">{src.fallbackDescription}</div>}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                  <span className="text-[11px] text-slate-500 font-mono-tabular">
                    {src.lastUpdated ? new Date(src.lastUpdated).toLocaleTimeString() : '—'}
                  </span>
                  <button
                    type="button"
                    disabled={testingSourceId === src.id}
                    onClick={() => void handleTestSourceConnection(src.id)}
                    className="min-h-[44px] px-3 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    {testingSourceId === src.id ? 'Testing...' : 'Test connection'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Tablet/Desktop Scrollable Table (md+) */}
        <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-3 px-4">Provider</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Latest Normalized Metric</th>
                <th className="py-3 px-4">Last Updated</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sources.map((src) => {
                const topReading = src.readings[0];
                const viaLabel =
                  topReading?.viaSource ||
                  (src.status === 'Fallback' ? src.fallbackProvider : undefined);
                return (
                  <tr key={src.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{src.name}</div>
                      {src.fallbackDescription && (
                        <div className="text-[11px] text-slate-500 max-w-md">{src.fallbackDescription}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 capitalize text-slate-700">{src.category}</td>
                    <td className="py-3 px-4">{renderSourceStatus(src)}</td>
                    <td className="py-3 px-4 text-slate-700">
                      {topReading ? (
                        <div>
                          <div className="font-mono-tabular">
                            {topReading.metric}: {topReading.value ?? '—'} {topReading.unit}
                          </div>
                          {viaLabel && (
                            <div className="text-[11px] text-slate-500 mt-0.5">via {viaLabel}</div>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-slate-500 whitespace-nowrap">
                      {src.lastUpdated ? new Date(src.lastUpdated).toLocaleTimeString() : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        disabled={testingSourceId === src.id}
                        onClick={() => void handleTestSourceConnection(src.id)}
                        className="min-h-[38px] px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                      >
                        {testingSourceId === src.id ? 'Testing...' : 'Test connection'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
