import type { Session } from "./model";
import type { Workspace } from "./training";

export const BUILTIN_DRILLS = [
  {
    id: "builtin-form-shooting",
    name: "Form shooting",
    tag: "Shooting" as const,
    instructions:
      "Begin close to the basket. Use a balanced stance, repeat the same shooting setup, and record makes and misses.",
    demonstrationSessionId: null,
  },
  {
    id: "builtin-catch-and-shoot",
    name: "Catch-and-shoot",
    tag: "Shooting" as const,
    instructions:
      "Start at a chosen spot, receive or self-pass the ball, set your feet, and shoot. Keep the spot and pass consistent.",
    demonstrationSessionId: null,
  },
  {
    id: "builtin-lateral-footwork",
    name: "Lateral footwork",
    tag: "Footwork" as const,
    instructions:
      "Move laterally between two marks while maintaining balance and controlled steps. Rest if technique deteriorates.",
    demonstrationSessionId: null,
  },
  {
    id: "builtin-bodyweight-squat",
    name: "Bodyweight squat",
    tag: "Strength" as const,
    instructions:
      "Use a comfortable stance and controlled tempo. Record the same depth standard each session; stop if you feel pain.",
    demonstrationSessionId: null,
  },
  {
    id: "builtin-reverse-lunge",
    name: "Reverse lunge",
    tag: "Strength" as const,
    instructions:
      "Step backward under control, keep balance, and return to standing. Track each side separately if needed.",
    demonstrationSessionId: null,
  },
  {
    id: "builtin-countermovement-jump",
    name: "Countermovement jump",
    tag: "Plyometrics" as const,
    instructions:
      "Use a comfortable countermovement and land with control. Record repetitions only when each landing is stable.",
    demonstrationSessionId: null,
  },
  {
    id: "builtin-acceleration",
    name: "Short acceleration",
    tag: "Speed" as const,
    instructions:
      "Run a short marked distance with full recovery between efforts. Keep the distance and start position consistent.",
    demonstrationSessionId: null,
  },
] as const;

export const WORKOUT_PLAN_TEMPLATES = [
  {
    name: "Basketball shooting practice",
    drillIds: ["builtin-form-shooting", "builtin-catch-and-shoot"],
  },
  {
    name: "Strength fundamentals",
    drillIds: ["builtin-bodyweight-squat", "builtin-reverse-lunge"],
  },
  {
    name: "Speed and footwork",
    drillIds: ["builtin-acceleration", "builtin-lateral-footwork"],
  },
] as const;

export function adaptivePracticeSuggestions(
  sessions: Session[],
  logs: Workspace["workoutLogs"],
  today: string,
): string[] {
  const recent = sessions.filter(
    (session) =>
      session.date <= today &&
      (new Date(today + "T00:00:00Z").getTime() -
        new Date(session.date + "T00:00:00Z").getTime()) /
        86400000 <
        7,
  );
  const recentLoad = recent.reduce(
    (sum, session) => sum + (session.sessionLoad ?? 0),
    0,
  );
  const ratedLogs = logs
    .filter((log) => log.completedAt.slice(0, 10) <= today)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, 5);
  const suggestions: string[] = [];
  if (!sessions.length && !ratedLogs.length)
    return [
      "Record a practice session or workout to get data-based practice suggestions.",
    ];
  if (recent.length && recentLoad === 0)
    suggestions.push(
      "Log session duration and effort for recent practices to make workload suggestions more informative.",
    );
  const highEffort =
    ratedLogs.length > 0 &&
    ratedLogs.reduce((sum, log) => sum + log.effort, 0) / ratedLogs.length >= 8;
  const highFatigue =
    ratedLogs.length > 0 &&
    ratedLogs.reduce((sum, log) => sum + log.fatigue, 0) / ratedLogs.length >=
      4;
  if (highEffort || highFatigue)
    suggestions.push(
      "Recent workout ratings report high effort or fatigue. Consider adjusting the next planned volume to how you feel.",
    );
  if (recent.length >= 2) {
    const chronological = recent
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    const latest = chronological.at(-1)!;
    const prior = chronological.slice(0, -1);
    const priorSuccess = prior.reduce((sum, s) => sum + s.makes, 0);
    const priorAttempts = prior.reduce((sum, s) => sum + s.makes + s.misses, 0);
    const latestAttempts = latest.makes + latest.misses;
    if (
      priorAttempts >= 5 &&
      latestAttempts >= 5 &&
      priorSuccess / priorAttempts - latest.makes / latestAttempts >= 0.1
    )
      suggestions.push(
        `Your latest recorded success rate is lower than earlier recent sessions tagged ${latest.tags.join(", ") || "General"}. Repeat a familiar drill and compare like-for-like attempts.`,
      );
  }
  if (!suggestions.length)
    suggestions.push(
      "Recent logs show no high-effort or falling-success signal. Keep the next practice consistent and continue tracking comparable sessions.",
    );
  return suggestions;
}
