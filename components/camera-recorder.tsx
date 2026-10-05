"use client";
import { useEffect, useRef, useState } from "react";
export default function CameraRecorder({
  onRecorded,
  disabled = false,
}: {
  onRecorded: (file: File) => void;
  disabled?: boolean;
}) {
  const [active, setActive] = useState(false),
    [recording, setRecording] = useState(false),
    [error, setError] = useState(""),
    [elapsed, setElapsed] = useState(0),
    [facingMode, setFacingMode] = useState<"environment" | "user">(
      "environment",
    ),
    [switchingCamera, setSwitchingCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    mounted = useRef(true);
  const blocked = useRef(disabled);
  blocked.current = disabled;
  function release() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    };
  }, []);
  async function open() {
    if (blocked.current) return;
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Camera recording needs a supported browser on localhost or HTTPS.",
        );
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (!mounted.current || blocked.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      setActive(true);
      setElapsed(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Camera unavailable");
    }
  }
  useEffect(() => {
    if (active && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current
        .play()
        .catch(() => setError("Camera preview could not start."));
    }
  }, [active]);
  async function switchCamera() {
    if (!stream.current || recording || switchingCamera || blocked.current)
      return;
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setSwitchingCamera(true);
    setError("");
    let nextStream: MediaStream | null = null;
    const previous = stream.current;
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: nextMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (!mounted.current || blocked.current) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = nextStream;
      if (video.current) {
        video.current.srcObject = nextStream;
        await video.current.play();
      }
      previous?.getTracks().forEach((track) => track.stop());
      setFacingMode(nextMode);
    } catch (e) {
      if (stream.current === nextStream) stream.current = previous;
      if (video.current && previous) video.current.srcObject = previous;
      nextStream?.getTracks().forEach((track) => track.stop());
      setError(
        e instanceof Error
          ? `Could not switch cameras. The current camera is still active. ${e.message}`
          : "Could not switch cameras. The current camera is still active.",
      );
    } finally {
      setSwitchingCamera(false);
    }
  }
  function start() {
    if (!stream.current || blocked.current) return;
    const mime = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find(
      (v) => MediaRecorder.isTypeSupported(v),
    );
    if (!mime) {
      setError("This browser cannot record a supported video format.");
      return;
    }
    try {
      const r = new MediaRecorder(stream.current, {
        mimeType: mime,
        videoBitsPerSecond: 2500000,
      });
      const chunks: Blob[] = [];
      let bytes = 0;
      let seconds = 0;
      let failed = false;
      recorder.current = r;
      r.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          bytes += e.data.size;
          if (bytes > 90 * 1024 * 1024 && r.state === "recording") r.stop();
        }
      };
      r.onerror = () => {
        failed = true;
        setError("Recording failed. Try again.");
      };
      r.onstop = () => {
        release();
        recorder.current = null;
        if (!mounted.current) return;
        setRecording(false);
        setActive(false);
        if (failed) return;
        const recordedMime = r.mimeType || mime;
        const type = recordedMime.startsWith("video/mp4")
          ? "video/mp4"
          : recordedMime.startsWith("video/webm")
            ? "video/webm"
            : "";
        if (!type) {
          setError("Recording failed. Try again with a supported video format.");
          return;
        }
        if (chunks.length && bytes <= 100 * 1024 * 1024 && !blocked.current)
          onRecorded(
            new File(
              chunks,
              `practice-${Date.now()}.${type === "video/mp4" ? "mp4" : "webm"}`,
              { type },
            ),
          );
        else setError("Recording was empty or too large.");
      };
      r.start(1000);
      setRecording(true);
      setElapsed(0);
      timer.current = setInterval(() => {
        setElapsed(++seconds);
        if (seconds >= 120 && r.state === "recording") r.stop();
      }, 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed");
    }
  }
  return (
    <div className="camera-recorder">
      {!active ? (
        <button
          type="button"
          className="button-ghost"
          disabled={disabled}
          onClick={() => void open()}
        >
          Record with camera
        </button>
      ) : (
        <>
          <div className="camera-preview-frame">
            <video ref={video} muted playsInline className="camera-preview" />
            {!recording && (
              <div className="camera-position-guide" aria-hidden="true">
                <span className="camera-guide-corner top-left" />
                <span className="camera-guide-corner top-right" />
                <span className="camera-guide-corner bottom-left" />
                <span className="camera-guide-corner bottom-right" />
                <span className="camera-guide-person">
                  <span />
                  <i />
                  <i />
                </span>
              </div>
            )}
          </div>
          {recording ? (
            <p role="status" aria-live="polite">
              Camera recording · {elapsed}s / 120s · no audio
            </p>
          ) : (
            <div className="camera-position-tips">
              <strong>Frame your movement</strong>
              <p>
                Turn your phone sideways, keep your full body and feet inside
                the guide, and place the camera on a steady surface.
              </p>
            </div>
          )}
          <div className="hub-controls">
            {recording ? (
              <button
                type="button"
                className="button-primary"
                onClick={() => recorder.current?.stop()}
              >
                Stop and use video
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button-primary"
                  disabled={disabled}
                  onClick={start}
                >
                  Start recording
                </button>
                <button
                  type="button"
                  className="button-ghost"
                  disabled={switchingCamera || disabled}
                  onClick={() => void switchCamera()}
                >
                  {switchingCamera
                    ? "Switching camera..."
                    : `Use ${facingMode === "environment" ? "front" : "rear"} camera`}
                </button>
                <button
                  type="button"
                  className="button-ghost"
                  onClick={() => {
                    release();
                    setActive(false);
                  }}
                >
                  Close camera
                </button>
              </>
            )}
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
