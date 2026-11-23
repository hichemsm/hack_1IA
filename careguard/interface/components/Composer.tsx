"use client";

import { useRef, useState } from "react";

const SUGGESTIONS = [
  "Combien de franchise me reste-t-il ?",
  "Que rembourse ma mutuelle ?",
  "Pourquoi une facture est-elle bloquée ?",
];

export default function Composer(props: {
  busy: boolean;
  onSend: (text: string) => void;
  onFile: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function send() {
    const t = text.trim();
    if (!t || props.busy) return;
    props.onSend(t);
    setText("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => fileRef.current?.click()} style={chip}>Déposer une facture</button>
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => props.onSend(s)} disabled={props.busy} style={chip}>{s}</button>
        ))}
        <a href="/soignants" style={{ ...chip, textDecoration: "none" }}>Ajouter un soignant</a>
      </div>

      <div
        style={{
          display: "flex", gap: 8, alignItems: "center", border: "1px solid #b5d4f4",
          borderRadius: 12, padding: "6px 8px", background: "var(--cg-bg)",
        }}
      >
        <button onClick={() => fileRef.current?.click()} aria-label="Joindre une facture" style={iconBtn}>📎</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) props.onFile(f);
            e.target.value = "";
          }}
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Posez une question ou glissez une facture…"
          aria-label="Votre message"
          style={{ flex: 1, border: "none", outline: "none", font: "inherit", color: "var(--cg-text)", background: "transparent" }}
        />
        <button
          onClick={send}
          aria-label="Envoyer"
          style={{
            width: 30, height: 30, borderRadius: 8, border: "none",
            background: props.busy ? "var(--cg-mutuelle)" : "var(--cg-action)", color: "#fff",
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}

const chip = {
  fontSize: 12, padding: "4px 10px", border: "1px solid var(--cg-border)", borderRadius: 999,
  color: "var(--cg-secu)", background: "var(--cg-bg)",
} as const;
const iconBtn = { background: "none", border: "none", fontSize: 16, color: "var(--cg-muted)" } as const;
