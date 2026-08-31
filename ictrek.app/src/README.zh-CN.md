# V-Motrix

V-Motrix 是面向 VOS 的下载管理应用，使用 aria2-next 引擎，支持 HTTP/HTTPS、SFTP、ED2K、BT、磁力链接、Metalink 和任务状态管理。

## 多用户隐私

- 进入应用时必须通过 VOS OIDC Fastpath 验证当前系统用户。
- 每位用户拥有独立的 Motrix 数据库、设置、aria2 会话、插件数据和下载目录。
- 私有目录使用不可逆的用户 subject 哈希命名，不在界面中显示用户名或宿主机路径。
- 应用中的默认下载路径固定显示为 `/downloads`；该路径映射到共享下载目录下当前登录用户自己的隔离子目录。
- 切换 VOS 用户时，浏览器本地存储和 IndexedDB 也会切换到独立分区。

应用数据由 VOS App Storage 管理。下载文件由 `VOS_MOTRIX_DOWNLOAD_PUBLIC_PATH` 映射到公共目录，默认目录为 `/data/vos_workspace/v-motrix/downloads`；目录内按 VOS 用户哈希继续隔离，便于在 VOS 文件管理中直接取得下载结果。
