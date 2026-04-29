import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { loadInputs } from './loadInputs.js';
import { buildPrompt, PROMPT_VERSION } from './buildPrompt.js';
import { callClaude, CLAUDE_MODEL, resolveProvider } from './callClaude.js';
import { renderHtml } from './renderHtml.js';

loadDotEnv();

const projectRoot = resolve(import.meta.dirname, '..');

async function main() {
  const startedAt = Date.now();

  const provider = resolveProvider();
  if (provider === 'agent-sdk' && process.env.ANTHROPIC_API_KEY) {
    console.warn(
      '[警告] CLAUDE_PROVIDER=agent-sdk ですが ANTHROPIC_API_KEY が設定されています。\n' +
        '       Claude Agent SDK は API キーが優先されるため、サブスクリプションではなく API キー課金で動作する可能性があります。\n' +
        '       サブスクリプション枠で動かしたい場合は .env から ANTHROPIC_API_KEY を外してください。',
    );
  }
  if (provider === 'api' && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'CLAUDE_PROVIDER=api では ANTHROPIC_API_KEY 環境変数が必須です。.env を確認してください。',
    );
  }

  const { ga4Data, businessContext } = await loadInputs();
  console.log(
    `[1/4] 入力データ読み込み完了: site="${ga4Data.siteName}" / industry=${businessContext.industry} / period=${ga4Data.period.start}〜${ga4Data.period.end}`,
  );

  const prompt = buildPrompt({ ga4Data, businessContext });
  console.log(
    `[2/4] プロンプト構築完了: promptVersion=${prompt.promptVersion} / system=${prompt.system.length}chars / user=${prompt.user.length}chars`,
  );

  console.log(`[3/4] Claude 呼び出し開始 (provider=${provider}, model=${CLAUDE_MODEL})...`);
  const { report, usage } = await callClaude({
    system: prompt.system,
    user: prompt.user,
    metaOverride: {
      siteName: ga4Data.siteName,
      period: ga4Data.period,
      promptVersion: PROMPT_VERSION,
      industry: businessContext.industry,
    },
  });
  console.log(
    `        完了 (input=${usage.input}tok / output=${usage.output}tok / costUSD=${usage.totalCostUsd.toFixed(4)})`,
  );

  const html = renderHtml({
    report,
    ga4Data,
    modelName: CLAUDE_MODEL,
  });

  const slug = slugify(ga4Data.siteName);
  const filename = `report-${slug}-${ga4Data.period.start}_${ga4Data.period.end}.html`;
  const outPath = resolve(projectRoot, 'output', filename);
  writeFileSync(outPath, html, 'utf8');

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[4/4] HTML出力完了: ${outPath}`);
  console.log(`        所要時間: ${elapsed}s`);
}

function slugify(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'site';
}

main().catch((err) => {
  console.error('[ERROR]', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
