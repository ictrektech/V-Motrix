#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="v-motrix"
IMAGE_REPOSITORY="swr.cn-southwest-2.myhuaweicloud.com/ictrek/${IMAGE_NAME}"
BASE_REPOSITORY="swr.cn-southwest-2.myhuaweicloud.com/ictrek/node"
BASE_SOURCE="docker.m.daocloud.io/library/node:24-alpine"
SPREADSHEET_TOKEN="${FEISHU_SPREADSHEET_TOKEN:-Htotsn3oahO1zxt73YMcaB1zn8e}"
if [[ -z "${FEISHU_CONFIG_FILE:-}" ]]; then
  for candidate in "${HOME}/.feishu.components.json" "${HOME}/.feishu.json"; do
    if [[ -r "$candidate" ]]; then
      FEISHU_CONFIG_FILE="$candidate"
      break
    fi
  done
fi
FEISHU_CONFIG_FILE="${FEISHU_CONFIG_FILE:-${HOME}/.feishu.json}"

log() { printf '[INFO] %s\n' "$*"; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

usage() {
  cat <<'EOF'
Usage: ./build_image.sh --sheet <sheet>

Supported sheets:
  AMD_with_cuda, AMD_with_mxn100
  ARM_with_cuda, ARM_without_cuda, l4t, thor_spark

The script must run on a build host matching the selected architecture. It
mirrors node:24-alpine through Docker Hub acceleration into ictrek SWR when
the architecture-specific base image is not already present.
EOF
}

SHEET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sheet) SHEET="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -n "$SHEET" ]] || { usage >&2; exit 2; }

case "$SHEET" in
  AMD_with_cuda|AMD_with_mxn100)
    PLATFORM="linux/amd64"; ARCH="amd64"; TAG_PREFIX="amd_" ;;
  ARM_with_cuda|ARM_without_cuda)
    PLATFORM="linux/arm64"; ARCH="arm64"; TAG_PREFIX="arm_" ;;
  l4t)
    PLATFORM="linux/arm64"; ARCH="arm64"; TAG_PREFIX="l4t_" ;;
  thor_spark)
    PLATFORM="linux/arm64"; ARCH="arm64"; TAG_PREFIX="thor_spark_" ;;
  *) die "unsupported sheet: $SHEET" ;;
esac

case "${ARCH}:$(uname -m)" in
  amd64:x86_64|arm64:aarch64|arm64:arm64) ;;
  *) die "sheet $SHEET requires $PLATFORM, current host is $(uname -m)" ;;
esac

require_cmd curl
require_cmd docker
require_cmd python3
[[ -r "$FEISHU_CONFIG_FILE" ]] || die "Feishu config not readable: $FEISHU_CONFIG_FILE"

read_config() {
  python3 - "$FEISHU_CONFIG_FILE" "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    value = json.load(handle).get(sys.argv[2], '')
print(value if isinstance(value, str) else str(value))
PY
}

APP_ID="$(read_config feishu_app_id)"
APP_SECRET="$(read_config feishu_app_secret)"
[[ -n "$APP_ID" && -n "$APP_SECRET" ]] || die "Feishu credentials are incomplete"

BASE_IMAGE="${BASE_REPOSITORY}:24-alpine-${ARCH}"
if ! docker manifest inspect "$BASE_IMAGE" >/dev/null 2>&1; then
  log "Mirror missing base image: $BASE_SOURCE -> $BASE_IMAGE"
  docker pull --platform "$PLATFORM" "$BASE_SOURCE"
  docker tag "$BASE_SOURCE" "$BASE_IMAGE"
  docker push "$BASE_IMAGE"
  docker manifest inspect "$BASE_IMAGE" >/dev/null
else
  log "Reuse ictrek SWR base image: $BASE_IMAGE"
fi

TODAY="$(date +%Y%m%d)"
TAG="${TAG_PREFIX}${TODAY}"
FULL_IMAGE="${IMAGE_REPOSITORY}:${TAG}"
if [[ -n "${SOURCE_REVISION:-}" ]]; then
  REVISION="$SOURCE_REVISION"
elif git rev-parse HEAD >/dev/null 2>&1; then
  REVISION="$(git rev-parse HEAD)"
else
  die "SOURCE_REVISION is required when building from a Git-free synced tree"
fi
VERSION="$(python3 - <<'PY'
import json
with open('package.json', encoding='utf-8') as handle:
    print(json.load(handle)['version'])
PY
)"

log "Build $FULL_IMAGE for $PLATFORM"
docker buildx build \
  --load \
  --provenance=false \
  --sbom=false \
  --platform "$PLATFORM" \
  --build-arg "NODE_IMAGE=$BASE_IMAGE" \
  --build-arg "OCI_REVISION=$REVISION" \
  --build-arg "OCI_VERSION=$VERSION" \
  -f Dockerfile.vos \
  -t "$FULL_IMAGE" \
  .
docker push "$FULL_IMAGE"
docker manifest inspect "$FULL_IMAGE" >/dev/null

TOKEN_RESPONSE="$(curl --fail -sS -X POST \
  'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' \
  -H 'Content-Type: application/json' \
  -d "{\"app_id\":\"${APP_ID}\",\"app_secret\":\"${APP_SECRET}\"}")"
TENANT_TOKEN="$(python3 - "$TOKEN_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
if payload.get('code') != 0:
    raise SystemExit(f"Feishu authentication failed: {payload}")
print(payload['tenant_access_token'])
PY
)"

feishu() {
  local method="$1" url="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl --fail -sS -X "$method" "$url" \
      -H "Authorization: Bearer ${TENANT_TOKEN}" \
      -H 'Content-Type: application/json' \
      --data "$body"
  else
    curl --fail -sS -X "$method" "$url" \
      -H "Authorization: Bearer ${TENANT_TOKEN}"
  fi
}

SHEETS_RESPONSE="$(feishu GET \
  "https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${SPREADSHEET_TOKEN}/sheets/query")"
SHEET_ID="$(python3 - "$SHEET" "$SHEETS_RESPONSE" <<'PY'
import json, sys
title, raw = sys.argv[1], sys.argv[2]
payload = json.loads(raw)
if payload.get('code') != 0:
    raise SystemExit(f"query sheets failed: {payload}")
for sheet in payload.get('data', {}).get('sheets', []):
    if sheet.get('title') == title:
        print(sheet['sheet_id'])
        raise SystemExit(0)
raise SystemExit(f"sheet not found: {title}")
PY
)"

HEADER_RESPONSE="$(feishu GET \
  "https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${SHEET_ID}!A1:ZZ2")"
COLUMN_RESULT="$(python3 - "$IMAGE_NAME" "$HEADER_RESPONSE" <<'PY'
import json, sys
target, raw = sys.argv[1], sys.argv[2]
payload = json.loads(raw)
if payload.get('code') != 0:
    raise SystemExit(f"read sheet header failed: {payload}")
rows = payload.get('data', {}).get('valueRange', {}).get('values', [])
header = rows[0] if rows else []
repo = rows[1] if len(rows) > 1 else []
def text(value):
    if value is None: return ''
    if isinstance(value, str): return value.strip()
    if isinstance(value, dict): return str(value.get('text') or value.get('link') or '').strip()
    if isinstance(value, list): return ''.join(text(item) for item in value).strip()
    return str(value).strip()
def col(number):
    out = ''
    while number:
        number, rem = divmod(number - 1, 26)
        out = chr(65 + rem) + out
    return out
for index, value in enumerate(header, 1):
    if text(value) == target:
        print(f"FOUND:{col(index)}")
        raise SystemExit(0)
last = max([1] + [index for row in (header, repo) for index, value in enumerate(row, 1) if text(value)])
print(f"MISSING:{last + 1}")
PY
)"

if [[ "$COLUMN_RESULT" == FOUND:* ]]; then
  COLUMN="${COLUMN_RESULT#FOUND:}"
else
  COLUMN_NUMBER="${COLUMN_RESULT#MISSING:}"
  COLUMN="$(python3 - "$COLUMN_NUMBER" <<'PY'
import sys
number = int(sys.argv[1]); out = ''
while number:
    number, rem = divmod(number - 1, 26); out = chr(65 + rem) + out
print(out)
PY
)"
  log "Append Feishu component column $COLUMN"
  ADD_RESPONSE="$(feishu POST \
    "https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/dimension_range" \
    "{\"dimension\":{\"sheetId\":\"${SHEET_ID}\",\"majorDimension\":\"COLUMNS\",\"length\":1}}")"
  python3 - "$ADD_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
if payload.get('code') != 0: raise SystemExit(f"append column failed: {payload}")
PY
fi

DATE_RESPONSE="$(feishu GET \
  "https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${SHEET_ID}!A4:A2000")"
DATE_ROW="$(python3 - "$TODAY" "$DATE_RESPONSE" <<'PY'
import json, sys
target, raw = sys.argv[1], sys.argv[2]
payload = json.loads(raw)
if payload.get('code') != 0: raise SystemExit(f"read date rows failed: {payload}")
for index, row in enumerate(payload.get('data', {}).get('valueRange', {}).get('values', []), 4):
    if row and str(row[0]).strip() == target:
        print(index); raise SystemExit(0)
print('')
PY
)"
if [[ -z "$DATE_ROW" ]]; then
  PREPEND_RESPONSE="$(feishu POST \
    "https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values_prepend" \
    "{\"valueRange\":{\"range\":\"${SHEET_ID}!A4:A4\",\"values\":[[\"${TODAY}\"]]}}")"
  python3 - "$PREPEND_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
if payload.get('code') != 0: raise SystemExit(f"prepend date row failed: {payload}")
PY
  DATE_ROW=4
fi

write_cell() {
  local cell="$1" value="$2" response
  response="$(feishu PUT \
    "https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values" \
    "{\"valueRange\":{\"range\":\"${SHEET_ID}!${cell}:${cell}\",\"values\":[[\"${value}\"]]}}")"
  python3 - "$response" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
if payload.get('code') != 0: raise SystemExit(f"write cell failed: {payload}")
PY
}

write_cell "${COLUMN}1" "$IMAGE_NAME"
write_cell "${COLUMN}2" "$IMAGE_REPOSITORY"
write_cell "${COLUMN}${DATE_ROW}" "$TAG"
log "Published and recorded: $FULL_IMAGE ($SHEET)"
