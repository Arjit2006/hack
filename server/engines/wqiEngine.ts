import { DataOriginType, WaterUseType, WqiCalculationResult, WqiParameterBreakdown, WqiParameterInput } from '../types';

interface WaterParamStandard {
  key: WqiParameterInput['key'];
  label: string;
  unit: string;
  direction: 'two_sided' | 'higher_better' | 'lower_better';
  ideal: number; // V0 (for DO, dynamically computed from temp & salinity)
  standardMax: number; // Si upper (or Si min for DO)
  standardMin?: number; // For pH lower bound
  essential?: boolean;
}

interface WaterStandardProfile {
  waterUse: WaterUseType;
  standardName: string;
  standardVersion: string;
  params: WaterParamStandard[];
}

export const WATER_STANDARDS: Record<WaterUseType, WaterStandardProfile> = {
  drinking: {
    waterUse: 'drinking',
    standardName: 'BIS IS 10500:2012 / WHO Drinking Water Guidelines',
    standardVersion: 'BIS-IS-10500-2012-Rev2',
    params: [
      { key: 'ph', label: 'pH', unit: 'pH units', direction: 'two_sided', ideal: 7.0, standardMin: 6.5, standardMax: 8.5, essential: true },
      { key: 'do', label: 'Dissolved Oxygen (DO)', unit: 'mg/L', direction: 'higher_better', ideal: 8.26, standardMax: 6.0, essential: true },
      { key: 'bod', label: 'Biological Oxygen Demand (BOD)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 2.0 },
      { key: 'tds', label: 'Total Dissolved Solids (TDS)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 500, essential: true },
      { key: 'turbidity', label: 'Turbidity', unit: 'NTU', direction: 'lower_better', ideal: 0, standardMax: 1.0, essential: true },
      { key: 'nitrate', label: 'Nitrate (NO3-)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 45.0, essential: true },
    ],
  },
  bathing: {
    waterUse: 'bathing',
    standardName: 'CPCB Designated Best Use Class B (Outdoor Bathing)',
    standardVersion: 'CPCB-DBU-Class-B-2024',
    params: [
      { key: 'ph', label: 'pH', unit: 'pH units', direction: 'two_sided', ideal: 7.0, standardMin: 6.5, standardMax: 8.5, essential: true },
      { key: 'do', label: 'Dissolved Oxygen (DO)', unit: 'mg/L', direction: 'higher_better', ideal: 8.26, standardMax: 5.0, essential: true },
      { key: 'bod', label: 'Biological Oxygen Demand (BOD)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 3.0, essential: true },
      { key: 'turbidity', label: 'Turbidity', unit: 'NTU', direction: 'lower_better', ideal: 0, standardMax: 5.0 },
      { key: 'nitrate', label: 'Nitrate (NO3-)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 45.0 },
    ],
  },
  surface: {
    waterUse: 'surface',
    standardName: 'CPCB Designated Best Use Class D (Surface Water / Wildlife)',
    standardVersion: 'CPCB-DBU-Class-D-2024',
    params: [
      { key: 'ph', label: 'pH', unit: 'pH units', direction: 'two_sided', ideal: 7.0, standardMin: 6.5, standardMax: 8.5, essential: true },
      { key: 'do', label: 'Dissolved Oxygen (DO)', unit: 'mg/L', direction: 'higher_better', ideal: 8.26, standardMax: 4.0, essential: true },
      { key: 'bod', label: 'Biological Oxygen Demand (BOD)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 6.0, essential: true },
      { key: 'cod', label: 'Chemical Oxygen Demand (COD)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 30.0 },
      { key: 'tds', label: 'Total Dissolved Solids (TDS)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 1500 },
      { key: 'nitrate', label: 'Nitrate (NO3-)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 50.0 },
    ],
  },
  irrigation: {
    waterUse: 'irrigation',
    standardName: 'CPCB Class E / FAO Irrigation Water Quality Standard',
    standardVersion: 'CPCB-E-FAO-2024',
    params: [
      { key: 'ph', label: 'pH', unit: 'pH units', direction: 'two_sided', ideal: 7.0, standardMin: 6.0, standardMax: 8.5, essential: true },
      { key: 'tds', label: 'Total Dissolved Solids (TDS)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 2100, essential: true },
      { key: 'bod', label: 'Biological Oxygen Demand (BOD)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 10.0 },
      { key: 'nitrate', label: 'Nitrate (NO3-)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 50.0 },
    ],
  },
  ecosystem: {
    waterUse: 'ecosystem',
    standardName: 'Freshwater Aquatic Ecosystem Monitoring Benchmark',
    standardVersion: 'ECO-AQUA-2024',
    params: [
      { key: 'ph', label: 'pH', unit: 'pH units', direction: 'two_sided', ideal: 7.0, standardMin: 6.5, standardMax: 8.5, essential: true },
      { key: 'do', label: 'Dissolved Oxygen (DO)', unit: 'mg/L', direction: 'higher_better', ideal: 8.26, standardMax: 5.5, essential: true },
      { key: 'bod', label: 'Biological Oxygen Demand (BOD)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 3.0, essential: true },
      { key: 'cod', label: 'Chemical Oxygen Demand (COD)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 20.0 },
      { key: 'turbidity', label: 'Turbidity', unit: 'NTU', direction: 'lower_better', ideal: 0, standardMax: 10.0 },
      { key: 'nitrate', label: 'Nitrate (NO3-)', unit: 'mg/L', direction: 'lower_better', ideal: 0, standardMax: 20.0 },
    ],
  },
};

/**
 * Compute temperature- and salinity-adjusted Dissolved Oxygen saturation (mg/L)
 * using simplified Weiss / APHA empirical equation at 1 atm.
 */
export function computeDoSaturation(temperatureC = 25, salinityPpt = 0): number {
  const T = temperatureC + 273.15;
  const lnC =
    -139.34411 +
    1.575701e5 / T -
    6.642308e7 / Math.pow(T, 2) +
    1.2438e10 / Math.pow(T, 3) -
    8.621949e11 / Math.pow(T, 4);
  const freshwaterSat = Math.exp(lnC);
  // Salinity correction factor
  const salFactor = Math.exp(-salinityPpt * (0.017674 - 10.754 / T + 2140.7 / Math.pow(T, 2)));
  return Number((freshwaterSat * salFactor).toFixed(2));
}

export function calculateWawqi(options: {
  waterUse: WaterUseType;
  inputs: Partial<Record<WqiParameterInput['key'], number | null>>;
  temperatureC?: number;
  salinityPpt?: number;
  dataOrigin?: DataOriginType;
}): WqiCalculationResult {
  const profile = WATER_STANDARDS[options.waterUse];
  const tempC = options.temperatureC ?? 25;
  const salPpt = options.salinityPpt ?? 0;
  const doSat = computeDoSaturation(tempC, salPpt);

  // Microbiological safety is always evaluated separately and never buried in WAWQI
  const coliformVal = options.inputs.coliform ?? null;
  const coliformLimit = options.waterUse === 'drinking' ? 0 : options.waterUse === 'bathing' ? 500 : 5000;
  const microbiologicalAlert = coliformVal !== null && Number.isFinite(coliformVal) && coliformVal > coliformLimit;
  const microbiologicalMessage =
    coliformVal === null || !Number.isFinite(coliformVal)
      ? null
      : microbiologicalAlert
        ? `MICROBIOLOGICAL HAZARD: Total Coliform measured at ${coliformVal} MPN/100mL exceeds ${options.waterUse} limit (${coliformLimit} MPN/100mL). Do not rely on aggregate WQI alone.`
        : `Microbiological check passed: Total Coliform (${coliformVal} MPN/100mL) is within limit (${coliformLimit} MPN/100mL).`;

  // Calculate inverse standard weights only over AVAILABLE parameters (never treat missing as zero)
  const allParams = profile.params;
  const availableParams = allParams.filter((p) => {
    const v = options.inputs[p.key];
    return v !== undefined && v !== null && Number.isFinite(v);
  });

  const completenessPct = Math.round((availableParams.length / allParams.length) * 100);
  const totalTheoreticalInvSi = allParams.reduce((acc, p) => acc + 1 / p.standardMax, 0);
  const availableInvSi = availableParams.reduce((acc, p) => acc + 1 / p.standardMax, 0);
  const weightCoveragePct = totalTheoreticalInvSi > 0 ? Math.round((availableInvSi / totalTheoreticalInvSi) * 100) : 0;

  const missingEssential = allParams.some((p) => p.essential && (options.inputs[p.key] === undefined || options.inputs[p.key] === null));
  const isProvisional = completenessPct < 70 || missingEssential;

  if (availableParams.length === 0) {
    return {
      wqi: null,
      classification: 'Data Unavailable',
      severityLevel: 'unavailable',
      noteDirection: 'Lower WQI = Better water quality (Weighted Arithmetic WQI)',
      classificationNote: 'Methodology-specific bands (WAWQI 0–25, 26–50, 51–75, 76–100, >100) are not universal regulatory ratings.',
      waterUse: options.waterUse,
      standardName: profile.standardName,
      standardVersion: profile.standardVersion,
      methodology: 'Weighted Arithmetic Water Quality Index (WAWQI)',
      completenessPct: 0,
      weightCoveragePct: 0,
      isProvisional: true,
      microbiologicalAlert,
      microbiologicalMessage,
      deteriorationDrivers: [],
      recommendations: ['Collect or upload verified water quality readings (pH, DO, BOD, TDS, Turbidity, Nitrate) for this location.'],
      breakdown: allParams.map((p) => ({
        key: p.key,
        label: p.label,
        measuredValue: null,
        unit: p.unit,
        idealValue: p.key === 'do' ? doSat : p.ideal,
        standardLimit: p.direction === 'two_sided' ? `${p.standardMin}–${p.standardMax}` : p.direction === 'higher_better' ? `≥ ${p.standardMax}` : `≤ ${p.standardMax}`,
        unitWeight: null,
        qualityRatingQi: null,
        weightedContribution: null,
        status: 'missing',
      })),
      calculatedAt: new Date().toISOString(),
      dataOrigin: options.dataOrigin ?? 'uploaded',
    };
  }

  // K = 1 / Sum(1 / Si) over available parameters
  const K = 1 / availableInvSi;
  let sumWiQi = 0;
  let sumWi = 0;
  const breakdown: WqiParameterBreakdown[] = [];
  const drivers: Array<{ label: string; contribution: number; detail: string }> = [];

  for (const p of allParams) {
    const rawVal = options.inputs[p.key];
    if (rawVal === undefined || rawVal === null || !Number.isFinite(rawVal)) {
      breakdown.push({
        key: p.key,
        label: p.label,
        measuredValue: null,
        unit: p.unit,
        idealValue: p.key === 'do' ? doSat : p.ideal,
        standardLimit: p.direction === 'two_sided' ? `${p.standardMin}–${p.standardMax}` : p.direction === 'higher_better' ? `≥ ${p.standardMax}` : `≤ ${p.standardMax}`,
        unitWeight: null,
        qualityRatingQi: null,
        weightedContribution: null,
        status: 'missing',
      });
      continue;
    }

    const vi = rawVal;
    const wi = K / p.standardMax;
    let qi = 0;
    let idealDisplay: number | string = p.ideal;
    let status: WqiParameterBreakdown['status'] = 'within_limit';

    if (p.direction === 'two_sided') {
      // pH: two-sided against [standardMin, standardMax], ideal V0 = 7.0
      const v0 = 7.0;
      const sBound = vi >= v0 ? p.standardMax : (p.standardMin ?? 6.5);
      qi = (Math.abs(vi - v0) / Math.abs(sBound - v0)) * 100;
      if (vi < (p.standardMin ?? 6.5) || vi > p.standardMax) status = 'exceeds_limit';
      else if (qi > 75) status = 'elevated';
    } else if (p.direction === 'higher_better') {
      // Dissolved Oxygen: ideal = DO_sat(T, S); lower DO means higher Qi
      idealDisplay = `${doSat} (@${tempC}°C, ${salPpt}ppt)`;
      if (vi >= doSat) {
        qi = 0;
      } else {
        qi = ((doSat - vi) / Math.max(0.5, doSat - p.standardMax)) * 100;
      }
      if (vi < p.standardMax) status = 'exceeds_limit';
      else if (qi > 75) status = 'elevated';
    } else {
      // Higher concentration = worse quality
      qi = Math.max(0, ((vi - p.ideal) / (p.standardMax - p.ideal)) * 100);
      if (vi > p.standardMax) status = 'exceeds_limit';
      else if (qi > 75) status = 'elevated';
    }

    const contrib = wi * qi;
    sumWiQi += contrib;
    sumWi += wi;

    if (status === 'exceeds_limit' || qi > 60) {
      drivers.push({
        label: p.label,
        contribution: contrib,
        detail: `${p.label} (${vi} ${p.unit}, Qi=${qi.toFixed(1)})`,
      });
    }

    breakdown.push({
      key: p.key,
      label: p.label,
      measuredValue: Number(vi.toFixed(3)),
      unit: p.unit,
      idealValue: idealDisplay,
      standardLimit:
        p.direction === 'two_sided'
          ? `${p.standardMin}–${p.standardMax}`
          : p.direction === 'higher_better'
            ? `≥ ${p.standardMax}`
            : `≤ ${p.standardMax}`,
      unitWeight: Number(wi.toFixed(4)),
      qualityRatingQi: Number(qi.toFixed(2)),
      weightedContribution: Number(contrib.toFixed(2)),
      status,
    });
  }

  const wqi = Number((sumWiQi / sumWi).toFixed(2));
  let classification = 'Excellent';
  let severityLevel: WqiCalculationResult['severityLevel'] = 'good';
  if (wqi > 100) {
    classification = 'Unsuitable for Intended Use';
    severityLevel = 'severe';
  } else if (wqi > 75) {
    classification = 'Very Poor';
    severityLevel = 'severe';
  } else if (wqi > 50) {
    classification = 'Poor';
    severityLevel = 'poor';
  } else if (wqi > 25) {
    classification = 'Good';
    severityLevel = 'moderate';
  }

  drivers.sort((a, b) => b.contribution - a.contribution);
  const recommendations: string[] = [];
  if (microbiologicalAlert) {
    recommendations.push('Prioritize disinfection/chlorination or boiling and investigate sewage cross-contamination immediately.');
  }
  if (drivers.length > 0) {
    recommendations.push(`Target primary deterioration drivers: ${drivers.slice(0, 3).map((d) => d.detail).join('; ')}.`);
  }
  if (isProvisional) {
    recommendations.push(`Upload missing essential parameters to raise completeness from ${completenessPct}% to 100% for a definitive WQI.`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Maintain routine monitoring and watershed protection buffers to keep parameters within permissible limits.');
  }

  return {
    wqi,
    classification,
    severityLevel,
    noteDirection: 'Lower WQI = Better water quality (Weighted Arithmetic WQI)',
    classificationNote: 'WAWQI bands (0–25 Excellent, 26–50 Good, 51–75 Poor, 76–100 Very Poor, >100 Unsuitable) are methodology-specific, not universal regulatory grades.',
    waterUse: options.waterUse,
    standardName: profile.standardName,
    standardVersion: profile.standardVersion,
    methodology: 'Weighted Arithmetic Water Quality Index (WAWQI)',
    completenessPct,
    weightCoveragePct,
    isProvisional,
    microbiologicalAlert,
    microbiologicalMessage,
    deteriorationDrivers: drivers.map((d) => d.detail),
    recommendations,
    breakdown,
    calculatedAt: new Date().toISOString(),
    dataOrigin: options.dataOrigin ?? 'uploaded',
  };
}
