import Dashboard from "@/components/dashboard";
import { appIdentity } from "@/lib/user-scope";
import LandingPage from "@/components/landing-page";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export default async function Page() {
  if (supabaseConfigured()) {
    const client = await createSupabaseServerClient();
    const { data } = await client.auth.getUser();
    if (!data.user) return <LandingPage />;
  }
  const identity = await appIdentity();
  return <Dashboard ownerId={identity.userId} />;
}
