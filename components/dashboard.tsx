"use client";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Play,
  ScanLine,
  LayoutDashboard,
  History,
  Upload,
  Video,
  Target,
  Flame,
  Check,
  Save,
  Search,
  ChevronRight,
  CircleHelp,
  LoaderCircle,
  Trash2,
  Plus,
} from "lucide-react";
import VideoAnalyzer from "./video-analyzer";
import CameraRecorder from "./camera-recorder";
import {
  Drawing,
  Session,
  TAGS,
  localDate,
  successRate,
  calculateSessionLoad,
} from "@/lib/model";
import { emptyEdits, type ClipEdits, type MediaInfo } from "@/lib/media-model";
import {
  readDraft,
  writeDraft,
  type DrillForm,
  type DraftSnapshot,
} from "@/lib/drafts";
import { uploadVideo, type UploadProgress } from "@/lib/upload-client";
import VoiceNoteInput from "./voice-note-input";
const blank = () => ({
  name: "",
  date: localDate(),
  makes: 0,
  misses: 0,
  reps: 0,
  target: 50,
  durationMinutes: null as number | null,
  sessionRpe: null as number | null,
  notes: "",
  tags: ["Shooting"] as string[],
});
export default function Dashboard({ ownerId = "local" }: { ownerId?: string }) {
  const [form, setFormState] = useState<DrillForm>(blank);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [file, setFile] = useState<File | null>(null),
    [src, setSrc] = useState(""),
    [videoId, setVideoId] = useState(""),
    [videoName, setVideoName] = useState("");
  const [drawings, setDrawingState] = useState<Drawing[]>([]),
    [fps, setFps] = useState(30),
    [angle, setAngle] = useState<number | null>(null);
  const [media, setMedia] = useState<MediaInfo | null>(null),
    [preparing, setPreparing] = useState(false),
    [uploadId, setUploadIdState] = useState(""),
    [uploadProgress, setUploadProgressState] = useState<UploadProgress | null>(
      null,
    ),
    [uploadStatus, setUploadStatus] = useState(""),
    [edits, setEditState] = useState<ClipEdits>(emptyEdits);
  const [editingId, setEditingId] = useState(""),
    [revision, setRevision] = useState(""),
    [dirty, setDirty] = useState(false),
    [draftReady, setDraftReady] = useState(false),
    [draftStatus, setDraftStatus] = useState("Restoring draft...");
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [notice, setNotice] = useState("");
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All drills"),
    [help, setHelp] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null),
    objectUrl = useRef(""),
    draftRevision = useRef(0),
    preparation = useRef<AbortController | null>(null),
    uploadIdRef = useRef(""),
    uploadProgressRef = useRef<UploadProgress | null>(null),
    dirtyRef = useRef(false),
    snapshot = useRef<DraftSnapshot | null>(null);
  function setUploadId(id: string) {
    uploadIdRef.current = id;
    setUploadIdState(id);
  }
  function setUploadProgress(progress: UploadProgress | null) {
    uploadProgressRef.current = progress;
    setUploadProgressState(progress);
  }
  function markDirty() {
    draftRevision.current++;
    dirtyRef.current = true;
    setDirty(true);
  }
  function setForm(next: DrillForm) {
    markDirty();
    setFormState(next);
  }
  function setDrawings(next: Drawing[]) {
    markDirty();
    setDrawingState(next);
  }
  function setEdits(next: ClipEdits) {
    markDirty();
    setEditState(next);
  }
  function releaseObjectUrl() {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = "";
    }
  }
  snapshot.current = {
    version: 1,
    form,
    file,
    videoId,
    uploadId,
    videoName,
    drawings,
    fps,
    edits,
    editingId,
    revision,
    updatedAt: new Date().toISOString(),
  };
  useEffect(
    () => () => {
      releaseObjectUrl();
      preparation.current?.abort();
      if (dirtyRef.current && snapshot.current)
        void writeDraft(snapshot.current, ownerId).catch(() => {});
    },
    [],
  );
  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/sessions");
      if (!response.ok) throw new Error("Could not load session history.");
      setSessions(await response.json());
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Could not load session history.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function prepare(
    nextFile: File | null,
    targetId: string,
    resumeUploadId = "",
  ) {
    preparation.current?.abort();
    const controller = new AbortController();
    preparation.current = controller;
    setPreparing(true);
    setUploadProgress(null);
    setMedia(null);
    setError("");
    setUploadProgress(null);
    setUploadStatus(nextFile ? "Starting upload..." : "");
    try {
      if (targetId) {
        const response = await fetch(`/api/videos/${targetId}/metadata`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Frame analysis failed.");
        if (controller.signal.aborted) return;
        setMedia(data);
        setVideoId(data.id);
        setFps(data.fps);
        setFile(null);
        setUploadId("");
        setUploadStatus("");
      } else if (nextFile) {
        const data = await uploadVideo(
          nextFile,
          resumeUploadId || uploadIdRef.current,
          controller.signal,
          (progress) => {
            setUploadId(progress.uploadId);
            setUploadProgress(progress);
            setUploadStatus(
              progress.phase === "uploading"
                ? "Uploading video"
                : "Processing video",
            );
          },
        );
        if (controller.signal.aborted) return;
        setMedia(data);
        setVideoId(data.id);
        setVideoName(data.name);
        setFps(data.fps);
        setFile(null);
        setUploadId("");
        setUploadProgress(null);
        setUploadStatus("");
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const resumable =
          !!nextFile &&
          !!(resumeUploadId || uploadIdRef.current) &&
          uploadProgressRef.current?.phase !== "processing";
        setUploadStatus(
          resumable ? "Upload paused" : "Video preparation failed",
        );
        setError(
          e instanceof Error
            ? e.message
            : "Video analysis failed. Please retry.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setPreparing(false);
        setUploadProgress(null);
      }
    }
  }
  async function cancelUpload() {
    const id = uploadIdRef.current;
    if (!id || uploadProgressRef.current?.phase !== "uploading") return;
    preparation.current?.abort();
    preparation.current = null;
    setPreparing(false);
    try {
      const response = await fetch(`/api/uploads/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Upload could not be canceled.");
      }
      releaseObjectUrl();
      setFile(null);
      setSrc("");
      setVideoId("");
      setVideoName("");
      setMedia(null);
      setUploadId("");
      setUploadProgress(null);
      setUploadStatus("Upload canceled");
      setError("");
      setNotice("Upload canceled and partial data removed.");
      markDirty();
    } catch (e) {
      setUploadStatus("Upload paused");
      setError(
        e instanceof Error ? e.message : "Upload could not be canceled.",
      );
    }
  }
  useEffect(() => {
    void load();
    let cancelled = false;
    void readDraft(ownerId)
      .then((draft) => {
        if (cancelled) return;
        if (draft) {
          setFormState({ ...blank(), ...draft.form });
          setDrawingState(draft.drawings);
          setFps(draft.fps);
          setEditState(draft.edits);
          setEditingId(draft.editingId);
          setRevision(draft.revision);
          setVideoName(draft.videoName);
          setVideoId(draft.videoId);
          setUploadId(draft.uploadId || "");
          setFile(draft.file);
          dirtyRef.current = true;
          setDirty(true);
          draftRevision.current++;
          if (draft.videoId) {
            setSrc("/api/videos/" + draft.videoId);
            void prepare(null, draft.videoId);
          } else if (draft.file) {
            objectUrl.current = URL.createObjectURL(draft.file);
            setSrc(objectUrl.current);
            void prepare(draft.file, "", draft.uploadId || "");
          }
          setNotice("Your unsaved draft has been restored.");
          setDraftStatus("Draft restored on this device");
        } else setDraftStatus("Draft autosave ready");
      })
      .catch(() => {
        if (!cancelled)
          setDraftStatus("Draft autosave unavailable in this browser");
      })
      .finally(() => {
        if (!cancelled) setDraftReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!draftReady || !dirty) return;
    const token = draftRevision.current;
    setDraftStatus("Saving draft...");
    const timer = setTimeout(() => {
      const current = snapshot.current;
      if (current)
        void writeDraft(current, ownerId)
          .then(() => {
            if (token === draftRevision.current)
              setDraftStatus("Draft saved on this device");
          })
          .catch(() =>
            setDraftStatus("Draft could not be saved. Keep this tab open."),
          );
    }, 650);
    return () => clearTimeout(timer);
  }, [
    draftReady,
    dirty,
    form,
    file,
    videoId,
    uploadId,
    videoName,
    drawings,
    fps,
    edits,
    editingId,
    revision,
  ]);
  useEffect(() => {
    const flush = () => {
      if (
        document.visibilityState === "hidden" &&
        dirtyRef.current &&
        snapshot.current
      )
        void writeDraft(snapshot.current, ownerId).catch(() => {});
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [ownerId]);
  useEffect(() => {
    const resume = () => {
      if (
        file &&
        !preparing &&
        ["Upload paused", "Video preparation failed"].includes(uploadStatus)
      )
        void prepare(file, "", uploadId);
    };
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, [file, preparing, uploadId, uploadStatus]);
  function upload(next: File) {
    if (saving || preparing || !draftReady) return;
    if (
      !["video/mp4", "video/webm", "video/quicktime"].includes(next.type) &&
      !(/\.mov$/i.test(next.name) && !next.type)
    ) {
      setError("Please choose an MP4, WebM, or MOV video.");
      return;
    }
    if (!next.size || next.size > 100 * 1024 * 1024) {
      setError("Choose a non-empty video up to 100 MB.");
      return;
    }
    markDirty();
    releaseObjectUrl();
    const accepted = next.type
      ? next
      : new File([next], next.name, { type: "video/quicktime" });
    objectUrl.current = URL.createObjectURL(accepted);
    setFile(accepted);
    setSrc(objectUrl.current);
    setVideoId("");
    setUploadId("");
    setUploadProgress(null);
    setVideoName(accepted.name);
    setUploadStatus("Starting upload...");
    setDrawingState([]);
    setEditState(emptyEdits());
    setAngle(null);
    setError("");
    setNotice("");
    void prepare(accepted, "", "");
    document
      .getElementById("workspace")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function open(session: Session) {
    if (saving || preparing || !draftReady) return;
    if (
      dirty &&
      !window.confirm(
        "Open this saved session? Your unsaved draft will be replaced.",
      )
    )
      return;
    preparation.current?.abort();
    draftRevision.current++;
    dirtyRef.current = false;
    setDirty(false);
    void writeDraft(null, ownerId).catch(() => {});
    releaseObjectUrl();
    setFormState({
      name: session.name,
      date: session.date,
      makes: session.makes,
      misses: session.misses,
      reps: session.reps,
      target: session.target,
      durationMinutes: session.durationMinutes ?? null,
      sessionRpe: session.sessionRpe ?? null,
      notes: session.notes,
      tags: session.tags,
    });
    setFile(null);
    setSrc("/api/videos/" + session.videoId);
    setVideoId(session.videoId);
    setUploadId("");
    setUploadProgress(null);
    setUploadStatus("");
    setVideoName(session.videoName);
    setDrawingState(session.drawings);
    setFps(session.fps);
    setEditState({ ...emptyEdits(), rotation: session.rotation || 0 });
    setEditingId(session.id);
    setRevision(session.revision || session.createdAt);
    setAngle(null);
    setError("");
    setDraftStatus("Saved session");
    setNotice("Session opened. Use Update session to save your changes.");
    void prepare(null, session.videoId);
    document
      .getElementById("workspace")
      ?.scrollIntoView({ behavior: "smooth" });
  }
  function reset() {
    preparation.current?.abort();
    draftRevision.current++;
    dirtyRef.current = false;
    setDirty(false);
    releaseObjectUrl();
    setFormState(blank());
    setFile(null);
    setSrc("");
    setVideoId("");
    setVideoName("");
    setUploadId("");
    setUploadProgress(null);
    setUploadStatus("");
    setDrawingState([]);
    setFps(30);
    setMedia(null);
    setPreparing(false);
    setEditState(emptyEdits());
    setEditingId("");
    setRevision("");
    setAngle(null);
    setDraftStatus("Draft autosave ready");
    void writeDraft(null, ownerId).catch(() => {});
  }
  function startNew() {
    if (saving || !draftReady) return;
    if (
      dirty &&
      !window.confirm(
        "Start a new session and discard your current unsaved draft?",
      )
    )
      return;
    reset();
    setError("");
    setNotice("New session ready.");
  }
  async function save(event?: React.FormEvent, asCopy = false) {
    event?.preventDefault();
    if (saving || preparing) return;
    setError("");
    setNotice("");
    if (!src) {
      setError("Upload a clip before saving your session.");
      return;
    }
    if (!form.name.trim()) {
      setError("Enter a drill name.");
      return;
    }
    setSaving(true);
    const token = draftRevision.current;
    try {
      const body = new FormData();
      body.set(
        "session",
        JSON.stringify({
          ...form,
          fps,
          drawings,
          ...edits,
          ...(videoId ? { videoId } : {}),
          ...(editingId && !asCopy ? { revision } : {}),
        }),
      );
      if (file && !videoId) body.set("video", file);
      const response = await fetch(
        editingId && !asCopy ? `/api/sessions/${editingId}` : "/api/sessions",
        { method: editingId && !asCopy ? "PUT" : "POST", body },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Session could not be saved.");
      setSessions((previous) =>
        [data, ...previous.filter((s) => s.id !== data.id)].sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            b.createdAt.localeCompare(a.createdAt),
        ),
      );
      if (token === draftRevision.current) {
        dirtyRef.current = false;
        setDirty(false);
        await writeDraft(null, ownerId).catch(() => {});
        setEditingId(data.id);
        setRevision(data.revision || data.createdAt);
        setVideoId(data.videoId);
        setVideoName(data.videoName);
        setFile(null);
        setDrawingState(data.drawings);
        setEditState({ ...emptyEdits(), rotation: data.rotation || 0 });
        setFps(data.fps);
        if (videoId !== data.videoId) {
          releaseObjectUrl();
          setSrc("/api/videos/" + data.videoId);
          void prepare(null, data.videoId);
        }
        setDraftStatus("Saved session");
        setNotice(
          editingId && !asCopy
            ? "Session updated."
            : "Session saved. Your clip and annotations are ready to revisit.",
        );
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Session could not be saved. Please retry.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function remove(session: Session) {
    if (saving || preparing) return;
    if (
      !window.confirm(
        `Permanently delete "${session.name}"? Its video is removed if no other session uses it.${editingId === session.id && dirty ? " Your unsaved edits to this session will also be discarded." : ""}`,
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: "DELETE",
        headers: { "If-Match": `"${session.revision || session.createdAt}"` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Session could not be deleted.");
      }
      setSessions((previous) => previous.filter((s) => s.id !== session.id));
      if (editingId === session.id) reset();
      setNotice("Session deleted.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Session could not be deleted.",
      );
    } finally {
      setSaving(false);
    }
  }
  const rate = successRate(form.makes, form.misses);
  const totalReps = sessions.reduce((sum, s) => sum + s.reps, 0);
  const totalMakes = sessions.reduce((sum, s) => sum + s.makes, 0);
  const totalMisses = sessions.reduce((sum, s) => sum + s.misses, 0);
  const overall = successRate(totalMakes, totalMisses);
  const filtered = sessions.filter(
    (s) =>
      (filter === "All drills" || s.tags.includes(filter)) &&
      `${s.name} ${s.notes} ${s.tags.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const progress = form.target
    ? Math.min(100, Math.round((form.reps / form.target) * 100))
    : 0;
  const numberField = (
    key: "makes" | "misses" | "reps" | "target",
    label: string,
  ) => (
    <label className="field-label">
      {label}
      <input
        type="number"
        min="0"
        max="100000"
        step="1"
        required
        value={form[key]}
        onChange={(e) =>
          setForm({
            ...form,
            [key]: e.target.value === "" ? 0 : Number(e.target.value),
          })
        }
      />
    </label>
  );
  return (
    <div className="app-shell">
      <aside className="rail">
        <a href="#workspace" className="brand-mark" aria-label="FormSync home">
          <img
            src="/brand/logo-black.png"
            alt=""
            className="h-auto w-8"
            width="32"
            height="7"
          />
        </a>
        <div className="rail-nav">
          <a
            href="#workspace"
            className="rail-button selected"
            aria-label="Training workspace"
            title="Training workspace"
          >
            <LayoutDashboard size={21} />
          </a>
          <a
            href="#history"
            className="rail-button"
            aria-label="Session history"
            title="Session history"
          >
            <History size={22} />
          </a>
        </div>
        <button
          className="rail-button rail-help"
          aria-label="Review tips"
          onClick={() => setHelp(!help)}
        >
          <CircleHelp size={21} />
        </button>
        <span className="avatar">FS</span>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <a className="wordmark" href="#workspace">
            <img
              src="/brand/logo-black.png"
              alt=""
              width="52"
              height="20"
              className="mr-3 inline-block h-auto w-16"
            />
            FormSync<span>AI</span>
          </a>
          <div className="topbar-right">
            <a href="/storage" className="button-ghost">
              Storage
            </a>
            <a href="/training" className="button-ghost">
              Training hub
            </a>
            <span className="workspace-chip">PERSONAL WORKSPACE</span>
            <span className="topbar-divider" />
            <span className="muted text-sm">Train with intention.</span>
          </div>
        </header>
        <main>
          <div id="workspace" className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> THE TRAINING LAB
              </div>
              <h1>
                Every rep. <span>A little better.</span>
              </h1>
              <p>Review your form. Track your work. Find your edge.</p>
            </div>
            <button
              className="button-primary"
              disabled={saving || preparing || !draftReady}
              onClick={() => uploadInput.current?.click()}
            >
              <Upload size={17} />
              Upload video
            </button>
            <button
              className="new-session-button"
              disabled={saving || preparing || !draftReady}
              onClick={startNew}
            >
              <Plus size={16} />
              New session
            </button>
            <input
              ref={uploadInput}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,.mov"
              className="hidden"
              aria-label="Upload a training video"
              onChange={(e) => {
                if (e.target.files?.[0]) upload(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </div>
          {help && (
            <div className="tips-panel">
              <strong>Get a clearer view</strong>
              <p>
                Film from a stable camera with your full body visible. Frame
                timing is detected automatically. Use the frame buttons for
                exact decoded frames, zoom and pan for a closer view, and trim
                to save only the drill. Angle measurements are manual and
                reflect your camera view.
              </p>
              <button className="text-link" onClick={() => setHelp(false)}>
                Close tips
              </button>
            </div>
          )}
          <CameraRecorder
            onRecorded={upload}
            disabled={saving || preparing || !draftReady}
          />
          {uploadStatus && (
            <div className="upload-progress-panel">
              <div className="upload-progress-heading">
                <span role="status" aria-live="polite">
                  {uploadStatus}
                </span>
                {uploadProgress?.phase === "uploading" && (
                  <span>
                    {Math.floor(
                      (uploadProgress.uploadedBytes /
                        uploadProgress.totalBytes) *
                        100,
                    )}
                    %
                  </span>
                )}
              </div>
              {uploadProgress?.phase === "uploading" && (
                <progress
                  value={uploadProgress.uploadedBytes}
                  max={uploadProgress.totalBytes}
                  aria-label="Video upload progress"
                />
              )}
              <div className="upload-progress-actions">
                {preparing &&
                  uploadId &&
                  uploadProgress?.phase === "uploading" && (
                    <button
                      className="text-link"
                      type="button"
                      onClick={() => void cancelUpload()}
                    >
                      Cancel upload
                    </button>
                  )}
                {!preparing &&
                  uploadStatus === "Upload paused" &&
                  uploadId &&
                  file && (
                    <button
                      className="text-link"
                      type="button"
                      onClick={() => void prepare(file, "", uploadId)}
                    >
                      Resume upload
                    </button>
                  )}
              </div>
            </div>
          )}
          <div className="overview-grid">
            <div className="stat-card">
              <div className="stat-icon">
                <Video size={19} />
              </div>
              <div>
                <span className="stat-label">Sessions logged</span>
                <div className="stat-value">
                  {loading ? "—" : String(sessions.length).padStart(2, "0")}
                  <span>Total practice sessions</span>
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon cyan">
                <Target size={20} />
              </div>
              <div>
                <span className="stat-label">Overall success</span>
                <div className="stat-value">
                  {overall === null ? "—" : overall + "%"}
                  <span>{totalMakes + totalMisses} tracked attempts</span>
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon orange">
                <Flame size={20} />
              </div>
              <div>
                <span className="stat-label">Work put in</span>
                <div className="stat-value">
                  {loading ? "—" : totalReps.toLocaleString()}
                  <span>Reps across all sessions</span>
                </div>
              </div>
            </div>
          </div>
          <div className="workspace-grid">
            <VideoAnalyzer
              src={src}
              name={videoName}
              fps={fps}
              media={media}
              preparing={preparing}
              disabled={saving || preparing || !draftReady}
              edits={edits}
              onEdits={setEdits}
              onRetry={() => void prepare(file, videoId)}
              drawings={drawings}
              onChange={setDrawings}
              onUpload={upload}
              onAngle={setAngle}
            />
            <aside className="session-sidebar">
              <section className="panel">
                <div className="panel-heading">
                  <div className="flex items-center gap-3">
                    <span className="tiny-label">02</span>
                    <h2>Session details</h2>
                  </div>
                  <span className="draft-pill">
                    {editingId ? "EDITING" : "DRAFT"}
                  </span>
                </div>
                <form
                  onSubmit={(event) => void save(event)}
                  className="session-form"
                >
                  <fieldset
                    disabled={saving || preparing || !draftReady}
                    className="form-fields"
                  >
                    <label className="field-label">
                      Drill name
                      <input
                        required
                        maxLength={100}
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                        placeholder="e.g. Jump Shot Form Check"
                      />
                    </label>
                    <label className="field-label">
                      Practice date
                      <input
                        type="date"
                        required
                        value={form.date}
                        onChange={(e) =>
                          setForm({ ...form, date: e.target.value })
                        }
                      />
                    </label>
                    <div className="field-label">
                      Drill tags
                      <div className="tag-options">
                        {TAGS.map((tag) => (
                          <button
                            type="button"
                            key={tag}
                            className={`tag ${form.tags.includes(tag) ? "selected" : ""}`}
                            aria-pressed={form.tags.includes(tag)}
                            onClick={() =>
                              setForm({
                                ...form,
                                tags: form.tags.includes(tag)
                                  ? form.tags.filter((t) => t !== tag)
                                  : [...form.tags, tag],
                              })
                            }
                          >
                            {form.tags.includes(tag) && <Check size={12} />}{" "}
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="form-divider" />
                    <div className="form-subheading">
                      Performance log <Target size={15} />
                    </div>
                    <div className="field-grid">
                      {numberField("makes", "Makes")}
                      {numberField("misses", "Misses")}
                      {numberField("reps", "Reps completed")}
                      {numberField("target", "Target reps")}
                    </div>
                    <div className="form-divider" />
                    <div className="form-subheading">
                      Session effort & duration
                    </div>
                    <div className="field-grid">
                      <label className="field-label">
                        Session duration (minutes)
                        <input
                          type="number"
                          min="0"
                          max="1440"
                          step="0.5"
                          placeholder="Not logged"
                          value={form.durationMinutes ?? ""}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              durationMinutes:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="field-label">
                        Session RPE (0–10)
                        <input
                          type="number"
                          min="0"
                          max="10"
                          step="0.5"
                          placeholder="Not logged"
                          value={form.sessionRpe ?? ""}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              sessionRpe:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <p className="muted text-sm">
                      Rate the whole practice session, separately from
                      individual sets. 0 = no effort, 10 = maximum effort.
                      Duration covers the full session, not just this video.
                    </p>
                    <div className="session-load-readout">
                      <span>Session load</span>
                      <output aria-label="Calculated session load">
                        {calculateSessionLoad(
                          form.durationMinutes,
                          form.sessionRpe,
                        ) === null
                          ? "Not logged"
                          : calculateSessionLoad(
                              form.durationMinutes,
                              form.sessionRpe,
                            ) + " AU"}
                      </output>
                    </div>
                    <p className="muted text-sm">
                      Load = duration in minutes × session RPE.
                    </p>
                    <label className="field-label" htmlFor="personal-notes">
                      Personal notes
                    </label>
                    <VoiceNoteInput
                      id="personal-notes"
                      rows={3}
                      maxLength={5000}
                      value={form.notes}
                      onTranscript={(transcript) =>
                        setForm({
                          ...form,
                          notes:
                            `${form.notes}${form.notes ? " " : ""}${transcript}`.slice(
                              0,
                              5000,
                            ),
                        })
                      }
                      onChange={(e) =>
                        setForm({ ...form, notes: e.target.value })
                      }
                      placeholder="What clicked? What needs work?"
                    />
                  </fieldset>
                  <button
                    className="button-primary save-button"
                    disabled={saving || preparing || !src || !draftReady}
                    type="submit"
                  >
                    {saving ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Save size={17} />
                    )}{" "}
                    {saving
                      ? "Saving session..."
                      : preparing
                        ? "Preparing video..."
                        : editingId
                          ? "Update session"
                          : "Save session"}
                  </button>
                  {editingId && (
                    <button
                      type="button"
                      className="copy-session text-link"
                      disabled={saving || preparing}
                      onClick={() => void save(undefined, true)}
                    >
                      Save a copy
                    </button>
                  )}
                  <p className="save-caption" aria-live="polite">
                    {draftStatus}
                  </p>
                </form>
              </section>
              <section className="panel metrics-panel">
                <div className="metrics-heading">
                  <ScanLine size={16} />
                  <h2>Live metrics</h2>
                  <span className="muted text-xs">MANUAL REVIEW</span>
                </div>
                <div className="live-metrics">
                  <div>
                    <span className="stat-label">Joint angle</span>
                    <strong>
                      {angle === null ? "—" : angle.toFixed(1) + "\u00b0"}
                    </strong>
                    <span className="muted text-xs">
                      {angle === null
                        ? "Use the angle tool"
                        : "Current frame measurement"}
                    </span>
                  </div>
                  <div>
                    <span className="stat-label">Success rate</span>
                    <strong className="lime-text">
                      {rate === null ? "—" : rate + "%"}
                    </strong>
                    <span className="muted text-xs">
                      {form.makes + form.misses} attempts
                    </span>
                  </div>
                </div>
                <div className="rep-progress">
                  <div>
                    <span>Rep target</span>
                    <span>
                      {form.reps} / {form.target}
                    </span>
                  </div>
                  <progress
                    value={progress}
                    max={100}
                    aria-label="Rep target completion"
                  />
                </div>
              </section>
            </aside>
          </div>
          {error && (
            <div className="feedback error-feedback" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="feedback success-feedback" role="status">
              <Check size={17} />
              {notice}
            </div>
          )}
          <section id="history" className="history-section">
            <div className="history-heading">
              <div>
                <div className="eyebrow">THE WORK ADDS UP</div>
                <h2>
                  Practice history <span>{sessions.length}</span>
                </h2>
              </div>
              <div className="history-filters">
                <label className="search-box">
                  <Search size={16} />
                  <input
                    aria-label="Search practice history"
                    placeholder="Search sessions…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter drill tags"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  {["All drills", ...TAGS].map((tag) => (
                    <option key={tag}>{tag}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="panel history-panel">
              {loadError ? (
                <div className="history-empty" role="alert">
                  <p>{loadError}</p>
                  <button className="text-link" onClick={() => void load()}>
                    Retry loading history
                  </button>
                </div>
              ) : loading ? (
                <div className="history-empty">
                  <LoaderCircle size={22} className="spin" />
                  <p>Loading your sessions…</p>
                </div>
              ) : filtered.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>DRILL / VIDEO</th>
                        <th>DATE</th>
                        <th>TAGS</th>
                        <th>REPS</th>
                        <th>SUCCESS</th>
                        <th>
                          <span className="sr-only">Open session</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <div className="drill-cell">
                              <span className="history-video-icon">
                                <Play size={17} />
                              </span>
                              <div>
                                <strong>{s.name}</strong>
                                <span>{s.videoName}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            {new Intl.DateTimeFormat("en", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }).format(new Date(s.date + "T12:00:00"))}
                          </td>
                          <td>
                            <div className="history-tags">
                              {s.tags.length ? (
                                s.tags.map((t) => <span key={t}>{t}</span>)
                              ) : (
                                <span>Untagged</span>
                              )}
                            </div>
                          </td>
                          <td>
                            {s.reps}
                            <span className="muted"> / {s.target}</span>
                          </td>
                          <td>
                            <span className="success-pill">
                              {successRate(s.makes, s.misses) === null
                                ? "—"
                                : successRate(s.makes, s.misses) + "%"}
                            </span>
                          </td>
                          <td>
                            <button
                              className="open-session"
                              disabled={saving || !draftReady}
                              onClick={() => open(s)}
                              aria-label={`Open ${s.name}`}
                            >
                              Review <ChevronRight size={15} />
                            </button>
                            <button
                              className="delete-session icon-button"
                              disabled={saving}
                              onClick={() => void remove(s)}
                              aria-label={`Delete ${s.name}`}
                              title="Delete session"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="history-empty">
                  <History size={27} />
                  <h3>
                    {sessions.length
                      ? "No matching sessions"
                      : "Your progress starts here."}
                  </h3>
                  <p>
                    {sessions.length
                      ? "Try another search or drill tag."
                      : "Save your first drill to build a history of your work."}
                  </p>
                </div>
              )}
            </div>
          </section>
          <footer className="page-footer">
            <span>
              <Activity size={15} /> FORMSYNC AI
            </span>
            <p>Small adjustments. Lasting progress.</p>
            <span className="muted">Video review + training hub</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
