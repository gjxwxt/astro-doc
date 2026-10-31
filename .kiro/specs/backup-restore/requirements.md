# Backup and restore — requirements

## Goal

Make the private portal recoverable from one self-contained folder, on a
schedule, without depending on a hosted backup service.

## Requirements

### R1. Backup

- **R1.1** WHEN `pnpm db:backup` runs, THE SYSTEM SHALL create a timestamped
  directory under `PORTAL_BACKUP_DIR`.
- **R1.2** The backup SHALL contain a consistent SQLite database snapshot, a
  media archive (`media.tar.gz`) and `manifest.json`.
- **R1.3** The database snapshot SHALL use `VACUUM INTO`, not a file copy of a
  live WAL database.
- **R1.4** The script SHALL run `PRAGMA integrity_check` on the snapshot and
  fail the backup if it does not return `ok`.
- **R1.5** The manifest SHALL record the release/version, timestamp, database
  byte size, media file count/bytes and sha256 of the snapshot.
- **R1.6** Retention SHALL keep the most recent `PORTAL_BACKUP_KEEP` snapshots
  (default 14) and never delete a snapshot outside the backup directory.

### R2. Restore

- **R2.1** WHEN `pnpm db:restore <backup-dir|backup.sqlite>` runs, THE SYSTEM
  SHALL verify the snapshot with `PRAGMA integrity_check` before replacing
  anything.
- **R2.2** The current database SHALL be saved as
  `portal.before-restore-<stamp>.sqlite` before replacement.
- **R2.3** With `--include-media`, the current media directory SHALL be renamed
  to `media.before-restore-<stamp>` before extracting the backup.
- **R2.4** The script SHALL refuse to overwrite a non-empty target without the
  safety copy step.
- **R2.5** The restored database SHALL be readable by the portal without a
  migration step for the schema version in the backup.

### R3. Pull home

- **R3.1** `pnpm db:pull` SHALL copy the remote `backups/` directory to a local
  machine using SSH.
- **R3.2** It SHALL work without `rsync` on the remote (tar over SSH).
- **R3.3** It SHALL fail loudly on a missing host/key/remote directory; it SHALL
  not create a partial success message.

### R4. Verification

- **R4.1** A test SHALL verify a backup/restore round trip against a temporary
  database.
- **R4.2** A backup that fails `integrity_check` SHALL not be reported as
  successful.
- **R4.3** `docs/BACKUP.md` SHALL document the commands and retention.
