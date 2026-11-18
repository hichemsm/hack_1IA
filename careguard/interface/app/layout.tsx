import type { ReactNode } from "react";

export const metadata = {
  title: "CareGuard",
  description: "Le portefeuille santé de vos proches, gardé par 4 agents.",
};

const nav = [
  ["/", "Accueil"],
  ["/factures", "Factures"],
  ["/soignants", "Soignants"],
  ["/journal", "Journal"],
  ["/onboarding", "Réglages"],
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, color: "#1d1d1b", background: "#faf9f6" }}>
        <header style={{ display: "flex", gap: 16, padding: "12px 20px", borderBottom: "1px solid #e5e3dc", flexWrap: "wrap" }}>
          <strong>CareGuard</strong>
          {nav.map(([href, label]) => (
            <a key={href} href={href} style={{ color: "inherit" }}>{label}</a>
          ))}
        </header>
        <main style={{ maxWidth: 760, margin: "0 auto", padding: 20 }}>{children}</main>
        <footer style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px 20px", fontSize: 13, color: "#6b6a65" }}>
          Estimation indicative, ne remplace pas votre décompte ameli ni celui de votre mutuelle. Testnet Aevum uniquement.
        </footer>
      </body>
    </html>
  );
}
