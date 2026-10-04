"use client";
import { useEffect, useRef, useState } from "react";
import { type Session } from "@/lib/model";
import { JOINTS, poseAngles, type PoseAnalysis } from "@/lib/training";
import type { MediaInfo } from "@/lib/media-model";
export default function ClipComparison({
  sessions,
  analyses,
}: {
  sessions: Session[];
  analyses: PoseAnalysis[];
}) {
  const [a, setA] = useState(sessions[0]?.id || ""),
    [b, setB] = useState(sessions[1]?.id || sessions[0]?.id || "");
  const [offset, setOffset] = useState(0),
    [overlay, setOverlay] = useState(false),
    [overlayOpacity, setOverlayOpacity] = useState(0.5),
    [trackedJoint, setTrackedJoint] =
      useState<keyof typeof JOINTS>("Left knee"),
    [comparisonMedia, setComparisonMedia] = useState<
      [MediaInfo, MediaInfo] | null
    >(null),
    [speed, setSpeed] = useState(1),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [durations, setDurations] = useState([0, 0]),
    [error, setError] = useState("");
  const left = useRef<HTMLVideoElement>(null),
    right = useRef<HTMLVideoElement>(null);
  const sa = sessions.find((s) => s.id === a),
    sb = sessions.find((s) => s.id === b);
  const analysisA = analyses.find(
    (analysis) =>
      analysis.sessionId === a &&
      sa &&
      analysis.sessionRevision === (sa.revision || sa.createdAt),
  );
  const analysisB = analyses.find(
    (analysis) =>
      analysis.sessionId === b &&
      sb &&
      analysis.sessionRevision === (sb.revision || sb.createdAt),
  );
  const start = Math.max(0, -offset),
    end = Math.min(durations[0], durations[1] - offset),
    ready = end > start;
  function pause() {
    left.current?.pause();
    right.current?.pause();
    setPlaying(false);
  }
  function seek(value: number) {
    pause();
    const next = Math.max(start, Math.min(end, value));
    if (left.current) left.current.currentTime = next;
    if (right.current) right.current.currentTime = next + offset;
    setTime(next);
  }
  useEffect(() => {
    left.current?.pause();
    right.current?.pause();
    setPlaying(false);
    setDurations([
      left.current && left.current.readyState >= 1 ? left.current.duration : 0,
      right.current && right.current.readyState >= 1
        ? right.current.duration
        : 0,
    ]);
    setTime(0);
    setOffset(0);
    setError("");
  }, [a, b]);
  useEffect(() => {
    if (!sa || !sb) {
      setComparisonMedia(null);
      return;
    }
    const controller = new AbortController();
    setComparisonMedia(null);
    Promise.all(
      [sa, sb].map(async (session) => {
        const response = await fetch(
          `/api/videos/${session.videoId}/metadata`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || "Clip metadata is unavailable.");
        return body as MediaInfo;
      }),
    )
      .then(([leftInfo, rightInfo]) =>
        setComparisonMedia([leftInfo, rightInfo]),
      )
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Clip metadata is unavailable.",
          );
      });
    return () => controller.abort();
  }, [a, b, sa?.videoId, sb?.videoId]);
  const angleSeries = (
    analysis: PoseAnalysis | undefined,
    info: MediaInfo | undefined,
  ) =>
    analysis && info
      ? analysis.samples.flatMap((sample) => {
          const angle =
            poseAngles(sample.landmarks, info.width, info.height).find(
              (measurement) => measurement.name === trackedJoint,
            )?.angle ?? null;
          return angle === null ? [] : [{ time: sample.time, angle }];
        })
      : [];
  const anglesA = angleSeries(analysisA, comparisonMedia?.[0]);
  const anglesB = angleSeries(analysisB, comparisonMedia?.[1]);
  const chartPath = (
    values: { time: number; angle: number }[],
    duration: number,
  ) =>
    values
      .map((sample, index) => {
        const x = 44 + Math.max(0, Math.min(1, sample.time / duration)) * 700;
        const y = 205 - (sample.angle / 180) * 170;
        return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const angleMean = (values: { time: number; angle: number }[]) =>
    values.length
      ? values.reduce((sum, sample) => sum + sample.angle, 0) / values.length
      : null;
  useEffect(() => {
    let frame = 0;
    function tick() {
      const l = left.current,
        r = right.current;
      if (l && r && !l.paused) {
        setTime(l.currentTime);
        if (l.currentTime >= end) {
          l.pause();
          r.pause();
          setPlaying(false);
        } else if (Math.abs(r.currentTime - l.currentTime - offset) > 0.08)
          r.currentTime = l.currentTime + offset;
      }
      frame = requestAnimationFrame(tick);
    }
    if (playing) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, end, offset]);
  async function play() {
    if (!ready) return;
    if (playing) {
      pause();
      return;
    }
    setError("");
    const l = left.current!,
      r = right.current!;
    if (l.currentTime < start || l.currentTime >= end) l.currentTime = start;
    r.currentTime = l.currentTime + offset;
    l.playbackRate = r.playbackRate = speed;
    try {
      await Promise.all([l.play(), r.play()]);
      setPlaying(true);
    } catch {
      pause();
      setError("Playback failed. Try different clips or wait for loading.");
    }
  }
  return (
    <section className="panel hub-panel">
      <h2>Synchronized comparison</h2>
      <p className="muted">
        Compare athlete-selected saved clips. Offset is added to the right
        clip&apos;s time; transparent overlay and angle timelines align playback
        for visual review.
      </p>
      {sessions.length ? (
        <>
          <div className={`compare-grid${overlay ? " compare-overlay" : ""}`}>
            {[sa, sb].map((s, i) => (
              <label className="field-label" key={i}>
                {i === 0 ? "Left clip" : "Right clip"}
                <select
                  value={i === 0 ? a : b}
                  onChange={(e) => (i === 0 ? setA : setB)(e.target.value)}
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.date}
                    </option>
                  ))}
                </select>
                <video
                  key={s?.videoId || i}
                  ref={i === 0 ? left : right}
                  src={s ? `/api/videos/${s.videoId}` : undefined}
                  style={
                    overlay && i === 1
                      ? { opacity: overlayOpacity, zIndex: 2 }
                      : undefined
                  }
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration;
                    setDurations((prev) =>
                      prev.map((v, j) => (j === i ? d : v)),
                    );
                  }}
                  onError={() =>
                    setError("A clip is unavailable or unsupported.")
                  }
                  onEnded={pause}
                />
              </label>
            ))}
          </div>
          <div className="hub-controls">
            <label className="field-label compare-toggle">
              <input
                type="checkbox"
                checked={overlay}
                onChange={(event) => setOverlay(event.target.checked)}
              />
              Transparent video overlay
            </label>
            {overlay && (
              <label className="field-label">
                Reference opacity
                <input
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.05"
                  value={overlayOpacity}
                  onChange={(event) =>
                    setOverlayOpacity(Number(event.target.value))
                  }
                />
              </label>
            )}
          </div>
          <div className="hub-controls">
            <button
              className="button-primary"
              disabled={!ready}
              onClick={() => void play()}
            >
              {playing ? "Pause comparison" : "Play comparison"}
            </button>
            <label className="field-label">
              Comparison speed
              <select
                value={speed}
                onChange={(e) => {
                  pause();
                  setSpeed(Number(e.target.value));
                }}
              >
                {[0.25, 0.5, 1].map((v) => (
                  <option key={v} value={v}>
                    {v}x
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Right offset (seconds)
              <input
                type="number"
                step="0.05"
                min={-durations[1]}
                max={durations[0]}
                value={offset}
                onChange={(e) => {
                  pause();
                  setOffset(Number(e.target.value));
                }}
              />
            </label>
            <button
              className="button-ghost"
              disabled={!ready}
              onClick={() => seek(start)}
            >
              Reset comparison
            </button>
          </div>
          <label className="field-label">
            Comparison timeline · {time.toFixed(2)}s
            <input
              aria-label="Comparison timeline"
              type="range"
              min={start}
              max={ready ? end : start}
              step=".01"
              value={Math.max(start, Math.min(end || start, time))}
              disabled={!ready}
              onChange={(e) => seek(Number(e.target.value))}
            />
          </label>
          {!ready && durations.every(Boolean) && (
            <p role="alert">
              These clips have no overlapping time at this offset.
            </p>
          )}
          <section
            className="pose-sport-analysis"
            aria-label="Joint-angle comparison"
          >
            <h3>Joint-angle comparison</h3>
            <p className="muted">
              Existing saved pose analyses only. Curves are normalized to each
              clip&apos;s duration; samples without confident estimates are
              omitted.
            </p>
            <label className="field-label">
              Joint to compare
              <select
                value={trackedJoint}
                onChange={(event) =>
                  setTrackedJoint(event.target.value as keyof typeof JOINTS)
                }
              >
                {Object.keys(JOINTS).map((joint) => (
                  <option key={joint}>{joint}</option>
                ))}
              </select>
            </label>
            {analysisA && analysisB && comparisonMedia ? (
              <>
                <div className="compare-angle-summary">
                  <p>
                    <strong>{sa?.name}</strong>:{" "}
                    {angleMean(anglesA)?.toFixed(1) ?? "—"}° mean ·{" "}
                    {anglesA.length} confident samples
                  </p>
                  <p>
                    <strong>{sb?.name}</strong>:{" "}
                    {angleMean(anglesB)?.toFixed(1) ?? "—"}° mean ·{" "}
                    {anglesB.length} confident samples
                  </p>
                </div>
                <svg
                  className="compare-angle-chart"
                  viewBox="0 0 800 240"
                  role="img"
                  aria-label={`${trackedJoint} comparison timeline`}
                >
                  {[0, 45, 90, 135, 180].map((angle) => {
                    const y = 205 - (angle / 180) * 170;
                    return (
                      <g key={angle}>
                        <line x1="44" x2="744" y1={y} y2={y} />
                        <text x="8" y={y + 4}>
                          {angle}°
                        </text>
                      </g>
                    );
                  })}
                  <path
                    d={chartPath(
                      anglesA,
                      Math.max(0.01, comparisonMedia[0].duration),
                    )}
                    className="compare-angle-left"
                  />
                  <path
                    d={chartPath(
                      anglesB,
                      Math.max(0.01, comparisonMedia[1].duration),
                    )}
                    className="compare-angle-right"
                  />
                  <text x="44" y="230">
                    0%
                  </text>
                  <text x="710" y="230">
                    100% clip time
                  </text>
                </svg>
                <p className="muted">
                  <span className="compare-legend-left">{sa?.name}</span>
                  {" · "}
                  <span className="compare-legend-right">{sb?.name}</span>
                </p>
              </>
            ) : (
              <p role="status">
                {analysisA || analysisB
                  ? "Run and save pose analysis for both selected clips to compare joint-angle timelines."
                  : "No saved pose analyses for both selected clips yet. Analyze each clip in Movement first."}
              </p>
            )}
          </section>
        </>
      ) : (
        <p>Save a session to compare clips.</p>
      )}
      {error && (
        <p role="alert" className="feedback">
          {error}
        </p>
      )}
    </section>
  );
}
