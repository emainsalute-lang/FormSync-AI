"use client";

import { useEffect, useRef, useState } from "react";

type ResultEvent = Event & {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};
type SpeechRecognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: ResultEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognizer;
  webkitSpeechRecognition?: new () => SpeechRecognizer;
};

export default function VoiceNoteInput({
  value,
  onChange,
  onTranscript,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  onTranscript: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const recognition = useRef<SpeechRecognizer | null>(null);
  useEffect(() => () => recognition.current?.stop(), []);
  function toggle() {
    setError("");
    if (recording) {
      recognition.current?.stop();
      setRecording(false);
      return;
    }
    const api = window as SpeechWindow;
    const Constructor = api.SpeechRecognition || api.webkitSpeechRecognition;
    if (!Constructor) {
      setError(
        "Voice input is not supported in this browser. You can still type your note.",
      );
      return;
    }
    try {
      const instance = new Constructor();
      instance.lang = navigator.language || "en-US";
      instance.continuous = true;
      instance.interimResults = false;
      instance.onresult = (event) => {
        const transcript = Array.from(event.results)
          .slice(event.resultIndex)
          .map((result) => result[0]?.transcript || "")
          .join(" ")
          .trim();
        if (transcript) onTranscript(transcript);
      };
      instance.onerror = () => {
        setError(
          "Voice recognition stopped. Check microphone permission and try again.",
        );
        setRecording(false);
      };
      instance.onend = () => setRecording(false);
      recognition.current = instance;
      instance.start();
      setRecording(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not start voice recognition.",
      );
    }
  }
  return (
    <div>
      <textarea {...props} value={value} onChange={onChange} />
      <button
        type="button"
        className="button-ghost"
        aria-pressed={recording}
        onClick={toggle}
      >
        {recording ? "Stop voice input" : "Speak note"}
      </button>
      {recording && <span role="status">Listening…</span>}
      {error && (
        <p role="alert" className="feedback">
          {error}
        </p>
      )}
    </div>
  );
}
