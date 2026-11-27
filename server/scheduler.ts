import { calculateJurisdictionAqi } from './engines/aqiEngine';
import { detectSeriesAnomalies } from './engines/anomalyForecastEngine';
import { addSyncLog, fetchOpenMeteoAirQuality, fetchOpenMeteoWeather } from './providers/environmentalProviders';
import { cachedAqiSnapshots, monitoredLocations, serverAlerts, systemConfig } from './store';

let intervalHandle: NodeJS.Timeout | null = null;

export async function runIngestionCycle(trigger: 'scheduled' | 'manual' = 'scheduled') {
  if (systemConfig.lastJobStatus === 'running') return;
  systemConfig.lastJobStatus = 'running';
  const startedAt = new Date().toISOString();
  let ingestedCount = 0;

  try {
    // Poll up to 6 monitored locations (including synced user current locations) per cycle
    const targets = monitoredLocations.slice(0, 6);
    for (const loc of targets) {
      try {
        const [aq, weather] = await Promise.all([
          fetchOpenMeteoAirQuality(loc.latitude, loc.longitude, 3),
          fetchOpenMeteoWeather(loc.latitude, loc.longitude),
        ]);

        const aqiResult = calculateJurisdictionAqi({
          countryCode: loc.countryCode,
          readings: aq.current,
          source: aq.source,
          station: aq.station,
          lastUpdated: aq.current.time,
          originType: 'latest_available',
        });

        const pm25Series = aq.hourly
          .filter((h) => h.pm25 !== null)
          .map((h) => ({ timestamp: h.timestamp, value: h.pm25 as number }));

        const anomalies = detectSeriesAnomalies({
          category: 'air',
          parameter: 'PM2.5',
          unit: 'µg/m³',
          series: pm25Series,
          zThreshold: systemConfig.anomalyZThreshold,
          highThreshold: loc.countryCode === 'IN' ? 90 : 55.4,
        });

        cachedAqiSnapshots.set(loc.id, {
          location: loc,
          aqi: aqiResult,
          anomalies,
          updatedAt: new Date().toISOString(),
        });

        ingestedCount += aq.hourly.length;

        // Generate alerts if AQI is poor/severe or weather advisories exist
        if (aqiResult.severityLevel === 'severe' || aqiResult.severityLevel === 'poor') {
          const alertId = `alert-aqi-${loc.id}-${new Date().toISOString().slice(0, 13)}`;
          if (!serverAlerts.some((a) => a.id === alertId)) {
            serverAlerts.unshift({
              id: alertId,
              locationName: loc.name,
              title: `${aqiResult.standardName}: ${aqiResult.category} (${aqiResult.aqi})`,
              category: 'air',
              severity: aqiResult.severityLevel === 'severe' ? 'critical' : 'high',
              measuredValue: `AQI ${aqiResult.aqi} (Dominant: ${aqiResult.dominantPollutant || 'N/A'})`,
              threshold: aqiResult.standardCode === 'CPCB_IN' ? 'CPCB > 200 (Poor/Severe)' : 'EPA > 100',
              source: aq.source,
              explanation: `Latest measured air quality in ${loc.city} reached ${aqiResult.category}.`,
              recommendedAction: aqiResult.healthGuidance,
              timestamp: new Date().toISOString(),
            });
          }
        }

        for (const anom of anomalies) {
          const anomAlertId = `alert-anom-${loc.id}-${anom.parameter}-${new Date().toISOString().slice(0, 13)}`;
          if (!serverAlerts.some((a) => a.id === anomAlertId)) {
            serverAlerts.unshift({
              id: anomAlertId,
              locationName: loc.name,
              title: `Abnormal ${anom.parameter} Surge Detected`,
              category: 'air',
              severity: anom.severity,
              measuredValue: `${anom.observedValue} ${anom.unit}`,
              threshold: `Baseline ${anom.baselineValue} ${anom.unit} (Z=${anom.zScore})`,
              source: aq.source,
              explanation: anom.reason,
              recommendedAction: 'Monitor hourly trend and limit prolonged outdoor exertion until levels stabilize.',
              timestamp: anom.timestamp,
            });
          }
        }

        for (const w of weather.warnings) {
          const wId = `alert-wx-${loc.id}-${w.title.slice(0, 12)}-${new Date().toISOString().slice(0, 10)}`;
          if (!serverAlerts.some((a) => a.id === wId)) {
            serverAlerts.unshift({
              id: wId,
              locationName: loc.name,
              title: w.title,
              category: 'climate',
              severity: w.severity,
              measuredValue: w.detail,
              threshold: 'Short-term Meteorological Threshold',
              source: weather.source,
              explanation: w.detail,
              recommendedAction: 'Follow local meteorological preparedness advisories.',
              timestamp: weather.issuedAt,
            });
          }
        }

        addSyncLog({
          providerId: 'open-meteo-aq',
          providerName: 'Open-Meteo Air & Weather',
          locationName: loc.name,
          status: 'success',
          recordsIngested: aq.hourly.length,
          message: `${trigger} cycle completed cleanly (AQI: ${aqiResult.aqi ?? 'N/A'})`,
          syncedAt: new Date().toISOString(),
        });
      } catch (locErr) {
        systemConfig.processingErrors++;
        addSyncLog({
          providerId: 'open-meteo-aq',
          providerName: 'Open-Meteo Air & Weather',
          locationName: loc.name,
          status: 'error',
          recordsIngested: 0,
          message: locErr instanceof Error ? locErr.message : 'Location ingestion failed',
          syncedAt: new Date().toISOString(),
        });
      }
    }

    if (serverAlerts.length > 80) serverAlerts.length = 80;
    systemConfig.totalIngestedRecords += ingestedCount;
    systemConfig.lastJobRunAt = startedAt;
    systemConfig.lastJobStatus = 'completed';
  } catch {
    systemConfig.lastJobStatus = 'error';
    systemConfig.processingErrors++;
  }
}

export function startBackgroundScheduler() {
  if (intervalHandle) clearInterval(intervalHandle);
  // Run initial cycle shortly after boot, then on configured interval
  setTimeout(() => {
    void runIngestionCycle('scheduled');
  }, 4000);
  intervalHandle = setInterval(() => {
    void runIngestionCycle('scheduled');
  }, systemConfig.defaultPollIntervalMin * 60 * 1000);
}
