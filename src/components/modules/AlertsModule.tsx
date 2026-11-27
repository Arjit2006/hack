import React, { useState } from 'react';
import { Bell, CheckCheck, ShieldAlert } from 'lucide-react';
import { StatusBadge } from '../StatusBadge';

export interface AlertViewItem {
  id: string;
  locationName: string;
  title: string;
  category: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  measuredValue: string;
  threshold: string;
  source: string;
  explanation: string;
  recommendedAction: string;
  timestamp: string;
  isRead?: boolean;
}

interface AlertsModuleProps {
  alerts: AlertViewItem[];
  onMarkRead: (id: string) => void;
}

export const AlertsModule: React.FC<AlertsModuleProps> = ({ alerts, onMarkRead }) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [pushStatus, setPushStatus] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [emailAlerts, setEmailAlerts] = useState(true);

  const filtered = alerts.filter((a) => {
    if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false;
    return true;
  });

  const requestPush = async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setPushStatus(perm);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Bell className="w-5 h-5 text-[#14532D]" aria-hidden="true" />
            <span>Climate &amp; Environmental Alert Center</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Automated alerts triggered by scheduled ingestion checks, threshold breaches, and official meteorological forecasts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={requestPush}
            className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Browser Push: {pushStatus}
          </button>
          <label className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 text-xs text-slate-700 px-3 py-1.5 border border-slate-200 rounded-lg cursor-pointer">
            <input type="checkbox" checked={emailAlerts} onChange={(e) => setEmailAlerts(e.target.checked)} />
            <span>Email Digest Ready</span>
          </label>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Filter by category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="min-h-[44px] sm:min-h-[36px] px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
        >
          <option value="all">All Categories</option>
          <option value="air">Air Pollution</option>
          <option value="water_quality">Water Quality</option>
          <option value="waste">Waste Management</option>
          <option value="energy">Energy Consumption</option>
          <option value="climate">Climate &amp; Weather</option>
        </select>

        <select
          aria-label="Filter by severity"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="min-h-[44px] sm:min-h-[36px] px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="moderate">Moderate</option>
          <option value="low">Low</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <ShieldAlert className="w-8 h-8 text-slate-300 mx-auto" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-700">No matching alerts</p>
          <p className="text-xs text-slate-500">All monitored indicators matching your filter criteria are currently within baseline thresholds.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <div
              key={a.id}
              className={`bg-white border rounded-xl p-5 space-y-2.5 ${a.isRead ? 'border-slate-200 opacity-80' : 'border-slate-300'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500">
                    {a.locationName} · {a.category.replace('_', ' ')} · <span className="font-mono-tabular">{new Date(a.timestamp).toLocaleString()}</span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mt-0.5">{a.title}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    level={a.severity === 'critical' ? 'severe' : a.severity === 'high' ? 'poor' : a.severity === 'moderate' ? 'moderate' : 'good'}
                    label={a.severity.toUpperCase()}
                  />
                  {!a.isRead && (
                    <button
                      type="button"
                      onClick={() => onMarkRead(a.id)}
                      className="min-h-[44px] sm:min-h-[32px] inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-[#14532D] border border-emerald-200 rounded-md hover:bg-emerald-50"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      Mark Read
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-700">{a.explanation}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px] text-slate-600">
                <div><strong>Measured:</strong> <span className="font-mono-tabular">{a.measuredValue}</span></div>
                <div><strong>Threshold:</strong> <span className="font-mono-tabular">{a.threshold}</span></div>
                <div><strong>Source:</strong> {a.source}</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-700">
                <strong>Recommended Action:</strong> {a.recommendedAction}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
