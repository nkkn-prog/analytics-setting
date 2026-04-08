"""Google Search Console 登録・所有権検証モジュール

サイトを Search Console に追加し、所有権を検証する。
GA4/GTM が設定済みなら ANALYTICS or TAG_MANAGER 方式で追加デプロイ不要。
"""

import logging
import os

from dotenv import load_dotenv
from googleapiclient.discovery import build

from auth import get_credentials

load_dotenv()

logger = logging.getLogger("search_console")


def get_services() -> tuple:
    """Search Console API と Site Verification API のサービスを返す。"""
    credentials = get_credentials()
    sc_service = build("searchconsole", "v1", credentials=credentials)
    sv_service = build("siteVerification", "v1", credentials=credentials)
    return sc_service, sv_service


def register_and_verify(
    sc_service,
    sv_service,
    site_url: str,
    method: str = "ANALYTICS",
) -> dict:
    """サイトを Search Console に登録し、所有権を検証する。

    Args:
        sc_service: Search Console API service
        sv_service: Site Verification API service
        site_url: 登録するサイトURL（末尾スラッシュ含む）
        method: 検証方式 (ANALYTICS, TAG_MANAGER, META, FILE)

    Returns:
        dict: site_url, method, owners
    """
    # 1. サイト追加（既に追加済みでもエラーにはならない）
    try:
        sc_service.sites().add(siteUrl=site_url).execute()
        logger.info(f"Site added: {site_url}")
    except Exception as e:
        logger.info(f"Site already exists or add skipped: {e}")


    # 2. トークン取得（ANALYTICS / TAG_MANAGER 方式では不要）
    if method not in ("ANALYTICS", "TAG_MANAGER"):
        token_response = sv_service.webResource().getToken(
            body={
                "site": {"type": "SITE", "identifier": site_url},
                "verificationMethod": method,
            }
        ).execute()
        logger.info(f"Token retrieved (method={method}): {token_response.get('token', 'N/A')}")

    # 3. 検証実行
    verification = sv_service.webResource().insert(
        verificationMethod=method,
        body={
            "site": {"type": "SITE", "identifier": site_url},
        },
    ).execute()
    logger.info(f"Verified: {site_url}")

    return {
        "site_url": site_url,
        "method": method,
        "owners": verification.get("owners", []),
    }


def list_verified_sites(sc_service, sv_service) -> dict:
    """登録済み・検証済みサイトの一覧を返す。"""
    sites = sc_service.sites().list().execute()
    verified = sv_service.webResource().list().execute()
    return {
        "search_console_sites": sites.get("siteEntry", []),
        "verified_sites": verified.get("items", []),
    }


if __name__ == "__main__":
    import json
    import sys

    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 2:
        print("Usage: python -m search_console.setup <site_url> [method]")
        sys.exit(1)

    sc, sv = get_services()
    result = register_and_verify(
        sc,
        sv,
        site_url=sys.argv[1],
        method=sys.argv[2] if len(sys.argv) > 2 else "ANALYTICS",
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
