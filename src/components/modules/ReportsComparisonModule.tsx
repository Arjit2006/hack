import React, { useCallback, useEffect, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileBarChart2,
  FileSpreadsheet,
  GitCompare,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { auth, db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { downloadBlob, escapeCsvField, safeDefault, safeFilename, safeText } from '../../lib/exportUtils';
import { AqiResult, GeoLocation, OverviewPayload } from '../../types/env';
import { LeafletMap } from '../LeafletMap';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../ToastProvider';

interface ReportsComparisonModuleProps {
  mode: 'reports' | 'compare';
  primaryLocation: GeoLocation;
  overview: OverviewPayload | null;
  overviewLoading?: boolean;
  overviewError?: string | null;
  onRetryOverview?: () => void;
}

interface CompareEntry {
  location: GeoLocation;
  aqi: AqiResult;
  weather: { temperatureC: number | null; humidityPct: number | null; windSpeedKmh: number | null; weatherLabel: string };
  energy: { latestRenewablePct: number | null; latestRenewableYear: number | null };
}

interface ReportCategories {
  air: boolean;
  weather: boolean;
  water: boolean;
  waste: boolean;
  energy: boolean;
  anomalies: boolean;
}

interface StoredEnvironmentalReport {
  id: string;
  generatedAt: string;
  reportingPeriod: string;
  includeCategories: ReportCategories;
  location: GeoLocation;
  executiveSummary: string;
  kpis: {
    aqiValue: number | null;
    aqiCategory: string;
    aqiStandard: string;
    aqiSeverity: AqiResult['severityLevel'];
    dominantPollutant: string | null;
    wqiValue: number | null;
    wqiCategory: string;
    waterIsSample: boolean;
    wmiValue: number | null;
    wmiCategory: string;
    wasteIsSample: boolean;
    renewablePct: number | null;
    renewableYear: number | null;
    temperatureC: number | null;
    weatherLabel: string;
  };
  pollutants: Array<{ parameter: string; value: number | null; unit: string; subIndex: number | null }>;
  chartSeries: Array<{ time: string; pm25: number | null; pm10: number | null }>;
  anomalies: Array<{ id: string; parameter: string; observedValue: number; baselineValue: number; unit: string; severity: string; reason: string; timestamp: string }>;
  weatherWarnings: Array<{ title: string; severity: string; detail: string }>;
  recommendations: string[];
  sources: Array<{ name: string; status: string; isSampleData?: boolean; fallbackProvider?: string; fallbackDescription?: string }>;
  airHourlyRaw: OverviewPayload['airHourly'];
}

const REPORT_STORAGE_KEY = 'ecointel_last_report_v1';

function loadSavedReport(): StoredEnvironmentalReport | null {
  try {
    const raw = localStorage.getItem(REPORT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredEnvironmentalReport;
  } catch {
    return null;
  }
}

function saveReportToStorage(report: StoredEnvironmentalReport | null) {
  try {
    if (!report) {
      localStorage.removeItem(REPORT_STORAGE_KEY);
    } else {
      localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(report));
    }
  } catch {
    // Ignore storage quota errors cleanly
  }
}

function buildReportSnapshot(
  overview: OverviewPayload,
  reportingPeriod: string,
  includeCategories: ReportCategories
): StoredEnvironmentalReport {
  const pm25Arr = (overview.airHourly || []).filter((h) => h?.pm25 !== null && h?.pm25 !== undefined).map((h) => h.pm25 as number);
  const avgPm25 = pm25Arr.length ? Number((pm25Arr.reduce((s, v) => s + v, 0) / pm25Arr.length).toFixed(1)) : null;

  const locName = safeDefault(overview.location?.name, 'Delhi, India');
  const cityName = safeDefault(overview.location?.city, safeText(overview.location?.name).split(',')[0].trim() || 'Delhi');

  const summaryParts = [
    `Environmental Assessment for ${locName} (${safeText(reportingPeriod)}).`,
    `Air Quality stands at ${overview.aqi?.aqi ?? 'Unavailable'} (${safeDefault(overview.aqi?.category, 'Assessed')}, ${safeDefault(overview.aqi?.standardName, 'AQI')}) with ${overview.aqi?.dominantPollutant || 'PM2.5'} as primary driver${avgPm25 !== null ? ` and an average PM2.5 of ${avgPm25} µg/m³` : ''}.`,
  ];
  if (overview.water?.wqi) {
    summaryParts.push(
      `Water Quality (WAWQI) records ${overview.water.wqi.wqi ?? '—'} (${safeDefault(overview.water.wqi.classification, 'Assessed')}${overview.water.isSampleData ? ', Sample data' : ''}).`
    );
  }
  if (overview.waste?.wmi) {
    summaryParts.push(
      `Waste Management (EcoWMI) scores ${overview.waste.wmi.wmi ?? '—'}/100 (${safeDefault(overview.waste.wmi.classification, 'Assessed')}${overview.waste.isSampleData ? ', Sample data' : ''}).`
    );
  }
  if (overview.energy?.worldBank?.latestRenewablePct !== null && overview.energy?.worldBank?.latestRenewablePct !== undefined) {
    summaryParts.push(
      `National renewable energy share is ${overview.energy.worldBank.latestRenewablePct}% (${overview.energy.worldBank.latestRenewableYear || 'latest World Bank data'}).`
    );
  }

  const recommendations = [
    overview.aqi?.healthGuidance,
    ...(overview.water?.wqi?.recommendations?.slice(0, 1) ?? []),
    ...(overview.waste?.wmi?.recommendations?.slice(0, 1) ?? []),
    'Upload local CSV/Excel datasets in the Water, Waste, or Energy modules to replace sample reference benchmarks with ward-level telemetry.',
  ].filter(Boolean) as string[];

  return {
    id: `rep-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    reportingPeriod: safeDefault(reportingPeriod, 'Last 7 Days'),
    includeCategories,
    location: {
      ...overview.location,
      name: locName,
      city: cityName,
      country: safeDefault(overview.location?.country, 'India'),
      countryCode: safeDefault(overview.location?.countryCode, 'IN'),
      latitude: Number(overview.location?.latitude ?? 28.65195),
      longitude: Number(overview.location?.longitude ?? 77.23149),
    },
    executiveSummary: summaryParts.join(' '),
    kpis: {
      aqiValue: overview.aqi?.aqi ?? null,
      aqiCategory: safeDefault(overview.aqi?.category, 'Unavailable'),
      aqiStandard: safeDefault(overview.aqi?.standardName, 'AQI'),
      aqiSeverity: overview.aqi?.severityLevel || 'unavailable',
      dominantPollutant: overview.aqi?.dominantPollutant ?? null,
      wqiValue: overview.water?.wqi?.wqi ?? null,
      wqiCategory: safeDefault(overview.water?.wqi?.classification, 'Unavailable'),
      waterIsSample: Boolean(overview.water?.isSampleData),
      wmiValue: overview.waste?.wmi?.wmi ?? null,
      wmiCategory: safeDefault(overview.waste?.wmi?.classification, 'Unavailable'),
      wasteIsSample: Boolean(overview.waste?.isSampleData),
      renewablePct: overview.energy?.worldBank?.latestRenewablePct ?? null,
      renewableYear: overview.energy?.worldBank?.latestRenewableYear ?? null,
      temperatureC: overview.weather?.current?.temperatureC ?? null,
      weatherLabel: safeDefault(overview.weather?.current?.weatherLabel, 'Unavailable'),
    },
    pollutants: (overview.aqi?.pollutants || []).map((p) => ({
      parameter: safeText(p.parameter),
      value: p.value,
      unit: safeDefault(p.unit, 'µg/m³'),
      subIndex: p.subIndex ?? null,
    })),
    chartSeries: (overview.airHourly || []).slice(-36).map((h) => ({
      time: safeText(h?.timestamp).slice(11, 16) || '—',
      pm25: h?.pm25 ?? null,
      pm10: h?.pm10 ?? null,
    })),
    anomalies: (overview.anomalies || []).map((a) => ({
      id: safeText(a.id),
      parameter: safeText(a.parameter),
      observedValue: Number(a.observedValue ?? 0),
      baselineValue: Number(a.baselineValue ?? 0),
      unit: safeDefault(a.unit, 'µg/m³'),
      severity: safeDefault(a.severity, 'moderate'),
      reason: safeDefault(a.reason, 'Statistical anomaly above baseline'),
      timestamp: safeDefault(a.timestamp, new Date().toISOString()),
    })),
    weatherWarnings: (overview.weather?.warnings || []).map((w) => ({
      title: safeText(w.title),
      severity: safeDefault(w.severity, 'moderate'),
      detail: safeDefault(w.detail, 'Advisory in effect'),
    })),
    recommendations,
    sources: (overview.dataSources || []).map((s) => ({
      name: safeText(s.name),
      status: safeDefault(s.status, 'Live'),
      isSampleData: Boolean(s.isSampleData),
      fallbackProvider: s.fallbackProvider ? safeText(s.fallbackProvider) : undefined,
      fallbackDescription: s.fallbackDescription ? safeText(s.fallbackDescription) : undefined,
    })),
    airHourlyRaw: overview.airHourly || [],
  };
}

export const ReportsComparisonModule: React.FC<ReportsComparisonModuleProps> = ({
  mode,
  primaryLocation,
  overview,
  overviewLoading,
  overviewError,
  onRetryOverview,
}) => {
  const { showToast } = useToast();

  // Multi-Location Comparison State
  const [compareList, setCompareList] = useState<GeoLocation[]>([
    primaryLocation,
    {
      id: 'loc-1275339',
      name: 'Mumbai, Maharashtra, India',
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      countryCode: 'IN',
      latitude: 19.07283,
      longitude: 72.88261,
    },
  ]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeoLocation[]>([]);
  const [pastDays, setPastDays] = useState(7);
  const [compareResults, setCompareResults] = useState<CompareEntry[]>([]);
  const [methodologyNote, setMethodologyNote] = useState<string | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // Inline Persistent Report State
  const [reportPeriod, setReportPeriod] = useState('Last 7 Days');
  const [includeCategories, setIncludeCategories] = useState<ReportCategories>({
    air: true,
    weather: true,
    water: true,
    waste: true,
    energy: true,
    anomalies: true,
  });
  const [activeReport, setActiveReport] = useState<StoredEnvironmentalReport | null>(() => loadSavedReport());
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<{ title: string; message: string } | null>(null);
  const [archiveMsg, setArchiveMsg] = useState<string | null>(null);

  const generateInlineReport = useCallback(
    (sourceOverview: OverviewPayload | null, showFeedback = false) => {
      if (!sourceOverview) {
        setReportError('Telemetry is currently unavailable for the selected location.');
        return;
      }
      setReportGenerating(true);
      setReportError(null);
      try {
        const nextReport = buildReportSnapshot(sourceOverview, reportPeriod, includeCategories);
        setActiveReport(nextReport);
        saveReportToStorage(nextReport);
        if (showFeedback) {
          showToast({
            type: 'success',
            title: 'Inline Report Generated',
            message: `Saved report for ${sourceOverview.location.name} (${reportPeriod}).`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to build inline report';
        setReportError(msg);
        showToast({ type: 'error', title: 'Report Error', message: msg });
      } finally {
        setReportGenerating(false);
      }
    },
    [includeCategories, reportPeriod, showToast]
  );

  // Auto-populate inline report if none persisted yet when overview loads
  useEffect(() => {
    if (mode !== 'reports') return;
    if (overview && !activeReport) {
      generateInlineReport(overview, false);
    }
  }, [mode, overview, activeReport, generateInlineReport]);

  const handleSearchLoc = async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await fetch(`/api/locations/search?q=${encodeURIComponent(searchQuery)}`);
      const json = (await res.json()) as { results?: GeoLocation[] };
      setSearchResults(json.results ?? []);
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Location Search Error',
        message: err instanceof Error ? err.message : 'Unable to search cities',
      });
    }
  };

  const runComparison = async () => {
    if (compareList.length < 2) return;
    setCompareLoading(true);
    try {
      const res = await fetch('/api/env/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: compareList.map((l) => ({
            name: l.name,
            countryCode: l.countryCode,
            latitude: l.latitude,
            longitude: l.longitude,
          })),
          pastDays,
        }),
      });
      const json = (await res.json()) as { comparisons?: CompareEntry[]; methodologyNote?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'Comparison request failed');
      setCompareResults(json.comparisons ?? []);
      setMethodologyNote(json.methodologyNote ?? null);
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Comparison Failed',
        message: err instanceof Error ? err.message : 'Unable to compare locations',
      });
    } finally {
      setCompareLoading(false);
    }
  };

  // Optional secondary PDF download (never auto-triggered)
  const handleDownloadPdf = async () => {
    if (!activeReport) return;
    setExportError(null);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 14;
      const contentWidth = pageWidth - margin * 2; // ~182mm

      const locationName = safeDefault(activeReport.location?.name, 'Unknown Location');
      const cityName = safeDefault(activeReport.location?.city, safeText(activeReport.location?.name).split(',')[0].trim() || 'Delhi');
      const lat = Number(activeReport.location?.latitude ?? 0);
      const lon = Number(activeReport.location?.longitude ?? 0);
      const period = safeDefault(activeReport.reportingPeriod, 'Last 7 Days');
      const generatedDate = activeReport.generatedAt ? new Date(activeReport.generatedAt).toLocaleString() : new Date().toLocaleString();

      const pdfFilename = `EcoIntelligence_Report_${safeFilename(cityName, 'Delhi')}.pdf`;

      // Helper to find source info
      const findSource = (category: string, fallbackName: string, isSample = false) => {
        const match = (activeReport.sources || []).find((s) =>
          safeText(s.name).toLowerCase().includes(category) || safeText(s.name).toLowerCase().includes(fallbackName.toLowerCase())
        );
        if (isSample) {
          return {
            name: safeDefault(match?.name, 'Sample Reference Dataset'),
            status: 'Sample data',
          };
        }
        return {
          name: safeDefault(match?.name, fallbackName),
          status: safeDefault(match?.status, 'Live'),
        };
      };

      const airSource = findSource('air', 'Open-Meteo Air Quality');
      const weatherSource = findSource('weather', 'Open-Meteo Weather');
      const waterSource = findSource('water', 'Uploaded Dataset', activeReport.kpis?.waterIsSample);
      const wasteSource = findSource('waste', 'Uploaded Dataset', activeReport.kpis?.wasteIsSample);
      const energySource = findSource('energy', 'World Bank Open Data');

      let y = 18;

      // Header Title
      doc.setFontSize(16);
      doc.setTextColor(20, 83, 45);
      doc.setFont('helvetica', 'bold');
      doc.text(safeText('EcoIntelligence Environmental Assessment Report'), margin, y);
      y += 7;

      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);

      const locText = safeText(`Location: ${locationName} (${lat.toFixed(3)}°, ${lon.toFixed(3)}°)`);
      const locLines = doc.splitTextToSize(locText, contentWidth);
      doc.text(locLines, margin, y);
      y += locLines.length * 4.5 + 1;

      const metaText = safeText(`Reporting Period: ${period} | Generated: ${generatedDate}`);
      const metaLines = doc.splitTextToSize(metaText, contentWidth);
      doc.text(metaLines, margin, y);
      y += metaLines.length * 4.5 + 4;

      // Executive Summary Section
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(safeText('Executive Summary & Telemetry Synthesis'), margin, y);
      y += 5;

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);

      const summaryText = safeDefault(activeReport.executiveSummary, 'No summary narrative available for this location and reporting window.');
      const summaryLines = doc.splitTextToSize(summaryText, contentWidth);
      doc.text(summaryLines, margin, y);
      y += summaryLines.length * 4.2 + 5;

      // Table 1: Key Environmental Indicators
      const rows: Array<[string, string, string, string, string]> = [];
      if (activeReport.includeCategories?.air) {
        rows.push([
          safeText(`Air Quality (${safeDefault(activeReport.kpis?.aqiStandard, 'AQI')})`),
          activeReport.kpis?.aqiValue !== null && activeReport.kpis?.aqiValue !== undefined ? safeText(activeReport.kpis.aqiValue) : 'Unavailable',
          safeDefault(activeReport.kpis?.aqiCategory, 'Not available'),
          airSource.name,
          airSource.status,
        ]);
        for (const p of activeReport.pollutants || []) {
          rows.push([
            safeText(`  ${p.parameter}`),
            p.value !== null && p.value !== undefined ? `${safeText(p.value)} ${safeDefault(p.unit, 'µg/m³')}` : 'Missing',
            safeText(`Sub-index: ${safeDefault(p.subIndex, 'N/A')}`),
            airSource.name,
            airSource.status,
          ]);
        }
      }

      if (activeReport.includeCategories?.weather) {
        rows.push([
          safeText('Short-Term Weather'),
          activeReport.kpis?.temperatureC !== null && activeReport.kpis?.temperatureC !== undefined ? `${safeText(activeReport.kpis.temperatureC)} °C` : '—',
          safeDefault(activeReport.kpis?.weatherLabel, 'Not available'),
          weatherSource.name,
          weatherSource.status,
        ]);
      }

      if (activeReport.includeCategories?.water) {
        rows.push([
          safeText('Water Quality (WAWQI)'),
          activeReport.kpis?.wqiValue !== null && activeReport.kpis?.wqiValue !== undefined ? safeText(activeReport.kpis.wqiValue) : 'Unavailable',
          safeText(`${safeDefault(activeReport.kpis?.wqiCategory, 'Not available')}${activeReport.kpis?.waterIsSample ? ' (Sample data)' : ''}`),
          waterSource.name,
          waterSource.status,
        ]);
      }

      if (activeReport.includeCategories?.waste) {
        rows.push([
          safeText('Waste Management (EcoWMI)'),
          activeReport.kpis?.wmiValue !== null && activeReport.kpis?.wmiValue !== undefined ? `${safeText(activeReport.kpis.wmiValue)}/100` : 'Unavailable',
          safeText(`${safeDefault(activeReport.kpis?.wmiCategory, 'Not available')}${activeReport.kpis?.wasteIsSample ? ' (Sample data)' : ''}`),
          wasteSource.name,
          wasteSource.status,
        ]);
      }

      if (activeReport.includeCategories?.energy) {
        rows.push([
          safeText('Renewable Energy Share'),
          activeReport.kpis?.renewablePct !== null && activeReport.kpis?.renewablePct !== undefined ? `${safeText(activeReport.kpis.renewablePct)}%` : 'Unavailable',
          safeText(`Year ${safeDefault(activeReport.kpis?.renewableYear, 'N/A')}`),
          energySource.name,
          energySource.status,
        ]);
      }

      if (rows.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Indicator / Category', 'Measured / Computed Value', 'Status / Classification', 'Data Source', 'Source Status']],
          body: rows,
          styles: { fontSize: 8, overflow: 'linebreak', cellPadding: 2 },
          columnStyles: {
            0: { cellWidth: 42 },
            1: { cellWidth: 38 },
            2: { cellWidth: 40 },
            3: { cellWidth: 40 },
            4: { cellWidth: 22 },
          },
          headStyles: { fillColor: [20, 83, 45], textColor: [255, 255, 255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: margin, right: margin },
        });

        y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 7;
      }

      // Table 2: Anomalies & Advisories if present
      if (activeReport.includeCategories?.anomalies) {
        const anomalyRows: Array<[string, string, string, string]> = [];
        for (const a of activeReport.anomalies || []) {
          anomalyRows.push([
            safeText(a.parameter),
            safeDefault(a.severity, 'Moderate'),
            `${safeText(a.observedValue ?? '—')} / ${safeText(a.baselineValue ?? '—')} ${safeDefault(a.unit, '')}`,
            safeDefault(a.reason, 'Statistical deviation from baseline threshold'),
          ]);
        }
        for (const w of activeReport.weatherWarnings || []) {
          anomalyRows.push([
            safeText(w.title),
            safeDefault(w.severity, 'Advisory'),
            '7-day forecast',
            safeDefault(w.detail, 'Meteorological warning advisory'),
          ]);
        }

        if (anomalyRows.length > 0) {
          if (y > pageHeight - margin - 35) {
            doc.addPage();
            y = margin;
          }

          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(15, 23, 42);
          doc.text(safeText('Detected Anomalies & Meteorological Advisories'), margin, y);
          y += 4;

          autoTable(doc, {
            startY: y,
            head: [['Indicator / Event', 'Severity', 'Observed vs Baseline', 'Analysis / Details']],
            body: anomalyRows,
            styles: { fontSize: 8, overflow: 'linebreak', cellPadding: 2 },
            columnStyles: {
              0: { cellWidth: 38 },
              1: { cellWidth: 26 },
              2: { cellWidth: 42 },
              3: { cellWidth: 76 },
            },
            headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [240, 253, 250] },
            margin: { left: margin, right: margin },
          });

          y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 7;
        }
      }

      // Recommendations Section
      const recs = activeReport.recommendations || [];
      if (recs.length > 0) {
        if (y > pageHeight - margin - 30) {
          doc.addPage();
          y = margin;
        }

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(safeText('Actionable Recommendations'), margin, y);
        y += 5;

        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);

        for (const rec of recs) {
          if (y > pageHeight - margin - 12) {
            doc.addPage();
            y = margin;
          }
          const recLines = doc.splitTextToSize(`•  ${safeText(rec)}`, contentWidth - 4);
          doc.text(recLines, margin + 2, y);
          y += recLines.length * 4.2 + 1.5;
        }
        y += 4;
      }

      // Data Provenance Footer
      const sourcesList = activeReport.sources || [];
      if (sourcesList.length > 0) {
        if (y > pageHeight - margin - 20) {
          doc.addPage();
          y = margin;
        }
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 116, 139);
        const provText = safeText(
          'Data Provenance: ' +
            sourcesList
              .map((s) => `${safeText(s.name)}: ${safeDefault(s.status, 'Live')}${s.isSampleData ? ' (Sample data)' : ''}`)
              .join('  |  ')
        );
        const provLines = doc.splitTextToSize(provText, contentWidth);
        doc.text(provLines, margin, y);
      }

      doc.save(pdfFilename);
      showToast({ type: 'success', title: 'PDF Downloaded', message: `Saved formatted report as ${pdfFilename}` });

      if (auth.currentUser?.emailVerified) {
        try {
          await addDoc(collection(db, 'reports'), {
            userId: auth.currentUser.uid,
            title: `Environmental Assessment — ${cityName}`,
            locationName,
            reportingPeriod: period,
            summary: `AQI: ${activeReport.kpis?.aqiValue ?? 'N/A'} (${safeDefault(activeReport.kpis?.aqiCategory, 'Not available')}); Renewable Energy: ${activeReport.kpis?.renewablePct ?? 'N/A'}%`,
            createdAt: new Date().toISOString(),
          });
          setArchiveMsg('Report saved to your Firestore archive and exported as PDF.');
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, 'reports');
        }
      }
    } catch (err) {
      console.error('PDF Export Error:', err);
      const msg = err instanceof Error ? err.message : 'Unable to export PDF';
      setExportError({ title: 'PDF Export Error', message: msg });
      showToast({
        type: 'error',
        title: 'PDF Export Error',
        message: msg,
      });
    }
  };

  // Optional secondary CSV download (never auto-triggered)
  const handleDownloadCsv = () => {
    if (!activeReport) return;
    setExportError(null);
    try {
      const locationName = safeDefault(activeReport.location?.name, 'Unknown Location');
      const cityName = safeDefault(activeReport.location?.city, safeText(activeReport.location?.name).split(',')[0].trim() || 'Delhi');
      const period = safeDefault(activeReport.reportingPeriod, 'Last 7 Days');
      const csvFilename = `EcoIntelligence_Data_${safeFilename(cityName, 'Delhi')}.csv`;

      // Helper to find source info
      const findSource = (category: string, fallbackName: string, isSample = false) => {
        const match = (activeReport.sources || []).find((s) =>
          safeText(s.name).toLowerCase().includes(category) || safeText(s.name).toLowerCase().includes(fallbackName.toLowerCase())
        );
        if (isSample) {
          return {
            name: safeDefault(match?.name, 'Sample Reference Dataset'),
            status: 'Sample data',
          };
        }
        return {
          name: safeDefault(match?.name, fallbackName),
          status: safeDefault(match?.status, 'Live'),
        };
      };

      const airSource = findSource('air', 'Open-Meteo Air Quality');
      const weatherSource = findSource('weather', 'Open-Meteo Weather');
      const waterSource = findSource('water', 'Uploaded Dataset', activeReport.kpis?.waterIsSample);
      const wasteSource = findSource('waste', 'Uploaded Dataset', activeReport.kpis?.wasteIsSample);
      const energySource = findSource('energy', 'World Bank Open Data');

      const headers = [
        'Section',
        'Metric / Indicator',
        'Measured / Reported Value',
        'Unit',
        'Status / Classification',
        'Data Source',
        'Source Status',
        'Reporting Period',
        'Location',
        'Details / Notes',
      ];

      const csvRows: string[][] = [];

      // Summary row
      csvRows.push([
        safeText('Executive Summary'),
        safeText('AI & Telemetry Assessment'),
        safeDefault(activeReport.executiveSummary, 'Not available'),
        safeText('Text'),
        safeText('Summary'),
        safeText('EcoAI / Verified Telemetry Engine'),
        safeText('Live'),
        period,
        locationName,
        safeText(activeReport.reportingPeriod),
      ]);

      // Air Quality KPI
      if (activeReport.includeCategories?.air) {
        csvRows.push([
          safeText('Air Quality'),
          safeText(activeReport.kpis?.aqiStandard ? `${activeReport.kpis.aqiStandard} AQI` : 'Air Quality Index'),
          activeReport.kpis?.aqiValue !== null && activeReport.kpis?.aqiValue !== undefined ? safeText(activeReport.kpis.aqiValue) : 'N/A',
          safeText('AQI Index'),
          safeDefault(activeReport.kpis?.aqiCategory, 'Not available'),
          airSource.name,
          airSource.status,
          period,
          locationName,
          safeText(activeReport.kpis?.dominantPollutant ? `Dominant Pollutant: ${activeReport.kpis.dominantPollutant}` : 'Not available'),
        ]);

        for (const p of activeReport.pollutants || []) {
          csvRows.push([
            safeText('Air Quality Pollutants'),
            safeText(p.parameter),
            p.value !== null && p.value !== undefined ? safeText(p.value) : 'N/A',
            safeDefault(p.unit, 'µg/m³'),
            safeText(p.subIndex !== null && p.subIndex !== undefined ? `Sub-index: ${p.subIndex}` : 'Not available'),
            airSource.name,
            airSource.status,
            period,
            locationName,
            safeText(activeReport.kpis?.aqiStandard || 'Standard framework'),
          ]);
        }
      }

      // Weather KPI
      if (activeReport.includeCategories?.weather) {
        csvRows.push([
          safeText('Weather'),
          safeText('Ambient Temperature'),
          activeReport.kpis?.temperatureC !== null && activeReport.kpis?.temperatureC !== undefined ? safeText(activeReport.kpis.temperatureC) : 'N/A',
          safeText('°C'),
          safeDefault(activeReport.kpis?.weatherLabel, 'Not available'),
          weatherSource.name,
          weatherSource.status,
          period,
          locationName,
          safeDefault(activeReport.kpis?.weatherLabel, 'Current meteorological conditions'),
        ]);
      }

      // Water KPI
      if (activeReport.includeCategories?.water) {
        csvRows.push([
          safeText('Water Quality'),
          safeText('WAWQI Water Quality Index'),
          activeReport.kpis?.wqiValue !== null && activeReport.kpis?.wqiValue !== undefined ? safeText(activeReport.kpis.wqiValue) : 'N/A',
          safeText('Score (0-100)'),
          safeDefault(activeReport.kpis?.wqiCategory, 'Not available'),
          waterSource.name,
          waterSource.status,
          period,
          locationName,
          safeText(activeReport.kpis?.waterIsSample ? 'Sample reference baseline' : 'Uploaded observation dataset'),
        ]);
      }

      // Waste KPI
      if (activeReport.includeCategories?.waste) {
        csvRows.push([
          safeText('Waste Management'),
          safeText('EcoWMI Waste Management Index'),
          activeReport.kpis?.wmiValue !== null && activeReport.kpis?.wmiValue !== undefined ? `${safeText(activeReport.kpis.wmiValue)}/100` : 'N/A',
          safeText('Score (0-100)'),
          safeDefault(activeReport.kpis?.wmiCategory, 'Not available'),
          wasteSource.name,
          wasteSource.status,
          period,
          locationName,
          safeText(activeReport.kpis?.wasteIsSample ? 'Sample reference baseline' : 'Uploaded municipal dataset'),
        ]);
      }

      // Energy KPI
      if (activeReport.includeCategories?.energy) {
        csvRows.push([
          safeText('Renewable Energy'),
          safeText('Renewable Energy Share'),
          activeReport.kpis?.renewablePct !== null && activeReport.kpis?.renewablePct !== undefined ? `${safeText(activeReport.kpis.renewablePct)}%` : 'N/A',
          safeText('%'),
          safeText(activeReport.kpis?.renewableYear ? `Year ${activeReport.kpis.renewableYear}` : 'Not available'),
          energySource.name,
          energySource.status,
          period,
          locationName,
          safeText('National electricity grid indicators'),
        ]);
      }

      // Anomalies
      if (activeReport.includeCategories?.anomalies) {
        for (const a of activeReport.anomalies || []) {
          csvRows.push([
            safeText('Detected Anomalies'),
            safeText(a.parameter),
            safeText(a.observedValue ?? 'N/A'),
            safeDefault(a.unit, 'N/A'),
            safeDefault(a.severity, 'Not available'),
            airSource.name,
            airSource.status,
            safeDefault(a.timestamp, period),
            locationName,
            safeDefault(a.reason, 'Statistical anomaly above baseline'),
          ]);
        }

        for (const w of activeReport.weatherWarnings || []) {
          csvRows.push([
            safeText('Weather Advisories'),
            safeText(w.title),
            safeText('Active Advisory'),
            safeText('Warning'),
            safeDefault(w.severity, 'Not available'),
            weatherSource.name,
            weatherSource.status,
            period,
            locationName,
            safeDefault(w.detail, '7-day forecast advisory'),
          ]);
        }
      }

      // Recommendations
      (activeReport.recommendations || []).forEach((rec, idx) => {
        csvRows.push([
          safeText('Recommendations'),
          safeText(`Guidance Action ${idx + 1}`),
          safeText('Recommended'),
          safeText('Guidance'),
          safeText('Actionable'),
          safeText('EcoIntelligence Engine'),
          safeText('Live'),
          period,
          locationName,
          safeText(rec),
        ]);
      });

      // Hourly raw telemetry if present
      for (const h of activeReport.airHourlyRaw || []) {
        csvRows.push([
          safeText('Hourly Telemetry'),
          safeText('Station / Grid Node PM2.5 & PM10'),
          safeText(`PM2.5: ${h?.pm25 ?? 'N/A'}, PM10: ${h?.pm10 ?? 'N/A'}`),
          safeText('µg/m³'),
          safeDefault(h?.timestamp, 'N/A'),
          airSource.name,
          airSource.status,
          safeDefault(h?.timestamp, period),
          locationName,
          safeText(`CO: ${h?.co ?? 'N/A'}, NO2: ${h?.no2 ?? 'N/A'}, SO2: ${h?.so2 ?? 'N/A'}, O3: ${h?.o3 ?? 'N/A'}`),
        ]);
      }

      // Format RFC 4180 CSV
      const csvString = [
        headers.map(escapeCsvField).join(','),
        ...csvRows.map((r) => r.map(escapeCsvField).join(',')),
      ].join('\r\n');

      downloadBlob(new Blob([csvString], { type: 'text/csv;charset=utf-8;' }), csvFilename);
      showToast({ type: 'success', title: 'CSV Downloaded', message: `Exported environmental assessment as ${csvFilename}` });
    } catch (err) {
      console.error('CSV Export Error:', err);
      const msg = err instanceof Error ? err.message : 'Unable to export CSV';
      setExportError({ title: 'CSV Export Error', message: msg });
      showToast({
        type: 'error',
        title: 'CSV Export Error',
        message: msg,
      });
    }
  };

  if (mode === 'compare') {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <GitCompare className="w-5 h-5 text-[#14532D] shrink-0" aria-hidden="true" />
                <span>Multi-Location Environmental Comparison</span>
              </h2>
              <p className="text-xs text-slate-600">Compare up to 4 cities or regions side by side across air quality, weather, and renewable share.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={pastDays}
                onChange={(e) => setPastDays(Number(e.target.value))}
                className="min-h-[44px] px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value={1}>Last 24 Hours</option>
                <option value={7}>Last 7 Days</option>
                <option value={30}>Last 30 Days</option>
              </select>
              <button
                type="button"
                onClick={() => void runComparison()}
                disabled={compareLoading || compareList.length < 2}
                className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] disabled:opacity-50"
              >
                {compareLoading ? 'Comparing...' : 'Run Comparison'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {compareList.map((loc) => (
              <div key={loc.name} className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-100 border border-slate-200 rounded-lg">
                <span className="font-medium text-slate-800">{loc.name}</span>
                {compareList.length > 2 && (
                  <button
                    type="button"
                    aria-label={`Remove ${loc.name}`}
                    onClick={() => setCompareList((prev) => prev.filter((x) => x.name !== loc.name))}
                    className="p-1 text-slate-500 hover:text-red-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {compareList.length < 4 && (
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Add city to compare (e.g. London, Tokyo, Rewari)..."
                className="w-full sm:flex-1 min-w-0 min-h-[44px] px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
              <button
                type="button"
                onClick={() => void handleSearchLoc()}
                className="min-h-[44px] inline-flex items-center justify-center gap-1 px-4 py-2 text-xs font-medium bg-slate-800 text-white rounded-lg whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Find Location
              </button>
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {searchResults.slice(0, 4).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    if (compareList.length < 4 && !compareList.some((c) => c.name === r.name)) {
                      setCompareList((prev) => [...prev, r]);
                    }
                    setSearchResults([]);
                    setSearchQuery('');
                  }}
                  className="text-left p-3 min-h-[44px] text-xs border border-slate-200 rounded-lg hover:bg-emerald-50"
                >
                  + Add <strong>{r.name}</strong> ({r.countryCode})
                </button>
              ))}
            </div>
          )}
        </div>

        {compareResults.length > 0 && (
          <>
            {methodologyNote && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                <strong>Comparison Methodology Notice:</strong> {methodologyNote}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-3 min-w-0">
                <h3 className="text-sm font-bold text-slate-900">PM2.5 &amp; PM10 Comparison (µg/m³)</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={compareResults.map((c) => ({
                        city: safeDefault(c.location?.city, safeText(c.location?.name).split(',')[0].trim() || 'City'),
                        pm25: c.aqi.pollutants.find((p) => p.parameter === 'PM2.5')?.value ?? 0,
                        pm10: c.aqi.pollutants.find((p) => p.parameter === 'PM10')?.value ?? 0,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="city" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="pm25" name="PM2.5 (µg/m³)" fill="#14532D" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="pm10" name="PM10 (µg/m³)" fill="#0F766E" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-3 min-w-0">
                <h3 className="text-sm font-bold text-slate-900">Geographical Comparison Map</h3>
                <LeafletMap
                  center={[compareResults[0].location.latitude, compareResults[0].location.longitude]}
                  zoom={4}
                  heightClass="h-64"
                  markers={compareResults.map((c) => ({
                    name: c.location.name,
                    latitude: c.location.latitude,
                    longitude: c.location.longitude,
                    subtitle: `${c.aqi.standardCode}: ${c.aqi.aqi ?? 'N/A'} (${c.aqi.category})`,
                  }))}
                />
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-3 px-4">Location</th>
                      <th className="py-3 px-4">AQI Framework</th>
                      <th className="py-3 px-4">AQI / Status</th>
                      <th className="py-3 px-4 text-right">PM2.5 (µg/m³)</th>
                      <th className="py-3 px-4 text-right">Temp (°C)</th>
                      <th className="py-3 px-4 text-right">Renewables (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {compareResults.map((c) => (
                      <tr key={c.location.name}>
                        <td className="py-3 px-4 font-semibold text-slate-900">{c.location.name}</td>
                        <td className="py-3 px-4 text-slate-600">{c.aqi.standardName}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono-tabular font-bold">{c.aqi.aqi ?? '—'}</span>
                            <StatusBadge level={c.aqi.severityLevel} label={c.aqi.category} />
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular">
                          {c.aqi.pollutants.find((p) => p.parameter === 'PM2.5')?.value ?? '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular">{c.weather.temperatureC ?? '—'}</td>
                        <td className="py-3 px-4 text-right font-mono-tabular">
                          {c.energy.latestRenewablePct !== null ? `${c.energy.latestRenewablePct}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // INLINE REPORT DASHBOARD PANEL (never auto-downloads)
  return (
    <div className="space-y-6">
      {exportError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-900 flex items-start justify-between gap-3 text-xs"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <div className="font-semibold">{exportError.title}</div>
              <p className="text-red-800 mt-0.5 break-words">{exportError.message}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss export error"
            onClick={() => setExportError(null)}
            className="min-w-[36px] min-h-[36px] -mr-1 -mt-1 flex items-center justify-center text-red-500 hover:text-red-800 rounded-lg shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Report Configuration & Optional Secondary Export Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <FileBarChart2 className="w-5 h-5 text-[#14532D] shrink-0" aria-hidden="true" />
              <span>Environmental Assessment Report</span>
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Generated inline for <strong>{primaryLocation.name}</strong> and saved in browser storage across tab switches and refreshes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => generateInlineReport(overview, true)}
              disabled={!overview || reportGenerating}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${reportGenerating ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{activeReport ? 'Update Inline Report' : 'Generate Inline Report'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={!activeReport}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="w-4 h-4 text-[#14532D]" aria-hidden="true" />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={!activeReport}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4 text-[#0F766E]" aria-hidden="true" />
              <span>Download CSV</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
          <div>
            <label htmlFor="report-period" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Reporting Period
            </label>
            <select
              id="report-period"
              value={reportPeriod}
              onChange={(e) => setReportPeriod(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="Last 24 Hours">Hourly / Last 24 Hours</option>
              <option value="Last 7 Days">Day-wise / Last 7 Days</option>
              <option value="Monthly Summary">Monthly Summary</option>
              <option value="Annual Benchmark">Yearly / Annual Benchmark</option>
            </select>
          </div>
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1.5">Include Report Sections</span>
            <div className="flex flex-wrap gap-3 text-xs text-slate-700 pt-1">
              {Object.entries(includeCategories).map(([key, checked]) => (
                <label key={key} className="inline-flex items-center gap-2 min-h-[36px] capitalize cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setIncludeCategories({ ...includeCategories, [key]: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-[#14532D]"
                  />
                  <span>{key}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {archiveMsg && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900">{archiveMsg}</div>}
      </div>

      {/* Loading Skeleton State */}
      {(overviewLoading && !activeReport) || reportGenerating ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6 animate-pulse">
          <div className="h-6 bg-slate-100 rounded w-1/3" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-slate-100 rounded-lg" />
            ))}
          </div>
          <div className="h-64 bg-slate-100 rounded-lg" />
        </div>
      ) : (overviewError && !activeReport) || reportError ? (
        /* Error State with Retry Button */
        <div className="bg-white border border-red-200 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            <span>Failed to load environmental report</span>
          </div>
          <p className="text-xs text-slate-600">{reportError || overviewError}</p>
          <button
            type="button"
            onClick={() => {
              if (overview) {
                generateInlineReport(overview, true);
              } else if (onRetryOverview) {
                onRetryOverview();
              }
            }}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534]"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      ) : !activeReport ? (
        /* Empty State */
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <FileBarChart2 className="w-9 h-9 text-slate-300 mx-auto" aria-hidden="true" />
          <h3 className="text-base font-bold text-slate-900">No Report Generated Yet</h3>
          <p className="text-xs text-slate-600 max-w-md mx-auto">
            Select the categories above and generate an inline assessment report for {primaryLocation.name}.
          </p>
          <button
            type="button"
            disabled={!overview}
            onClick={() => generateInlineReport(overview, true)}
            className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] disabled:opacity-50"
          >
            Generate Report Now
          </button>
        </div>
      ) : (
        /* Rendered Inline Report Document */
        <article className="bg-white border border-slate-200 rounded-xl p-5 sm:p-7 space-y-6">
          {/* Document Header */}
          <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-slate-500">
                {activeReport.reportingPeriod} · {activeReport.location.latitude.toFixed(3)}°, {activeReport.location.longitude.toFixed(3)}°
              </div>
              <h3 className="text-xl font-bold text-slate-900 mt-0.5">
                {activeReport.location.name} — Environmental Report
              </h3>
            </div>
            <div className="text-xs text-slate-500 font-mono-tabular">
              Generated {new Date(activeReport.generatedAt).toLocaleString()}
            </div>
          </div>

          <p className="text-sm text-slate-700 leading-relaxed">{activeReport.executiveSummary}</p>

          {/* Report KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {activeReport.includeCategories.air && (
              <div className="p-4 border border-slate-200 rounded-lg space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>Air Quality (AQI)</span>
                  <StatusBadge level={activeReport.kpis.aqiSeverity} label={activeReport.kpis.aqiCategory} />
                </div>
                <div className="text-2xl font-bold font-mono-tabular text-slate-900">
                  {activeReport.kpis.aqiValue ?? '—'}
                </div>
                <div className="text-[11px] text-slate-500">
                  Driver: {activeReport.kpis.dominantPollutant || 'N/A'} · {activeReport.kpis.aqiStandard}
                </div>
              </div>
            )}

            {activeReport.includeCategories.water && (
              <div className="p-4 border border-slate-200 rounded-lg space-y-1.5">
                <div className="text-xs text-slate-500 flex items-center justify-between">
                  <span>Water Quality (WAWQI)</span>
                  {activeReport.kpis.waterIsSample && <span className="text-amber-800 font-semibold">Sample data</span>}
                </div>
                <div className="text-2xl font-bold font-mono-tabular text-slate-900">
                  {activeReport.kpis.wqiValue ?? '—'}
                </div>
                <div className="text-[11px] text-slate-500">{activeReport.kpis.wqiCategory}</div>
              </div>
            )}

            {activeReport.includeCategories.waste && (
              <div className="p-4 border border-slate-200 rounded-lg space-y-1.5">
                <div className="text-xs text-slate-500 flex items-center justify-between">
                  <span>Waste Index (EcoWMI)</span>
                  {activeReport.kpis.wasteIsSample && <span className="text-amber-800 font-semibold">Sample data</span>}
                </div>
                <div className="text-2xl font-bold font-mono-tabular text-slate-900">
                  {activeReport.kpis.wmiValue !== null ? `${activeReport.kpis.wmiValue}/100` : '—'}
                </div>
                <div className="text-[11px] text-slate-500">{activeReport.kpis.wmiCategory}</div>
              </div>
            )}

            {activeReport.includeCategories.energy && (
              <div className="p-4 border border-slate-200 rounded-lg space-y-1.5">
                <div className="text-xs text-slate-500">Renewable Share</div>
                <div className="text-2xl font-bold font-mono-tabular text-slate-900">
                  {activeReport.kpis.renewablePct !== null ? `${activeReport.kpis.renewablePct}%` : '—'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {activeReport.kpis.weatherLabel} · {activeReport.kpis.temperatureC ?? '—'}°C
                </div>
              </div>
            )}
          </div>

          {/* Inline Particulate Trend Chart */}
          {activeReport.includeCategories.air && activeReport.chartSeries.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-slate-900">Particulate Concentration Profile (PM2.5 &amp; PM10)</h4>
              <div className="h-64 w-full border border-slate-100 rounded-lg p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activeReport.chartSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="pm25" name="PM2.5 (µg/m³)" stroke="#14532D" fill="#14532D" fillOpacity={0.14} strokeWidth={2} />
                    <Area type="monotone" dataKey="pm10" name="PM10 (µg/m³)" stroke="#0F766E" fill="#0F766E" fillOpacity={0.08} strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Pollutants Breakdown */}
          {activeReport.includeCategories.air && (
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-slate-900">Pollutant Breakdown</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {activeReport.pollutants.map((p) => (
                  <div key={p.parameter} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                    <div className="font-semibold text-slate-800">{p.parameter}</div>
                    <div className="font-mono-tabular font-bold text-slate-900 text-base mt-0.5">
                      {p.value !== null ? `${p.value} ${p.unit}` : '—'}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono-tabular">Sub-index: {p.subIndex ?? 'N/A'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Anomalies Table */}
          {activeReport.includeCategories.anomalies && (
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-slate-900">Detected Anomalies &amp; Weather Advisories</h4>
              {activeReport.anomalies.length === 0 && activeReport.weatherWarnings.length === 0 ? (
                <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                  <span>No statistical pollutant spikes or active meteorological warnings during this period.</span>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3">Indicator / Event</th>
                        <th className="py-2.5 px-3">Severity</th>
                        <th className="py-2.5 px-3 text-right">Observed vs Baseline</th>
                        <th className="py-2.5 px-3">Detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeReport.anomalies.map((a) => (
                        <tr key={a.id}>
                          <td className="py-2.5 px-3 font-medium text-slate-900">{a.parameter}</td>
                          <td className="py-2.5 px-3 capitalize">{a.severity}</td>
                          <td className="py-2.5 px-3 text-right font-mono-tabular">
                            {a.observedValue} / {a.baselineValue} {a.unit}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{a.reason}</td>
                        </tr>
                      ))}
                      {activeReport.weatherWarnings.map((w, idx) => (
                        <tr key={`wx-${idx}`}>
                          <td className="py-2.5 px-3 font-medium text-slate-900">{w.title}</td>
                          <td className="py-2.5 px-3 capitalize">{w.severity}</td>
                          <td className="py-2.5 px-3 text-right font-mono-tabular">7-day forecast</td>
                          <td className="py-2.5 px-3 text-slate-600">{w.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Actionable Recommendations */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <h4 className="text-sm font-bold text-slate-900">Actionable Recommendations</h4>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-700">
              {activeReport.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>

          {/* Active Data Sources Metadata */}
          {activeReport.sources.length > 0 && (
            <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
              <span className="font-semibold text-slate-700">Data Provenance:</span>
              {activeReport.sources.map((s) => (
                <span key={s.name}>
                  {s.name}: {s.status}
                  {s.isSampleData ? ' (Sample data)' : ''}
                </span>
              ))}
            </div>
          )}
        </article>
      )}
    </div>
  );
};
