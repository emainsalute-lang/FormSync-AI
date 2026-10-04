# FormSync AI — Video review & training hub

A Next.js App Router, TypeScript and Tailwind CSS workspace for sports video review, automatic pose measurements, and practice tracking.

## Start

On this Windows checkout, double-click **Start FormSync.cmd**. It uses the workspace-local Node.js runtime and starts the development server. Open http://127.0.0.1:3000.

With Node.js 24 LTS installed globally:

```powershell
npm ci
npm run dev
```

For the portable Node runtime already in this workspace:

```powershell
$nodeDir = (Get-ChildItem .tools -Directory -Filter 'node-*-win-x64' | Select-Object -First 1).FullName
$env:Path = "$nodeDir;$env:Path"
npm run dev
```

Production mode:

```powershell
npm run build
npm start
```

## Phase 1 features

1. **Automatic frame detection:** FFprobe indexes decoded frame timestamps, detects fractional frame rates, and identifies variable timing. Original session videos are indexed lazily when opened.
2. **Precise stepping:** Previous/next frame buttons request the selected decoded frame as a PNG. They do not approximate a frame by adding `1 / FPS` to browser playback time. Frame processing can take a moment on larger clips.
3. **Trimming:** Set start/end seconds or use the current playhead. Saving produces a real H.264 MP4 containing the selected whole frames, with audio trimmed when present. Start/end boundaries snap inward to complete frames. Annotations outside the selection are excluded and retained annotations are mapped to the corresponding output frames.
4. **Rotation:** Rotate clockwise in 90-degree increments. The review surface and markup rotate together. On saving, the orientation is applied to the video file and annotation coordinates are remapped. Subsequent playback needs no extra rotation.
5. **Zoom and pan:** Inspect at 100–400%, select Pan to drag, and reset the view. Markup stays attached to source coordinates rather than screen pixels.
6. **Draft autosave:** Unsaved form fields, edits, annotations and video references are saved in IndexedDB after a short debounce. A video file is included while upload preparation is pending. Drafts restore automatically on the same device and browser origin; successful saving or starting a new session clears the draft. Browser quota or availability failures are shown in the form.
7. **Session editing:** Open a session and use Update session to modify it in place. Save a copy retains the earlier record. Revision checks reject stale edits from another tab instead of overwriting newer changes.
8. **Confirmed deletion:** Delete a session from history after confirmation. Its video and index are removed only when no remaining saved session references them. Stale deletions are rejected.
9. **Annotated PNG export:** Export the current decoded frame at native resolution with visible annotations and rotation. Export includes the full frame, independently of inspection zoom/pan.
10. **Keyboard guide:** Use the Shortcuts button or `?` while focused in the video workspace. Form typing keeps its normal keyboard behavior.

## Shortcuts

| Key                  | Action                            |
| -------------------- | --------------------------------- |
| Space                | Play/pause                        |
| Left / Right         | Previous/next decoded frame       |
| Shift + Left / Right | Step ten decoded frames           |
| V / P / L / A / H    | Select / pen / line / angle / pan |
| R                    | Rotate clockwise                  |
| + / - / 0            | Zoom in / out / reset             |
| I / O                | Set trim start/end at playhead    |
| E                    | Export annotated frame            |
| Ctrl or Cmd + Z      | Undo annotation                   |
| Escape               | Cancel unfinished markup          |
| ?                    | Open shortcut guide               |

## Architecture

- `components/dashboard.tsx`: upload preparation, draft lifecycle, drill form, session CRUD, history and metrics.
- `components/video-analyzer.tsx`: playback, exact-frame review, drawing, transformed viewport, trim controls, image export and shortcuts.
- `lib/model.ts`: session and drawing types, joint-angle calculations and practice metrics.
- `lib/media-model.ts`: frame timing, frame lookup, viewport coordinate conversion, trim mapping and rotation mapping.
- `lib/canvas.ts`: shared annotation rendering for preview and PNG export.
- `lib/drafts.ts`: ordered IndexedDB writes for one device-local unsaved draft.
- `lib/upload-client.ts`: chunked upload transfer, offset-based resume, progress, processing polling, and cancellation.
- `lib/validation.ts`: field, upload and edit validation.
- `lib/storage.ts`: atomic filesystem session records and cross-process mutation locking.
- `lib/media-service.ts`: bounded FFmpeg/FFprobe subprocesses for indexing, decoding and clip rendering. Processes run without a shell and without visible Windows console windows.
- `lib/session-service.ts`: shared creation/update logic, revision checks and reference-aware video cleanup.
- `app/api/media`: multipart video preparation and indexing.
- `app/api/sessions`: history listing and session creation.
- `app/api/sessions/[id]`: revision-checked updates and deletion.
- `app/api/videos/[id]`: byte-range video streaming.
- `app/api/videos/[id]/metadata`: native dimensions, frame timing and detected FPS.
- `app/api/videos/[id]/frame?index=N`: decoded PNG for an exact frame index.

## Persistence and limits

Saved records, video files and frame indices live under `data/sessions`, `data/videos`, and `data/metadata`. Set `FORMSYNC_DATA_DIR` to use another persistent directory. The directory is excluded from Git; back it up with the application stopped or use a filesystem snapshot.

Prepared source uploads are retained so unfinished drafts can be restored. They are distinct from saved session records. The deletion workflow removes unreferenced saved videos; it does not purge unrelated staged uploads automatically.

Upload limit: **100 MB**. Analysis accepts up to **30 minutes**, **250,000 frames**, and **16 megapixels per frame**. Decode/process operations have output and time bounds. Browser codec support varies; H.264 MP4 or WebM is the safest starting point. Unsupported or malformed files receive recoverable errors.

Video uploads use resumable 4 MiB chunks. Transfer progress and cancellation are available in the dashboard; interrupted uploads retain their offset and can resume from the saved browser draft. Once the server begins video processing, cancellation is no longer available.

Optional S3-compatible storage is configured with `FORMSYNC_S3_BUCKET`, `FORMSYNC_S3_REGION`, and (for providers such as Cloudflare R2) `FORMSYNC_S3_ENDPOINT`. Use the standard AWS SDK credential chain, such as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, and set `FORMSYNC_S3_PATH_STYLE=true` only when required by the provider. Without a bucket, videos are stored locally. The `/api/health` response reports the configured storage mode; it does not verify remote bucket connectivity. Set `FORMSYNC_BACKUP_DIR` to choose where scheduled, checksummed snapshots are stored. For disaster recovery, place that directory on storage independent of the application data volume.

FFmpeg and FFprobe are installed as platform binaries through npm dependencies. Optionally set `FORMSYNC_FFMPEG_PATH` and `FORMSYNC_FFPROBE_PATH` to trusted local executable paths. Dependency installs must allow the FFmpeg binary installation step.

## Authentication and coach collaboration

Supabase Auth and Phase 8 collaboration are optional. Without Supabase settings, the app keeps its local single-user behavior. To enable athlete accounts and coach/team features:

1. Create a Supabase project and apply `supabase/migrations/001_phase8_collaboration.sql` in its SQL editor (or through the Supabase CLI).
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the server environment and rebuild/restart the app. Only the public URL and publishable/anon key belong here; never expose a service-role key.
3. Configure Supabase Auth email verification and allow the app’s `/auth/callback` URL in the project’s redirect URL settings.
4. Sign up athletes, then invite coaches from the Teams area. Coach accounts become active by accepting an invitation addressed to their verified email.

Authenticated sessions, media, resumable uploads, and training workspaces are scoped by user. Coaches can view sessions only for athletes with active athlete-controlled access; coach session mutations and upload access are denied. Existing local sessions without an owner are intentionally not claimed for any Supabase account, so make a verified backup before enabling Auth and plan a deliberate owner migration if those records must move.

The SQLite database and video files still require a persistent Node server/container and shared durable storage. Do not deploy multiple app instances against ephemeral or separate local filesystems. Static hosting, serverless filesystems and Cloudflare Workers cannot run this backend. Supabase stores identities and collaboration records; it does not replace the app’s persistent media volume.

Manual angles and automatic pose angles are 2D camera-view measurements. Pose detection is available in the training hub; validated coaching scores and generative AI coaching remain pending.

## Phase 9 — Mobile training

- The app is installable as a PWA. Its service worker caches the app shell and static assets, but deliberately does **not** cache authenticated API responses. Unsaved video/session drafts are stored in IndexedDB under a user-specific key; interrupted uploads resume when connectivity returns. Server records and video processing remain online features.
- Record from the phone camera with the existing camera-position guide. Voice notes use the browser Speech Recognition API when available; browser implementations may process speech remotely, according to that browser’s privacy policy.
- Enable daily push reminders from **Profile & reports** after configuring `FORMSYNC_VAPID_PUBLIC_KEY`, `FORMSYNC_VAPID_PRIVATE_KEY`, and `FORMSYNC_VAPID_SUBJECT`. Generate a VAPID pair with `npx web-push generate-vapid-keys`. Keep the private key server-side. Reminders are dispatched by the continuously running app worker in the configured local time zone; a stopped server cannot send reminders.
- Import wearable workout exports in TCX, GPX, or CSV form. CSV headers can include `date`, `activity`, `duration_seconds`, `distance_meters`, `calories`, and `average_heart_rate`. Binary FIT files and direct Garmin/Apple/Fitbit account connections are not included.
- The Practice calendar supports a downloadable `.ics` export and a revocable private iCalendar subscription URL. Add that URL to a calendar provider; the provider controls refresh timing. The feed grants read access to scheduled workout names/dates to anyone holding its URL.
- Share a saved clip using an expiring or non-expiring read-only link in **Reviews**. Share links expose only that session’s clip and summary; revoking or expiring the link immediately blocks further requests.

## Phase 10 — Production readiness

- Optional Stripe subscriptions are configured with `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FORMSYNC_STRIPE_PRICE_PRO`, and `FORMSYNC_STRIPE_PRICE_TEAM`. Register `/api/webhooks/stripe` for checkout completion, subscription created/updated/deleted, and invoice payment failure events. Billing UI offers Checkout, the Stripe customer portal, and invoices. No subscription prices or keys are embedded in the app.
- The default account limits are Free: 2 GB / 100 sessions / 10 analyses / 10 workouts; Pro: 50 GB / 5,000 sessions / 100 analyses / 100 workouts; Team: 250 GB / 50,000 sessions / 100 analyses / 100 workouts. Paid limits activate only after a verified Stripe subscription event. The installation’s storage quota remains a separate hard ceiling and may be lower than a plan allowance.
- SQLite-backed request limits protect session edits/deletes, uploads/chunks, frame rendering, exports, share links, calendar-feed rotation, and billing actions. Failed background jobs retry automatically; the `/admin` operations dashboard can inspect/retry jobs and create a backup. Protect it with a strong `FORMSYNC_ADMIN_TOKEN`.
- Operational failures are retained locally. Set `FORMSYNC_ALERT_WEBHOOK` to an HTTPS incident webhook for error alerts. Minimal daily workflow counters are aggregated locally for sessions, uploads, movement analyses, workout completion, sharing, and billing; no external analytics service receives video or movement data.
- Run `npm run ops:check` before deployment to validate paired provider settings, backup-directory writability, and an optional authenticated health endpoint (`FORMSYNC_HEALTH_URL` plus `FORMSYNC_HEALTH_TOKEN`). Run `npm run security:check` for the dependency audit. GitHub Actions runs the audit, typecheck, unit tests, production build, and configuration check.
- Place backups outside the application data volume. `/admin` can create an on-demand checksummed snapshot; `npm run backup` and `npm run restore` support recovery. Validate restores regularly rather than treating successful backup creation as proof of recovery.

## Verification

```powershell
npm run typecheck
npm test
npm run build
npm run ops:check
npm run security:check
npx playwright install chromium
npm run test:e2e
```

Playwright starts a production server on port 3001 with isolated storage in `.tools/qa-data`. The browser tests cover the original workflow and all ten Phase 1 features, including draft restoration, actual media processing, native PNG dimensions, stale-update rejection, delete cancellation, and phone-width overflow. Screenshots go to `.tools/screenshots`.

Media processing uses the official [FFprobe](https://ffmpeg.org/ffprobe.html) and [FFmpeg](https://ffmpeg.org/ffmpeg-all.html) interfaces. The server follows Next.js [Route Handler](https://nextjs.org/docs/app/api-reference/file-conventions/route) and [external package](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) conventions.

## Training hub

Open **Training hub** from the dashboard, or visit `/training`.

- **Progress:** daily repetitions and weighted success percentages, practice dates, last-seven-day consistency, and personal bests. Empty attempts are not counted as 0% success.
- **Plans & goals:** persistent date-bounded goals for reps, sessions, or success; filter by drill tag; dated practice plans; completion checklists and overdue/due reminders while the app is open.
- **Practice:** searchable starter drills, custom drill instructions and saved-session demonstration clips; reusable workout templates with ordered drills, sets, reps and rest; a weekly workout calendar; set tracking, a rest countdown, and post-workout effort/fatigue ratings. Rule-based practice suggestions use recent logged effort, fatigue and outcomes; they are prompts, not validated coaching advice.
- **Movement:** MediaPipe Pose Landmarker Lite runs in a Web Worker using local model/WASM assets. Source frames are decoded by the local server, scaled for inference, and analyzed on this device. No video is sent to Google. It samples up to 120 evenly spaced decoded frames, aiming for about two samples per second on short clips. Longer videos have sparser sampling and take longer because exact-frame decoding starts at the beginning of the source. Cancel stops worker processing and requests. Results persist with the session revision; editing a session invalidates its analysis. Supports one athlete, skeleton playback, six joint measurements, frame/joint confidence, camera-visibility checks, manual correction of selected joints at sampled frames, angle charts and user-selected comparison ranges. Squat repetition counts are estimates based on configurable joint-angle thresholds; angular velocity is angular change per second, not limb speed. These 2D measurements and visibility warnings are not validated coaching scores.
- **Sport analysis templates:** basketball shooting, squat, lunge, jump, sprint stride, footwork rhythm and tennis serve templates report measured joint-angle ranges, sampled movement-cycle intervals and manually marked phase angles. Basketball release markers report a forearm-orientation proxy and within-clip consistency, not a detected ball release or ball-flight angle. Custom templates save a tracked joint and selectable phase names. Phase marks are manual; this does not automatically recognize shot/serve phases, ladder contacts or takeoff/landing.
- **Compare:** side-by-side saved clips, synchronized play/pause, speeds, timeline, alignment offset, drift correction and overlap boundaries. Alignment is manual; it does not automatically identify drill phases.
- **Reviews:** local comments labeled by the athlete profile, and annotated MP4 export. Names are labels, not authenticated coach accounts. Export burns in manual pen/line/angle markup at decoded-frame timing. Limits: three minutes, longest edge 1920px, 100 annotations, 50,000 pen points, 150 MB output. Pose skeletons are not burned into the MP4.
- **Profile & reports:** athlete name, primary sport, general filming/review guidance for basketball, running, strength or general practice; CSV exports, JSON record exports, printable reports with browser Save as PDF, and storage health status.
- **Storage:** the Storage tab reports local/cloud mode, used and in-flight reserved bytes against the configured quota, thumbnail/optimized-preview readiness, and recent upload/processing states. Quota limits apply to video uploads. Quotas are configurable from 100 MiB to 1 TiB. Retention is off by default; a nonzero age permanently deletes old video assets, including videos referenced by saved sessions. Reduce retention only when that data loss is acceptable. Thumbnail and optimized MP4 assets are served through the video asset route; optimized playback supports byte ranges.
- **Camera:** record up to two minutes without audio, then prepare the recording in the original video workspace. Requires a supporting browser on localhost or HTTPS and camera permission. Camera tracks stop on closing, finishing, and unmounting.
- **Install/offline:** production builds register a service worker and provide app icons/manifest. Supported browsers offer Install FormSync. The previously loaded training hub and last refreshed training records can be viewed offline, with an explicit snapshot banner. Writes, video streaming, pose processing and reports need the server. This does not provide offline video editing or background push reminders. Caches are local to the browser origin.

Training data lives in `data/workspace.json`. Writes validate fields, use the existing mutation lock and atomic file replacement, and reject stale revisions. Session deletion removes linked comments and analyses; failures are logged and obsolete records are filtered on hub load. Cached snapshots refresh after successful browser mutations. `/api/health` checks readable session/workspace storage; it is not external uptime monitoring.

The local inference runtime is pinned in `package-lock.json`, with its browser assets included under `public/pose`. See the official [MediaPipe Web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) and [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps). The browser test uses the official MediaPipe sample image from `https://storage.googleapis.com/mediapipe-assets/pose.jpg` solely as a test fixture.

## Backups and container deployment

```powershell
npm run backup
# Optional explicit empty destination:
npm run backup -- .tools/backups/my-snapshot
# Restore into a NEW empty data directory with the app stopped:
$env:FORMSYNC_DATA_DIR = '.tools/restored-data'
npm run restore -- .tools/backups/my-snapshot
```

Backups copy saved session records, referenced videos/indices, and training data while holding the session mutation lock. SHA-256 checksums detect corruption. Restoration validates paths/checksums and refuses to overwrite a nonempty directory. Unfinished browser drafts and unrelated staged uploads are excluded. Copy backup folders to independent storage yourself; this is not a scheduled cloud backup service.

A `Dockerfile` and `compose.yaml` provide a persistent Node/FFmpeg deployment, bound to localhost on the host with a named data volume and health checks:

```sh
docker compose up --build -d
```

The container recipe is provided but has not been executed in this Windows environment. Static/serverless hosting remains incompatible with the filesystem/subprocess backend. Docker installs system FFmpeg and uses executable overrides.

## Still pending

Cloud authentication, private account ownership, cross-device sync, coach/team roles, remote review links, push/email reminders, automatic drill-phase recognition, validated sport-specific form scoring, ball trajectory/release detection, ladder-contact detection and personalized AI coaching are not implemented. They need a chosen identity/storage/hosting setup and, for scoring, defined and validated sport-specific criteria. Do not expose this single-user app as a public multi-user service.

The repository has no complete 100-feature roadmap, so this build does not claim all 100 features are complete. Phase 1 remains implemented, with the additional local capabilities above.

## Wellness and session load

The training hub's **Wellness** tab implements daily check-ins, previous-night sleep duration, sleep quality, muscle soreness, stress, mood, bodyweight history, and same-date comparisons against repetitions, success rates, or training load. There is one editable check-in per calendar date, with confirmed deletion. Measurements can be left unreported; at least one measurement is needed to save. Sleep is 0–24 hours, bodyweight is 1–500 kg, and ratings are integers from 1–5. Higher quality/mood means better; higher soreness/stress means more discomfort/stress. Weight charts use calendar dates, not evenly spaced weigh-in indices.

The session form has independent **Session duration (minutes)** and **Session RPE (0–10)** fields. They describe the full practice session, independently of the video length and individual set ratings. Duration accepts 0–1440 minutes; RPE accepts 0–10, including fractional ratings. **Session load = minutes × session RPE**, expressed in arbitrary units (AU), following the [session-RPE method](https://pubmed.ncbi.nlm.nih.gov/15179175/). The server derives load rather than trusting a client-provided result. Both fields must be reported to calculate load; a reported zero remains zero. Older sessions retain missing values rather than receiving invented measurements.

Daily comparisons use the same saved calendar date. Success is weighted by makes/misses, repetitions are summed, and load totals include only sessions with both inputs. The table reports load coverage (for example, 2/3 sessions) so partial reporting is visible. Unreported measurements and days without training are excluded from scatter plots, not converted to zero. Interactive metric/date filters, a bodyweight trend, and the underlying tables provide the comparisons. These displays show associations, not causal conclusions or medical recommendations.

Wellness records persist in `workspace.json` with revision checks and validation of unique dates/IDs. Legacy workspace files default to an empty wellness list; older API clients that omit the new field preserve current wellness data. Session updates that omit duration/RPE preserve previous values, while explicit `null` clears them. Existing browser drafts are migrated with blank defaults for the new fields.

Wellness has its own CSV export. Session CSV exports include minutes, session RPE and computed load; printable reports and JSON/full backups include the new records. Offline cached training data includes wellness, with writes disabled until reconnected. No individual-set logger is introduced by this change: session RPE is its own field and is never inferred from set ratings.
