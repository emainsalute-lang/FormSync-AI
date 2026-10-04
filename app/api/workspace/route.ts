import { NextResponse } from "next/server";
import { readWorkspace, saveWorkspace } from "@/lib/training-store";
import { workspaceSchema } from "@/lib/training";
import { getSession, withStoreLock } from "@/lib/storage";
import { sameRequestOrigin } from "@/lib/validation";
import { appIdentity } from "@/lib/user-scope";
import { assertWorkspacePlanCapacity } from "@/lib/plan-limits";
import { recordProductEvent } from "@/lib/operations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const identity = await appIdentity();
    return NextResponse.json(await readWorkspace(identity.userId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Training data is unavailable." },
      { status: 503 },
    );
  }
}
export async function PUT(request: Request) {
  let identity;
  try {
    identity = await appIdentity();
  } catch {
    return NextResponse.json(
      { error: "Authentication is unavailable." },
      { status: 401 },
    );
  }
  if (
    !sameRequestOrigin(
      request.headers.get("origin"),
      request.headers.get("host") || "",
    )
  )
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 8 * 1024 * 1024)
    return NextResponse.json(
      { error: "Training data exceeds 8 MB." },
      { status: 413 },
    );
  let parsed;
  let payload: Record<string, unknown>;
  try {
    const json = JSON.parse(raw);
    if (typeof json !== "object" || json === null || Array.isArray(json))
      return NextResponse.json(
        { error: "Invalid training data" },
        { status: 400 },
      );
    payload = json as Record<string, unknown>;
    parsed = workspaceSchema.safeParse(json);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid training data" },
      { status: 400 },
    );
  try {
    assertWorkspacePlanCapacity(identity.userId, parsed.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Plan limit reached." },
      { status: Number((error as { status?: number }).status) || 402 },
    );
  }
  try {
    return await withStoreLock(async () => {
      const current = await readWorkspace(identity.userId);
      if (current.revision !== parsed.data.revision)
        return NextResponse.json(
          {
            error:
              "Training data changed in another tab. Reload to use the latest version.",
          },
          { status: 409 },
        );
      for (const comment of parsed.data.comments) {
        if (!(await getSession(comment.sessionId, identity.userId)))
          return NextResponse.json(
            { error: "A commented session was deleted. Reload before saving." },
            { status: 409 },
          );
      }
      for (const analysis of parsed.data.analyses) {
        const s = await getSession(analysis.sessionId, identity.userId);
        if (
          !s ||
          s.videoId !== analysis.videoId ||
          (s.revision || s.createdAt) !== analysis.sessionRevision
        )
          return NextResponse.json(
            { error: "An analyzed session changed. Reload before saving." },
            { status: 409 },
          );
      }
      const workouts = Object.hasOwn(payload, "workouts")
        ? parsed.data.workouts
        : current.workouts;
      const workoutLogs = Object.hasOwn(payload, "workoutLogs")
        ? parsed.data.workoutLogs
        : current.workoutLogs;
      const workoutIds = new Set(workouts.map((workout) => workout.id));
      if (
        parsed.data.plans.some(
          (plan) => plan.workoutId && !workoutIds.has(plan.workoutId),
        ) ||
        workoutLogs.some((log) => !workoutIds.has(log.workoutId))
      )
        return NextResponse.json(
          { error: "A scheduled or logged workout no longer exists." },
          { status: 400 },
        );
      const nextWorkspace = {
        ...parsed.data,
        wellness: Object.hasOwn(payload, "wellness")
          ? parsed.data.wellness
          : current.wellness,
        drills: Object.hasOwn(payload, "drills")
          ? parsed.data.drills
          : current.drills,
        workouts: Object.hasOwn(payload, "workouts")
          ? parsed.data.workouts
          : current.workouts,
        workoutLogs: Object.hasOwn(payload, "workoutLogs")
          ? parsed.data.workoutLogs
          : current.workoutLogs,
        analysisTemplates: Object.hasOwn(payload, "analysisTemplates")
          ? parsed.data.analysisTemplates
          : current.analysisTemplates,
      };
      const saved = await saveWorkspace(nextWorkspace, identity.userId);
      if (
        parsed.data.analyses.some(
          (analysis) =>
            !current.analyses.some(
              (prior) =>
                prior.sessionId === analysis.sessionId &&
                prior.sessionRevision === analysis.sessionRevision,
            ),
        )
      )
        recordProductEvent("movement_analysis_saved", identity.userId);
      if (workoutLogs.length > current.workoutLogs.length)
        recordProductEvent("workout_completed", identity.userId);
      return NextResponse.json(saved);
    });
  } catch (e) {
    console.error("Training save failed", e);
    return NextResponse.json(
      { error: "Training data could not be saved." },
      { status: 503 },
    );
  }
}
