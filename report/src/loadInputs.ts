import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { fetchGa4Data } from './ga4Api/fetcher.js';

const baseBusinessContextSchema = z.object({
  industry: z.enum([
    'medical',
    'cosmetics',
    'ec-general',
    'saas',
    'media',
    'corporate',
    'other',
  ]),
  scale: z.enum(['individual', 'small', 'mid', 'large']),
  goals: z
    .array(z.enum(['sales', 'lead', 'recruit', 'awareness', 'other']))
    .min(1),
  targetAudience: z.string().min(1),
  focusNotes: z.string().min(1),
  siteUrl: z.url(),
  siteName: z.string().optional(),
  dataSource: z.enum(['sample', 'ga4-api']).default('sample'),
  ga4DataFile: z.string().optional(),
  propertyId: z.string().optional(),
  period: z
    .object({ start: z.string(), end: z.string() })
    .optional(),
});

const businessContextSchema = baseBusinessContextSchema.superRefine(
  (val, ctx) => {
    if (val.dataSource === 'sample') {
      if (!val.ga4DataFile) {
        ctx.addIssue({
          code: 'custom',
          message:
            'dataSource="sample" のとき ga4DataFile が必要です（例: "ga4-cosmetics-ec.json"）',
          path: ['ga4DataFile'],
        });
      }
    }
    if (val.dataSource === 'ga4-api') {
      if (!val.propertyId) {
        ctx.addIssue({
          code: 'custom',
          message:
            'dataSource="ga4-api" のとき propertyId が必要です（例: "properties/123456789"）',
          path: ['propertyId'],
        });
      }
      if (!val.period) {
        ctx.addIssue({
          code: 'custom',
          message:
            'dataSource="ga4-api" のとき period.start と period.end が必要です（YYYY-MM-DD）',
          path: ['period'],
        });
      }
      if (!val.siteName) {
        ctx.addIssue({
          code: 'custom',
          message:
            'dataSource="ga4-api" のとき siteName が必要です（レポートに表示するサイト名）',
          path: ['siteName'],
        });
      }
    }
  },
);

export type BusinessContext = z.infer<typeof businessContextSchema>;

export const ga4DataSchema = z.object({
  propertyId: z.string(),
  siteName: z.string(),
  period: z.object({ start: z.string(), end: z.string() }),
  summary: z.object({
    activeUsers: z.number(),
    newUsers: z.number(),
    sessions: z.number(),
    engagementRate: z.number(),
    averageSessionDuration: z.number(),
    screenPageViews: z.number(),
    conversions: z.number(),
    totalRevenue: z.number(),
  }),
  comparison: z.object({
    previousPeriod: z.object({ start: z.string(), end: z.string() }),
    summaryDeltas: z.object({
      activeUsers: z.number(),
      sessions: z.number(),
      conversions: z.number(),
      totalRevenue: z.number(),
    }),
  }),
  channels: z.array(
    z.object({
      name: z.string(),
      sessions: z.number(),
      conversions: z.number(),
    }),
  ),
  topPages: z.array(
    z.object({
      path: z.string(),
      views: z.number(),
      engagementRate: z.number(),
      bounceRate: z.number(),
    }),
  ),
  devices: z.array(
    z.object({ category: z.string(), sessions: z.number() }),
  ),
  geo: z.array(z.object({ country: z.string(), sessions: z.number() })),
  dailyTrend: z.array(
    z.object({
      date: z.string(),
      sessions: z.number(),
      activeUsers: z.number(),
      conversions: z.number(),
    }),
  ),
});

export type Ga4Data = z.infer<typeof ga4DataSchema>;

const projectRoot = resolve(import.meta.dirname, '..');

function readJson(absPath: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (e) {
    throw new Error(`ファイルの読み込みに失敗しました: ${absPath}\n${(e as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSONのパースに失敗しました: ${absPath}\n${(e as Error).message}`);
  }
}

export async function loadInputs(): Promise<{
  businessContext: BusinessContext;
  ga4Data: Ga4Data;
}> {
  const bcPath = resolve(projectRoot, 'data', 'business-context.json');
  const bcParsed = businessContextSchema.safeParse(readJson(bcPath));
  if (!bcParsed.success) {
    throw new Error(
      `business-context.json のバリデーションに失敗しました (${bcPath}):\n${bcParsed.error.message}`,
    );
  }
  const businessContext = bcParsed.data;

  let ga4Data: Ga4Data;
  if (businessContext.dataSource === 'sample') {
    const ga4Path = resolve(projectRoot, 'data', businessContext.ga4DataFile!);
    const ga4Parsed = ga4DataSchema.safeParse(readJson(ga4Path));
    if (!ga4Parsed.success) {
      throw new Error(
        `GA4データJSON のバリデーションに失敗しました (${ga4Path}):\n${ga4Parsed.error.message}`,
      );
    }
    ga4Data = ga4Parsed.data;
  } else {
    const fetched = await fetchGa4Data({
      propertyId: businessContext.propertyId!,
      siteName: businessContext.siteName!,
      start: businessContext.period!.start,
      end: businessContext.period!.end,
    });
    const ga4Parsed = ga4DataSchema.safeParse(fetched);
    if (!ga4Parsed.success) {
      throw new Error(
        `GA4 Data API から取得したデータのバリデーションに失敗しました:\n${ga4Parsed.error.message}`,
      );
    }
    ga4Data = ga4Parsed.data;
  }

  return { businessContext, ga4Data };
}
