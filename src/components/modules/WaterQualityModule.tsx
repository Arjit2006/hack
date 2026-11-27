import React, { useEffect, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import { AlertTriangle, CheckCircle2, Droplets, FileSpreadsheet, ShieldAlert } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { GeoLocation, WqiCalculationResult } from '../../types/env';
import { originLabelText, StatusBadge } from '../StatusBadge';
import { useToast } from '../ToastProvider';

interface WaterQualityModuleProps {
  location: GeoLocation;
  initialWqi: WqiCalculationResult | null;
  onDatasetUploaded: () => void;
}

type WaterUse = 'drinking' | 'bathing' | 'surface' | 'irrigation' | 'ecosystem';

export const WaterQualityModule: React.FC<WaterQualityModuleProps> = ({ location, initialWqi, onDatasetUploaded }) => {
  const [waterUse, setWaterUse] = useState<WaterUse>('drinking');
  const [temperatureC, setTemperatureC] = useState<string>('25');
  const [salinityPpt, setSalinityPpt] = useState<string>('0');
  const [inputs, setInputs] = useState<Record<string, string>>({
    ph: '',
    do: '',
    bod: '',
    cod: '',
    tds: '',
    turbidity: '',
    nitrate: '',
    coliform: '',
  });
  const [dataOrigin, setDataOrigin] = useState<'uploaded' | 'sample_reference'>('uploaded');
  const [result, setResult] = useState<WqiCalculationResult | null>(initialWqi);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Water usage & wastage analyzer state
  const [dailyConsumptionMl, setDailyConsumptionMl] = useState<string>('');
  const [dailyWastageMl, setDailyWastageMl] = useState<string>('');
  const [populationServed, setPopulationServed] = useState<string>(location.population ? String(location.population) : '');

  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    setResult(initialWqi);
  }, [initialWqi]);

  const loadSampleReference = () => {
    setDataOrigin('sample_reference');
    setTemperatureC('26');
    setSalinityPpt('0.2');
    setInputs({
      ph: '7.4',
      do: '6.4',
      bod: '2.8',
      cod: '14',
      tds: '380',
      turbidity: '2.2',
      nitrate: '18',
      coliform: '120',
    });
  };

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSaveMessage(null);

    const parseNum = (val: string) => {
      const t = val.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    };

    try {
      const res = await fetch('/api/calc/wqi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waterUse,
          temperatureC: parseNum(temperatureC) ?? 25,
          salinityPpt: parseNum(salinityPpt) ?? 0,
          dataOrigin,
          inputs: {
            ph: parseNum(inputs.ph),
            do: parseNum(inputs.do),
            bod: parseNum(inputs.bod),
            cod: parseNum(inputs.cod),
            tds: parseNum(inputs.tds),
            turbidity: parseNum(inputs.turbidity),
            nitrate: parseNum(inputs.nitrate),
            coliform: parseNum(inputs.coliform),
          },
        }),
      });
      const json = (await res.json()) as { result?: WqiCalculationResult; error?: string };
      if (!res.ok || !json.result) throw new Error(json.error || 'WQI calculation failed');
      setResult(json.result);

      // Persist calculation history to Firestore when verified user is signed in
      if (auth.currentUser?.emailVerified && json.result.wqi !== null) {
        try {
          await addDoc(collection(db, 'wqiResults'), {
            userId: auth.currentUser.uid,
            locationName: location.name,
            waterUse: json.result.waterUse,
            standardName: json.result.standardName,
            standardVersion: json.result.standardVersion,
            method: json.result.methodology,
            wqi: json.result.wqi,
            classification: json.result.classification,
            completenessPct: json.result.completenessPct,
            isProvisional: json.result.isProvisional,
            microbiologicalAlert: json.result.microbiologicalAlert,
            calculatedAt: json.result.calculatedAt,
          });
          setSaveMessage('WQI calculation archived to your Firestore history.');
        } catch (fsErr) {
          handleFirestoreError(fsErr, OperationType.CREATE, 'wqiResults');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calculation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus('Parsing & validating file...');
    try {
      const token = await auth.currentUser?.getIdToken();
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64Content = btoa(binary);

      const res = await fetch('/api/env/upload-dataset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fileName: file.name,
          category: 'water',
          locationName: location.name,
          base64Content,
        }),
      });
      const json = (await res.json()) as { insertedCount?: number; rejectedRows?: number; error?: string };
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setUploadStatus(`Imported ${json.insertedCount ?? 0} verified records (${json.rejectedRows ?? 0} rejected).`);
      showToast({ type: 'success', title: 'Water Dataset Imported', message: `Imported ${json.insertedCount ?? 0} verified water quality records.` });
      onDatasetUploaded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setUploadStatus(msg);
      showToast({ type: 'error', title: 'Upload Failed', message: msg });
    }
  };

  const consVal = Number(dailyConsumptionMl);
  const wasteVal = Number(dailyWastageMl);
  const popVal = Number(populationServed);
  const wastagePct = consVal > 0 && wasteVal >= 0 ? Number(((wasteVal / consVal) * 100).toFixed(1)) : null;
  const lpcd = consVal > 0 && popVal > 0 ? Number(((consVal * 1_000_000) / popVal).toFixed(1)) : null;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Droplets className="w-5 h-5 text-[#0F766E]" aria-hidden="true" />
            <span>Water Quality &amp; Weighted Arithmetic WQI (WAWQI)</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Select intended water use before evaluation. Missing parameters are never treated as zero; microbiological coliform limits are flagged independently.
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
          <label className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#0F766E] hover:bg-[#0D9488] rounded-lg cursor-pointer">
            <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Upload CSV/Excel</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={handleFileUpload} />
          </label>
        </div>
      </div>

      {uploadStatus && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900">{uploadStatus}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* WAWQI Input Form */}
        <form onSubmit={handleCalculate} className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <label htmlFor="water-use-select" className="block text-xs font-semibold text-slate-800 mb-1">
              Intended Water Use Standard
            </label>
            <select
              id="water-use-select"
              value={waterUse}
              onChange={(e) => setWaterUse(e.target.value as WaterUse)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#14532D]"
            >
              <option value="drinking">Drinking Water (BIS IS 10500 / WHO)</option>
              <option value="bathing">Bathing / Recreation (CPCB Class B)</option>
              <option value="surface">Surface Water (CPCB Class D)</option>
              <option value="irrigation">Irrigation (CPCB Class E / FAO)</option>
              <option value="ecosystem">Aquatic Ecosystem Monitoring</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="water-temp" className="block text-xs text-slate-600 mb-1">
                Sample Temp (°C)
              </label>
              <input
                id="water-temp"
                type="number"
                step="0.1"
                value={temperatureC}
                onChange={(e) => setTemperatureC(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg font-mono-tabular"
              />
            </div>
            <div>
              <label htmlFor="water-sal" className="block text-xs text-slate-600 mb-1">
                Salinity (ppt)
              </label>
              <input
                id="water-sal"
                type="number"
                step="0.1"
                value={salinityPpt}
                onChange={(e) => setSalinityPpt(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg font-mono-tabular"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'ph', label: 'pH (units)' },
              { key: 'do', label: 'Dissolved O2 (mg/L)' },
              { key: 'bod', label: 'BOD (mg/L)' },
              { key: 'cod', label: 'COD (mg/L)' },
              { key: 'tds', label: 'TDS (mg/L)' },
              { key: 'turbidity', label: 'Turbidity (NTU)' },
              { key: 'nitrate', label: 'Nitrate (mg/L)' },
              { key: 'coliform', label: 'Total Coliform (MPN)' },
            ].map((field) => (
              <div key={field.key}>
                <label htmlFor={`wqi-${field.key}`} className="block text-xs text-slate-600 mb-1">
                  {field.label}
                </label>
                <input
                  id={`wqi-${field.key}`}
                  type="number"
                  step="any"
                  placeholder="Missing"
                  value={inputs[field.key]}
                  onChange={(e) => {
                    setDataOrigin('uploaded');
                    setInputs({ ...inputs, [field.key]: e.target.value });
                  }}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg font-mono-tabular"
                />
              </div>
            ))}
          </div>

          {error && <div className="p-2.5 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg">{error}</div>}
          {saveMessage && <div className="p-2.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">{saveMessage}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] py-2.5 px-4 text-sm font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] disabled:opacity-50"
          >
            {loading ? 'Calculating WAWQI...' : 'Calculate Transparent WAWQI'}
          </button>
        </form>

        {/* WAWQI Results & Breakdown */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          {!result ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 space-y-2 text-slate-500">
              <Droplets className="w-8 h-8 text-slate-300" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700">No live water quality readings available for {location.city}</p>
              <p className="text-xs max-w-md">
                Enter laboratory measurements on the left, upload a verified CSV/Excel dataset, or click <strong>Load Sample Reference (Not Live)</strong> to test the WAWQI engine.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{originLabelText(result.dataOrigin)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{result.standardName}</span>
                    <span aria-hidden="true">·</span>
                    <span>Completeness: {result.completenessPct}%</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-3xl font-bold text-slate-900 font-mono-tabular">{result.wqi ?? '—'}</span>
                    <StatusBadge
                      level={result.severityLevel}
                      label={result.isProvisional ? `${result.classification} (Provisional)` : result.classification}
                    />
                  </div>
                  <p className="text-xs text-slate-600 mt-1 font-medium">{result.noteDirection}</p>
                  <p className="text-[11px] text-slate-500">{result.classificationNote}</p>
                </div>
              </div>

              {/* Separate Microbiological Safety Box */}
              {result.microbiologicalMessage && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                    result.microbiologicalAlert
                      ? 'bg-red-50 border-red-200 text-red-900 font-medium'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  {result.microbiologicalAlert ? (
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-700" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" aria-hidden="true" />
                  )}
                  <span>{result.microbiologicalMessage}</span>
                </div>
              )}

              {/* Parameter Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Parameter</th>
                      <th className="py-2 px-3 text-right">Vi</th>
                      <th className="py-2 px-3 text-right">V0 (Ideal)</th>
                      <th className="py-2 px-3 text-right">Si (Limit)</th>
                      <th className="py-2 px-3 text-right">Wi</th>
                      <th className="py-2 px-3 text-right">Qi</th>
                      <th className="py-2 px-3 text-right">Wi×Qi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.breakdown.map((row) => (
                      <tr key={row.key}>
                        <td className="py-2 px-3 font-medium text-slate-800">{row.label}</td>
                        <td className="py-2 px-3 text-right font-mono-tabular">
                          {row.measuredValue !== null ? `${row.measuredValue} ${row.unit}` : 'Missing'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-tabular text-slate-500">{row.idealValue}</td>
                        <td className="py-2 px-3 text-right font-mono-tabular text-slate-500">{row.standardLimit}</td>
                        <td className="py-2 px-3 text-right font-mono-tabular">{row.unitWeight ?? '—'}</td>
                        <td className="py-2 px-3 text-right font-mono-tabular">{row.qualityRatingQi ?? '—'}</td>
                        <td className="py-2 px-3 text-right font-mono-tabular font-semibold">{row.weightedContribution ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1">
                <div className="font-semibold text-slate-900">Recommended Corrective Actions</div>
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

      {/* Water Consumption & Wastage Analysis */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Water Usage, Wastage &amp; Leakage Analysis</h2>
          <p className="text-xs text-slate-500">Evaluate daily consumption, non-revenue water losses, and per-capita supply (LPCD).</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="wu-cons" className="block text-xs font-medium text-slate-700 mb-1">
              Total Daily Consumption (MLD)
            </label>
            <input
              id="wu-cons"
              type="number"
              step="0.1"
              value={dailyConsumptionMl}
              onChange={(e) => setDailyConsumptionMl(e.target.value)}
              placeholder="e.g. 120"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular"
            />
          </div>
          <div>
            <label htmlFor="wu-waste" className="block text-xs font-medium text-slate-700 mb-1">
              Estimated Water Wastage / Leakage (MLD)
            </label>
            <input
              id="wu-waste"
              type="number"
              step="0.1"
              value={dailyWastageMl}
              onChange={(e) => setDailyWastageMl(e.target.value)}
              placeholder="e.g. 24"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular"
            />
          </div>
          <div>
            <label htmlFor="wu-pop" className="block text-xs font-medium text-slate-700 mb-1">
              Population Served
            </label>
            <input
              id="wu-pop"
              type="number"
              value={populationServed}
              onChange={(e) => setPopulationServed(e.target.value)}
              placeholder="e.g. 850000"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular"
            />
          </div>
        </div>
        {wastagePct !== null && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-slate-500">Wastage / Non-Revenue Ratio</div>
              <div className="text-lg font-bold font-mono-tabular text-slate-900 mt-0.5">{wastagePct}%</div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-slate-500">Per-Capita Supply (LPCD)</div>
              <div className="text-lg font-bold font-mono-tabular text-slate-900 mt-0.5">
                {lpcd !== null ? `${lpcd} L/person/day` : 'Population needed'}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2">
              {wastagePct > 20 ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0" aria-hidden="true" />
                  <span className="text-orange-900">Elevated leakage (&gt;20%): prioritize district meter acoustic leak detection.</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                  <span className="text-emerald-900">Distribution losses within standard urban benchmark (&le;20%).</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
