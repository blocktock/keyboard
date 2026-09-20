from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_SERVER_URL = "http://127.0.0.1:3011"


def upload_report(report_file: Path, server_url: str = DEFAULT_SERVER_URL) -> dict:
    payload = json.loads(report_file.read_text(encoding="utf-8"))
    request = urllib.request.Request(
        f"{server_url.rstrip('/')}/api/reports",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
            if response.status != 201:
                raise RuntimeError(f"上传失败（HTTP {response.status}）")
            return json.loads(body)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(detail).get("error", detail)
        except json.JSONDecodeError:
            message = detail or str(error)
        raise RuntimeError(message) from error
    except urllib.error.URLError as error:
        raise RuntimeError(
            "无法连接分析服务，请先在本机运行 npm run start（默认 http://127.0.0.1:3011）。"
        ) from error
