// app/layout.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VaultSidecar Backend",
  description: "Auth0 Token Vault powered agent backend for the VaultSidecar Chrome extension",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
