# kajiba GA4レポート生成プロトタイプ 実装計画

## Context（なぜ作るか）

`docs/ga4-report-prototype-prompt.md` の仕様に従い、`analytics-setting/export_report/` 配下に **TypeScript + tsx で動くスタンドアロンスクリプト** を新規構築する。

- **目的**: 固定のGA4データJSON + ビジネス文脈JSON を入力に、Claude が「現状 / 課題 / 推奨ネクストアクション」のHTMLレポートを生成する PoC
- **検証対象**: プロンプト品質と出力レイアウト（業種別の出し分け、規制配慮、ハルシネーション抑止、A4印刷崩れ）
- **後続フェーズ**: kajiba本体（Next.js + Prisma + OAuth + 月次Cron）への移植を意識し、`reportSchema.ts` / `prompts/` / GA4データ正規化形 / HTMLテンプレート構造をそのまま流用できる粒度で書く
- **既存リポジトリとの関係**: 親ディレクトリ `analytics-setting/` は Python製のGA4/GTM一括セットアップCLI。今回の `export_report/` はそれとは独立したTypeScriptプロジェクト。

---

## 確定済みの設計判断

### Claude 呼び出し方式（重要 — 仕様書から修正）

仕様書 §6.3 では Anthropic API SDK + `temperature: 0.3` + `max_tokens: 8000` 想定だが、**ユーザー要望によりサブスクリプション枠優先**に変更する。

- **主経路**: `@anthropic-ai/claude-agent-sdk` の `query()` を使い、ローカルマシンの `claude` CLI ログイン情報（Claude Pro / Max）を引き継ぐ
  - `ANTHROPIC_API_KEY` を **設定しない** ことでサブスクリプション認証が選ばれる挙動を利用
  - `query()` に `settingSources: []`、`allowedTools: []`、`maxTurns: 1`、`permissionMode: 'bypassPermissions'` を渡し、**ツールなし・1ターンの単発Q&A** として使う
  - `systemPrompt`（文字列）に `system.md` + 規制配慮 md を結合した内容を渡す（CLAUDE.md は読み込ませない）
  - 出典: https://code.claude.com/docs/en/agent-sdk/typescript
- **代替経路**: `CLAUDE_PROVIDER=api` 環境変数で `@anthropic-ai/sdk` 経由のAPI呼び出しに切り替え可能。本実装ではAPI経路もスケルトン実装しておく（小さな関数1つ程度）。
- **モデル**: `claude-sonnet-4-6`

### 仕様書からの差分（要承認）

仕様書 §6.3 と異なる点:

1. **`temperature` 指定不可**: Agent SDK では sampling parameter を直接渡せない。代わりに `effort: 'low'` を指定し、システムプロンプト側で「同じ入力には同じ構造で答える」「再現性重視」と強く明示することで再現性を担保する。
2. **`max_tokens` 指定不可**: Agent SDK では output token cap が直接指定できない。レポートJSONは数KB程度なので、デフォルトで足りる想定。万一切れる場合は Agent SDK 側の `effort` / `thinking` 調整で対応。
3. **再試行**: Agent SDK でも JSON.parse + Zod safeParse で失敗時に1回だけ再投入する仕組みは実装可能。再投入時は systemPrompt 末尾にエラー詳細を追記する。

API SDK 経路（fallback）では `temperature: 0.3` / `max_tokens: 8000` を仕様書通り指定する。

### 計画書の最終配置

本Plan Mode承認後、本ファイルの内容を `export_report/docs/implementation-plan.md` へコピーする。

---

## ディレクトリ構成（新規作成）

```
export_report/
├── package.json                   # "type": "module"
├── tsconfig.json                  # strict, ES2022, ESNext, moduleResolution: Bundler
├── .env.example                   # CLAUDE_PROVIDER=agent-sdk | api / ANTHROPIC_API_KEY=...
├── .gitignore                     # .env, node_modules/, output/*.html
├── README.md
├── docs/
│   └── implementation-plan.md     # 本計画書のコピー（承認後）
├── data/
│   ├── ga4-cosmetics-ec.json
│   ├── ga4-medical-clinic.json
│   ├── ga4-saas.json
│   └── business-context.json
├── prompts/
│   ├── system.md
│   └── regulatory/
│       ├── medical.md
│       ├── cosmetics.md
│       └── ec-general.md
├── src/
│   ├── index.ts                   # エントリポイント
│   ├── loadInputs.ts              # JSON読込 + Zod簡易バリデーション
│   ├── buildPrompt.ts             # system.md + 業種別regulatory連結
│   ├── callClaude.ts              # provider切替 + 1回再試行
│   ├── providers/
│   │   ├── agentSdk.ts            # 主経路（Claude Agent SDK / サブスクリプション）
│   │   └── anthropicApi.ts        # 代替経路（API SDK）
│   ├── reportSchema.ts            # Zod出力スキーマ
│   ├── renderHtml.ts              # mustache展開 + SVGグラフ生成
│   └── templates/
│       ├── report.html.mustache
│       └── styles.css
└── output/
    └── .gitkeep
```

---

## ファイル別実装メモ

### `src/reportSchema.ts`
仕様書 §5 のZodスキーマを **そのまま採用**。`Report` 型は `z.infer` で導出。後続Next.jsで再利用するため副作用やNode依存を持ち込まない。

### `src/loadInputs.ts`
- `data/business-context.json` → `BusinessContextSchema`（industry/scale/goals/targetAudience/focusNotes/siteUrl/ga4DataFile）
- `business-context.ga4DataFile` 名で `data/ga4-*.json` を読み込み → `Ga4DataSchema`（propertyId/siteName/period/summary/comparison/channels/topPages/devices/geo/dailyTrend）
- 失敗時はパス + Zodエラーを含む明確なメッセージで `process.exit(1)`

### `src/buildPrompt.ts`
- `prompts/system.md` を読み込み
- `industry` 値が `prompts/regulatory/{industry}.md` に存在すれば末尾結合、なければ `ec-general.md`（fallback）
- 戻り値: `{ system: string, user: string, promptVersion: 'v0.1.0' }`
- `user` は `JSON.stringify({ ga4Data, businessContext })` を整形して文字列化

### `src/providers/agentSdk.ts`（主経路）

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

export async function callViaAgentSdk(args: {
  system: string;
  user: string;
  model: string;
}): Promise<{ text: string; usage: TokenUsage }> {
  const response = query({
    prompt: args.user,
    options: {
      model: args.model,                      // 'claude-sonnet-4-6'
      systemPrompt: args.system,              // 文字列直渡し
      settingSources: [],                     // CLAUDE.md など読み込ませない
      allowedTools: [],                       // ツール無し
      maxTurns: 1,                            // 単発
      permissionMode: 'bypassPermissions',
      effort: 'low',                          // 再現性重視（temperature代替）
    },
  });

  let text = '';
  let usage: TokenUsage | undefined;
  for await (const m of response) {
    if (m.type === 'assistant') {
      text = m.message.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
    }
    if (m.type === 'result' && m.subtype === 'success') {
      usage = {
        input: m.usage.input_tokens,
        output: m.usage.output_tokens,
        totalCostUsd: m.total_cost_usd,
      };
    }
  }
  if (!text) throw new Error('Agent SDK returned no assistant text');
  return { text, usage: usage ?? { input: 0, output: 0, totalCostUsd: 0 } };
}
```

`ANTHROPIC_API_KEY` が未設定であれば SDK 内蔵の Claude Code バイナリが `~/.claude/` の認証情報を読みに行き、サブスクリプションで動く。設定されていれば API キー課金になるため、サブスクリプション優先で動かしたい場合は **`.env` に `ANTHROPIC_API_KEY` を書かない** こと。README にも明記する。

### `src/providers/anthropicApi.ts`（代替経路）

```typescript
import Anthropic from '@anthropic-ai/sdk';

export async function callViaAnthropicApi(args: {
  system: string;
  user: string;
  model: string;
}): Promise<{ text: string; usage: TokenUsage }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: args.model,
    max_tokens: 8000,
    temperature: 0.3,
    system: args.system,
    messages: [{ role: 'user', content: args.user }],
  });
  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  return {
    text,
    usage: {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      totalCostUsd: 0,
    },
  };
}
```

### `src/callClaude.ts`

```
async function callClaude({ system, user, promptVersion }) -> { report, usage }
  provider = process.env.CLAUDE_PROVIDER ?? 'agent-sdk'   // デフォルトは Agent SDK = サブスクリプション
  call = provider === 'api' ? callViaAnthropicApi : callViaAgentSdk

  for attempt in [1, 2]:
    { text, usage } = await call({ system: systemForAttempt, user, model: 'claude-sonnet-4-6' })
    cleaned = stripCodeFences(text)
    parsed = JSON.parse(cleaned)
    result = reportSchema.safeParse(parsed)
    if result.success: return { report: result.data, usage }
    systemForAttempt = system + `\n\n前回の出力はスキーマ違反でした。次のエラーを修正してJSONのみを返してください: ${result.error.message}`

  throw new Error('Schema validation failed twice')
```

### `src/renderHtml.ts`
- `mustache.render(templateString, context)`
- `styles.css` を `<style>` インライン化
- SVGグラフ2種を文字列ビルダーで生成し、テンプレートに `{{{lineChartSvg}}}` `{{{channelChartSvg}}}` で渡す
  - 折れ線: `dailyTrend[*].sessions` を viewBox 内で正規化、X=日付ラベル間引き、Y=最大値ベース
  - チャネル: `channels[*].sessions` を横棒（割合 = sessions / sum）。数値ラベルが乗せやすい
- `@media print` で `body { font-size: 11pt }`、カード分断回避（`break-inside: avoid`）

### `src/templates/report.html.mustache`
セクション順序（§6.5 準拠）:
1. ヘッダー（任意）
2. 現状サマリ（headline + KPIカード4〜6 + 折れ線SVG）
3. 良い点（highlights）
4. 課題（issues — severity別バッジ色: high=red, mid=orange, low=gray）
5. 推奨ネクストアクション（priority昇順、`expectedImpact`/`difficulty`/`area` バッジ）
6. 今月のフォーカス
7. 用語解説（任意）
8. 規制配慮メモ（`{{#regulatoryNotes.length}}` で出し分け）
9. フッター（モデル名 / promptVersion / AI生成注記）

### `src/index.ts`
```
1. dotenv.config()
   - provider = process.env.CLAUDE_PROVIDER ?? 'agent-sdk'
   - provider === 'api' のとき ANTHROPIC_API_KEY 必須チェック
   - provider === 'agent-sdk' のときは ANTHROPIC_API_KEY が「設定されていたら警告」（サブスクリプションのつもりがAPI課金になるのを防ぐ）
2. const { ga4Data, businessContext } = loadInputs()
3. const prompt = buildPrompt(ga4Data, businessContext)
4. const t0 = Date.now(); const { report, usage } = await callClaude(prompt)
5. const html = renderHtml(report, { ga4Data, businessContext })
6. const slug = slugify(ga4Data.siteName); const filename = `report-${slug}-${period.start}_${period.end}.html`
7. fs.writeFileSync(`output/${filename}`, html)
8. console.log(出力パス, 経過時間, usage.input/output, totalCostUsd, provider)
```

### プロンプト本体（`prompts/system.md`）
仕様書 §4.1 の8つの要件を漏れなく反映:
- 役割定義（中小企業経営者・マーケ初心者にも分かる言葉）
- 日本語・ですます調
- 入力JSONの値のみ使用（推測・架空値禁止）
- `glossary` 登録語のみ本文使用
- 提言は具体パス/チャネル/指標値とセット
- データ不足時は「判断に必要なデータが不足しています」と明記
- 出力は厳密なJSON（コードフェンス・前後説明禁止）
- 8セクション構成を必須化
- **再現性確保**: 「同じ入力には同じ構造・同じ評価軸で回答する」と明記（temperature指定不可の代替）

### `prompts/regulatory/{medical,cosmetics,ec-general}.md`
仕様書 §4.2〜§4.4 の禁止事項リストをそのまま箇条書きで起こす。

---

## サンプルデータ作成方針

仕様書 §3.1 の傾向を反映:
- **cosmetics-ec**: モバイル比率 ≥70%、Paid Search が conversion の主体、`comparison.summaryDeltas.conversions` が負（-0.18 程度）
- **medical-clinic**: Organic Search 主体、`geo` は日本のみ、conversions は予約フォーム想定で月数十件規模
- **saas**: Direct + Paid Search、`/pricing` `/docs` `/blog/*` がtopPages、PC比率 ≥60%

各ファイルとも `dailyTrend` は対象期間（例: 2026-03-01〜2026-03-31）を全日埋める。

---

## 実装順序（仕様書 §7 準拠 / E2E早期通過を優先）

1. `package.json` / `tsconfig.json` / `.env.example` / `.gitignore` / `README.md` 雛形
2. `data/business-context.json` + `data/ga4-cosmetics-ec.json` のサンプル1組
3. `src/reportSchema.ts`
4. `src/loadInputs.ts`
5. `prompts/system.md` 初版 + `prompts/regulatory/cosmetics.md` 初版
6. `src/buildPrompt.ts`
7. `src/providers/agentSdk.ts` + `src/providers/anthropicApi.ts`
8. `src/callClaude.ts`（provider切替 + 1回再試行）
9. `src/templates/report.html.mustache` + `styles.css`
10. `src/renderHtml.ts`
11. `src/index.ts`（E2E結合 — ここで初めて `npx tsx src/index.ts` が通る）
12. 残2サンプル（medical-clinic / saas）+ `regulatory/medical.md` `regulatory/ec-general.md`
13. 3パターン生成 → 出力比較 → プロンプト改善ループ

各ステップ完了時に `npx tsx src/index.ts` が動く状態を維持。

---

## 依存パッケージ

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.111-or-later",
    "@anthropic-ai/sdk": "^0.x",
    "zod": "^3.x",
    "mustache": "^4.x",
    "dayjs": "^1.x",
    "dotenv": "^16.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "@types/node": "^20.x",
    "@types/mustache": "^4.x"
  }
}
```

`scripts`: `"start": "tsx src/index.ts"`、`"typecheck": "tsc --noEmit"`

注: `@anthropic-ai/claude-agent-sdk` は ネイティブ `claude` バイナリを optional dependency として同梱するため、別途のClaude Code CLIインストールは不要（ただしサブスクリプションを使うには事前に `claude` で `/login` してサブスクリプションログインしておく必要あり）。

---

## 検証（Acceptance Criteria — 仕様書 §8）

実装完了の判定は次の全項目を満たすこと:

- [ ] **構文チェック**: `npx tsc --noEmit` が通る
- [ ] **E2E実行（サブスクリプション）**: `ANTHROPIC_API_KEY` 未設定 + `claude` CLI ログイン済の状態で `npx tsx src/index.ts` が3パターン全てで90秒以内に完了し、`output/*.html` が生成される
- [ ] **E2E実行（API）**: `CLAUDE_PROVIDER=api` + `ANTHROPIC_API_KEY=...` でも同じ条件で動く
- [ ] **ハルシネーションなし**: 出力本文に入力JSONに無い数値・サイト名・ページパスが出ない（目視確認 + サンプルキー値のgrep）
- [ ] **再現性**: 同入力で2回連続実行し、`issues` 上位2件・`nextActions` 上位2件が概ね一致
- [ ] **専門用語**: `glossary` 未登録語（直帰率・エンゲージメント率・CTR・CVR等）が本文に剥き出しで出ない
- [ ] **HTML単独表示**: 生成HTMLをブラウザで直接開いてレイアウト崩れなし
- [ ] **A4印刷**: ブラウザの「PDFとして保存」(A4縦) で崩れなし
- [ ] **Zod通過**: 全実行で `reportSchema.safeParse` が success（再試行0回 or 1回で成功）
- [ ] **規制配慮**: `industry: medical` で出力に医療広告ガイドライン由来の `regulatoryNotes` が出る／`cosmetics` で薬機法系の注意が出る
- [ ] **エラー系**:
  - `CLAUDE_PROVIDER=api` で `ANTHROPIC_API_KEY` 未設定 → 明確なエラー終了
  - `ga4DataFile` を存在しないファイル名にして実行 → 明確なエラー終了
  - `CLAUDE_PROVIDER=agent-sdk` で `ANTHROPIC_API_KEY` が設定されている → 警告ログ（サブスクリプションのつもりが API 課金になる事故防止）

---

## スコープ外（混入させない）

仕様書 §9 を遵守: GA4 Data API実取得 / OAuth / DB / Next.js / Cron / 質問UI / 期間比較 / マルチユーザー / PDF直接出力。

---

## Plan Mode 完了後のアクション

1. 本ファイル内容を `export_report/docs/implementation-plan.md` にコピー
2. 上記「実装順序」のステップ1から着手
