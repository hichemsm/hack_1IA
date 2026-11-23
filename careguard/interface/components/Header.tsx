"use client";

import type { TxItem } from "@/lib/types";
import { eur, EXPLORER } from "./format";

const PILL: Record<TxItem["status"], { bg: string; fg: string; icon: string; suffix: string }> = {
  paid: { bg: "var(--cg-ok-bg)", fg: "var(--cg-ok)", icon: "✓", suffix: "" },
  queued: { bg: "var(--cg-wait-bg)", fg: "var(--cg-wait)", icon: "◷", suffix: " · à valider" },
  escalate: { bg: "var(--cg-wait-bg)", fg: "var(--cg-wait)", icon: "◷", suffix: " · à valider" },
  blocked: { bg: "var(--cg-ko-bg)", fg: "var(--cg-ko)", icon: "✕", suffix: " · bloqué" },
};

export default function Header(props: {
  beneficiaire: string;
  txs: TxItem[];
  onRevoke: () => void;
  onOpenTx: (t: TxItem) => void;
}) {
  return (
    <header
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 18px",
        borderBottom: "1px solid var(--cg-border-soft)", background: "var(--cg-bg)", flexWrap: "wrap",
      }}
    >
      <span aria-hidden style={{ fontSize: 20, color: "var(--cg-action)" }}>◈</span>
      <strong style={{ color: "var(--cg-ink)", fontWeight: 500 }}>CareGuard</strong>
      <span style={{ color: "var(--cg-muted)", fontSize: 13 }}>· {props.beneficiaire}</span>
      <div style={{ flex: 1 }} />

      {props.txs.slice(0, 3).map((t) => {
        const s = PILL[t.status];
        return (
          <button
            key={t.id}
            className="cg-appear"
            onClick={() => (t.txHash ? window.open(`${EXPLORER}/tx/${t.txHash}`, "_blank") : props.onOpenTx(t))}
            title={t.txHash ? "Voir la transaction sur l'explorateur" : "Voir la facture"}
            style={{
              border: "none", borderRadius: 999, padding: "4px 10px", fontSize: 12,
              background: s.bg, color: s.fg,
            }}
          >
            {s.icon} {t.label} {eur(t.montantCents)}{s.suffix}
          </button>
        );
      })}

      <button
        onClick={props.onRevoke}
        title="Révoquer immédiatement les agents (signé par votre wallet)"
        style={{
          borderRadius: 8, padding: "4px 10px", fontSize: 12, background: "var(--cg-bg)",
          border: "1px solid #f09595", color: "var(--cg-ko)",
        }}
      >
        ⏻ Couper
      </button>
    </header>
  );
}
