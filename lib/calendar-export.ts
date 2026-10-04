type CalendarPlan = {
  id: string;
  name: string;
  date: string;
  target: number;
  done: boolean;
};

const escapeText = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

export function workoutsToCalendar(plans: CalendarPlan[]) {
  const events = plans.map((plan) => {
    const day = plan.date.replaceAll("-", "");
    const next = new Date(`${plan.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const end = next.toISOString().slice(0, 10).replaceAll("-", "");
    return [
      "BEGIN:VEVENT",
      `UID:${plan.id}@formsync.ai`,
      `DTSTAMP:${new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "")}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escapeText(plan.name)}`,
      `DESCRIPTION:${escapeText(`${plan.target} target reps · ${plan.done ? "Completed" : "Planned"}`)}`,
      "END:VEVENT",
    ].join("\r\n");
  });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FormSync AI//Training Calendar//EN",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
