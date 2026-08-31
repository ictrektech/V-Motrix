#!/usr/bin/env bash
set -euo pipefail

APP_NAME="v-motrix"
APP_ID="com.ictrek.v-motrix"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${ROOT_DIR}/src"
DIST_DIR="${ROOT_DIR}/dist"
STAGE_DIR="${DIST_DIR}/staging"
PACKAGE_ROOT="${DIST_DIR}/package-root"
VERSION_FILE="${ROOT_DIR}/VERSION"

die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

for command in python3 tar; do require_cmd "$command"; done
APP_VERSION="${PACKAGE_VERSION:-$(tr -d '[:space:]' < "$VERSION_FILE")}"
[[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version: $APP_VERSION"

rm -rf "$STAGE_DIR" "$PACKAGE_ROOT"
mkdir -p "$STAGE_DIR" "$PACKAGE_ROOT"
python3 "${ROOT_DIR}/scripts/resolve_feishu_images.py" --output "${STAGE_DIR}/.env"

python3 - "$SRC_DIR" "$STAGE_DIR" "$APP_VERSION" <<'PY'
import re, shutil, sys
from pathlib import Path
source, stage, version = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
environment = {}
for line in (stage / '.env').read_text(encoding='utf-8').splitlines():
    if '=' in line:
        key, value = line.split('=', 1); environment[key] = value
for name in ('manifest.yml', 'configs.yml', 'routers.yml', 'README.zh-CN.md', 'README.en.md'):
    text = (source / name).read_text(encoding='utf-8').replace('__APP_VERSION__', version)
    (stage / name).write_text(text, encoding='utf-8')
compose = (source / 'docker-compose.yml').read_text(encoding='utf-8').replace('__APP_VERSION__', version)
def image(match):
    key = match.group(1)
    return environment.get(key, match.group(0)) if key.endswith('_IMAGE') else match.group(0)
compose = re.sub(r'\$\{([A-Z0-9_]+)(?::-[^}]*)?\}', image, compose)
(stage / 'docker-compose.yml').write_text(compose, encoding='utf-8')
shutil.copy2(source / 'icon.png', stage / 'icon.png')
PY

APP_TARBALL="${DIST_DIR}/app.tar.gz"
PACKAGE_PATH="${DIST_DIR}/${APP_NAME}_${APP_VERSION}_pull.tar"
COPYFILE_DISABLE=1 tar czf "$APP_TARBALL" -C "$STAGE_DIR" \
  .env manifest.yml docker-compose.yml configs.yml routers.yml icon.png README.zh-CN.md README.en.md
cp "$APP_TARBALL" "$PACKAGE_ROOT/app.tar.gz"
COPYFILE_DISABLE=1 tar cf "$PACKAGE_PATH" -C "$PACKAGE_ROOT" app.tar.gz

python3 - "$PACKAGE_PATH" "$APP_TARBALL" "$APP_ID" <<'PY'
import io, re, sys, tarfile
outer_path, inner_path, app_id = sys.argv[1:]
with tarfile.open(outer_path) as outer:
    if outer.getnames() != ['app.tar.gz']:
        raise SystemExit(f'outer tar must contain only app.tar.gz: {outer.getnames()}')
with tarfile.open(inner_path, 'r:gz') as inner:
    names = set(inner.getnames())
    required = {'.env', 'manifest.yml', 'docker-compose.yml', 'configs.yml', 'routers.yml', 'icon.png', 'README.zh-CN.md'}
    if not required <= names:
        raise SystemExit(f'missing package files: {sorted(required - names)}')
    text = '\n'.join(
        inner.extractfile(name).read().decode('utf-8')
        for name in names if name != 'icon.png' and inner.extractfile(name)
    )
    if re.search(r'__[A-Z0-9_]+__', text): raise SystemExit('unrendered placeholder remains')
    compose = inner.extractfile('docker-compose.yml').read().decode('utf-8')
    routers = inner.extractfile('routers.yml').read().decode('utf-8')
    manifest = inner.extractfile('manifest.yml').read().decode('utf-8')
    if re.search(r'\$\{[^}]*_IMAGE[^}]*\}', compose): raise SystemExit('unrendered image remains')
    images = re.findall(r'^\s*image:\s*(\S+)', compose, re.MULTILINE)
    if not images or any('/' not in image or '.' not in image.split('/')[0] for image in images):
        raise SystemExit('compose contains a non-registry image')
    checks = [
        ('external: true', compose), ('aliases:', compose),
        ('HeaderRegexp(`Sec-Fetch-Dest`, `document`)', compose),
        (f'basePath: /app/{app_id}', manifest), ('oauth2:', manifest),
        ('storage:', manifest), ('id: com-ictrek-v-motrix', routers),
        ('id: downloads', routers), (f'iframe-src: /app/{app_id}/#/downloads', routers),
        ('entry-point: true', routers), ('embed: true', routers),
    ]
    for needle, haystack in checks:
        if needle not in haystack: raise SystemExit(f'missing required package contract: {needle}')
print('V-Motrix pull package verified')
PY

printf '[INFO] Done: %s\n' "$PACKAGE_PATH"
