"use client";

import { useState } from "react";
import type { BeneficiaryProfile, DemoMode, ProcessResult } from "@careguard/core";

const EXEMPLE = {
  invoiceNo: "K-2026-0412",
  providerId: "kine-dupont",
  date: new Date().toISOString().slice(0, 10),
  acte: "KINE_SEANCE",
  montantCents: 1613,
  quantite: 1,
  beneficiaire: "papa",
};

const eur = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer-test.qday.info";

const AGENTS: Record<string, string> = {
  orchestrateur: "Orchestrateur",
  montants: "Agent montants",
  securite: "Agent sécurité",
  transaction: "Agent transaction",
  aidante: "Vous",
};

export default function Factures() {
  const [json, setJson] = useState(JSON.stringify(EXEMPLE, null, 2));
  const [pdf, setPdf] = useState<string | null>(null);
  const [profile, setProfile] = useState<BeneficiaryProfile>({
    ald: false, medecinTraitant: true, mutuelleBrssPct: 100, exonereRetenues: false,
  });
  const [demo, setDemo] = useState<DemoMode | "">("");
  const [res, setRes] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setPdf(String(reader.result).split(",")[1] ?? null);
    reader.readAsDataURL(file);
  }

  async function submit(guardianConfirmed = false) {
    setBusy(true);
    setError(null);
    try {
      const input = pdf ? { kind: "pdf", base64: pdf } : { kind: "json", data: JSON.parse(json) };
      const r = await fetch("/api/invoice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, profile, guardianConfirmed, demo: demo || undefined }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setRes(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Déposer une facture</h1>

      <section style={card}>
        <label style={{ display: "block", marginBottom: 8 }}>
          Facture PDF <input type="file" accept="application/pdf" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          {pdf && <button style={{ marginLeft: 8 }} onClick={() => setPdf(null)}>Retirer le PDF</button>}
        </label>
        {!pdf && (
          <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={9} style={{ width: "100%", fontFamily: "monospace" }} />
        )}

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "12px 0" }}>
          <label><input type="checkbox" checked={profile.ald} onChange={(e) => setProfile({ ...profile, ald: e.target.checked })} /> ALD</label>
          <label><input type="checkbox" checked={profile.medecinTraitant} onChange={(e) => setProfile({ ...profile, medecinTraitant: e.target.checked })} /> Médecin traitant déclaré</label>
          <label>
            Mutuelle{" "}
            <select value={profile.mutuelleBrssPct} onChange={(e) => setProfile({ ...profile, mutuelleBrssPct: Number(e.target.value) as BeneficiaryProfile["mutuelleBrssPct"] })}>
              <option value={0}>Aucune</option>
              <option value={100}>100 % BRSS</option>
              <option value={150}>150 % BRSS</option>
              <option value={200}>200 % BRSS</option>
            </select>
          </label>
          <label>
            Démo{" "}
            <select value={demo} onChange={(e) => setDemo(e.target.value as DemoMode | "")}>
              <option value="">Normal</option>
              <option value="orchestrateur">Orchestrateur compromis</option>
              <option value="orchestrateur+securite">Orchestrateur + sécurité compromis</option>
            </select>
          </label>
        </div>

        <button disabled={busy} onClick={() => submit()}>{busy ? "Les agents travaillent…" : "Analyser et payer"}</button>
        {error && <p style={{ color: "#a32d2d" }}>{error}</p>}
      </section>

      {res && (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, margin: "16px 0" }}>
            <Part label="Part Sécu" value={eur(res.breakdown.secuCents)} />
            <Part label="Part mutuelle" value={eur(res.breakdown.mutuelleCents)} />
            <Part label="Reste à charge" value={eur(res.breakdown.resteAChargeCents)} strong />
          </section>

          <section style={card}>
            <p style={{ marginTop: 0 }}><strong>{res.explanation}</strong></p>
            <p>Score de risque : {res.risk.score} · décision : {res.risk.decision}</p>
            <ul>{res.risk.reasons.map((r) => <li key={r.code}>{r.message} ({String(r.points)})</li>)}</ul>
            {"txHash" in res.tx && (
              <p><a href={`${EXPLORER}/tx/${res.tx.txHash}`} target="_blank" rel="noreferrer">Voir la transaction sur l'explorateur</a></p>
            )}
            {res.risk.decision === "escalate" && res.tx.status === "not_sent" && (
              <button disabled={busy} onClick={() => submit(true)}>Je valide ce paiement</button>
            )}
          </section>

          <section style={card}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>Qui a dit quoi</h2>
            <ol style={{ paddingLeft: 18 }}>
              {res.trace.map((m, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  <strong>{AGENTS[m.from]}</strong> → {AGENTS[m.to]} : {m.summary}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </>
  );
}

function Part({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ ...card, margin: 0, textAlign: "center", background: strong ? "#eeedfe" : "#fff" }}>
      <div style={{ fontSize: 13, color: "#6b6a65" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

const card = { background: "#fff", border: "1px solid #e5e3dc", borderRadius: 12, padding: 16, margin: "16px 0" } as const;
