import { AqiResult, DataOriginType, PollutantReading } from '../types';

interface Breakpoint {
  cLow: number;
  cHigh: number;
  iLow: number;
  iHigh: number;
}

// Official India CPCB National AQI Breakpoints (24-hr for PM2.5, PM10, NO2, SO2; 8-hr for CO mg/m3, O3 ug/m3)
const CPCB_BREAKPOINTS: Record<string, Breakpoint[]> = {
  'PM2.5': [
    { cLow: 0, cHigh: 30, iLow: 0, iHigh: 50 },
    { cLow: 30.1, cHigh: 60, iLow: 51, iHigh: 100 },
    { cLow: 60.1, cHigh: 90, iLow: 101, iHigh: 200 },
    { cLow: 90.1, cHigh: 120, iLow: 201, iHigh: 300 },
    { cLow: 120.1, cHigh: 250, iLow: 301, iHigh: 400 },
    { cLow: 250.1, cHigh: 500, iLow: 401, iHigh: 500 },
  ],
  PM10: [
    { cLow: 0, cHigh: 50, iLow: 0, iHigh: 50 },
    { cLow: 50.1, cHigh: 100, iLow: 51, iHigh: 100 },
    { cLow: 100.1, cHigh: 250, iLow: 101, iHigh: 200 },
    { cLow: 250.1, cHigh: 350, iLow: 201, iHigh: 300 },
    { cLow: 350.1, cHigh: 430, iLow: 301, iHigh: 400 },
    { cLow: 430.1, cHigh: 1000, iLow: 401, iHigh: 500 },
  ],
  NO2: [
    { cLow: 0, cHigh: 40, iLow: 0, iHigh: 50 },
    { cLow: 40.1, cHigh: 80, iLow: 51, iHigh: 100 },
    { cLow: 80.1, cHigh: 180, iLow: 101, iHigh: 200 },
    { cLow: 180.1, cHigh: 280, iLow: 201, iHigh: 300 },
    { cLow: 280.1, cHigh: 400, iLow: 301, iHigh: 400 },
    { cLow: 400.1, cHigh: 800, iLow: 401, iHigh: 500 },
  ],
  SO2: [
    { cLow: 0, cHigh: 40, iLow: 0, iHigh: 50 },
    { cLow: 40.1, cHigh: 80, iLow: 51, iHigh: 100 },
    { cLow: 80.1, cHigh: 380, iLow: 101, iHigh: 200 },
    { cLow: 380.1, cHigh: 800, iLow: 201, iHigh: 300 },
    { cLow: 800.1, cHigh: 1600, iLow: 301, iHigh: 400 },
    { cLow: 1600.1, cHigh: 2400, iLow: 401, iHigh: 500 },
  ],
  // CO in mg/m3
  CO: [
    { cLow: 0, cHigh: 1.0, iLow: 0, iHigh: 50 },
    { cLow: 1.01, cHigh: 2.0, iLow: 51, iHigh: 100 },
    { cLow: 2.01, cHigh: 10.0, iLow: 101, iHigh: 200 },
    { cLow: 10.01, cHigh: 17.0, iLow: 201, iHigh: 300 },
    { cLow: 17.01, cHigh: 34.0, iLow: 301, iHigh: 400 },
    { cLow: 34.01, cHigh: 60.0, iLow: 401, iHigh: 500 },
  ],
  O3: [
    { cLow: 0, cHigh: 50, iLow: 0, iHigh: 50 },
    { cLow: 50.1, cHigh: 100, iLow: 51, iHigh: 100 },
    { cLow: 100.1, cHigh: 168, iLow: 101, iHigh: 200 },
    { cLow: 168.1, cHigh: 208, iLow: 201, iHigh: 300 },
    { cLow: 208.1, cHigh: 748, iLow: 301, iHigh: 400 },
    { cLow: 748.1, cHigh: 1000, iLow: 401, iHigh: 500 },
  ],
};

// US EPA AQI Breakpoints (ug/m3 for PM2.5, PM10; ppb approximations via standard molecular weights)
const US_EPA_BREAKPOINTS: Record<string, Breakpoint[]> = {
  'PM2.5': [
    { cLow: 0, cHigh: 9.0, iLow: 0, iHigh: 50 },
    { cLow: 9.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
    { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
    { cLow: 55.5, cHigh: 125.4, iLow: 151, iHigh: 200 },
    { cLow: 125.5, cHigh: 225.4, iLow: 201, iHigh: 300 },
    { cLow: 225.5, cHigh: 500.4, iLow: 301, iHigh: 500 },
  ],
  PM10: [
    { cLow: 0, cHigh: 54, iLow: 0, iHigh: 50 },
    { cLow: 55, cHigh: 154, iLow: 51, iHigh: 100 },
    { cLow: 155, cHigh: 254, iLow: 101, iHigh: 150 },
    { cLow: 255, cHigh: 354, iLow: 151, iHigh: 200 },
    { cLow: 355, cHigh: 424, iLow: 201, iHigh: 300 },
    { cLow: 425, cHigh: 604, iLow: 301, iHigh: 500 },
  ],
  // NO2 in ug/m3 (1 ppb ~ 1.88 ug/m3)
  NO2: [
    { cLow: 0, cHigh: 100, iLow: 0, iHigh: 50 },
    { cLow: 101, cHigh: 188, iLow: 51, iHigh: 100 },
    { cLow: 189, cHigh: 677, iLow: 101, iHigh: 150 },
    { cLow: 678, cHigh: 1220, iLow: 151, iHigh: 200 },
    { cLow: 1221, cHigh: 2348, iLow: 201, iHigh: 300 },
  ],
  // SO2 in ug/m3 (1 ppb ~ 2.62 ug/m3)
  SO2: [
    { cLow: 0, cHigh: 92, iLow: 0, iHigh: 50 },
    { cLow: 93, cHigh: 197, iLow: 51, iHigh: 100 },
    { cLow: 198, cHigh: 485, iLow: 101, iHigh: 150 },
    { cLow: 486, cHigh: 796, iLow: 151, iHigh: 200 },
    { cLow: 797, cHigh: 1582, iLow: 201, iHigh: 300 },
  ],
  // CO in mg/m3 (1 ppm ~ 1.145 mg/m3)
  CO: [
    { cLow: 0, cHigh: 5.0, iLow: 0, iHigh: 50 },
    { cLow: 5.1, cHigh: 10.8, iLow: 51, iHigh: 100 },
    { cLow: 10.9, cHigh: 14.2, iLow: 101, iHigh: 150 },
    { cLow: 14.3, cHigh: 17.6, iLow: 151, iHigh: 200 },
    { cLow: 17.7, cHigh: 34.8, iLow: 201, iHigh: 300 },
  ],
  // O3 in ug/m3 (1 ppb ~ 1.96 ug/m3)
  O3: [
    { cLow: 0, cHigh: 106, iLow: 0, iHigh: 50 },
    { cLow: 107, cHigh: 137, iLow: 51, iHigh: 100 },
    { cLow: 138, cHigh: 167, iLow: 101, iHigh: 150 },
    { cLow: 168, cHigh: 206, iLow: 151, iHigh: 200 },
    { cLow: 207, cHigh: 392, iLow: 201, iHigh: 300 },
  ],
};

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'NO', 'CH',
]);

function interpolateSubIndex(conc: number, table: Breakpoint[]): number {
  if (conc < 0) return 0;
  for (const bp of table) {
    if (conc >= bp.cLow && conc <= bp.cHigh) {
      return Math.round(((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (conc - bp.cLow) + bp.iLow);
    }
  }
  const last = table[table.length - 1];
  if (conc > last.cHigh) return last.iHigh;
  return 0;
}

function classifyCpcb(aqi: number): { category: string; severity: AqiResult['severityLevel']; guidance: string } {
  if (aqi <= 50) return { category: 'Good', severity: 'good', guidance: 'Minimal health impact. Safe for normal outdoor activities.' };
  if (aqi <= 100) return { category: 'Satisfactory', severity: 'good', guidance: 'Minor breathing discomfort possible for unusually sensitive people.' };
  if (aqi <= 200) return { category: 'Moderate', severity: 'moderate', guidance: 'People with asthma, lung or heart conditions should reduce prolonged outdoor exertion.' };
  if (aqi <= 300) return { category: 'Poor', severity: 'poor', guidance: 'Breathing discomfort on prolonged exposure. Sensitive groups should wear masks and limit outdoor time.' };
  if (aqi <= 400) return { category: 'Very Poor', severity: 'severe', guidance: 'Respiratory illness risk on prolonged exposure. Avoid outdoor exercise; use indoor air filtration where available.' };
  return { category: 'Severe', severity: 'severe', guidance: 'Serious health risk even for healthy people. Stay indoors, keep windows sealed, and follow local advisories.' };
}

function classifyUsEpa(aqi: number): { category: string; severity: AqiResult['severityLevel']; guidance: string } {
  if (aqi <= 50) return { category: 'Good', severity: 'good', guidance: 'Air quality is satisfactory and poses little or no risk.' };
  if (aqi <= 100) return { category: 'Moderate', severity: 'moderate', guidance: 'Unusually sensitive individuals should consider limiting prolonged outdoor exertion.' };
  if (aqi <= 150) return { category: 'Unhealthy for Sensitive Groups', severity: 'poor', guidance: 'Children, older adults, and people with respiratory or heart disease should reduce outdoor exertion.' };
  if (aqi <= 200) return { category: 'Unhealthy', severity: 'poor', guidance: 'Everyone may begin to experience health effects; limit prolonged outdoor exertion.' };
  if (aqi <= 300) return { category: 'Very Unhealthy', severity: 'severe', guidance: 'Health alert: everyone may experience more serious health effects. Avoid outdoor physical activity.' };
  return { category: 'Hazardous', severity: 'severe', guidance: 'Health warning of emergency conditions. Remain indoors and keep activity levels low.' };
}

function computeEuEaqiBand(param: string, value: number): number {
  // Returns 1 (Good) to 6 (Extremely Poor) per EEA EAQI thresholds (ug/m3)
  const thresholds: Record<string, number[]> = {
    'PM2.5': [10, 20, 25, 50, 75],
    PM10: [20, 40, 50, 100, 150],
    NO2: [40, 90, 120, 230, 340],
    O3: [50, 100, 130, 240, 380],
    SO2: [100, 200, 350, 500, 750],
  };
  const t = thresholds[param];
  if (!t) return 1;
  for (let i = 0; i < t.length; i++) {
    if (value <= t[i]) return i + 1;
  }
  return 6;
}

function computeUkDaqiBand(param: string, value: number): number {
  // Returns 1 to 10 per UK DEFRA DAQI thresholds (ug/m3)
  const thresholds: Record<string, number[]> = {
    'PM2.5': [11, 23, 35, 41, 47, 53, 58, 64, 70],
    PM10: [16, 33, 50, 58, 66, 75, 83, 91, 100],
    NO2: [67, 134, 200, 267, 334, 400, 467, 534, 600],
    O3: [33, 66, 100, 120, 140, 160, 187, 213, 240],
    SO2: [88, 177, 266, 354, 443, 532, 710, 887, 1064],
  };
  const t = thresholds[param];
  if (!t) return 1;
  for (let i = 0; i < t.length; i++) {
    if (value <= t[i]) return i + 1;
  }
  return 10;
}

export function calculateJurisdictionAqi(params: {
  countryCode: string;
  readings: {
    pm25: number | null;
    pm10: number | null;
    coUgM3: number | null; // Open-Meteo returns CO in ug/m3; convert to mg/m3
    no2: number | null;
    so2: number | null;
    o3: number | null;
  };
  source: string;
  station: string;
  lastUpdated: string | null;
  originType?: DataOriginType;
}): AqiResult {
  const cc = (params.countryCode || 'US').toUpperCase();
  const coMgM3 = params.readings.coUgM3 !== null ? Number((params.readings.coUgM3 / 1000).toFixed(3)) : null;

  const rawList: Array<{ key: PollutantReading['parameter']; value: number | null; unit: string }> = [
    { key: 'PM2.5', value: params.readings.pm25, unit: 'µg/m³' },
    { key: 'PM10', value: params.readings.pm10, unit: 'µg/m³' },
    { key: 'NO2', value: params.readings.no2, unit: 'µg/m³' },
    { key: 'SO2', value: params.readings.so2, unit: 'µg/m³' },
    { key: 'CO', value: coMgM3, unit: 'mg/m³' },
    { key: 'O3', value: params.readings.o3, unit: 'µg/m³' },
  ];

  const available = rawList.filter((r) => r.value !== null && Number.isFinite(r.value));
  const originType: DataOriginType = params.originType ?? 'latest_available';

  if (available.length === 0) {
    return {
      aqi: null,
      standardCode: cc === 'IN' ? 'CPCB_IN' : EU_COUNTRY_CODES.has(cc) ? 'EU_EAQI' : cc === 'GB' ? 'UK_DAQI' : 'US_EPA',
      standardName:
        cc === 'IN'
          ? 'India CPCB National AQI'
          : EU_COUNTRY_CODES.has(cc)
            ? 'European Air Quality Index (EAQI)'
            : cc === 'GB'
              ? 'UK Daily Air Quality Index (DAQI)'
              : 'US EPA National AQI',
      category: 'Data Unavailable',
      severityLevel: 'unavailable',
      dominantPollutant: null,
      pollutants: rawList.map((r) => ({ parameter: r.key, value: null, unit: r.unit, subIndex: null })),
      healthGuidance: 'Insufficient pollutant readings to compute an official AQI.',
      source: params.source,
      station: params.station,
      lastUpdated: params.lastUpdated,
      originType,
    };
  }

  // India CPCB National AQI (requires PM2.5 or PM10 plus at least 3 pollutants ideally; computes max sub-index transparently)
  if (cc === 'IN') {
    const pollutants: PollutantReading[] = rawList.map((r) => {
      if (r.value === null) return { parameter: r.key, value: null, unit: r.unit, subIndex: null };
      const sub = interpolateSubIndex(r.value, CPCB_BREAKPOINTS[r.key]);
      return { parameter: r.key, value: Number(r.value.toFixed(2)), unit: r.unit, subIndex: sub };
    });
    const validSubs = pollutants.filter((p) => p.subIndex !== null);
    const maxEntry = validSubs.reduce((a, b) => ((b.subIndex ?? 0) > (a.subIndex ?? 0) ? b : a));
    const aqi = maxEntry.subIndex ?? 0;
    const cls = classifyCpcb(aqi);
    return {
      aqi,
      standardCode: 'CPCB_IN',
      standardName: 'India CPCB National AQI (NAQI)',
      category: cls.category,
      severityLevel: cls.severity,
      dominantPollutant: maxEntry.parameter,
      pollutants,
      healthGuidance: cls.guidance,
      source: params.source,
      station: params.station,
      lastUpdated: params.lastUpdated,
      originType,
    };
  }

  // European Air Quality Index (EAQI 1-6)
  if (EU_COUNTRY_CODES.has(cc)) {
    const euLabels = ['Good', 'Fair', 'Moderate', 'Poor', 'Very Poor', 'Extremely Poor'];
    const pollutants: PollutantReading[] = rawList.map((r) => {
      if (r.value === null || r.key === 'CO') {
        return { parameter: r.key, value: r.value !== null ? Number(r.value.toFixed(2)) : null, unit: r.unit, subIndex: null };
      }
      const band = computeEuEaqiBand(r.key, r.value);
      return { parameter: r.key, value: Number(r.value.toFixed(2)), unit: r.unit, subIndex: band, category: euLabels[band - 1] };
    });
    const validSubs = pollutants.filter((p) => p.subIndex !== null);
    const maxEntry = validSubs.reduce((a, b) => ((b.subIndex ?? 0) > (a.subIndex ?? 0) ? b : a));
    const band = maxEntry.subIndex ?? 1;
    const severity: AqiResult['severityLevel'] =
      band <= 2 ? 'good' : band === 3 ? 'moderate' : band === 4 ? 'poor' : 'severe';
    return {
      aqi: band,
      standardCode: 'EU_EAQI',
      standardName: 'European Air Quality Index (EAQI 1–6)',
      category: euLabels[band - 1],
      severityLevel: severity,
      dominantPollutant: maxEntry.parameter,
      pollutants,
      healthGuidance:
        band <= 2
          ? 'Enjoy your usual outdoor activities.'
          : band === 3
            ? 'Consider reducing intense outdoor activities if you experience symptoms.'
            : 'Reduce intense physical activity outdoors, especially for sensitive groups.',
      source: params.source,
      station: params.station,
      lastUpdated: params.lastUpdated,
      originType,
    };
  }

  // UK Daily Air Quality Index (DAQI 1-10)
  if (cc === 'GB') {
    const pollutants: PollutantReading[] = rawList.map((r) => {
      if (r.value === null || r.key === 'CO') {
        return { parameter: r.key, value: r.value !== null ? Number(r.value.toFixed(2)) : null, unit: r.unit, subIndex: null };
      }
      const band = computeUkDaqiBand(r.key, r.value);
      return { parameter: r.key, value: Number(r.value.toFixed(2)), unit: r.unit, subIndex: band };
    });
    const validSubs = pollutants.filter((p) => p.subIndex !== null);
    const maxEntry = validSubs.reduce((a, b) => ((b.subIndex ?? 0) > (a.subIndex ?? 0) ? b : a));
    const daqi = maxEntry.subIndex ?? 1;
    const category = daqi <= 3 ? 'Low' : daqi <= 6 ? 'Moderate' : daqi <= 9 ? 'High' : 'Very High';
    const severity: AqiResult['severityLevel'] =
      daqi <= 3 ? 'good' : daqi <= 6 ? 'moderate' : daqi <= 9 ? 'poor' : 'severe';
    return {
      aqi: daqi,
      standardCode: 'UK_DAQI',
      standardName: 'UK Daily Air Quality Index (DAQI 1–10)',
      category,
      severityLevel: severity,
      dominantPollutant: maxEntry.parameter,
      pollutants,
      healthGuidance:
        daqi <= 3
          ? 'Enjoy your usual outdoor activities.'
          : daqi <= 6
            ? 'Adults and children with lung or heart problems who experience symptoms should reduce strenuous activity.'
            : 'Anyone experiencing discomfort such as sore eyes, cough or sore throat should reduce physical exertion outdoors.',
      source: params.source,
      station: params.station,
      lastUpdated: params.lastUpdated,
      originType,
    };
  }

  // Default: US EPA National AQI (0–500)
  const pollutants: PollutantReading[] = rawList.map((r) => {
    if (r.value === null) return { parameter: r.key, value: null, unit: r.unit, subIndex: null };
    const sub = interpolateSubIndex(r.value, US_EPA_BREAKPOINTS[r.key]);
    return { parameter: r.key, value: Number(r.value.toFixed(2)), unit: r.unit, subIndex: sub };
  });
  const validSubs = pollutants.filter((p) => p.subIndex !== null);
  const maxEntry = validSubs.reduce((a, b) => ((b.subIndex ?? 0) > (a.subIndex ?? 0) ? b : a));
  const aqi = maxEntry.subIndex ?? 0;
  const cls = classifyUsEpa(aqi);
  return {
    aqi,
    standardCode: 'US_EPA',
    standardName: 'US EPA National AQI',
    category: cls.category,
    severityLevel: cls.severity,
    dominantPollutant: maxEntry.parameter,
    pollutants,
    healthGuidance: cls.guidance,
    source: params.source,
    station: params.station,
    lastUpdated: params.lastUpdated,
    originType,
  };
}
