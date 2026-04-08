"""OAuth 2.0 認証モジュール

初回実行時にブラウザで Google 認証を行い、token.json に保存する。
2回目以降は token.json を再利用（期限切れ時は自動リフレッシュ）。
"""

import os

from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

load_dotenv()

TOKEN_PATH = os.path.join(os.path.dirname(__file__), "token.json")
CLIENT_SECRET_PATH = os.path.join(os.path.dirname(__file__), "client_secret.json")

ALL_SCOPES = [
    "https://www.googleapis.com/auth/analytics.edit",
    "https://www.googleapis.com/auth/tagmanager.edit.containers",
    "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
    "https://www.googleapis.com/auth/tagmanager.publish",
    "https://www.googleapis.com/auth/webmasters",
    "https://www.googleapis.com/auth/siteverification",
]


def _ensure_client_secret_file():
    """client_secret.json が無ければ .env の値から生成する。"""
    if os.path.exists(CLIENT_SECRET_PATH):
        return

    import json

    client_id = os.environ["GOOGLE_CLIENT_ID"]
    client_secret = os.environ["GOOGLE_CLIENT_SECRET"]

    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }
    with open(CLIENT_SECRET_PATH, "w") as f:
        json.dump(client_config, f, indent=2)


def get_credentials() -> Credentials:
    """OAuth 認証情報を取得する。初回はブラウザ認証が必要。"""
    creds = None

    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, ALL_SCOPES)

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    else:
        _ensure_client_secret_file()
        flow = InstalledAppFlow.from_client_secrets_file(
            CLIENT_SECRET_PATH, ALL_SCOPES
        )
        creds = flow.run_local_server(port=0)

    with open(TOKEN_PATH, "w") as f:
        f.write(creds.to_json())

    return creds
