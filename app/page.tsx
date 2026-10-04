import Dashboard from "@/components/dashboard";
import { appIdentity } from "@/lib/user-scope";
export default async function Page() {
  const identity = await appIdentity();
  return <Dashboard ownerId={identity.userId} />;
}
