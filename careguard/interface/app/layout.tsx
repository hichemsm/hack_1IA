import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "CareGuard",
  description: "Le portefeuille santé de vos proches, gardé par 4 agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
