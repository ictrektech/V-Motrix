# V-Motrix VOS package

This directory defines the pull-mode VOS application `com.ictrek.v-motrix`.
The package reads the latest `v-motrix` images from the shared Feishu release
table and contains no embedded image archives.

## Build and release order

Build each architecture once on its matching host:

```bash
../build_image.sh --sheet AMD_with_cuda
../build_image.sh --sheet ARM_with_cuda
```

The build script reuses the architecture-specific Node base image in ictrek
SWR. If it is absent, the script pulls `node:24-alpine` through the configured
Docker Hub accelerator and publishes it to
`swr.cn-southwest-2.myhuaweicloud.com/ictrek/node` before building V-Motrix.

After both image records are pullable and the source changes are committed:

```bash
./ictrek.app/scripts/update_version.sh patch
```

The version script pushes only `vos-v-motrix-vX.Y.Z`. GitHub Actions builds
`v-motrix_X.Y.Z_pull.tar`, creates the public `vX.Y.Z` release, and publishes
the package to VOS App Store.

## Storage and user isolation

The package mounts `${VOS_APP_STORAGE_PATH}` at `/data` for app state and
`${VOS_MOTRIX_DOWNLOAD_PUBLIC_PATH:-/data/vos_workspace/v-motrix}/downloads`
at `/downloads` for downloaded files. VOS OIDC Fastpath maps every immutable
user subject to opaque directories:

```text
/data/users/<subject-hash>/                 # private app state
├── app/                                    # settings, database, plugins, aria2 session
├── home/
├── tmp/
└── identity.json

/downloads/users/<subject-hash>/downloads/  # completed and partial downloads
```

Each authenticated user receives an independent Motrix server and aria2
process. Request/response and WebSocket boundaries map the private physical
download root to `/downloads`, so the default path never reveals the subject
hash, username, or host storage path. Browser localStorage, sessionStorage,
and IndexedDB are partitioned by the same opaque namespace.

## Supported input protocols

Manual task creation accepts HTTP(S), SFTP, ED2K, BitTorrent magnet links,
Thunder links, `.torrent` files, and bare BitTorrent info hashes. Thunder links
are decoded before submission, `magnet://` is normalized to aria2-compatible
`magnet:?`, and bare info hashes are converted to magnet links. The VOS image
uses the same aria2-next engine lineage as Motrix Next and bundles ED2K
bootstrap files.
