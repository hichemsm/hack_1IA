"use client";

import type { ReactNode } from "react";
import type { AppState } from "@/lib/types";
import { eur, tusd } from "./format";

function Card(props: { label: string; children: ReactNode; ask?: string; onAsk: (q: string) => void }) {
  return (
    <button
      onClick={() => props.ask && props.onAsk(props.ask)}
      title={props.ask ? `Demander : « ${props.ask} »` : undefined}
      style={{
        textAlign: "left", background: "var(--cg-bg)", border: "1px solid var(--cg-border)",
        borderRadius: 8, padding: "8px 10px", color: "var(--cg-text)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--cg-muted)" }}>{props.label}</div>
      {props.children}
    </button>
  );
}

function Gauge(props: { used: number; max: number }) {
  const pct = Math.min(100, Math.round((props.used / Math.max(1, props.max)) * 100));
  return (
    <>
      <div style={{ height: 6, background: "#e6f1fb", borderRadius: 3, margin: "6px 0 4px" }}>
        <div style={{ width: `${pct}%`, height: 6, background: "var(--cg-action)", borderRadius: 3, transition: "width 600ms ease-out" }} />
      </div>
      <div style={{ fontSize: 12 }}>{eur(props.used)} sur {eur(props.max)}</div>
    </>
  );
}

export default function RightsPanel(props: { state: AppState | null; onAsk: (q: string) => void }) {
  const s = props.state;
  const strong = { fontWeight: 500, color: "var(--cg-ink)" } as const;

  return (
    <aside
      className="cg-rights"
      style={{ background: "var(--cg-panel)", padding: 16, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}
    >
      <div style={{ fontSize: 12, color: "var(--cg-secu)", fontWeight: 500 }}>Vos droits</div>
      {!s ? (
        <div style={{ fontSize: 13, color: "var(--cg-muted)" }}>Chargement…</div>
      ) : (
        <>
          <Card label="Assurance maladie" ask="Que rembourse la Sécu pour une consultation ?" onAsk={props.onAsk}>
            <div style={strong}>
              {s.profile.medecinTraitant ? "Médecin traitant ✓" : "Sans médecin traitant"}
            </div>
          </Card>
          <Card label="Mutuelle" ask="Que rembourse ma mutuelle ?" onAsk={props.onAsk}>
            <div style={strong}>
              {s.profile.mutuelleBrssPct === 0 ? "Aucune" : `${s.profile.mutuelleBrssPct} % de la base`}
            </div>
          </Card>
          <Card label="Affection longue durée" ask="Qu'est-ce que l'ALD change pour nous ?" onAsk={props.onAsk}>
            <div style={strong}>{s.profile.ald ? "Oui, prise en charge à 100 %" : "Non"}</div>
          </Card>
          <Card label={`Franchises ${new Date().getFullYear()}`} ask="Combien de franchise me reste-t-il ?" onAsk={props.onAsk}>
            <Gauge used={s.counters.franchisesCents} max={s.plafonds.franchisesCents} />
          </Card>
          <Card label="Participations forfaitaires" ask="Où en sont les participations forfaitaires ?" onAsk={props.onAsk}>
            <Gauge used={s.counters.participationsCents} max={s.plafonds.participationsCents} />
          </Card>
          <Card label="Coffre" onAsk={props.onAsk}>
            <div style={strong}>{tusd(s.coffre)}</div>
          </Card>
          <div style={{ fontSize: 11, color: "var(--cg-muted)", marginTop: "auto" }}>
            Estimations indicatives. Elles ne remplacent pas vos décomptes ameli et mutuelle.
          </div>
        </>
      )}
    </aside>
  );
}
