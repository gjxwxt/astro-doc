# Backup and restore — tasks

## 1. Backup script

- [x] 1.1 Resolve `PORTAL_DATA_DIR` / `PORTAL_BACKUP_DIR`; fail clearly if missing.
- [x] 1.2 Use `VACUUM INTO` for the SQLite snapshot.
- [x] 1.3 Run `PRAGMA integrity_check` and require `ok`.
- [x] 1.4 Create `media.tar.gz` when media exists.
- [x] 1.5 Write `manifest.json` with sizes, counts, sha256 and release.
- [x] 1.6 Apply `PORTAL_BACKUP_KEEP` retention (default 14).
- [x] 1.7 Add a launchd plist example and a systemd timer unit.

## 2. Restore script

- [x] 2.1 Accept a backup directory or a `portal.sqlite` path.
- [x] 2.2 Verify the source with `PRAGMA integrity_check`.
- [x] 2.3 Save `portal.before-restore-<stamp>.sqlite`.
- [x] 2.4 Support `--include-media` with a timestamped old-media directory.
- [x] 2.5 Print the restart step; never restart the service automatically.

## 3. Pull home

- [x] 3.1 Add `scripts/pull-backups.sh` with host/key/dir env vars.
- [x] 3.2 Use tar over SSH so the remote does not need rsync.
- [x] 3.3 Add `pnpm db:pull`.
- [x] 3.4 Validate missing inputs and exit non-zero.

## 4. Server operation

- [x] 4.1 Install `josh-portal-backup.service` and `.timer` on the server.
- [x] 4.2 Enable the timer; confirm a real backup completes.
- [x] 4.3 Pull at least one backup to the Mac and verify `manifest.json`.
- [x] 4.4 Document retention, paths and restore commands in `docs/BACKUP.md`.

## 5. Verification

- [x] 5.1 `pnpm check` passes.
- [x] 5.2 `pnpm build` passes.
- [x] 5.3 Backup snapshot passes `integrity_check`.
- [x] 5.4 Restore round trip tested against a temporary copy.
