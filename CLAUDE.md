# analytics-setting — Claude Code プロジェクト設定

## 言語
日本語で応答すること。

## プロジェクト概要

顧客サイトの計測環境（GA4 / GTM / Search Console）を一括セットアップする CLI ツール。

ユーザーは Claude にプロンプトで計測仕様を指示し、Claude は `clients/{slug}/tags.yaml`
を生成する。`python setup_all.py --config clients/{slug}/tags.yaml ...` を実行すると、
GA4 管理側とGTM側の両方が一気通貫で自動設定される。

詳細仕様は [docs/setup-guide.md](docs/setup-guide.md)、設計判断は
[docs/custom-tags-integration-proposal.md](docs/custom-tags-integration-proposal.md) を参照。

## カスタムタグ YAML 生成ガイド（最重要）

ユーザーから「○○のサイトに××を計測したい」という指示を受けたら、
[clients/example/tags.yaml](clients/example/tags.yaml) の構造に従って YAML を生成する。
生成時は以下の命名規約と制約を厳守すること。

### YAML スキーマ

```yaml
ga4:
  custom_events:        # GA4 で計測したいカスタムイベント
    - name: <event_name>
      trigger: <form_submit | page_view>
      mark_as_conversion: <true | false>   # true なら GA4 で「主要なイベント」に昇格
  custom_dimensions:    # レポートで使う独自ディメンション
    - parameter_name: <param_name>
      display_name: <表示名>
      scope: <EVENT | USER | ITEM>

custom_tags:            # 任意・preset に該当しない案件特有スニペット用
  - preset: custom_html
    name: <GTM タグ名>
    html: |
      <script>...</script>
```

### 命名規約（厳守）

| フィールド | 制約 | NG例 / OK例 |
|-----------|------|------------|
| `ga4.custom_events[].name` | 英小文字 + 数字 + アンダースコア。先頭は英字。40 文字以内。GA4 予約名（`page_view` / `session_start` / `first_visit` / `user_engagement` / `scroll` / `click` / `view_search_results` / `video_*` / `file_download` / `form_*` 等）と完全一致させない。 | NG: `Form Submit`, `form-submit`, `page_view`<br>OK: `form_submit_clinic`, `tel_tap_header`, `cv_reservation` |
| `ga4.custom_dimensions[].parameter_name` | 英数字 + アンダースコア。40 文字以内。先頭は英字。 | OK: `line_friend_id`, `user_segment` |
| `ga4.custom_dimensions[].display_name` | 任意の文字列。82 文字以内。日本語可。 | OK: `LINE Friend ID`, `ユーザー区分` |
| `ga4.custom_dimensions[].scope` | `EVENT` / `USER` / `ITEM` のいずれか。デフォルト `EVENT`。`ITEM` は eコマース用。 | — |
| `custom_tags[].name` (GTM タグ名) | 同コンテナ内で一意。空白可。`GA4 Event - *` / `GA4 Configuration` は予約済みのため重複させない。 | OK: `Hotjar`, `LINE Tag - CV` |

### 命名のヒント（Claude 向け）

イベント名は「業種_動詞_対象」または「動詞_対象_補足」の構造で命名すると識別性が高い。

- フォーム系: `form_submit_<type>` （例: `form_submit_contact`, `form_submit_reservation`）
- 電話タップ: `tel_tap_<location>` （例: `tel_tap_header`, `tel_tap_footer`）
- LINE 友だち追加: `line_friend_add`
- ページ到達系: `page_view_<page>` （例: `page_view_thanks`, `page_view_pricing`）
- 一般CV: `cv_<purpose>` （例: `cv_reservation`, `cv_inquiry`）

`mark_as_conversion: true` を付けるべきもの: コンバージョンとして扱いたいイベント
（フォーム送信完了、電話タップ、サンクスページ到達、LINE 友だち追加など）。
逆に「クリック数を見たいだけ」のイベントは `false` にする。

### 対応していないトリガー（現状のスコープ外）

- クリックセレクタ系（電話タップを `a[href^="tel:"]` で発火させる等）
- URL 含む条件（サンクスページを URL contains で限定する等）
- スクロール深度・要素表示（visibility）

これらをユーザーから依頼された場合は「現状の preset では未対応のため、`page_view`
で全ページ発火にするか、後続 PR を待つかを選んでほしい」と確認する。サンクスページ
到達であれば、暫定的に `trigger: page_view + mark_as_conversion: true` にして
「今は全ページ発火、URL 限定は後続 PR」と注記しておくのが現実的。

### 機微値の扱い

API キー・シークレット等を YAML に書く必要がある場合は `${ENV_VAR}` 形式で
.env / 環境変数に逃がす（例: `value: "${HOTJAR_SITE_ID}"`）。
未定義の環境変数を参照すると起動時に `ValueError` で止まる。

### 冪等性

`setup_all.py` は何度実行しても安全。同名のタグ・トリガー・ディメンション・
コンバージョンは自動スキップされる。タグ名・パラメータ名を後から変更すると
別物として新規作成されるので、命名は最初に確定させること。

## ディレクトリ構成

```
analytics-setting/
├── auth.py                     # OAuth 認証（共通）
├── setup_all.py                # 一括実行エントリポイント
├── ga4/setup.py                # GA4 プロパティ + カスタムディメンション + コンバージョン登録
├── gtm/
│   ├── setup.py                # GTM コンテナ・タグ・トリガー作成・公開
│   ├── embed.py                # GTM スニペット HTML 埋め込み
│   └── presets/                # カスタムタグ preset
│       ├── base.py             # PresetBase（required_triggers / build_tag）
│       ├── ga4_event.py        # GA4 イベントタグ（form_submit / page_view）
│       └── custom_html.py      # 任意 HTML スニペット
├── search_console/setup.py     # Search Console 登録・検証
├── clients/
│   ├── .gitignore              # example/ 以外はコミットしない
│   └── example/tags.yaml       # 設定ファイルサンプル
└── docs/
    ├── setup-guide.md          # 詳細セットアップガイド
    ├── custom-tags-integration-proposal.md  # 設計提案（履歴）
    └── tips.md                 # 構築知見
```

## コード規約

### Python
- Python 3.10+ （`str | None` 等の union syntax 使用）
- venv: `.venv/`
- 型ヒント使用
- ロギング: `logging.getLogger("ga4")` / `"gtm"` / `"setup_all"` 等、モジュール単位で取得

### 冪等性は崩さない
すべての API 呼び出しは「既存検索 → なければ作成」のパターンで実装する。
新しい preset / API 連動を追加するときも同じ規律で書くこと（`find_*` →
重複時は `duplicate name` 例外をキャッチしてスキップ）。

### preset を増やすとき
1. `gtm/presets/<name>.py` を新規追加し `PresetBase` を継承
2. `validate()` / `tag_name` / `required_triggers()` / `builtin_trigger_ids()` /
   `build_tag(trigger_ids, context)` を実装
3. `gtm/presets/__init__.py` の `PRESET_REGISTRY` に登録
4. [docs/setup-guide.md](docs/setup-guide.md) の preset 一覧表に追記
5. このファイルの命名規約表にも必要なら追記

### テスト・Lint
- 構文チェック: `python -c "import ast; ast.parse(open('<file>').read())"`
- 動作確認: 本物のGoogleアカウントでテストコンテナを使う前提（mock しない）

## データ保護

- `.env` / `client_secret.json` / `token.json` は `.gitignore` 済み
- `clients/{slug}/tags.yaml`（実クライアント設定）は `clients/.gitignore` で除外
- `clients/example/` のみコミット対象

## 作業ルール

- 機能追加時はコード + ドキュメント + サンプル YAML の3点セットで更新
- preset 追加時は CLAUDE.md（このファイル）の命名規約表も更新
- コミット前に `python -c "import ast; ..."` で全Pythonファイルの構文チェック
