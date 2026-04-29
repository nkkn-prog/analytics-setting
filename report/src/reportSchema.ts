import { z } from 'zod';

export const reportSchema = z.object({
  meta: z.object({
    siteName: z.string(),
    period: z.object({ start: z.string(), end: z.string() }),
    generatedAt: z.string(),
    promptVersion: z.string(),
    industry: z.string(),
  }),
  glossary: z.array(
    z.object({
      term: z.string(),
      plainExplanation: z.string(),
    }),
  ),
  currentState: z.object({
    headline: z.string(),
    metrics: z
      .array(
        z.object({
          label: z.string(),
          value: z.string(),
          change: z.string().nullable(),
          comment: z.string(),
        }),
      )
      .min(4)
      .max(8),
    highlights: z.array(z.string()),
  }),
  issues: z
    .array(
      z.object({
        title: z.string(),
        severity: z.enum(['high', 'mid', 'low']),
        evidence: z.object({
          dataPoint: z.string(),
          value: z.string(),
          period: z.string(),
        }),
        plainExplanation: z.string(),
      }),
    )
    .min(1),
  nextActions: z
    .array(
      z.object({
        title: z.string(),
        priority: z.number().int().min(1).max(5),
        expectedImpact: z.enum(['◎', '○', '△']),
        difficulty: z.enum(['低', '中', '高']),
        area: z.enum(['コンテンツ', 'UI', '集客', '分析', 'CRO']),
        description: z.string(),
        kpiToWatch: z.string(),
      }),
    )
    .min(3)
    .max(5),
  monthlyFocus: z.object({
    title: z.string(),
    why: z.string(),
    firstStep: z.string(),
  }),
  regulatoryNotes: z.array(z.string()).optional(),
});

export type Report = z.infer<typeof reportSchema>;
