import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveShareToken } from "@/lib/share-links";
import styles from "./share.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Shared training clip | FormSync AI",
  referrer: "no-referrer" as const,
};

export default async function SharedSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveShareToken(token);
  if (!resolved) notFound();
  const { session, link } = resolved;
  return (
    <main className={styles.page}>
      <header>
        <Link href="/" className={styles.brand}>
          FormSync AI
        </Link>
        <span>Shared training clip</span>
      </header>
      <section>
        <p className={styles.eyebrow}>READ-ONLY VIDEO REVIEW</p>
        <h1>{session.name}</h1>
        <p>
          {session.date} · {session.reps} reps · {session.makes} makes /{" "}
          {session.misses} misses
        </p>
        <video
          controls
          playsInline
          preload="metadata"
          src={`/api/share/${token}/video`}
        />
        <p className={styles.expiry}>
          {link.expires_at
            ? `This link expires ${new Date(link.expires_at).toLocaleDateString()}.`
            : "This link does not expire. The athlete can revoke it at any time."}
        </p>
      </section>
      <footer>
        Shared by an athlete using FormSync AI. This link grants access to this
        clip only.
      </footer>
    </main>
  );
}
