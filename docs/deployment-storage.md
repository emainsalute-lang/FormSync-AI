# Deployment storage

`ENOENT: no such file or directory, mkdir '/var/task/data'` means the SQLite backend is trying to write into a serverless deployment directory. For Vercel, use the Supabase backend and follow [the Supabase setup guide](supabase-vercel-setup.md).

The SQLite backend requires a Node server with a persistent writable disk for its database, upload offsets, processing jobs and video cache.

Deploy the included Dockerfile with a persistent disk mounted at `/app/data` and set:

```dotenv
FORMSYNC_DATA_DIR=/app/data
```

Keep one app server and its worker on that disk. Do not point this setting at `/tmp`: temporary storage cannot reliably retain sessions or share uploads across serverless instances. S3 stores video objects but does not replace the SQLite database. In Supabase mode, PostgreSQL and private object storage retain the data; temporary disk is used only during video conversion and frame decoding.
