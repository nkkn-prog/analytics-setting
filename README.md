# analytics-setting

顧客サイトの計測環境（GA4 / GTM / Search Console）を一括セットアップする CLI ツール。

## セットアップ

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd analytics-setting
```

### 2. Python 仮想環境の作成

```bash
python3 -m venv .venv
source .venv/bin/activate   # Mac / Linux
# .venv\Scripts\activate    # Windows
```

### 3. パッケージのインストール

```bash
pip install -r requirements.txt
```

### 4. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集し、実際の値を設定する:

```dotenv
GA4_ACCOUNT_ID=390172368
GA4_TIMEZONE=Asia/Tokyo
GA4_CURRENCY_CODE=JPY
GTM_ACCOUNT_ID=6348599821
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
```

### 5. GCP の事前設定

- 4 つの API を有効化（Analytics Admin / Tag Manager / Search Console / Site Verification）
- OAuth 同意画面を設定し、テストユーザーを追加
- OAuth クライアント ID をデスクトップアプリとして作成
- GA4 でアカウントレベルの管理者権限を付与
- GTM でコンテナ作成・編集・公開権限を付与

詳細は [docs/setup-guide.md](docs/setup-guide.md) を参照。

## 使い方

### 一括実行

```bash
python setup_all.py \
    --client-name "田中クリニック" \
    --client-slug "tanaka-clinic" \
    --site-url "https://tanaka-clinic.com/" \
    --html-path "/path/to/website/"
```

初回実行時はブラウザが開き Google 認証を求められる。認証後 `token.json` が保存され、2 回目以降は自動。

### 引数一覧

| 引数 | 必須 | 説明 |
|------|------|------|
| `--client-name` | Yes | 顧客の表示名 |
| `--client-slug` | Yes | 顧客識別子（英数字・ハイフン） |
| `--site-url` | Yes | サイト URL（末尾 `/` 必須） |
| `--html-path` | No | GTM スニペット埋め込み先（ファイルまたはディレクトリ） |
| `--clarity-project-id` | No | Microsoft Clarity プロジェクト ID |
| `--verification-method` | No | Search Console 検証方式（デフォルト: `ANALYTICS`） |

### 各モジュール単体実行

```bash
python -m ga4.setup "田中クリニック" "https://tanaka-clinic.com/"
python -m gtm.setup "tanaka-clinic" "G-XXXXXXX"
python -m search_console.setup "https://tanaka-clinic.com/" TAG_MANAGER
```

## 処理フロー

```
Step 1: GA4 プロパティ・データストリーム作成 → Measurement ID 取得
Step 2: GTM コンテナ作成 → GA4 タグ設定 → バージョン公開 → GTM Public ID 取得
Step 3: GTM スニペットを HTML に埋め込み（--html-path 指定時）
Step 4: Search Console にサイト追加 → 所有権検証
```

各ステップで既存リソースを自動検出し、重複作成を防止する（冪等）。

## ディレクトリ構成

```
analytics-setting/
├── .env.example            # 環境変数テンプレート
├── .gitignore
├── README.md
├── requirements.txt        # Python パッケージ（バージョン固定）
├── auth.py                 # OAuth 認証（共通）
├── setup_all.py            # 一括実行エントリポイント
├── ga4/
│   └── setup.py            # GA4 プロパティ・データストリーム作成
├── gtm/
│   ├── setup.py            # GTM コンテナ・タグ作成・公開
│   └── embed.py            # GTM スニペット HTML 埋め込み
├── search_console/
│   └── setup.py            # Search Console 登録・検証
└── docs/
    ├── setup-guide.md      # 詳細セットアップガイド
    └── tips.md             # 構築で得られた知見・注意点
```

## ドキュメント

- [セットアップガイド](docs/setup-guide.md) - GCP 設定・環境変数・使い方・重複スキップ仕様・トラブルシューティング
- [Tips](docs/tips.md) - 認証・API・Python 環境の注意点
