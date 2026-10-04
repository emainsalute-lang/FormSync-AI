import "server-only";
import { createSupabaseServerClient } from "./supabase/server";
import { supabaseConfigured } from "./supabase/config";
import { getMediaOwner, getVideoSession } from "./storage";
import { isOwnerVisible } from "./owner-scope";

export type AppIdentity = {
  userId: string;
  email?: string;
  role: "local" | "athlete" | "coach";
  accessibleOwnerIds: string[];
};

export async function appIdentity(): Promise<AppIdentity> {
  if (!supabaseConfigured())
    return { userId: "local", role: "local", accessibleOwnerIds: ["local"] };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error("Authentication could not be verified.");
  if (!data.user) throw new Error("Authentication required.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", data.user.id)
    .single();
  if (profileError) throw new Error("Account profile is unavailable.");
  const role = profile.role as "athlete" | "coach";
  if (role === "athlete")
    return {
      userId: data.user.id,
      email: data.user.email,
      role,
      accessibleOwnerIds: [data.user.id],
    };
  const { data: access, error: accessError } = await supabase
    .from("coach_access")
    .select("athlete_id")
    .eq("coach_id", data.user.id)
    .is("revoked_at", null);
  if (accessError) throw new Error("Coach access could not be verified.");
  return {
    userId: data.user.id,
    email: data.user.email,
    role,
    accessibleOwnerIds: (access || []).map((link) => link.athlete_id),
  };
}

export function canAccessOwner(identity: AppIdentity, ownerId?: string) {
  return isOwnerVisible(ownerId, identity.userId, identity.accessibleOwnerIds);
}

export async function canAccessMedia(identity: AppIdentity, mediaId: string) {
  const session = await getVideoSession(
    mediaId,
    identity.userId,
    identity.accessibleOwnerIds,
  );
  return Boolean(session || canAccessOwner(identity, getMediaOwner(mediaId)));
}
