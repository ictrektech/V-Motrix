#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p /data /data/users /data/tmp /data/home /data/torrents
  chown node:node /data /data/users /data/tmp /data/home /data/torrents
  chmod 0755 /data /data/users /data/tmp /data/home /data/torrents
  exec su-exec node:node "$@"
fi

exec "$@"
