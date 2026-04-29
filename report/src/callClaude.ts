import { reportSchema, type Report } from './reportSchema.js';
import { callViaAgentSdk, type TokenUsage } from './providers/agentSdk.js';
import { callViaAnthropicApi } from './providers/anthropicApi.js';

const MODEL = 'claude-sonnet-4-6';

export type ProviderName = 'agent-sdk' | 'api';

export function resolveProvider(): ProviderName {
  const raw = (process.env.CLAUDE_PROVIDER ?? 'agent-sdk').trim();
  if (raw === 'api') return 'api';
  if (raw === 'agent-sdk' || raw === '') return 'agent-sdk';
  throw new Error(
    `CLAUDE_PROVIDER の値が不正です: "${raw}" (期待値: "agent-sdk" または "api")`,
  );
}

type MetaOverride = {
  siteName: string;
  period: { start: string; end: string };
  promptVersion: string;
  industry: string;
};

export async function callClaude(args: {
  system: string;
  user: string;
  metaOverride: MetaOverride;
}): Promise<{ report: Report; usage: TokenUsage; provider: ProviderName }> {
  const provider = resolveProvider();
  const call = provider === 'api' ? callViaAnthropicApi : callViaAgentSdk;

  let systemForAttempt = args.system;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { text, usage } = await call({
      system: systemForAttempt,
      user: args.user,
      model: MODEL,
    });

    const cleaned = stripCodeFences(text).trim();

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleaned);
    } catch (e) {
      lastError = `JSON.parse 失敗: ${(e as Error).message}\n生テキスト先頭500文字:\n${cleaned.slice(0, 500)}`;
      systemForAttempt = `${args.system}\n\n---\n\n前回の出力は JSON として解釈できませんでした。次のエラーを修正し、Markdownコードフェンスや前後の説明を一切付けず、JSONオブジェクトのみを返してください:\n${lastError}`;
      continue;
    }

    // モデルが meta フィールドを誤った構造で返してくるケース（period を文字列にする等）
    // が散見されるため、ここで信頼できる値に強制上書きしてからバリデートする
    const withMetaInjected = injectMeta(parsedJson, args.metaOverride);

    const validated = reportSchema.safeParse(withMetaInjected);
    if (validated.success) {
      return { report: validated.data, usage, provider };
    }

    lastError = validated.error.message;
    systemForAttempt = `${args.system}\n\n---\n\n前回の出力はスキーマ違反でした。次のエラーを修正してJSONのみを返してください:\n${lastError}`;
  }

  throw new Error(
    `Claudeレスポンスが2回連続でバリデーション失敗しました。最後のエラー:\n${lastError ?? '(不明)'}`,
  );
}

function injectMeta(parsed: unknown, override: MetaOverride): unknown {
  if (typeof parsed !== 'object' || parsed === null) return parsed;
  const obj = parsed as Record<string, unknown>;
  const existingMeta =
    typeof obj.meta === 'object' && obj.meta !== null
      ? (obj.meta as Record<string, unknown>)
      : {};
  return {
    ...obj,
    meta: {
      // generatedAt はモデルの値があれば使い、無ければ現在時刻
      generatedAt:
        typeof existingMeta.generatedAt === 'string' && existingMeta.generatedAt
          ? existingMeta.generatedAt
          : new Date().toISOString(),
      ...existingMeta,
      // siteName / period / promptVersion / industry は信頼できる値で必ず上書き
      siteName: override.siteName,
      period: override.period,
      promptVersion: override.promptVersion,
      industry: override.industry,
    },
  };
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  // ```json ... ``` または ``` ... ``` を剥がす
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced && fenced[1] !== undefined) return fenced[1];
  return trimmed;
}

export const CLAUDE_MODEL = MODEL;
