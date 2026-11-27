import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, TrendingUp, Wind } from 'lucide-react';
import { OverviewPayload } from '../../types/env';
import { originLabelText, StatusBadge } from '../StatusBadge';

interface AirQualityModuleProps {
  data: OverviewPayload | null;
  pastDays: number;
  onChangePastDays: (days: number) => void;
}

export const AirQualityModule: React.FC<AirQualityModuleProps> = ({ data, pastDays, onChangePastDays }) => {
  const [granularity, setGranularity] = useState<'hourly' | 'daily'>('hourly');

  const chartData = useMemo(() => {
    if (!data) return [];
    if (granularity === 'hourly') {
      return data.airHourly.slice(-48).map((h) => ({
        label: h.timestamp.slice(5, 16).replace('T', ' '),
        pm25: h.pm25,
        pm10: h.pm10,
        no2: h.no2,
        o3: h.o3,
      }));
    }
    const byDay = new Map<string, { pm25: number[]; pm10: number[]; no2: number[]; o3: number[] }>();
    for (const h of data.airHourly) {
      const day = h.timestamp.slice(0, 10);
      const bucket = byDay.get(day) ?? { pm25: [], pm10: [], no2: [], o3: [] };
      if (h.pm25 !== null) bucket.pm25.push(h.pm25);
      if (h.pm10 !== null) bucket.pm10.push(h.pm10);
      if (h.no2 !== null) bucket.no2.push(h.no2);
      if (h.o3 !== null) bucket.o3.push(h.o3);
      byDay.set(day, bucket);
    }
    const avg = (arr: number[]) => (arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null);
    return Array.from(byDay.entries()).map(([day, b]) => ({
      label: day,
      pm25: avg(b.pm25),
      pm10: avg(b.pm10),
      no2: avg(b.no2),
      o3: avg(b.o3),
    }));
  }, [data, granularity]);

  // 7-day x 4-hour block heatmap matrix for PM2.5 intensity
  const heatmapRows = useMemo(() => {
    if (!data) return [];
    const daysMap = new Map<string, Array<number | null>>();
    for (const h of data.airHourly) {
      const day = h.timestamp.slice(0, 10);
      const hour = Number(h.timestamp.slice(11, 13));
      const slot = Math.floor(hour / 4); // 0..5
      const row = daysMap.get(day) ?? [null, null, null, null, null, null];
      if (h.pm25 !== null) {
        row[slot] = row[slot] === null ? h.pm25 : Number((((row[slot] as number) + h.pm25) / 2).toFixed(1));
      }
      daysMap.set(day, row);
    }
    return Array.from(daysMap.entries()).slice(-7);
  }, [data]);

  if (!data) {
    return <div className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">Select a location to load air quality data.</div>;
  }

  const { aqi } = data;
  const forecast24h = data.forecasts.pm25_24h;
  const forecast7d = data.forecasts.pm25_7d;

  return (
    <div className="space-y-6">
      {/* Top AQI Hero Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{aqi.standardName}</span>
            <span aria-hidden="true">·</span>
            <span>{originLabelText(aqi.originType)}</span>
            <span aria-hidden="true">·</span>
            <span>Station: {aqi.station}</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-4xl font-bold text-slate-900 font-mono-tabular">{aqi.aqi ?? 'Unavailable'}</span>
            <StatusBadge level={aqi.severityLevel} label={aqi.category} />
            {aqi.dominantPollutant && (
              <span className="text-xs text-slate-600">
                Dominant Pollutant: <strong className="text-slate-900">{aqi.dominantPollutant}</strong>
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 max-w-2xl">{aqi.healthGuidance}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-xs text-slate-500 mr-1">History Window:</span>
          {[1, 7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChangePastDays(d)}
              className={`min-h-[44px] sm:min-h-[34px] px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                pastDays === d
                  ? 'bg-[#14532D] text-white border-[#14532D]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {d === 1 ? '24h' : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {/* Individual Pollutant Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {aqi.pollutants.map((p) => (
          <div key={p.parameter} className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold text-slate-800">{p.parameter}</span>
              <Wind className="w-3.5 h-3.5 text-[#0F766E]" aria-hidden="true" />
            </div>
            <div className="text-xl font-bold text-slate-900 font-mono-tabular">
              {p.value !== null ? p.value : '—'}
              <span className="text-[11px] font-normal text-slate-500 ml-1">{p.unit}</span>
            </div>
            <div className="text-[11px] text-slate-500 font-mono-tabular">
              Sub-Index: {p.subIndex !== null ? p.subIndex : 'N/A'}
            </div>
          </div>
        ))}
      </div>

      {/* Pollutant Trend Chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Historical Pollutant Concentration Trends</h2>
            <p className="text-xs text-slate-500">Measured &amp; modeled hourly/daily series (µg/m³) · {aqi.source}</p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setGranularity('hourly')}
              className={`min-h-[44px] sm:min-h-[32px] px-3 py-1 text-xs font-medium rounded-md ${
                granularity === 'hourly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Hourly
            </button>
            <button
              type="button"
              onClick={() => setGranularity('daily')}
              className={`min-h-[44px] sm:min-h-[32px] px-3 py-1 text-xs font-medium rounded-md ${
                granularity === 'daily' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Daily Mean
            </button>
          </div>
        </div>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
              <Tooltip />
              <Line type="monotone" dataKey="pm25" name="PM2.5" stroke="#14532D" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="pm10" name="PM10" stroke="#0F766E" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="no2" name="NO2" stroke="#D97706" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="o3" name="O3" stroke="#2563EB" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Heatmap & Forecasts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">PM2.5 Pollution Intensity Matrix (4-Hour Blocks)</h2>
            <p className="text-xs text-slate-500">Identifies recurring diurnal pollution peaks (µg/m³)</p>
          </div>
          {heatmapRows.length === 0 ? (
            <p className="text-xs text-slate-500">Insufficient hourly data for intensity matrix.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-center border-collapse">
                <thead>
                  <tr className="text-slate-500">
                    <th className="py-1.5 text-left font-medium">Date</th>
                    {['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'].map((slot) => (
                      <th key={slot} className="py-1.5 font-medium font-mono-tabular">
                        {slot}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmapRows.map(([day, slots]) => (
                    <tr key={day} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2 text-left font-mono-tabular text-slate-700">{day}</td>
                      {slots.map((val, idx) => {
                        const cls =
                          val === null
                            ? 'bg-slate-100 text-slate-400'
                            : val <= 30
                              ? 'bg-emerald-100 text-emerald-900'
                              : val <= 60
                                ? 'bg-amber-100 text-amber-900'
                                : val <= 120
                                  ? 'bg-orange-200 text-orange-950'
                                  : 'bg-red-200 text-red-950';
                        return (
                          <td key={idx} className="p-0.5">
                            <div className={`py-1.5 rounded font-mono-tabular ${cls}`}>
                              {val !== null ? val.toFixed(0) : '—'}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#14532D]" aria-hidden="true" />
                <span>Forecast / Predicted PM2.5 Outlook</span>
              </h2>
              <p className="text-xs text-slate-500">Statistical projection clearly separated from measured readings</p>
            </div>
            <StatusBadge level="moderate" label="Forecast / Predicted" />
          </div>

          {!data.forecasts.enabled ? (
            <p className="text-xs text-slate-500">Forecasting is currently disabled by administrator policy.</p>
          ) : forecast24h && forecast24h.sufficientData ? (
            <div className="space-y-3">
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={forecast24h.points.slice(0, 12).map((pt) => ({
                      time: pt.timestamp.slice(11, 16),
                      predicted: pt.predictedValue,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="predicted" name="Predicted PM2.5 (µg/m³)" fill="#0F766E" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-xs text-slate-600 space-y-1">
                <div>
                  <strong>Model:</strong> {forecast24h.modelUsed}
                </div>
                {forecast24h.validationMetrics && (
                  <div className="font-mono-tabular">
                    Holdout Validation: MAE={forecast24h.validationMetrics.mae} · RMSE={forecast24h.validationMetrics.rmse} · MAPE={forecast24h.validationMetrics.mape}%
                  </div>
                )}
                <div className="text-[11px] text-slate-500">{forecast24h.limitations}</div>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{forecast24h?.insufficiencyReason || forecast7d?.insufficiencyReason || 'Insufficient historical observations for forecasting.'}</span>
            </div>
          )}
        </div>
      </div>

      {/* OpenAQ Nearby Ground Stations if configured */}
      {data.openAqStations.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Nearby OpenAQ v3 Reference Stations</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            {data.openAqStations.map((st) => (
              <div key={st.id} className="p-3 border border-slate-200 rounded-lg">
                <div className="font-semibold text-slate-900">{st.name}</div>
                <div className="text-slate-500">
                  {st.locality || 'Station'} {st.distanceKm ? `· ${st.distanceKm} km away` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
