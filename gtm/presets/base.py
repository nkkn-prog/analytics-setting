"""preset 基底クラス

各 preset は「タグ本体」と「そのタグが必要とするトリガー仕様」をそれぞれ返す。
呼び出し側（gtm/setup.py）はトリガーを先に冪等作成して ID を解決し、
その ID 配列を preset に渡してタグ本体を構築する。

context は GA4 measurement_id 等、複数 preset で共用したい横断パラメータを渡す経路。
"""

from __future__ import annotations

ALL_PAGES_TRIGGER_ID = "2147479553"


class PresetBase:
    preset_name: str = ""

    def __init__(self, spec: dict):
        self.spec = spec
        self.validate(spec)

    @classmethod
    def validate(cls, spec: dict) -> None:
        return None

    @property
    def tag_name(self) -> str:
        """GTM タグ名。冪等性チェックの照合キー。"""
        raise NotImplementedError

    def required_triggers(self) -> list[dict]:
        """このタグが必要とする「新規作成すべきトリガー」の仕様 list。

        各要素は {"name": str, "body": dict} の形。`body` は GTM API
        `triggers().create()` にそのまま渡せる dict。built-in トリガー
        （All Pages 等）を使う場合は空 list を返してよい。
        """
        return []

    def builtin_trigger_ids(self) -> list[str]:
        """このタグが使う built-in トリガー ID（All Pages 等）。"""
        return []

    def build_tag(self, trigger_ids: list[str], context: dict | None = None) -> dict:
        """トリガー ID が解決された後にタグ body を組み立てる。

        Args:
            trigger_ids: required_triggers() で作成済みトリガーの ID list
                         + builtin_trigger_ids() を結合した最終 ID list
            context: measurement_id 等の横断パラメータ
        """
        raise NotImplementedError
