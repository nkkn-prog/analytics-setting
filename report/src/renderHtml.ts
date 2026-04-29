import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Mustache from 'mustache';
import type { Report } from './reportSchema.js';
import type { Ga4Data } from './loadInputs.js';

const projectRoot = resolve(import.meta.dirname, '..');

export function renderHtml(args: {
  report: Report;
  ga4Data: Ga4Data;
  modelName: string;
}): string {
  const { report, ga4Data, modelName } = args;

  const templatePath = resolve(
    projectRoot,
    'src',
    'templates',
    'report.html.mustache',
  );
  const stylesPath = resolve(projectRoot, 'src', 'templates', 'styles.css');
  const template = readFileSync(templatePath, 'utf8');
  const stylesCss = readFileSync(stylesPath, 'utf8');

  const view = {
    meta: report.meta,
    currentState: {
      ...report.currentState,
      metrics: report.currentState.metrics.map((m) => ({
        ...m,
        changeClass: classifyChange(m.change),
      })),
    },
    issues: report.issues.map((i) => ({
      ...i,
      severityLabel: severityLabel(i.severity),
    })),
    nextActions: report.nextActions.map((a) => ({
      ...a,
      impactClass: impactClass(a.expectedImpact),
    })),
    monthlyFocus: report.monthlyFocus,
    glossary: report.glossary,
    hasGlossary: report.glossary.length > 0,
    regulatoryNotes: report.regulatoryNotes ?? [],
    hasRegulatory: !!report.regulatoryNotes && report.regulatoryNotes.length > 0,
    stylesCss,
    modelName,
    lineChartSvg: buildLineChartSvg(ga4Data),
    channelChartSvg: buildChannelBarSvg(ga4Data),
  };

  // Mustache.escape を上書きして、HTMLエスケープは {{ }} のデフォルト動作に任せる
  return Mustache.render(template, view);
}

function classifyChange(change: string | null): string {
  if (!change) return '';
  const trimmed = change.trim();
  if (trimmed.startsWith('-') || trimmed.startsWith('−')) return 'negative';
  if (trimmed.startsWith('+') || /^\d/.test(trimmed)) return 'positive';
  return '';
}

function severityLabel(s: 'high' | 'mid' | 'low'): string {
  switch (s) {
    case 'high':
      return '高';
    case 'mid':
      return '中';
    case 'low':
      return '低';
  }
}

function impactClass(impact: '◎' | '○' | '△'): string {
  switch (impact) {
    case '◎':
      return 'double-circle';
    case '○':
      return 'circle';
    case '△':
      return 'triangle';
  }
}

// ─────────────────────────────────────────────────────────────────────
// SVG: 日次セッション折れ線
// ─────────────────────────────────────────────────────────────────────

function buildLineChartSvg(ga4: Ga4Data): string {
  const W = 720;
  const H = 240;
  const PAD_L = 48;
  const PAD_R = 16;
  const PAD_T = 12;
  const PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const data = ga4.dailyTrend;
  if (data.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="#6b7280">データなし</text></svg>`;
  }

  const maxSessions = Math.max(...data.map((d) => d.sessions), 1);
  const yTicks = niceTicks(maxSessions, 4);
  const yMax = yTicks[yTicks.length - 1] ?? maxSessions;

  const xStep = data.length > 1 ? innerW / (data.length - 1) : 0;
  const points = data
    .map((d, i) => {
      const x = PAD_L + i * xStep;
      const y = PAD_T + innerH - (d.sessions / yMax) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const yGridLines = yTicks
    .map((tick) => {
      const y = PAD_T + innerH - (tick / yMax) * innerH;
      return `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
              <text x="${PAD_L - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#6b7280">${formatNumber(tick)}</text>`;
    })
    .join('\n');

  const labelStep = Math.max(1, Math.ceil(data.length / 6));
  const xLabels = data
    .map((d, i) => {
      if (i % labelStep !== 0 && i !== data.length - 1) return '';
      const x = PAD_L + i * xStep;
      const y = H - PAD_B + 14;
      const label = d.date.slice(5); // MM-DD
      return `<text x="${x.toFixed(1)}" y="${y}" text-anchor="middle" font-size="10" fill="#6b7280">${escapeXml(label)}</text>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    ${yGridLines}
    <polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="2"/>
    ${data
      .map((d, i) => {
        const x = PAD_L + i * xStep;
        const y = PAD_T + innerH - (d.sessions / yMax) * innerH;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#2563eb"/>`;
      })
      .join('\n')}
    ${xLabels}
  </svg>`;
}

function niceTicks(max: number, count: number): number[] {
  const step = niceStep(max / count);
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) {
    ticks.push(Math.round(v));
  }
  return ticks;
}

function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const exp = Math.floor(Math.log10(rough));
  const base = Math.pow(10, exp);
  const f = rough / base;
  if (f < 1.5) return base;
  if (f < 3) return 2 * base;
  if (f < 7) return 5 * base;
  return 10 * base;
}

// ─────────────────────────────────────────────────────────────────────
// SVG: チャネル別セッション横棒
// ─────────────────────────────────────────────────────────────────────

function buildChannelBarSvg(ga4: Ga4Data): string {
  const W = 720;
  const ROW_H = 30;
  const PAD_T = 8;
  const PAD_B = 8;
  const LABEL_W = 130;
  const VALUE_W = 130;
  const BAR_X = LABEL_W;
  const BAR_W_MAX = W - LABEL_W - VALUE_W - 10;

  const channels = ga4.channels;
  const total = channels.reduce((s, c) => s + c.sessions, 0);
  if (total === 0 || channels.length === 0) {
    return `<svg viewBox="0 0 ${W} 60" xmlns="http://www.w3.org/2000/svg"><text x="${W / 2}" y="30" text-anchor="middle" font-size="12" fill="#6b7280">データなし</text></svg>`;
  }

  const H = PAD_T + PAD_B + channels.length * ROW_H;
  const palette = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777'];

  const rows = channels
    .map((c, i) => {
      const y = PAD_T + i * ROW_H;
      const ratio = c.sessions / total;
      const barW = ratio * BAR_W_MAX;
      const color = palette[i % palette.length];
      const pct = (ratio * 100).toFixed(1);
      return `
        <text x="${LABEL_W - 8}" y="${y + ROW_H / 2 + 4}" text-anchor="end" font-size="11" fill="#1f2937">${escapeXml(c.name)}</text>
        <rect x="${BAR_X}" y="${y + 6}" width="${BAR_W_MAX}" height="${ROW_H - 12}" fill="#f3f4f6" rx="2"/>
        <rect x="${BAR_X}" y="${y + 6}" width="${barW.toFixed(1)}" height="${ROW_H - 12}" fill="${color}" rx="2"/>
        <text x="${BAR_X + BAR_W_MAX + 6}" y="${y + ROW_H / 2 + 4}" font-size="11" fill="#1f2937">${formatNumber(c.sessions)} (${pct}%)</text>
      `;
    })
    .join('\n');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    ${rows}
  </svg>`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('ja-JP');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
