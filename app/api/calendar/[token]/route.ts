import { resolveCalendarFeed } from "@/lib/calendar-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const calendar = await resolveCalendarFeed((await params).token);
    if (!calendar)
      return new Response("Calendar feed not found", { status: 404 });
    return new Response(calendar, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'inline; filename="formsync-training.ics"',
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("Calendar feed generation failed", error);
    return new Response("Calendar feed unavailable", { status: 503 });
  }
}
