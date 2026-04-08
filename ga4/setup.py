"""GA4 プロパティ・データストリーム作成モジュール

GA4 アカウント配下にプロパティとWebデータストリームを作成し、
Measurement ID を取得する。同名プロパティが存在する場合はスキップする。
"""

import logging
import os

from dotenv import load_dotenv
from google.analytics.admin_v1beta import AnalyticsAdminServiceClient
from google.analytics.admin_v1beta.types import DataStream, Property

from auth import get_credentials

load_dotenv()

logger = logging.getLogger("ga4")

GA4_ACCOUNT_ID = os.environ["GA4_ACCOUNT_ID"]
GA4_TIMEZONE = os.environ["GA4_TIMEZONE"]
GA4_CURRENCY_CODE = os.environ["GA4_CURRENCY_CODE"]


def get_client() -> AnalyticsAdminServiceClient:
    credentials = get_credentials()
    return AnalyticsAdminServiceClient(credentials=credentials)


def find_existing_property(client, client_name):
    """同名の GA4 プロパティを検索し、見つかればデータストリーム情報も返す。"""
    from google.analytics.admin_v1beta.types import ListPropertiesRequest
    request = ListPropertiesRequest(
        filter=f'parent:accounts/{GA4_ACCOUNT_ID}'
    )
    properties = client.list_properties(request=request)
    for prop in properties:
        if prop.display_name == client_name:
            property_name = prop.name
            property_id = property_name.split("/")[-1]
            logger.info(f"  既存プロパティ発見: {client_name} (ID: {property_id})")

            # データストリームを検索して measurement_id を取得
            streams = client.list_data_streams(parent=property_name)
            for stream in streams:
                if stream.type_ == DataStream.DataStreamType.WEB_DATA_STREAM:
                    return {
                        "property_id": property_id,
                        "property_name": property_name,
                        "measurement_id": stream.web_stream_data.measurement_id,
                        "stream_name": stream.name,
                        "skipped": True,
                    }

            # プロパティはあるがストリームがない場合
            return {
                "property_id": property_id,
                "property_name": property_name,
                "measurement_id": None,
                "stream_name": None,
                "skipped": True,
            }
    return None


def create_property_and_stream(
    client: AnalyticsAdminServiceClient,
    client_name: str,
    site_url: str,
) -> dict:
    """GA4 プロパティとWebデータストリームを作成し、各IDを返す。
    同名プロパティが既にある場合はスキップして既存情報を返す。

    Returns:
        dict: property_id, property_name, measurement_id, stream_name, skipped
    """
    # 既存チェック
    existing = find_existing_property(client, client_name)
    if existing:
        # プロパティはあるがストリームがない場合、ストリームを作成
        if existing["measurement_id"] is None:
            logger.info("  データストリームが未作成のため作成します")
            data_stream = DataStream(
                type_=DataStream.DataStreamType.WEB_DATA_STREAM,
                display_name=f"{client_name} Web",
                web_stream_data=DataStream.WebStreamData(default_uri=site_url),
            )
            created_stream = client.create_data_stream(
                parent=existing["property_name"],
                data_stream=data_stream,
            )
            existing["measurement_id"] = created_stream.web_stream_data.measurement_id
            existing["stream_name"] = created_stream.name
        return existing

    # 新規作成
    logger.info(f"  新規プロパティ作成: {client_name}")

    # 1. プロパティ作成
    property_obj = Property(
        parent=f"accounts/{GA4_ACCOUNT_ID}",
        display_name=client_name,
        time_zone=GA4_TIMEZONE,
        currency_code=GA4_CURRENCY_CODE,
    )
    created_property = client.create_property(property=property_obj)
    property_name = created_property.name
    property_id = property_name.split("/")[-1]

    # 2. Web データストリーム作成
    data_stream = DataStream(
        type_=DataStream.DataStreamType.WEB_DATA_STREAM,
        display_name=f"{client_name} Web",
        web_stream_data=DataStream.WebStreamData(default_uri=site_url),
    )
    created_stream = client.create_data_stream(
        parent=property_name,
        data_stream=data_stream,
    )
    measurement_id = created_stream.web_stream_data.measurement_id

    return {
        "property_id": property_id,
        "property_name": property_name,
        "measurement_id": measurement_id,
        "stream_name": created_stream.name,
        "skipped": False,
    }


if __name__ == "__main__":
    import json
    import sys

    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 3:
        print("Usage: python -m ga4.setup <client_name> <site_url>")
        sys.exit(1)

    client = get_client()
    result = create_property_and_stream(
        client, client_name=sys.argv[1], site_url=sys.argv[2]
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
