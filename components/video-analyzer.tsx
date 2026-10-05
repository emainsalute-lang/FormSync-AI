"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Undo2,
  Trash2,
  PenLine,
  MousePointer2,
  Ruler,
  Minus,
  Upload,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Hand,
  Download,
  Keyboard,
  Scissors,
  LoaderCircle,
} from "lucide-react";
import { jointAngle, timeLabel, type Drawing, type Point } from "@/lib/model";
import {
  nearestFrame,
  screenToVideo,
  type ClipEdits,
  type MediaInfo,
  type Rotation,
} from "@/lib/media-model";
import { drawAnnotations } from "@/lib/canvas";
type Tool = "select" | "pen" | "line" | "angle" | "pan";
type Props = {
  src: string;
  name: string;
  fps: number;
  media: MediaInfo | null;
  preparing: boolean;
  preparationError?: string;
  disabled: boolean;
  edits: ClipEdits;
  onEdits: (edits: ClipEdits) => void;
  drawings: Drawing[];
  onChange: (drawings: Drawing[]) => void;
  onUpload: (file: File) => void;
  onAngle: (angle: number | null) => void;
  onRetry: () => void;
};
const COLORS = ["#b7f76b", "#55d8f5", "#ffaf67"];
export default function VideoAnalyzer({
  src,
  name,
  fps,
  media,
  preparing,
  preparationError = "",
  disabled,
  edits,
  onEdits,
  drawings,
  onChange,
  onUpload,
  onAngle,
  onRetry,
}: Props) {
  const plane = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null),
    input = useRef<HTMLInputElement>(null),
    guide = useRef<HTMLDialogElement>(null);
  const [tool, setTool] = useState<Tool>("select"),
    [color, setColor] = useState(COLORS[0]),
    [speed, setSpeed] = useState(1),
    [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 1920, height: 1080 }),
    [draft, setDraft] = useState<Drawing | null>(null),
    [undo, setUndo] = useState<Drawing[][]>([]),
    [error, setError] = useState(""),
    [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [decoded, setDecoded] = useState(""),
    [decoding, setDecoding] = useState(false),
    [exporting, setExporting] = useState(false);
  const draftRef = useRef<Drawing | null>(null),
    timeRef = useRef(0),
    decodedRef = useRef(""),
    frameRequest = useRef<AbortController | null>(null),
    generation = useRef(0),
    frameIndex = useRef(0),
    panStart = useRef<{
      x: number;
      y: number;
      pan: { x: number; y: number };
    } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const quarter = edits.rotation === 90 || edits.rotation === 270;
  const fitScale =
    viewport.width && viewport.height
      ? Math.min(
          viewport.width / (quarter ? dimensions.height : dimensions.width),
          viewport.height / (quarter ? dimensions.width : dimensions.height),
        )
      : 1;
  const effectiveDuration = media?.duration || duration;
  const end = edits.trimEnd ?? effectiveDuration;
  const available = ready && !disabled;
  const exactReady = available && !!media?.frames.length && !decoding;
  const visible = drawings.filter((d) =>
    media
      ? nearestFrame(media.frames, d.time) === nearestFrame(media.frames, time)
      : Math.abs(d.time - time) <= 0.55 / fps,
  );
  const angle = visible.filter((d) => d.tool === "angle").at(-1);
  const angleValue = angle
    ? jointAngle(angle.points, dimensions.width, dimensions.height)
    : null;
  useEffect(() => onAngle(angleValue), [angleValue, onAngle]);
  const clearDecoded = useCallback(() => {
    generation.current++;
    frameRequest.current?.abort();
    frameRequest.current = null;
    if (decodedRef.current) URL.revokeObjectURL(decodedRef.current);
    decodedRef.current = "";
    setDecoded("");
    setDecoding(false);
  }, []);
  const updateDraft = (next: Drawing | null) => {
    draftRef.current = next;
    setDraft(next);
  };
  useEffect(() => {
    clearDecoded();
    setReady(false);
    setDuration(0);
    setTime(0);
    timeRef.current = 0;
    setPlaying(false);
    setUndo([]);
    updateDraft(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setError("");
    frameIndex.current = 0;
    return () => {
      frameRequest.current?.abort();
    };
  }, [src, clearDecoded]);
  useEffect(
    () => () => {
      if (decodedRef.current) URL.revokeObjectURL(decodedRef.current);
    },
    [],
  );
  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed, ready]);
  useEffect(() => {
    if (!media) return;
    setDuration(media.duration);
    if (!ready) return;
    frameIndex.current = nearestFrame(media.frames, timeRef.current);
  }, [media, ready]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    drawAnnotations(ctx, visible, el.width, el.height);
    if (draft) drawAnnotations(ctx, [draft], el.width, el.height);
  }, [drawings, draft, time, fps, dimensions, media]);
  const commit = (next: Drawing[]) => {
    setUndo((previous) => [...previous.slice(-49), drawings]);
    onChange(next);
  };
  const undoDrawing = () => {
    if (disabled) return;
    if (draftRef.current) {
      updateDraft(null);
      return;
    }
    const last = undo.at(-1);
    if (last) {
      onChange(last);
      setUndo(undo.slice(0, -1));
    }
  };
  const syncTime = () => {
    const el = video.current;
    if (!el || decodedRef.current) return;
    const current = Math.max(
      edits.trimStart,
      Math.min(end || el.duration, el.currentTime),
    );
    timeRef.current = current;
    setTime(current);
    if (media) frameIndex.current = nearestFrame(media.frames, current);
  };
  useEffect(() => {
    const el = video.current;
    if (!el || !playing) return;
    let handle = 0;
    const tick = () => {
      if (el.currentTime >= end && end > 0) {
        el.pause();
        el.currentTime = end;
        timeRef.current = end;
        setTime(end);
        setPlaying(false);
        return;
      }
      timeRef.current = el.currentTime;
      setTime(el.currentTime);
      if (media)
        frameIndex.current = nearestFrame(media.frames, el.currentTime);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, end, media]);
  const seek = (value: number) => {
    const el = video.current;
    if (!el || !available) return;
    el.pause();
    clearDecoded();
    el.currentTime = Math.max(
      edits.trimStart,
      Math.min(end || effectiveDuration, value),
    );
    timeRef.current = el.currentTime;
    setTime(el.currentTime);
    if (media) frameIndex.current = nearestFrame(media.frames, el.currentTime);
    updateDraft(null);
  };
  const step = async (direction: number) => {
    const el = video.current;
    if (!el || !exactReady || !media) return;
    el.pause();
    updateDraft(null);
    const lower = media.frames.findIndex(
      (t) => t >= edits.trimStart - 0.000001,
    );
    let upper = media.frames.length - 1;
    while (upper > 0 && media.frames[upper] >= end) upper--;
    const index = Math.max(
      Math.max(0, lower),
      Math.min(upper, frameIndex.current + direction),
    );
    const request = new AbortController();
    frameRequest.current?.abort();
    frameRequest.current = request;
    const token = ++generation.current;
    setDecoding(true);
    setError("");
    try {
      const response = await fetch(
        `/api/videos/${media.id}/frame?index=${index}`,
        { signal: request.signal },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Frame could not be decoded.");
      }
      const blob = await response.blob();
      if (token !== generation.current) return;
      const url = URL.createObjectURL(blob);
      const decodedImage = new Image();
      decodedImage.src = url;
      try {
        await decodedImage.decode();
      } catch (e) {
        URL.revokeObjectURL(url);
        throw e;
      }
      if (token !== generation.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (decodedRef.current) URL.revokeObjectURL(decodedRef.current);
      decodedRef.current = url;
      setDecoded(url);
      frameIndex.current = index;
      timeRef.current = media.frames[index];
      setTime(media.frames[index]);
      el.currentTime = media.frames[index];
    } catch (e) {
      if (!request.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Frame could not be decoded.",
        );
    } finally {
      if (token === generation.current) setDecoding(false);
    }
  };
  const toggle = async () => {
    const el = video.current;
    if (!el || !available) return;
    if (el.paused) {
      clearDecoded();
      updateDraft(null);
      setTool("select");
      if (el.currentTime >= end || el.currentTime < edits.trimStart)
        el.currentTime = edits.trimStart;
      try {
        await el.play();
      } catch {
        setError("Playback could not start. Try another video format.");
      }
    } else el.pause();
  };
  const chooseTool = (next: Tool) => {
    setTool(next);
    updateDraft(null);
    if (next !== "select") video.current?.pause();
  };
  const rotate = () => {
    if (!available) return;
    onEdits({ ...edits, rotation: ((edits.rotation + 90) % 360) as Rotation });
    setPan({ x: 0, y: 0 });
  };
  const setMagnification = (value: number) => {
    setZoom(Math.max(1, Math.min(4, value)));
    setPan({ x: 0, y: 0 });
  };
  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = stage.current!.getBoundingClientRect();
    return screenToVideo(
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
      rect.height,
      dimensions.width,
      dimensions.height,
      edits.rotation,
      zoom,
      pan,
      plane.current
        ? {
            width: plane.current.offsetWidth,
            height: plane.current.offsetHeight,
          }
        : undefined,
    );
  };
  const pointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      !available ||
      decoding ||
      tool === "select" ||
      tool === "pan" ||
      e.button !== 0
    )
      return;
    video.current?.pause();
    const p = getPoint(e);
    if (tool === "angle") {
      const current = draftRef.current;
      const next: Drawing =
        current?.tool === "angle"
          ? { ...current, points: [...current.points, p] }
          : {
              id: crypto.randomUUID(),
              tool: "angle",
              points: [p],
              color,
              time: timeRef.current,
            };
      if (next.points.length === 3) {
        if (
          jointAngle(next.points, dimensions.width, dimensions.height) === null
        ) {
          setError("Choose three distinct points.");
          updateDraft(null);
          return;
        }
        commit([...drawings, next]);
        updateDraft(null);
      } else updateDraft(next);
    } else {
      e.currentTarget.setPointerCapture(e.pointerId);
      updateDraft({
        id: crypto.randomUUID(),
        tool,
        points: tool === "line" ? [p, p] : [p],
        color,
        time: timeRef.current,
      });
    }
  };
  const pointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const current = draftRef.current;
    if (
      !current ||
      current.tool === "angle" ||
      !e.currentTarget.hasPointerCapture(e.pointerId)
    )
      return;
    const p = getPoint(e);
    updateDraft({
      ...current,
      points:
        current.tool === "line"
          ? [current.points[0], p]
          : [...current.points.slice(0, 9999), p],
    });
  };
  const pointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const current = draftRef.current;
    if (!current || current.tool === "angle") return;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    commit([...drawings, current]);
    updateDraft(null);
  };
  const exportFrame = async () => {
    if (!available || decoding || exporting) return;
    video.current?.pause();
    setExporting(true);
    let exportImageUrl: string | undefined;
    try {
      let frameSource: CanvasImageSource = video.current!;
      if (decodedRef.current || media) {
        let url = decodedRef.current;
        if (!url && media) {
          const response = await fetch(
            `/api/videos/${media.id}/frame?index=${nearestFrame(media.frames, timeRef.current)}`,
          );
          if (!response.ok)
            throw new Error("The frame could not be exported. Please retry.");
          exportImageUrl = URL.createObjectURL(await response.blob());
          url = exportImageUrl;
        }
        const frameImage = new Image();
        frameImage.src = url;
        await frameImage.decode();
        frameSource = frameImage;
      }
      const output = document.createElement("canvas");
      output.width = quarter ? dimensions.height : dimensions.width;
      output.height = quarter ? dimensions.width : dimensions.height;
      const ctx = output.getContext("2d");
      if (!ctx) throw new Error("Image export is unavailable.");
      ctx.translate(output.width / 2, output.height / 2);
      ctx.rotate((edits.rotation * Math.PI) / 180);
      ctx.translate(-dimensions.width / 2, -dimensions.height / 2);
      ctx.drawImage(frameSource, 0, 0, dimensions.width, dimensions.height);
      drawAnnotations(ctx, visible, dimensions.width, dimensions.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("Image export failed.")),
          "image/png",
        ),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name.replace(/\.[^.]*$/, "").replace(/[^a-z0-9_-]/gi, "-") || "formsync"}-frame-${frameIndex.current}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image export failed.");
    } finally {
      if (exportImageUrl) URL.revokeObjectURL(exportImageUrl);
      setExporting(false);
    }
  };
  const setTrim = (key: "trimStart" | "trimEnd", value: number) => {
    const next = { ...edits, [key]: value };
    if (
      next.trimStart < 0 ||
      (next.trimEnd ?? effectiveDuration) > effectiveDuration + 0.001 ||
      (next.trimEnd ?? effectiveDuration) - next.trimStart < 0.02
    ) {
      setError("Trim end must be after the start, within the clip.");
      return;
    }
    setError("");
    onEdits(next);
    if (
      timeRef.current < next.trimStart ||
      timeRef.current > (next.trimEnd ?? effectiveDuration)
    )
      seek(next.trimStart);
  };
  const keyboard = (e: React.KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (
      disabled ||
      target.closest("input,textarea,select,button,[contenteditable=true]") ||
      guide.current?.open
    )
      return;
    const key = e.key.toLowerCase();
    if (key === "?" || (e.shiftKey && e.code === "Slash")) {
      e.preventDefault();
      guide.current?.showModal();
      return;
    }
    if (e.key === "Escape") {
      updateDraft(null);
      return;
    }
    if (!available) return;
    if ((e.ctrlKey || e.metaKey) && key === "z") {
      e.preventDefault();
      undoDrawing();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const actions: Record<string, () => void> = {
      " ": () => void toggle(),
      arrowright: () => void step(e.shiftKey ? 10 : 1),
      arrowleft: () => void step(e.shiftKey ? -10 : -1),
      v: () => chooseTool("select"),
      p: () => chooseTool("pen"),
      l: () => chooseTool("line"),
      a: () => chooseTool("angle"),
      h: () => chooseTool("pan"),
      r: rotate,
      "+": () => setMagnification(zoom + 0.25),
      "=": () => setMagnification(zoom + 0.25),
      "-": () => setMagnification(zoom - 0.25),
      "0": () => setMagnification(1),
      e: () => void exportFrame(),
      i: () => setTrim("trimStart", timeRef.current),
      o: () => setTrim("trimEnd", timeRef.current),
    };
    if (actions[key]) {
      e.preventDefault();
      actions[key]();
    }
  };
  const chooseFile = (file?: File) => {
    if (file && !disabled) onUpload(file);
    if (input.current) input.current.value = "";
  };
  const previewError =
    preparationError ||
    (error === "Preparing a browser-compatible video preview..."
      ? preparing
        ? error
        : "Video preview is unavailable. Retry video preparation."
      : error);
  return (
    <section
      className="panel analyzer"
      aria-label="Video analyzer"
      onKeyDown={keyboard}
    >
      <div className="panel-heading">
        <div className="flex items-center gap-3">
          <span className="tiny-label">01</span>
          <h2>Video workspace</h2>
        </div>
        <button
          className="text-link shortcut-trigger"
          onClick={() => guide.current?.showModal()}
        >
          <Keyboard size={16} /> Shortcuts
        </button>
      </div>
      <input
        ref={input}
        className="hidden"
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mov"
        onChange={(e) => chooseFile(e.target.files?.[0])}
        aria-label="Upload drill video"
        disabled={disabled}
      />
      <div
        ref={stage}
        className={`video-stage phase-one-stage ${tool === "pan" ? "pan-stage" : ""}`}
        style={
          {
            "--review-aspect": quarter
              ? dimensions.height / dimensions.width
              : dimensions.width / dimensions.height,
            aspectRatio: quarter
              ? `${dimensions.height}/${dimensions.width}`
              : `${dimensions.width}/${dimensions.height}`,
            "--plane-fullscreen-width": quarter
              ? `min(100vh, ${(100 * dimensions.width) / dimensions.height}vw)`
              : `min(100vw, ${(100 * dimensions.width) / dimensions.height}vh)`,
            "--plane-fullscreen-height": quarter
              ? `min(100vw, ${(100 * dimensions.height) / dimensions.width}vh)`
              : `min(100vh, ${(100 * dimensions.height) / dimensions.width}vw)`,
          } as React.CSSProperties
        }
        tabIndex={src ? 0 : undefined}
        aria-label="Video review. Space to play or pause. Arrow keys to step decoded frames."
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          chooseFile(e.dataTransfer.files[0]);
        }}
        onPointerDown={(e) => {
          if (tool !== "pan" || zoom <= 1 || !available) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          panStart.current = { x: e.clientX, y: e.clientY, pan };
        }}
        onPointerMove={(e) => {
          const start = panStart.current;
          if (!start || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const clamp = (value: number, maximum: number) =>
            Math.max(-maximum, Math.min(maximum, value));
          setPan({
            x: clamp(
              start.pan.x + e.clientX - start.x,
              Math.max(
                0,
                ((quarter ? dimensions.height : dimensions.width) *
                  fitScale *
                  zoom -
                  rect.width) /
                  2,
              ),
            ),
            y: clamp(
              start.pan.y + e.clientY - start.y,
              Math.max(
                0,
                ((quarter ? dimensions.width : dimensions.height) *
                  fitScale *
                  zoom -
                  rect.height) /
                  2,
              ),
            ),
          });
        }}
        onPointerUp={(e) => {
          panStart.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          panStart.current = null;
        }}
      >
        {src ? (
          <>
            <div
              ref={plane}
              className="video-plane"
              style={{
                width: dimensions.width * fitScale,
                height: dimensions.height * fitScale,
                transform: `translate(-50%,-50%) translate(${pan.x}px,${pan.y}px) scale(${zoom}) rotate(${edits.rotation}deg)`,
              }}
            >
              <video
                ref={video}
                src={src}
                crossOrigin="anonymous"
                playsInline
                preload="metadata"
                onLoadedMetadata={() => {
                  const el = video.current!;
                  if (!el.videoWidth || !el.videoHeight) {
                    setReady(false);
                    setError(
                      preparing
                        ? "Preparing a browser-compatible video preview..."
                        : "The browser cannot display this video's picture. Retry video preparation.",
                    );
                    return;
                  }
                  setError("");
                  setDimensions({
                    width: el.videoWidth || 1920,
                    height: el.videoHeight || 1080,
                  });
                  setDuration(
                    Number.isFinite(el.duration)
                      ? el.duration
                      : media?.duration || 0,
                  );
                  setReady(true);
                  if (edits.trimStart > 0) {
                    el.currentTime = edits.trimStart;
                    timeRef.current = edits.trimStart;
                    setTime(edits.trimStart);
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onTimeUpdate={syncTime}
                onSeeked={syncTime}
                onError={() => {
                  setReady(false);
                  setError(
                    "This clip cannot be decoded by the browser. Try an H.264 MP4 or WebM.",
                  );
                }}
              />
              {decoded && (
                <img
                  ref={image}
                  src={decoded}
                  className="decoded-frame"
                  alt={`Decoded frame ${frameIndex.current + 1}`}
                  draggable={false}
                />
              )}
              <canvas
                ref={canvas}
                width={dimensions.width}
                height={dimensions.height}
                className={
                  tool === "select" || tool === "pan"
                    ? "pointer-events-none"
                    : "drawing-canvas"
                }
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={() => updateDraft(null)}
              />
            </div>
            <span className="video-badge">
              {decoding
                ? "DECODING"
                : playing
                  ? "PLAYING"
                  : decoded
                    ? "EXACT FRAME"
                    : "PAUSED"}{" "}
              / {speed}x
            </span>
          </>
        ) : (
          <div className="upload-empty">
            <div className="upload-orbit">
              <Upload size={30} />
            </div>
            <h3>
              Your next breakthrough
              <br />
              starts with a closer look.
            </h3>
            <p>Drop a drill video here to review your form.</p>
            <button
              className="button-primary"
              onClick={() => input.current?.click()}
              disabled={disabled}
            >
              <Upload size={16} />
              Upload a clip
            </button>
            <span className="muted text-xs">
              MP4, WebM or MOV / Up to 100 MB
            </span>
          </div>
        )}
        {dragging && <div className="drop-cover">Drop your video to begin</div>}
      </div>
      <div className="playback-area">
        <div className="timeline-labels">
          <span>{timeLabel(time)}</span>
          <span>{timeLabel(effectiveDuration)}</span>
        </div>
        <input
          aria-label="Video timeline"
          type="range"
          min={edits.trimStart}
          max={end || 1}
          step={0.001}
          value={Math.max(edits.trimStart, Math.min(time, end || 1))}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!available}
          className="timeline"
        />
        <div className="playback-controls">
          <div className="flex items-center gap-2">
            <button
              className="icon-button"
              aria-label="Previous frame"
              title="Previous decoded frame"
              disabled={!exactReady}
              onClick={() => void step(-1)}
            >
              <SkipBack size={17} />
            </button>
            <button
              className="play-button"
              aria-label={playing ? "Pause video" : "Play video"}
              disabled={!available}
              onClick={() => void toggle()}
            >
              {playing ? <Pause size={19} /> : <Play size={19} />}
            </button>
            <button
              className="icon-button"
              aria-label="Next frame"
              title="Next decoded frame"
              disabled={!exactReady}
              onClick={() => void step(1)}
            >
              {decoding ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <SkipForward size={17} />
              )}
            </button>
            <span className="frame-label">
              Frame {String(frameIndex.current + 1).padStart(4, "0")}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="speed-options" aria-label="Playback speed">
              {[0.25, 0.5, 1].map((rate) => (
                <button
                  key={rate}
                  disabled={disabled}
                  aria-pressed={speed === rate}
                  className={speed === rate ? "selected" : ""}
                  onClick={() => setSpeed(rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>
            <button
              className="icon-button"
              aria-label="Fullscreen video"
              disabled={!available}
              onClick={() =>
                void stage.current
                  ?.requestFullscreen()
                  .catch(() => setError("Fullscreen is unavailable."))
              }
            >
              <Maximize2 size={16} />
            </button>
          </div>
        </div>
      </div>
      <div className="drawing-toolbar">
        <div className="flex items-center gap-1">
          {(
            [
              { value: "select", label: "Select", Icon: MousePointer2 },
              { value: "pen", label: "Pen", Icon: PenLine },
              { value: "line", label: "Line", Icon: Minus },
              { value: "angle", label: "Angle", Icon: Ruler },
              { value: "pan", label: "Pan", Icon: Hand },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              key={value}
              disabled={!available}
              className={`tool-button ${tool === value ? "active" : ""}`}
              aria-pressed={tool === value}
              onClick={() => chooseTool(value)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                disabled={disabled}
                className={`color-swatch ${color === c ? "active" : ""}`}
                style={{ background: c }}
                aria-label={`Draw in ${c === COLORS[0] ? "lime" : c === COLORS[1] ? "cyan" : "orange"}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <span className="divider" />
          <button
            className="icon-button"
            aria-label="Undo annotation"
            title="Undo"
            disabled={disabled || (!undo.length && !draft)}
            onClick={undoDrawing}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Clear all annotations"
            title="Clear all annotations (undo available)"
            disabled={disabled || (!drawings.length && !draft)}
            onClick={() => {
              updateDraft(null);
              if (drawings.length) commit([]);
            }}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>
      <div className="view-toolbar">
        <div className="zoom-controls">
          <button
            className="icon-button"
            aria-label="Zoom out"
            disabled={!available || zoom <= 1}
            onClick={() => setMagnification(zoom - 0.25)}
          >
            <ZoomOut size={17} />
          </button>
          <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
          <button
            className="icon-button"
            aria-label="Zoom in"
            disabled={!available || zoom >= 4}
            onClick={() => setMagnification(zoom + 0.25)}
          >
            <ZoomIn size={17} />
          </button>
          <button
            className="text-link"
            disabled={!available}
            onClick={() => setMagnification(1)}
          >
            Reset view
          </button>
        </div>
        <div className="flex gap-2">
          <button
            className="tool-button"
            disabled={!available}
            onClick={rotate}
            aria-label="Rotate video clockwise"
          >
            <RotateCw size={16} />
            {edits.rotation}&deg;
          </button>
          <button
            className="tool-button"
            disabled={!available || decoding || exporting}
            onClick={() => void exportFrame()}
          >
            <Download size={16} />
            {exporting ? "Exporting" : "Export frame"}
          </button>
        </div>
      </div>
      <div className="trim-panel">
        <div className="trim-heading">
          <Scissors size={16} />
          <strong>Trim clip</strong>
          <span>{timeLabel(Math.max(0, end - edits.trimStart))} selected</span>
        </div>
        <div className="trim-fields">
          <label>
            Start (seconds)
            <input
              aria-label="Trim start"
              type="number"
              min={0}
              max={Math.max(0, end - 0.02)}
              step={0.001}
              value={edits.trimStart}
              disabled={!available}
              onChange={(e) => {
                if (e.target.value !== "")
                  setTrim("trimStart", Number(e.target.value));
              }}
            />
          </label>
          <button
            className="text-link"
            disabled={!available}
            onClick={() =>
              setTrim("trimStart", Number(timeRef.current.toFixed(3)))
            }
          >
            Use current as start
          </button>
          <label>
            End (seconds)
            <input
              aria-label="Trim end"
              type="number"
              min={edits.trimStart + 0.02}
              max={effectiveDuration}
              step={0.001}
              value={Number(end.toFixed(3))}
              disabled={!available}
              onChange={(e) => {
                if (e.target.value !== "")
                  setTrim("trimEnd", Number(e.target.value));
              }}
            />
          </label>
          <button
            className="text-link"
            disabled={!available}
            onClick={() =>
              setTrim("trimEnd", Number(timeRef.current.toFixed(3)))
            }
          >
            Use current as end
          </button>
          <button
            className="text-link"
            disabled={!available}
            onClick={() => {
              onEdits({ ...edits, trimStart: 0, trimEnd: null });
              setError("");
            }}
          >
            Reset trim
          </button>
        </div>
        <p>
          The selected range becomes the saved clip. Annotations outside it are
          excluded.
        </p>
      </div>
      <div className="workspace-footer">
        <p>
          {tool === "angle"
            ? `Click endpoint, joint, then endpoint. ${draft?.points.length || 0}/3 points.`
            : tool === "pan"
              ? "Zoom in, then drag to inspect your form."
              : tool === "pen"
                ? "Draw on the paused frame."
                : tool === "line"
                  ? "Drag between two points."
                  : "Annotations belong to the frame where you draw them."}
        </p>
        <span className="media-status" role="status">
          {preparing ? (
            "Preparing precise frames..."
          ) : media ? (
            `${media.fps} FPS detected / ${media.variableFrameRate ? "variable timing" : "constant timing"} / ${media.frames.length} frames`
          ) : src ? (
            <button className="text-link" disabled={disabled} onClick={onRetry}>
              Retry frame analysis
            </button>
          ) : (
            "Automatic frame detection"
          )}
        </span>
      </div>
      {src && (
        <div className="clip-label">
          <span className="truncate">{name}</span>
          <button
            className="text-link"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            Replace clip
          </button>
        </div>
      )}
      {previewError && (
        <p className="error-message" role="alert">
          {previewError}{" "}
          {!preparing && (
            <button
              type="button"
              className="text-link"
              disabled={disabled}
              onClick={onRetry}
            >
              Retry video preparation
            </button>
          )}
        </p>
      )}
      <dialog
        ref={guide}
        className="shortcut-dialog"
        aria-labelledby="shortcut-title"
      >
        <div className="dialog-heading">
          <h2 id="shortcut-title">Video review shortcuts</h2>
          <button className="text-link" onClick={() => guide.current?.close()}>
            Close
          </button>
        </div>
        <p>
          Focus the video or its workspace to use these shortcuts. Typing in
          fields is unaffected.
        </p>
        <dl>
          {[
            ["Space", "Play / pause"],
            ["Left / Right", "Previous / next decoded frame"],
            ["Shift + Left / Right", "Step ten decoded frames"],
            ["V / P / L / A / H", "Select / pen / line / angle / pan"],
            ["R", "Rotate clockwise"],
            ["+ / - / 0", "Zoom in / out / reset"],
            ["I / O", "Set trim start / end"],
            ["E", "Export annotated frame"],
            ["Ctrl or Cmd + Z", "Undo annotation"],
            ["Escape", "Cancel unfinished markup"],
            ["?", "Open this guide"],
          ].map(([key, label]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </dialog>
    </section>
  );
}
