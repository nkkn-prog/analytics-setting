import dayjs from 'dayjs';
import { getAccessToken } from './auth.js';

type Ga4Row = {
  dimensionValues?: Array<{ value?: string | null }>;
  metricValues?: Array<{ value?: string | null }>;
};

type RunReportResponse = {
  rows?: Ga4Row[];
};

type RunReportArgs = {
  propertyId: string;
  start: string;
  end: string;
  dimensions?: string[];
  metrics: string[];
  orderBy?: { metric?: string; dimension?: string; desc?: boolean };
  limit?: number;
};

async function runReport(
  token: string,
  args: RunReportArgs,
): Promise<RunReportResponse> {
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: args.start, endDate: args.end }],
    metrics: args.metrics.map((m) => ({ name: m })),
  };
  if (args.dimensions && args.dimensions.length > 0) {
    body.dimensions = args.dimensions.map((d) => ({ name: d }));
  }
  if (args.limit) body.limit = String(args.limit);
  if (args.orderBy) {
    body.orderBys = [
      {
        desc: !!args.orderBy.desc,
        ...(args.orderBy.metric
          ? { metric: { metricName: args.orderBy.metric } }
          : {}),
        ...(args.orderBy.dimension
          ? { dimension: { dimensionName: args.orderBy.dimension } }
          : {}),
      },
    ];
  }

  const url = `https://analyticsdata.googleapis.com/v1beta/${encodeURI(args.propertyId)}:runReport`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GA4 Data API error (${res.status} ${res.statusText}): ${text.slice(0, 1000)}`,
    );
  }
  return (await res.json()) as RunReportResponse;
}

function num(
  cell: { value?: string | null } | undefined,
  fn: (s: string) => number = (s) => parseInt(s, 10),
): number {
  const v = cell?.value;
  if (v == null || v === '') return 0;
  const n = fn(String(v));
  return Number.isFinite(n) ? n : 0;
}

function pct(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function dimVal(row: Ga4Row, i: number): string {
  return row.dimensionValues?.[i]?.value ?? '';
}

function metVal(row: Ga4Row, i: number, fn?: (s: string) => number): number {
  return num(row.metricValues?.[i], fn);
}

function delta(cur: number, prev: number): number {
  if (prev === 0) return 0;
  return Number(((cur - prev) / prev).toFixed(4));
}

function ymdToIso(yyyymmdd: string): string {
  if (/^\d{8}$/.test(yyyymmdd)) {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
  }
  return yyyymmdd;
}

export async function fetchGa4Data(args: {
  propertyId: string;
  siteName: string;
  start: string;
  end: string;
}): Promise<unknown> {
  const { propertyId, siteName, start, end } = args;
  const token = await getAccessToken();

  const startDay = dayjs(start);
  const endDay = dayjs(end);
  const days = endDay.diff(startDay, 'day') + 1;
  const prevEnd = startDay.subtract(1, 'day');
  const prevStart = prevEnd.subtract(days - 1, 'day');
  const prevStartStr = prevStart.format('YYYY-MM-DD');
  const prevEndStr = prevEnd.format('YYYY-MM-DD');

  const summaryMetrics = [
    'activeUsers',
    'newUsers',
    'sessions',
    'engagementRate',
    'averageSessionDuration',
    'screenPageViews',
    'conversions',
    'totalRevenue',
  ];

  const [
    summaryRes,
    prevSummaryRes,
    channelsRes,
    topPagesRes,
    devicesRes,
    geoRes,
    dailyTrendRes,
  ] = await Promise.all([
    runReport(token, { propertyId, start, end, metrics: summaryMetrics }),
    runReport(token, {
      propertyId,
      start: prevStartStr,
      end: prevEndStr,
      metrics: ['activeUsers', 'sessions', 'conversions', 'totalRevenue'],
    }),
    runReport(token, {
      propertyId,
      start,
      end,
      dimensions: ['sessionDefaultChannelGroup'],
      metrics: ['sessions', 'conversions'],
      orderBy: { metric: 'sessions', desc: true },
      limit: 8,
    }),
    runReport(token, {
      propertyId,
      start,
      end,
      dimensions: ['pagePath'],
      metrics: ['screenPageViews', 'engagementRate', 'bounceRate'],
      orderBy: { metric: 'screenPageViews', desc: true },
      limit: 12,
    }),
    runReport(token, {
      propertyId,
      start,
      end,
      dimensions: ['deviceCategory'],
      metrics: ['sessions'],
      orderBy: { metric: 'sessions', desc: true },
      limit: 5,
    }),
    runReport(token, {
      propertyId,
      start,
      end,
      dimensions: ['country'],
      metrics: ['sessions'],
      orderBy: { metric: 'sessions', desc: true },
      limit: 8,
    }),
    runReport(token, {
      propertyId,
      start,
      end,
      dimensions: ['date'],
      metrics: ['sessions', 'activeUsers', 'conversions'],
      orderBy: { dimension: 'date', desc: false },
      limit: 366,
    }),
  ]);

  const sumRow = summaryRes.rows?.[0] ?? {};
  const prevRow = prevSummaryRes.rows?.[0] ?? {};

  const summary = {
    activeUsers: metVal(sumRow, 0),
    newUsers: metVal(sumRow, 1),
    sessions: metVal(sumRow, 2),
    engagementRate: metVal(sumRow, 3, pct),
    averageSessionDuration: metVal(sumRow, 4, pct),
    screenPageViews: metVal(sumRow, 5),
    conversions: metVal(sumRow, 6, pct),
    totalRevenue: metVal(sumRow, 7, pct),
  };

  const prev = {
    activeUsers: metVal(prevRow, 0),
    sessions: metVal(prevRow, 1),
    conversions: metVal(prevRow, 2, pct),
    totalRevenue: metVal(prevRow, 3, pct),
  };

  const channels = (channelsRes.rows ?? [])
    .map((r) => ({
      name: dimVal(r, 0) || '(not set)',
      sessions: metVal(r, 0),
      conversions: metVal(r, 1, pct),
    }))
    .filter((c) => c.sessions > 0);

  const topPages = (topPagesRes.rows ?? [])
    .map((r) => ({
      path: dimVal(r, 0) || '(not set)',
      views: metVal(r, 0),
      engagementRate: metVal(r, 1, pct),
      bounceRate: metVal(r, 2, pct),
    }))
    .filter((p) => p.views > 0);

  const devices = (devicesRes.rows ?? [])
    .map((r) => ({
      category: dimVal(r, 0) || '(not set)',
      sessions: metVal(r, 0),
    }))
    .filter((d) => d.sessions > 0);

  const geo = (geoRes.rows ?? [])
    .map((r) => ({
      country: dimVal(r, 0) || '(not set)',
      sessions: metVal(r, 0),
    }))
    .filter((g) => g.sessions > 0);

  const dailyTrend = (dailyTrendRes.rows ?? [])
    .map((r) => ({
      date: ymdToIso(dimVal(r, 0)),
      sessions: metVal(r, 0),
      activeUsers: metVal(r, 1),
      conversions: metVal(r, 2, pct),
    }))
    .filter((d) => d.date.length === 10);

  return {
    propertyId,
    siteName,
    period: { start, end },
    summary,
    comparison: {
      previousPeriod: { start: prevStartStr, end: prevEndStr },
      summaryDeltas: {
        activeUsers: delta(summary.activeUsers, prev.activeUsers),
        sessions: delta(summary.sessions, prev.sessions),
        conversions: delta(summary.conversions, prev.conversions),
        totalRevenue: delta(summary.totalRevenue, prev.totalRevenue),
      },
    },
    channels,
    topPages,
    devices,
    geo,
    dailyTrend,
  };
}
