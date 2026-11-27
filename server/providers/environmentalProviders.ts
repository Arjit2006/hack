import {
  ApiProviderConfig,
  ApiSyncLog,
  DataSourceReport,
  GeoLocation,
  NormalizedEnvReading,
  ProviderHealthStatus,
} from '../types';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10-minute provider cache

// Server-side in-memory secret store (never exposed to browser clients)
const runtimeSecrets: Record<string, string> = {
  OPENAQ_API_KEY: process.env.OPENAQ_API_KEY || '',
  DATA_GOV_IN_API_KEY: process.env.DATA_GOV_IN_API_KEY || '',
  EMBER_API_KEY: process.env.EMBER_API_KEY || '',
};

interface CachedAdapterEntry {
  report: DataSourceReport;
  cachedAtMs: number;
  extra?: Record<string, unknown>;
}

const adapterCache = new Map<string, CachedAdapterEntry>();

const providers: ApiProviderConfig[] = [
  {
    id: 'open-meteo-aq',
    name: 'Open-Meteo Air Quality API',
    category: 'air',
    endpoint: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    authType: 'none',
    hasKeyConfigured: true,
    refreshIntervalMinutes: 30,
    enabled: true,
    status: 'connected',
    healthStatus: 'Live',
    lastSyncAt: null,
    lastError: null,
    documentationUrl: 'https://open-meteo.com/en/docs/air-quality-api',
  },
  {
    id: 'open-meteo-weather',
    name: 'Open-Meteo Weather & Climate API',
    category: 'weather',
    endpoint: 'https://api.open-meteo.com/v1/forecast',
    authType: 'none',
    hasKeyConfigured: true,
    refreshIntervalMinutes: 30,
    enabled: true,
    status: 'connected',
    healthStatus: 'Live',
    lastSyncAt: null,
    lastError: null,
    documentationUrl: 'https://open-meteo.com/en/docs',
  },
  {
    id: 'world-bank-energy',
    name: 'World Bank Open Data (Energy & Renewables)',
    category: 'energy',
    endpoint: 'https://api.worldbank.org/v2',
    authType: 'none',
    hasKeyConfigured: true,
    refreshIntervalMinutes: 360,
    enabled: true,
    status: 'connected',
    healthStatus: 'Live',
    lastSyncAt: null,
    lastError: null,
    documentationUrl: 'https://datahelpdesk.worldbank.org/knowledgebase/topics/125589',
  },
  {
    id: 'openaq-v3',
    name: 'OpenAQ v3 Ground Stations API',
    category: 'air',
    endpoint: 'https://api.openaq.org/v3/locations',
    authType: 'api_key_header',
    envVarName: 'OPENAQ_API_KEY',
    hasKeyConfigured: Boolean(runtimeSecrets.OPENAQ_API_KEY),
    refreshIntervalMinutes: 60,
    enabled: true,
    status: 'connected',
    healthStatus: runtimeSecrets.OPENAQ_API_KEY ? 'Live' : 'Fallback',
    fallbackProvider: runtimeSecrets.OPENAQ_API_KEY ? undefined : 'Open-Meteo AQ',
    fallbackDescription: runtimeSecrets.OPENAQ_API_KEY
      ? undefined
      : 'OPENAQ_API_KEY not configured — using Open-Meteo AQ fallback',
    lastSyncAt: null,
    lastError: null,
    documentationUrl: 'https://docs.openaq.org/',
  },
  {
    id: 'cpcb-datagovin',
    name: 'CPCB / data.gov.in Open Air & Water Portal',
    category: 'air',
    endpoint: 'https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69',
    authType: 'api_key_query',
    envVarName: 'DATA_GOV_IN_API_KEY',
    hasKeyConfigured: Boolean(runtimeSecrets.DATA_GOV_IN_API_KEY),
    refreshIntervalMinutes: 60,
    enabled: true,
    status: 'connected',
    healthStatus: runtimeSecrets.DATA_GOV_IN_API_KEY ? 'Live' : 'Fallback',
    fallbackProvider: runtimeSecrets.DATA_GOV_IN_API_KEY ? undefined : 'Open-Meteo AQ',
    fallbackDescription: runtimeSecrets.DATA_GOV_IN_API_KEY
      ? undefined
      : 'DATA_GOV_IN_API_KEY not configured — using Open-Meteo AQ fallback',
    lastSyncAt: null,
    lastError: null,
    documentationUrl: 'https://data.gov.in/',
  },
  {
    id: 'unep-gemstat-water',
    name: 'UNEP GEMStat / India-WRIS / NWDP Water',
    category: 'water',
    endpoint: 'https://gemstat.org/',
    authType: 'none',
    hasKeyConfigured: true,
    refreshIntervalMinutes: 720,
    enabled: true,
    status: 'connected',
    healthStatus: 'Sample data',
    isSampleData: true,
    fallbackDescription: 'Public REST telemetry unavailable — serving clearly labeled Sample data (pH, DO, BOD, Turbidity)',
    lastSyncAt: null,
    lastError: null,
    documentationUrl: 'https://gemstat.org/',
  },
  {
    id: 'worldbank-waste',
    name: 'World Bank What a Waste / SBM Urban / Sansaadhan',
    category: 'waste',
    endpoint: 'https://api.worldbank.org/v2',
    authType: 'none',
    hasKeyConfigured: true,
    refreshIntervalMinutes: 1440,
    enabled: true,
    status: 'connected',
    healthStatus: 'Sample data',
    isSampleData: true,
    fallbackDescription: 'City-level municipal waste streams served as labeled Sample data alongside World Bank urban indicators',
    lastSyncAt: null,
    lastError: null,
    documentationUrl: 'https://datacatalog.worldbank.org/search/dataset/0039597/what-a-waste-global-database',
  },
  {
    id: 'ember-energy',
    name: 'Ember Energy Data API',
    category: 'energy',
    endpoint: 'https://api.ember-energy.org/v1/electricity-generation/monthly',
    authType: 'api_key_query',
    envVarName: 'EMBER_API_KEY',
    hasKeyConfigured: Boolean(runtimeSecrets.EMBER_API_KEY),
    refreshIntervalMinutes: 360,
    enabled: true,
    status: 'connected',
    healthStatus: runtimeSecrets.EMBER_API_KEY ? 'Live' : 'Fallback',
    fallbackProvider: runtimeSecrets.EMBER_API_KEY ? undefined : 'World Bank',
    fallbackDescription: runtimeSecrets.EMBER_API_KEY
      ? undefined
      : 'EMBER_API_KEY not configured — using World Bank electricity indicators',
    lastSyncAt: null,
    lastError: null,
    documentationUrl: 'https://ember-energy.org/data/api/',
  },
];

const syncLogs: ApiSyncLog[] = [];

export function getProviders(): ApiProviderConfig[] {
  return providers.map((p) => ({ ...p }));
}

export function getSyncLogs(): ApiSyncLog[] {
  return [...syncLogs].slice(0, 60);
}

export function addSyncLog(log: Omit<ApiSyncLog, 'id'>) {
  syncLogs.unshift({
    id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...log,
  });
  if (syncLogs.length > 100) syncLogs.length = 100;
}

function isSafeExternalHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === '::1' ||
      host === '[::1]' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^0\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function updateProviderConfig(
  id: string,
  updates: Partial<Pick<ApiProviderConfig, 'enabled' | 'refreshIntervalMinutes' | 'endpoint'>> & { apiKey?: string }
): ApiProviderConfig | null {
  const provider = providers.find((p) => p.id === id);
  if (!provider) return null;
  if (typeof updates.enabled === 'boolean') provider.enabled = updates.enabled;
  if (typeof updates.refreshIntervalMinutes === 'number' && updates.refreshIntervalMinutes >= 5) {
    provider.refreshIntervalMinutes = updates.refreshIntervalMinutes;
  }
  if (updates.endpoint && isSafeExternalHttpsUrl(updates.endpoint)) {
    provider.endpoint = updates.endpoint;
  }
  if (updates.apiKey !== undefined && provider.envVarName) {
    runtimeSecrets[provider.envVarName] = updates.apiKey.trim();
    provider.hasKeyConfigured = Boolean(runtimeSecrets[provider.envVarName]);
    if (provider.hasKeyConfigured) {
      provider.status = provider.enabled ? 'connected' : 'disabled';
      provider.healthStatus = 'Live';
      provider.fallbackProvider = undefined;
      provider.fallbackDescription = undefined;
      provider.lastError = null;
    } else {
      provider.status = 'connected';
      provider.healthStatus = 'Fallback';
      provider.fallbackDescription = `${provider.envVarName} cleared — using fallback feed`;
      provider.lastError = null;
    }
    // Clear cache entries for this provider so next fetch tries the updated credential
    for (const k of adapterCache.keys()) {
      if (k.startsWith(`${id}:`)) adapterCache.delete(k);
    }
  }
  if (!provider.enabled) {
    provider.status = 'disabled';
  } else if (provider.status === 'disabled') {
    provider.status = 'connected';
  }
  return { ...provider };
}

export function registerCustomProvider(input: {
  name: string;
  category: ApiProviderConfig['category'];
  endpoint: string;
  authType: ApiProviderConfig['authType'];
  refreshIntervalMinutes: number;
  apiKey?: string;
}): ApiProviderConfig {
  if (!isSafeExternalHttpsUrl(input.endpoint)) {
    throw new Error('Custom provider endpoint must be a valid public HTTPS URL.');
  }
  const id = `custom-${Date.now()}`;
  const envVarName = input.authType === 'none' ? undefined : `CUSTOM_${id.toUpperCase()}_KEY`;
  if (envVarName && input.apiKey) {
    runtimeSecrets[envVarName] = input.apiKey.trim();
  }
  const hasKey = input.authType === 'none' || Boolean(input.apiKey?.trim());
  const created: ApiProviderConfig = {
    id,
    name: input.name,
    category: input.category,
    endpoint: input.endpoint,
    authType: input.authType,
    envVarName,
    hasKeyConfigured: hasKey,
    refreshIntervalMinutes: input.refreshIntervalMinutes,
    enabled: true,
    status: 'connected',
    healthStatus: hasKey ? 'Live' : 'Fallback',
    lastSyncAt: null,
    lastError: hasKey ? null : 'API key missing — fallback mode active',
    documentationUrl: input.endpoint,
  };
  providers.push(created);
  return { ...created };
}

async function fetchWithRetry(url: string, options?: RequestInit, retries = 2, timeoutMs = 8000): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 350 * Math.pow(2, attempt)));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 350 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Network request failed');
}

// =========================================================================
// Normalized Sample Datasets (Clearly labeled "Sample data" when live unavailable)
// =========================================================================

export function getSampleWaterDataset(locationName: string, countryCode: string) {
  // Realistic regional baseline profile marked strictly as Sample data
  const cc = (countryCode || 'IN').toUpperCase();
  const isHotBasin = cc === 'IN' || cc === 'BD' || cc === 'PK' || cc === 'EG';
  return {
    locationName,
    sourceLabel: 'Sample data (UNEP GEMStat / India-WRIS reference profile)',
    isSampleData: true,
    inputs: {
      ph: isHotBasin ? 7.5 : 7.2,
      do: isHotBasin ? 5.8 : 7.6,
      bod: isHotBasin ? 3.4 : 1.9,
      cod: isHotBasin ? 18 : 11,
      tds: isHotBasin ? 410 : 240,
      turbidity: isHotBasin ? 3.8 : 1.6,
      nitrate: isHotBasin ? 19 : 9,
      coliform: isHotBasin ? 180 : 35,
    },
  };
}

export function getSampleWasteDataset(locationName: string, countryCode: string) {
  const cc = (countryCode || 'IN').toUpperCase();
  const highIncomeProfile = ['US', 'GB', 'DE', 'FR', 'JP', 'SG', 'CA', 'AU'].includes(cc);
  return {
    locationName,
    sourceLabel: 'Sample data (World Bank What a Waste / SBM Urban benchmark)',
    isSampleData: true,
    inputs: highIncomeProfile
      ? {
          totalGenerated: 1200,
          collected: 1176,
          segregated: 840,
          recycledOrRecovered: 490,
          treatedNonRecycling: 420,
          safelyDisposed: 266,
          unmanaged: 24,
          unit: 'tonnes/day' as const,
        }
      : {
          totalGenerated: 1000,
          collected: 860,
          segregated: 510,
          recycledOrRecovered: 240,
          treatedNonRecycling: 280,
          safelyDisposed: 310,
          unmanaged: 170,
          unit: 'tonnes/day' as const,
        },
  };
}

// =========================================================================
// Location Search & Reverse Geocoding
// =========================================================================

export async function searchLocations(query: string): Promise<GeoLocation[]> {
  const clean = query.trim();
  if (!clean) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(clean)}&count=8&language=en&format=json`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status})`);
  const data = (await res.json()) as {
    results?: Array<{
      id: number;
      name: string;
      admin1?: string;
      admin2?: string;
      country?: string;
      country_code?: string;
      latitude: number;
      longitude: number;
      population?: number;
      timezone?: string;
    }>;
  };
  return (data.results ?? []).map((r) => ({
    id: `loc-${r.id}`,
    name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    city: r.name,
    district: r.admin2,
    state: r.admin1,
    country: r.country || 'Unknown',
    countryCode: (r.country_code || 'US').toUpperCase(),
    latitude: r.latitude,
    longitude: r.longitude,
    population: r.population,
    timezone: r.timezone,
  }));
}

export async function reverseGeocode(lat: number, lon: number): Promise<GeoLocation> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=en`;
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'EcoIntelligence-Environmental-Monitor/1.0' },
    });
    if (res.ok) {
      const d = (await res.json()) as {
        address?: {
          city?: string;
          town?: string;
          village?: string;
          county?: string;
          state_district?: string;
          state?: string;
          country?: string;
          country_code?: string;
        };
      };
      const addr = d.address ?? {};
      const city = addr.city || addr.town || addr.village || addr.county || `Location (${lat.toFixed(2)}, ${lon.toFixed(2)})`;
      const country = addr.country || 'Unknown';
      const state = addr.state;
      return {
        id: `geo-${lat.toFixed(3)}-${lon.toFixed(3)}`,
        name: [city, state, country].filter(Boolean).join(', '),
        city,
        district: addr.state_district || addr.county,
        state,
        country,
        countryCode: (addr.country_code || 'US').toUpperCase(),
        latitude: lat,
        longitude: lon,
      };
    }
  } catch {
    // Fallback cleanly to coordinate label
  }
  return {
    id: `geo-${lat.toFixed(3)}-${lon.toFixed(3)}`,
    name: `Coordinates (${lat.toFixed(3)}, ${lon.toFixed(3)})`,
    city: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
    country: 'Unknown',
    countryCode: 'US',
    latitude: lat,
    longitude: lon,
  };
}

// =========================================================================
// Core Feeds: Open-Meteo AQ, Open-Meteo Weather, World Bank Energy
// =========================================================================

export interface LiveAirQualityData {
  current: {
    pm25: number | null;
    pm10: number | null;
    coUgM3: number | null;
    no2: number | null;
    so2: number | null;
    o3: number | null;
    time: string | null;
  };
  hourly: Array<{
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
  source: string;
  station: string;
  openAqStations?: Array<{ id: number; name: string; locality?: string; distanceKm?: number }>;
}

export async function fetchOpenMeteoAirQuality(lat: number, lon: number, pastDays = 7): Promise<LiveAirQualityData> {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi,european_aqi&hourly=pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi,european_aqi&past_days=${Math.min(30, pastDays)}&forecast_days=2&timezone=auto`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Open-Meteo Air Quality API failed (HTTP ${res.status})`);
  const data = (await res.json()) as {
    current?: {
      time: string;
      pm2_5?: number | null;
      pm10?: number | null;
      carbon_monoxide?: number | null;
      nitrogen_dioxide?: number | null;
      sulphur_dioxide?: number | null;
      ozone?: number | null;
    };
    hourly?: {
      time: string[];
      pm2_5: Array<number | null>;
      pm10: Array<number | null>;
      carbon_monoxide: Array<number | null>;
      nitrogen_dioxide: Array<number | null>;
      sulphur_dioxide: Array<number | null>;
      ozone: Array<number | null>;
      us_aqi: Array<number | null>;
      european_aqi: Array<number | null>;
    };
  };

  const nowIso = new Date().toISOString();
  const provider = providers.find((p) => p.id === 'open-meteo-aq');
  if (provider) {
    provider.lastSyncAt = nowIso;
    provider.status = provider.enabled ? 'connected' : 'disabled';
    provider.healthStatus = 'Live';
    provider.lastError = null;
  }

  const hourlyTimes = data.hourly?.time ?? [];
  const nowMs = Date.now();
  const hourly = hourlyTimes
    .map((t, idx) => ({
      timestamp: t,
      pm25: data.hourly?.pm2_5?.[idx] ?? null,
      pm10: data.hourly?.pm10?.[idx] ?? null,
      co: data.hourly?.carbon_monoxide?.[idx] ?? null,
      no2: data.hourly?.nitrogen_dioxide?.[idx] ?? null,
      so2: data.hourly?.sulphur_dioxide?.[idx] ?? null,
      o3: data.hourly?.ozone?.[idx] ?? null,
      usAqi: data.hourly?.us_aqi?.[idx] ?? null,
      europeanAqi: data.hourly?.european_aqi?.[idx] ?? null,
    }))
    .filter((pt) => new Date(pt.timestamp).getTime() <= nowMs);

  let openAqStations: LiveAirQualityData['openAqStations'];
  if (runtimeSecrets.OPENAQ_API_KEY) {
    try {
      const aqRes = await fetchWithRetry(
        `https://api.openaq.org/v3/locations?coordinates=${lat},${lon}&radius=25000&limit=5`,
        { headers: { 'X-API-Key': runtimeSecrets.OPENAQ_API_KEY } },
        1,
        5000
      );
      if (aqRes.ok) {
        const aqJson = (await aqRes.json()) as {
          results?: Array<{ id: number; name: string; locality?: string; distance?: number }>;
        };
        openAqStations = (aqJson.results ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          locality: s.locality,
          distanceKm: s.distance ? Number((s.distance / 1000).toFixed(1)) : undefined,
        }));
      }
    } catch {
      // OpenAQ optional enrichment; do not break primary Open-Meteo data
    }
  }

  return {
    current: {
      pm25: data.current?.pm2_5 ?? null,
      pm10: data.current?.pm10 ?? null,
      coUgM3: data.current?.carbon_monoxide ?? null,
      no2: data.current?.nitrogen_dioxide ?? null,
      so2: data.current?.sulphur_dioxide ?? null,
      o3: data.current?.ozone ?? null,
      time: data.current?.time ?? null,
    },
    hourly,
    source: 'Open-Meteo Air Quality (CAMS/ECMWF)',
    station: `Grid Node (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)${openAqStations?.[0] ? ` · Nearest OpenAQ: ${openAqStations[0].name}` : ''}`,
    openAqStations,
  };
}

export interface LiveWeatherData {
  current: {
    temperatureC: number | null;
    humidityPct: number | null;
    precipitationMm: number | null;
    windSpeedKmh: number | null;
    weatherCode: number | null;
    weatherLabel: string;
    time: string | null;
  };
  dailyForecast: Array<{
    date: string;
    tempMaxC: number | null;
    tempMinC: number | null;
    precipitationSumMm: number | null;
    uvIndexMax: number | null;
    weatherCode: number | null;
    weatherLabel: string;
  }>;
  warnings: Array<{ title: string; severity: 'moderate' | 'high' | 'critical'; detail: string }>;
  source: string;
  issuedAt: string;
}

function mapWmoCode(code: number | null): string {
  if (code === null) return 'Unknown';
  if (code === 0) return 'Clear sky';
  if (code <= 3) return 'Partly cloudy / overcast';
  if (code <= 48) return 'Fog / mist';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Variable conditions';
}

export async function fetchOpenMeteoWeather(lat: number, lon: number): Promise<LiveWeatherData> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max&forecast_days=7&timezone=auto`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Open-Meteo Weather API failed (HTTP ${res.status})`);
  const data = (await res.json()) as {
    current?: {
      time: string;
      temperature_2m?: number | null;
      relative_humidity_2m?: number | null;
      precipitation?: number | null;
      wind_speed_10m?: number | null;
      weather_code?: number | null;
    };
    daily?: {
      time: string[];
      weather_code: Array<number | null>;
      temperature_2m_max: Array<number | null>;
      temperature_2m_min: Array<number | null>;
      precipitation_sum: Array<number | null>;
      uv_index_max: Array<number | null>;
    };
  };

  const nowIso = new Date().toISOString();
  const provider = providers.find((p) => p.id === 'open-meteo-weather');
  if (provider) {
    provider.lastSyncAt = nowIso;
    provider.status = provider.enabled ? 'connected' : 'disabled';
    provider.healthStatus = 'Live';
    provider.lastError = null;
  }

  const dailyForecast = (data.daily?.time ?? []).map((date, i) => {
    const code = data.daily?.weather_code?.[i] ?? null;
    return {
      date,
      tempMaxC: data.daily?.temperature_2m_max?.[i] ?? null,
      tempMinC: data.daily?.temperature_2m_min?.[i] ?? null,
      precipitationSumMm: data.daily?.precipitation_sum?.[i] ?? null,
      uvIndexMax: data.daily?.uv_index_max?.[i] ?? null,
      weatherCode: code,
      weatherLabel: mapWmoCode(code),
    };
  });

  const warnings: LiveWeatherData['warnings'] = [];
  const maxTemp7d = Math.max(...dailyForecast.map((d) => d.tempMaxC ?? -99));
  const maxRainDay = Math.max(...dailyForecast.map((d) => d.precipitationSumMm ?? 0));
  if (maxTemp7d >= 40) {
    warnings.push({
      title: 'Extreme Heat Advisory (7-Day Weather Forecast)',
      severity: maxTemp7d >= 44 ? 'critical' : 'high',
      detail: `Forecast peak temperature reaches ${maxTemp7d.toFixed(1)}°C within the next 7 days.`,
    });
  }
  if (maxRainDay >= 50) {
    warnings.push({
      title: 'Heavy Rainfall Advisory (7-Day Weather Forecast)',
      severity: maxRainDay >= 100 ? 'critical' : 'high',
      detail: `Forecast daily precipitation reaches ${maxRainDay.toFixed(1)} mm.`,
    });
  }

  return {
    current: {
      temperatureC: data.current?.temperature_2m ?? null,
      humidityPct: data.current?.relative_humidity_2m ?? null,
      precipitationMm: data.current?.precipitation ?? null,
      windSpeedKmh: data.current?.wind_speed_10m ?? null,
      weatherCode: data.current?.weather_code ?? null,
      weatherLabel: mapWmoCode(data.current?.weather_code ?? null),
      time: data.current?.time ?? null,
    },
    dailyForecast,
    warnings,
    source: 'Open-Meteo Numerical Weather Forecast (Short-Term)',
    issuedAt: nowIso,
  };
}

export interface WorldBankEnergySummary {
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
}

export async function fetchWorldBankEnergy(countryCode: string): Promise<WorldBankEnergySummary> {
  const cc = (countryCode || 'IN').toUpperCase();
  const fetchInd = async (indicator: string) => {
    const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(cc)}/indicator/${indicator}?format=json&per_page=15`;
    const res = await fetchWithRetry(url, undefined, 1, 7000);
    if (!res.ok) return { countryName: cc, points: [] as Array<{ year: number; value: number }> };
    const json = (await res.json()) as [unknown, Array<{ date: string; value: number | null; country?: { value: string } }>];
    const rows = Array.isArray(json) && Array.isArray(json[1]) ? json[1] : [];
    const countryName = rows[0]?.country?.value || cc;
    const points = rows
      .filter((r) => r.value !== null && Number.isFinite(r.value))
      .map((r) => ({ year: Number(r.date), value: Number((r.value as number).toFixed(2)) }))
      .sort((a, b) => a.year - b.year);
    return { countryName, points };
  };

  const [renew, elec, fossil] = await Promise.all([
    fetchInd('EG.FEC.RNEW.ZS'),
    fetchInd('EG.USE.ELEC.KH.PC'),
    fetchInd('EG.USE.COMM.FO.ZS'),
  ]);

  const nowIso = new Date().toISOString();
  const provider = providers.find((p) => p.id === 'world-bank-energy');
  if (provider && (renew.points.length > 0 || elec.points.length > 0)) {
    provider.lastSyncAt = nowIso;
    provider.status = provider.enabled ? 'connected' : 'disabled';
    provider.healthStatus = 'Live';
    provider.lastError = null;
  }

  const latestRenew = renew.points[renew.points.length - 1] ?? null;
  const latestElec = elec.points[elec.points.length - 1] ?? null;

  return {
    countryCode: cc,
    countryName: renew.countryName || elec.countryName || cc,
    renewableShareSeries: renew.points,
    electricityPerCapitaSeries: elec.points,
    fossilShareSeries: fossil.points,
    latestRenewablePct: latestRenew?.value ?? null,
    latestRenewableYear: latestRenew?.year ?? null,
    latestElectricityKwhPerCapita: latestElec?.value ?? null,
    latestElectricityYear: latestElec?.year ?? null,
    source: 'World Bank Open Data API (National Annual Indicators)',
    lastUpdated: nowIso,
  };
}

// =========================================================================
// Unified Normalized Data Service Layer (8 Adapters + 10-Minute Cache)
// =========================================================================

export interface AdapterContext {
  lat: number;
  lon: number;
  countryCode: string;
  locationName: string;
  airData?: LiveAirQualityData | null;
  weatherData?: LiveWeatherData | null;
  energyData?: WorldBankEnergySummary | null;
  bypassCache?: boolean;
}

function updateProviderMeta(
  id: string,
  healthStatus: ProviderHealthStatus,
  lastUpdated: string | null,
  fallbackDescription?: string,
  lastError?: string | null,
  isSampleData?: boolean,
  fallbackProvider?: string
) {
  const p = providers.find((x) => x.id === id);
  if (!p) return;
  p.healthStatus = healthStatus;
  p.lastSyncAt = lastUpdated;
  p.fallbackProvider = fallbackProvider;
  p.fallbackDescription = fallbackDescription;
  p.lastError = lastError ?? null;
  p.isSampleData = Boolean(isSampleData);
  p.status = healthStatus === 'Error' ? 'error' : 'connected';
}

function buildNormalized(
  source: string,
  category: DataSourceReport['category'],
  location: string,
  metric: string,
  value: number | string | null,
  unit: string,
  timestamp: string,
  status: ProviderHealthStatus,
  options?: { isSampleData?: boolean; viaSource?: string }
): NormalizedEnvReading {
  return {
    source,
    category,
    location,
    metric,
    value,
    unit,
    timestamp,
    status,
    ...(options?.viaSource ? { viaSource: options.viaSource } : {}),
    ...(options?.isSampleData ? { isSampleData: true } : {}),
  };
}

async function runSingleAdapter(id: string, ctx: AdapterContext): Promise<CachedAdapterEntry> {
  const cacheKey = `${id}:${ctx.countryCode.toUpperCase()}:${ctx.lat.toFixed(2)},${ctx.lon.toFixed(2)}`;
  const cached = adapterCache.get(cacheKey);
  if (!ctx.bypassCache && cached && Date.now() - cached.cachedAtMs < CACHE_TTL_MS) {
    const ageMinutes = Math.max(0, Math.floor((Date.now() - cached.cachedAtMs) / 60_000));
    const clonedReport: DataSourceReport = {
      ...cached.report,
      isCached: true,
      cachedAt: new Date(cached.cachedAtMs).toISOString(),
      cacheAgeMinutes: ageMinutes,
      readings: cached.report.readings.map((r) => ({
        ...r,
        isCached: true,
      })),
    };
    return { ...cached, report: clonedReport };
  }

  const prov = providers.find((p) => p.id === id);
  const nowIso = new Date().toISOString();

  if (!prov) {
    throw new Error(`Unknown provider adapter: ${id}`);
  }

  // 1. Open-Meteo Air Quality
  if (id === 'open-meteo-aq') {
    try {
      const air = ctx.airData ?? (await fetchOpenMeteoAirQuality(ctx.lat, ctx.lon, 7));
      const ts = air.current.time || nowIso;
      const status: ProviderHealthStatus = 'Live';
      const readings: NormalizedEnvReading[] = [
        buildNormalized(prov.name, 'air', ctx.locationName, 'PM2.5', air.current.pm25, 'µg/m³', ts, status),
        buildNormalized(prov.name, 'air', ctx.locationName, 'PM10', air.current.pm10, 'µg/m³', ts, status),
        buildNormalized(prov.name, 'air', ctx.locationName, 'NO2', air.current.no2, 'µg/m³', ts, status),
      ];
      updateProviderMeta(id, status, nowIso);
      const entry: CachedAdapterEntry = {
        cachedAtMs: Date.now(),
        report: {
          id: prov.id,
          name: prov.name,
          category: prov.category,
          endpoint: prov.endpoint,
          authType: prov.authType,
          hasKeyConfigured: true,
          status,
          isCached: false,
          cachedAt: nowIso,
          cacheAgeMinutes: 0,
          lastUpdated: nowIso,
          documentationUrl: prov.documentationUrl,
          readings,
        },
      };
      adapterCache.set(cacheKey, entry);
      return entry;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Open-Meteo Air Quality error';
      updateProviderMeta(id, 'Error', nowIso, undefined, msg);
      return {
        cachedAtMs: Date.now(),
        report: {
          id: prov.id,
          name: prov.name,
          category: prov.category,
          endpoint: prov.endpoint,
          authType: prov.authType,
          hasKeyConfigured: true,
          status: 'Error',
          isCached: false,
          lastUpdated: nowIso,
          lastError: msg,
          documentationUrl: prov.documentationUrl,
          readings: [],
        },
      };
    }
  }

  // 2. Open-Meteo Weather
  if (id === 'open-meteo-weather') {
    try {
      const wx = ctx.weatherData ?? (await fetchOpenMeteoWeather(ctx.lat, ctx.lon));
      const ts = wx.current.time || nowIso;
      const status: ProviderHealthStatus = 'Live';
      const readings: NormalizedEnvReading[] = [
        buildNormalized(prov.name, 'weather', ctx.locationName, 'Temperature', wx.current.temperatureC, '°C', ts, status),
        buildNormalized(prov.name, 'weather', ctx.locationName, 'Humidity', wx.current.humidityPct, '%', ts, status),
        buildNormalized(prov.name, 'weather', ctx.locationName, 'Wind Speed', wx.current.windSpeedKmh, 'km/h', ts, status),
      ];
      updateProviderMeta(id, status, nowIso);
      const entry: CachedAdapterEntry = {
        cachedAtMs: Date.now(),
        report: {
          id: prov.id,
          name: prov.name,
          category: prov.category,
          endpoint: prov.endpoint,
          authType: prov.authType,
          hasKeyConfigured: true,
          status,
          isCached: false,
          cachedAt: nowIso,
          cacheAgeMinutes: 0,
          lastUpdated: nowIso,
          documentationUrl: prov.documentationUrl,
          readings,
        },
      };
      adapterCache.set(cacheKey, entry);
      return entry;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Open-Meteo Weather error';
      updateProviderMeta(id, 'Error', nowIso, undefined, msg);
      return {
        cachedAtMs: Date.now(),
        report: {
          id: prov.id,
          name: prov.name,
          category: prov.category,
          endpoint: prov.endpoint,
          authType: prov.authType,
          hasKeyConfigured: true,
          status: 'Error',
          isCached: false,
          lastUpdated: nowIso,
          lastError: msg,
          documentationUrl: prov.documentationUrl,
          readings: [],
        },
      };
    }
  }

  // 3. World Bank Energy
  if (id === 'world-bank-energy') {
    try {
      const energy = ctx.energyData ?? (await fetchWorldBankEnergy(ctx.countryCode));
      const hasData = energy.latestRenewablePct !== null || energy.latestElectricityKwhPerCapita !== null;
      const status: ProviderHealthStatus = hasData ? 'Live' : 'Error';
      const readings: NormalizedEnvReading[] = [
        buildNormalized(
          prov.name,
          'energy',
          energy.countryName,
          'Renewable Energy Share',
          energy.latestRenewablePct,
          '%',
          energy.latestRenewableYear ? `${energy.latestRenewableYear}-01-01` : nowIso,
          status
        ),
        buildNormalized(
          prov.name,
          'energy',
          energy.countryName,
          'Electricity Per Capita',
          energy.latestElectricityKwhPerCapita,
          'kWh',
          energy.latestElectricityYear ? `${energy.latestElectricityYear}-01-01` : nowIso,
          status
        ),
      ];
      updateProviderMeta(id, status, nowIso, undefined, hasData ? null : 'World Bank energy metrics unavailable');
      const entry: CachedAdapterEntry = {
        cachedAtMs: Date.now(),
        report: {
          id: prov.id,
          name: prov.name,
          category: prov.category,
          endpoint: prov.endpoint,
          authType: prov.authType,
          hasKeyConfigured: true,
          status,
          isCached: false,
          cachedAt: nowIso,
          cacheAgeMinutes: 0,
          lastUpdated: nowIso,
          documentationUrl: prov.documentationUrl,
          readings,
        },
      };
      adapterCache.set(cacheKey, entry);
      return entry;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'World Bank API failed';
      updateProviderMeta(id, 'Error', nowIso, undefined, msg);
      return {
        cachedAtMs: Date.now(),
        report: {
          id: prov.id,
          name: prov.name,
          category: prov.category,
          endpoint: prov.endpoint,
          authType: prov.authType,
          hasKeyConfigured: true,
          status: 'Error',
          isCached: false,
          lastUpdated: nowIso,
          lastError: msg,
          documentationUrl: prov.documentationUrl,
          readings: [],
        },
      };
    }
  }

  // 4. OpenAQ v3 Ground Stations (Live if OPENAQ_API_KEY set, else automatic fallback to Open-Meteo AQ)
  if (id === 'openaq-v3') {
    const apiKey = runtimeSecrets.OPENAQ_API_KEY;
    let apiErrorMsg: string | null = null;
    if (apiKey) {
      try {
        const res = await fetchWithRetry(
          `https://api.openaq.org/v3/locations?coordinates=${ctx.lat},${ctx.lon}&radius=25000&limit=5`,
          { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } },
          1,
          6000
        );
        if (res.ok) {
          const json = (await res.json()) as {
            results?: Array<{ id: number; name: string; locality?: string; distance?: number }>;
          };
          const count = json.results?.length ?? 0;
          const status: ProviderHealthStatus = 'Live';
          const readings: NormalizedEnvReading[] = [
            buildNormalized(prov.name, 'air', ctx.locationName, 'Nearby Stations (25km)', count, 'stations', nowIso, status),
          ];
          updateProviderMeta(id, status, nowIso, undefined, null);
          const entry: CachedAdapterEntry = {
            cachedAtMs: Date.now(),
            report: {
              id: prov.id,
              name: prov.name,
              category: prov.category,
              endpoint: prov.endpoint,
              authType: prov.authType,
              envVarName: 'OPENAQ_API_KEY',
              hasKeyConfigured: true,
              status,
              isCached: false,
              cachedAt: nowIso,
              cacheAgeMinutes: 0,
              lastUpdated: nowIso,
              documentationUrl: prov.documentationUrl,
              readings,
            },
          };
          adapterCache.set(cacheKey, entry);
          return entry;
        } else {
          apiErrorMsg = `HTTP ${res.status}: ${res.statusText || 'Request failed'}`;
        }
      } catch (err) {
        apiErrorMsg = err instanceof Error ? err.message : String(err);
      }
    }

    const air = ctx.airData ?? (await fetchOpenMeteoAirQuality(ctx.lat, ctx.lon, 7).catch(() => null));
    if (!air) {
      const msg = apiErrorMsg ? `OpenAQ v3 error (${apiErrorMsg}) and Open-Meteo AQ fallback both failed` : 'OpenAQ v3 and Open-Meteo AQ fallback both failed';
      updateProviderMeta(id, 'Error', nowIso, undefined, msg);
      return {
        cachedAtMs: Date.now(),
        report: {
          id: prov.id,
          name: prov.name,
          category: prov.category,
          endpoint: prov.endpoint,
          authType: prov.authType,
          envVarName: 'OPENAQ_API_KEY',
          hasKeyConfigured: Boolean(apiKey),
          status: 'Error',
          isCached: false,
          lastUpdated: nowIso,
          lastError: msg,
          documentationUrl: prov.documentationUrl,
          readings: [],
        },
      };
    }

    const status: ProviderHealthStatus = 'Fallback';
    const fallbackProv = 'Open-Meteo AQ';
    const fallbackDesc = apiErrorMsg
      ? `OpenAQ error (${apiErrorMsg}) — using Open-Meteo AQ`
      : apiKey
        ? 'OpenAQ v3 unavailable — using Open-Meteo AQ'
        : 'OPENAQ_API_KEY not set — using Open-Meteo AQ';
    const lastErrText = apiErrorMsg ? `OpenAQ API error: ${apiErrorMsg}` : (apiKey ? 'OpenAQ v3 API unavailable' : 'OPENAQ_API_KEY not configured');

    const readings: NormalizedEnvReading[] = [
      buildNormalized(prov.name, 'air', ctx.locationName, 'PM2.5', air.current.pm25, 'µg/m³', air.current.time || nowIso, status, {
        viaSource: 'Open-Meteo AQ',
      }),
    ];
    updateProviderMeta(id, status, nowIso, fallbackDesc, lastErrText, false, fallbackProv);
    const entry: CachedAdapterEntry = {
      cachedAtMs: Date.now(),
      report: {
        id: prov.id,
        name: prov.name,
        category: prov.category,
        endpoint: prov.endpoint,
        authType: prov.authType,
        envVarName: 'OPENAQ_API_KEY',
        hasKeyConfigured: Boolean(apiKey),
        status,
        fallbackProvider: fallbackProv,
        fallbackDescription: fallbackDesc,
        lastError: lastErrText,
        isCached: false,
        cachedAt: nowIso,
        cacheAgeMinutes: 0,
        lastUpdated: nowIso,
        documentationUrl: prov.documentationUrl,
        readings,
      },
    };
    adapterCache.set(cacheKey, entry);
    return entry;
  }

  // 5. CPCB / data.gov.in Air & Water (Live with DATA_GOV_IN_API_KEY, else fallback to Open-Meteo AQ)
  if (id === 'cpcb-datagovin') {
    const apiKey = runtimeSecrets.DATA_GOV_IN_API_KEY;
    let apiErrorMsg: string | null = null;
    if (apiKey) {
      try {
        const city = ctx.locationName.split(',')[0].trim();
        const url = `${prov.endpoint}?api-key=${encodeURIComponent(apiKey)}&format=json&limit=5${city ? `&filters[city]=${encodeURIComponent(city)}` : ''}`;
        const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } }, 1, 6000);
        if (res.ok) {
          const json = (await res.json()) as { records?: Array<{ pollutant_id?: string; pollutant_avg?: string; station?: string }> };
          const recs = json.records ?? [];
          if (recs.length > 0) {
            const status: ProviderHealthStatus = 'Live';
            const readings = recs.slice(0, 3).map((r) =>
              buildNormalized(
                prov.name,
                'air',
                r.station || ctx.locationName,
                r.pollutant_id || 'Pollutant',
                r.pollutant_avg ? Number(r.pollutant_avg) : null,
                'µg/m³',
                nowIso,
                status
              )
            );
            updateProviderMeta(id, status, nowIso, undefined, null);
            const entry: CachedAdapterEntry = {
              cachedAtMs: Date.now(),
              report: {
                id: prov.id,
                name: prov.name,
                category: prov.category,
                endpoint: prov.endpoint,
                authType: prov.authType,
                envVarName: 'DATA_GOV_IN_API_KEY',
                hasKeyConfigured: true,
                status,
                isCached: false,
                cachedAt: nowIso,
                cacheAgeMinutes: 0,
                lastUpdated: nowIso,
                documentationUrl: prov.documentationUrl,
                readings,
              },
            };
            adapterCache.set(cacheKey, entry);
            return entry;
          } else {
            apiErrorMsg = 'data.gov.in returned zero records for location';
          }
        } else {
          apiErrorMsg = `HTTP ${res.status}: ${res.statusText || 'Request failed'}`;
        }
      } catch (err) {
        apiErrorMsg = err instanceof Error ? err.message : String(err);
      }
    }

    const air = ctx.airData ?? (await fetchOpenMeteoAirQuality(ctx.lat, ctx.lon, 7).catch(() => null));
    if (!air) {
      const msg = apiErrorMsg ? `data.gov.in error (${apiErrorMsg}) and Open-Meteo AQ fallback both failed` : 'CPCB / data.gov.in and Open-Meteo AQ fallback both failed';
      updateProviderMeta(id, 'Error', nowIso, undefined, msg);
      return {
        cachedAtMs: Date.now(),
        report: {
          id: prov.id,
          name: prov.name,
          category: prov.category,
          endpoint: prov.endpoint,
          authType: prov.authType,
          envVarName: 'DATA_GOV_IN_API_KEY',
          hasKeyConfigured: Boolean(apiKey),
          status: 'Error',
          isCached: false,
          lastUpdated: nowIso,
          lastError: msg,
          documentationUrl: prov.documentationUrl,
          readings: [],
        },
      };
    }

    const status: ProviderHealthStatus = 'Fallback';
    const fallbackProv = 'Open-Meteo AQ';
    const fallbackDesc = apiErrorMsg
      ? `data.gov.in error (${apiErrorMsg}) — using Open-Meteo AQ`
      : apiKey
        ? 'data.gov.in CPCB feed returned no matching station — using Open-Meteo AQ'
        : 'DATA_GOV_IN_API_KEY not set — using Open-Meteo AQ';
    const lastErrText = apiErrorMsg ? `data.gov.in API error: ${apiErrorMsg}` : (apiKey ? 'data.gov.in feed returned no records' : 'DATA_GOV_IN_API_KEY not configured');

    const readings: NormalizedEnvReading[] = [
      buildNormalized(prov.name, 'air', ctx.locationName, 'PM10', air.current.pm10, 'µg/m³', air.current.time || nowIso, status, {
        viaSource: 'Open-Meteo AQ',
      }),
    ];
    updateProviderMeta(id, status, nowIso, fallbackDesc, lastErrText, false, fallbackProv);
    const entry: CachedAdapterEntry = {
      cachedAtMs: Date.now(),
      report: {
        id: prov.id,
        name: prov.name,
        category: prov.category,
        endpoint: prov.endpoint,
        authType: prov.authType,
        envVarName: 'DATA_GOV_IN_API_KEY',
        hasKeyConfigured: Boolean(apiKey),
        status,
        fallbackProvider: fallbackProv,
        fallbackDescription: fallbackDesc,
        lastError: lastErrText,
        isCached: false,
        cachedAt: nowIso,
        cacheAgeMinutes: 0,
        lastUpdated: nowIso,
        documentationUrl: prov.documentationUrl,
        readings,
      },
    };
    adapterCache.set(cacheKey, entry);
    return entry;
  }

  // 6. UNEP GEMStat / India-WRIS / NWDP Water (Sample data fallback)
  if (id === 'unep-gemstat-water') {
    let liveReachable = false;
    try {
      const probe = await fetchWithRetry('https://gemstat.org/', { method: 'HEAD' }, 0, 2500);
      liveReachable = probe.ok;
    } catch {
      liveReachable = false;
    }

    const sample = getSampleWaterDataset(ctx.locationName, ctx.countryCode);
    const status: ProviderHealthStatus = 'Sample data';
    const fallbackDesc = liveReachable
      ? 'GEMStat portal reachable; automated JSON API requires institutional token — showing labeled Sample data'
      : 'Public water telemetry endpoints unavailable — showing labeled Sample data (pH, DO, BOD, Turbidity)';

    const readings: NormalizedEnvReading[] = [
      buildNormalized(sample.sourceLabel, 'water', ctx.locationName, 'pH', sample.inputs.ph, 'pH units', nowIso, status, {
        isSampleData: true,
        viaSource: 'Sample water dataset',
      }),
      buildNormalized(sample.sourceLabel, 'water', ctx.locationName, 'Dissolved Oxygen (DO)', sample.inputs.do, 'mg/L', nowIso, status, {
        isSampleData: true,
        viaSource: 'Sample water dataset',
      }),
      buildNormalized(sample.sourceLabel, 'water', ctx.locationName, 'BOD', sample.inputs.bod, 'mg/L', nowIso, status, {
        isSampleData: true,
        viaSource: 'Sample water dataset',
      }),
      buildNormalized(sample.sourceLabel, 'water', ctx.locationName, 'Turbidity', sample.inputs.turbidity, 'NTU', nowIso, status, {
        isSampleData: true,
        viaSource: 'Sample water dataset',
      }),
    ];

    updateProviderMeta(id, status, nowIso, fallbackDesc, null, true);
    const entry: CachedAdapterEntry = {
      cachedAtMs: Date.now(),
      report: {
        id: prov.id,
        name: prov.name,
        category: 'water',
        endpoint: prov.endpoint,
        authType: 'none',
        hasKeyConfigured: true,
        status,
        isSampleData: true,
        fallbackDescription: fallbackDesc,
        isCached: false,
        cachedAt: nowIso,
        cacheAgeMinutes: 0,
        lastUpdated: nowIso,
        documentationUrl: prov.documentationUrl,
        readings,
      },
    };
    adapterCache.set(cacheKey, entry);
    return entry;
  }

  // 7. World Bank What a Waste / SBM Urban / Sansaadhan (Sample city waste dataset + World Bank urban indicator)
  if (id === 'worldbank-waste') {
    let urbanPct: number | null = null;
    let urbanYear = '';
    try {
      const cc = (ctx.countryCode || 'IN').toUpperCase();
      const wbRes = await fetchWithRetry(
        `https://api.worldbank.org/v2/country/${encodeURIComponent(cc)}/indicator/SP.URB.TOTL.IN.ZS?format=json&per_page=5`,
        undefined,
        1,
        5000
      );
      if (wbRes.ok) {
        const wbJson = (await wbRes.json()) as [unknown, Array<{ date: string; value: number | null }>];
        const row = (wbJson?.[1] ?? []).find((r) => r.value !== null);
        if (row && row.value !== null) {
          urbanPct = Number(row.value.toFixed(1));
          urbanYear = row.date;
        }
      }
    } catch {
      // Keep sample fallback
    }

    const sampleWaste = getSampleWasteDataset(ctx.locationName, ctx.countryCode);
    const status: ProviderHealthStatus = 'Sample data';
    const fallbackDesc =
      urbanPct !== null
        ? `City-level waste flows shown as labeled Sample data (World Bank urban share: ${urbanPct}%, ${urbanYear})`
        : 'City-level municipal waste streams shown as clearly labeled Sample data';

    const readings: NormalizedEnvReading[] = [
      buildNormalized(
        sampleWaste.sourceLabel,
        'waste',
        ctx.locationName,
        'Waste Generated',
        sampleWaste.inputs.totalGenerated,
        sampleWaste.inputs.unit,
        nowIso,
        status,
        { isSampleData: true, viaSource: 'Sample waste dataset' }
      ),
      buildNormalized(
        sampleWaste.sourceLabel,
        'waste',
        ctx.locationName,
        'Recycled / Recovered',
        sampleWaste.inputs.recycledOrRecovered,
        sampleWaste.inputs.unit,
        nowIso,
        status,
        { isSampleData: true, viaSource: 'Sample waste dataset' }
      ),
      ...(urbanPct !== null
        ? [
            buildNormalized(
              'World Bank Open Data',
              'waste',
              ctx.countryCode,
              'Urban Population Share',
              urbanPct,
              '%',
              `${urbanYear}-01-01`,
              'Live',
              { viaSource: 'World Bank' }
            ),
          ]
        : []),
    ];

    updateProviderMeta(id, status, nowIso, fallbackDesc, null, true);
    const entry: CachedAdapterEntry = {
      cachedAtMs: Date.now(),
      report: {
        id: prov.id,
        name: prov.name,
        category: 'waste',
        endpoint: prov.endpoint,
        authType: 'none',
        hasKeyConfigured: true,
        status,
        isSampleData: true,
        fallbackDescription: fallbackDesc,
        isCached: false,
        cachedAt: nowIso,
        cacheAgeMinutes: 0,
        lastUpdated: nowIso,
        documentationUrl: prov.documentationUrl,
        readings,
      },
    };
    adapterCache.set(cacheKey, entry);
    return entry;
  }

  // 8. Ember Energy Data API (Live with EMBER_API_KEY, else fallback to World Bank Energy)
  if (id === 'ember-energy') {
    const apiKey = runtimeSecrets.EMBER_API_KEY;
    const countryName = ctx.energyData?.countryName || (ctx.countryCode === 'IN' ? 'India' : ctx.countryCode);
    let apiErrorMsg: string | null = null;
    if (apiKey) {
      try {
        const url = `${prov.endpoint}?entity=${encodeURIComponent(countryName)}&api_key=${encodeURIComponent(apiKey)}`;
        const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } }, 1, 6000);
        if (res.ok) {
          const json = (await res.json()) as {
            data?: Array<{ date?: string; generation_twh?: number; series?: string }>;
          };
          const rows = json.data ?? [];
          const total = rows.reduce((sum, r) => sum + (Number(r.generation_twh) || 0), 0);
          const latestDate = rows[rows.length - 1]?.date || nowIso;
          const status: ProviderHealthStatus = 'Live';
          const readings: NormalizedEnvReading[] = [
            buildNormalized(prov.name, 'energy', countryName, 'Monthly Generation Sample', Number(total.toFixed(2)), 'TWh', latestDate, status),
          ];
          updateProviderMeta(id, status, nowIso, undefined, null);
          const entry: CachedAdapterEntry = {
            cachedAtMs: Date.now(),
            extra: {
              available: true,
              status,
              source: prov.name,
              latestGenerationTwh: Number(total.toFixed(2)),
              latestCleanSharePct: null,
              period: latestDate,
              isFallback: false,
            },
            report: {
              id: prov.id,
              name: prov.name,
              category: 'energy',
              endpoint: prov.endpoint,
              authType: prov.authType,
              envVarName: 'EMBER_API_KEY',
              hasKeyConfigured: true,
              status,
              isCached: false,
              cachedAt: nowIso,
              cacheAgeMinutes: 0,
              lastUpdated: nowIso,
              documentationUrl: prov.documentationUrl,
              readings,
            },
          };
          adapterCache.set(cacheKey, entry);
          return entry;
        } else {
          apiErrorMsg = `HTTP ${res.status}: ${res.statusText || 'Request failed'}`;
        }
      } catch (err) {
        apiErrorMsg = err instanceof Error ? err.message : String(err);
      }
    }

    const energy = ctx.energyData ?? (await fetchWorldBankEnergy(ctx.countryCode).catch(() => null));
    if (!energy) {
      const msg = apiErrorMsg ? `Ember Energy error (${apiErrorMsg}) and World Bank fallback both failed` : 'Ember Energy API and World Bank fallback both failed';
      updateProviderMeta(id, 'Error', nowIso, undefined, msg);
      return {
        cachedAtMs: Date.now(),
        extra: {
          available: false,
          status: 'Error',
          source: prov.name,
          latestGenerationTwh: null,
          latestCleanSharePct: null,
          period: null,
          isFallback: true,
        },
        report: {
          id: prov.id,
          name: prov.name,
          category: 'energy',
          endpoint: prov.endpoint,
          authType: prov.authType,
          envVarName: 'EMBER_API_KEY',
          hasKeyConfigured: Boolean(apiKey),
          status: 'Error',
          isCached: false,
          lastUpdated: nowIso,
          lastError: msg,
          documentationUrl: prov.documentationUrl,
          readings: [],
        },
      };
    }

    const status: ProviderHealthStatus = 'Fallback';
    const fallbackProv = 'World Bank';
    const fallbackDesc = apiErrorMsg
      ? `Ember error (${apiErrorMsg}) — using World Bank electricity indicators`
      : apiKey
        ? 'Ember Energy API unreachable — using World Bank electricity indicators'
        : 'EMBER_API_KEY not set — using World Bank electricity & renewable indicators';
    const lastErrText = apiErrorMsg ? `Ember API error: ${apiErrorMsg}` : (apiKey ? 'Ember API unavailable' : 'EMBER_API_KEY not configured');

    const readings: NormalizedEnvReading[] = [
      buildNormalized(
        prov.name,
        'energy',
        energy.countryName,
        'Renewable Share',
        energy.latestRenewablePct,
        '%',
        energy.latestRenewableYear ? `${energy.latestRenewableYear}-01-01` : nowIso,
        status,
        { viaSource: 'World Bank' }
      ),
    ];
    updateProviderMeta(id, status, nowIso, fallbackDesc, lastErrText, false, fallbackProv);
    const entry: CachedAdapterEntry = {
      cachedAtMs: Date.now(),
      extra: {
        available: true,
        status,
        source: 'World Bank Open Data Fallback',
        latestGenerationTwh: null,
        latestCleanSharePct: energy.latestRenewablePct ?? null,
        period: energy.latestRenewableYear ? String(energy.latestRenewableYear) : null,
        isFallback: true,
      },
      report: {
        id: prov.id,
        name: prov.name,
        category: 'energy',
        endpoint: prov.endpoint,
        authType: prov.authType,
        envVarName: 'EMBER_API_KEY',
        hasKeyConfigured: Boolean(apiKey),
        status,
        fallbackProvider: fallbackProv,
        fallbackDescription: fallbackDesc,
        lastError: lastErrText,
        isCached: false,
        cachedAt: nowIso,
        cacheAgeMinutes: 0,
        lastUpdated: nowIso,
        documentationUrl: prov.documentationUrl,
        readings,
      },
    };
    adapterCache.set(cacheKey, entry);
    return entry;
  }

  // Custom user/admin registered HTTPS providers
  const status: ProviderHealthStatus = prov.hasKeyConfigured ? 'Live' : 'Fallback';
  return {
    cachedAtMs: Date.now(),
    report: {
      id: prov.id,
      name: prov.name,
      category: prov.category,
      endpoint: prov.endpoint,
      authType: prov.authType,
      envVarName: prov.envVarName,
      hasKeyConfigured: prov.hasKeyConfigured,
      status,
      isCached: false,
      lastUpdated: prov.lastSyncAt,
      lastError: prov.lastError,
      documentationUrl: prov.documentationUrl,
      readings: [],
    },
  };
}

export async function getAllDataSourcesSnapshot(ctx: AdapterContext): Promise<{
  dataSources: DataSourceReport[];
  emberMeta: Record<string, unknown> | undefined;
}> {
  const entries = await Promise.all(providers.map((p) => runSingleAdapter(p.id, ctx)));
  const emberEntry = entries.find((e) => e.report.id === 'ember-energy');
  return {
    dataSources: entries.map((e) => e.report),
    emberMeta: emberEntry?.extra,
  };
}

export async function testProviderConnection(
  id: string,
  coords?: { lat?: number; lon?: number; countryCode?: string; locationName?: string }
): Promise<{
  ok: boolean;
  status: string;
  healthStatus: ProviderHealthStatus;
  message: string;
  checkedAt: string;
  sourceReport?: DataSourceReport;
}> {
  const checkedAt = new Date().toISOString();
  const provider = providers.find((p) => p.id === id);
  if (!provider) {
    return {
      ok: false,
      status: 'Error',
      healthStatus: 'Error',
      message: 'Provider not found',
      checkedAt,
    };
  }

  try {
    const entry = await runSingleAdapter(id, {
      lat: coords?.lat ?? 28.65195,
      lon: coords?.lon ?? 77.23149,
      countryCode: coords?.countryCode ?? 'IN',
      locationName: coords?.locationName ?? 'Delhi, India',
      bypassCache: true,
    });
    const rep = entry.report;
    const ok = rep.status !== 'Error';
    const message =
      rep.status === 'Live'
        ? `Live: verified ${rep.readings.length} reading(s) directly from ${rep.name}.`
        : rep.status === 'Fallback'
          ? `Fallback (${rep.fallbackProvider || 'Alternate Feed'}): ${rep.fallbackDescription || 'serving fallback feed'}`
          : rep.status === 'Sample data'
            ? `Sample data: ${rep.fallbackDescription || 'no live REST endpoint available; serving labeled sample values.'}`
            : rep.lastError || 'Endpoint check returned error';

    addSyncLog({
      providerId: id,
      providerName: provider.name,
      locationName: coords?.locationName || 'Connection Verification',
      status: ok ? 'success' : 'error',
      recordsIngested: rep.readings.length,
      message,
      syncedAt: checkedAt,
    });

    return {
      ok,
      status: rep.status,
      healthStatus: rep.status,
      message,
      checkedAt,
      sourceReport: rep,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection verification failed';
    updateProviderMeta(id, 'Error', checkedAt, undefined, msg);
    addSyncLog({
      providerId: id,
      providerName: provider.name,
      locationName: 'Connection Verification',
      status: 'error',
      recordsIngested: 0,
      message: msg,
      syncedAt: checkedAt,
    });
    return {
      ok: false,
      status: 'Error',
      healthStatus: 'Error',
      message: msg,
      checkedAt,
    };
  }
}
