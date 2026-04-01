// app/api/tokens/route.ts
// Returns a lightweight summary of active Token Vault connections for the extension's token bar

import { NextResponse } from "next/server";
import { auth0, CONNECTIONS, getIdpTokenForConnection } from "@/lib/auth0";
import type { Connection } from "@/lib/auth0";

export async function GET() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const checks: Array<{ key: Connection; connection: string }> = [
    { key: "github", connection: CONNECTIONS.github },
    { key: "google", connection: CONNECTIONS.google },
  ];

  const results = await Promise.all(
    checks.map(async ({ key, connection }) => {
      try {
        const { token } = await auth0.getAccessTokenForConnection({ connection });
        return { connection: key, active: !!token, expired: !token };
      } catch {
        // Fallback: check if user has an IDP identity token
        try {
          const idpToken = await getIdpTokenForConnection(key);
          if (idpToken) return { connection: key, active: true, expired: false };
        } catch {}
        return { connection: key, active: false, expired: false };
      }
    })
  );

  return NextResponse.json(results.filter((r) => r.active));
}
