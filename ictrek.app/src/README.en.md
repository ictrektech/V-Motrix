# V-Motrix

V-Motrix is a download manager for VOS with HTTP, BitTorrent, magnet-link, and task-status support.

## Multi-user privacy

- VOS OIDC Fastpath must verify the current system user before the app starts.
- Every user receives an independent Motrix database, settings, aria2 session, plugin data, and download directory.
- Private directories use an opaque hash of the immutable user subject; usernames and host paths are never shown in the UI.
- The default download path is always displayed as `/downloads`, which maps only to the current user's private directory.
- Browser local storage and IndexedDB switch to a separate partition when the VOS account changes.

VOS App Storage manages all application data. Installation does not ask for or expose a shared download directory.
