# サイト計測セットアップ Tips

実際の構築・運用で得られた知見をまとめる。

---

## 認証まわり

### サービスアカウントキーが使えない場合は OAuth を使う

プライバシーポリシー等の理由でサービスアカウントキーの発行が制限される場合がある。その場合は OAuth 2.0 デスクトップアプリ方式に切り替える。

- GCP Console で「OAuth クライアント ID」をデスクトップアプリとして作成
- `.env` に `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` を設定
- 初回実行時にブラウザが開き認証。以降は `token.json` で自動リフレッシュ

### スコープ変更時は token.json を削除する

OAuth のスコープを追加・変更した場合、既存の `token.json` では権限が足りずエラーになる。`token.json` を削除して再認証すれば解決する。

```bash
rm token.json
# 次回実行時にブラウザが開き、新しいスコープで再認証される
```

### GTM のバージョン作成には専用スコープが必要

`tagmanager.edit.containers` と `tagmanager.publish` だけでは不十分。`tagmanager.edit.containerversions` も必要。これがないと `create_version` で `insufficient authentication scopes` エラーになる。

必要なスコープ一覧:
- `analytics.edit`
- `tagmanager.edit.containers`
- `tagmanager.edit.containerversions`
- `tagmanager.publish`
- `webmasters`
- `siteverification`

---

## GA4

### `google.analytics.admin` のバージョンに注意

`google-analytics-admin` パッケージには `v1alpha` と `v1beta` の 2 バージョンがある。クライアントと型を混在させると `TypeError: Message must be initialized with a dict` になる。

```python
# NG: クライアントが v1alpha、型が v1beta
from google.analytics.admin import AnalyticsAdminServiceClient       # v1alpha
from google.analytics.admin_v1beta.types import Property             # v1beta

# OK: 両方 v1beta に統一
from google.analytics.admin_v1beta import AnalyticsAdminServiceClient
from google.analytics.admin_v1beta.types import Property
```

### `list_properties` は request オブジェクトを渡す

キーワード引数 `filter=...` ではなく、`ListPropertiesRequest` を使う。

```python
# NG
client.list_properties(filter=f'parent:accounts/{ACCOUNT_ID}')

# OK
from google.analytics.admin_v1beta.types import ListPropertiesRequest
request = ListPropertiesRequest(filter=f'parent:accounts/{ACCOUNT_ID}')
client.list_properties(request=request)
```

---

## GTM

### GTM タグの重複検知は 2 段階で行う

ワークスペースのタグ一覧 API で `type == "gaawc"` を検索しても、タイミングやワークスペースの状態によって見つからない場合がある。作成を試みて `duplicate name` エラーをキャッチする方が確実。

```python
existing = find_existing_ga4_tag(gtm_service, container_id, workspace_id)
if existing:
    # スキップ
else:
    try:
        create_ga4_tag(...)
    except Exception as e:
        if "duplicate name" in str(e).lower():
            # 既に存在 → スキップ
        else:
            raise
```

### バージョン公開後にワークスペース ID が変わる

GTM ではバージョン公開時に使用したワークスペースが削除され、新しいデフォルトワークスペースが自動生成される。再実行時は常に `workspaces().list()` で最新のワークスペース ID を取得すること。

---

## Search Console

### ANALYTICS / TAG_MANAGER 方式では getToken は不要

`ANALYTICS` や `TAG_MANAGER` 方式で `webResource().getToken()` を呼ぶと `This verification method does not support token generation` エラーになる。これらの方式ではトークン取得をスキップし、直接 `webResource().insert()` を呼ぶ。

```python
if method not in ("ANALYTICS", "TAG_MANAGER"):
    sv_service.webResource().getToken(body={...}).execute()

sv_service.webResource().insert(verificationMethod=method, body={...}).execute()
```

### 検証はルート URL にタグが必要

Search Console の検証は `--site-url` で指定した URL（通常はルート `https://example.com/`）にクローラーがアクセスして GTM/GA4 タグの存在を確認する。サブページ（`/contact.html` 等）にだけタグがあっても検証は通らない。

**ルートの `index.html` にも GTM スニペットを埋め込むこと。**

### TAG_MANAGER 方式の方が通りやすい

GA4 タグは GTM 経由で動的に読み込まれるため、ANALYTICS 方式ではクローラーが検知できないことがある。GTM スニペットは HTML に静的に埋め込まれるため、**TAG_MANAGER 方式の方が確実に検証が通る**。

---

## Python 環境

### Python 3.9 では `str | None` 構文が使えない

Union 型の `X | Y` 構文は Python 3.10 以降。3.9 で使うと `TypeError: unsupported operand type(s) for |` になる。文字列アノテーションかインポートで回避する。

```python
# NG (Python 3.9)
def func(x: str | None = None): ...

# OK
def func(x: "str | None" = None): ...

# または
from __future__ import annotations
def func(x: str | None = None): ...
```

### venv 環境の python3 が優先される場合がある

`which python3` が venv (`browser-use-env` 等) を指している場合、パッケージが見つからないことがある。システムの Python を明示的に指定する。

```bash
# venv の python3 が優先されている場合
/Library/Developer/CommandLineTools/usr/bin/python3 setup_all.py ...
```

---

## スニペット埋め込み

### DevTools で GTM 関連の script が 2 つ見えるのは正常

ブラウザの Elements タブで `<head>` 内に以下の 2 つの script が見える:

1. **HTMLに埋め込んだ GTM ローダー**: `gtm.js?id=GTM-XXXXXXX` を読み込むスクリプト
2. **GTM が動的に挿入した GA4 タグ**: `gtag/js?id=G-XXXXXXX` を読み込むスクリプト

2 は GTM が実行時に自動的に追加するもの。GTM と GA4 が両方正しく動作している証拠であり、重複ではない。

### 埋め込みは冪等

`embed_gtm_snippets()` は HTML 内に同じ GTM Public ID が既に存在する場合はスキップする。何度実行しても二重挿入されない。
