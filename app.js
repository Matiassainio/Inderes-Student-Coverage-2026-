/* ============================================================
   INDERES OYJ — EQUITY RESEARCH DASHBOARD
   app.js - Dual DCF Interactive Valuation System
   ============================================================ */

/* ── Constants ────────────────────────────────────────────── */
const COLORS = {
  burgundy:  '#4D0003',
  gold:      '#D4AF37',
  gray:      '#888888',
  lightGray: '#e8e8e8',
};

/* Osakkeiden lukumäärä (milj.) — Tilinpäätös 2024 */
const SHARE_COUNT_K = 1_719.141;

/* Base historical financials (EUR thousands) */
const HISTORICAL = {
  years:    [2019, 2020, 2021, 2022, 2023],
  revenue:  [12_100, 13_400, 15_200, 18_600, 22_800],
  ebit:     [1_450,  1_720,  2_100,  3_050,  3_990],
  netIncome:[1_120,  1_310,  1_640,  2_390,  3_120],
  fcf:      [980,    1_180,  1_510,  2_150,  2_870],
};

/* Unified state object for dual DCF models */
let state = {
  dcfA: {
    revenueCAGR:  0.12,   // 12%
    ebitMargin:   0.18,   // 18%
    wacc:         0.094,  // 9.4%
    termGrowth:   0.01,   // 1%
  },
  dcfB: {
    revenueCAGR:  0.08,   // 8%
    ebitMargin:   0.14,   // 14%
    wacc:         0.094,  // 9.4%
    termGrowth:   0.01,   // 1%
  },
  weights: {
    dcfA: 0.75,  // 75%
    dcfB: 0.25,  // 25%
  },
  manualFcf: {
    dcfA: {
      enabled: true,
      byYear: {
        2026: 1700,
        2027: 2560,
        2028: 2940,
        2029: 3310,
        2030: 3990,
      },
    },
    dcfB: {
      enabled: true,
      byYear: {
        2026: 1859,
        2027: 1906,
        2028: 1803,
        2029: 1800,
        2030: 1495.5,
      },
    },
  },
};

const VALUATION_YEARS = [2026, 2027, 2028, 2029, 2030];

/* Balance sheet items for equity bridge (EUR thousands) — Tilinpäätös 2024 */
const CASH          = 2_310;   // Rahavarat
const DEBT          = 1_801;   // Korollinen velka
const MINORITY      = 0;       // Vähemmistöosuus

/* ── Utility helpers ──────────────────────────────────────── */
const fmt = {
  /** Format number with thousands separator */
  num: (n, dec = 0) => n.toLocaleString('en-FI', { minimumFractionDigits: dec, maximumFractionDigits: dec }),
  /** Format as MEUR (thousands → millions) */
  eur: (n) => `${(n / 1000).toFixed(1)} MEUR`,
  /** Format percentage */
  pct: (n, dec = 1) => `${(n * 100).toFixed(dec)}%`,
};

/* ── DCF Calculator ───────────────────────────────────────── */
function calcDCF(params) {
  const { revenueCAGR, ebitMargin, wacc, termGrowth } = params;
  const baseRevenue = HISTORICAL.revenue.at(-1); // last historical year
  const years       = 5;
  let revenues      = [];
  let fcfs          = [];

  for (let t = 1; t <= years; t++) {
    const rev  = baseRevenue * Math.pow(1 + revenueCAGR, t);
    const ebit = rev * ebitMargin;
    // Simplified FCF = EBIT * (1 - tax) - capex + D&A (rough proxy)
    const fcf  = ebit * 0.78 * 0.85;
    revenues.push(rev);
    fcfs.push(fcf);
  }

  // PV of FCFs
  const pvFCFs = fcfs.map((f, i) => f / Math.pow(1 + wacc, i + 1));
  const sumPV  = pvFCFs.reduce((a, b) => a + b, 0);

  // Terminal value (Gordon growth), discounted one period beyond last FCF
  const lastFCF    = fcfs.at(-1);
  const TV         = termGrowth > 0
    ? (lastFCF * (1 + termGrowth)) / (wacc - termGrowth)
    : lastFCF / wacc;
  const pvTV       = TV / Math.pow(1 + wacc, years + 1);

  const debtFreeDCF = sumPV + pvTV;
  const equityVal   = debtFreeDCF + CASH - DEBT - MINORITY;
  const pricePerSh  = equityVal / SHARE_COUNT_K;

  return {
    revenues,
    fcfs,
    EV:       Math.round(debtFreeDCF),
    equityVal:Math.round(equityVal),
    pricePerSh: pricePerSh.toFixed(2),
  };
}

/* ── DCF Calculator (Valuation horizon + manual FCF) ───── */
function calcDCFValuation(params, manualOverride) {
  const { revenueCAGR, ebitMargin, wacc, termGrowth } = params;

  // Use 2025–2030 as explicit valuation forecast years.
  const years = VALUATION_YEARS.length;
  const baseRevenue2023 = HISTORICAL.revenue.at(-1);
  const revenue2024 = baseRevenue2023 * (1 + revenueCAGR);

  const revenues = [];
  const fcfsCalc = [];

  for (let t = 1; t <= years; t++) {
    const rev = revenue2024 * Math.pow(1 + revenueCAGR, t);
    const ebit = rev * ebitMargin;
    const fcf = ebit * 0.78 * 0.85;
    revenues.push(rev);
    fcfsCalc.push(fcf);
  }

  let fcfs = fcfsCalc;
  if (manualOverride && manualOverride.enabled) {
    fcfs = VALUATION_YEARS.map((y, i) => {
      const v = manualOverride.byYear?.[y];
      return Number.isFinite(v) ? v : fcfsCalc[i];
    });
  }

  // Discount each FCF: year i (0-based) => period i+1
  const pvFCFs = fcfs.map((f, i) => f / Math.pow(1 + wacc, i + 1));
  const sumPV = pvFCFs.reduce((a, b) => a + b, 0);

  // Terminal value (Gordon growth) discounted one period beyond last FCF
  const lastFCF = fcfs.at(-1);
  const TV = termGrowth > 0
    ? (lastFCF * (1 + termGrowth)) / (wacc - termGrowth)
    : lastFCF / wacc;
  const pvTV = TV / Math.pow(1 + wacc, years + 1);

  const debtFreeDCF = sumPV + pvTV;
  // Equity bridge: + kassa − korollinen velka − vähemmistöosuus
  const equityVal = debtFreeDCF + CASH - DEBT - MINORITY;
  const pricePerSh = equityVal / SHARE_COUNT_K;

  return {
    revenues,
    fcfs,
    EV: Math.round(debtFreeDCF),
    equityVal: Math.round(equityVal),
    pricePerSh: pricePerSh.toFixed(2),
  };
}

/* ── Weighted Valuation Calculator ───────────────────────── */
function calcWeightedValuation() {
  const dcfA = calcDCF(state.dcfA);
  const dcfB = calcDCF(state.dcfB);
  const weights = state.weights;
  
  return {
    dcfA,
    dcfB,
    weighted: {
      EV: Math.round(dcfA.EV * weights.dcfA + dcfB.EV * weights.dcfB),
      equityVal: Math.round(dcfA.equityVal * weights.dcfA + dcfB.equityVal * weights.dcfB),
      pricePerSh: (parseFloat(dcfA.pricePerSh) * weights.dcfA + parseFloat(dcfB.pricePerSh) * weights.dcfB).toFixed(2)
    }
  };
}

function calcWeightedValuationForValuation() {
  const dcfA = calcDCFValuation(state.dcfA, state.manualFcf?.dcfA);
  const dcfB = calcDCFValuation(state.dcfB, state.manualFcf?.dcfB);
  const weights = state.weights;

  return {
    dcfA,
    dcfB,
    weighted: {
      EV: Math.round(dcfA.EV * weights.dcfA + dcfB.EV * weights.dcfB),
      equityVal: Math.round(dcfA.equityVal * weights.dcfA + dcfB.equityVal * weights.dcfB),
      pricePerSh: (parseFloat(dcfA.pricePerSh) * weights.dcfA + parseFloat(dcfB.pricePerSh) * weights.dcfB).toFixed(2),
    },
  };
}

/* ── Chart: FCF Scenarios ─────────────────────────────────── */
let fcfChart = null;

function buildFCFData() {
  const labels = VALUATION_YEARS.map(year => `${year}E`);
  const dcfA   = calcDCFValuation(state.dcfA, state.manualFcf?.dcfA).fcfs;
  const dcfB   = calcDCFValuation(state.dcfB, state.manualFcf?.dcfB).fcfs;
  const weighted = dcfA.map((a, i) => a * state.weights.dcfA + dcfB[i] * state.weights.dcfB);

  return { labels, dcfA, dcfB, weighted };
}

function initFCFChart() {
  const ctx = document.getElementById('fcf-chart');
  if (!ctx) return;

  const { labels, dcfA, dcfB, weighted } = buildFCFData();

  fcfChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label:           'DCF A (optimistinen)',
          data:            dcfA.map(v => Math.round(v)),
          borderColor:     COLORS.burgundy,
          backgroundColor: COLORS.burgundy + '18',
          borderWidth:     2.5,
          pointRadius:     4,
          pointBackgroundColor: COLORS.burgundy,
          fill:            true,
          tension:         0.3,
        },
        {
          label:           'DCF B (konservatiivinen)',
          data:            dcfB.map(v => Math.round(v)),
          borderColor:     COLORS.gold,
          backgroundColor: COLORS.gold + '15',
          borderWidth:     2,
          pointRadius:     3,
          pointBackgroundColor: COLORS.gold,
          fill:            false,
          tension:         0.3,
        },
        {
          label:           'Painotettu keskiarvo',
          data:            weighted.map(v => Math.round(v)),
          borderColor:     '#333',
          backgroundColor: 'transparent',
          borderWidth:     3,
          borderDash:      [6, 4],
          pointRadius:     4,
          pointBackgroundColor: '#333',
          fill:            false,
          tension:         0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0d0d0d',
          titleFont:       { family: 'Franklin Gothic Book, Franklin Gothic Medium, Arial, sans-serif', size: 11 },
          bodyFont:        { family: 'Franklin Gothic Book, Franklin Gothic Medium, Arial, sans-serif', size: 11 },
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${(ctx.parsed.y / 1000).toFixed(2)} MEUR`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: COLORS.lightGray, drawBorder: false },
          ticks: { font: { family: 'Franklin Gothic Book, Franklin Gothic Medium, Arial, sans-serif', size: 10 }, color: '#888' },
        },
        y: {
          grid: { color: COLORS.lightGray, drawBorder: false },
          ticks: {
            font: { family: 'Franklin Gothic Book, Franklin Gothic Medium, Arial, sans-serif', size: 10 },
            color: '#888',
            callback: v => `${(v / 1000).toFixed(1)} MEUR`,
          },
        },
      },
    },
  });
}

function updateFCFChart() {
  if (!fcfChart) return;
  const { labels, dcfA, dcfB, weighted } = buildFCFData();
  fcfChart.data.datasets[0].data = dcfA.map(v => Math.round(v));
  fcfChart.data.datasets[1].data = dcfB.map(v => Math.round(v));
  fcfChart.data.datasets[2].data = weighted.map(v => Math.round(v));
  fcfChart.update('active');
}

/* ── Chart: Historical Price (CSV) ───────────────────────── */
let historicalPriceChart = null;

function parseQuotedCsvLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).split('","');
  }
  return trimmed.split(',');
}

function normalizeDateLabel(input) {
  // CSV date format appears as dd/mm/yyyy (Investing.com style). Handle ambiguity minimally.
  const parts = String(input || '').trim().split('/');
  if (parts.length !== 3) return String(input || '').trim();

  let a = parseInt(parts[0], 10);
  let b = parseInt(parts[1], 10);
  let y = parseInt(parts[2], 10);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(y)) return String(input || '').trim();

  // Heuristic: if one side cannot be month, treat the other as month.
  // Otherwise default to dd/mm.
  let day = a;
  let month = b;
  if (a >= 1 && a <= 12 && b > 12) {
    month = a;
    day = b;
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function parseLocaleNumber(input) {
  let s = String(input ?? '').trim();
  if (!s) return NaN;

  // Remove spaces (including NBSP) commonly used as thousands separators.
  s = s.replace(/[\s\u00A0]/g, '');

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Decide decimal separator by which appears last.
    if (s.lastIndexOf('.') > s.lastIndexOf(',')) {
      // 1,234.56 -> comma thousands
      return Number(s.replace(/,/g, ''));
    }
    // 1.234,56 -> dot thousands, comma decimal
    return Number(s.replace(/\./g, '').replace(/,/g, '.'));
  }

  if (hasComma && !hasDot) {
    // 1234,56 (decimal comma) OR 1,234 (thousands)
    const parts = s.split(',');
    const last = parts.at(-1) || '';
    if (last.length <= 2) {
      return Number(parts.slice(0, -1).join('') + '.' + last);
    }
    return Number(parts.join(''));
  }

  if (!hasComma && hasDot) {
    // 1.234.567 (thousands) OR 1234.56 (decimal dot)
    const parts = s.split('.');
    const last = parts.at(-1) || '';
    const looksLikeThousands = parts.length > 2 && last.length === 3;
    return Number(looksLikeThousands ? parts.join('') : s);
  }

  return Number(s);
}

function parseInderesHistoricalCsv(csvText) {
  const lines = String(csvText || '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { labels: [], values: [], byDate: new Map() };

  const header = parseQuotedCsvLine(lines[0]);
  const dateIdx = header.findIndex(h => h.replaceAll('"', '').trim().toLowerCase() === 'date');
  const priceIdx = header.findIndex(h => h.replaceAll('"', '').trim().toLowerCase() === 'price');

  const labelsDesc = [];
  const valuesDesc = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseQuotedCsvLine(lines[i]);
    if (!cols.length) continue;

    const rawDate = cols[dateIdx] ?? cols[0];
    const rawPrice = cols[priceIdx] ?? cols[1];
    if (rawDate == null || rawPrice == null) continue;

    const label = normalizeDateLabel(rawDate);
    const value = parseLocaleNumber(rawPrice);
    if (!Number.isFinite(value)) continue;

    labelsDesc.push(label);
    valuesDesc.push(value);
  }

  // CSV is newest-first; reverse to oldest-first for nicer charts.
  const labels = labelsDesc.reverse();
  const values = valuesDesc.reverse();
  const byDate = new Map(labels.map((d, idx) => [d, values[idx]]));

  return { labels, values, byDate };
}

function findBaseValue(values, labels, baseLabel) {
  if (baseLabel) {
    const idx = labels.indexOf(baseLabel);
    if (idx >= 0 && Number.isFinite(values[idx])) return values[idx];
  }
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return null;
}

function rebaseToPctChange(values, baseValue) {
  if (!Number.isFinite(baseValue) || baseValue === 0) {
    return values.map(() => null);
  }
  return values.map(v => (Number.isFinite(v) ? ((v / baseValue) - 1) * 100 : null));
}

async function initHistoricalPriceChart() {
  const canvas = document.getElementById('historical-price-chart');
  if (!canvas) return;

  // Keep the filename as-is; encode spaces for fetch.
  const url = 'assets/financial_data_/INDERES%20Historical%20Data%20(1).csv';

  let text;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    console.error('Historical price CSV fetch failed:', err);
    return;
  }

  const { labels, values } = parseInderesHistoricalCsv(text);
  if (!labels.length) return;

  // Fetch comparison indices up-front so we can pick a single shared base date.
  const comparisonDefs = [
    {
      checkboxId: 'toggle-omxh25',
      label: 'OMX Helsinki 25',
      url: 'assets/financial_data_/OMX%20Helsinki%2025%20Historical%20Data%20(2).csv',
      color: COLORS.gold,
    },
    {
      checkboxId: 'toggle-firstnorth',
      label: 'First North Finland PI',
      url: 'assets/financial_data_/First%20North%20Finland%20PI%20Historical%20Data.csv',
      color: '#333',
    },
  ];

  const fetched = await Promise.all(
    comparisonDefs.map(async (d) => {
      try {
        const res = await fetch(d.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const t = await res.text();
        const parsed = parseInderesHistoricalCsv(t);
        return { def: d, ok: parsed.byDate && parsed.byDate.size > 0, parsed };
      } catch (err) {
        console.error('Comparison CSV fetch failed:', d.url, err);
        return { def: d, ok: false, parsed: { byDate: new Map() } };
      }
    })
  );

  const comparisonMaps = fetched
    .filter(x => x.ok)
    .map(x => ({ def: x.def, byDate: x.parsed.byDate }));

  // Base date = first date that exists in Inderes and all successfully loaded comparisons.
  let baseLabel = labels[0];
  if (comparisonMaps.length) {
    const firstCommon = labels.find(d => comparisonMaps.every(m => m.byDate.has(d)));
    if (firstCommon) baseLabel = firstCommon;
  }

  const baseValue = findBaseValue(values, labels, baseLabel);
  const indexedValues = rebaseToPctChange(values, baseValue);

  historicalPriceChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: buildHistoricalIndexedDatasets(labels, indexedValues, baseLabel, comparisonMaps),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      elements: {
        point: {
          radius: 0,
          hoverRadius: 0,
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: '#fff',
          titleColor: '#000',
          bodyColor: '#000',
          borderColor: '#ccc',
          borderWidth: 1,
          titleFont: { family: 'Franklin Gothic Book, Franklin Gothic Medium, Arial, sans-serif', size: 13, weight: 'bold' },
          bodyFont: { family: 'Franklin Gothic Book, Franklin Gothic Medium, Arial, sans-serif', size: 13 },
          padding: 12,
          cornerRadius: 6,
          usePointStyle: false,
          boxWidth: 12,
          boxHeight: 12,
          boxPadding: 6,
          callbacks: {
            title: items => {
              const date = items?.[0]?.label ?? '';
              return date;
            },
            label: ctx => {
              const v = Number(ctx.parsed.y);
              return ` ${ctx.dataset.label}: ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
            },
            labelColor: ctx => ({
              borderColor: ctx.dataset.borderColor,
              backgroundColor: ctx.dataset.borderColor,
            }),
          },
        },
      },
      scales: {
        x: {
          grid: { color: COLORS.lightGray, drawBorder: false },
          ticks: {
            font: { family: 'Franklin Gothic Book, Franklin Gothic Medium, Arial, sans-serif', size: 12 },
            color: '#000',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
          },
        },
        y: {
          grid: { color: COLORS.lightGray, drawBorder: false },
          ticks: {
            font: { family: 'Franklin Gothic Book, Franklin Gothic Medium, Arial, sans-serif', size: 12 },
            color: '#000',
            callback: v => `${Number(v).toFixed(0)}%`,
          },
        },
      },
    },
  });

  // Stash base label for later comparisons
  historicalPriceChart.$baseLabel = baseLabel;

  // Wire toggles for the two default comparisons
  for (const m of comparisonMaps) {
    const checkbox = document.getElementById(m.def.checkboxId);
    if (!checkbox) continue;
    checkbox.addEventListener('change', () => {
      const ds = historicalPriceChart.data.datasets.find(d => d.label === m.def.label);
      if (!ds) return;
      ds.hidden = !checkbox.checked;

      if (typeof historicalPriceChart.setActiveElements === 'function') {
        historicalPriceChart.setActiveElements([]);
      }
      if (historicalPriceChart.tooltip && typeof historicalPriceChart.tooltip.setActiveElements === 'function') {
        historicalPriceChart.tooltip.setActiveElements([], { x: 0, y: 0 });
      }

      historicalPriceChart.update('none');
    });
  }
}

function buildHistoricalIndexedDatasets(labels, indexedInderesValues, baseLabel, comparisonMaps) {
  const datasets = [
    {
      label: 'Inderes (%-muutos)',
      data: indexedInderesValues,
      borderColor: COLORS.burgundy,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
      tension: 0.15,
    },
  ];

  for (const m of comparisonMaps) {
    const raw = labels.map(d => (m.byDate.has(d) ? m.byDate.get(d) : null));
    const idx = labels.indexOf(baseLabel);
    const baseValue = idx >= 0 && Number.isFinite(raw[idx]) ? raw[idx] : null;
    if (!Number.isFinite(baseValue) || baseValue === 0) continue;
    const data = rebaseToPctChange(raw, baseValue);

    const checkbox = document.getElementById(m.def.checkboxId);
    const isChecked = checkbox ? checkbox.checked : true;

    datasets.push({
      label: m.def.label,
      data,
      borderColor: m.def.color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
      tension: 0.15,
      hidden: !isChecked,
    });
  }

  return datasets;
}

async function loadHistoricalComparisonSeries(seriesList) {
  if (!historicalPriceChart) return;

  const baseLabels = historicalPriceChart.data.labels || [];
  const baseLabel = historicalPriceChart.$baseLabel || baseLabels[0];
  for (const s of seriesList) {
    let text;
    try {
      const res = await fetch(s.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (err) {
      console.error('Comparison CSV fetch failed:', s.url, err);
      continue;
    }

    const { byDate } = parseInderesHistoricalCsv(text);
    const raw = baseLabels.map(d => (byDate.has(d) ? byDate.get(d) : null));
    const comparisonBase = (() => {
      const idx = baseLabel ? baseLabels.indexOf(baseLabel) : -1;
      if (idx >= 0 && Number.isFinite(raw[idx])) return raw[idx];
      for (let i = 0; i < raw.length; i++) {
        if (Number.isFinite(raw[i])) return raw[i];
      }
      return null;
    })();
    const data = rebaseToPctChange(raw, comparisonBase);

    const checkbox = document.getElementById(s.checkboxId);
    const isChecked = checkbox ? checkbox.checked : true;

    historicalPriceChart.data.datasets.push({
      label: s.label,
      data,
      borderColor: s.color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      fill: false,
      tension: 0.15,
      hidden: !isChecked,
    });

    if (checkbox) {
      checkbox.addEventListener('change', () => {
        const ds = historicalPriceChart.data.datasets.find(d => d.label === s.label);
        if (!ds) return;
        ds.hidden = !checkbox.checked;
        historicalPriceChart.update('active');
      });
    }
  }

  historicalPriceChart.update('active');
}

/**
 * Public hook for later comparisons (e.g., index series).
 * Usage (console): await window.historicalChartAddSeries('assets/myindex.csv', 'Indexi')
 */
window.historicalChartAddSeries = async (csvUrl, label = 'Vertailu', color = '#333') => {
  if (!historicalPriceChart) return;

  let text;
  try {
    const res = await fetch(csvUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    console.error('Comparison CSV fetch failed:', err);
    return;
  }

  const { byDate } = parseInderesHistoricalCsv(text);
  const baseLabels = historicalPriceChart.data.labels || [];
  const baseLabel = historicalPriceChart.$baseLabel || baseLabels[0];
  const raw = baseLabels.map(d => (byDate.has(d) ? byDate.get(d) : null));
  const idx = baseLabel ? baseLabels.indexOf(baseLabel) : -1;
  const baseValue = idx >= 0 && Number.isFinite(raw[idx]) ? raw[idx] : null;
  if (!Number.isFinite(baseValue) || baseValue === 0) {
    console.warn('Added series is missing the shared base date; not adding:', { csvUrl, label, baseLabel });
    return;
  }
  const data = rebaseToPctChange(raw, baseValue);

  historicalPriceChart.data.datasets.push({
    label,
    data,
    borderColor: color,
    backgroundColor: 'transparent',
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 3,
    fill: false,
    tension: 0.15,
  });

  historicalPriceChart.update('active');
};

/* ── Probability Weight Gauges (Semicircle Style) ─────── */

/**
 * Draw a semicircle probability gauge using canvas.
 * @param {string} canvasId - Canvas element ID
 * @param {number} percent - Percentage 0–100
 * @param {boolean} isRightToLeft - Fill direction (DCF B fills right-to-left)
 */
function drawProbabilityGauge(canvasId, percent, isRightToLeft = false) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Canvas sizing with device pixel ratio
  const W = 180, H = 104;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Gauge geometry
  const pad = 12;
  const cx = W / 2;
  const cy = H - 4;
  const lw = 20;
  const rOuter = cx - pad;
  const rMid = rOuter - lw / 2;
  const rInner = rOuter - lw;

  // Colors
  const FILLED = COLORS.burgundy;
  const TRACK = '#e8e8e8';
  const BORDER = 'rgba(0,0,0,0.15)';

  // Clamp percentage
  const v = Math.min(100, Math.max(0, +percent));

  // Draw track (full semicircle)
  ctx.beginPath();
  ctx.arc(cx, cy, rMid, Math.PI, Math.PI * 2, false);
  ctx.strokeStyle = TRACK;
  ctx.lineWidth = lw;
  ctx.lineCap = 'butt';
  ctx.stroke();

  // Draw filled arc
  if (v > 0) {
    let aStart, aEnd;
    if (!isRightToLeft) {
      // DCF A: left to right
      aStart = Math.PI;
      aEnd = Math.PI + Math.PI * (v / 100);
    } else {
      // DCF B: right to left
      aStart = Math.PI * (2 - v / 100);
      aEnd = Math.PI * 2;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, rMid, aStart, aEnd, false);
    ctx.strokeStyle = FILLED;
    ctx.lineWidth = lw;
    ctx.lineCap = 'butt';
    ctx.stroke();
  }

  // Draw borders
  for (const r of [rOuter, rInner]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, Math.PI * 2, false);
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    ctx.stroke();
  }

  // Draw percentage label
  const labelY = cy - rMid * 0.42;
  ctx.fillStyle = '#111';
  ctx.font = "bold 22px 'Franklin Gothic Medium', Arial, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(v) + '%', cx, labelY);
}

function initProbabilityGauges() {
  const weightAPct = Math.round(state.weights.dcfA * 100);
  const weightBPct = Math.round(state.weights.dcfB * 100);

  drawProbabilityGauge('gauge-weight-a', weightAPct, false);
  drawProbabilityGauge('gauge-weight-b', weightBPct, true);
}

function updateProbabilityGauges() {
  const weightAPct = Math.round(state.weights.dcfA * 100);
  const weightBPct = Math.round(state.weights.dcfB * 100);

  drawProbabilityGauge('gauge-weight-a', weightAPct, false);
  drawProbabilityGauge('gauge-weight-b', weightBPct, true);
}

function updateGaugeLabel(elId, pct) {
  // No longer needed since percentage is drawn directly on canvas
  // Kept for backwards compatibility
}

/* ── Display Updates ──────────────────────────────────────── */
function updateAllDisplays() {
  const results = calcWeightedValuationForValuation();
  
  // Update DCF results table
  setEl('dcf-a-ev', fmt.eur(results.dcfA.EV));
  setEl('dcf-b-ev', fmt.eur(results.dcfB.EV));
  setEl('weighted-ev', fmt.eur(results.weighted.EV));
  
  setEl('dcf-a-equity', fmt.eur(results.dcfA.equityVal));
  setEl('dcf-b-equity', fmt.eur(results.dcfB.equityVal));
  setEl('weighted-equity', fmt.eur(results.weighted.equityVal));
  
  setEl('dcf-a-per-share', `EUR ${results.dcfA.pricePerSh}`);
  setEl('dcf-b-per-share', `EUR ${results.dcfB.pricePerSh}`);
  setEl('weighted-per-share', `EUR ${results.weighted.pricePerSh}`);
  setEl('weighted-per-share-hero', `EUR ${results.weighted.pricePerSh}`);
  setEl('gauge-a-per-share', `EUR ${results.dcfA.pricePerSh}`);
  setEl('gauge-b-per-share', `EUR ${results.dcfB.pricePerSh}`);
  
  // Update assumption displays
  setEl('dcf-a-assumpt-revenue', fmt.pct(state.dcfA.revenueCAGR));
  setEl('dcf-a-assumpt-ebit', fmt.pct(state.dcfA.ebitMargin));
  setEl('dcf-a-assumpt-wacc', fmt.pct(state.dcfA.wacc));
  setEl('dcf-a-assumpt-terminal', fmt.pct(state.dcfA.termGrowth));
  
  setEl('dcf-b-assumpt-revenue', fmt.pct(state.dcfB.revenueCAGR));
  setEl('dcf-b-assumpt-ebit', fmt.pct(state.dcfB.ebitMargin));
  setEl('dcf-b-assumpt-wacc', fmt.pct(state.dcfB.wacc));
  setEl('dcf-b-assumpt-terminal', fmt.pct(state.dcfB.termGrowth));
  
  // Update probability gauge displays and charts
  updateProbabilityGauges();
  
  // Update FCF chart
  updateFCFChart();
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* ── Control Panel Input Wiring ──────────────────────────── */
function wireControlInputs() {
  // DCF A inputs
  const dcfAInputs = [
    { id: 'dcf-a-wacc', key: 'wacc', numId: 'dcf-a-wacc-num' },
    { id: 'dcf-a-terminal', key: 'termGrowth', numId: 'dcf-a-terminal-num' },
  ];

  // DCF B inputs
  const dcfBInputs = [
    { id: 'dcf-b-wacc', key: 'wacc', numId: 'dcf-b-wacc-num' },
    { id: 'dcf-b-terminal', key: 'termGrowth', numId: 'dcf-b-terminal-num' },
  ];

  // Wire DCF A inputs
  dcfAInputs.forEach(({ id, key, numId }) => {
    const inp = document.getElementById(id);
    const numInp = document.getElementById(numId);
    if (!inp) return;

    // Set initial values
    inp.value = state.dcfA[key];
    if (numInp) numInp.value = (state.dcfA[key] * 100).toFixed(1);

    // Range slider input handler
    inp.addEventListener('input', () => {
      state.dcfA[key] = parseFloat(inp.value);
      if (numInp) numInp.value = (state.dcfA[key] * 100).toFixed(1);
      updateAllDisplays();
    });

    // Number input handler
    if (numInp) {
      numInp.addEventListener('input', () => {
        const value = parseFloat(numInp.value) / 100;
        state.dcfA[key] = value;
        inp.value = value;
        updateAllDisplays();
      });
    }
  });

  // Wire DCF B inputs
  dcfBInputs.forEach(({ id, key, numId }) => {
    const inp = document.getElementById(id);
    const numInp = document.getElementById(numId);
    if (!inp) return;

    // Set initial values
    inp.value = state.dcfB[key];
    if (numInp) numInp.value = (state.dcfB[key] * 100).toFixed(1);

    // Range slider input handler
    inp.addEventListener('input', () => {
      state.dcfB[key] = parseFloat(inp.value);
      if (numInp) numInp.value = (state.dcfB[key] * 100).toFixed(1);
      updateAllDisplays();
    });

    // Number input handler
    if (numInp) {
      numInp.addEventListener('input', () => {
        const value = parseFloat(numInp.value) / 100;
        state.dcfB[key] = value;
        inp.value = value;
        updateAllDisplays();
      });
    }
  });

  // Wire probability weight controls
  const weightASlider = document.getElementById('weight-a');
  const weightADisplay = document.getElementById('weight-a-display');
  const weightBDisplay = document.getElementById('weight-b-display');

  // Initialize weight values
  if (weightASlider) {
    weightASlider.value = Math.round(state.weights.dcfA * 100);
    if (weightADisplay) weightADisplay.textContent = Math.round(state.weights.dcfA * 100) + '%';
    if (weightBDisplay) weightBDisplay.textContent = Math.round(state.weights.dcfB * 100) + '%';

    weightASlider.addEventListener('input', () => {
      const dcfAWeight = parseInt(weightASlider.value) / 100;
      const dcfBWeight = 1 - dcfAWeight;
      
      state.weights.dcfA = dcfAWeight;
      state.weights.dcfB = dcfBWeight;
      
      // Update displays and other slider
      if (weightADisplay) weightADisplay.textContent = Math.round(dcfAWeight * 100) + '%';
      if (weightBDisplay) weightBDisplay.textContent = Math.round(dcfBWeight * 100) + '%';
      
      updateAllDisplays();
    });
  }

  // Wire manual FCF inputs (Valuation) — per model (A/B), always enabled
  const bindManualFcf = ({ modelKey, inputPrefix }) => {
    const manualState = state.manualFcf?.[modelKey];
    if (!manualState) return;

    const yearInputs = VALUATION_YEARS.map(y => ({
      year: y,
      el: document.getElementById(`${inputPrefix}-${y}`),
    }));

    // Populate input fields from state (analyst defaults are already set).
    for (let i = 0; i < VALUATION_YEARS.length; i++) {
      const year = VALUATION_YEARS[i];
      const inputEl = yearInputs[i].el;
      if (inputEl) {
        inputEl.value = manualState.byYear[year] ?? '';
        inputEl.step = '1';
      }
    }

    for (const { year, el } of yearInputs) {
      if (!el) continue;
      el.addEventListener('input', () => {
        const v = parseLocaleNumber(el.value);
        manualState.byYear[year] = Number.isFinite(v) ? v : null;
        updateAllDisplays();
      });
    }
  };

  bindManualFcf({
    modelKey: 'dcfA',
    inputPrefix: 'manual-fcf-a',
  });

  bindManualFcf({
    modelKey: 'dcfB',
    inputPrefix: 'manual-fcf-b',
  });
}

/* ── Collapsible Groups ──────────────────────────────────── */
function initCollapsibles() {
  const toggles = document.querySelectorAll('.group-title.toggle');
  
  toggles.forEach(toggle => {
    toggle.addEventListener('click', () => {
      const group = toggle.closest('.control-group');
      const target = toggle.getAttribute('data-target');
      const content = document.getElementById(target);
      const icon = toggle.querySelector('.toggle-icon');
      
      if (!content) return;
      
      const isExpanded = group.classList.contains('expanded');
      
      if (isExpanded) {
        group.classList.remove('expanded');
        content.style.display = 'none';
        if (icon) icon.textContent = '+';
      } else {
        group.classList.add('expanded');
        content.style.display = 'block';
        if (icon) icon.textContent = '−';
      }
    });
  });
}

/* ── Active Nav Highlighting ──────────────────────────────── */
function initScrollSpy() {
  const sections = document.querySelectorAll('.section[id]');
  const navLinks = document.querySelectorAll('.nav-toc a');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          navLinks.forEach(link => link.classList.remove('active'));
          const active = document.querySelector(`.nav-toc a[href="#${entry.target.id}"]`);
          if (active) active.classList.add('active');
        }
      });
    },
    { rootMargin: '-20% 0px -70% 0px' }
  );

  sections.forEach(s => observer.observe(s));
}

/* ── Disclaimer Modal ─────────────────────────────────────── */
function initDisclaimer() {
  const btn = document.getElementById('accept-disclaimer');
  const overlay = document.getElementById('disclaimer-overlay');
  if (!btn || !overlay) return;

  btn.addEventListener('click', () => {
    overlay.remove();
  });
}

/* ── Inline PDF Viewer (PDF.js) ──────────────────────────── */
const PDF_URL = encodeURI('assets/Initiation of coverage Inderes, From Finnish roots to scalable platforms.pdf');

// Manual mapping: HTML anchor IDs → PDF page numbers.
const TOC_ID_TO_PDF_PAGE = {
  'key-findings': 4,
  'introduction': 7,
  'business': 10,
  'strategy-governance-ownership': 19,
  'competitive-landscape': 27,
  'operating-environment': 32,
  'esg-considerations': 37,
  'forecast': 43,
  'valuation': 52,
  'appendices': 60,
};

const pdfState = {
  pdfDoc: null,
  numPages: 0,
  currentPage: 1,
  renderTask: null,
  outlineExactMap: null, // { normalizedTitle: pageNum }
  outlineEntries: null,  // [{ titleNorm, pageNum }]
  pendingNav: null,
  zoomLevel: 1.0,        // 1.0 = fit-to-width
};

function normalizeLoose(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N} \-+&]/gu, '')
    .trim();
}

function debounce(fn, waitMs) {
  let t = null;
  return (...args) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), waitMs);
  };
}

function getPdfElements() {
  const canvas = document.getElementById('pdf-canvas');
  const wrap = document.getElementById('pdf-canvas-wrap');
  const label = document.getElementById('pdf-page-label');
  const fallback = document.getElementById('pdf-fallback');
  return { canvas, wrap, label, fallback };
}

function scrollPdfIntoView() {
  const block = document.getElementById('pdf-report');
  if (!block) return;
  block.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function resolveDestToPageNum(pdfDoc, dest) {
  let explicitDest = dest;
  if (typeof dest === 'string') {
    explicitDest = await pdfDoc.getDestination(dest);
  }

  if (!Array.isArray(explicitDest) || explicitDest.length === 0) return null;
  const ref = explicitDest[0];
  if (!ref) return null;
  const pageIndex = await pdfDoc.getPageIndex(ref);
  return pageIndex + 1;
}

async function buildPdfOutlineIndex(pdfDoc) {
  const outline = await pdfDoc.getOutline();
  if (!outline) {
    pdfState.outlineExactMap = null;
    pdfState.outlineEntries = null;
    return;
  }

  const entries = [];
  const exactMap = Object.create(null);

  const walk = async (items) => {
    for (const item of items || []) {
      const titleNorm = normalizeLoose(item.title);
      if (item.dest) {
        try {
          const pageNum = await resolveDestToPageNum(pdfDoc, item.dest);
          if (pageNum) {
            entries.push({ titleNorm, pageNum });
            if (titleNorm && exactMap[titleNorm] == null) exactMap[titleNorm] = pageNum;
          }
        } catch {
          // ignore outline items we can't resolve
        }
      }
      if (item.items && item.items.length) {
        await walk(item.items);
      }
    }
  };

  await walk(outline);
  pdfState.outlineEntries = entries;
  pdfState.outlineExactMap = exactMap;
}

async function renderPdfPage(pageNum) {
  const { canvas, wrap, label } = getPdfElements();
  if (!canvas || !wrap || !label) return;
  if (!pdfState.pdfDoc) return;

  const safePage = Math.max(1, Math.min(pdfState.numPages || 1, pageNum));
  pdfState.currentPage = safePage;

  if (pdfState.renderTask) {
    try { pdfState.renderTask.cancel(); } catch { /* noop */ }
    pdfState.renderTask = null;
  }

  const page = await pdfState.pdfDoc.getPage(safePage);

  const unscaled = page.getViewport({ scale: 1 });
  const containerWidth = Math.max(320, wrap.clientWidth || 0);
  const fitScale = containerWidth / unscaled.width;
  const displayScale = fitScale * pdfState.zoomLevel;

  // CSS display size
  const cssW = Math.floor(unscaled.width * displayScale);
  const cssH = Math.floor(unscaled.height * displayScale);

  // Render at exact device-pixel resolution (1:1 pixel match = maximum crispness)
  const dpr = window.devicePixelRatio || 1;
  const renderScale = displayScale * dpr;
  const viewport = page.getViewport({ scale: renderScale });

  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext('2d', { alpha: false });

  pdfState.renderTask = page.render({ canvasContext: ctx, viewport });
  await pdfState.renderTask.promise;

  label.textContent = `Sivu ${safePage} / ${pdfState.numPages}`;

  // Sync page input & button states
  const pageInput = document.getElementById('pdf-page-input');
  const prevBtn = document.getElementById('pdf-prev');
  const nextBtn = document.getElementById('pdf-next');
  const zoomLabel = document.getElementById('pdf-zoom-label');
  if (pageInput) { pageInput.value = safePage; pageInput.max = pdfState.numPages; }
  if (prevBtn) prevBtn.disabled = safePage <= 1;
  if (nextBtn) nextBtn.disabled = safePage >= pdfState.numPages;
  if (zoomLabel) zoomLabel.textContent = `${Math.round(pdfState.zoomLevel * 100)} %`;
}

function pickOutlinePageForTocText(tocText) {
  const tocNorm = normalizeLoose(tocText);
  if (!tocNorm || !pdfState.outlineEntries) return null;

  if (pdfState.outlineExactMap && pdfState.outlineExactMap[tocNorm] != null) {
    return pdfState.outlineExactMap[tocNorm];
  }

  let best = null;
  let bestScore = 0;
  for (const entry of pdfState.outlineEntries) {
    if (!entry.titleNorm) continue;
    if (entry.titleNorm === tocNorm) return entry.pageNum;

    const a = entry.titleNorm;
    const b = tocNorm;
    let score = 0;
    if (a.includes(b) || b.includes(a)) score = Math.min(a.length, b.length);
    if (score > bestScore) {
      bestScore = score;
      best = entry.pageNum;
    }
  }
  return best;
}

async function goToPdfPage(pageNum, { scrollIntoView = true } = {}) {
  if (scrollIntoView) scrollPdfIntoView();
  if (!pdfState.pdfDoc) {
    pdfState.pendingNav = { pageNum };
    return;
  }
  await renderPdfPage(pageNum);
}

async function goToPdfFromToc(linkEl) {
  const href = linkEl.getAttribute('href') || '';
  const targetId = href.startsWith('#') ? href.slice(1) : null;

  scrollPdfIntoView();

  const explicitPage = Number.parseInt(linkEl.getAttribute('data-pdf-page') || '', 10);
  if (Number.isFinite(explicitPage) && explicitPage > 0) {
    await goToPdfPage(explicitPage, { scrollIntoView: false });
    return;
  }

  if (targetId && TOC_ID_TO_PDF_PAGE[targetId] != null) {
    await goToPdfPage(TOC_ID_TO_PDF_PAGE[targetId], { scrollIntoView: false });
    return;
  }

  const tocText =
    linkEl.querySelector('.toc-text')?.textContent ||
    linkEl.textContent ||
    '';
  const outlinePage = pickOutlinePageForTocText(tocText);
  if (outlinePage) {
    await goToPdfPage(outlinePage, { scrollIntoView: false });
    return;
  }

  await goToPdfPage(1, { scrollIntoView: false });
}

function initPdfTocPanel() {
  const toc = document.querySelector('[data-role="pdf-toc"]');
  if (!toc) return;

  // Bind click handler: ToC entries navigate the inline PDF viewer
  toc.addEventListener('click', (e) => {
    const link = e.target.closest('a.toc-entry');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (!href.startsWith('#')) return;

    e.preventDefault();
    goToPdfFromToc(link);
  });
}

function initPdfNavButtons() {
  const prevBtn = document.getElementById('pdf-prev');
  const nextBtn = document.getElementById('pdf-next');
  const pageInput = document.getElementById('pdf-page-input');
  const zoomInBtn = document.getElementById('pdf-zoom-in');
  const zoomOutBtn = document.getElementById('pdf-zoom-out');

  if (prevBtn) prevBtn.addEventListener('click', () => {
    if (pdfState.currentPage > 1) goToPdfPage(pdfState.currentPage - 1, { scrollIntoView: false });
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    if (pdfState.currentPage < pdfState.numPages) goToPdfPage(pdfState.currentPage + 1, { scrollIntoView: false });
  });
  if (pageInput) {
    const commitPage = () => {
      const num = Number.parseInt(pageInput.value, 10);
      if (Number.isFinite(num) && num >= 1 && num <= pdfState.numPages) {
        goToPdfPage(num, { scrollIntoView: false });
      } else {
        pageInput.value = pdfState.currentPage;
      }
    };
    pageInput.addEventListener('change', commitPage);
    pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitPage(); } });
  }

  const ZOOM_STEP = 0.25;
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3.0;

  if (zoomInBtn) zoomInBtn.addEventListener('click', () => {
    pdfState.zoomLevel = Math.min(ZOOM_MAX, pdfState.zoomLevel + ZOOM_STEP);
    renderPdfPage(pdfState.currentPage);
  });
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => {
    pdfState.zoomLevel = Math.max(ZOOM_MIN, pdfState.zoomLevel - ZOOM_STEP);
    renderPdfPage(pdfState.currentPage);
  });
}

function initPdfViewer() {
  const { canvas, wrap, label, fallback } = getPdfElements();
  if (!canvas || !wrap || !label) return;

  if (!window.pdfjsLib) {
    label.textContent = 'PDF.js puuttuu';
    if (fallback) fallback.hidden = false;
    return;
  }

  try {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'assets/pdf.worker.min.js';
  } catch {
    // ignore
  }

  label.textContent = 'Ladataan PDF…';

  console.log('[PDF] Loading from:', PDF_URL);
  console.log('[PDF] pdfjsLib version:', window.pdfjsLib.version);

  const loadingTask = window.pdfjsLib.getDocument(PDF_URL);
  loadingTask.promise
    .then(async (doc) => {
      console.log('[PDF] loaded, pages:', doc.numPages);
      pdfState.pdfDoc = doc;
      pdfState.numPages = doc.numPages;
      await buildPdfOutlineIndex(doc);
      await renderPdfPage(1);

      if (pdfState.pendingNav?.pageNum) {
        const pending = pdfState.pendingNav.pageNum;
        pdfState.pendingNav = null;
        await renderPdfPage(pending);
      }
    })
    .catch((err) => {
      console.error('PDF load failed:', err);
      label.textContent = 'PDF:n lataus epäonnistui';
      if (fallback) fallback.hidden = false;
    });

  window.addEventListener(
    'resize',
    debounce(() => {
      if (!pdfState.pdfDoc) return;
      renderPdfPage(pdfState.currentPage);
    }, 150)
  );
}

/* ── Bootstrap ────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initDisclaimer();
  initPdfTocPanel();
  initPdfNavButtons();
  initPdfViewer();
  initFCFChart();
  initHistoricalPriceChart();
  initProbabilityGauges();
  wireControlInputs();
  initCollapsibles();
  updateAllDisplays();
  initScrollSpy();
});
