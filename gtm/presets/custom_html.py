"""汎用 Custom HTML preset

preset テンプレートに当てはまらない案件特有のスニペットを吸収する。
任意の <script> タグを発火タイミングだけ指定して登録できる。

冪等性: spec.name で照合する。同名タグが既にあればスキップ。
現状の trigger 指定は 'all_pages' のみ。
"""

from __future__ import annotations

from gtm.presets.base import ALL_PAGES_TRIGGER_ID, PresetBase


class CustomHtmlPreset(PresetBase):
    preset_name = "custom_html"

    @classmethod
    def validate(cls, spec: dict) -> None:
        if not spec.get("name"):
            raise ValueError(
                "custom_html preset には 'name' が必須です（GTM タグ名 + 重複検出キー）"
            )
        if not spec.get("html"):
            raise ValueError(
                "custom_html preset には 'html' が必須です（埋め込む <script> 等のスニペット）"
            )
        trigger = spec.get("trigger", "all_pages")
        if trigger not in ("all_pages", None):
            raise ValueError(
                f"custom_html preset の trigger は現状 'all_pages' のみサポート（指定: {trigger!r}）"
            )

    @property
    def tag_name(self) -> str:
        return self.spec["name"]

    def builtin_trigger_ids(self) -> list[str]:
        return [ALL_PAGES_TRIGGER_ID]

    def build_tag(self, trigger_ids, context=None):
        return {
            "name": self.tag_name,
            "type": "html",
            "parameter": [
                {"type": "template", "key": "html", "value": self.spec["html"]},
                {
                    "type": "boolean",
                    "key": "supportDocumentWrite",
                    "value": str(self.spec.get("support_document_write", False)).lower(),
                },
            ],
            "firingTriggerId": trigger_ids,
        }
