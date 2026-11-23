"use client";

export type StepState = "pending" | "active" | "done" | "wait" | "fail";

const LABELS = ["Lecture", "Montants", "Sécurité", "Paiement"];

const STYLE: Record<StepState, { color: string; icon: string }> = {
  pending: { color: "var(--cg-placeholder)", icon: "○" },
  active: { color: "var(--cg-action)", icon: "◌" },
  done: { color: "var(--cg-action)", icon: "●" },
  wait: { color: "var(--cg-wait)", icon: "◷" },
  fail: { color: "var(--cg-ko)", icon: "✕" },
};

/** Les 4 agents qui s'allument l'un après l'autre */
export default function ProgressSteps({ states }: { states: StepState[] }) {
  return (
    <div className="cg-appear" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
      {LABELS.map((label, i) => {
        const s = STYLE[states[i] ?? "pending"];
        return (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className={states[i] === "active" ? "cg-pulse" : undefined} style={{ color: s.color }}>
              {s.icon} {label}
            </span>
            {i < LABELS.length - 1 && <span style={{ color: "var(--cg-placeholder)" }}>·</span>}
          </span>
        );
      })}
    </div>
  );
}
