"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { supabaseConfigured } from "@/lib/supabase/config";
import type { Session } from "@/lib/model";

type Profile = { user_id: string; display_name: string; role: "athlete" | "coach" };
type Access = { athlete_id: string; coach_id: string; granted_at: string; revoked_at: string | null };
type Invitation = { id: string; invitee_email: string; expires_at: string; accepted_at: string | null; revoked_at: string | null };
type Team = { id: string; name: string; coach_id: string };
type Assignment = {
  id: string;
  team_id: string | null;
  athlete_id: string;
  coach_id: string;
  title: string;
  instructions: string;
  sets: number;
  reps: number;
  due_at: string;
  completed_at: string | null;
  completed_sets: number;
};
type Feedback = {
  id: string;
  session_id: string;
  at_seconds: number;
  body: string;
  annotations: { tool: string; points: { x: number; y: number }[] }[];
  created_at: string;
  coach_id: string;
};
type Conversation = { id: string; athlete_id: string; coach_id: string };
type Message = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };
type Props = { sessions: Session[] };

export default function CoachTeamPanel({ sessions }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [userId, setUserId] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [access, setAccess] = useState<Access[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamMembers, setTeamMembers] = useState<Record<string, string[]>>({});
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [teamName, setTeamName] = useState("");
  const [selectedAthlete, setSelectedAthlete] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [assignmentInstructions, setAssignmentInstructions] = useState("");
  const [assignmentSets, setAssignmentSets] = useState(3);
  const [assignmentReps, setAssignmentReps] = useState(10);
  const [assignmentDue, setAssignmentDue] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [feedbackSession, setFeedbackSession] = useState("");
  const [feedbackTime, setFeedbackTime] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [markerX, setMarkerX] = useState(0.5);
  const [markerY, setMarkerY] = useState(0.5);
  const [messageText, setMessageText] = useState("");
  const [newCoachId, setNewCoachId] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) throw new Error("Sign in to access coach and team features.");
      setUserId(user.id);
      const profileResult = await supabase
        .from("profiles")
        .select("user_id,display_name,role")
        .eq("user_id", user.id)
        .single();
      if (profileResult.error) throw profileResult.error;
      const ownProfile = profileResult.data as Profile;
      setProfile(ownProfile);
      const accessResult = await supabase
        .from("coach_access")
        .select("athlete_id,coach_id,granted_at,revoked_at")
        .or(`athlete_id.eq.${user.id},coach_id.eq.${user.id}`);
      if (accessResult.error) throw accessResult.error;
      const links = (accessResult.data || []) as Access[];
      setAccess(links);
      const athleteIds = links.filter((link) => link.coach_id === user.id && !link.revoked_at).map((link) => link.athlete_id);
      const coachIds = links.filter((link) => link.athlete_id === user.id && !link.revoked_at).map((link) => link.coach_id);
      const visibleProfileIds = [...new Set([user.id, ...athleteIds, ...coachIds])];
      const [visibleProfiles, invites, ownTeams, ownAssignments, ownFeedback, ownConversations] =
        await Promise.all([
          supabase.from("profiles").select("user_id,display_name,role").in("user_id", visibleProfileIds),
          ownProfile.role === "athlete"
            ? supabase.from("coach_invitations").select("id,invitee_email,expires_at,accepted_at,revoked_at").eq("athlete_id", user.id).order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          supabase.from("teams").select("id,name,coach_id").eq("coach_id", user.id).order("created_at"),
          supabase.from("workout_assignments").select("*").eq(ownProfile.role === "coach" ? "coach_id" : "athlete_id", user.id).order("due_at"),
          supabase.from("coach_feedback").select("id,session_id,at_seconds,body,annotations,created_at,coach_id").eq(ownProfile.role === "coach" ? "coach_id" : "athlete_id", user.id).order("created_at", { ascending: false }),
          supabase.from("conversations").select("id,athlete_id,coach_id").or(`athlete_id.eq.${user.id},coach_id.eq.${user.id}`),
        ]);
      for (const result of [visibleProfiles, invites, ownTeams, ownAssignments, ownFeedback, ownConversations])
        if (result.error) throw result.error;
      const availableProfiles = (visibleProfiles.data || []) as Profile[];
      setProfiles(availableProfiles);
      setInvitations((invites.data || []) as Invitation[]);
      const teamRows = (ownTeams.data || []) as Team[];
      setTeams(teamRows);
      const membershipRows = await Promise.all(
        teamRows.map(async (team) => {
          const result = await supabase.from("team_members").select("athlete_id").eq("team_id", team.id);
          if (result.error) throw result.error;
          return [team.id, (result.data || []).map((row) => row.athlete_id)] as const;
        }),
      );
      setTeamMembers(Object.fromEntries(membershipRows));
      setAssignments((ownAssignments.data || []) as Assignment[]);
      setFeedback((ownFeedback.data || []) as Feedback[]);
      const threads = (ownConversations.data || []) as Conversation[];
      setConversations(threads);
      setSelectedConversation((current) =>
        threads.some((thread) => thread.id === current)
          ? current
          : threads[0]?.id || "",
      );
      if (ownProfile.role === "coach" && !selectedAthlete && athleteIds[0])
        setSelectedAthlete(athleteIds[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Team data could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [selectedAthlete, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const code = new URLSearchParams(window.location.search).get("invite");
    if (!code) return;
    void (async () => {
      setBusy(true);
      try {
        const { error: acceptError } = await supabase.rpc(
          "accept_coach_invitation",
          { p_code: code },
        );
        if (acceptError) throw acceptError;
        const url = new URL(window.location.href);
        url.searchParams.delete("invite");
        window.history.replaceState({}, "", url);
        setStatus("Invitation accepted. Your coach account is now linked.");
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Invitation could not be accepted.");
      } finally {
        setBusy(false);
      }
    })();
  }, [load, supabase, userId]);

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([]);
      return;
    }
    void supabase
      .from("conversation_messages")
      .select("id,conversation_id,sender_id,body,created_at")
      .eq("conversation_id", selectedConversation)
      .order("created_at")
      .then(({ data, error: messageError }) => {
        if (messageError) setError(messageError.message);
        else setMessages((data || []) as Message[]);
      });
  }, [selectedConversation, supabase]);

  const profileName = (id: string) =>
    profiles.find((item) => item.user_id === id)?.display_name || "Athlete";
  const activeAthletes = access
    .filter((link) => link.coach_id === userId && !link.revoked_at)
    .map((link) => link.athlete_id);
  const activeCoaches = access
    .filter((link) => link.athlete_id === userId && !link.revoked_at)
    .map((link) => link.coach_id);
  const currentThread = conversations.find(
    (thread) => thread.id === selectedConversation,
  );

  async function runAction(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
      setStatus(success);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function createInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const { data, error: inviteError } = await supabase.rpc(
        "create_coach_invitation",
        { p_email: inviteEmail.trim() },
      );
      if (inviteError) throw inviteError;
      const invite = Array.isArray(data) ? data[0] : data;
      if (!invite?.invite_code)
        throw new Error("The invitation was created but no acceptance code was returned.");
      const url = new URL("/auth", window.location.origin);
      url.searchParams.set("invite", invite.invite_code);
      setInviteUrl(url.toString());
      setInviteEmail("");
    }, "Invitation created. Share the link with the invited email address.");
  }

  async function createTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const { error: insertError } = await supabase
        .from("teams")
        .insert({ coach_id: userId, name: teamName.trim() });
      if (insertError) throw insertError;
      setTeamName("");
    }, "Team created.");
  }

  async function addRosterMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const { error: insertError } = await supabase
        .from("team_members")
        .insert({ team_id: selectedTeam, athlete_id: selectedAthlete });
      if (insertError) throw insertError;
    }, "Athlete added to the team roster.");
  }

  async function assignWorkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const { error: insertError } = await supabase
        .from("workout_assignments")
        .insert({
          team_id: selectedTeam || null,
          athlete_id: selectedAthlete,
          coach_id: userId,
          title: assignmentTitle.trim(),
          instructions: assignmentInstructions.trim(),
          sets: assignmentSets,
          reps: assignmentReps,
          due_at: assignmentDue,
        });
      if (insertError) throw insertError;
      setAssignmentTitle("");
      setAssignmentInstructions("");
    }, "Workout assigned.");
  }

  async function saveFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const { error: insertError } = await supabase.from("coach_feedback").insert({
        athlete_id: selectedAthlete,
        coach_id: userId,
        session_id: feedbackSession,
        at_seconds: feedbackTime,
        body: feedbackText.trim(),
        annotations: [
          {
            tool: "marker",
            points: [{ x: markerX, y: markerY }],
          },
        ],
      });
      if (insertError) throw insertError;
      setFeedbackText("");
    }, "Timestamped feedback and annotation saved.");
  }

  async function openConversation(otherUserId: string) {
    await runAction(async () => {
      const isCoach = profile?.role === "coach";
      const athleteId = isCoach ? userId === otherUserId ? "" : otherUserId : userId;
      const coachId = isCoach ? userId : otherUserId;
      if (!athleteId)
        throw new Error("Choose a linked athlete to start a conversation.");
      const { data, error: threadError } = await supabase
        .from("conversations")
        .upsert(
          { athlete_id: athleteId, coach_id: coachId },
          { onConflict: "athlete_id,coach_id", ignoreDuplicates: true },
        )
        .select("id,athlete_id,coach_id")
        .maybeSingle();
      if (threadError) throw threadError;
      if (data) setSelectedConversation((data as Conversation).id);
      else {
        const query = await supabase
          .from("conversations")
          .select("id,athlete_id,coach_id")
          .eq("athlete_id", athleteId)
          .eq("coach_id", coachId)
          .single();
        if (query.error) throw query.error;
        setSelectedConversation((query.data as Conversation).id);
      }
    }, "Private conversation opened.");
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentThread) return;
    await runAction(async () => {
      const { error: insertError } = await supabase
        .from("conversation_messages")
        .insert({
          conversation_id: currentThread.id,
          sender_id: userId,
          body: messageText.trim(),
        });
      if (insertError) throw insertError;
      setMessageText("");
      const result = await supabase
        .from("conversation_messages")
        .select("id,conversation_id,sender_id,body,created_at")
        .eq("conversation_id", currentThread.id)
        .order("created_at");
      if (result.error) throw result.error;
      setMessages((result.data || []) as Message[]);
    }, "Message sent.");
  }

  if (!supabaseConfigured())
    return (
      <section className="panel hub-panel">
        <h2>Coach & team access</h2>
        <p>
          Configure Supabase Auth and apply the Phase 8 migration to enable
          verified coach invitations, teams, assignments and conversations.
        </p>
      </section>
    );

  return (
    <div className="practice-panel">
      <section className="panel hub-panel">
        <div className="storage-heading">
          <h2>{profile?.role === "coach" ? "Coach dashboard" : "Athlete & coach access"}</h2>
          <button
            className="button-ghost"
            disabled={busy}
            onClick={() => void supabase.auth.signOut().then(() => location.assign("/auth"))}
          >
            Sign out
          </button>
        </div>
        {profile && (
          <p className="muted">
            {profile.display_name || "Account"} · {profile.role} ·{" "}
            {activeCoaches.length} active coach link(s) · {activeAthletes.length} linked athlete(s)
          </p>
        )}
        <button className="button-ghost" disabled={busy} onClick={() => void load()}>
          Refresh collaboration data
        </button>
        {status && <p role="status" className="success-feedback">{status}</p>}
        {error && <p role="alert" className="feedback">{error}</p>}
      </section>

      {profile?.role === "athlete" ? (
        <>
          <section className="panel hub-panel">
            <h2>Invite a coach</h2>
            <p className="muted">
              The invited email must create/sign in to a verified account and
              accept your link. You can revoke access at any time. Send the
              generated link yourself; this deployment does not send email.
            </p>
            <form className="hub-form" onSubmit={(event) => void createInvitation(event)}>
              <fieldset disabled={busy}>
                <label className="field-label">
                  Coach email
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                  />
                </label>
                <button className="button-primary">Create invitation link</button>
              </fieldset>
            </form>
            {inviteUrl && (
              <label className="field-label">
                Invitation link
                <input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
              </label>
            )}
            <div className="hub-list">
              {activeCoaches.map((coachId) => (
                <article key={coachId}>
                  <h3>{profileName(coachId)}</h3>
                  <p>Coach access is active.</p>
                  <button
                    className="button-ghost"
                    disabled={busy}
                    onClick={() =>
                      void runAction(async () => {
                        const { error: revokeError } = await supabase
                          .from("coach_access")
                          .update({ revoked_at: new Date().toISOString() })
                          .eq("athlete_id", userId)
                          .eq("coach_id", coachId);
                        if (revokeError) throw revokeError;
                      }, "Coach access revoked.")
                    }
                  >
                    Revoke coach access
                  </button>
                  <button className="button-ghost" onClick={() => void openConversation(coachId)}>
                    Open private conversation
                  </button>
                </article>
              ))}
              {invitations.filter((invite) => !invite.accepted_at && !invite.revoked_at).map((invite) => (
                <article key={invite.id}>
                  <p>Invitation pending for {invite.invitee_email} until {new Date(invite.expires_at).toLocaleDateString()}.</p>
                  <button
                    className="text-link"
                    onClick={() =>
                      void runAction(async () => {
                        const { error: revokeError } = await supabase
                          .from("coach_invitations")
                          .update({ revoked_at: new Date().toISOString() })
                          .eq("id", invite.id);
                        if (revokeError) throw revokeError;
                      }, "Pending invitation revoked.")
                    }
                  >
                    Revoke invitation
                  </button>
                </article>
              ))}
            </div>
          </section>
          <section className="panel hub-panel">
            <h2>Assigned workouts</h2>
            <div className="hub-list">
              {assignments.map((assignment) => (
                <article key={assignment.id}>
                  <h3>{assignment.title}</h3>
                  <p>{assignment.instructions}</p>
                  <p>{assignment.due_at} · {assignment.completed_sets}/{assignment.sets} sets · {assignment.reps} reps per set</p>
                  <button
                    className="button-primary"
                    disabled={busy || Boolean(assignment.completed_at)}
                    onClick={() =>
                      void runAction(async () => {
                        const { error: completeError } = await supabase.rpc(
                          "complete_workout_assignment",
                          {
                            p_assignment: assignment.id,
                            p_completed_sets: assignment.sets,
                          },
                        );
                        if (completeError) throw completeError;
                      }, "Assignment completion recorded.")
                    }
                  >
                    {assignment.completed_at ? "Completed" : "Mark assignment complete"}
                  </button>
                </article>
              ))}
              {!assignments.length && <p>No workouts have been assigned.</p>}
            </div>
          </section>
        </>
      ) : profile?.role === "coach" ? (
        <>
          <section className="panel hub-panel">
            <h2>Team roster</h2>
            <form className="hub-form" onSubmit={(event) => void createTeam(event)}>
              <fieldset disabled={busy}>
                <label className="field-label">
                  Team name
                  <input required maxLength={100} value={teamName} onChange={(event) => setTeamName(event.target.value)} />
                </label>
                <button className="button-primary">Create team</button>
              </fieldset>
            </form>
            <form className="hub-form" onSubmit={(event) => void addRosterMember(event)}>
              <fieldset disabled={busy || !teams.length || !activeAthletes.length}>
                <div className="hub-controls">
                  <label className="field-label">
                    Team
                    <select required value={selectedTeam} onChange={(event) => setSelectedTeam(event.target.value)}>
                      <option value="">Choose team</option>
                      {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                    </select>
                  </label>
                  <label className="field-label">
                    Athlete
                    <select required value={selectedAthlete} onChange={(event) => setSelectedAthlete(event.target.value)}>
                      <option value="">Choose linked athlete</option>
                      {activeAthletes.map((id) => <option key={id} value={id}>{profileName(id)}</option>)}
                    </select>
                  </label>
                </div>
                <button className="button-primary">Add linked athlete to team</button>
              </fieldset>
            </form>
            <div className="hub-list">
              {teams.map((team) => (
                <article key={team.id}>
                  <h3>{team.name}</h3>
                  <ul>
                    {(teamMembers[team.id] || []).map((athleteId) => (
                      <li key={athleteId}>{profileName(athleteId)}</li>
                    ))}
                  </ul>
                  <p>
                    {assignments.filter((assignment) => assignment.team_id === team.id && assignment.completed_at).length} completed assignments ·{" "}
                    {assignments.filter((assignment) => assignment.team_id === team.id && !assignment.completed_at).length} open assignments
                  </p>
                </article>
              ))}
              {!teams.length && <p>Create a team and add athletes who have linked their accounts to you.</p>}
            </div>
          </section>
          <section className="panel hub-panel">
            <h2>Assign a workout</h2>
            <form className="hub-form" onSubmit={(event) => void assignWorkout(event)}>
              <fieldset disabled={busy || !activeAthletes.length}>
                <div className="hub-controls">
                  <label className="field-label">
                    Athlete
                    <select required value={selectedAthlete} onChange={(event) => setSelectedAthlete(event.target.value)}>
                      <option value="">Choose linked athlete</option>
                      {activeAthletes.map((id) => <option key={id} value={id}>{profileName(id)}</option>)}
                    </select>
                  </label>
                  <label className="field-label">
                    Team (optional)
                    <select value={selectedTeam} onChange={(event) => setSelectedTeam(event.target.value)}>
                      <option value="">Individual assignment</option>
                      {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                    </select>
                  </label>
                </div>
                <label className="field-label">
                  Assignment title
                  <input required maxLength={100} value={assignmentTitle} onChange={(event) => setAssignmentTitle(event.target.value)} />
                </label>
                <label className="field-label">
                  Instructions
                  <textarea maxLength={2000} value={assignmentInstructions} onChange={(event) => setAssignmentInstructions(event.target.value)} />
                </label>
                <div className="hub-controls">
                  <label className="field-label">
                    Due date
                    <input type="date" required value={assignmentDue} onChange={(event) => setAssignmentDue(event.target.value)} />
                  </label>
                  <label className="field-label">
                    Sets
                    <input type="number" min="1" max="30" value={assignmentSets} onChange={(event) => setAssignmentSets(Number(event.target.value))} />
                  </label>
                  <label className="field-label">
                    Reps
                    <input type="number" min="1" max="1000" value={assignmentReps} onChange={(event) => setAssignmentReps(Number(event.target.value))} />
                  </label>
                </div>
                <button className="button-primary">Assign workout</button>
              </fieldset>
            </form>
            <div className="hub-list">
              {assignments.map((assignment) => (
                <article key={assignment.id}>
                  <h3>{profileName(assignment.athlete_id)} · {assignment.title}</h3>
                  <p>{assignment.due_at} · {assignment.completed_sets}/{assignment.sets} sets · {assignment.completed_at ? "Completed" : "Open"}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="panel hub-panel">
            <h2>Timestamped video feedback</h2>
            <form className="hub-form" onSubmit={(event) => void saveFeedback(event)}>
              <fieldset disabled={busy || !activeAthletes.length || !sessions.length}>
                <div className="hub-controls">
                  <label className="field-label">
                    Athlete
                    <select required value={selectedAthlete} onChange={(event) => setSelectedAthlete(event.target.value)}>
                      <option value="">Choose linked athlete</option>
                      {activeAthletes.map((id) => <option key={id} value={id}>{profileName(id)}</option>)}
                    </select>
                  </label>
                  <label className="field-label">
                    Athlete video session
                    <select required value={feedbackSession} onChange={(event) => setFeedbackSession(event.target.value)}>
                      <option value="">Choose a saved session</option>
                      {sessions.map((session) => <option key={session.id} value={session.id}>{session.name} · {session.date}</option>)}
                    </select>
                  </label>
                  <label className="field-label">
                    Feedback timestamp (seconds)
                    <input type="number" min="0" max="1800" step="0.01" value={feedbackTime} onChange={(event) => setFeedbackTime(Number(event.target.value))} />
                  </label>
                </div>
                <label className="field-label">
                  Coach feedback
                  <textarea required maxLength={2000} value={feedbackText} onChange={(event) => setFeedbackText(event.target.value)} />
                </label>
                <div className="hub-controls">
                  <label className="field-label">
                    Annotation marker X (0–1)
                    <input type="number" min="0" max="1" step="0.01" value={markerX} onChange={(event) => setMarkerX(Number(event.target.value))} />
                  </label>
                  <label className="field-label">
                    Annotation marker Y (0–1)
                    <input type="number" min="0" max="1" step="0.01" value={markerY} onChange={(event) => setMarkerY(Number(event.target.value))} />
                  </label>
                </div>
                <button className="button-primary">Save timestamped feedback</button>
              </fieldset>
            </form>
          </section>
        </>
      ) : (
        <section className="panel hub-panel">
          <h2>Loading account…</h2>
        </section>
      )}

      {profile && (
        <section className="panel hub-panel">
          <h2>Private athlete–coach conversation</h2>
          <div className="hub-controls">
            <label className="field-label">
              Conversation participant
              <select
                value={newCoachId}
                onChange={(event) => setNewCoachId(event.target.value)}
              >
                <option value="">Choose a linked participant</option>
                {(profile.role === "coach" ? activeAthletes : activeCoaches).map((id) => (
                  <option key={id} value={id}>{profileName(id)}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button-ghost"
              disabled={!newCoachId || busy}
              onClick={() => void openConversation(newCoachId)}
            >
              Open conversation
            </button>
          </div>
          <label className="field-label">
            Existing conversation
            <select value={selectedConversation} onChange={(event) => setSelectedConversation(event.target.value)}>
              <option value="">Choose conversation</option>
              {conversations.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {profileName(profile.role === "coach" ? thread.athlete_id : thread.coach_id)}
                </option>
              ))}
            </select>
          </label>
          <div className="hub-list">
            {messages.map((message) => (
              <article key={message.id}>
                <p>{message.body}</p>
                <small>{message.sender_id === userId ? "You" : profileName(message.sender_id)} · {new Date(message.created_at).toLocaleString()}</small>
              </article>
            ))}
          </div>
          {currentThread && (
            <form className="hub-form" onSubmit={(event) => void sendMessage(event)}>
              <fieldset disabled={busy}>
                <label className="field-label">
                  Message
                  <textarea required maxLength={4000} value={messageText} onChange={(event) => setMessageText(event.target.value)} />
                </label>
                <button className="button-primary">Send private message</button>
              </fieldset>
            </form>
          )}
        </section>
      )}

      {profile?.role === "athlete" && (
        <section className="panel hub-panel">
          <h2>Coach video feedback</h2>
          <div className="hub-list">
            {feedback.map((item) => {
              const session = sessions.find((candidate) => candidate.id === item.session_id);
              return (
                <article key={item.id}>
                  <h3>{session?.name || "Saved session"} · {item.at_seconds.toFixed(2)}s</h3>
                  <p>{item.body}</p>
                  {session && (
                    <a
                      className="text-link"
                      href={`/api/videos/${session.videoId}#t=${item.at_seconds}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open video at feedback timestamp
                    </a>
                  )}
                  <small>Coach {profileName(item.coach_id)} · {new Date(item.created_at).toLocaleString()}</small>
                </article>
              );
            })}
            {!feedback.length && <p>No coach feedback yet.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
