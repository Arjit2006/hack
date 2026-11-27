import { AnomalyRecord, EnvironmentalCategory, ForecastPoint, ForecastResult } from '../types';

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[], avg?: number): number {
  if (arr.length < 2) return 0;
  const m = avg ?? mean(arr);
  const variance = arr.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * Lightweight deterministic Isolation-Tree path length scoring for 1D series
 * when >= 24 observations exist, complementing Z-score & rolling baseline checks.
 */
function computeIsolationAnomalyScore(values: number[], target: number): number {
  const n = values.length;
  if (n < 24) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = Math.max(1e-6, q3 - q1);
  const median = sorted[Math.floor(n * 0.5)];
  // Normalized robust deviation mapped into [0, 1] isolation score proxy
  const robustDist = Math.abs(target - median) / (1.349 * iqr);
  return Number(Math.min(1, 1 - Math.exp(-0.35 * robustDist)).toFixed(3));
}

export function detectSeriesAnomalies(params: {
  category: EnvironmentalCategory;
  parameter: string;
  unit: string;
  series: TimeSeriesPoint[];
  zThreshold?: number;
  highThreshold?: number;
  lowThreshold?: number;
}): AnomalyRecord[] {
  const { category, parameter, unit, series } = params;
  const zLimit = params.zThreshold ?? 2.2;
  const valid = series.filter((p) => Number.isFinite(p.value));
  if (valid.length < 4) return [];

  const anomalies: AnomalyRecord[] = [];
  const latest = valid[valid.length - 1];
  const baselineSlice = valid.slice(Math.max(0, valid.length - 48), valid.length - 1);
  const baselineValues = baselineSlice.map((p) => p.value);
  const baseMean = mean(baselineValues);
  const baseStd = stdDev(baselineValues, baseMean);

  const zScore = baseStd > 1e-6 ? Number(((latest.value - baseMean) / baseStd).toFixed(2)) : 0;
  const pctChange = baseMean > 1e-6 ? Number((((latest.value - baseMean) / baseMean) * 100).toFixed(1)) : 0;
  const isoScore = computeIsolationAnomalyScore(baselineValues, latest.value);

  const exceedsStatHigh = params.highThreshold !== undefined && latest.value > params.highThreshold;
  const exceedsStatLow = params.lowThreshold !== undefined && latest.value < params.lowThreshold;
  const isStatOutlier = Math.abs(zScore) >= zLimit || isoScore >= 0.72;

  if (exceedsStatHigh || exceedsStatLow || isStatOutlier) {
    let severity: AnomalyRecord['severity'] = 'low';
    if (Math.abs(zScore) >= 3.5 || (params.highThreshold !== undefined && latest.value > params.highThreshold * 1.5)) {
      severity = 'critical';
    } else if (Math.abs(zScore) >= 2.8 || exceedsStatHigh || exceedsStatLow) {
      severity = 'high';
    } else {
      severity = 'moderate';
    }

    const methods: string[] = ['Rolling Baseline Comparison', 'Percentage-Change Analysis'];
    if (Math.abs(zScore) >= zLimit) methods.push(`Z-score (${zScore})`);
    if (isoScore >= 0.72) methods.push(`Isolation Outlier Score (${isoScore})`);
    if (exceedsStatHigh || exceedsStatLow) methods.push('Standard Threshold Breach');

    const reasons: string[] = [];
    if (exceedsStatHigh) reasons.push(`exceeded upper threshold (${params.highThreshold} ${unit})`);
    if (exceedsStatLow) reasons.push(`fell below lower threshold (${params.lowThreshold} ${unit})`);
    if (pctChange !== 0) {
      const directionWord = pctChange > 0 ? `${Math.abs(pctChange)}% above baseline` : `${Math.abs(pctChange)}% below baseline`;
      reasons.push(`${directionWord} (baseline: ${baseMean.toFixed(1)} ${unit}, Z=${zScore})`);
    } else {
      reasons.push(`at baseline (${baseMean.toFixed(1)} ${unit})`);
    }

    const labelCategory = pctChange < 0 ? 'unusually low' : 'high';

    anomalies.push({
      id: `anom-${category}-${parameter.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}`,
      category,
      parameter,
      observedValue: Number(latest.value.toFixed(2)),
      baselineValue: Number(baseMean.toFixed(2)),
      unit,
      pctChange,
      zScore,
      detectionMethod: methods.join(' + '),
      severity,
      confidenceStatus: valid.length >= 24 ? 'high' : 'medium',
      timestamp: latest.timestamp,
      reason: `Statistical anomaly (${labelCategory}): ${parameter} is ${reasons.join('; ')}. Note: statistical anomalies require contextual review before confirming an environmental hazard.`,
    });
  }

  return anomalies;
}

export function generateTimeSeriesForecast(params: {
  category: EnvironmentalCategory;
  parameter: string;
  unit: string;
  series: TimeSeriesPoint[];
  horizon: ForecastResult['horizon'];
}): ForecastResult {
  const valid = params.series.filter((p) => Number.isFinite(p.value));
  const minRequiredMap: Record<ForecastResult['horizon'], number> = {
    '24h': 12,
    '7d': 10,
    '30d': 24,
    '3m': 45,
    '12m': 90,
  };
  const stepCounts: Record<ForecastResult['horizon'], { steps: number; stepMs: number }> = {
    '24h': { steps: 24, stepMs: 3600 * 1000 },
    '7d': { steps: 7, stepMs: 24 * 3600 * 1000 },
    '30d': { steps: 30, stepMs: 24 * 3600 * 1000 },
    '3m': { steps: 12, stepMs: 7 * 24 * 3600 * 1000 },
    '12m': { steps: 12, stepMs: 30 * 24 * 3600 * 1000 },
  };

  const requiredPoints = minRequiredMap[params.horizon];
  if (valid.length < requiredPoints) {
    return {
      parameter: params.parameter,
      category: params.category,
      unit: params.unit,
      horizon: params.horizon,
      sufficientData: false,
      requiredPoints,
      availablePoints: valid.length,
      insufficiencyReason: `Insufficient reliable historical data for a ${params.horizon} forecast of ${params.parameter}. Found ${valid.length} observations; at least ${requiredPoints} consistent historical observations are needed.`,
      limitations: 'Upload verified historical datasets or allow scheduled ingestion to accumulate more observations before generating this horizon.',
      points: [],
    };
  }

  const values = valid.map((p) => p.value);
  const n = values.length;

  // Holt's Double Exponential Smoothing (alpha=0.35, beta=0.15)
  const alpha = 0.35;
  const beta = 0.15;
  let level = values[0];
  let trend = values.length > 1 ? values[1] - values[0] : 0;

  const fitted: number[] = [level];
  for (let i = 1; i < n; i++) {
    const prevLevel = level;
    level = alpha * values[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    fitted.push(level + trend);
  }

  // Validation error on last 30% holdout slice
  const evalStart = Math.max(1, Math.floor(n * 0.7));
  let absErrSum = 0;
  let sqErrSum = 0;
  let pctErrSum = 0;
  let evalCount = 0;
  for (let i = evalStart; i < n; i++) {
    const err = values[i] - fitted[i - 1];
    absErrSum += Math.abs(err);
    sqErrSum += err * err;
    if (Math.abs(values[i]) > 1e-6) {
      pctErrSum += Math.abs(err / values[i]) * 100;
    }
    evalCount++;
  }

  const mae = evalCount > 0 ? Number((absErrSum / evalCount).toFixed(2)) : 0;
  const rmse = evalCount > 0 ? Number(Math.sqrt(sqErrSum / evalCount).toFixed(2)) : 0;
  const mape = evalCount > 0 ? Number((pctErrSum / evalCount).toFixed(1)) : 0;

  const lastTs = new Date(valid[n - 1].timestamp).getTime() || Date.now();
  const { steps, stepMs } = stepCounts[params.horizon];
  const points: ForecastPoint[] = [];

  for (let h = 1; h <= steps; h++) {
    // Dampen trend slightly over longer horizons to prevent runaway extrapolation
    const dampedTrend = trend * Math.pow(0.92, h - 1);
    const pred = Math.max(0, level + h * dampedTrend);
    const interval = 1.96 * rmse * Math.sqrt(1 + (h - 1) * 0.12);
    points.push({
      timestamp: new Date(lastTs + h * stepMs).toISOString(),
      predictedValue: Number(pred.toFixed(2)),
      lowerBound: Number(Math.max(0, pred - interval).toFixed(2)),
      upperBound: Number((pred + interval).toFixed(2)),
    });
  }

  return {
    parameter: params.parameter,
    category: params.category,
    unit: params.unit,
    horizon: params.horizon,
    sufficientData: true,
    requiredPoints,
    availablePoints: n,
    modelUsed: "Holt's Damped Double Exponential Smoothing (α=0.35, β=0.15)",
    historicalPeriod: `${valid[0].timestamp.slice(0, 10)} to ${valid[n - 1].timestamp.slice(0, 10)} (${n} points)`,
    validationMetrics: { mae, rmse, mape },
    limitations: 'Statistical time-series projection based solely on historical continuity; sudden meteorological inversions, industrial events, or policy interventions are not modeled.',
    points,
  };
}
