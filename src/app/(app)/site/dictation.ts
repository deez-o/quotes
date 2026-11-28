"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal types for the browser speech API (Chrome, Edge, Safari on iPhone). */
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void;
};
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Live dictation on the phone, free, no server. Final words are appended
 * through `onText`; `interim` shows what is being heard right now.
 * Where the browser has no speech support, the phone keyboard's mic still works.
 */
export function useDictation(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);
  // Words heard but not yet marked final. iPhones often never mark them final, so keep them when listening ends.
  const pending = useRef("");
  const lastCommitted = useRef("");
  const commit = useCallback(() => {
    const t = pending.current.trim();
    pending.current = "";
    if (t) { lastCommitted.current = t; onTextRef.current(t); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection after mount
    setSupported(Boolean(getCtor()));
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) { setError("This browser can't take voice here. Use the microphone on your keyboard instead."); return; }
    setError(null);
    const r = new Ctor();
    r.lang = "en-AU";
    r.continuous = true; // as Quick quote has always used it
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const said = res[0].transcript.trim();
          pending.current = "";
          // Already kept when listening paused: don't add it twice.
          if (said && said !== lastCommitted.current) onTextRef.current(said);
          lastCommitted.current = "";
        }
        else live += res[0].transcript;
      }
      pending.current = live;
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // a pause, or we stopped it
      wanted.current = false;
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone access is blocked. Allow it for quoteout in your browser settings, or use your keyboard's mic."
          : e.error === "audio-capture" ? "No microphone found. Use your keyboard's mic instead."
          : e.error === "network" ? "Voice needs an internet connection. Use your keyboard's mic, or try again."
          : "Voice stopped working. Tap Talk to try again, or use your keyboard's mic.",
      );
    };
    // Phones stop listening after a pause: keep what was heard, and keep going until the user taps stop.
    r.onend = () => {
      commit();
      setInterim("");
      if (wanted.current) {
        try { r.start(); } catch { setListening(false); wanted.current = false; }
      } else {
        setListening(false);
      }
    };
    rec.current = r;
    wanted.current = true;
    try {
      r.start();
      setListening(true);
    } catch {
      wanted.current = false;
      setListening(false);
      setError("Voice couldn't start. Tap Talk again, or use your keyboard's mic.");
    }
  }, [commit]);

  const stop = useCallback(() => {
    wanted.current = false;
    try { rec.current?.stop(); } catch { /* already stopped */ }
    commit();
    setInterim("");
    setListening(false);
  }, [commit]);

  useEffect(() => () => { wanted.current = false; rec.current?.stop(); }, []);

  return { supported, listening, interim, error, start, stop };
}
