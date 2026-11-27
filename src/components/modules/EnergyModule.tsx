import React, { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FileSpreadsheet, Lightbulb, Zap } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { GeoLocation, OverviewPayload } from '../../types/env';
import { StatusBadge } from '../StatusBadge';

interface EnergyModuleProps {
  location: GeoLocation;
  data: OverviewPayload | null;
  onDatasetUploaded: () => void;
}

export const EnergyModule: React.FC<EnergyModuleProps> = ({ location, data, onDatasetUploaded }) => {
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const wb = data?.energy.worldBank;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus('Parsing & validating energy dataset...');
    try {
      const token = await auth.currentUser?.getIdToken();
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const res = await fetch('/api/env/upload-dataset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fileName: file.name,
          category: 'energy',
          locationName: location.name,
          base64Content: btoa(binary),
        }),
      });
      const json = (await res.json()) as { insertedCount?: number; rejectedRows?: number; error?: string };
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setUploadStatus(`Imported ${json.insertedCount ?? 0} verified energy records (${json.rejectedRows ?? 0} rejected).`);
      onDatasetUploaded();
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const mergedSeries = (wb?.renewableShareSeries ?? []).map((pt) => {
    const elec = wb?.electricityPerCapitaSeries.find((e) => e.year === pt.year)?.value ?? null;
    const fossil = wb?.fossilShareSeries.find((f) => f.year === pt.year)?.value ?? null;
    return {
      year: String(pt.year),
      renewablePct: pt.value,
      fossilPct: fossil,
      electricityKwh: elec,
    };
  });

  // Estimate carbon intensity proxy only when fossil share exists (explicitly labeled as Estimate)
  const latestFossil = wb?.fossilShareSeries[wb.fossilShareSeries.length - 1]?.value ?? null;
  const estGridCarbonFactorKgPerKwh =
    latestFossil !== null ? Number(((latestFossil / 100) * 0.85).toFixed(3)) : null;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Zap className="w-5 h-5 text-[#0F766E]" aria-hidden="true" />
            <span>Energy Consumption &amp; Renewable Energy Monitoring</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Country-level verified historical series from World Bank Open Data API ({wb?.countryName || location.countryCode}), plus local utility CSV/Excel import.
          </p>
        </div>
        <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#0F766E] hover:bg-[#0D9488] rounded-lg cursor-pointer shrink-0">
          <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Upload Local Energy CSV/Excel</span>
          <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={handleFileUpload} />
        </label>
      </div>

      {uploadStatus && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900">{uploadStatus}</div>}

      {/* Metric Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-500">Renewable Energy Share</div>
          <div className="text-2xl font-bold text-slate-900 font-mono-tabular">
            {wb?.latestRenewablePct !== null && wb?.latestRenewablePct !== undefined ? `${wb.latestRenewablePct}%` : 'Unavailable'}
          </div>
          <div className="text-[11px] text-slate-500">
            Historical ({wb?.latestRenewableYear || 'N/A'}) · World Bank
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-500">Electricity Per Capita</div>
          <div className="text-2xl font-bold text-slate-900 font-mono-tabular">
            {wb?.latestElectricityKwhPerCapita ? `${wb.latestElectricityKwhPerCapita} kWh` : 'Unavailable'}
          </div>
          <div className="text-[11px] text-slate-500">
            Historical ({wb?.latestElectricityYear || 'N/A'}) · World Bank
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-500">Estimated Grid Emission Factor</div>
          <div className="text-2xl font-bold text-slate-900 font-mono-tabular">
            {estGridCarbonFactorKgPerKwh !== null ? `${estGridCarbonFactorKgPerKwh} kg CO₂/kWh` : 'Unavailable'}
          </div>
          <div className="text-[11px] text-slate-500">
            Estimated from fossil share ({latestFossil ?? '—'}%)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="text-xs text-slate-500">Ember Electricity Feed</div>
          <StatusBadge
            level={
              data?.energy.ember?.status === 'Live'
                ? 'good'
                : data?.energy.ember?.status === 'Error'
                  ? 'severe'
                  : 'moderate'
            }
            label={
              data?.energy.ember?.status === 'Fallback'
                ? 'Fallback: World Bank'
                : data?.energy.ember?.status ?? 'Fallback: World Bank'
            }
          />
          <div className="text-[11px] text-slate-600">
            {data?.energy.ember?.latestGenerationTwh !== null && data?.energy.ember?.latestGenerationTwh !== undefined
              ? `${data.energy.ember.latestGenerationTwh} TWh (${data.energy.ember.period ?? 'Latest'}) · Ember`
              : 'Fallback: World Bank Open Data electricity & renewable share indicators.'}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Renewable vs Fossil Fuel Energy Share (%)</h3>
          <div className="h-64">
            {mergedSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mergedSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="renewablePct" name="Renewable (%)" stroke="#14532D" fill="#14532D" fillOpacity={0.18} />
                  <Area type="monotone" dataKey="fossilPct" name="Fossil (%)" stroke="#D97706" fill="#D97706" fillOpacity={0.1} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No national energy series returned for {location.countryCode}.
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Electricity Consumption Per Capita (kWh)</h3>
          <div className="h-64">
            {mergedSeries.some((s) => s.electricityKwh !== null) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mergedSeries.filter((s) => s.electricityKwh !== null)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="electricityKwh" name="kWh per capita" fill="#0F766E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Per-capita electricity data unavailable for recent years in World Bank feed.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-[#14532D]" aria-hidden="true" />
          <span>Practical Energy &amp; Decarbonization Recommendations</span>
        </h3>
        <ul className="text-xs text-slate-600 list-disc pl-5 space-y-1.5">
          <li>Shift high-load residential and municipal pumping schedules outside peak evening demand windows to lower fossil peaking generation.</li>
          <li>Deploy rooftop solar PV with net metering for public buildings and schools to raise local renewable contribution above {wb?.latestRenewablePct ?? 20}%.</li>
          <li>Upload monthly municipal feeder kWh datasets via CSV/Excel above to detect building-level consumption spikes and calculate exact city emissions.</li>
        </ul>
      </div>
    </div>
  );
};
