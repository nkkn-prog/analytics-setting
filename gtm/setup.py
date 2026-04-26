"""GTM コンテナ作成・GA4タグ設定モジュール

GTM アカウント配下にコンテナを作成し、GA4 設定タグを追加して公開する。
同名コンテナが存在する場合はスキップする。
"""

import logging
import os

from dotenv import load_dotenv
from googleapiclient.discovery import build

from auth import get_credentials

load_dotenv()

logger = logging.getLogger("gtm")

GTM_ACCOUNT_ID = os.environ["GTM_ACCOUNT_ID"]


def get_service():
    credentials = get_credentials()
    return build("tagmanager", "v2", credentials=credentials)


def find_existing_container(gtm_service, client_slug):
    """同名の GTM コンテナを検索する。"""
    container_name = f"client_{client_slug}"
    containers = (
        gtm_service.accounts()
        .containers()
        .list(parent=f"accounts/{GTM_ACCOUNT_ID}")
        .execute()
    )
    for container in containers.get("container", []):
        if container["name"] == container_name:
            logger.info(f"  既存コンテナ発見: {container_name} (ID: {container['containerId']})")
            return {
                "container_id": container["containerId"],
                "public_id": container["publicId"],
            }
    return None


def create_container(gtm_service, client_slug):
    """GTM コンテナを作成する。

    Returns:
        dict: container_id, public_id (GTM-XXXXXXX)
    """
    container = (
        gtm_service.accounts()
        .containers()
        .create(
            parent=f"accounts/{GTM_ACCOUNT_ID}",
            body={
                "name": f"client_{client_slug}",
                "usageContext": ["web"],
            },
        )
        .execute()
    )
    return {
        "container_id": container["containerId"],
        "public_id": container["publicId"],
    }


def get_default_workspace_id(gtm_service, container_id):
    """デフォルトワークスペースIDを取得する。"""
    workspaces = (
        gtm_service.accounts()
        .containers()
        .workspaces()
        .list(parent=f"accounts/{GTM_ACCOUNT_ID}/containers/{container_id}")
        .execute()
    )
    return workspaces["workspace"][0]["workspaceId"]


def find_existing_ga4_tag(gtm_service, container_id, workspace_id):
    """ワークスペース内に既存の GA4 設定タグがあるか確認する。"""
    parent = f"accounts/{GTM_ACCOUNT_ID}/containers/{container_id}/workspaces/{workspace_id}"
    tags_response = (
        gtm_service.accounts()
        .containers()
        .workspaces()
        .tags()
        .list(parent=parent)
        .execute()
    )
    for tag in tags_response.get("tag", []):
        if tag.get("type") == "gaawc":
            return tag
    return None


def create_ga4_tag(gtm_service, container_id, workspace_id, measurement_id):
    """GA4 設定タグを作成する。"""
    parent = f"accounts/{GTM_ACCOUNT_ID}/containers/{container_id}/workspaces/{workspace_id}"
    tag = (
        gtm_service.accounts()
        .containers()
        .workspaces()
        .tags()
        .create(
            parent=parent,
            body={
                "name": "GA4 Configuration",
                "type": "gaawc",
                "parameter": [
                    {
                        "type": "template",
                        "key": "measurementId",
                        "value": measurement_id,
                    }
                ],
                "firingTriggerId": ["2147479553"],  # All Pages
            },
        )
        .execute()
    )
    return tag


def has_unpublished_changes(gtm_service, container_id, workspace_id):
    """ワークスペースに未公開の変更があるか確認する。"""
    workspace = (
        gtm_service.accounts()
        .containers()
        .workspaces()
        .get(path=f"accounts/{GTM_ACCOUNT_ID}/containers/{container_id}/workspaces/{workspace_id}")
        .execute()
    )
    return "workspaceChange" in workspace or workspace.get("fingerprint", "") != ""


def publish_container(gtm_service, container_id, workspace_id, version_name):
    """バージョンを作成して公開する。公開されたバージョンIDを返す。"""
    version_response = (
        gtm_service.accounts()
        .containers()
        .workspaces()
        .create_version(
            path=f"accounts/{GTM_ACCOUNT_ID}/containers/{container_id}/workspaces/{workspace_id}",
            body={"name": version_name},
        )
        .execute()
    )
    version_id = version_response["containerVersion"]["containerVersionId"]

    gtm_service.accounts().containers().versions().publish(
        path=f"accounts/{GTM_ACCOUNT_ID}/containers/{container_id}/versions/{version_id}"
    ).execute()

    return version_id


def get_latest_version_id(gtm_service, container_id):
    """公開済みの最新バージョンIDを取得する。"""
    try:
        live = (
            gtm_service.accounts()
            .containers()
            .versions()
            .live(parent=f"accounts/{GTM_ACCOUNT_ID}/containers/{container_id}")
            .execute()
        )
        return live.get("containerVersionId", "0")
    except Exception:
        return "0"


def setup_gtm(
    gtm_service,
    client_slug,
    measurement_id,
):
    """GTM コンテナ作成 → GA4タグ設定 → 公開 を一括実行する。
    既存コンテナ/タグがある場合はスキップする。

    Returns:
        dict: container_id, public_id, version_id, skipped
    """
    # 1. コンテナ: 既存チェック → なければ作成
    existing_container = find_existing_container(gtm_service, client_slug)
    if existing_container:
        container_id = existing_container["container_id"]
        public_id = existing_container["public_id"]
        container_skipped = True
    else:
        logger.info(f"  新規コンテナ作成: client_{client_slug}")
        container_info = create_container(gtm_service, client_slug)
        container_id = container_info["container_id"]
        public_id = container_info["public_id"]
        container_skipped = False

    # 2. ワークスペース取得
    workspace_id = get_default_workspace_id(gtm_service, container_id)

    # 3. GA4 タグ: 既存チェック → なければ作成
    needs_publish = False
    existing_ga4 = find_existing_ga4_tag(gtm_service, container_id, workspace_id)
    if existing_ga4:
        logger.info("  GA4 タグは既に存在（スキップ）")
    else:
        logger.info(f"  GA4 タグ作成: {measurement_id}")
        try:
            create_ga4_tag(gtm_service, container_id, workspace_id, measurement_id)
            needs_publish = True
        except Exception as e:
            if "duplicate name" in str(e).lower():
                logger.info("  GA4 タグは既に存在（スキップ）")
            else:
                raise

    # 4. バージョン作成 → 公開（新規タグがある場合のみ）
    if needs_publish:
        logger.info("  バージョン作成・公開中...")
        version_id = publish_container(
            gtm_service, container_id, workspace_id,
            "v1 - Initial GA4 setup",
        )
    else:
        version_id = get_latest_version_id(gtm_service, container_id)
        logger.info(f"  公開済みバージョンを使用: {version_id}")

    return {
        "container_id": container_id,
        "public_id": public_id,
        "version_id": version_id,
        "skipped": container_skipped and not needs_publish,
    }


if __name__ == "__main__":
    import json
    import sys

    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 3:
        print("Usage: python -m gtm.setup <client_slug> <measurement_id> [clarity_project_id]")
        sys.exit(1)

    service = get_service()
    result = setup_gtm(
        service,
        client_slug=sys.argv[1],
        measurement_id=sys.argv[2],
        clarity_project_id=sys.argv[3] if len(sys.argv) > 3 else None,
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
