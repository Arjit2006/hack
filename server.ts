import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { rateLimit, requireAdmin, requireAuth, setRuntimeAdminRole, verifyFirebaseIdToken } from './server/authMiddleware';
import { detectSeriesAnomalies, generateTimeSeriesForecast } from './server/engines/anomalyForecastEngine';
import { calculateJurisdictionAqi } from './server/engines/aqiEngine';
import { calculateEcoWmi } from './server/engines/wmiEngine';
import { calculateWawqi, WATER_STANDARDS } from './server/engines/wqiEngine';
import {
  buildRuleBasedOverviewSummary,
  CompactChatSnapshot,
  CompactSummaryContext,
  generateEcoAiChatResponse,
  generateOverviewSummary,
  SnapshotSourceStatus,
} from './server/geminiService';
import {
  fetchOpenMeteoAirQuality,
  fetchOpenMeteoWeather,
  fetchWorldBankEnergy,
  getAllDataSourcesSnapshot,
  getProviders,
  getSampleWasteDataset,
  getSampleWaterDataset,
  getSyncLogs,
  registerCustomProvider,
  reverseGeocode,
  searchLocations,
  testProviderConnection,
  updateProviderConfig,
} from './server/providers/environmentalProviders';
import { runIngestionCycle, startBackgroundScheduler } from './server/scheduler';
import {
  addUploadedRecords,
  aiLogs,
  cachedAqiSnapshots,
  importHistory,
  monitoredLocations,
  normalizeLocationKey,
  serverAlerts,
  systemConfig,
  uploadedRecords,
} from './server/store';
import { WaterUseType } from './server/types';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '6mb' }));

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'EcoIntelligence API',
      timestamp: new Date().toISOString(),
      lastJobRunAt: systemConfig.lastJobRunAt,
    });
  });

  // Location Search & Reverse Geocoding
  app.get('/api/locations/search', rateLimit(40, 60_000), async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) {
        res.json({ results: monitoredLocations });
        return;
      }
      const results = await searchLocations(q);
      res.json({ results });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Location search failed' });
    }
  });

  app.get('/api/locations/reverse', rateLimit(30, 60_000), async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      res.status(400).json({ error: 'Valid latitude and longitude are required.' });
      return;
    }
    const location = await reverseGeocode(lat, lon);
    res.json({ location });
  });

  app.post('/api/locations/sync-monitor', requireAuth, rateLimit(20, 60_000), (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(160),
      city: z.string().min(1).max(120),
      state: z.string().max(120).optional(),
      country: z.string().min(1).max(100),
      countryCode: z.string().min(2).max(5),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid location details are required.' });
      return;
    }

    const exists = monitoredLocations.some(
      (l) =>
        Math.abs(l.latitude - parsed.data.latitude) < 0.05 &&
        Math.abs(l.longitude - parsed.data.longitude) < 0.05
    );
    if (!exists) {
      if (monitoredLocations.length >= 25) {
        monitoredLocations.pop();
      }
      monitoredLocations.unshift({
        id: `usr-loc-${Date.now()}`,
        ...parsed.data,
      });
    }

    res.json({
      ok: true,
      monitoredCount: monitoredLocations.length,
      backgroundPollingActive: true,
      lastJobRunAt: systemConfig.lastJobRunAt,
    });
  });

  // Core Overview & Live Environmental Snapshot
  app.get('/api/env/overview', rateLimit(45, 60_000), async (req, res) => {
    try {
      const lat = Number(req.query.lat ?? 28.65195);
      const lon = Number(req.query.lon ?? 77.23149);
      const countryCode = String(req.query.countryCode || 'IN').toUpperCase();
      const locationName = String(req.query.name || 'Delhi, India');
      const pastDays = Math.min(30, Math.max(1, Number(req.query.pastDays ?? 7)));

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        res.status(400).json({ error: 'Valid coordinates are required.' });
        return;
      }

      const [airResult, weatherResult, energyResult] = await Promise.allSettled([
        fetchOpenMeteoAirQuality(lat, lon, pastDays),
        fetchOpenMeteoWeather(lat, lon),
        fetchWorldBankEnergy(countryCode),
      ]);

      const airData = airResult.status === 'fulfilled' ? airResult.value : null;
      const weatherData = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
      const energyData = energyResult.status === 'fulfilled' ? energyResult.value : null;

      const aqi = airData
        ? calculateJurisdictionAqi({
            countryCode,
            readings: airData.current,
            source: airData.source,
            station: airData.station,
            lastUpdated: airData.current.time,
            originType: 'latest_available',
          })
        : calculateJurisdictionAqi({
            countryCode,
            readings: { pm25: null, pm10: null, coUgM3: null, no2: null, so2: null, o3: null },
            source: 'Open-Meteo Air Quality',
            station: 'Unavailable',
            lastUpdated: null,
          });

      const locKey = normalizeLocationKey(locationName);
      const waterUploaded = uploadedRecords.filter((r) => r.locationKey === locKey && r.category === 'water');
      const waterUsageUploaded = uploadedRecords.filter((r) => r.locationKey === locKey && r.category === 'water_usage');
      const wasteUploaded = uploadedRecords.filter((r) => r.locationKey === locKey && r.category === 'waste');
      const energyUploaded = uploadedRecords.filter((r) => r.locationKey === locKey && r.category === 'energy');

      const latestWater = waterUploaded[waterUploaded.length - 1] ?? null;
      const sampleWater = latestWater ? null : getSampleWaterDataset(locationName, countryCode);
      const wqi = latestWater
        ? calculateWawqi({
            waterUse: 'surface',
            inputs: {
              ph: typeof latestWater.metrics.ph === 'number' ? latestWater.metrics.ph : null,
              do: typeof latestWater.metrics.do === 'number' ? latestWater.metrics.do : null,
              bod: typeof latestWater.metrics.bod === 'number' ? latestWater.metrics.bod : null,
              cod: typeof latestWater.metrics.cod === 'number' ? latestWater.metrics.cod : null,
              tds: typeof latestWater.metrics.tds === 'number' ? latestWater.metrics.tds : null,
              turbidity: typeof latestWater.metrics.turbidity === 'number' ? latestWater.metrics.turbidity : null,
              nitrate: typeof latestWater.metrics.nitrate === 'number' ? latestWater.metrics.nitrate : null,
              coliform: typeof latestWater.metrics.coliform === 'number' ? latestWater.metrics.coliform : null,
            },
            dataOrigin: 'uploaded',
          })
        : sampleWater
          ? calculateWawqi({
              waterUse: 'surface',
              inputs: sampleWater.inputs,
              dataOrigin: 'sample_reference',
            })
          : null;

      const latestWaste = wasteUploaded[wasteUploaded.length - 1] ?? null;
      const sampleWaste = latestWaste ? null : getSampleWasteDataset(locationName, countryCode);
      const wmi = latestWaste
        ? calculateEcoWmi(
            {
              totalGenerated: typeof latestWaste.metrics.totalGenerated === 'number' ? latestWaste.metrics.totalGenerated : null,
              collected: typeof latestWaste.metrics.collected === 'number' ? latestWaste.metrics.collected : null,
              segregated: typeof latestWaste.metrics.segregated === 'number' ? latestWaste.metrics.segregated : null,
              recycledOrRecovered: typeof latestWaste.metrics.recycled === 'number' ? latestWaste.metrics.recycled : null,
              treatedNonRecycling: typeof latestWaste.metrics.treated === 'number' ? latestWaste.metrics.treated : null,
              safelyDisposed: typeof latestWaste.metrics.safelyDisposed === 'number' ? latestWaste.metrics.safelyDisposed : null,
              unmanaged: typeof latestWaste.metrics.unmanaged === 'number' ? latestWaste.metrics.unmanaged : null,
              unit: 'tonnes/day',
            },
            systemConfig.wmiWeights,
            systemConfig.wmiMethodologyVersion,
            'uploaded'
          )
        : sampleWaste
          ? calculateEcoWmi(
              sampleWaste.inputs,
              systemConfig.wmiWeights,
              systemConfig.wmiMethodologyVersion,
              'sample_reference'
            )
          : null;

      // Anomalies & Forecasts from real hourly Open-Meteo series
      const pm25Series = (airData?.hourly ?? [])
        .filter((h) => h.pm25 !== null)
        .map((h) => ({ timestamp: h.timestamp, value: h.pm25 as number }));

      const anomalies = detectSeriesAnomalies({
        category: 'air',
        parameter: 'PM2.5',
        unit: 'µg/m³',
        series: pm25Series,
        zThreshold: systemConfig.anomalyZThreshold,
        highThreshold: countryCode === 'IN' ? 90 : 55.4,
      });

      const pm25Forecast24h = systemConfig.forecastingEnabled
        ? generateTimeSeriesForecast({
            category: 'air',
            parameter: 'PM2.5',
            unit: 'µg/m³',
            series: pm25Series,
            horizon: '24h',
          })
        : null;

      // Daily aggregated PM2.5 for 7d forecast
      const dailyPm25Map = new Map<string, number[]>();
      for (const pt of pm25Series) {
        const day = pt.timestamp.slice(0, 10);
        const arr = dailyPm25Map.get(day) ?? [];
        arr.push(pt.value);
        dailyPm25Map.set(day, arr);
      }
      const dailyPm25Series = Array.from(dailyPm25Map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, vals]) => ({
          timestamp: `${day}T00:00:00.000Z`,
          value: vals.reduce((s, v) => s + v, 0) / vals.length,
        }));

      const pm25Forecast7d = systemConfig.forecastingEnabled
        ? generateTimeSeriesForecast({
            category: 'air',
            parameter: 'PM2.5 (Daily Mean)',
            unit: 'µg/m³',
            series: dailyPm25Series,
            horizon: '7d',
          })
        : null;

      const { dataSources, emberMeta } = await getAllDataSourcesSnapshot({
        lat,
        lon,
        countryCode,
        locationName,
        airData,
        weatherData,
        energyData,
      });

      res.json({
        location: { name: locationName, countryCode, latitude: lat, longitude: lon },
        retrievedAt: new Date().toISOString(),
        aqi,
        airHourly: airData?.hourly ?? [],
        openAqStations: airData?.openAqStations ?? [],
        weather: weatherData,
        water: {
          available: Boolean(wqi),
          isSampleData: Boolean(sampleWater),
          sourceLabel: latestWater ? latestWater.source : sampleWater?.sourceLabel,
          wqi,
          records: waterUploaded,
          usageRecords: waterUsageUploaded,
          standards: WATER_STANDARDS,
        },
        waste: {
          available: Boolean(wmi),
          isSampleData: Boolean(sampleWaste),
          sourceLabel: latestWaste ? latestWaste.source : sampleWaste?.sourceLabel,
          wmi,
          records: wasteUploaded,
        },
        energy: {
          worldBank: energyData,
          ember: emberMeta,
          uploadedRecords: energyUploaded,
        },
        anomalies,
        forecasts: {
          enabled: systemConfig.forecastingEnabled,
          pm25_24h: pm25Forecast24h,
          pm25_7d: pm25Forecast7d,
        },
        alerts: serverAlerts.filter((a) => normalizeLocationKey(a.locationName) === locKey).slice(0, 15),
        dataSources,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load environmental overview' });
    }
  });

  // WQI Calculator Endpoint (Transparent Scientific Engine)
  const wqiSchema = z.object({
    waterUse: z.enum(['drinking', 'bathing', 'surface', 'irrigation', 'ecosystem']),
    temperatureC: z.number().min(-2).max(50).optional(),
    salinityPpt: z.number().min(0).max(45).optional(),
    dataOrigin: z.enum(['live', 'latest_available', 'historical', 'uploaded', 'estimated', 'predicted', 'sample_reference']).optional(),
    inputs: z.object({
      ph: z.number().nullable().optional(),
      do: z.number().nullable().optional(),
      bod: z.number().nullable().optional(),
      cod: z.number().nullable().optional(),
      tds: z.number().nullable().optional(),
      turbidity: z.number().nullable().optional(),
      nitrate: z.number().nullable().optional(),
      coliform: z.number().nullable().optional(),
    }),
  });

  app.post('/api/calc/wqi', (req, res) => {
    const parsed = wqiSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid WQI calculation parameters', details: parsed.error.flatten() });
      return;
    }
    const result = calculateWawqi({
      waterUse: parsed.data.waterUse as WaterUseType,
      inputs: parsed.data.inputs,
      temperatureC: parsed.data.temperatureC,
      salinityPpt: parsed.data.salinityPpt,
      dataOrigin: parsed.data.dataOrigin ?? 'uploaded',
    });
    res.json({ result });
  });

  // WMI Calculator Endpoint (EcoIntelligence Composite Index)
  const wmiSchema = z.object({
    totalGenerated: z.number().nullable(),
    collected: z.number().nullable(),
    segregated: z.number().nullable(),
    recycledOrRecovered: z.number().nullable(),
    treatedNonRecycling: z.number().nullable(),
    safelyDisposed: z.number().nullable(),
    unmanaged: z.number().nullable(),
    unit: z.enum(['tonnes/day', 'tonnes/month', 'tonnes/year']).default('tonnes/day'),
    population: z.number().nullable().optional(),
    importExplanation: z.string().max(300).optional(),
    dataOrigin: z.enum(['live', 'latest_available', 'historical', 'uploaded', 'estimated', 'predicted', 'sample_reference']).optional(),
  });

  app.post('/api/calc/wmi', (req, res) => {
    const parsed = wmiSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid WMI parameters', details: parsed.error.flatten() });
      return;
    }
    const result = calculateEcoWmi(
      parsed.data,
      systemConfig.wmiWeights,
      systemConfig.wmiMethodologyVersion,
      parsed.data.dataOrigin ?? 'uploaded'
    );
    res.json({ result });
  });

  // Multi-Location Comparison Endpoint
  app.post('/api/env/compare', rateLimit(30, 60_000), async (req, res) => {
    try {
      const schema = z.object({
        locations: z
          .array(
            z.object({
              name: z.string().min(1).max(160),
              countryCode: z.string().min(2).max(5),
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
            })
          )
          .min(2)
          .max(4),
        pastDays: z.number().min(1).max(30).default(7),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Select 2 to 4 valid locations to compare.' });
        return;
      }

      const comparisons = await Promise.all(
        parsed.data.locations.map(async (loc) => {
          const [aq, wx, energy] = await Promise.all([
            fetchOpenMeteoAirQuality(loc.latitude, loc.longitude, parsed.data.pastDays),
            fetchOpenMeteoWeather(loc.latitude, loc.longitude),
            fetchWorldBankEnergy(loc.countryCode),
          ]);
          const aqi = calculateJurisdictionAqi({
            countryCode: loc.countryCode,
            readings: aq.current,
            source: aq.source,
            station: aq.station,
            lastUpdated: aq.current.time,
          });
          return {
            location: loc,
            aqi,
            weather: wx.current,
            energy: {
              latestRenewablePct: energy.latestRenewablePct,
              latestRenewableYear: energy.latestRenewableYear,
              latestElectricityKwhPerCapita: energy.latestElectricityKwhPerCapita,
            },
            hourly: aq.hourly.slice(-48),
          };
        })
      );

      res.json({
        comparisons,
        methodologyNote:
          'Each location uses its applicable national/regional AQI framework (e.g., CPCB India vs US EPA vs EU EAQI). Direct numerical comparisons across different AQI scales are annotated with their respective frameworks.',
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Comparison failed' });
    }
  });

  // Verified CSV / Excel Dataset Upload & Validation (Authenticated users & Admins)
  app.post('/api/env/upload-dataset', requireAuth, rateLimit(20, 60_000), (req, res) => {
    try {
      const schema = z.object({
        fileName: z.string().min(1).max(160),
        category: z.enum(['air', 'water', 'water_usage', 'waste', 'energy']),
        locationName: z.string().min(1).max(160),
        base64Content: z.string().min(4).max(4_000_000),
        columnMapping: z.record(z.string(), z.string()).optional(),
        previewOnly: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid upload payload', details: parsed.error.flatten() });
        return;
      }

      const lowerName = parsed.data.fileName.toLowerCase();
      if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
        res.status(400).json({ error: 'Only .csv, .xlsx, or .xls files are supported.' });
        return;
      }

      const buf = Buffer.from(parsed.data.base64Content, 'base64');
      const workbook = XLSX.read(buf, { type: 'buffer', cellDates: false, cellFormula: false, cellHTML: false });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        res.status(400).json({ error: 'Uploaded file contains no readable sheets.' });
        return;
      }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: null });
      if (rows.length === 0) {
        res.status(400).json({ error: 'Uploaded sheet has zero data rows.' });
        return;
      }

      const safeKey = (k: string) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
      const detectedColumns = Object.keys(rows[0] || {}).filter(safeKey);
      const warnings: string[] = [];
      const validRecords: Array<{
        id: string;
        locationKey: string;
        locationName: string;
        category: 'air' | 'water' | 'water_usage' | 'waste' | 'energy';
        timestamp: string;
        source: string;
        uploadedBy: string;
        metrics: Record<string, number | string | null>;
      }> = [];
      let rejectedRows = 0;

      const mapping = parsed.data.columnMapping ?? {};
      const locKey = normalizeLocationKey(parsed.data.locationName);

      rows.slice(0, 500).forEach((row, idx) => {
        const mappedMetrics: Record<string, number | string | null> = Object.create(null);
        for (const [targetField, sourceCol] of Object.entries(mapping)) {
          if (!sourceCol || !safeKey(targetField) || !safeKey(sourceCol)) continue;
          const raw = row[sourceCol];
          if (raw === null || raw === undefined || raw === '') {
            mappedMetrics[targetField] = null;
          } else if (targetField === 'timestamp' || targetField === 'unit') {
            mappedMetrics[targetField] = String(raw);
          } else {
            const num = Number(raw);
            mappedMetrics[targetField] = Number.isFinite(num) ? num : null;
          }
        }

        // Auto-map matching column names if no explicit mapping provided
        if (Object.keys(mapping).length === 0) {
          for (const [k, v] of Object.entries(row)) {
            const norm = k.toLowerCase().trim();
            if (!safeKey(norm)) continue;
            if (v === null || v === undefined || v === '') {
              mappedMetrics[norm] = null;
            } else if (typeof v === 'number') {
              mappedMetrics[norm] = v;
            } else if (!Number.isNaN(Number(v)) && norm !== 'date' && norm !== 'timestamp') {
              mappedMetrics[norm] = Number(v);
            } else {
              mappedMetrics[norm] = String(v);
            }
          }
        }

        const rawTs = mappedMetrics.timestamp || row['timestamp'] || row['date'] || row['Date'] || new Date().toISOString();
        const parsedDate = new Date(String(rawTs));
        if (Number.isNaN(parsedDate.getTime())) {
          rejectedRows++;
          if (warnings.length < 5) warnings.push(`Row ${idx + 1}: Invalid timestamp "${String(rawTs)}"`);
          return;
        }

        validRecords.push({
          id: `upl-${Date.now()}-${idx}`,
          locationKey: locKey,
          locationName: parsed.data.locationName,
          category: parsed.data.category,
          timestamp: parsedDate.toISOString(),
          source: `Uploaded Dataset (${parsed.data.fileName})`,
          uploadedBy: req.user?.email || 'authenticated-user',
          metrics: mappedMetrics,
        });
      });

      if (parsed.data.previewOnly) {
        res.json({
          preview: true,
          detectedColumns,
          totalRows: rows.length,
          sampleRows: rows.slice(0, 5),
          validCount: validRecords.length,
          rejectedRows,
          warnings,
        });
        return;
      }

      const inserted = addUploadedRecords(validRecords);
      importHistory.unshift({
        id: `imp-${Date.now()}`,
        fileName: parsed.data.fileName,
        category: parsed.data.category,
        locationName: parsed.data.locationName,
        totalRows: rows.length,
        acceptedRows: inserted,
        rejectedRows: rejectedRows + (validRecords.length - inserted),
        warnings,
        uploadedBy: req.user?.email || 'unknown',
        uploadedAt: new Date().toISOString(),
      });

      res.json({
        preview: false,
        detectedColumns,
        totalRows: rows.length,
        insertedCount: inserted,
        duplicateOrSkipped: validRecords.length - inserted,
        rejectedRows,
        warnings,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to parse dataset' });
    }
  });

  // EcoAI Grounded Chatbot (Server-side Gemini API + Rule-based Basic Mode fallback)
  app.post('/api/ai/chat', rateLimit(25, 60_000), async (req, res) => {
    const start = Date.now();
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      try {
        req.user = await verifyFirebaseIdToken(authHeader.slice(7).trim());
      } catch {
        // Proceed with rate-limited public telemetry context if token is absent/expired
      }
    }

    const schema = z.object({
      question: z.string().trim().min(1, 'Question is required.').max(1500),
      location: z.object({
        name: z.string().trim().min(1).max(160),
        countryCode: z.string().trim().min(2).max(5),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      reportingPeriod: z.string().max(80).default('Last 7 days'),
      wqiSnapshot: z.unknown().optional(),
      wmiSnapshot: z.unknown().optional(),
      history: z.array(z.object({ role: z.enum(['user', 'model']), text: z.string().max(4000) })).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid chat request payload. A question and valid location are required.' });
      return;
    }

    const { location, question, reportingPeriod, history, wqiSnapshot, wmiSnapshot } = parsed.data;
    const pastDays = reportingPeriod.includes('24') ? 1 : reportingPeriod.includes('30') ? 30 : 7;

    try {
      const [aq, wx, energy] = await Promise.allSettled([
        fetchOpenMeteoAirQuality(location.latitude, location.longitude, pastDays),
        fetchOpenMeteoWeather(location.latitude, location.longitude),
        fetchWorldBankEnergy(location.countryCode),
      ]);

      const airData = aq.status === 'fulfilled' ? aq.value : null;
      const weatherData = wx.status === 'fulfilled' ? wx.value : null;
      const energyData = energy.status === 'fulfilled' ? energy.value : null;

      const { dataSources } = await getAllDataSourcesSnapshot({
        lat: location.latitude,
        lon: location.longitude,
        countryCode: location.countryCode,
        locationName: location.name,
        airData,
        weatherData,
        energyData,
      });

      const toSnapStatus = (status?: string): SnapshotSourceStatus => {
        if (status === 'Sample data') return 'Sample';
        if (status === 'Fallback') return 'Fallback';
        if (status === 'Error') return 'Error';
        return 'Live';
      };

      const aqi = airData
        ? calculateJurisdictionAqi({
            countryCode: location.countryCode,
            readings: airData.current,
            source: airData.source,
            station: airData.station,
            lastUpdated: airData.current.time,
          })
        : null;

      const pm25Series = (airData?.hourly ?? [])
        .filter((h) => h.pm25 !== null)
        .map((h) => ({ timestamp: h.timestamp, value: h.pm25 as number }));

      const anomalies = detectSeriesAnomalies({
        category: 'air',
        parameter: 'PM2.5',
        unit: 'µg/m³',
        series: pm25Series,
        zThreshold: systemConfig.anomalyZThreshold,
        highThreshold: location.countryCode === 'IN' ? 90 : 55.4,
      });

      const locKey = normalizeLocationKey(location.name);
      const uploadedWater = uploadedRecords.filter((r) => r.locationKey === locKey && r.category === 'water').slice(-1)[0];
      const uploadedWaste = uploadedRecords.filter((r) => r.locationKey === locKey && r.category === 'waste').slice(-1)[0];

      const wqiSnap = wqiSnapshot as
        | {
            wqi?: number | null;
            classification?: string;
            waterUse?: string;
            standardName?: string;
            deteriorationDrivers?: string[];
            dataOrigin?: string;
          }
        | undefined;
      const wmiSnap = wmiSnapshot as
        | {
            wmi?: number | null;
            classification?: string;
            weakestComponent?: string | null;
            methodologyVersion?: string;
            dataOrigin?: string;
          }
        | undefined;

      let waterSummary: CompactChatSnapshot['water'] = null;
      if (wqiSnap && typeof wqiSnap.wqi === 'number') {
        const isSample = wqiSnap.dataOrigin === 'sample_reference';
        waterSummary = {
          wqi: wqiSnap.wqi,
          classification: wqiSnap.classification || 'Assessed',
          waterUse: wqiSnap.waterUse || 'drinking',
          source: isSample ? 'Sample Water Reference Dataset' : wqiSnap.standardName || 'Uploaded Water Dataset',
          sourceStatus: isSample ? 'Sample' : 'Live',
          deteriorationDrivers: wqiSnap.deteriorationDrivers?.slice(0, 3),
        };
      } else if (uploadedWater) {
        const computedWqi = calculateWawqi({
          waterUse: 'surface',
          inputs: {
            ph: typeof uploadedWater.metrics.ph === 'number' ? uploadedWater.metrics.ph : null,
            do: typeof uploadedWater.metrics.do === 'number' ? uploadedWater.metrics.do : null,
            bod: typeof uploadedWater.metrics.bod === 'number' ? uploadedWater.metrics.bod : null,
            cod: typeof uploadedWater.metrics.cod === 'number' ? uploadedWater.metrics.cod : null,
            tds: typeof uploadedWater.metrics.tds === 'number' ? uploadedWater.metrics.tds : null,
            turbidity: typeof uploadedWater.metrics.turbidity === 'number' ? uploadedWater.metrics.turbidity : null,
            nitrate: typeof uploadedWater.metrics.nitrate === 'number' ? uploadedWater.metrics.nitrate : null,
            coliform: typeof uploadedWater.metrics.coliform === 'number' ? uploadedWater.metrics.coliform : null,
          },
          dataOrigin: 'uploaded',
        });
        waterSummary = {
          wqi: computedWqi.wqi,
          classification: computedWqi.classification,
          waterUse: computedWqi.waterUse,
          source: uploadedWater.source,
          sourceStatus: 'Live',
          deteriorationDrivers: computedWqi.deteriorationDrivers.slice(0, 3),
        };
      } else {
        const sampleWater = getSampleWaterDataset(location.name, location.countryCode);
        const sampleWqi = calculateWawqi({
          waterUse: 'surface',
          inputs: sampleWater.inputs,
          dataOrigin: 'sample_reference',
        });
        waterSummary = {
          wqi: sampleWqi.wqi,
          classification: sampleWqi.classification,
          waterUse: sampleWqi.waterUse,
          source: sampleWater.sourceLabel,
          sourceStatus: 'Sample',
          deteriorationDrivers: sampleWqi.deteriorationDrivers.slice(0, 3),
        };
      }

      let wasteSummary: CompactChatSnapshot['waste'] = null;
      if (wmiSnap && typeof wmiSnap.wmi === 'number') {
        const isSample = wmiSnap.dataOrigin === 'sample_reference';
        wasteSummary = {
          wmi: wmiSnap.wmi,
          classification: wmiSnap.classification || 'Assessed',
          weakestComponent: wmiSnap.weakestComponent ?? null,
          source: isSample ? 'Sample Waste Reference Dataset' : wmiSnap.methodologyVersion || 'Uploaded Waste Dataset',
          sourceStatus: isSample ? 'Sample' : 'Live',
        };
      } else if (uploadedWaste) {
        const computedWmi = calculateEcoWmi(
          {
            totalGenerated: typeof uploadedWaste.metrics.totalGenerated === 'number' ? uploadedWaste.metrics.totalGenerated : null,
            collected: typeof uploadedWaste.metrics.collected === 'number' ? uploadedWaste.metrics.collected : null,
            segregated: typeof uploadedWaste.metrics.segregated === 'number' ? uploadedWaste.metrics.segregated : null,
            recycledOrRecovered: typeof uploadedWaste.metrics.recycled === 'number' ? uploadedWaste.metrics.recycled : null,
            treatedNonRecycling: typeof uploadedWaste.metrics.treated === 'number' ? uploadedWaste.metrics.treated : null,
            safelyDisposed: typeof uploadedWaste.metrics.safelyDisposed === 'number' ? uploadedWaste.metrics.safelyDisposed : null,
            unmanaged: typeof uploadedWaste.metrics.unmanaged === 'number' ? uploadedWaste.metrics.unmanaged : null,
            unit: 'tonnes/day',
          },
          systemConfig.wmiWeights,
          systemConfig.wmiMethodologyVersion,
          'uploaded'
        );
        wasteSummary = {
          wmi: computedWmi.wmi,
          classification: computedWmi.classification,
          weakestComponent: computedWmi.weakestComponent,
          source: uploadedWaste.source,
          sourceStatus: 'Live',
        };
      } else {
        const sampleWaste = getSampleWasteDataset(location.name, location.countryCode);
        const sampleWmi = calculateEcoWmi(
          sampleWaste.inputs,
          systemConfig.wmiWeights,
          systemConfig.wmiMethodologyVersion,
          'sample_reference'
        );
        wasteSummary = {
          wmi: sampleWmi.wmi,
          classification: sampleWmi.classification,
          weakestComponent: sampleWmi.weakestComponent,
          source: sampleWaste.sourceLabel,
          sourceStatus: 'Sample',
        };
      }

      const aqProvider = dataSources.find((d) => d.id === 'open-meteo-aq');
      const wxProvider = dataSources.find((d) => d.id === 'open-meteo-weather');
      const emberProvider = dataSources.find((d) => d.id === 'ember-energy');

      const snapshot: CompactChatSnapshot = {
        location,
        reportingPeriod,
        air: aqi
          ? {
              aqi: aqi.aqi,
              standardName: aqi.standardName,
              category: aqi.category,
              dominantPollutant: aqi.dominantPollutant,
              pm25: airData?.current.pm25 ?? null,
              pm10: airData?.current.pm10 ?? null,
              no2: airData?.current.no2 ?? null,
              o3: airData?.current.o3 ?? null,
              source: aqi.source,
              sourceStatus: toSnapStatus(aqProvider?.status),
              healthGuidance: aqi.healthGuidance,
              lastUpdated: aqi.lastUpdated,
            }
          : null,
        weather: weatherData
          ? {
              temperatureC: weatherData.current.temperatureC,
              humidityPct: weatherData.current.humidityPct,
              windSpeedKmh: weatherData.current.windSpeedKmh,
              weatherLabel: weatherData.current.weatherLabel,
              warningsCount: weatherData.warnings.length,
              sourceStatus: toSnapStatus(wxProvider?.status),
            }
          : null,
        water: waterSummary,
        waste: wasteSummary,
        energy: energyData
          ? {
              latestRenewablePct: energyData.latestRenewablePct,
              latestRenewableYear: energyData.latestRenewableYear,
              latestElectricityKwhPerCapita: energyData.latestElectricityKwhPerCapita,
              source: energyData.source,
              sourceStatus: toSnapStatus(emberProvider?.status),
              fallbackProvider: emberProvider?.fallbackProvider,
            }
          : null,
        anomalies: anomalies.slice(0, 5).map((a) => ({
          parameter: a.parameter,
          observedValue: a.observedValue,
          baselineValue: a.baselineValue,
          unit: a.unit,
          severity: a.severity,
          reason: a.reason,
        })),
        providerStatuses: dataSources.map((d) => ({
          name: d.name,
          category: d.category,
          status: toSnapStatus(d.status),
          ...(d.fallbackProvider ? { fallbackProvider: d.fallbackProvider } : {}),
        })),
      };

      const result = await generateEcoAiChatResponse({
        userQuestion: question,
        snapshot,
        history,
      });

      aiLogs.unshift({
        id: `ai-${Date.now()}`,
        userEmail: req.user?.email || 'chatbot-user',
        locationName: location.name,
        promptPreview: question.slice(0, 120),
        status: 'success',
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      });
      if (aiLogs.length > 50) aiLogs.length = 50;

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI assistant request failed';
      aiLogs.unshift({
        id: `ai-err-${Date.now()}`,
        userEmail: req.user?.email || 'chatbot-user',
        locationName: location.name,
        promptPreview: question.slice(0, 120),
        status: 'error',
        latencyMs: Date.now() - start,
        error: msg,
        timestamp: new Date().toISOString(),
      });
      res.status(502).json({ error: msg });
    }
  });

  // EcoAI Overview Summary & Recommendations (Always returns compact AI or rule-based fallback cleanly)
  app.post('/api/ai/summary', rateLimit(30, 60_000), async (req, res) => {
    const start = Date.now();
    const { locationName, groundedContext } = (req.body || {}) as {
      locationName?: string;
      groundedContext?: CompactSummaryContext;
    };
    if (!locationName || !groundedContext) {
      res.status(400).json({ error: 'locationName and groundedContext are required.' });
      return;
    }

    try {
      const result = await generateOverviewSummary({ locationName, groundedContext });
      aiLogs.unshift({
        id: `ai-sum-${Date.now()}`,
        userEmail: req.user?.email || 'dashboard-user',
        locationName,
        promptPreview: `Overview Summary (${result.mode})`,
        status: 'success',
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      });
      if (aiLogs.length > 50) aiLogs.length = 50;
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected summary error';
      res.json(
        buildRuleBasedOverviewSummary({
          locationName,
          context: groundedContext,
          fallbackReason: msg,
        })
      );
    }
  });

  // Normalized Data Sources Registry & On-Demand Connection Verification (Public Safe Proxy)
  app.get('/api/env/sources', rateLimit(45, 60_000), async (req, res) => {
    try {
      const lat = Number(req.query.lat ?? 28.65195);
      const lon = Number(req.query.lon ?? 77.23149);
      const countryCode = String(req.query.countryCode || 'IN').toUpperCase();
      const locationName = String(req.query.name || 'Delhi, India');
      const { dataSources } = await getAllDataSourcesSnapshot({ lat, lon, countryCode, locationName });
      res.json({ sources: dataSources });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load data sources' });
    }
  });

  app.post('/api/env/sources/:id/test', rateLimit(30, 60_000), async (req, res) => {
    const { lat, lon, countryCode, locationName } = (req.body || {}) as {
      lat?: number;
      lon?: number;
      countryCode?: string;
      locationName?: string;
    };
    const result = await testProviderConnection(req.params.id, { lat, lon, countryCode, locationName });
    res.json(result);
  });

  // Public read-only status of environmental providers (no secrets, real fallback-aware status)
  app.get('/api/env/providers-status', async (_req, res) => {
    try {
      const { dataSources } = await getAllDataSourcesSnapshot({
        lat: 28.65195,
        lon: 77.23149,
        countryCode: 'IN',
        locationName: 'Delhi, India',
      });
      res.json({
        providers: dataSources.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          status: s.status,
          fallbackProvider: s.fallbackProvider,
          fallbackDescription: s.fallbackDescription,
          isSampleData: s.isSampleData,
          isCached: s.isCached,
          cachedAt: s.cachedAt,
          cacheAgeMinutes: s.cacheAgeMinutes,
          lastSyncAt: s.lastUpdated,
          documentationUrl: s.documentationUrl,
        })),
      });
    } catch {
      res.json({
        providers: getProviders().map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          status: p.healthStatus,
          fallbackProvider: p.fallbackProvider,
          fallbackDescription: p.fallbackDescription,
          isSampleData: p.isSampleData,
          lastSyncAt: p.lastSyncAt,
          documentationUrl: p.documentationUrl,
        })),
      });
    }
  });

  // ==========================
  // ADMINISTRATOR ROUTES (RBAC)
  // ==========================
  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    res.json({
      monitoredLocations,
      providers: getProviders(),
      syncLogs: getSyncLogs(),
      importHistory: importHistory.slice(0, 30),
      aiLogs: aiLogs.slice(0, 30),
      alerts: serverAlerts.slice(0, 30),
      systemConfig,
      cachedSnapshotsCount: cachedAqiSnapshots.size,
    });
  });

  app.post('/api/admin/providers/:id', requireAdmin, (req, res) => {
    const schema = z.object({
      enabled: z.boolean().optional(),
      refreshIntervalMinutes: z.number().min(5).max(1440).optional(),
      endpoint: z.string().url().optional(),
      apiKey: z.string().max(300).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid provider update payload' });
      return;
    }
    const updated = updateProviderConfig(req.params.id, parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    res.json({ provider: updated });
  });

  app.post('/api/admin/providers', requireAdmin, (req, res) => {
    const schema = z.object({
      name: z.string().min(2).max(120),
      category: z.enum(['air', 'water', 'waste', 'energy', 'weather']),
      endpoint: z.string().url().refine((u) => u.startsWith('https://'), 'HTTPS endpoint required'),
      authType: z.enum(['none', 'api_key_header', 'api_key_query', 'bearer']),
      refreshIntervalMinutes: z.number().min(5).max(1440),
      apiKey: z.string().max(300).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid provider registration', details: parsed.error.flatten() });
      return;
    }
    try {
      const created = registerCustomProvider(parsed.data);
      res.json({ provider: created });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid custom provider configuration' });
    }
  });

  app.post('/api/admin/providers/:id/test', requireAdmin, async (req, res) => {
    const result = await testProviderConnection(req.params.id);
    res.json(result);
  });

  app.post('/api/admin/scheduler/run', requireAdmin, async (_req, res) => {
    await runIngestionCycle('manual');
    res.json({ ok: true, lastJobRunAt: systemConfig.lastJobRunAt, syncLogs: getSyncLogs() });
  });

  app.post('/api/admin/settings', requireAdmin, (req, res) => {
    const schema = z.object({
      forecastingEnabled: z.boolean().optional(),
      anomalyZThreshold: z.number().min(1).max(6).optional(),
      defaultPollIntervalMin: z.number().min(5).max(1440).optional(),
      wmiWeights: z
        .object({
          collection: z.number().min(0).max(1),
          segregation: z.number().min(0).max(1),
          recycling: z.number().min(0).max(1),
          treatment: z.number().min(0).max(1),
          safeDisposal: z.number().min(0).max(1),
          unmanagedControl: z.number().min(0).max(1),
        })
        .optional(),
      wmiMethodologyVersion: z.string().min(1).max(40).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid system settings' });
      return;
    }
    if (typeof parsed.data.forecastingEnabled === 'boolean') {
      systemConfig.forecastingEnabled = parsed.data.forecastingEnabled;
    }
    if (typeof parsed.data.anomalyZThreshold === 'number') {
      systemConfig.anomalyZThreshold = parsed.data.anomalyZThreshold;
    }
    if (typeof parsed.data.defaultPollIntervalMin === 'number') {
      systemConfig.defaultPollIntervalMin = parsed.data.defaultPollIntervalMin;
    }
    if (parsed.data.wmiWeights) {
      const sum = Object.values(parsed.data.wmiWeights).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 0.01) {
        res.status(400).json({ error: `WMI weights must sum to 1.00 (currently ${sum.toFixed(2)})` });
        return;
      }
      systemConfig.wmiWeights = parsed.data.wmiWeights;
    }
    if (parsed.data.wmiMethodologyVersion) {
      systemConfig.wmiMethodologyVersion = parsed.data.wmiMethodologyVersion;
    }
    res.json({ systemConfig });
  });

  app.post('/api/admin/locations', requireAdmin, (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(160),
      city: z.string().min(1).max(120),
      state: z.string().max(120).optional(),
      country: z.string().min(1).max(100),
      countryCode: z.string().min(2).max(5),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      population: z.number().positive().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid location payload' });
      return;
    }
    const created = { id: `loc-${Date.now()}`, ...parsed.data };
    monitoredLocations.push(created);
    res.json({ location: created });
  });

  app.post('/api/admin/roles', requireAdmin, (req, res) => {
    if (req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only SUPER_ADMIN can assign administrator roles.' });
      return;
    }
    const schema = z.object({
      email: z.string().email(),
      role: z.enum(['USER', 'ADMIN', 'SUPER_ADMIN']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid email and role required.' });
      return;
    }
    setRuntimeAdminRole(parsed.data.email, parsed.data.role);
    res.json({ ok: true, email: parsed.data.email, role: parsed.data.role });
  });

  // Unknown /api and /api/* 404 handler (registered BEFORE Vite middleware & SPA catch-all so APIs NEVER return HTML)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // API JSON Error Handler (catches malformed JSON bodies, payload limits, and route errors)
  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { status?: number; statusCode?: number; type?: string; message?: string };
    const isJsonSyntax = e?.type === 'entity.parse.failed' || err instanceof SyntaxError;
    const status = isJsonSyntax ? 400 : e?.status || e?.statusCode || 500;
    const message = isJsonSyntax
      ? 'Invalid JSON request body.'
      : e?.message || 'Internal server error';
    if (!res.headersSent) {
      res.status(status).json({ error: message });
    }
  });

  const httpServer = http.createServer(app);

  // Vite middleware in dev / static files in production
  if (process.env.NODE_ENV !== 'production') {
    process.env.DISABLE_HMR = 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: false,
        forwardConsole: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // Global fallback Express error handler
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { status?: number; statusCode?: number; message?: string };
    const status = e?.status || e?.statusCode || 500;
    if (req.path.startsWith('/api')) {
      if (!res.headersSent) {
        res.status(status).json({ error: e?.message || 'Internal server error' });
      }
      return;
    }
    if (!res.headersSent) {
      res.status(status).json({ error: e?.message || 'Server error' });
    }
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`EcoIntelligence server running on http://0.0.0.0:${PORT}`);
    startBackgroundScheduler();
  });
}

startServer().catch((err) => {
  console.error('Failed to start EcoIntelligence server:', err);
  process.exit(1);
});
