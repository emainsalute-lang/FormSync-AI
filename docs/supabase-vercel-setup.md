# Supabase setup for FormSync on Vercel

The two public Supabase variables connect authentication. The database tables and private video bucket must also be created before uploads and saving work.

1. Open your Supabase project → SQL Editor → New query.
2. Paste and run `supabase/migrations/001_phase8_collaboration.sql` first. Skip this step if you already installed that migration; its existing policy definitions should not be recreated.
3. In another query, paste and run `supabase/migrations/002_cloud_storage.sql`.
4. Under Authentication → URL Configuration, set Site URL to `https://formsyncai.vercel.app` and allow `https://formsyncai.vercel.app/auth/callback` as a redirect URL. Add localhost redirects only if developing locally. Under Authentication → Providers → Email, turn off **Confirm email** if new accounts should be able to sign in immediately. With confirmation enabled, users must verify their email before signing in; with it disabled, the app signs them in as soon as signup succeeds. Disabling confirmation means email addresses are not verified.
5. In Vercel → Settings → Environment Variables, keep `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and add `FORMSYNC_STORAGE_BACKEND=supabase` to Production and Preview. No Firebase variables or server secret keys are required for this backend: authenticated requests use row-level security.
6. Push the code changes and redeploy. Use Node.js 24. Sign up/sign in at `/auth`; behavior follows the Email provider's **Confirm email** setting.
7. Upload a short video, wait for processing, enter a drill name, save, reload, and play the saved session. Verify a second account cannot see the first account's sessions or videos.

The SQL creates a private `formsync-videos` bucket. Check Storage → Settings for the project's global file limit; bucket settings cannot override the project's plan limit. The app accepts up to 100 MB, but your Supabase plan may permit less. Keep test clips below the configured limit.

Videos upload directly to Supabase with resumable 6 MB chunks, avoiding Vercel's request body limit. Session records, upload status, processing leases, metadata and training workspaces live in PostgreSQL. Conversion and exact-frame decoding run during authenticated requests using isolated temporary files; each scratch directory is removed afterward. Originals and H.264/AAC playback copies are stored in the private bucket. Conversion must fit the host's execution, memory and temporary disk limits. Very long clips may need a dedicated processing worker; use shorter clips if conversion times out. FFmpeg and FFprobe Linux binaries are included through Next.js output tracing.

Local SQLite mode remains available with `FORMSYNC_STORAGE_BACKEND=local` outside Vercel. Existing local sessions are not automatically imported into the Supabase database. Server-wide SQLite backup/restore, local subscription billing records, push reminders, public SQLite share links and annotated clip downloads remain features of persistent-server deployments; use Supabase's backup controls for cloud data. The cloud migration covers video upload, conversion, private playback, exact frames, frame image exports, trimming/rotation, sessions, and training workspace records.

This setup is not live until both SQL scripts have been run and the new code has been deployed. Keep database passwords and secret keys out of Git and chat.
