import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Database, HelpCircle, ShieldAlert } from 'lucide-react';

export type SeverityLevel = 'good' | 'moderate' | 'poor' | 'severe' | 'sample' | 'unavailable';

interface StatusBadgeProps {
  level: SeverityLevel;
  label: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ level, label }) => {
  const styles: Record<SeverityLevel, { wrap: string; Icon: React.FC<{ className?: string }> }> = {
    good: {
      wrap: 'text-emerald-800 bg-emerald-50 border-emerald-200',
      Icon: CheckCircle2,
    },
    moderate: {
      wrap: 'text-amber-800 bg-amber-50 border-amber-200',
      Icon: AlertCircle,
    },
    poor: {
      wrap: 'text-orange-800 bg-orange-50 border-orange-200',
      Icon: AlertTriangle,
    },
    severe: {
      wrap: 'text-red-800 bg-red-50 border-red-200',
      Icon: ShieldAlert,
    },
    sample: {
      wrap: 'text-sky-800 bg-sky-50 border-sky-200',
      Icon: Database,
    },
    unavailable: {
      wrap: 'text-slate-600 bg-slate-100 border-slate-200',
      Icon: HelpCircle,
    },
  };

  const { wrap, Icon } = styles[level] ?? styles.unavailable;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium whitespace-nowrap ${wrap}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
};

export function originLabelText(origin: string): string {
  switch (origin) {
    case 'live':
      return 'Live Measurement';
    case 'latest_available':
      return 'Latest Available';
    case 'historical':
      return 'Historical Record';
    case 'uploaded':
      return 'Uploaded Dataset';
    case 'estimated':
      return 'Estimated';
    case 'predicted':
      return 'Forecast / Predicted';
    case 'sample_reference':
      return 'Sample Reference (Not Live)';
    default:
      return 'Verified Record';
  }
}
