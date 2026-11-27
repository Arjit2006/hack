export type AppView =
  | 'landing'
  | 'login'
  | 'register'
  | 'forgot-password'
  | 'admin-login'
  | 'dashboard'
  | 'admin';

export type DashboardTab =
  | 'overview'
  | 'air'
  | 'water'
  | 'waste'
  | 'energy'
  | 'chatbot'
  | 'reports'
  | 'compare'
  | 'alerts'
  | 'profile';

export type AdminTab =
  | 'overview'
  | 'users'
  | 'locations'
  | 'apis'
  | 'datasets'
  | 'methodology'
  | 'ai-config'
  | 'alerts'
  | 'security';

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
}

export interface PollutantReading {
  parameter: 'PM2.5' | 'PM10' | 'CO' | 'NO2' | 'SO2' | 'O3';
  value: number | null;
  unit: string;
  subIndex: number | null;
  category?: string;
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
  originType: string;
}

export type ProviderHealthStatus = 'Live' | 'Fallback' | 'Sample data' | 'Error';

export interface NormalizedEnvReading {
  source: string;
  category: 'air' | 'water' | 'waste' | 'energy' | 'weather';
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
  category: 'air' | 'water' | 'waste' | 'energy' | 'weather';
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

export interface AiSummaryResult {
  summary: string;
  currentActions: string[];
  futureActions: string[];
  mode: 'gemini' | 'rule_based_fallback';
  modelUsed?: string;
  modelLabel?: string;
  fallbackReason?: string;
  generatedAt: string;
}

export interface OverviewPayload {
  location: GeoLocation;
  retrievedAt: string;
  aqi: AqiResult;
  airHourly: Array<{
    timestamp: string;
    pm25: number | null;
    pm10: number | null;
    co: number | null;
    no2: number | null;
    so2: number | null;
    o3: number | null;
    usAqi: number | null;
    europeanAqi: number | null;
  }>;
  openAqStations: Array<{ id: number; name: string; locality?: string; distanceKm?: number }>;
  weather: {
    current: {
      temperatureC: number | null;
      humidityPct: number | null;
      precipitationMm: number | null;
      windSpeedKmh: number | null;
      weatherLabel: string;
      time: string | null;
    };
    dailyForecast: Array<{
      date: string;
      tempMaxC: number | null;
      tempMinC: number | null;
      precipitationSumMm: number | null;
      uvIndexMax: number | null;
      weatherLabel: string;
    }>;
    warnings: Array<{ title: string; severity: 'moderate' | 'high' | 'critical'; detail: string }>;
    source: string;
    issuedAt: string;
  } | null;
  water: {
    available: boolean;
    isSampleData?: boolean;
    sourceLabel?: string;
    wqi: WqiCalculationResult | null;
    records: Array<Record<string, unknown>>;
    usageRecords: Array<Record<string, unknown>>;
  };
  waste: {
    available: boolean;
    isSampleData?: boolean;
    sourceLabel?: string;
    wmi: WmiCalculationResult | null;
    records: Array<Record<string, unknown>>;
  };
  energy: {
    worldBank: {
      countryCode: string;
      countryName: string;
      renewableShareSeries: Array<{ year: number; value: number }>;
      electricityPerCapitaSeries: Array<{ year: number; value: number }>;
      fossilShareSeries: Array<{ year: number; value: number }>;
      latestRenewablePct: number | null;
      latestRenewableYear: number | null;
      latestElectricityKwhPerCapita: number | null;
      latestElectricityYear: number | null;
      source: string;
      lastUpdated: string;
    } | null;
    ember?: {
      available: boolean;
      status: ProviderHealthStatus;
      source: string;
      latestGenerationTwh: number | null;
      latestCleanSharePct: number | null;
      period: string | null;
      isFallback: boolean;
    };
    uploadedRecords: Array<Record<string, unknown>>;
  };
  anomalies: Array<{
    id: string;
    category: string;
    parameter: string;
    observedValue: number;
    baselineValue: number;
    unit: string;
    pctChange: number;
    zScore: number;
    detectionMethod: string;
    severity: 'low' | 'moderate' | 'high' | 'critical';
    confidenceStatus: string;
    timestamp: string;
    reason: string;
  }>;
  forecasts: {
    enabled: boolean;
    pm25_24h: ForecastResult | null;
    pm25_7d: ForecastResult | null;
  };
  alerts: Array<{
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
  }>;
  dataSources?: DataSourceReport[];
}

export interface WqiCalculationResult {
  wqi: number | null;
  classification: string;
  severityLevel: 'good' | 'moderate' | 'poor' | 'severe' | 'unavailable';
  noteDirection: string;
  classificationNote: string;
  waterUse: 'drinking' | 'bathing' | 'surface' | 'irrigation' | 'ecosystem';
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
  breakdown: Array<{
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
  }>;
  calculatedAt: string;
  dataOrigin: string;
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
  components: Array<{
    key: string;
    label: string;
    score: number | null;
    weight: number;
    weightedContribution: number | null;
    formula: string;
  }>;
  recommendations: string[];
  calculatedAt: string;
  dataOrigin: string;
}

export interface ForecastResult {
  parameter: string;
  category: string;
  unit: string;
  horizon: string;
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
  points: Array<{
    timestamp: string;
    predictedValue: number;
    lowerBound: number;
    upperBound: number;
  }>;
}
