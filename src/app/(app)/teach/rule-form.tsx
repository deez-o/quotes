"use client";

import { useState } from "react";
import { useDictation } from "../site/dictation";
import { addRule } from "./actions";

/** Type or say a rule. It applies to quotes straight away. */
export function RuleForm() {
  const [text, setText] = useState("");
  const dictation = useDictation((t) => setText((c) => (c ? `${c} ${t}` : t)));
  const shown = dictation.interim ? `${text} ${dictation.interim}`.trim() : text;

  return (
    <form action={async (fd) => { dictation.stop(); await addRule(fd); setText(""); }} className="card focus" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label htmlFor="text" style={{ fontSize: 15 }}>
        {dictation.listening ? <span style={{ color: "var(--accent)" }}>● Listening... say your rule</span> : "Tell quoteout how you do it"}
      </label>
      <textarea id="text" name="text" rows={3} required value={shown} onChange={(e) => setText(e.target.value)} readOnly={dictation.listening}
        placeholder="e.g. For any carpark over 2,000 m², always allow 3 establishments, not 2." />
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="sub" style={{ marginTop: 0, fontSize: 13 }}>{dictation.supported ? "Type it or tap Talk." : "Type it, or use your keyboard's mic."} It applies to your quotes as soon as you save it.</span>
        <div className="row" style={{ gap: 8 }}>
          {dictation.supported && (
            <button type="button" className="btn" onClick={() => {
              if (dictation.listening) return dictation.stop();
              (document.activeElement as HTMLElement | null)?.blur(); // close the keyboard so the mic gets the audio
              dictation.start();
            }}>{dictation.listening ? "Stop" : "Talk"}</button>
          )}
          <button type="submit" className="btn primary" disabled={shown.trim().length < 5}>Save rule</button>
        </div>
      </div>
      {dictation.error && <p className="error" style={{ margin: 0 }}>{dictation.error}</p>}
    </form>
  );
}
