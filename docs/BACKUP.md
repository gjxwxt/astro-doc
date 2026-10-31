# 备份与恢复

半亩的运行数据都在 `PORTAL_DATA_DIR`（默认 `/opt/josh-portal/data`）里：

| 内容 | 路径 | 备份方式 |
| --- | --- | --- |
| SQLite 数据库 | `portal.sqlite` | `VACUUM INTO` 一致性快照 |
| 媒体原图 | `media/` | 打包成 `media.tar.gz` |
| 环境变量 | `/etc/josh-portal.env` | **不自动备份**，单独保管 |

一次快照长这样：

```text
/opt/josh-portal/backups/20261031-005230/
├── portal.sqlite
├── media.tar.gz
└── manifest.json
```

## 服务器定时备份

服务器上已安装 `josh-portal-backup.timer`，每天 04:15 左右运行：

```bash
systemctl status josh-portal-backup.timer
systemctl list-timers josh-portal-backup.timer
journalctl -u josh-portal-backup.service -n 30 --no-pager

# 立刻补跑一次
systemctl start josh-portal-backup.service
```

脚本是 `/opt/josh-portal/scripts/backup-db.ts`，默认保留 14 份，路径和保留数可以改 service 里的：

```ini
Environment=PORTAL_BACKUP_DIR=/opt/josh-portal/backups
Environment=PORTAL_BACKUP_KEEP=14
```

本地也可以手动跑：

```bash
pnpm db:backup
# ✓ data/backups/20261031-005230
```

`PORTAL_BACKUP_DIR` 不在 `data/` 下时，请自行把该目录排除在 git 之外。备份含私人内容和媒体，不要提交，也不要放公开网盘。

## 恢复到本机或服务器

**先停服务。** 恢复会覆盖当前数据库；如果带 `--include-media`，也会覆盖 `media/`。

```bash
systemctl stop josh-portal

# 只恢复数据库
pnpm db:restore /opt/josh-portal/backups/20261031-005230

# 数据库 + 媒体
pnpm db:restore /opt/josh-portal/backups/20261031-005230 --include-media

systemctl start josh-portal
```

恢复脚本会：

1. 把当前数据库另存为 `portal.before-restore-<时间>.sqlite`；
2. 复制备份数据库，并删除旧的 `-wal` / `-shm`；
3. 只在 `--include-media` 时，把当前 `media/` 改名为 `media.before-restore-<时间>`，再解压备份；
4. 解压失败时自动把旧 `media/` 换回来。

旧的单文件 `.sqlite` 备份仍可传给 `pnpm db:restore`，此时不会动媒体。

## 拉到 Mac

`scripts/pull-backups.sh` 通过 SSH + tar 把服务器备份目录同步到本机：

```bash
HALFMU_HOST=root@your-server \
HALFMU_KEY=$HOME/Downloads/codex.pem \
./scripts/pull-backups.sh
```

默认落到 `~/Backups/halfmu/backups/`，权限是 `700`。脚本只追加/覆盖，不删除服务器或本机的旧备份；服务器端已有 14 份保留策略。

如果需要每天自动拉一次，可以把下面内容保存为 `~/Library/LaunchAgents/cn.gaojiaxiang.halfmu-backup.plist`，把 `HALFMU_HOST` 换成你的服务器地址后再 `launchctl bootstrap gui/$(id -u) <plist>`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>cn.gaojiaxiang.halfmu-backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/imac/Documents/code/astro-doc/scripts/pull-backups.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HALFMU_HOST</key>
    <string>root@your-server</string>
    <key>HALFMU_KEY</key>
    <string>/Users/imac/Downloads/codex.pem</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>5</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/imac/Library/Logs/halfmu-backup.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/imac/Library/Logs/halfmu-backup.log</string>
</dict>
</plist>
```

这是一份**异地副本**，但不等于完整的 3-2-1：如果要防整台机器或账号丢失，还应把最近的快照放一块离线硬盘，或对象存储的私有桶（R2/S3）。环境变量文件里含 `PRIVATE_API_TOKEN`、`ADMIN_PASSWORD`、`SESSION_SECRET` 和 AI 代理 token，建议用密码管理器单独保存，不要和数据库放在同一个位置。

## 恢复演练记录

2026-10-31 在本地临时目录做过一次完整演练：

- 备份生成 `portal.sqlite` + `media.tar.gz` + `manifest.json`；
- 用 `--include-media` 恢复到空目录；
- `PRAGMA integrity_check` 返回 `ok`；
- 媒体文件出现在恢复目录的 `media/` 下。

真正的服务器恢复仍然需要停服务后执行；不要在生产目录里做演练。
