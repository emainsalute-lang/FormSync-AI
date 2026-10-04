"use client";
import { useEffect, useState } from "react";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function AppInstall() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;
    void navigator.serviceWorker.register("/sw.js").catch((cause) => {
      console.error("Offline app support could not be registered", cause);
      setError("Offline support could not be enabled in this browser.");
    });
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    const installed = () => setPrompt(null);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  return prompt || error ? (
    <div className="install-bar">
      <span>{error || "Keep your training workspace within reach."}</span>
      {prompt && (
        <button
          className="button-ghost"
          onClick={async () => {
            try {
              await prompt.prompt();
              await prompt.userChoice;
              setPrompt(null);
            } catch (cause) {
              console.error("App installation prompt failed", cause);
              setError(
                "The app could not be installed. Use your browser menu to install it.",
              );
            }
          }}
        >
          Install FormSync
        </button>
      )}
    </div>
  ) : null;
}
