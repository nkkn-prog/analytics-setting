"""GTM カスタムタグ preset 層

設定ファイル側スキーマ（抜粋）:

    custom_tags:
      - preset: ga4_event
        name: form_submit_clinic
        trigger: form_submit
      - preset: custom_html
        name: "独自タグ"
        html: |
          <script>...</script>

各 preset は build_tag() / required_triggers() / builtin_trigger_ids() を返す。
冪等性は呼び出し側（gtm/setup.py）が `name` 一致で担保する。
"""

from gtm.presets.custom_html import CustomHtmlPreset
from gtm.presets.ga4_event import GA4EventPreset

PRESET_REGISTRY = {
    "ga4_event": GA4EventPreset,
    "custom_html": CustomHtmlPreset,
}


def get_preset(name: str):
    if name not in PRESET_REGISTRY:
        available = ", ".join(sorted(PRESET_REGISTRY.keys()))
        raise ValueError(
            f"未対応の preset: '{name}'. 利用可能な preset: {available}"
        )
    return PRESET_REGISTRY[name]


__all__ = ["PRESET_REGISTRY", "get_preset", "CustomHtmlPreset", "GA4EventPreset"]
