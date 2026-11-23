"use client";

import { useState } from "react";
import type { InvoiceResponse } from "@/lib/types";
import { eur, EXPLORER, useCountUp } from "./format";

const AGENT: Record<string, string> = {
  orchestrateur: "Orchestrateur",
  montants: "Agent montants",
  securite: "Agent sécurité",
  transaction: "Agent transaction",
  aidante: "Vous",
};

export default function InvoiceCard(props: {
  result: InvoiceResponse;
  onConfirm: () => void;
  onApproveOnChain: (pendingId: string) => void;
  onDismiss: () => void;
}) {
  const r = props.result;
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const status = r.txItem.status;
  const blocked = status === "blocked";

  const total = Math.max(1, r.invoice.montantCents);
  const secu = useCountUp(r.breakdown.secuCents);
  const mut = useCountUp(r.breakdown.mutuelleCents);
  const reste = useCountUp(r.breakdown.resteAChargeCents);
  const w = (c: number) => `${Math.max(0, (c / total) * 100)}%`;

  return (
    <div
      className={`cg-appear${blocked ? " cg-shake" : ""}`}
      style={{
        border: `1px solid ${blocked ? "#f09595" : "var(--cg-border-soft)"}`,
        background: blocked ? "var(--cg-ko-bg)" : "var(--cg-bg)",
        borderRadius: 12, padding: 14, maxWidth: 560,
      }}
    >
      <div style={{ fontFamily: "var(--cg-voice)", marginBottom: 10, color: blocked ? "var(--cg-ko)" : "var(--cg-text)" }}>
        {r.explanation}
      </div>

      {r.breakdown.remboursable || !blocked ? (
        <>
          <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 2, marginBottom: 6, background: "#f2f6fb" }}>
            <div style={{ width: w(r.breakdown.secuCents), background: "var(--cg-secu)", transition: "width 600ms ease-out" }} />
            <div style={{ width: w(r.breakdown.mutuelleCents), background: "var(--cg-mutuelle)", transition: "width 600ms ease-out" }} />
            <div style={{ width: w(r.breakdown.resteAChargeCents), background: "var(--cg-reste)", transition: "width 600ms ease-out" }} />
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--cg-muted)", flexWrap: "wrap" }}>
            <Legend color="var(--cg-secu)" label={`Sécu ${eur(secu)}`} />
            <Legend color="var(--cg-mutuelle)" label={`Mutuelle ${eur(mut)}`} />
            <Legend color="var(--cg-reste)" label={`Vous ${eur(reste)}`} strong />
          </div>
        </>
      ) : null}

      {!dismissed && status === "escalate" && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={props.onConfirm} style={primary}>Valider ce paiement</button>
          <button onClick={() => { setDismissed(true); props.onDismiss(); }} style={secondary}>Ne pas payer</button>
        </div>
      )}
      {!dismissed && status === "queued" && r.txItem.pendingId && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button onClick={() => props.onApproveOnChain(r.txItem.pendingId!)} style={primary}>Valider dans le coffre</button>
          <span style={{ fontSize: 12, color: "var(--cg-muted)" }}>Signé par votre wallet</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12, flexWrap: "wrap" }}>
        <button onClick={() => setOpen(!open)} style={link}>
          {open ? "▴ Masquer" : "▾ Voir"} le raisonnement des agents
        </button>
        {"txHash" in r.tx && r.tx.txHash && (
          <a href={`${EXPLORER}/tx/${r.tx.txHash}`} target="_blank" rel="noreferrer">Voir sur l'explorateur ↗</a>
        )}
      </div>

      {open && (
        <div className="cg-appear" style={{ marginTop: 10, borderTop: "1px solid var(--cg-border-soft)", paddingTop: 10, fontSize: 13 }}>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {r.trace.map((m, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <span style={{ color: "var(--cg-ink)", fontWeight: 500 }}>{AGENT[m.from]}</span>
                <span style={{ color: "var(--cg-muted)" }}> → {AGENT[m.to]} : </span>
                {m.summary}
              </li>
            ))}
          </ol>
          {r.risk.reasons.length > 0 && (
            <div style={{ marginTop: 8, color: "var(--cg-muted)" }}>
              Score de risque {r.risk.score} :{" "}
              {r.risk.reasons.map((x) => `${x.message} (${x.points})`).join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, strong }: { color: string; label: string; strong?: boolean }) {
  return (
    <span style={{ color: strong ? "var(--cg-text)" : undefined, fontWeight: strong ? 500 : 400 }}>
      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color, marginRight: 5 }} />
      {label}
    </span>
  );
}

const primary = {
  background: "var(--cg-action)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px",
} as const;
const secondary = {
  background: "var(--cg-bg)", color: "var(--cg-ink)", border: "1px solid var(--cg-border)", borderRadius: 8, padding: "6px 12px",
} as const;
const link = { background: "none", border: "none", padding: 0, color: "var(--cg-action)", fontSize: 12 } as const;
