"use client";
import { useEffect, useRef, useState } from "react";
import { type Session } from "@/lib/model";
import { type MediaInfo } from "@/lib/media-model";
import {
  cameraVisibility,
  CONNECTIONS,
  CORRECTABLE_LANDMARKS,
  detectSquatRepetitions,
  interpolatePose,
  JOINTS,
  movementConfidence,
  movementVelocity,
  poseAngles,
  SPORT_ANALYSIS_TEMPLATES,
  sportMovementMetrics,
  type Landmark,
  type PoseAnalysis,
  type SportAnalysisTemplate,
  type Workspace,
} from "@/lib/training";
export default function PoseReview({
  session,
  analysis,
  customTemplates,
  onSaveTemplate,
  onSave,
}: {
  session: Session;
  analysis?: PoseAnalysis;
  customTemplates: Workspace["analysisTemplates"];
  onSaveTemplate: (
    value: Workspace["analysisTemplates"][number],
  ) => Promise<boolean>;
  onSave: (value: PoseAnalysis) => Promise<boolean>;
}) {
  const [media, setMedia] = useState<MediaInfo | null>(null),
    [result, setResult] = useState<PoseAnalysis | undefined>(analysis),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [time, setTime] = useState(0),
    [joint, setJoint] = useState<keyof typeof JOINTS>("Right elbow"),
    [templateId, setTemplateId] = useState<string>("basketball-shot"),
    [customTemplatePhases, setCustomTemplatePhases] = useState<string[]>([
      "set",
      "release",
    ]),
    [customTemplateName, setCustomTemplateName] = useState("My movement"),
    [phaseToMark, setPhaseToMark] = useState("release"),
    [lower, setLower] = useState(60),
    [upper, setUpper] = useState(150),
    [bottomAngle, setBottomAngle] = useState(100),
    [standingAngle, setStandingAngle] = useState(160),
    [correcting, setCorrecting] = useState(false),
    [landmarkIndex, setLandmarkIndex] = useState(25);
  const jointConfidenceIndices = JOINTS;
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    worker = useRef<Worker | null>(null),
    abort = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(() => {
    setResult(analysis);
  }, [analysis]);
  useEffect(() => {
    const controller = new AbortController();
    setMedia(null);
    setError("");
    setTime(0);
    fetch(`/api/videos/${session.videoId}/metadata`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Metadata unavailable");
        setMedia(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      generation.current++;
      abort.current?.abort();
      worker.current?.terminate();
    };
  }, [session.videoId]);
  const gap =
    media && result
      ? media.duration / Math.max(1, result.sampledFrames - 1)
      : 0;
  const interpolated = result
    ? interpolatePose(result.samples, time)
    : undefined;
  const nearestSampleTime = result?.samples.reduce(
    (best, current) =>
      Math.abs(current.time - time) < Math.abs(best - time)
        ? current.time
        : best,
    result.samples[0]?.time ?? 0,
  );
  const visible =
    media &&
    interpolated &&
    nearestSampleTime !== undefined &&
    Math.abs(nearestSampleTime - time) <= Math.max(0.15, gap / 2 + 0.02)
      ? interpolated
      : undefined;
  const angles =
    media && visible
      ? poseAngles(visible.landmarks, media.width, media.height)
      : [];
  useEffect(() => {
    const c = canvas.current;
    if (!c || !media) return;
    c.width = media.width;
    c.height = media.height;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!visible) return;
    ctx.strokeStyle = "#25753c";
    ctx.lineWidth = Math.max(2, c.width / 350);
    for (const [a, b] of CONNECTIONS) {
      const p = visible.landmarks[a],
        q = visible.landmarks[b];
      if (p.visibility < 0.6 || q.visibility < 0.6) continue;
      ctx.beginPath();
      ctx.moveTo(p.x * c.width, p.y * c.height);
      ctx.lineTo(q.x * c.width, q.y * c.height);
      ctx.stroke();
    }
    ctx.fillStyle = "#08758a";
    for (const p of visible.landmarks) {
      if (p.visibility < 0.6) continue;
      ctx.beginPath();
      ctx.arc(
        p.x * c.width,
        p.y * c.height,
        Math.max(3, c.width / 180),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }, [media, visible]);
  function cancel() {
    generation.current++;
    abort.current?.abort();
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
    setStatus("Analysis canceled. Previous results are retained.");
  }
  function correctJoint(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!correcting || !result || !visible || !media) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(
      rect.width / media.width,
      rect.height / media.height,
    );
    const fittedWidth = media.width * scale;
    const fittedHeight = media.height * scale;
    const offsetX = (rect.width - fittedWidth) / 2;
    const offsetY = (rect.height - fittedHeight) / 2;
    const x = (event.clientX - rect.left - offsetX) / fittedWidth;
    const y = (event.clientY - rect.top - offsetY) / fittedHeight;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    const sampleIndex = result.samples.reduce(
      (best, current, index) =>
        Math.abs(current.time - time) <
        Math.abs(result.samples[best].time - time)
          ? index
          : best,
      0,
    );
    const samples = result.samples.slice();
    const current = samples[sampleIndex];
    const landmarks = current.landmarks.slice();
    landmarks[landmarkIndex] = { x, y, visibility: 1 };
    samples[sampleIndex] = { ...current, landmarks };
    setResult({ ...result, samples });
    setStatus(
      `${CORRECTABLE_LANDMARKS.find((item) => item.index === landmarkIndex)?.name || "Joint"} corrected at ${current.time.toFixed(2)}s. Save analysis to keep the correction.`,
    );
  }
  async function saveAnalysis() {
    if (!result) return;
    setStatus("Saving analysis…");
    setError("");
    if (await onSave(result)) setStatus("Analysis saved.");
    else setError("Analysis could not be saved. Try saving again.");
  }
  async function saveCustomTemplate() {
    const existing = selectedCustomTemplate;
    const id = existing?.id || crypto.randomUUID();
    const saved = await onSaveTemplate({
      id,
      name: customTemplateName.trim(),
      joint,
      phases:
        customTemplatePhases as Workspace["analysisTemplates"][number]["phases"],
    });
    if (saved) {
      setStatus("Custom analysis template saved.");
      setTemplateId(`custom:${id}`);
    }
  }
  function markPhase() {
    if (!result) return;
    const phase = phaseToMark as PoseAnalysis["phases"][number]["phase"];
    setResult({
      ...result,
      phases: [...result.phases, { phase, time: Number(time.toFixed(2)) }].sort(
        (a, b) => a.time - b.time,
      ),
    });
    setStatus(
      `${phase.replaceAll("-", " ")} marked at ${time.toFixed(2)}s. Save analysis to keep this event.`,
    );
  }
  async function analyze() {
    if (!media) return;
    const gen = ++generation.current;
    const controller = new AbortController();
    abort.current = controller;
    video.current?.pause();
    setBusy(true);
    setError("");
    setStatus("Loading local pose model…");
    const w = new Worker("/pose-worker.js");
    worker.current = w;
    let serial = 0;
    const message = (
      payload: Record<string, unknown>,
      transfer: Transferable[] = [],
    ) =>
      new Promise<{ landmarks?: Landmark[] }>((resolve, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => {
          cleanup();
          reject(
            new Error(
              "Pose analysis timed out. Try again or use a shorter clip.",
            ),
          );
        }, 90000);
        function cleanup() {
          clearTimeout(timer);
          w.removeEventListener("message", receive);
          w.removeEventListener("error", fail);
          controller.signal.removeEventListener("abort", stop);
        }
        function receive(e: MessageEvent) {
          if (e.data.id !== id) return;
          cleanup();
          e.data.error ? reject(new Error(e.data.error)) : resolve(e.data);
        }
        function fail() {
          cleanup();
          reject(
            new Error(
              "Pose worker failed. This browser may not support the required graphics features.",
            ),
          );
        }
        function stop() {
          cleanup();
          reject(new DOMException("Canceled", "AbortError"));
        }
        w.addEventListener("message", receive);
        w.addEventListener("error", fail);
        controller.signal.addEventListener("abort", stop, { once: true });
        w.postMessage({ id, ...payload }, transfer);
      });
    try {
      await message({ type: "init" });
      const count = Math.min(120, Math.max(2, Math.ceil(media.duration * 2)));
      const indices = [
        ...new Set(
          Array.from({ length: count }, (_, i) =>
            Math.round((i * (media.frames.length - 1)) / (count - 1)),
          ),
        ),
      ];
      const samples: PoseAnalysis["samples"] = [];
      for (let i = 0; i < indices.length; i++) {
        if (controller.signal.aborted)
          throw new DOMException("Canceled", "AbortError");
        setStatus(`Analyzing sampled frame ${i + 1} of ${indices.length}…`);
        const index = indices[i];
        const r = await fetch(
          `/api/videos/${session.videoId}/frame?index=${index}`,
          { signal: controller.signal },
        );
        if (!r.ok) {
          const d = await r.json();
          throw new Error(d.error || "Frame decode failed");
        }
        const bitmap = await createImageBitmap(await r.blob(), {
          resizeWidth: Math.min(512, media.width),
          resizeHeight: Math.round(
            (media.height * Math.min(512, media.width)) / media.width,
          ),
          resizeQuality: "high",
        });
        const { landmarks } = await message(
          { type: "frame", bitmap, time: media.frames[index] },
          [bitmap],
        );
        if (landmarks?.length === 33)
          samples.push({ time: media.frames[index], landmarks });
      }
      if (gen !== generation.current) return;
      const next: PoseAnalysis = {
        sessionId: session.id,
        videoId: session.videoId,
        sessionRevision: session.revision || session.createdAt,
        createdAt: new Date().toISOString(),
        samples,
        sampledFrames: indices.length,
        phases: [],
      };
      setResult(next);
      setStatus(
        samples.length
          ? `Detected a person in ${samples.length} of ${indices.length} sampled frames.`
          : "No person detected. Film one athlete with the full body visible.",
      );
      if (await onSave(next)) setStatus((s) => s + " Results saved.");
      else
        setError(
          "Analysis completed but could not be saved. Use Save analysis to retry.",
        );
    } catch (e) {
      if (gen === generation.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      w.terminate();
      if (gen === generation.current) {
        worker.current = null;
        setBusy(false);
      }
    }
  }
  const series = media
    ? result?.samples
        .map((s) => ({
          time: s.time,
          angle:
            poseAngles(s.landmarks, media.width, media.height).find(
              (a) => a.name === joint,
            )?.angle ?? null,
        }))
        .filter(
          (s): s is { time: number; angle: number } => s.angle !== null,
        ) || []
    : [];
  const matched = series.filter(
    (s) => s.angle >= lower && s.angle <= upper,
  ).length;
  const confidence = visible ? movementConfidence(visible.landmarks) : null;
  const visibility = result ? cameraVisibility(result.samples) : null;
  const velocity = movementVelocity(series);
  const reps = detectSquatRepetitions(series, bottomAngle, standingAngle);
  const selectedTemplate = SPORT_ANALYSIS_TEMPLATES.find(
    (template) => template.id === templateId,
  );
  const selectedCustomTemplate = customTemplates.find(
    (template) => `custom:${template.id}` === templateId,
  );
  const sportMetrics =
    media && result
      ? sportMovementMetrics(
          (selectedTemplate?.id || "custom") as SportAnalysisTemplate,
          joint as keyof typeof JOINTS,
          result.samples,
          result.phases,
          media.width,
          media.height,
        )
      : null;
  return (
    <section className="panel hub-panel">
      <h2>Automatic movement analysis</h2>
      <p className="muted">
        Single-person pose detection, sampled up to 120 frames. Low-confidence
        joints are hidden. Measurements describe the 2D camera view.
      </p>
      <div className="hub-controls">
        <button
          className="button-primary"
          disabled={!media || busy}
          onClick={() => void analyze()}
        >
          Analyze movement
        </button>
        {busy && (
          <button className="button-ghost" onClick={cancel}>
            Cancel analysis
          </button>
        )}
        {result && !busy && (
          <button className="button-ghost" onClick={() => void saveAnalysis()}>
            Save analysis
          </button>
        )}
      </div>
      <p role="status" className="pose-status">
        {status}
      </p>
      {error && (
        <p role="alert" className="feedback">
          {error}
        </p>
      )}
      <div className="hub-controls sport-template-controls">
        <label className="field-label">
          Sport analysis template
          <select
            value={templateId}
            onChange={(event) => {
              const value = event.target.value;
              setTemplateId(value);
              const preset = SPORT_ANALYSIS_TEMPLATES.find(
                (template) => template.id === value,
              );
              const custom = customTemplates.find(
                (template) => `custom:${template.id}` === value,
              );
              if (preset) {
                setJoint(preset.joint);
                setPhaseToMark(preset.phases[0]);
              } else if (custom) {
                setJoint(custom.joint);
                setCustomTemplateName(custom.name);
                setCustomTemplatePhases(custom.phases);
                setPhaseToMark(custom.phases[0]);
              } else {
                setCustomTemplatePhases(["set", "release"]);
                setPhaseToMark("set");
              }
            }}
          >
            {SPORT_ANALYSIS_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
            <option value="custom">Custom analysis</option>
            {customTemplates.map((template) => (
              <option key={template.id} value={`custom:${template.id}`}>
                Custom · {template.name}
              </option>
            ))}
          </select>
        </label>
        {(templateId === "custom" || selectedCustomTemplate) && (
          <label className="field-label">
            Custom template name
            <input
              maxLength={60}
              value={customTemplateName}
              onChange={(event) => setCustomTemplateName(event.target.value)}
            />
          </label>
        )}
        {(templateId === "custom" || selectedCustomTemplate) && (
          <button
            type="button"
            className="button-ghost"
            disabled={
              !customTemplateName.trim() || !customTemplatePhases.length || busy
            }
            onClick={() => void saveCustomTemplate()}
          >
            {selectedCustomTemplate
              ? "Update custom template"
              : "Save custom template"}
          </button>
        )}
      </div>
      <p className="muted">
        {selectedTemplate?.description ||
          "Choose the tracked joint, name this template, and mark the movement phases that matter for your drill."}
      </p>
      {(templateId === "custom" || selectedCustomTemplate) && (
        <fieldset className="custom-phase-options">
          <legend>Template phase options</legend>
          {[
            "set",
            "windup",
            "takeoff",
            "plant",
            "release",
            "contact",
            "landing",
            "follow-through",
            "transition",
          ].map((phase) => (
            <label key={phase}>
              <input
                type="checkbox"
                checked={customTemplatePhases.includes(phase)}
                onChange={(event) =>
                  setCustomTemplatePhases((phases) =>
                    event.target.checked
                      ? [...new Set([...phases, phase])]
                      : phases.filter((value) => value !== phase),
                  )
                }
              />
              {phase.replaceAll("-", " ")}
            </label>
          ))}
        </fieldset>
      )}
      {result && (
        <section className="pose-sport-analysis" aria-label="Sport analysis">
          <h3>
            {selectedTemplate?.name ||
              selectedCustomTemplate?.name ||
              customTemplateName}
          </h3>
          <div className="hub-controls">
            <label className="field-label">
              Phase marker
              <select
                value={phaseToMark}
                onChange={(event) => setPhaseToMark(event.target.value)}
              >
                {(
                  selectedTemplate?.phases ||
                  selectedCustomTemplate?.phases || [
                    "set",
                    "windup",
                    "takeoff",
                    "plant",
                    "release",
                    "contact",
                    "landing",
                    "follow-through",
                    "transition",
                  ]
                ).map((phase) => (
                  <option key={phase} value={phase}>
                    {phase.replaceAll("-", " ")}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button-ghost"
              disabled={!visible}
              onClick={markPhase}
            >
              Mark {phaseToMark.replaceAll("-", " ")} at playhead
            </button>
          </div>
          {sportMetrics && (
            <>
              <div className="pose-sport-stats">
                <div>
                  <span>Observed {joint.toLowerCase()} range</span>
                  <strong>
                    {sportMetrics.minAngle === null
                      ? "—"
                      : `${sportMetrics.minAngle}°–${sportMetrics.maxAngle}°`}
                  </strong>
                </div>
                <div>
                  <span>Estimated movement cycles</span>
                  <strong>{sportMetrics.cycleIntervals.length}</strong>
                </div>
                <div>
                  <span>Average cycle interval</span>
                  <strong>
                    {sportMetrics.averageCycleSeconds === null
                      ? "—"
                      : `${sportMetrics.averageCycleSeconds}s`}
                  </strong>
                </div>
                {templateId === "basketball-shot" && (
                  <div>
                    <span>Release-angle proxy consistency</span>
                    <strong>
                      {sportMetrics.releaseAngleDeviation === null
                        ? sportMetrics.releaseAngles.length
                          ? `${sportMetrics.releaseAngles.length} release marked`
                          : "Mark releases"
                        : `±${sportMetrics.releaseAngleDeviation}°`}
                    </strong>
                  </div>
                )}
              </div>
              {sportMetrics.releaseAngles.length > 0 && (
                <p className="muted">
                  Mean forearm orientation at marked releases:{" "}
                  {sportMetrics.meanReleaseAngle}° from horizontal
                  {sportMetrics.releaseAngleDeviation === null
                    ? ". Mark multiple releases in this clip to estimate consistency."
                    : ` · sample SD ${sportMetrics.releaseAngleDeviation}°.`}{" "}
                  This is a 2D arm-orientation proxy, not the ball&apos;s
                  release trajectory.
                </p>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Marked phase</th>
                      <th>Time</th>
                      <th>{joint} angle</th>
                      {templateId === "basketball-shot" && (
                        <th>Forearm orientation</th>
                      )}
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sportMetrics.markedPhases.map((phase, index) => (
                      <tr key={`${phase.phase}-${phase.time}-${index}`}>
                        <td>{phase.phase.replaceAll("-", " ")}</td>
                        <td>{phase.time.toFixed(2)}s</td>
                        <td>
                          {phase.angle === null ? "—" : `${phase.angle}°`}
                        </td>
                        {templateId === "basketball-shot" && (
                          <td>
                            {phase.releaseAngle === null
                              ? "—"
                              : `${phase.releaseAngle}°`}
                          </td>
                        )}
                        <td>
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => {
                              const removeIndex = result.phases.findIndex(
                                (item) =>
                                  item.phase === phase.phase &&
                                  item.time === phase.time,
                              );
                              setResult({
                                ...result,
                                phases: result.phases.filter(
                                  (_, eventIndex) => eventIndex !== removeIndex,
                                ),
                              });
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
      <div className="pose-stage">
        <video
          ref={video}
          src={`/api/videos/${session.videoId}`}
          controls
          playsInline
          preload="metadata"
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        />
        <canvas
          ref={canvas}
          aria-label="Detected body skeleton"
          className={correcting ? "pose-correction-active" : ""}
          onClick={correctJoint}
        />
      </div>
      <p className="pose-confidence" role="status" aria-live="polite">
        Frame confidence:{" "}
        {confidence === null
          ? "No pose estimate"
          : `${confidence}% average landmark visibility`}
      </p>
      <div className="joint-grid">
        {angles.map((a) => (
          <div key={a.name}>
            <span className="muted">{a.name}</span>
            <strong>
              {a.angle === null ? "Low confidence" : Math.round(a.angle) + "°"}
            </strong>
            <span className="muted">
              {visible
                ? `${Math.round(
                    Math.min(
                      ...jointConfidenceIndices[
                        a.name as keyof typeof JOINTS
                      ].map(
                        (index) => visible.landmarks[index]?.visibility ?? 0,
                      ),
                    ) * 100,
                  )}% confidence`
                : "No estimate"}
            </span>
          </div>
        ))}
      </div>
      {result && (
        <>
          <p className="muted">
            {result.samples.length}/{result.sampledFrames} samples contain a
            detected person. Skeletons show sampled positions, not interpolated
            measurements; the overlay interpolates between sampled estimates.
          </p>
          {visibility && (
            <section
              className="pose-visibility"
              aria-label="Camera visibility checks"
            >
              <h3>Camera visibility checks</h3>
              <p>
                Pose detected {visibility.detectedPercent}% of sampled frames ·
                torso visible {visibility.torsoPercent}% · feet visible{" "}
                {visibility.feetPercent}%.
              </p>
              {visibility.warnings.length ? (
                <ul>
                  {visibility.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : (
                <p>Key body landmarks stayed visible in most sampled frames.</p>
              )}
            </section>
          )}
          <section className="pose-correction">
            <div className="hub-controls">
              <label className="field-label">
                Joint to correct
                <select
                  value={landmarkIndex}
                  onChange={(event) =>
                    setLandmarkIndex(Number(event.target.value))
                  }
                >
                  {CORRECTABLE_LANDMARKS.map((landmark) => (
                    <option key={landmark.index} value={landmark.index}>
                      {landmark.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={correcting ? "button-primary" : "button-ghost"}
                disabled={!visible}
                aria-pressed={correcting}
                onClick={() => setCorrecting((value) => !value)}
              >
                {correcting
                  ? "Finish joint correction"
                  : "Correct joint on frame"}
              </button>
            </div>
            <p className="muted">
              {correcting
                ? "Click the video to place the selected joint at the current sampled frame. The corrected landmark is marked fully visible."
                : "Manual corrections replace the selected joint at the nearest sampled frame. Save analysis to persist them."}
            </p>
          </section>
          <div className="hub-controls">
            <label className="field-label">
              Tracked joint
              <select
                value={joint}
                onChange={(e) =>
                  setJoint(e.target.value as keyof typeof JOINTS)
                }
              >
                {[
                  "Left knee",
                  "Right knee",
                  "Left elbow",
                  "Right elbow",
                  "Left hip",
                  "Right hip",
                ].map((j) => (
                  <option key={j}>{j}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Target minimum angle
              <input
                type="number"
                min="0"
                max={upper}
                value={lower}
                onChange={(e) =>
                  setLower(Math.max(0, Math.min(upper, Number(e.target.value))))
                }
              />
            </label>
            <label className="field-label">
              Target maximum angle
              <input
                type="number"
                min={lower}
                max="180"
                value={upper}
                onChange={(e) =>
                  setUpper(
                    Math.min(180, Math.max(lower, Number(e.target.value))),
                  )
                }
              />
            </label>
            <label className="field-label">
              Squat bottom angle
              <input
                type="number"
                min="40"
                max={standingAngle - 1}
                value={bottomAngle}
                onChange={(event) =>
                  setBottomAngle(
                    Math.max(
                      40,
                      Math.min(standingAngle - 1, Number(event.target.value)),
                    ),
                  )
                }
              />
            </label>
            <label className="field-label">
              Standing angle
              <input
                type="number"
                min={bottomAngle + 1}
                max="180"
                value={standingAngle}
                onChange={(event) =>
                  setStandingAngle(
                    Math.min(
                      180,
                      Math.max(bottomAngle + 1, Number(event.target.value)),
                    ),
                  )
                }
              />
            </label>
          </div>
          <div className="pose-movement-metrics">
            <div>
              <span className="muted">Estimated squat repetitions</span>
              <strong>{reps.length}</strong>
              <small>
                {joint} crosses ≤{bottomAngle}° and returns to ≥{standingAngle}
                °.
              </small>
            </div>
            <div>
              <span className="muted">Angular velocity</span>
              <strong>
                {velocity.peak === null
                  ? "—"
                  : `${Math.round(velocity.peak)}°/s peak`}
              </strong>
              <small>
                {velocity.average === null
                  ? "Need two confident angle samples"
                  : `${Math.round(velocity.average)}°/s average absolute change`}
              </small>
            </div>
          </div>
          {series.length ? (
            <>
              <svg
                className="trend-chart"
                viewBox="0 0 600 180"
                role="img"
                aria-label={`${joint} angle over time`}
              >
                <rect
                  x="0"
                  y={180 - upper}
                  width="600"
                  height={upper - lower}
                  fill="#25753c"
                  opacity=".08"
                />
                {series.map((s, i) => (
                  <circle
                    key={i}
                    cx={(s.time / (media?.duration || 1)) * 580 + 10}
                    cy={180 - s.angle}
                    r="3"
                    fill="#08758a"
                  >
                    <title>
                      {s.time.toFixed(2)}s: {Math.round(s.angle)}°
                    </title>
                  </circle>
                ))}
              </svg>
              <p>
                {matched} of {series.length} confident samples within your
                chosen range. Observed range:{" "}
                {Math.round(Math.min(...series.map((s) => s.angle)))}–
                {Math.round(Math.max(...series.map((s) => s.angle)))}°.
              </p>
            </>
          ) : (
            <p>No confident measurements for this joint.</p>
          )}
          <p className="muted">
            Your target range is a review aid. It is not a validated
            sport-specific form score.
          </p>
        </>
      )}
    </section>
  );
}
