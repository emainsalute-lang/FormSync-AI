export const dynamic = "force-dynamic";
export async function GET() {
  return new Response(
    `FormSync AI recovery procedures

1. Stop the app and worker. Preserve the current data directory for investigation.
2. Select a completed snapshot from Storage & recovery. Local snapshots are data/backups/<snapshot-id>.
3. Set FORMSYNC_DATA_DIR to a NEW empty persistent directory.
4. Restore a local snapshot: npm run restore -- /absolute/path/to/snapshot
   Restore a cloud snapshot: npm run restore:cloud -- <snapshot-id>
   Cloud recovery uses FORMSYNC_S3_BACKUP_BUCKET (or FORMSYNC_S3_BUCKET), endpoint, region, and the AWS credential chain.
5. Restore validates SHA-256 checksums and SQLite integrity before copying. It refuses to overwrite existing data.
6. Start the app, inspect /api/health, verify sessions and wellness history, play original and optimized video, and create a new backup.

Backups include the SQLite database and registered original/optimized/thumbnail objects. Browser drafts and incomplete uploads are excluded. Restored processing/upload jobs are cancelled; originals and completed sessions remain. Pending optimization can be retried from Storage.
Default: automatic backups every 24 hours, latest 7 completed snapshots retained. Server must be running. Cloud backups are uploaded only when cloud storage is configured. A separate FORMSYNC_S3_BACKUP_BUCKET with bucket versioning provides independent recovery protection.
`,
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": "attachment; filename=formsync-recovery.txt",
      },
    },
  );
}
