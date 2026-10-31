# Backup and restore — design

## Files

- `scripts/backup-db.ts` — snapshot, media archive, manifest, retention.
- `scripts/restore-db.ts` — verify, safety copy, replace DB/media.
- `scripts/pull-backups.sh` — tar over SSH from the portal host.
- `scripts/com.halfmu.backup.plist.example` — launchd template.
- `docs/BACKUP.md` — operator runbook.

## Backup layout

```
$PORTAL_BACKUP_DIR/20261031-041500/
├── portal.sqlite        # VACUUM INTO snapshot
├── media.tar.gz         # media/ if present
└── manifest.json
```

`manifest.json` includes:

```json
{
  "createdAt": "2026-10-31T04:15:00.000Z",
  "release": "20261031085132",
  "database": { "bytes": 123456, "sha256": "…" },
  "media": { "files": 12, "bytes": 3456789 },
  "integrity": "ok"
}
```

## Backup flow

1. Resolve `PORTAL_DATA_DIR` and `PORTAL_BACKUP_DIR`; refuse if the DB is missing.
2. Create the timestamp directory.
3. Open the live DB read-only and run `VACUUM INTO <backup>/portal.sqlite`.
4. Open the snapshot and run `PRAGMA integrity_check`; require `ok`.
5. If `media/` exists, create `media.tar.gz` with deterministic ordering.
6. Compute the snapshot sha256 and write `manifest.json`.
7. Apply retention: keep the newest `PORTAL_BACKUP_KEEP`, only matching the
   timestamp directory pattern.
8. Print one line per artifact and exit non-zero on any failure.

## Restore flow

```
validate args
  → resolve backup source (dir or .sqlite)
  → integrity_check on source
  → save portal.before-restore-<stamp>.sqlite
  → copy source over portal.sqlite
  → optionally rename media/ and extract archive
  → print next step (restart service)
```

The script never deletes the pre-restore copy automatically; the operator can
remove it after verifying the portal.

## Systemd / launchd

- Server: `josh-portal-backup.service` (oneshot) + `.timer`
  (`OnCalendar=*-*-* 04:15:00`, `Persistent=true`, `RandomizedDelaySec=300`).
- Mac: `com.halfmu.backup.plist.example` for a local launchd job.

## Pull

`scripts/pull-backups.sh`:

1. Validate `HALFMU_HOST`, `HALFMU_KEY`, `HALFMU_REMOTE_DIR`,
   `HALFMU_BACKUP_DIR`.
2. `ssh` + `tar -C <remote> -cf - backups` to stdout.
3. `tar -C <local-parent> -xf -` on the Mac.
4. Print the local path; no rsync dependency.

## Failure behaviour

- Integrity failure: keep the source snapshot untouched; exit 1.
- Interrupted copy: leave a `.partial` or `<stamp>.tmp` directory; never point
  `current` at it.
- Retention: delete only directories matching `^\d{8}-\d{6}$` under the backup
  root.

## Test plan

| Case | Expected |
| --- | --- |
| Backup a temp DB | snapshot opens; `integrity_check` ok; manifest hashes |
| Restore snapshot | DB content matches; pre-restore copy exists |
| Restore with media | media extracted; old media preserved under `*.before-restore-*` |
| Corrupt snapshot | restore refuses before replacing |
| Retention 2 | oldest timestamp dirs removed; others untouched |
| Pull without key | exits non-zero with a clear message |
