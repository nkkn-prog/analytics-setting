# サイト計測 一括セットアップガイド

GA4 プロパティ作成 → GTM コンテナ作成 → Search Console 登録を一気通貫で実行するスクリプトの仕様と使い方。

---

## 全体フロー

```
setup_all.py
│
├── Step 1: GA4 Admin API
│   ├── プロパティ作成（既存あればスキップ）
│   ├── Web データストリーム作成 → Measurement ID (G-XXXXXXX) 取得
│   ├── カスタムディメンション登録（--config 指定時、既存あればスキップ）
│   └── コンバージョン登録（--config 指定時、既存あればスキップ）
│
├── Step 2: GTM API
│   ├── コンテナ作成（既存あればスキップ）
│   ├── GA4 設定タグ作成（既存あればスキップ）
│   ├── カスタムタグ（preset 駆動・任意、既存あればスキップ）
│   │   ├── ga4_event    … GA4 イベントタグ + 必要なトリガーを生成
│   │   └── custom_html  … 任意の HTML スニペット
│   └── バージョン公開（新規タグがある場合のみ）
│       → GTM Public ID (GTM-XXXXXXX) 取得
│
├── Step 3: GTM スニペット表示
│   └── <head> / <body> 用スニペットを出力
│       ※ 本番では HTML への自動埋め込みに切替可能
│
└── Step 4: Search Console API + Site Verification API
    ├── サイト追加
    └── 所有権検証（ANALYTICS 方式）
        ※ サイトに GTM スニペットがデプロイ済みであること
```

---

## 1. 前提条件

### GCP API の有効化

以下の 4 つを有効化する。GCP Console →「APIとサービス」→「ライブラリ」。

| API 名 | 用途 |
|--------|------|
| Google Analytics Admin API | GA4 プロパティ・データストリーム作成 |
| Tag Manager API | GTM コンテナ・タグ管理・バージョン公開 |
| Search Console API | サイト追加 |
| Google Site Verification API | サイト所有権の検証 |

```bash
gcloud services enable analyticsadmin.googleapis.com
gcloud services enable tagmanager.googleapis.com
gcloud services enable searchconsole.googleapis.com
gcloud services enable siteverification.googleapis.com
```

### OAuth 同意画面の設定

1. GCP Console →「APIとサービス」→「OAuth 同意画面」
2. User Type: **外部** または **内部**
3. アプリ名・サポートメール・デベロッパー連絡先を入力
4. スコープを追加:

| スコープ | 説明 |
|---------|------|
| `analytics.edit` | GA4 プロパティ編集 |
| `tagmanager.edit.containers` | GTM コンテナ編集 |
| `tagmanager.edit.containerversions` | GTM バージョン作成 |
| `tagmanager.publish` | GTM バージョン公開 |
| `webmasters` | Search Console サイト管理 |
| `siteverification` | サイト所有権検証 |

5. テストユーザーにスクリプトを実行する Google アカウントを追加

### OAuth クライアント ID の作成

1. GCP Console →「APIとサービス」→「認証情報」
2. 「認証情報を作成」→「OAuth クライアント ID」
3. アプリケーションの種類: **デスクトップアプリ**
4. クライアント ID / シークレットを `.env` に記入

### 各サービス側の権限設定

| サービス | 必要な権限 | 設定場所 |
|---------|-----------|---------|
| GA4 | **アカウントレベルの管理者** | GA4 管理画面 → アカウントのアクセス管理 |
| GTM | **コンテナ作成・編集・公開** | GTM 管理画面 → ユーザー管理 |
| Search Console | GA4/GTM の権限があれば追加設定不要 | — |

---

## 2. 環境変数 (.env)

```dotenv
# === GA4 Settings ===
GA4_ACCOUNT_ID=390172368
GA4_TIMEZONE=Asia/Tokyo
GA4_CURRENCY_CODE=JPY

# === GTM Settings ===
GTM_ACCOUNT_ID=6348599821

# === Google Cloud OAuth ===
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
```

> `.env`, `credentials.json`, `token.json` は `.gitignore` に含まれている。

---

## 3. ディレクトリ構成

```
ga/
├── .env                        # 環境変数
├── .gitignore
├── requirements.txt
├── auth.py                     # OAuth 認証（共通）
├── setup_all.py                # 一括実行エントリポイント
├── ga4/
│   ├── __init__.py
│   └── setup.py                # GA4 プロパティ・データストリーム作成
├── gtm/
│   ├── __init__.py
│   ├── setup.py                # GTM コンテナ・タグ作成・公開
│   └── embed.py                # GTM スニペット HTML 埋め込み
├── search_console/
│   ├── __init__.py
│   └── setup.py                # Search Console 登録・検証
└── docs/
    └── setup-guide.md          # このドキュメント
```

---

## 4. 使い方

### インストール

```bash
cd ga/
pip install -r requirements.txt
```

### 一括実行

```bash
python setup_all.py \
    --client-name "田中クリニック" \
    --client-slug "tanaka-clinic" \
    --site-url "https://tanaka-clinic.com/" \
    --config clients/tanaka-clinic/tags.yaml   # 任意（カスタムタグ）
```

案件ごとのカスタムタグは CLI 引数では破綻するため、`--config` で YAML を渡す形に統一する。

初回実行時はブラウザが開き Google 認証を求められる。認証後 `token.json` が保存され、2回目以降は自動。

### 引数一覧

| 引数 | 必須 | 説明 | 例 |
|------|------|------|-----|
| `--client-name` | Yes | 顧客の表示名 | `田中クリニック` |
| `--client-slug` | Yes | 顧客識別子（英数字・ハイフン） | `tanaka-clinic` |
| `--site-url` | Yes | サイト URL（末尾 `/` 必須） | `https://tanaka-clinic.com/` |
| `--config` | No | クライアント固有のカスタムタグ等を定義する YAML | `clients/tanaka-clinic/tags.yaml` |
| `--verification-method` | No | Search Console 検証方式（デフォルト: `ANALYTICS`） | `ANALYTICS` / `TAG_MANAGER` |

### 設定ファイル（`--config`）

クライアント固有の計測仕様（GA4 カスタムイベント・コンバージョン・カスタムディメンション）を
YAML 1本で宣言する。実行時に GA4 管理画面 + GTM の両方を一気通貫で自動セットアップする。

```yaml
# clients/tanaka-clinic/tags.yaml
ga4:
  custom_events:
    - name: form_submit_clinic
      trigger: form_submit         # 全フォーム送信で発火
      mark_as_conversion: true     # GA4 側で「主要なイベント」に昇格
    - name: page_view_thanks
      trigger: page_view
      mark_as_conversion: true
  custom_dimensions:
    - parameter_name: line_friend_id
      display_name: LINE Friend ID
      scope: EVENT                 # EVENT / USER / ITEM

# preset 直書きも可能（preset に該当しない案件特有スニペット用）
# custom_tags:
#   - preset: custom_html
#     name: "..."
#     html: |
#       <script>...</script>
```

`ga4.custom_events[]` の各イベントは内部で `ga4_event` preset に変換され、GTM 側に
「GA4 イベントタグ + 必要なトリガー」が冪等に生成される。`mark_as_conversion: true`
のものは GA4 Admin API でコンバージョン登録される。

#### preset 一覧

| preset | 用途 | 必須フィールド | 対応トリガー |
|--------|------|--------------|------------|
| `ga4_event` | GA4 イベントタグ + 必要なトリガー | `name`, `trigger` | `form_submit` / `page_view` |
| `custom_html` | 任意の HTML スニペット | `name`, `html` | `all_pages` |

クリックセレクタ系トリガー（電話タップ・特定ボタンクリック等）は後続 PR で対応予定。

#### 環境変数展開

機微値は `${ENV_VAR}` で .env / 環境変数に逃がせる（例: `value: "${SOME_API_KEY}"`）。
未定義の環境変数を参照すると起動時に `ValueError` で止まる。

サンプルは [`clients/example/tags.yaml`](../clients/example/tags.yaml) を参照。

### 各モジュール単体実行

```bash
# GA4 のみ
python ga4/setup.py "田中クリニック" "https://tanaka-clinic.com/"

# GTM のみ
python gtm/setup.py "tanaka-clinic" "G-XXXXXXX"

# Search Console のみ
python search_console/setup.py "https://tanaka-clinic.com/" ANALYTICS
```

---

## 5. 重複スキップの仕様

各ステップで既存リソースを自動検出し、重複作成を防止する。何度実行しても安全（冪等）。

### GA4

| 判定対象 | 判定方法 | 既存ありの場合 |
|---------|---------|--------------|
| プロパティ | `display_name` が一致するプロパティをアカウント内で検索 | 既存プロパティの ID と Measurement ID を再利用 |
| データストリーム | プロパティ内の Web ストリームを検索 | 既存の Measurement ID を返す。ストリームがなければ作成 |
| カスタムディメンション | `parameter_name` で照合 | スキップ |
| コンバージョン | `event_name` で照合 | スキップ |

### GTM

| 判定対象 | 判定方法 | 既存ありの場合 |
|---------|---------|--------------|
| コンテナ | `name` が `client_{slug}` と一致するコンテナをアカウント内で検索 | 既存コンテナの ID と Public ID を再利用 |
| GA4 設定タグ | ワークスペース内のタグ一覧で `type == "gaawc"` を検索。検索漏れ時は作成の重複名エラーをキャッチ | スキップ |
| カスタムタグ（preset） | ワークスペース内のタグ一覧で `name` 一致を検索。検索漏れ時は作成の重複名エラーをキャッチ | スキップ |
| トリガー（preset） | ワークスペース内のトリガー一覧で `name` 一致を検索 | スキップ |
| バージョン公開 | 新規タグ・トリガーの作成がなかった場合 | 公開済みの最新バージョン ID を返す（再公開しない） |

### Search Console

| 判定対象 | 判定方法 | 既存ありの場合 |
|---------|---------|--------------|
| サイト追加 | `sites.add()` は冪等（追加済みでもエラーにならない） | そのまま続行 |
| 所有権検証 | 検証実行時にトークン未検出エラーの場合 | 警告メッセージ + 再実行コマンドを表示して続行 |

### スキップ時のログ出力例

```
[ga4] INFO:   既存プロパティ発見: 安藤ITパートナー (ID: 531789370)
[setup_all] INFO:   (既存プロパティを再利用)
[gtm] INFO:   既存コンテナ発見: client_ando-it-partner (ID: 248716392)
[gtm] INFO:   GA4 タグは既に存在（スキップ）
[gtm] INFO:   公開済みバージョンを使用: 3
[setup_all] INFO:   (既存コンテナ・タグを再利用)
```

---

## 6. GTM スニペットの埋め込み

### 現在の動作

Step 3 はスニペットをログに表示するのみ。手動でサイトの HTML にコピーする。

### 本番での自動埋め込み

`setup_all.py` の Step 3 コメントアウト部分を解除し、`--html-path` 引数を有効化する。

```python
# setup_all.py の Step 3 で以下を解除:
from gtm.embed import embed_gtm_snippets
embedded = embed_gtm_snippets(args.html_path, gtm_public_id)
```

`gtm/embed.py` の動作:
- `<head>` の直後に GTM script タグを挿入
- `<body>` の直後に GTM noscript タグを挿入
- 同じ GTM ID が既に存在する場合はスキップ（二重挿入防止）

---

## 7. Search Console 検証の注意点

### 検証方式

| 方式 | サイト側の追加作業 | 前提条件 |
|------|-------------------|---------|
| `ANALYTICS` | 不要 | GA4 タグがサイトにデプロイ済み |
| `TAG_MANAGER` | 不要 | GTM スニペットがサイトにデプロイ済み |
| `META` | meta タグ追加 → 再デプロイ | なし |
| `FILE` | HTML ファイル配置 → 再デプロイ | なし |

`ANALYTICS` / `TAG_MANAGER` 方式ではトークン取得 (`getToken`) は不要のため、スクリプトはこれらの方式で自動スキップする。

### 検証失敗時

サイトに GA4/GTM スニペットがデプロイされていない場合、検証は失敗するがスクリプトはエラー終了しない。デプロイ後に以下を再実行する:

```bash
python search_console/setup.py "https://example.com/" ANALYTICS
```

---

## 8. 取得される ID 一覧

| ID | 値の例 | 取得タイミング | 用途 |
|----|--------|--------------|------|
| `ga4_property_id` | `531789370` | GA4 プロパティ作成時 | GA4 管理画面での識別 |
| `ga4_property_name` | `properties/531789370` | 同上 | API リソース名 |
| `ga4_measurement_id` | `G-QJ9V07NJSW` | データストリーム作成時 | GTM の GA4 タグに設定 |
| `ga4_stream_name` | `properties/.../dataStreams/...` | 同上 | API リソース名 |
| `gtm_container_id` | `248716392` | コンテナ作成時 | GTM 管理画面での識別 |
| `gtm_public_id` | `GTM-NSBTFJLB` | 同上 | HTML 埋め込み用 |
| `search_console_url` | `https://example.com/` | サイト追加時 | Search Console での識別 |

---

## 9. トラブルシューティング

| エラー | 原因 | 対処 |
|--------|------|------|
| `Access Not Configured` | API が未有効 | セクション 1 で有効化 |
| `access_denied` (OAuth) | テストユーザー未追加 | OAuth 同意画面でアカウント追加 |
| `PERMISSION_DENIED` (GA4) | アカウントレベル管理者でない | GA4 管理画面でロールを確認 |
| `PERMISSION_DENIED` (GTM) | コンテナ作成権限がない | GTM 管理画面でユーザー権限を確認 |
| `insufficient authentication scopes` | スコープ不足 | `token.json` を削除して再認証 |
| `token.json` でエラー | トークン破損・スコープ変更 | `token.json` を削除して再認証 |
| `verification token could not be found` | サイトに GA4/GTM 未デプロイ | スニペット埋め込み → デプロイ後に SC 検証を再実行 |
| `Found entity with duplicate name` | リソースが既存 | 自動スキップされるため通常は問題なし |

---

## 10. API クォータ

| API | 制限 |
|-----|------|
| GA4 Admin API | 1,200 req/min（プロジェクト全体）、書き込み 600 req/min |
| GTM API | 特に厳しい制限なし（通常利用で問題なし） |
| Search Console API | 1,200 req/min |
| Site Verification API | 特に厳しい制限なし |

顧客サイトごとに 1 回実行する用途ではクォータに到達することはない。
