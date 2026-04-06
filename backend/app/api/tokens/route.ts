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
    { key: "slack", connection: CONNECTIONS.slack },
  ];

  const results = await Promise.all(
    checks.map(async ({ key, connection }) => {
      try {
        const { token } = await auth0.getAccessTokenForConnection({ connection });
        return { connection: key, connectionId: connection, active: !!token, expired: !token };
      } catch {
        try {
          const idpToken = await getIdpTokenForConnection(key);
          if (idpToken) return { connection: key, connectionId: connection, active: true, expired: false };
        } catch {}
        return { connection: key, connectionId: connection, active: false, expired: false };
      }
    })
  );

  return NextResponse.json(results.filter((r) => r.active));
}
