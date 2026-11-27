import { DataOriginType, WmiCalculationResult, WmiComponentBreakdown, WmiInput, WmiWeights } from '../types';

export const DEFAULT_WMI_WEIGHTS: WmiWeights = {
  collection: 0.20,
  segregation: 0.15,
  recycling: 0.25,
  treatment: 0.15,
  safeDisposal: 0.15,
  unmanagedControl: 0.10,
};

export function calculateEcoWmi(
  input: WmiInput,
  weights: WmiWeights = DEFAULT_WMI_WEIGHTS,
  methodologyVersion = 'EcoWMI-v1.0',
  dataOrigin: DataOriginType = 'uploaded'
): WmiCalculationResult {
  const warnings: string[] = [];

  if (input.totalGenerated === null || !Number.isFinite(input.totalGenerated) || input.totalGenerated <= 0) {
    return {
      wmi: null,
      classification: 'Data Unavailable',
      severityLevel: 'unavailable',
      noteDirection: 'Higher WMI = Better waste management performance (0–100)',
      methodologyNote: 'EcoIntelligence proposed composite Waste Management Index (not an official universal international standard).',
      methodologyVersion,
      completenessPct: 0,
      isProvisional: true,
      massBalanceAccountedSum: null,
      massBalanceDiscrepancyPct: null,
      validationWarnings: ['Total waste generated must be greater than zero to compute WMI.'],
      weakestComponent: null,
      perCapitaKgPerDay: null,
      components: [],
      recommendations: ['Provide verified waste generation and destination flow figures (collected, segregated, recycled, treated, disposed, unmanaged).'],
      calculatedAt: new Date().toISOString(),
      dataOrigin,
    };
  }

  const G = input.totalGenerated;

  if (input.collected !== null && input.collected > G) {
    warnings.push(
      input.importExplanation
        ? `Collected waste (${input.collected}) exceeds generated (${G}); documented note: ${input.importExplanation}`
        : `Validation flag: Collected waste (${input.collected}) exceeds total generated waste (${G}) without documented waste imports.`
    );
  }
  if (input.segregated !== null && input.collected !== null && input.segregated > input.collected) {
    warnings.push(`Validation flag: Segregated waste (${input.segregated}) cannot logically exceed collected waste (${input.collected}).`);
  }

  // Mutually exclusive final destinations mass balance check
  const destValues = [input.recycledOrRecovered, input.treatedNonRecycling, input.safelyDisposed, input.unmanaged];
  const allDestPresent = destValues.every((v) => v !== null && Number.isFinite(v));
  let massBalanceAccountedSum: number | null = null;
  let massBalanceDiscrepancyPct: number | null = null;

  if (allDestPresent) {
    massBalanceAccountedSum = Number(
      ((input.recycledOrRecovered ?? 0) + (input.treatedNonRecycling ?? 0) + (input.safelyDisposed ?? 0) + (input.unmanaged ?? 0)).toFixed(2)
    );
    massBalanceDiscrepancyPct = Number((Math.abs(G - massBalanceAccountedSum) / G * 100).toFixed(2));
    if (massBalanceDiscrepancyPct > 5) {
      warnings.push(
        `Mass-balance discrepancy of ${massBalanceDiscrepancyPct}%: Sum of final destinations (${massBalanceAccountedSum}) differs from Total Generated (${G}). Ensure no double-counting.`
      );
    }
  }

  const clampScore = (val: number) => Number(Math.max(0, Math.min(100, val)).toFixed(2));

  const compConfigs: Array<{
    key: keyof WmiWeights;
    label: string;
    formula: string;
    compute: () => number | null;
  }> = [
    {
      key: 'collection',
      label: 'Collection Efficiency (C)',
      formula: '(Collected / Total Generated) × 100',
      compute: () => (input.collected !== null ? clampScore((input.collected / G) * 100) : null),
    },
    {
      key: 'segregation',
      label: 'Segregation Efficiency (S)',
      formula: '(Correctly Segregated / Waste Collected) × 100',
      compute: () =>
        input.segregated !== null && input.collected !== null && input.collected > 0
          ? clampScore((input.segregated / input.collected) * 100)
          : null,
    },
    {
      key: 'recycling',
      label: 'Recycling & Recovery Rate (R)',
      formula: '(Recycled or Recovered / Total Generated) × 100',
      compute: () => (input.recycledOrRecovered !== null ? clampScore((input.recycledOrRecovered / G) * 100) : null),
    },
    {
      key: 'treatment',
      label: 'Treatment Efficiency (T)',
      formula: '(Non-recycling Treated / Total Generated) × 100',
      compute: () => (input.treatedNonRecycling !== null ? clampScore((input.treatedNonRecycling / G) * 100) : null),
    },
    {
      key: 'safeDisposal',
      label: 'Safe Disposal Rate (D)',
      formula: '(Residual Safely Disposed / Total Generated) × 100',
      compute: () => (input.safelyDisposed !== null ? clampScore((input.safelyDisposed / G) * 100) : null),
    },
    {
      key: 'unmanagedControl',
      label: 'Unmanaged Waste Control (U)',
      formula: '100 − (Unmanaged / Total Generated × 100)',
      compute: () => (input.unmanaged !== null ? clampScore(100 - (input.unmanaged / G) * 100) : null),
    },
  ];

  const components: WmiComponentBreakdown[] = [];
  let availableWeightSum = 0;
  let weightedScoreSum = 0;
  let availableCount = 0;

  for (const cfg of compConfigs) {
    const score = cfg.compute();
    const w = weights[cfg.key];
    if (score !== null) {
      availableCount++;
      availableWeightSum += w;
      const contrib = Number((score * w).toFixed(2));
      weightedScoreSum += contrib;
      components.push({
        key: cfg.key,
        label: cfg.label,
        score,
        weight: w,
        weightedContribution: contrib,
        formula: cfg.formula,
      });
    } else {
      components.push({
        key: cfg.key,
        label: cfg.label,
        score: null,
        weight: w,
        weightedContribution: null,
        formula: cfg.formula,
      });
    }
  }

  const completenessPct = Math.round((availableCount / compConfigs.length) * 100);
  const isProvisional = availableCount < compConfigs.length;

  // Normalize by available weights so missing components are never treated as zero
  const wmi = availableWeightSum > 0 ? Number((weightedScoreSum / availableWeightSum).toFixed(2)) : null;

  let classification = 'Data Unavailable';
  let severityLevel: WmiCalculationResult['severityLevel'] = 'unavailable';
  if (wmi !== null) {
    if (wmi >= 80) {
      classification = 'Excellent';
      severityLevel = 'good';
    } else if (wmi >= 60) {
      classification = 'Good';
      severityLevel = 'good';
    } else if (wmi >= 40) {
      classification = 'Moderate';
      severityLevel = 'moderate';
    } else if (wmi >= 20) {
      classification = 'Poor';
      severityLevel = 'poor';
    } else {
      classification = 'Critical';
      severityLevel = 'severe';
    }
  }

  const scoredComponents = components.filter((c) => c.score !== null) as Array<WmiComponentBreakdown & { score: number }>;
  scoredComponents.sort((a, b) => a.score - b.score);
  const weakest = scoredComponents[0] ?? null;

  const recommendations: string[] = [];
  if (weakest) {
    if (weakest.key === 'segregation') {
      recommendations.push(`Segregation Efficiency is lowest (${weakest.score}%). Expand source-level wet/dry bin separation and door-to-door compliance audits.`);
    } else if (weakest.key === 'recycling') {
      recommendations.push(`Recycling & Recovery Rate is lowest (${weakest.score}%). Invest in Material Recovery Facilities (MRFs) and decentralized organic composting.`);
    } else if (weakest.key === 'collection') {
      recommendations.push(`Collection Efficiency is lowest (${weakest.score}%). Optimize ward-level collection route frequency and underserved peri-urban coverage.`);
    } else if (weakest.key === 'treatment') {
      recommendations.push(`Treatment Efficiency is lowest (${weakest.score}%). Scale anaerobic digestion, RDF processing, or bio-methanation for non-recyclable streams.`);
    } else if (weakest.key === 'safeDisposal') {
      recommendations.push(`Safe Disposal Rate is lowest (${weakest.score}%). Transition open dumps to engineered sanitary landfills with leachate containment.`);
    } else if (weakest.key === 'unmanagedControl') {
      recommendations.push(`Unmanaged Waste Control needs urgent focus (${weakest.score}%). Eliminate illegal dumping hotspots and tighten commercial waste tracking.`);
    }
  }
  if (isProvisional) {
    recommendations.push(`Provisional score (${completenessPct}% component coverage). Supply missing waste stream metrics for a complete WMI audit.`);
  }

  let perCapitaKgPerDay: number | null = null;
  if (input.population && input.population > 0) {
    const divisorDays = input.unit === 'tonnes/day' ? 1 : input.unit === 'tonnes/month' ? 30 : 365;
    perCapitaKgPerDay = Number(((G * 1000) / divisorDays / input.population).toFixed(3));
  }

  return {
    wmi,
    classification,
    severityLevel,
    noteDirection: 'Higher WMI = Better waste management performance (0–100)',
    methodologyNote: 'EcoIntelligence proposed composite Waste Management Index (not an official universal international standard).',
    methodologyVersion,
    completenessPct,
    isProvisional,
    massBalanceAccountedSum,
    massBalanceDiscrepancyPct,
    validationWarnings: warnings,
    weakestComponent: weakest ? `${weakest.label}: ${weakest.score}%` : null,
    perCapitaKgPerDay,
    components,
    recommendations,
    calculatedAt: new Date().toISOString(),
    dataOrigin,
  };
}
