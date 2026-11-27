import crypto from 'crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export const MODEL_CHAIN = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-4-hydrogen',
] as const;

const GEMINI_TIMEOUT_MS = 11_000;

// Circuit breaker map: modelId -> blockedUntilMs timestamp
const modelBlockedUntil = new Map<string, number>();

// Server-side summary cache: cacheKey -> { expiresAt: number; summaryData: any }
const summaryCache = new Map<string, { expiresAt: number; summaryData: unknown }>();
const SUMMARY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function computeSummaryCacheKey(locationName: string, reportingPeriod: string, context: unknown): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify(context)).digest('hex').slice(0, 16);
  return `${locationName.toLowerCase().trim()}|${reportingPeriod.toLowerCase().trim()}|${hash}`;
}

export function getCachedSummary(key: string): unknown | null {
  const entry = summaryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    summaryCache.delete(key);
    return null;
  }
  return entry.summaryData;
}

export function setCachedSummary(key: string, data: unknown) {
  summaryCache.set(key, {
    expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS,
    summaryData: data,
  });
}

export function formatModelBadge(modelId: string): string {
  switch (modelId) {
    case 'gemini-4-hydrogen':
      return 'Gemini 4 Hydrogen';
    case 'gemini-flash-latest':
      return 'Gemini Flash Latest';
    case 'gemini-flash-lite-latest':
      return 'Gemini Flash Lite Latest';
    default:
      return modelId;
  }
}

function supportsThinkingLevel(modelId: string): boolean {
  return modelId.startsWith('gemini-4') || modelId.startsWith('gemini-3');
}

function parseRetryDelayMs(errMsg: string): number {
  const match = errMsg.match(/retry in\s+([0-9.]+)([smhd])?/i);
  if (!match) return 3600 * 1000; // default 1 hour if not specified
  const val = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  if (unit === 'm') return val * 60 * 1000;
  if (unit === 'h') return val * 3600 * 1000;
  if (unit === 'd') return val * 24 * 3600 * 1000;
  return val * 1000; // seconds
}

function is429QuotaError(err: unknown): boolean {
  if (!err) return false;
  const s = String(err);
  return /429|RESOURCE_EXHAUSTED|quota/i.test(s);
}

function formatShortError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; code?: string | number; message?: string };
    const statusPart = e.status ? `[HTTP ${e.status}] ` : e.code ? `[${e.code}] ` : '';
    const msg = e.message || String(err);
    const shortMsg = msg.split('\n')[0].slice(0, 120);
    return `${statusPart}${shortMsg}`;
  }
  return String(err).split('\n')[0].slice(0, 120);
}

function getClient(modelId?: string): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const useV1Beta = Boolean(modelId && modelId.endsWith('-latest'));
  return new GoogleGenAI({
    apiKey,
    ...(useV1Beta ? { apiVersion: 'v1beta' } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export interface CompactSummaryContext {
  aqi?: {
    aqi: number | null;
    standardName?: string;
    category?: string;
    dominantPollutant?: string | null;
    pollutants?: Array<{ parameter: string; value: number | null; unit: string }>;
  };
  airStats?: {
    avgPm25?: number | null;
    maxPm25?: number | null;
    trend6hDelta?: number | null;
  };
  weather?: {
    temperatureC?: number | null;
    humidityPct?: number | null;
    windSpeedKmh?: number | null;
    weatherLabel?: string;
    warningsCount?: number;
  } | null;
  water?: {
    wqi?: number | null;
    classification?: string;
    waterUse?: string;
    isSampleData?: boolean;
  } | null;
  waste?: {
    wmi?: number | null;
    classification?: string;
    weakestComponent?: string | null;
    isSampleData?: boolean;
  } | null;
  energy?: {
    latestRenewablePct?: number | null;
    latestRenewableYear?: number | null;
    latestElectricityKwhPerCapita?: number | null;
  } | null;
  anomalies?: Array<{
    parameter: string;
    observedValue: number;
    baselineValue: number;
    unit: string;
    severity: string;
    reason?: string;
  }>;
}

export type SnapshotSourceStatus = 'Live' | 'Fallback' | 'Sample' | 'Error';

export interface CompactChatSnapshot {
  location: {
    name: string;
    countryCode: string;
    latitude: number;
    longitude: number;
  };
  reportingPeriod: string;
  air: {
    aqi: number | null;
    standardName: string;
    category: string;
    dominantPollutant: string | null;
    pm25: number | null;
    pm10: number | null;
    no2: number | null;
    o3: number | null;
    source: string;
    sourceStatus: SnapshotSourceStatus;
    healthGuidance: string;
    lastUpdated: string | null;
  } | null;
  weather: {
    temperatureC: number | null;
    humidityPct: number | null;
    windSpeedKmh: number | null;
    weatherLabel: string;
    warningsCount: number;
    sourceStatus: SnapshotSourceStatus;
  } | null;
  water: {
    wqi: number | null;
    classification: string;
    waterUse: string;
    source: string;
    sourceStatus: SnapshotSourceStatus;
    deteriorationDrivers?: string[];
  } | null;
  waste: {
    wmi: number | null;
    classification: string;
    weakestComponent: string | null;
    source: string;
    sourceStatus: SnapshotSourceStatus;
  } | null;
  energy: {
    latestRenewablePct: number | null;
    latestRenewableYear: number | null;
    latestElectricityKwhPerCapita: number | null;
    source: string;
    sourceStatus: SnapshotSourceStatus;
    fallbackProvider?: string;
  } | null;
  anomalies: Array<{
    parameter: string;
    observedValue: number;
    baselineValue: number;
    unit: string;
    severity: string;
    reason: string;
  }>;
  providerStatuses: Array<{
    name: string;
    category: string;
    status: SnapshotSourceStatus;
    fallbackProvider?: string;
  }>;
}

export function buildRuleBasedOverviewSummary(params: {
  locationName: string;
  context: CompactSummaryContext;
  fallbackReason?: string;
}): {
  summary: string;
  currentActions: string[];
  futureActions: string[];
  mode: 'rule_based_fallback';
  modelUsed: string;
  modelLabel: string;
  fallbackReason?: string;
  generatedAt: string;
} {
  const ctx = params.context;
  const aqiVal = ctx.aqi?.aqi ?? null;
  const aqiCat = ctx.aqi?.category || 'Unavailable';
  const dominant = ctx.aqi?.dominantPollutant || 'PM2.5';
  const trendDelta = ctx.airStats?.trend6hDelta ?? null;
  const trendText =
    trendDelta === null
      ? 'stable near baseline'
      : trendDelta > 2
        ? `rising (+${trendDelta} µg/m³ over 6h)`
        : trendDelta < -2
          ? `improving (${trendDelta} µg/m³ over 6h)`
          : 'holding steady over the last 6 hours';

  const anomalyCount = ctx.anomalies?.length ?? 0;
  const topAnomaly = ctx.anomalies?.[0];

  const parts: string[] = [];
  if (aqiVal !== null) {
    parts.push(
      `In ${params.locationName}, current air quality is ${aqiCat} (AQI ${aqiVal}, ${ctx.aqi?.standardName || 'regional index'}), with ${dominant} as the primary driver and PM2.5 ${trendText}.`
    );
  } else {
    parts.push(`Live AQI telemetry for ${params.locationName} is currently limited; displaying verified multi-sector environmental indicators.`);
  }

  if (ctx.water?.wqi !== null && ctx.water?.wqi !== undefined) {
    parts.push(
      `Water Quality Index (WAWQI) measures ${ctx.water.wqi} (${ctx.water.classification || 'assessed'}${ctx.water.isSampleData ? ', Sample data' : ''}), while Waste Management Index (EcoWMI) scores ${ctx.waste?.wmi ?? '—'}/100${ctx.waste?.isSampleData ? ' (Sample data)' : ''}.`
    );
  }

  if (anomalyCount > 0 && topAnomaly) {
    parts.push(
      `${anomalyCount} statistical anomaly alert(s) detected, led by ${topAnomaly.parameter} at ${topAnomaly.observedValue} ${topAnomaly.unit} vs ${topAnomaly.baselineValue} ${topAnomaly.unit} baseline.`
    );
  } else if (ctx.energy?.latestRenewablePct !== null && ctx.energy?.latestRenewablePct !== undefined) {
    parts.push(
      `National renewable energy share stands at ${ctx.energy.latestRenewablePct}% (${ctx.energy.latestRenewableYear || 'latest World Bank data'}) with no acute particulate spikes detected.`
    );
  }

  const currentActions: string[] = [];
  if (aqiVal !== null && aqiVal > 150) {
    currentActions.push(`Reduce prolonged outdoor exertion and wear N95/FFP2 filtration masks while ${dominant} drives ${aqiCat} conditions.`);
  } else {
    currentActions.push(`Maintain indoor cross-ventilation during lower-traffic hours while tracking ${dominant} concentrations.`);
  }

  if (ctx.waste?.weakestComponent) {
    currentActions.push(`Target "${ctx.waste.weakestComponent}" in local solid waste operations to lift EcoWMI performance above ${ctx.waste.wmi ?? 60}/100.`);
  } else {
    currentActions.push('Audit household and commercial waste segregation at source to reduce unmanaged landfill fractions.');
  }

  if (ctx.water?.wqi !== null && ctx.water?.wqi !== undefined && ctx.water.wqi > 50) {
    currentActions.push('Pre-filter or boil municipal water where WAWQI exceeds 50 and upload local lab assays to replace sample reference values.');
  } else {
    currentActions.push('Upload verified municipal water or utility datasets via CSV/Excel to refine ward-level diagnostics.');
  }

  const futureActions: string[] = [];
  if ((ctx.weather?.warningsCount ?? 0) > 0) {
    futureActions.push('Prepare drainage, heat-mitigation shelters, and dust-suppression schedules ahead of active 7-day meteorological advisories.');
  } else if (trendDelta !== null && trendDelta > 2) {
    futureActions.push('Watch for nocturnal boundary-layer trapping if PM2.5 keeps rising and pre-stage traffic/construction dust controls.');
  } else {
    futureActions.push('Schedule outdoor community activities during high-wind dispersion windows shown in the 7-day weather outlook.');
  }

  futureActions.push(
    `Expand distributed solar and efficiency retrofits to build on the ${ctx.energy?.latestRenewablePct ?? 20}% national renewable energy share.`
  );

  const blockedEntries = Array.from(modelBlockedUntil.entries()).filter(([model, until]) => Date.now() < until);
  const quotaNote = blockedEntries.length > 0 ? 'AI quota reached — try again later' : params.fallbackReason;

  return {
    summary: parts.join(' '),
    currentActions: currentActions.slice(0, 3),
    futureActions: futureActions.slice(0, 2),
    mode: 'rule_based_fallback',
    modelUsed: 'basic-mode',
    modelLabel: 'Basic mode',
    fallbackReason: quotaNote,
    generatedAt: new Date().toISOString(),
  };
}

function buildRuleBasedChatResponse(params: {
  userQuestion: string;
  snapshot: CompactChatSnapshot;
  fallbackReason?: string;
}): {
  answer: string;
  mode: 'basic_mode';
  modelUsed: string;
  modelLabel: string;
  modeLabel: string;
  fallbackReason?: string;
  groundedSources: string[];
  generatedAt: string;
} {
  const q = params.userQuestion.toLowerCase();
  const s = params.snapshot;
  const fallbackNotes: string[] = [];

  const fallbackProvs = s.providerStatuses.filter((p) => p.status === 'Fallback');
  if (fallbackProvs.length > 0) {
    fallbackNotes.push(
      `Fallback feeds active: ${fallbackProvs
        .map((p) => `${p.name} -> ${p.fallbackProvider || 'backup feed'}`)
        .join('; ')}.`
    );
  }
  const sampleProvs = s.providerStatuses.filter((p) => p.status === 'Sample');
  if (sampleProvs.length > 0) {
    fallbackNotes.push(`Sample datasets in use: ${sampleProvs.map((p) => p.name).join(', ')} (not live municipal sensors).`);
  }

  const sections: string[] = [];

  const asksAir = /\b(aqi|air|pm2\.?5|pm10|pollut|smog|breath|now)\b/.test(q);
  const asksWater = /\b(water|wqi|wawqi|drink|ph|bod|coliform|safe)\b/.test(q);
  const asksWaste = /\b(waste|wmi|trash|garbage|recycl|landfill|segreg)\b/.test(q);
  const asksEnergy = /\b(energy|power|electric|solar|renew|carbon|grid)\b/.test(q);
  const asksAnomalies = /\b(anomal|spike|alert|warning|abnormal|explain)\b/.test(q);
  const asksRecommend = /\b(recommend|today|action|do|advice|protect|health|prevent)\b/.test(q);
  const matchedSpecific = asksAir || asksWater || asksWaste || asksEnergy || asksAnomalies || asksRecommend;

  if (asksAir || !matchedSpecific) {
    if (s.air && s.air.aqi !== null) {
      sections.push(
        `Air Quality (${s.location.name}, ${s.air.sourceStatus} · ${s.air.source}): Current AQI is ${s.air.aqi} (${s.air.category}, ${s.air.standardName}), driven by ${s.air.dominantPollutant || 'PM2.5'}. Latest particulates: PM2.5 = ${s.air.pm25 ?? 'unavailable'} µg/m³, PM10 = ${s.air.pm10 ?? 'unavailable'} µg/m³, NO2 = ${s.air.no2 ?? 'unavailable'} µg/m³.${s.air.healthGuidance ? ` Guidance: ${s.air.healthGuidance}` : ''}`
      );
    } else {
      sections.push(`Air Quality (${s.location.name}): Live AQI readings are currently unavailable in the backend snapshot.`);
    }
  }

  if (asksWater || !matchedSpecific) {
    if (s.water && s.water.wqi !== null) {
      const originNote =
        s.water.sourceStatus === 'Sample'
          ? 'Sample data (labeled reference dataset — not live local tap/river telemetry)'
          : s.water.sourceStatus;
      const safeNote =
        s.water.wqi <= 25
          ? 'Within excellent range for its assessed classification, though local boiling/filtration is still recommended when relying on Sample data.'
          : s.water.wqi <= 50
            ? 'Rated Good, though routine filtration is prudent if relying on reference sample data.'
            : 'Elevated WAWQI (>50) — treat or filter before drinking and verify with a local municipal water test.';
      const drivers = s.water.deteriorationDrivers?.length
        ? ` Key drivers: ${s.water.deteriorationDrivers.slice(0, 2).join('; ')}.`
        : '';
      sections.push(
        `Water Quality (${originNote}): WAWQI = ${s.water.wqi} (${s.water.classification}, ${s.water.waterUse} standard). ${safeNote}${drivers}`
      );
    } else {
      sections.push('Water Quality: No verified WQI dataset is loaded for this location.');
    }
  }

  if (asksWaste || !matchedSpecific) {
    if (s.waste && s.waste.wmi !== null) {
      const originNote = s.waste.sourceStatus === 'Sample' ? 'Sample data (reference dataset)' : s.waste.sourceStatus;
      sections.push(
        `Waste Management (${originNote}): EcoWMI = ${s.waste.wmi}/100 (${s.waste.classification})${s.waste.weakestComponent ? `; weakest component: ${s.waste.weakestComponent}` : ''}.`
      );
    } else {
      sections.push('Waste Management: No municipal waste dataset is loaded for this location.');
    }
  }

  if (asksEnergy || !matchedSpecific) {
    if (s.energy) {
      const originNote =
        s.energy.sourceStatus === 'Fallback'
          ? `Fallback via ${s.energy.fallbackProvider || 'World Bank'}`
          : s.energy.sourceStatus;
      sections.push(
        `Energy (${originNote}): National renewable share is ${s.energy.latestRenewablePct ?? 'unavailable'}% (${s.energy.latestRenewableYear || 'latest available year'}), electricity per capita = ${s.energy.latestElectricityKwhPerCapita ?? 'unavailable'} kWh.`
      );
    }
  }

  if (asksAnomalies || !matchedSpecific) {
    if (s.anomalies.length > 0) {
      const topList = s.anomalies
        .slice(0, 3)
        .map((a) => `${a.parameter}: ${a.observedValue} ${a.unit} vs ${a.baselineValue} ${a.unit} baseline (${a.severity.toUpperCase()}) — ${a.reason}`)
        .join(' | ');
      sections.push(`Detected Anomalies (${s.anomalies.length}): ${topList}`);
    } else {
      sections.push(`Anomalies (${s.reportingPeriod}): No statistical pollutant spikes detected above baseline thresholds.`);
    }
  }

  if (asksRecommend || !matchedSpecific) {
    const recs: string[] = [];
    if (s.air?.aqi !== null && s.air?.aqi !== undefined && s.air.aqi > 150) {
      recs.push(`1. Limit prolonged outdoor exercise and use an N95/FFP2 mask outdoors while AQI is ${s.air.aqi} (${s.air.category}).`);
    } else {
      recs.push(`1. Schedule outdoor activity during lower-traffic dispersion hours (wind ${s.weather?.windSpeedKmh ?? '—'} km/h).`);
    }
    if (s.water?.wqi !== null && s.water?.wqi !== undefined && s.water.wqi > 50) {
      recs.push(`2. Boil or RO/UV-filter drinking water (WAWQI ${s.water.wqi}, ${s.water.sourceStatus}) and upload local lab test CSVs.`);
    } else {
      recs.push('2. Verify municipal water safety locally, since regional water telemetry uses Sample data unless a local CSV is uploaded.');
    }
    if (s.waste?.weakestComponent) {
      recs.push(`3. Focus local waste action on "${s.waste.weakestComponent}" to raise EcoWMI from ${s.waste.wmi ?? '—'}/100.`);
    } else {
      recs.push('3. Keep wet/dry waste segregated at source and shift high-load appliances off peak grid hours.');
    }
    sections.push(`Top Recommendations Today:\n${recs.join('\n')}`);
  }

  if (fallbackNotes.length > 0) {
    sections.push(`Data Provenance: ${fallbackNotes.join(' ')}`);
  }

  const groundedSources = Array.from(
    new Set(
      [
        s.air ? `${s.air.source} (${s.air.sourceStatus})` : null,
        s.water ? `${s.water.source} (${s.water.sourceStatus})` : null,
        s.waste ? `${s.waste.source} (${s.waste.sourceStatus})` : null,
        s.energy ? `${s.energy.source} (${s.energy.sourceStatus})` : null,
      ].filter((v): v is string => Boolean(v))
    )
  );

  const blockedEntries = Array.from(modelBlockedUntil.entries()).filter(([model, until]) => Date.now() < until);
  const timeNote = blockedEntries.length > 0 ? ` — AI quota reached — try again after ${new Date(Math.max(...blockedEntries.map(([model, u]) => u))).toLocaleTimeString()}` : '';

  return {
    answer: `Basic mode (AI unavailable)${timeNote} — Verified Telemetry Summary for ${s.location.name} (${s.reportingPeriod}):\n\n${sections.join('\n\n')}`,
    mode: 'basic_mode',
    modelUsed: 'basic-mode',
    modelLabel: 'Basic mode',
    modeLabel: `Basic mode${timeNote}`,
    fallbackReason: params.fallbackReason,
    groundedSources,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateEcoAiChatResponse(params: {
  userQuestion: string;
  snapshot: CompactChatSnapshot;
  history?: Array<{ role: 'user' | 'model'; text: string }>;
}): Promise<{
  answer: string;
  mode: 'gemini' | 'basic_mode';
  modelUsed: string;
  modelLabel: string;
  modeLabel?: string;
  fallbackReason?: string;
  groundedSources: string[];
  generatedAt: string;
}> {
  const ai = getClient();
  const groundedSources = Array.from(
    new Set(
      [
        params.snapshot.air ? `${params.snapshot.air.source} (${params.snapshot.air.sourceStatus})` : null,
        params.snapshot.water ? `${params.snapshot.water.source} (${params.snapshot.water.sourceStatus})` : null,
        params.snapshot.waste ? `${params.snapshot.waste.source} (${params.snapshot.waste.sourceStatus})` : null,
        params.snapshot.energy ? `${params.snapshot.energy.source} (${params.snapshot.energy.sourceStatus})` : null,
      ].filter((v): v is string => Boolean(v))
    )
  );

  if (!ai) {
    console.error('[EcoAI Chat] GEMINI_API_KEY is not configured; falling back to Basic mode.');
    return buildRuleBasedChatResponse({
      userQuestion: params.userQuestion,
      snapshot: params.snapshot,
      fallbackReason: 'GEMINI_API_KEY is not configured in server secrets.',
    });
  }

  const systemInstruction = `You are EcoAI – EcoIntelligence Assistant. You are a versatile and knowledgeable AI assistant capable of answering any question the user asks—whether general knowledge, science, sustainability, climate, technology, everyday inquiries, or open-ended topics. 
When answering questions about the selected location, environmental metrics, air quality, weather, water, waste, or energy, use the measurements, indices (AQI, WAWQI, EcoWMI), source statuses, and anomalies inside COMPACT_SNAPSHOT JSON accurately.
For general or broader questions not specific to the local snapshot, provide helpful, detailed, and accurate answers using your general knowledge while maintaining a helpful, expert, and friendly tone.
When discussing environmental data, state explicit deviations and directions for anomalies, and explain technical indices clearly in markdown.`;

  const sanitizedHistory = (params.history ?? [])
    .slice(-6)
    .filter((m) => typeof m.text === 'string' && m.text.trim().length > 0);

  const contentsPayload = [
    ...sanitizedHistory.map((h) => ({
      role: h.role,
      parts: [{ text: h.text }],
    })),
    {
      role: 'user' as const,
      parts: [
        {
          text: `Selected Location: ${params.snapshot.location.name}
Reporting Period: ${params.snapshot.reportingPeriod}

COMPACT_SNAPSHOT:
${JSON.stringify(params.snapshot)}

User Question: ${params.userQuestion}`,
        },
      ],
    },
  ];

  const now = Date.now();
  const activeChain = MODEL_CHAIN.filter((m) => {
    const blockedUntil = modelBlockedUntil.get(m) || 0;
    if (now < blockedUntil) {
      console.log(`[EcoAI Circuit Breaker] Skipping blocked model ${m} until ${new Date(blockedUntil).toLocaleTimeString()}`);
      return false;
    }
    return true;
  });

  if (activeChain.length === 0) {
    console.warn('[EcoAI Circuit Breaker] All models in MODEL_CHAIN are currently blocked by quota.');
    return buildRuleBasedChatResponse({
      userQuestion: params.userQuestion,
      snapshot: params.snapshot,
      fallbackReason: 'All Gemini models temporarily blocked due to quota limits.',
    });
  }

  const attemptErrors: string[] = [];

  for (const modelId of activeChain) {
    let attemptsForModel = 0;
    const maxAttemptsForModel = 1; // Max one retry on 5xx/timeouts; never retry 429

    while (attemptsForModel <= maxAttemptsForModel) {
      try {
        const modelClient = getClient(modelId) ?? ai;
        const response = await withTimeout(
          modelClient.models.generateContent({
            model: modelId,
            contents: contentsPayload,
            config: {
              systemInstruction,
              ...(supportsThinkingLevel(modelId)
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
            },
          }),
          GEMINI_TIMEOUT_MS,
          `EcoAI Chat (${modelId})`
        );

        const text = (response.text ?? '').trim();
        if (!text) {
          throw new Error('Empty response returned by Gemini');
        }

        return {
          answer: text,
          mode: 'gemini',
          modelUsed: modelId,
          modelLabel: formatModelBadge(modelId),
          groundedSources,
          generatedAt: new Date().toISOString(),
        };
      } catch (err) {
        const msg = formatShortError(err);
        const is429 = is429QuotaError(err);
        console.error(`[EcoAI Chat] Attempt ${attemptsForModel + 1} for "${modelId}" failed: ${msg}`);

        if (is429) {
          const delayMs = parseRetryDelayMs(String(err));
          const blockedUntil = Date.now() + delayMs;
          modelBlockedUntil.set(modelId, blockedUntil);
          console.warn(`[EcoAI Circuit Breaker] Model "${modelId}" hit 429 quota limit. Blocked for ${Math.round(delayMs / 1000)}s until ${new Date(blockedUntil).toLocaleTimeString()}`);
          attemptErrors.push(`${modelId}: quota 429`);
          break; // Do not retry 429, skip to next model in chain immediately
        }

        attemptErrors.push(`${modelId}: ${msg}`);
        attemptsForModel++;
        if (attemptsForModel > maxAttemptsForModel) {
          break; // Move to next model
        }
      }
    }
  }

  return buildRuleBasedChatResponse({
    userQuestion: params.userQuestion,
    snapshot: params.snapshot,
    fallbackReason: attemptErrors.join(' | ').slice(0, 500),
  });
}

export async function generateOverviewSummary(params: {
  locationName: string;
  groundedContext: CompactSummaryContext;
  reportingPeriod?: string;
}): Promise<{
  summary: string;
  currentActions: string[];
  futureActions: string[];
  mode: 'gemini' | 'rule_based_fallback';
  modelUsed: string;
  modelLabel: string;
  fallbackReason?: string;
  generatedAt: string;
}> {
  const reportingPeriod = params.reportingPeriod || 'Last 7 days';
  const cacheKey = computeSummaryCacheKey(params.locationName, reportingPeriod, params.groundedContext);
  const cached = getCachedSummary(cacheKey);
  if (cached) {
    return cached as {
      summary: string;
      currentActions: string[];
      futureActions: string[];
      mode: 'gemini' | 'rule_based_fallback';
      modelUsed: string;
      modelLabel: string;
      fallbackReason?: string;
      generatedAt: string;
    };
  }

  const ai = getClient();
  if (!ai) {
    console.error('[EcoAI Overview Summary] GEMINI_API_KEY is not configured; falling back to Basic mode.');
    const fallbackRes = buildRuleBasedOverviewSummary({
      locationName: params.locationName,
      context: params.groundedContext,
      fallbackReason: 'GEMINI_API_KEY not configured — showing verified rule-based environmental synthesis.',
    });
    setCachedSummary(cacheKey, fallbackRes);
    return fallbackRes;
  }

  const prompt = `Summarize the environmental condition of ${params.locationName} strictly using this compact verified snapshot. Do not invent any missing data; note when water or waste metrics are Sample data.

COMPACT_SNAPSHOT:
${JSON.stringify(params.groundedContext)}

Return JSON with:
- summary: 2-3 clear factual sentences citing verified AQI, worst pollutant, anomalies, and cross-sector status.
- currentActions: array of exactly 3 practical, concise actions addressing current conditions.
- futureActions: array of exactly 2 forward-looking preparedness actions based on weather/trend outlook.`;

  const now = Date.now();
  const activeChain = MODEL_CHAIN.filter((m) => {
    const blockedUntil = modelBlockedUntil.get(m) || 0;
    if (now < blockedUntil) {
      return false;
    }
    return true;
  });

  if (activeChain.length === 0) {
    console.warn('[EcoAI Circuit Breaker] All models in MODEL_CHAIN are currently blocked by quota for summary.');
    const blockedEntries = Array.from(modelBlockedUntil.entries()).filter(([model, until]) => Date.now() < until);
    const maxUntil = blockedEntries.length > 0 ? Math.max(...blockedEntries.map(([model, u]) => u)) : Date.now() + 3600 * 1000;
    const timeStr = new Date(maxUntil).toLocaleTimeString();
    const fallbackRes = buildRuleBasedOverviewSummary({
      locationName: params.locationName,
      context: params.groundedContext,
      fallbackReason: `AI quota reached — try again after ${timeStr}`,
    });
    setCachedSummary(cacheKey, fallbackRes);
    return fallbackRes;
  }

  const attemptErrors: string[] = [];

  for (const modelId of activeChain) {
    let attemptsForModel = 0;
    const maxAttemptsForModel = 1;

    while (attemptsForModel <= maxAttemptsForModel) {
      try {
        const modelClient = getClient(modelId) ?? ai;
        const response = await withTimeout(
          modelClient.models.generateContent({
            model: modelId,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  summary: { type: Type.STRING },
                  currentActions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  futureActions: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['summary', 'currentActions', 'futureActions'],
              },
              ...(supportsThinkingLevel(modelId)
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
            },
          }),
          GEMINI_TIMEOUT_MS,
          `EcoAI Overview Summary (${modelId})`
        );

        const rawText = (response.text ?? '').trim();
        if (!rawText) {
          throw new Error('Empty Gemini response');
        }

        const cleaned = stripMarkdownFences(rawText);
        const parsed = JSON.parse(cleaned) as {
          summary?: string;
          currentActions?: unknown[];
          futureActions?: unknown[];
        };

        const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
        const currentActions = Array.isArray(parsed.currentActions)
          ? parsed.currentActions.map(String).filter(Boolean).slice(0, 3)
          : [];
        const futureActions = Array.isArray(parsed.futureActions)
          ? parsed.futureActions.map(String).filter(Boolean).slice(0, 2)
          : [];

        if (!summary || currentActions.length === 0) {
          throw new Error('Incomplete summary fields returned by Gemini');
        }

        const successRes = {
          summary,
          currentActions,
          futureActions,
          mode: 'gemini' as const,
          modelUsed: modelId,
          modelLabel: formatModelBadge(modelId),
          generatedAt: new Date().toISOString(),
        };
        setCachedSummary(cacheKey, successRes);
        return successRes;
      } catch (err) {
        const msg = formatShortError(err);
        const is429 = is429QuotaError(err);
        console.error(`[EcoAI Overview Summary] Attempt ${attemptsForModel + 1} for "${modelId}" failed: ${msg}`);

        if (is429) {
          const delayMs = parseRetryDelayMs(String(err));
          const blockedUntil = Date.now() + delayMs;
          modelBlockedUntil.set(modelId, blockedUntil);
          console.warn(`[EcoAI Circuit Breaker] Model "${modelId}" hit 429 quota limit. Blocked for ${Math.round(delayMs / 1000)}s until ${new Date(blockedUntil).toLocaleTimeString()}`);
          attemptErrors.push(`${modelId}: quota 429`);
          break;
        }

        attemptErrors.push(`${modelId}: ${msg}`);
        attemptsForModel++;
        if (attemptsForModel > maxAttemptsForModel) {
          break;
        }
      }
    }
  }

  const blockedEntries = Array.from(modelBlockedUntil.entries()).filter(([m, until]) => Date.now() < until);
  const maxUntil = blockedEntries.length > 0 ? Math.max(...blockedEntries.map(e => e[1])) : Date.now() + 3600 * 1000;
  const timeStr = new Date(maxUntil).toLocaleTimeString();

  const fallbackRes = buildRuleBasedOverviewSummary({
    locationName: params.locationName,
    context: params.groundedContext,
    fallbackReason: `AI quota reached — try again after ${timeStr}`,
  });
  setCachedSummary(cacheKey, fallbackRes);
  return fallbackRes;
}
