"""GTM スニペット HTML 埋め込みモジュール

対象 HTML ファイルの <head> と <body> に GTM スニペットを挿入する。
既に埋め込み済みの場合はスキップする。
"""

import glob
import logging
import os
import re

logger = logging.getLogger("gtm.embed")


def generate_head_snippet(gtm_public_id: str) -> str:
    """<head> 内に挿入する GTM スニペットを生成する。"""
    return (
        f"<!-- Google Tag Manager -->\n"
        f"<script>\n"
        f"(function(w,d,s,l,i){{w[l]=w[l]||[];w[l].push({{'gtm.start':\n"
        f"new Date().getTime(),event:'gtm.js'}});var f=d.getElementsByTagName(s)[0],\n"
        f"j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n"
        f"'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);\n"
        f"}})(window,document,'script','dataLayer','{gtm_public_id}');\n"
        f"</script>\n"
        f"<!-- End Google Tag Manager -->"
    )


def generate_body_snippet(gtm_public_id: str) -> str:
    """<body> 開始直後に挿入する GTM noscript スニペットを生成する。"""
    return (
        f"<!-- Google Tag Manager (noscript) -->\n"
        f'<noscript><iframe src="https://www.googletagmanager.com/ns.html?id={gtm_public_id}"\n'
        f'height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n'
        f"<!-- End Google Tag Manager (noscript) -->"
    )


def embed_gtm_snippets(html_path: str, gtm_public_id: str) -> bool:
    """HTML ファイルに GTM スニペットを埋め込む。

    Args:
        html_path: 対象 HTML ファイルのパス
        gtm_public_id: GTM の Public ID（例: GTM-XXXXXXX）

    Returns:
        bool: 埋め込みが行われた場合 True、既に存在する場合 False
    """
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    # 既に埋め込み済みならスキップ
    if gtm_public_id in html:
        logger.info(f"既に埋め込み済み: {html_path}")
        return False

    head_snippet = generate_head_snippet(gtm_public_id)
    body_snippet = generate_body_snippet(gtm_public_id)

    # <head> の直後に挿入
    html = re.sub(
        r"(<head[^>]*>)",
        rf"\1\n{head_snippet}",
        html,
        count=1,
        flags=re.IGNORECASE,
    )

    # <body> の直後に挿入
    html = re.sub(
        r"(<body[^>]*>)",
        rf"\1\n{body_snippet}",
        html,
        count=1,
        flags=re.IGNORECASE,
    )

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)

    logger.info(f"GTM スニペット埋め込み完了: {html_path}")
    return True


def embed_gtm_to_directory(dir_path, gtm_public_id):
    """ディレクトリ内の全 HTML ファイルに GTM スニペットを埋め込む。

    Args:
        dir_path: 対象ディレクトリのパス
        gtm_public_id: GTM の Public ID（例: GTM-XXXXXXX）

    Returns:
        dict: embedded (埋め込み済みファイル一覧), skipped (スキップ一覧)
    """
    html_files = sorted(glob.glob(os.path.join(dir_path, "**", "*.html"), recursive=True))
    if not html_files:
        logger.warning(f"HTML ファイルが見つかりません: {dir_path}")
        return {"embedded": [], "skipped": []}

    embedded = []
    skipped = []
    for html_file in html_files:
        if embed_gtm_snippets(html_file, gtm_public_id):
            embedded.append(html_file)
        else:
            skipped.append(html_file)

    logger.info(f"埋め込み完了: {len(embedded)} ファイル, スキップ: {len(skipped)} ファイル")
    return {"embedded": embedded, "skipped": skipped}
