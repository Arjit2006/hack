import { DEFAULT_WMI_WEIGHTS } from './engines/wmiEngine';
import { AnomalyRecord, AqiResult, GeoLocation, WmiWeights } from './types';

export interface UploadedCategoryRecord {
  id: string;
  locationKey: string;
  locationName: string;
  category: 'air' | 'water' | 'water_usage' | 'waste' | 'energy';
  timestamp: string;
  source: string;
  uploadedBy: string;
  metrics: Record<string, number | string | null>;
}

export interface DatasetImportHistoryItem {
  id: string;
  fileName: string;
  category: string;
  locationName: string;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  warnings: string[];
  uploadedBy: string;
  uploadedAt: string;
}

export interface ServerAlertItem {
  id: string;
  locationName: string;
  title: string;
  category: 'air' | 'water_quality' | 'water_wastage' | 'waste' | 'energy' | 'climate' | 'future_risk';
  severity: 'low' | 'moderate' | 'high' | 'critical';
  measuredValue: string;
  threshold: string;
  source: string;
  explanation: string;
  recommendedAction: string;
  timestamp: string;
}

export interface AiRequestLog {
  id: string;
  userEmail: string;
  locationName: string;
  promptPreview: string;
  status: 'success' | 'error';
  latencyMs: number;
  error?: string;
  timestamp: string;
}

export const monitoredLocations: GeoLocation[] = [
  {
    id: 'loc-1273294',
    name: 'Delhi, Delhi, India',
    city: 'Delhi',
    state: 'Delhi',
    country: 'India',
    countryCode: 'IN',
    latitude: 28.65195,
    longitude: 77.23149,
    population: 16787941,
  },
  {
    id: 'loc-1275339',
    name: 'Mumbai, Maharashtra, India',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    countryCode: 'IN',
    latitude: 19.07283,
    longitude: 72.88261,
    population: 12442373,
  },
  {
    id: 'loc-1258338',
    name: 'Rewari, Haryana, India',
    city: 'Rewari',
    state: 'Haryana',
    country: 'India',
    countryCode: 'IN',
    latitude: 28.19276,
    longitude: 76.61908,
    population: 143021,
  },
  {
    id: 'loc-2643743',
    name: 'London, England, United Kingdom',
    city: 'London',
    state: 'England',
    country: 'United Kingdom',
    countryCode: 'GB',
    latitude: 51.50853,
    longitude: -0.12574,
    population: 8982000,
  },
  {
    id: 'loc-5128581',
    name: 'New York, New York, United States',
    city: 'New York',
    state: 'New York',
    country: 'United States',
    countryCode: 'US',
    latitude: 40.71427,
    longitude: -74.00597,
    population: 8336817,
  },
];

export const uploadedRecords: UploadedCategoryRecord[] = [];
export const importHistory: DatasetImportHistoryItem[] = [];
export const serverAlerts: ServerAlertItem[] = [];
export const aiLogs: AiRequestLog[] = [];
export const cachedAqiSnapshots = new Map<string, { location: GeoLocation; aqi: AqiResult; anomalies: AnomalyRecord[]; updatedAt: string }>();

export const systemConfig = {
  forecastingEnabled: true,
  anomalyZThreshold: 2.2,
  defaultPollIntervalMin: 30,
  wmiWeights: { ...DEFAULT_WMI_WEIGHTS } as WmiWeights,
  wmiMethodologyVersion: 'EcoWMI-v1.0',
  wqiStandardNote: 'Jurisdiction-aware BIS IS 10500 / WHO / CPCB Designated Best Use',
  lastJobRunAt: null as string | null,
  lastJobStatus: 'idle' as 'idle' | 'running' | 'completed' | 'error',
  totalIngestedRecords: 0,
  processingErrors: 0,
};

export function normalizeLocationKey(name: string): string {
  return name.toLowerCase().split(',')[0].trim();
}

export function addUploadedRecords(records: UploadedCategoryRecord[]) {
  const existingKeys = new Set(
    uploadedRecords.map((r) => `${r.locationKey}|${r.category}|${r.timestamp}|${r.source}`)
  );
  let inserted = 0;
  for (const rec of records) {
    const dedupeKey = `${rec.locationKey}|${rec.category}|${rec.timestamp}|${rec.source}`;
    if (!existingKeys.has(dedupeKey)) {
      uploadedRecords.push(rec);
      existingKeys.add(dedupeKey);
      inserted++;
    }
  }
  systemConfig.totalIngestedRecords += inserted;
  return inserted;
}
