export type EnvironmentalCategory = 'air' | 'water' | 'waste' | 'energy' | 'weather';

export type DataOriginType =
  | 'live'
  | 'latest_available'
  | 'historical'
  | 'uploaded'
  | 'estimated'
  | 'predicted'
  | 'sample_reference';

export interface GeoLocation {
  id: string;
  name: string;
  city: string;
  district?: string;
  state?: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  population?: number;
  timezone?: string;
}

export interface PollutantReading {
  parameter: 'PM2.5' | 'PM10' | 'CO' | 'NO2' | 'SO2' | 'O3';
  value: number | null;
  unit: string;
  subIndex: number | null;
  category?: string;
  timestamp?: string;
}

export interface AqiResult {
  aqi: number | null;
  standardCode: 'CPCB_IN' | 'US_EPA' | 'EU_EAQI' | 'UK_DAQI';
  standardName: string;
  category: string;
  severityLevel: 'good' | 'moderate' | 'poor' | 'severe' | 'unavailable';
  dominantPollutant: string | null;
  pollutants: PollutantReading[];
  healthGuidance: string;
  source: string;
  station: string;
  lastUpdated: string | null;
  originType: DataOriginType;
}

export type WaterUseType = 'drinking' | 'bathing' | 'surface' | 'irrigation' | 'ecosystem';

export interface WqiParameterInput {
  key: 'ph' | 'do' | 'bod' | 'cod' | 'tds' | 'turbidity' | 'nitrate' | 'coliform';
  value: number | null;
  unit: string;
}

export interface WqiParameterBreakdown {
  key: string;
  label: string;
  measuredValue: number | null;
  unit: string;
  idealValue: number | string;
  standardLimit: string;
  unitWeight: number | null;
  qualityRatingQi: number | null;
  weightedContribution: number | null;
  status: 'within_limit' | 'elevated' | 'exceeds_limit' | 'missing';
}

export interface WqiCalculationResult {
  wqi: number | null;
  classification: string;
  severityLevel: 'good' | 'moderate' | 'poor' | 'severe' | 'unavailable';
  noteDirection: string;
  classificationNote: string;
  waterUse: WaterUseType;
  standardName: string;
  standardVersion: string;
  methodology: string;
  completenessPct: number;
  weightCoveragePct: number;
  isProvisional: boolean;
  microbiologicalAlert: boolean;
  microbiologicalMessage: string | null;
  deteriorationDrivers: string[];
  recommendations: string[];
  breakdown: WqiParameterBreakdown[];
  calculatedAt: string;
  dataOrigin: DataOriginType;
}

export interface WmiInput {
  totalGenerated: number | null;
  collected: number | null;
  segregated: number | null;
  recycledOrRecovered: number | null;
  treatedNonRecycling: number | null;
  safelyDisposed: number | null;
  unmanaged: number | null;
  unit: 'tonnes/day' | 'tonnes/month' | 'tonnes/year';
  population?: number | null;
  importExplanation?: string;
}

export interface WmiWeights {
  collection: number;
  segregation: number;
  recycling: number;
  treatment: number;
  safeDisposal: number;
  unmanagedControl: number;
}

export interface WmiComponentBreakdown {
  key: keyof WmiWeights;
  label: string;
  score: number | null;
  weight: number;
  weightedContribution: number | null;
  formula: string;
}

export interface WmiCalculationResult {
  wmi: number | null;
  classification: string;
  severityLevel: 'good' | 'moderate' | 'poor' | 'severe' | 'unavailable';
  noteDirection: string;
  methodologyNote: string;
  methodologyVersion: string;
  completenessPct: number;
  isProvisional: boolean;
  massBalanceAccountedSum: number | null;
  massBalanceDiscrepancyPct: number | null;
  validationWarnings: string[];
  weakestComponent: string | null;
  perCapitaKgPerDay: number | null;
  components: WmiComponentBreakdown[];
  recommendations: string[];
  calculatedAt: string;
  dataOrigin: DataOriginType;
}

export interface AnomalyRecord {
  id: string;
  category: EnvironmentalCategory;
  parameter: string;
  observedValue: number;
  baselineValue: number;
  unit: string;
  pctChange: number;
  zScore: number;
  detectionMethod: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  confidenceStatus: 'high' | 'medium' | 'provisional';
  timestamp: string;
  reason: string;
}

export interface ForecastPoint {
  timestamp: string;
  predictedValue: number;
  lowerBound: number;
  upperBound: number;
}

export interface ForecastResult {
  parameter: string;
  category: EnvironmentalCategory;
  unit: string;
  horizon: '24h' | '7d' | '30d' | '3m' | '12m';
  sufficientData: boolean;
  requiredPoints: number;
  availablePoints: number;
  insufficiencyReason?: string;
  modelUsed?: string;
  historicalPeriod?: string;
  validationMetrics?: {
    mae: number;
    rmse: number;
    mape: number;
  };
  limitations: string;
  points: ForecastPoint[];
}

export type ProviderHealthStatus = 'Live' | 'Fallback' | 'Sample data' | 'Error';

export interface NormalizedEnvReading {
  source: string;
  category: EnvironmentalCategory;
  location: string;
  metric: string;
  value: number | string | null;
  unit: string;
  timestamp: string;
  status: ProviderHealthStatus;
  viaSource?: string;
  isCached?: boolean;
  isSampleData?: boolean;
}

export interface DataSourceReport {
  id: string;
  name: string;
  category: EnvironmentalCategory;
  endpoint: string;
  authType: 'none' | 'api_key_header' | 'api_key_query' | 'bearer';
  envVarName?: string;
  hasKeyConfigured: boolean;
  status: ProviderHealthStatus;
  fallbackProvider?: string;
  fallbackDescription?: string;
  isSampleData?: boolean;
  isCached?: boolean;
  cachedAt?: string | null;
  cacheAgeMinutes?: number;
  lastUpdated: string | null;
  lastError?: string | null;
  documentationUrl: string;
  readings: NormalizedEnvReading[];
}

export interface ApiProviderConfig {
  id: string;
  name: string;
  category: EnvironmentalCategory;
  endpoint: string;
  authType: 'none' | 'api_key_header' | 'api_key_query' | 'bearer';
  envVarName?: string;
  hasKeyConfigured: boolean;
  refreshIntervalMinutes: number;
  enabled: boolean;
  status: 'connected' | 'not_configured' | 'error' | 'disabled';
  healthStatus: ProviderHealthStatus;
  fallbackProvider?: string;
  fallbackDescription?: string;
  isSampleData?: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  documentationUrl: string;
}

export interface ApiSyncLog {
  id: string;
  providerId: string;
  providerName: string;
  locationName: string;
  status: 'success' | 'error' | 'skipped';
  recordsIngested: number;
  message: string;
  syncedAt: string;
}
