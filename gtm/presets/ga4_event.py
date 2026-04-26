"""GA4 イベントタグ preset

YAML の `ga4.custom_events[]` から生成される GTM のイベントタグ（type=gaawe）。
GA4 Configuration タグの measurement_id を共用し、指定トリガーで発火する。

サポートするトリガー（短縮指定 / 詳細指定どちらも可）:
- "form_submit"          / {"type": "form_submit"}     … 全フォーム送信
- "page_view"            / {"type": "page_view"}       … 全ページ表示（All Pages）

click セレクタ系（電話タップ・特定ボタン等）は実装スコープが大きいため、
本 preset では後続 PR で対応する。

冪等性:
- タグ名: "GA4 Event - {event_name}" で照合
- トリガー名: "GA4 Trigger - {form_submit|page_view}" で照合
"""

from __future__ import annotations

from gtm.presets.base import ALL_PAGES_TRIGGER_ID, PresetBase

SUPPORTED_TRIGGER_TYPES = {"form_submit", "page_view"}

GTM_TRIGGER_TYPE_MAP = {
    "form_submit": "formSubmission",
    # page_view は All Pages built-in を使うのでマップ不要
}


def _normalize_trigger(trigger):
    """trigger 指定を {"type": "..."} の dict に正規化する。"""
    if trigger is None:
        return {"type": "page_view"}
    if isinstance(trigger, str):
        return {"type": trigger}
    if isinstance(trigger, dict) and "type" in trigger:
        return trigger
    raise ValueError(f"ga4_event preset: 未対応の trigger 形式: {trigger!r}")


class GA4EventPreset(PresetBase):
    preset_name = "ga4_event"

    @classmethod
    def validate(cls, spec: dict) -> None:
        if not spec.get("name"):
            raise ValueError(
                "ga4_event preset には 'name' が必須です（GA4 イベント名）"
            )
        trigger = _normalize_trigger(spec.get("trigger"))
        if trigger["type"] not in SUPPORTED_TRIGGER_TYPES:
            raise ValueError(
                f"ga4_event preset の trigger.type は {sorted(SUPPORTED_TRIGGER_TYPES)} "
                f"のいずれかである必要があります（指定: {trigger['type']!r}）"
            )

    @property
    def event_name(self) -> str:
        return self.spec["name"]

    @property
    def tag_name(self) -> str:
        return f"GA4 Event - {self.event_name}"

    @property
    def trigger_type(self) -> str:
        return _normalize_trigger(self.spec.get("trigger"))["type"]

    def required_triggers(self) -> list[dict]:
        if self.trigger_type == "page_view":
            return []  # All Pages built-in を使う
        gtm_type = GTM_TRIGGER_TYPE_MAP[self.trigger_type]
        trigger_name = f"GA4 Trigger - {self.trigger_type}"
        return [
            {
                "name": trigger_name,
                "body": {"name": trigger_name, "type": gtm_type},
            }
        ]

    def builtin_trigger_ids(self) -> list[str]:
        if self.trigger_type == "page_view":
            return [ALL_PAGES_TRIGGER_ID]
        return []

    def build_tag(self, trigger_ids, context=None):
        context = context or {}
        measurement_id = context.get("measurement_id")
        if not measurement_id:
            raise ValueError(
                "ga4_event preset には measurement_id が必須（context 経由）"
            )
        return {
            "name": self.tag_name,
            "type": "gaawe",
            "parameter": [
                {"type": "template", "key": "eventName", "value": self.event_name},
                {"type": "template", "key": "measurementIdOverride", "value": measurement_id},
                {"type": "boolean", "key": "sendEcommerceData", "value": "false"},
            ],
            "firingTriggerId": trigger_ids,
        }
