# kajiba GA4 レポート生成プロトタイプ

固定の GA4 データ JSON とビジネス文脈 JSON を入力に、Claude が「現状 / 課題 / 推奨ネクストアクション」をまとめた HTML レポートを 1 ファイルとして出力するスタンドアロンスクリプトです。

このプロトタイプの目的はプロンプト品質と出力レイアウトの検証であり、後続フェーズで kajiba 本体（Next.js + Prisma + OAuth + 月次 Cron）にロジックを移植する前提で設計しています。

詳細は [docs/implementation-plan.md](docs/implementation-plan.md) を参照。

---

## セットアップ

```bash
npm install
cp .env.example .env
```

### Claude 呼び出しプロバイダ

本ツールは Claude を 2 経路で呼び出せます。`.env` の `CLAUDE_PROVIDER` で切り替えます。

#### 1. `agent-sdk`（推奨 / サブスクリプション課金）

- 事前に `claude` CLI でログインしておく（Claude Pro / Max のサブスクリプションが必要）
- `.env` の `ANTHROPIC_API_KEY` は **コメントアウトしたままにする**
- API キーが設定されていると Agent SDK は API キー課金にフォールバックするため、サブスクリプションで動かしたい場合は必ず未設定にしておくこと

```bash
# 事前に1回だけ
claude /login
```

#### 2. `api`（API キー課金）

- `.env` で `CLAUDE_PROVIDER=api`、`ANTHROPIC_API_KEY=sk-ant-...` を設定

---

## 実行

```bash
npm start
# または
npx tsx src/index.ts
```

## データソース

`data/business-context.json` の `dataSource` フィールドで切り替えます。

### サンプルデータを使う（`dataSource: "sample"` / デフォルト）

```json
{
  "dataSource": "sample",
  "ga4DataFile": "ga4-cosmetics-ec.json"
}
```

選択肢: `ga4-cosmetics-ec.json` / `ga4-medical-clinic.json` / `ga4-saas.json`

### GA4 Data API から実データを取得する（`dataSource: "ga4-api"`）

```json
{
  "dataSource": "ga4-api",
  "propertyId": "properties/123456789",
  "siteName": "サイト名（レポート表示用）",
  "period": { "start": "2026-03-01", "end": "2026-03-31" }
}
```

#### 初回セットアップ手順

1. **GCP プロジェクトで Data API を有効化**

   GCP Console（[https://console.cloud.google.com/](https://console.cloud.google.com/)）で任意のプロジェクトを選択し、「APIとサービス → ライブラリ」から **Google Analytics Data API** を有効化。

2. **OAuth クライアント ID を作成**

   「APIとサービス → 認証情報 → OAuth クライアント ID を作成」で **アプリケーションの種類: デスクトップアプリ** を選んで作成。発行された Client ID と Client Secret を `.env` に貼り付ける。

   ```bash
   GA4_OAUTH_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GA4_OAUTH_CLIENT_SECRET=GOCSPX-xxxxxxxx
   ```

3. **OAuth ログイン**

   ```bash
   npm run ga4:login
   ```

   ブラウザが開くので、対象 GA4 プロパティへの読み取り権限を持つ Google アカウントでログインして同意します。リフレッシュトークンが `.cache/ga4-token.json` に保存され、以降は自動的に再ログインなしでデータ取得できます。

4. **対象プロパティ ID を確認**

   GA4 管理画面 → プロパティ設定 → プロパティの詳細 で確認できる数字（例: `123456789`）を `business-context.json` の `propertyId` に `properties/123456789` の形式で書きます。

5. **実行**

   ```bash
   npm start
   ```

   GA4 Data API から `summary` / `comparison`（前期比は自動算出）/ `channels` / `topPages` / `devices` / `geo` / `dailyTrend` を取得し、サンプル時と同じ形式の `Ga4Data` に正規化したうえで Claude へ渡します。

---

## 出力

`output/report-{siteName-slug}-{period.start}_{period.end}.html` に単一の HTML ファイルが出力されます。

- 外部 CDN・外部リソース参照は持たないため、ファイル単独でブラウザ表示・配布が可能
- ブラウザの「PDF として保存」（A4 縦）でそのまま PDF 化できる
- レイアウトは `@media print` で印刷崩れを抑止

---

## ディレクトリ

```
export_report/
├── data/                          # 入力データ（GA4 / business-context）
├── prompts/                       # システムプロンプト + 業種別規制配慮
│   ├── system.md
│   └── regulatory/{medical,cosmetics,ec-general}.md
├── src/
│   ├── index.ts                   # エントリポイント
│   ├── loadInputs.ts              # JSON 読み込み + Zod バリデーション
│   ├── buildPrompt.ts             # system + regulatory 連結
│   ├── callClaude.ts              # provider 切替 + 1 回再試行
│   ├── providers/{agentSdk,anthropicApi}.ts
│   ├── reportSchema.ts            # Zod 出力スキーマ
│   ├── renderHtml.ts              # mustache + SVG グラフ
│   └── templates/{report.html.mustache,styles.css}
└── output/                        # 生成 HTML（gitignore）
```

---

## 想定する次フェーズ

本プロトタイプの以下の資産は kajiba 本体（Next.js）にそのまま移植可能なように設計しています:

- `src/reportSchema.ts` — Next.js サーバーアクションでの入力バリデーション
- `prompts/*.md` — 配置場所のみ変更
- `data/ga4-*.json` の構造 — GA4 Data API ラッパが返す正規化済みオブジェクトの型仕様
- HTML テンプレート — そのまま React コンポーネントに置換可能

依存ライブラリは Next.js でも使えるものに揃え、Node 固有 API の使用は最小限に保っています。

---

## スコープ外（本プロトタイプでは実装しない）

- データベース（Prisma 等）
- Next.js / Web サーバー / マイページ UI
- 月次自動生成の Cron ジョブ
- 質問 UI / 期間比較 / マルチユーザー対応
- PDF ダイレクト出力（ブラウザ印刷経由で十分）
