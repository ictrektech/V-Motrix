# V-Motrix

V-Motrix is a VOS download manager backed by aria2-next, with HTTP/HTTPS, SFTP, ED2K, BitTorrent, magnet-link, Metalink, and task-status support.

## Multi-user privacy

- VOS OIDC Fastpath must verify the current system user before the app starts.
- Every user receives an independent Motrix database, settings, aria2 session, plugin data, and download directory.
- Private app data uses an opaque hash of the immutable user subject; downloaded files use the current VOS username as the public subdirectory.
- The default download path is displayed as `/downloads/<username>`, which maps to the current user's isolated subdirectory under the shared download root.
- Browser local storage and IndexedDB switch to a separate partition when the VOS account changes.

VOS App Storage manages application state. Downloaded files are mapped through `VOS_MOTRIX_DOWNLOAD_PUBLIC_PATH`, defaulting to `/data/vos_workspace/v-motrix/downloads`; the app separates users below that directory by VOS username so files can be retrieved directly from VOS file management.
