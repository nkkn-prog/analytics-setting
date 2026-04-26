# カスタムタグ統合 設計提案

`setup_all.py` の GA4 / GTM セットアップフローに、クライアント固有のカスタムタグ指示があれば自動で設定できるようにする提案。

## 背景

現状の `gtm/setup.py` は GA4 設定タグ + Microsoft Clarity（オプショナル1個）がハードコードされている。Clarity をオプショナル化できているのに、それ以外のクライアント固有タグ（Meta Pixel / X Pixel / LINE Tag / Hotjar / Yahoo 広告タグ / 独自イベント計測など）は手作業に逃げており、設計として中途半端。実運用ではほぼ必ず案件ごとのカスタムタグが発生するため、入口で吸収できる構造にする。

## 結論

**カスタムタグ自動化に賛成。ただし CLI 引数を増やす方向ではなく、設定ファイル駆動 + preset 層で組む。**

実装に入る前に、以下の設計判断を確定させてから進める。

## 設計判断

### 1. インターフェイスは設定ファイル駆動

カスタムタグはタグ名・タイプ・パラメータ・トリガーの4要素を持つため、CLI 引数（`--meta-pixel-id ...` `--line-tag-id ...`）方式は破綻する。クライアント単位の YAML/JSON を1本受ける構造にする。

```yaml
# clients/tanaka-clinic/tags.yaml
custom_tags:
  - preset: meta_pixel
    pixel_id: "1234567890"
  - preset: line_tag
    tag_id: "abcd-1234"
    events: [conversion, page_view]
  - preset: custom_html
    name: "Hotjar"
    html: |
      <script>...</script>
    trigger: all_pages
```

呼び出しは `python setup_all.py --config clients/tanaka-clinic/tags.yaml` の形に統一。

### 2. 「preset 層 + 汎用 custom_html 層」の2層構造

頻出タグは preset としてテンプレート化（`gtm/presets/`）。preset 化すれば「タグ + 必要なトリガー + データレイヤー変数」を ID 入力だけで一括生成できる。preset に該当しないものは汎用 `custom_html` で吸収。

| 層 | 用途 | 例 |
|----|------|-----|
| preset | 頻出タグ。テンプレートで一括生成 | meta_pixel / line_tag / x_pixel / hotjar / yahoo_tag / clarity |
| custom_html | 任意の HTML スニペット | 案件特有の独自タグ |

現行の `create_clarity_tag()` は preset 層の最初のメンバーとして再分類する。実装変更なしでリネームと整理だけで済む。

### 3. GA4 側の連動を忘れない（最重要）

GTM にカスタムタグを置く案件は、**ほぼ必ず GA4 側にも以下のいずれかが必要**になる:

- カスタムイベントの登録（例: `form_submit_clinic`）
- コンバージョンマーク（イベントを「主要なイベント」に昇格）
- カスタムディメンション/メトリクス（例: `line_friend_id` をレポートで使えるようにする）

GTM だけ自動化して GA4 側を手作業に残すと、運用で必ずズレる。`setup_all.py` の Step 1（GA4）でも同じ設定ファイルから `ga4.custom_events / ga4.conversions / ga4.custom_dimensions` を読んで登録する設計にする。`ga4/setup.py` に Admin API の `customDimensions.create` / `conversionEvents.create` を追加する。

```yaml
ga4:
  custom_events:
    - name: form_submit_clinic
  conversions:
    - event: form_submit_clinic
  custom_dimensions:
    - parameter_name: line_friend_id
      display_name: LINE Friend ID
      scope: EVENT
```

### 4. 冪等性は崩さない

現行の `find_existing_*` → なければ作る、duplicate name はスキップ、というパターンは維持。カスタムタグは `name` で照合するルールを徹底し、CLI 再実行で重複が湧かないようにする。`find_existing_clarity_tag` と同じやり方をそのまま広げる。

### 5. トリガーとデータレイヤー変数も束で扱う

カスタムタグ単体で動くケースは少なく、「特定のクリックで発火」「特定のページで発火」「dataLayer の値を読む」という前提を伴うことが多い。preset には `triggers` と `variables` を同梱する。

現行は `firingTriggerId: "2147479553"`（All Pages）固定だが、preset 側で以下のような指定が読めるようにする:

```yaml
trigger:
  built_in: all_pages
  # または
  click: { selector: "#cv-button" }
```

### 6. 機微値は `.env` に逃がす

Pixel ID レベルなら設定ファイル直書きで十分だが、API キーを要する preset が今後出てくる可能性を考慮し、`${ENV_VAR}` 展開を初期から仕込んでおく。

```yaml
custom_tags:
  - preset: hotjar
    site_id: "${HOTJAR_SITE_ID}"
```

### 7. 同意モード v2 への余地を残す

案件によってはタグの並び順やコンセント管理（同意モード v2）が要件に入る。preset スキーマに `consent_settings` フィールドの余地だけ残しておく（初期実装では未使用でOK）。

## 実装ステップ

リスクを最小化する順序で進める。

1. **`gtm/setup.py` の `setup_gtm()` シグネチャに `custom_tags: list[dict] | None` を追加**
2. **`gtm/presets/` ディレクトリ作成 + Clarity を preset 構造に移管 + `meta_pixel` / `line_tag` / `custom_html` を追加**
3. **`setup_all.py` に `--config` 引数を追加、YAML 読み込みを噛ませる**
4. **`ga4/setup.py` に `setup_custom_events_and_conversions()` を追加し、同じ設定ファイルから読む**
5. **README と `docs/setup-guide.md` に preset 一覧を追記**

最初のPRは **「Clarity を preset 構造に寄せる + custom_html 1個だけ動く」** までに絞る。既存のクライアント案件を壊さずに土台が入る。preset の追加とGA4連動はその後の独立PRに分割。

## スコープ外（明示的に今回は扱わない）

- タグの並び順制御（GTM の Tag Sequencing）
- コンセント管理 v2 の本格実装（フィールドの余地のみ残す）
- サーバーサイド GTM
- Looker Studio / BigQuery 連携の自動化
