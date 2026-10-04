import TrainingHub from "@/components/training-hub";
import { appIdentity } from "@/lib/user-scope";
export default async function TrainingPage() {
  const identity = await appIdentity();
  return <TrainingHub ownerId={identity.userId} />;
}
