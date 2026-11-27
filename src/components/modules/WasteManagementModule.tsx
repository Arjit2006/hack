import React, { useEffect, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, FileSpreadsheet, Recycle } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { GeoLocation, WmiCalculationResult } from '../../types/env';
import { originLabelText, StatusBadge } from '../StatusBadge';
import { useToast } from '../ToastProvider';

interface WasteManagementModuleProps {
  location: GeoLocation;
  initialWmi: WmiCalculationResult | null;
  onDatasetUploaded: () => void;
}

const PIE_COLORS = ['#14532D', '#0F766E', '#D97706', '#DC2626'];

export const WasteManagementModule: React.FC<WasteManagementModuleProps> = ({ location, initialWmi, onDatasetUploaded }) => {
  const [unit, setUnit] = useState<'tonnes/day' | 'tonnes/month' | 'tonnes/year'>('tonnes/day');
  const [fields, setFields] = useState({
    totalGenerated: '',
    collected: '',
    segregated: '',
    recycledOrRecovered: '',
    treatedNonRecycling: '',
    safelyDisposed: '',
    unmanaged: '',
    population: location.population ? String(location.population) : '',
    importExplanation: '',
  });
  const [dataOrigin, setDataOrigin] = useState<'uploaded' | 'sample_reference'>('uploaded');
  const [result, setResult] = useState<WmiCalculationResult | null>(initialWmi);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    setResult(initialWmi);
  }, [initialWmi]);

  const loadSampleReference = () => {
    setDataOrigin('sample_reference');
    setUnit('tonnes/day');
    setFields({
      totalGenerated: '1000',
      collected: '880',
      segregated: '560',
      recycledOrRecovered: '260',
      treatedNonRecycling: '310',
      safelyDisposed: '290',
      unmanaged: '140',
      population: location.population ? String(location.population) : '1500000',
      importExplanation: '',
    });
  };

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSaveMsg(null);

    const numOrNull = (s: string) => {
      const t = s.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    };

    try {
      const res = await fetch('/api/calc/wmi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalGenerated: numOrNull(fields.totalGenerated),
          collected: numOrNull(fields.collected),
          segregated: numOrNull(fields.segregated),
          recycledOrRecovered: numOrNull(fields.recycledOrRecovered),
          treatedNonRecycling: numOrNull(fields.treatedNonRecycling),
          safelyDisposed: numOrNull(fields.safelyDisposed),
          unmanaged: numOrNull(fields.unmanaged),
          unit,
          population: numOrNull(fields.population),
          importExplanation: fields.importExplanation || undefined,
          dataOrigin,
        }),
      });
      const json = (await res.json()) as { result?: WmiCalculationResult; error?: string };
      if (!res.ok || !json.result) throw new Error(json.error || 'WMI calculation failed');
      setResult(json.result);

      if (auth.currentUser?.emailVerified && json.result.wmi !== null) {
        try {
          await addDoc(collection(db, 'wmiResults'), {
            userId: auth.currentUser.uid,
            locationName: location.name,
            methodologyVersion: json.result.methodologyVersion,
            wmi: json.result.wmi,
            classification: json.result.classification,
            completenessPct: json.result.completenessPct,
            isProvisional: json.result.isProvisional,
            massBalanceDiscrepancyPct: json.result.massBalanceDiscrepancyPct ?? 0,
            calculatedAt: json.result.calculatedAt,
          });
          setSaveMsg('WMI calculation archived to your Firestore history.');
        } catch (fsErr) {
          handleFirestoreError(fsErr, OperationType.CREATE, 'wmiResults');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WMI calculation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus('Parsing & validating waste dataset...');
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
          category: 'waste',
          locationName: location.name,
          base64Content: btoa(binary),
        }),
      });
      const json = (await res.json()) as { insertedCount?: number; rejectedRows?: number; error?: string };
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setUploadStatus(`Imported ${json.insertedCount ?? 0} verified waste records (${json.rejectedRows ?? 0} rejected).`);
      showToast({ type: 'success', title: 'Waste Dataset Imported', message: `Imported ${json.insertedCount ?? 0} verified waste-flow records.` });
      onDatasetUploaded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setUploadStatus(msg);
      showToast({ type: 'error', title: 'Upload Failed', message: msg });
    }
  };

  const pieData = [
    { name: 'Recycled / Recovered', value: Number(fields.recycledOrRecovered) || 0 },
    { name: 'Treated (Non-Recycling)', value: Number(fields.treatedNonRecycling) || 0 },
    { name: 'Safely Disposed', value: Number(fields.safelyDisposed) || 0 },
    { name: 'Unmanaged', value: Number(fields.unmanaged) || 0 },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Recycle className="w-5 h-5 text-[#14532D]" aria-hidden="true" />
            <span>EcoIntelligence Waste Management Index (WMI)</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Proposed 0–100 composite performance index (not an official universal standard). Higher WMI = Better waste management performance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadSampleReference}
            className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
          >
            Load Sample Reference (Not Live)
          </button>
          <label className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#14532D] hover:bg-[#166534] rounded-lg cursor-pointer">
            <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Upload CSV/Excel</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={handleFileUpload} />
          </label>
        </div>
      </div>

      {uploadStatus && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900">{uploadStatus}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleCalculate} className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="wmi-unit" className="block text-xs font-medium text-slate-700 mb-1">
                Reporting Unit
              </label>
              <select
                id="wmi-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as typeof unit)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="tonnes/day">tonnes / day</option>
                <option value="tonnes/month">tonnes / month</option>
                <option value="tonnes/year">tonnes / year</option>
              </select>
            </div>
            <div>
              <label htmlFor="wmi-pop" className="block text-xs font-medium text-slate-700 mb-1">
                Population (Optional)
              </label>
              <input
                id="wmi-pop"
                type="number"
                value={fields.population}
                onChange={(e) => setFields({ ...fields, population: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'totalGenerated', label: 'Total Waste Generated *' },
              { key: 'collected', label: 'Waste Collected' },
              { key: 'segregated', label: 'Correctly Segregated' },
              { key: 'recycledOrRecovered', label: 'Recycled / Recovered' },
              { key: 'treatedNonRecycling', label: 'Treated (Non-Recycling)' },
              { key: 'safelyDisposed', label: 'Residual Safely Disposed' },
              { key: 'unmanaged', label: 'Unmanaged / Open Dumped' },
            ].map((item) => (
              <div key={item.key}>
                <label htmlFor={`wmi-${item.key}`} className="block text-xs text-slate-600 mb-1">
                  {item.label}
                </label>
                <input
                  id={`wmi-${item.key}`}
                  type="number"
                  step="any"
                  placeholder="Missing"
                  value={fields[item.key as keyof typeof fields]}
                  onChange={(e) => {
                    setDataOrigin('uploaded');
                    setFields({ ...fields, [item.key]: e.target.value });
                  }}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg font-mono-tabular"
                />
              </div>
            ))}
          </div>

          {error && <div className="p-2.5 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg">{error}</div>}
          {saveMsg && <div className="p-2.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">{saveMsg}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] py-2.5 px-4 text-sm font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] disabled:opacity-50"
          >
            {loading ? 'Calculating WMI...' : 'Calculate & Validate WMI'}
          </button>
        </form>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          {!result ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 space-y-2 text-slate-500">
              <Recycle className="w-8 h-8 text-slate-300" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700">No waste-flow dataset loaded for {location.city}</p>
              <p className="text-xs max-w-md">
                Enter waste stream quantities on the left, upload a municipal CSV/Excel file, or load the illustrative sample reference.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{originLabelText(result.dataOrigin)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{result.methodologyVersion}</span>
                    <span aria-hidden="true">·</span>
                    <span>Coverage: {result.completenessPct}%</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-3xl font-bold text-slate-900 font-mono-tabular">{result.wmi ?? '—'}</span>
                    <StatusBadge
                      level={result.severityLevel}
                      label={result.isProvisional ? `${result.classification} (Provisional)` : result.classification}
                    />
                  </div>
                  <p className="text-xs text-slate-600 mt-1">{result.noteDirection} · {result.methodologyNote}</p>
                </div>
                {result.perCapitaKgPerDay !== null && (
                  <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                    <div className="text-slate-500">Per Capita Generation</div>
                    <div className="font-bold font-mono-tabular text-slate-900">{result.perCapitaKgPerDay} kg/person/day</div>
                  </div>
                )}
              </div>

              {result.validationWarnings.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1 text-xs text-amber-900">
                  {result.validationWarnings.map((w, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={result.components.map((c) => ({
                        name: c.label.split(' ')[0],
                        score: c.score ?? 0,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="score" name="Component Score (%)" fill="#14532D" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-52">
                  {pieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={72} paddingAngle={2}>
                          {pieData.map((_, idx) => (
                            <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      Enter destination flows for composition chart
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Component</th>
                      <th className="py-2 px-3 text-right">Weight</th>
                      <th className="py-2 px-3 text-right">Score (%)</th>
                      <th className="py-2 px-3 text-right">Contribution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.components.map((c) => (
                      <tr key={c.key}>
                        <td className="py-2 px-3 font-medium text-slate-800">{c.label}</td>
                        <td className="py-2 px-3 text-right font-mono-tabular">{(c.weight * 100).toFixed(0)}%</td>
                        <td className="py-2 px-3 text-right font-mono-tabular">{c.score !== null ? `${c.score}%` : 'Missing'}</td>
                        <td className="py-2 px-3 text-right font-mono-tabular font-semibold">{c.weightedContribution ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1">
                <div className="font-semibold text-slate-900">
                  Weakest Component: {result.weakestComponent || 'N/A'}
                </div>
                <ul className="list-disc pl-4 space-y-1">
                  {result.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
