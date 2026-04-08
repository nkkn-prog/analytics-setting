"""サイト計測 一括セットアップスクリプト

GA4 プロパティ作成 → GTM コンテナ作成・GA4タグ設定・公開 → Search Console 登録・検証
を一気通貫で実行する。各ステップで既存リソースがあれば自動スキップする。

Usage:
    python setup_all.py \
        --client-name "田中クリニック" \
        --client-slug "tanaka-clinic" \
        --site-url "https://tanaka-clinic.com/" \
        [--clarity-project-id "xxxxxxxxxx"] \
        [--verification-method ANALYTICS]
"""

import argparse
import json
import logging
import os
import sys

from auth import get_credentials
from ga4.setup import create_property_and_stream
from ga4.setup import get_client as get_ga4_client
from gtm.setup import get_service as get_gtm_service
from gtm.setup import setup_gtm
from search_console.setup import get_services as get_sc_services
from search_console.setup import register_and_verify

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("setup_all")


def main():
    parser = argparse.ArgumentParser(
        description="GA4 + GTM + Search Console 一括セットアップ"
    )
    parser.add_argument("--client-name", required=True, help="顧客表示名（例: 田中クリニック）")
    parser.add_argument("--client-slug", required=True, help="顧客識別子（例: tanaka-clinic）")
    parser.add_argument("--site-url", required=True, help="サイトURL（例: https://tanaka-clinic.com/）")
    parser.add_argument("--clarity-project-id", default=None, help="Microsoft Clarity プロジェクトID（任意）")
    parser.add_argument("--html-path", default=None, help="GTMスニペット埋め込み先（HTMLファイルまたはディレクトリ）")
    parser.add_argument(
        "--verification-method",
        default="ANALYTICS",
        choices=["ANALYTICS", "TAG_MANAGER", "META", "FILE"],
        help="Search Console 検証方式（デフォルト: ANALYTICS）",
    )
    args = parser.parse_args()

    results = {}

    # 初回実行時はブラウザが開き Google 認証を求められる
    logger.info("認証情報を取得中...")
    get_credentials()
    logger.info("認証OK")

    # =========================================================
    # Step 1: GA4 プロパティ + データストリーム作成
    # =========================================================
    logger.info("=" * 60)
    logger.info("Step 1: GA4 プロパティ・データストリーム作成")
    logger.info("=" * 60)

    ga4_client = get_ga4_client()
    ga4_result = create_property_and_stream(
        ga4_client,
        client_name=args.client_name,
        site_url=args.site_url,
    )
    results["ga4"] = ga4_result
    measurement_id = ga4_result["measurement_id"]

    logger.info(f"  Property ID:    {ga4_result['property_id']}")
    logger.info(f"  Measurement ID: {measurement_id}")
    if ga4_result.get("skipped"):
        logger.info("  (既存プロパティを再利用)")

    # =========================================================
    # Step 2: GTM コンテナ作成 → GA4タグ設定 → 公開
    # =========================================================
    logger.info("=" * 60)
    logger.info("Step 2: GTM コンテナ作成・タグ設定・公開")
    logger.info("=" * 60)

    gtm_service = get_gtm_service()
    gtm_result = setup_gtm(
        gtm_service,
        client_slug=args.client_slug,
        measurement_id=measurement_id,
        clarity_project_id=args.clarity_project_id,
    )
    results["gtm"] = gtm_result

    logger.info(f"  Container ID: {gtm_result['container_id']}")
    logger.info(f"  Public ID:    {gtm_result['public_id']}")
    logger.info(f"  Version ID:   {gtm_result['version_id']}")
    if gtm_result.get("skipped"):
        logger.info("  (既存コンテナ・タグを再利用)")

    # =========================================================
    # Step 3: GTM スニペットを HTML に埋め込み
    # =========================================================
    gtm_public_id = gtm_result["public_id"]

    logger.info("=" * 60)
    logger.info("Step 3: GTM スニペット埋め込み")
    logger.info("=" * 60)

    from gtm.embed import (
        embed_gtm_snippets,
        embed_gtm_to_directory,
        generate_body_snippet,
        generate_head_snippet,
    )

    snippet_head = generate_head_snippet(gtm_public_id)
    snippet_body = generate_body_snippet(gtm_public_id)
    results["gtm_snippets"] = {"head": snippet_head, "body": snippet_body}

    if args.html_path:
        if os.path.isdir(args.html_path):
            embed_result = embed_gtm_to_directory(args.html_path, gtm_public_id)
            for f in embed_result["embedded"]:
                logger.info(f"  埋め込み完了: {f}")
            for f in embed_result["skipped"]:
                logger.info(f"  スキップ（埋め込み済み）: {f}")
        else:
            if embed_gtm_snippets(args.html_path, gtm_public_id):
                logger.info(f"  埋め込み完了: {args.html_path}")
            else:
                logger.info(f"  スキップ（埋め込み済み）: {args.html_path}")
    else:
        logger.info("  --html-path 未指定のためスニペット表示のみ:")
        logger.info("  <head> 用:")
        for line in snippet_head.split("\n"):
            logger.info(f"    {line}")
        logger.info("  <body> 用:")
        for line in snippet_body.split("\n"):
            logger.info(f"    {line}")

    # =========================================================
    # Step 4: Search Console 登録・所有権検証
    #   ※ サイトに GTM スニペットがデプロイ済みであること
    # =========================================================
    logger.info("=" * 60)
    logger.info("Step 4: Search Console 登録・所有権検証")
    logger.info("=" * 60)
    logger.info(f"  検証方式: {args.verification_method}")

    sc_service, sv_service = get_sc_services()
    try:
        sc_result = register_and_verify(
            sc_service,
            sv_service,
            site_url=args.site_url,
            method=args.verification_method,
        )
        results["search_console"] = sc_result
        logger.info(f"  Site URL: {sc_result['site_url']}")
        logger.info(f"  Owners:   {sc_result['owners']}")
    except Exception as e:
        error_msg = str(e)
        if "verification token could not be found" in error_msg:
            logger.warning("  検証失敗: サイトに GA4/GTM スニペットが未デプロイです")
            logger.warning("  GTM スニペットをサイトに埋め込み・デプロイ��に以下を再実行してください:")
            logger.warning(f"    python search_console/setup.py \"{args.site_url}\" {args.verification_method}")
            sc_result = {
                "site_url": args.site_url,
                "method": args.verification_method,
                "owners": [],
                "verified": False,
            }
        else:
            raise
        results["search_console"] = sc_result

    # =========================================================
    # 結果サマリー
    # =========================================================
    logger.info("=" * 60)
    logger.info("全ステップ完了")
    logger.info("=" * 60)

    summary = {
        "client_name": args.client_name,
        "client_slug": args.client_slug,
        "site_url": args.site_url,
        "ga4_property_id": ga4_result["property_id"],
        "ga4_property_name": ga4_result["property_name"],
        "ga4_measurement_id": measurement_id,
        "ga4_stream_name": ga4_result["stream_name"],
        "gtm_container_id": gtm_result["container_id"],
        "gtm_public_id": gtm_public_id,
        "search_console_url": sc_result["site_url"],
        "search_console_method": sc_result["method"],
    }
    if args.clarity_project_id:
        summary["clarity_project_id"] = args.clarity_project_id

    print("\n" + json.dumps(summary, indent=2, ensure_ascii=False))
    return summary


if __name__ == "__main__":
    main()
