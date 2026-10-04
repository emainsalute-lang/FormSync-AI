import { NextResponse } from "next/server";
import { database } from "@/lib/database";
import { adminAuthorized } from "@/lib/admin-auth";
import { storagePolicy, storageUsage } from "@/lib/storage-policy";
import { createSnapshot } from "@/lib/snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!adminAuthorized(request))
    return NextResponse.json(
      { error: "Administrator access required." },
      { status: 401 },
    );
  try {
    const db = database();
    const jobs = db
      .prepare(
        "SELECT id,kind,media_id,state,attempts,available_at,lease_until,error,created_at FROM jobs WHERE state IN ('queued','running','failed') ORDER BY CASE state WHEN 'failed' THEN 0 ELSE 1 END,created_at DESC LIMIT 100",
      )
      .all();
    const events = db
      .prepare(
        "SELECT id,category,severity,message,context,created_at FROM operational_events ORDER BY created_at DESC LIMIT 100",
      )
      .all();
    const counts = db
      .prepare("SELECT state,count(*) AS count FROM jobs GROUP BY state")
      .all();
    const failures = db
      .prepare(
        "SELECT category,severity,count(*) AS count FROM operational_events WHERE created_at>=? GROUP BY category,severity",
      )
      .all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const analytics = db
      .prepare(
        "SELECT day,event,sum(count) AS count FROM product_analytics WHERE day>=? GROUP BY day,event ORDER BY day DESC,event",
      )
      .all(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    return NextResponse.json(
      {
        jobs,
        events,
        counts,
        failures,
        analytics,
        storage: storageUsage(),
        policy: storagePolicy(),
        uptimeSeconds: Math.round(process.uptime()),
        memory: process.memoryUsage().rss,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Admin operations query failed", error);
    return NextResponse.json(
      { error: "Operational data is unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!adminAuthorized(request))
    return NextResponse.json(
      { error: "Administrator access required." },
      { status: 401 },
    );
  try {
    const body = await request.json();
    if (body.action === "backup") {
      const destination = await createSnapshot();
      return NextResponse.json({ destination }, { status: 201 });
    }
    if (body.action === "retry" && typeof body.jobId === "string") {
      const db = database();
      db.exec("BEGIN IMMEDIATE");
      let result;
      try {
        result = db
          .prepare(
            "UPDATE jobs SET state='queued',attempts=0,available_at=?,lease_until=0,error=NULL WHERE id=? AND state='failed'",
          )
          .run(Date.now(), body.jobId);
        if (result.changes) {
          const job = db
            .prepare("SELECT kind,media_id FROM jobs WHERE id=?")
            .get(body.jobId) as { kind: string; media_id: string };
          if (job.kind === "ingest")
            db.prepare(
              "UPDATE uploads SET state='queued',error=NULL WHERE id=?",
            ).run(job.media_id);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      if (!result.changes)
        return NextResponse.json(
          { error: "Failed job not found." },
          { status: 404 },
        );
      return NextResponse.json({ queued: true });
    }
    return NextResponse.json(
      { error: "Unknown admin action." },
      { status: 400 },
    );
  } catch (error) {
    console.error("Admin operation failed", error);
    return NextResponse.json(
      { error: "Admin operation failed." },
      { status: 503 },
    );
  }
}
