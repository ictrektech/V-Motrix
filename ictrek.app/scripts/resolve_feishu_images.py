#!/usr/bin/env python3
"""Resolve V-Motrix profile images from the shared Feishu release table."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

DEFAULT_SPREADSHEET = "Htotsn3oahO1zxt73YMcaB1zn8e"
PROFILES = (
    ("V_MOTRIX_AMD_IMAGE", "AMD_with_cuda", "amd_"),
    ("V_MOTRIX_ARM_IMAGE", "ARM_with_cuda", "arm_"),
)


def load_credentials() -> tuple[str, str]:
    candidates = [
        os.environ.get("FEISHU_CONFIG_FILE", ""),
        str(Path.home() / ".feishu.components.json"),
        str(Path.home() / ".feishu.json"),
    ]
    seen: set[str] = set()
    for raw in candidates:
        if not raw or raw in seen:
            continue
        seen.add(raw)
        path = Path(raw)
        if not path.is_file():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        app_id = str(payload.get("feishu_app_id", "")).strip()
        secret = str(payload.get("feishu_app_secret", "")).strip()
        if app_id and secret:
            return app_id, secret
    raise SystemExit("failed to read Feishu component credentials")


def request_json(
    method: str,
    url: str,
    *,
    token: str | None = None,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    with urlopen(Request(url, data=data, headers=headers, method=method), timeout=20) as response:
        payload = json.load(response)
    if payload.get("code") != 0:
        raise SystemExit(f"Feishu API failed: code={payload.get('code')} msg={payload.get('msg')}")
    return payload


def cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("text") or value.get("link") or "").strip()
    if isinstance(value, list):
        return "".join(cell_text(item) for item in value).strip()
    return str(value).strip()


def column_name(number: int) -> str:
    output = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        output = chr(65 + remainder) + output
    return output


def values(token: str, spreadsheet: str, range_value: str) -> list[list[Any]]:
    encoded = quote(range_value, safe="!:")
    payload = request_json(
        "GET",
        f"https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/{spreadsheet}/values/{encoded}",
        token=token,
    )
    return payload.get("data", {}).get("valueRange", {}).get("values", [])


def resolve_image(
    token: str,
    spreadsheet: str,
    sheet_id: str,
    prefix: str,
) -> str:
    rows = values(token, spreadsheet, f"{sheet_id}!A1:ZZ2")
    header = rows[0] if rows else []
    repositories = rows[1] if len(rows) > 1 else []
    column = next(
        (index for index, value in enumerate(header, start=1) if cell_text(value) == "v-motrix"),
        None,
    )
    if column is None:
        raise SystemExit(f"v-motrix component column not found in sheet {sheet_id}")
    repository = cell_text(repositories[column - 1] if len(repositories) >= column else None)
    if not repository.startswith("swr.cn-southwest-2.myhuaweicloud.com/ictrek/"):
        raise SystemExit(f"invalid v-motrix repository in Feishu: {repository}")
    version_rows = values(token, spreadsheet, f"{sheet_id}!{column_name(column)}4:{column_name(column)}2000")
    tag = next((cell_text(row[0]) for row in version_rows if row and cell_text(row[0])), "")
    if not tag.startswith(prefix):
        raise SystemExit(f"latest v-motrix tag must start with {prefix}: {tag}")
    return f"{repository}:{tag}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    spreadsheet = os.environ.get("FEISHU_SPREADSHEET_TOKEN", DEFAULT_SPREADSHEET)
    app_id, secret = load_credentials()
    auth = request_json(
        "POST",
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        body={"app_id": app_id, "app_secret": secret},
    )
    token = str(auth["tenant_access_token"])
    sheet_payload = request_json(
        "GET",
        f"https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/{spreadsheet}/sheets/query",
        token=token,
    )
    sheet_ids = {
        str(item.get("title")): str(item.get("sheet_id"))
        for item in sheet_payload.get("data", {}).get("sheets", [])
    }
    lines: list[str] = []
    for env_name, title, prefix in PROFILES:
        sheet_id = sheet_ids.get(title)
        if not sheet_id:
            raise SystemExit(f"sheet not found: {title}")
        image = resolve_image(token, spreadsheet, sheet_id, prefix)
        print(f"Resolved {title} v-motrix image")
        lines.append(f"{env_name}={image}")
    Path(args.output).write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
