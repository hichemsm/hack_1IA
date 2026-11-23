"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";
import type { InvoiceInput } from "@careguard/core";
import type { AppState, InvoiceResponse, TxItem } from "@/lib/types";
import { approvePending, revokeAgents } from "@/lib/guardian";
import Header from "./Header";
import RightsPanel from "./RightsPanel";
import ProgressSteps, { type StepState } from "./ProgressSteps";
import InvoiceCard from "./InvoiceCard";
import Composer from "./Composer";

type Msg =
  | { id: string; kind: "user-text"; text: string }
  | { id: string; kind: "user-file"; name: string }
  | { id: string; kind: "agent-text"; text: string; tone?: "error" }
  | { id: string; kind: "progress"; states: StepState[] }
  | { id: string; kind: "invoice"; result: InvoiceResponse; input: InvoiceInput };

const WELCOME: Msg = {
  id: "welcome",
  kind: "agent-text",
  text: "Bonjour. Déposez une facture de soins : je vous montre ce que la Sécu et la mutuelle remboursent, puis je la paie en toute sécurité. Vous pouvez aussi me poser une question sur vos droits.",
};

const uid = () => Math.random().toString(36).slice(2);

/** Où s'arrêtent les 4 étapes, d'après le résultat réel */
function finalSteps(r: InvoiceResponse): StepState[] {
  if (r.tx.status === "paid" || r.tx.status === "queued") return ["done", "done", "done", "done"];
  if (r.tx.status === "reverted") return ["done", "done", "done", "fail"];
  if (r.risk.decision === "escalate") return ["done", "done", "wait", "pending"];
  return ["done", "done", "fail", "pending"];
}

export default function Dashboard() {
  const [state, setState] = useState<AppState | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([WELCOME]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const push = (m: Msg) => setMsgs((xs) => [...xs, m]);
  const patch = (id: string, m: Partial<Msg>) =>
    setMsgs((xs) => xs.map((x) => (x.id === id ? ({ ...x, ...m } as Msg) : x)));

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) setState(await r.json());
    } catch {
      /* hors ligne : on garde le dernier état */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);

  async function ask(question: string) {
    push({ id: uid(), kind: "user-text", text: question });
    setBusy(true);
    try {
      const r = await fetch("/api/ask", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }),
      });
      const body = await r.json();
      push({ id: uid(), kind: "agent-text", text: body.answer ?? body.error, tone: r.ok ? undefined : "error" });
    } catch {
      push({ id: uid(), kind: "agent-text", text: "Impossible de joindre le serveur. Réessayez.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function processInvoice(input: InvoiceInput, guardianConfirmed = false) {
    const pid = uid();
    push({ id: pid, kind: "progress", states: ["active", "pending", "pending", "pending"] });
    setBusy(true);

    // Les étapes s'allument pendant que les agents travaillent
    let step = 0;
    const timer = setInterval(() => {
      step = Math.min(step + 1, 3);
      patch(pid, { states: [0, 1, 2, 3].map((i) => (i < step ? "done" : i === step ? "active" : "pending")) as StepState[] });
    }, 700);

    try {
      const r = await fetch("/api/invoice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, guardianConfirmed }),
      });
      const body = await r.json();
      clearInterval(timer);
      if (!r.ok) {
        patch(pid, { states: ["fail", "pending", "pending", "pending"] });
        push({ id: uid(), kind: "agent-text", text: body.error, tone: "error" });
        return;
      }
      const result = body as InvoiceResponse;
      patch(pid, { states: finalSteps(result) });
      push({ id: uid(), kind: "invoice", result, input });
      refresh();
    } catch {
      clearInterval(timer);
      patch(pid, { states: ["fail", "pending", "pending", "pending"] });
      push({ id: uid(), kind: "agent-text", text: "Impossible de joindre le serveur. Réessayez.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    push({ id: uid(), kind: "user-file", name: file.name });
    try {
      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        const base64 = await new Promise<string>((ok, ko) => {
          const fr = new FileReader();
          fr.onload = () => ok(String(fr.result).split(",")[1] ?? "");
          fr.onerror = () => ko(fr.error);
          fr.readAsDataURL(file);
        });
        await processInvoice({ kind: "pdf", base64 });
      } else {
        await processInvoice({ kind: "json", data: JSON.parse(await file.text()) });
      }
    } catch {
      push({ id: uid(), kind: "agent-text", text: "Ce fichier n'est pas lisible. Déposez une facture en PDF ou en JSON.", tone: "error" });
    }
  }

  async function onRevoke() {
    if (!state) return;
    if (!window.confirm("Couper les agents ? Plus aucun paiement automatique ne sera possible jusqu'à ce que vous les réactiviez.")) return;
    try {
      const hash = await revokeAgents(state.vault as Address);
      push({ id: uid(), kind: "agent-text", text: `Agents coupés. Transaction ${hash.slice(0, 10)}…` });
    } catch (e) {
      push({ id: uid(), kind: "agent-text", text: e instanceof Error ? e.message : String(e), tone: "error" });
    }
  }

  async function onApproveOnChain(pendingId: string) {
    if (!state) return;
    try {
      const hash = await approvePending(state.vault as Address, BigInt(pendingId));
      push({ id: uid(), kind: "agent-text", text: `Paiement validé dans le coffre. Transaction ${hash.slice(0, 10)}…` });
      refresh();
    } catch (e) {
      push({ id: uid(), kind: "agent-text", text: e instanceof Error ? e.message : String(e), tone: "error" });
    }
  }

  function onOpenTx(t: TxItem) {
    const el = document.getElementById(`tx-${t.id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="cg-shell">
      <Header beneficiaire={state?.beneficiaire ?? "…"} txs={state?.txs ?? []} onRevoke={onRevoke} onOpenTx={onOpenTx} />
      <div className="cg-body">
        <RightsPanel state={state} onAsk={ask} />

        <main
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          style={{
            display: "flex", flexDirection: "column", minHeight: 0, padding: "16px 24px",
            background: dragging ? "#f5f9fe" : "var(--cg-bg)",
            outline: dragging ? "2px dashed var(--cg-mutuelle)" : "none", outlineOffset: -8,
          }}
        >
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingBottom: 12 }}>
            {msgs.map((m) => {
              switch (m.kind) {
                case "user-text":
                  return <Bubble key={m.id} mine>{m.text}</Bubble>;
                case "user-file":
                  return <Bubble key={m.id} mine>📄 {m.name}</Bubble>;
                case "agent-text":
                  return (
                    <div key={m.id} className="cg-appear" style={{ fontFamily: "var(--cg-voice)", maxWidth: 560, color: m.tone === "error" ? "var(--cg-ko)" : "var(--cg-text)" }}>
                      {m.text}
                    </div>
                  );
                case "progress":
                  return <ProgressSteps key={m.id} states={m.states} />;
                case "invoice":
                  return (
                    <div key={m.id} id={`tx-${m.result.txItem.id}`}>
                      <InvoiceCard
                        result={m.result}
                        onConfirm={() => processInvoice(m.input, true)}
                        onApproveOnChain={onApproveOnChain}
                        onDismiss={() => push({ id: uid(), kind: "agent-text", text: "Entendu, cette facture ne sera pas payée." })}
                      />
                    </div>
                  );
              }
            })}
            {busy && <div className="cg-pulse" style={{ fontSize: 12, color: "var(--cg-muted)" }}>Les agents travaillent…</div>}
            <div ref={bottom} />
          </div>
          <Composer busy={busy} onSend={ask} onFile={onFile} />
        </main>
      </div>
    </div>
  );
}

function Bubble({ children, mine }: { children: ReactNode; mine?: boolean }) {
  return (
    <div
      className="cg-appear"
      style={{
        alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "75%", padding: "8px 12px", borderRadius: 12,
        background: mine ? "var(--cg-panel)" : "var(--cg-bg)", color: "var(--cg-ink)",
      }}
    >
      {children}
    </div>
  );
}
