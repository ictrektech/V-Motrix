#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  download_root="${VOS_MOTRIX_DOWNLOAD_ROOT:-/downloads}"
  mkdir -p /data /data/users /data/tmp /data/home /data/torrents
  mkdir -p "$download_root" "$download_root/users"
  chown node:node /data /data/users /data/tmp /data/home /data/torrents
  chown node:node "$download_root" "$download_root/users"
  chmod 0755 /data /data/users /data/tmp /data/home /data/torrents
  chmod 0755 "$download_root" "$download_root/users"
  exec gosu node:node "$@"
fi

exec "$@"
