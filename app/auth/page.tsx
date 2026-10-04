"use client";

import { FormEvent, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function safeNext(value: string | null, fallback: string) {
  try {
    const target = new URL(value || fallback, window.location.origin);
    if (target.origin === window.location.origin)
      return target.pathname + target.search + target.hash;
  } catch {
    return fallback;
  }
  return fallback;
}

export default function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error"))
      setError(
        "Email verification failed. Please request a new verification email.",
      );
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const params = new URLSearchParams(window.location.search);
      if (mode === "signin") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        const invite = params.get("invite");
        window.location.assign(
          safeNext(
            params.get("next"),
            invite
              ? `/training?invite=${encodeURIComponent(invite)}`
              : "/training",
          ),
        );
        return;
      }
      const next = safeNext(params.get("next"), "/training");
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", next);
      const invite = params.get("invite");
      if (invite) callback.searchParams.set("invite", invite);
      const { error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: name.trim() },
          emailRedirectTo: callback.toString(),
        },
      });
      if (authError) throw authError;
      setMessage(
        "Check your email to verify your account, then return here to sign in.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Authentication failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="panel auth-panel">
        <p className="eyebrow">FORMSYNC AI</p>
        <h1>
          {mode === "signin" ? "Welcome back" : "Create your athlete account"}
        </h1>
        <p className="muted">
          Sign in to your private training workspace. Coach accounts are created
          by accepting an athlete&apos;s invitation.
        </p>
        <form className="hub-form" onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy}>
            {mode === "signup" && (
              <label className="field-label">
                Display name
                <input
                  required
                  maxLength={80}
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}
            <label className="field-label">
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field-label">
              Password
              <input
                type="password"
                required
                minLength={8}
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="button-primary">
              {busy
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </fieldset>
        </form>
        {error && (
          <p role="alert" className="feedback">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="success-feedback">
            {message}
          </p>
        )}
        <button
          type="button"
          className="text-link"
          onClick={() =>
            setMode((current) => (current === "signin" ? "signup" : "signin"))
          }
        >
          {mode === "signin"
            ? "New here? Create an athlete account"
            : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}
