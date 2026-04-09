// app/api/tokens/detail/route.ts
// Returns detailed token info including scopes, for the token manager panel

import { NextResponse } from "next/server";
import { auth0, CONNECTIONS, getIdpTokenForConnection } from "@/lib/auth0";
import type { Connection } from "@/lib/auth0";

const CHECKS: Array<{ key: Connection; connection: string }> = [
  { key: "github", connection: CONNECTIONS.github },
  { key: "slack", connection: CONNECTIONS.slack },
];

const VERIFY_URLS: Record<string, string> = {
  github: "https://api.github.com/user",
  slack: "https://slack.com/api/auth.test",
};

async function verifyToken(connection: string, token: string): Promise<boolean> {
  const url = VERIFY_URLS[connection];
  if (!url) return true;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (connection === "slack") {
      const data = await r.json();
      return data.ok === true;
    }
    return r.ok;
  } catch {
    return false;
  }
}

const SCOPE_MAP: Record<string, string[]> = {
  github: ["repo", "read:user", "user:email"],
  slack: ["channels:read", "chat:write", "users:read", "channels:history"],
};

export async function GET() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const hasRefreshToken = !!(session.tokenSet as any)?.refreshToken;

  const results = await Promise.all(
    CHECKS.map(async ({ key, connection }) => {
      // Try Token Vault first
      try {
        const { token, expiresAt } = await auth0.getAccessTokenForConnection({ connection });

        return {
          connection: key,
          connectionId: connection,
          connected: !!token,
          active: !!token,
          expired: false,
          scopes: token ? (SCOPE_MAP[key] ?? []) : [],
          expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
          reason: null,
        };
      } catch (err: any) {
        console.error(`[tokens/detail] Token Vault failed for ${key}:`, err?.message);
      }

      // Fallback: try IDP identity token and verify it's still valid
      try {
        const idpToken = await getIdpTokenForConnection(key);
        if (idpToken) {
          const valid = await verifyToken(key, idpToken);
          return {
            connection: key,
            connectionId: connection,
            connected: true,
            active: valid,
            expired: !valid,
            scopes: SCOPE_MAP[key] ?? [],
            expiresAt: null,
            reason: valid
              ? "Using login identity token (Connected Accounts not set up)"
              : "Token expired — please log out and log in again with this provider",
          };
        }
      } catch (fallbackErr: any) {
        console.error(`[tokens/detail] IDP fallback failed for ${key}:`, fallbackErr?.message);
      }

      const reason = !hasRefreshToken
        ? "No refresh token — re-login with offline_access scope"
        : "Token exchange failed — click Connect to set up Token Vault";

      return {
        connection: key,
        connectionId: connection,
        connected: false,
        active: false,
        expired: false,
        scopes: [],
        expiresAt: null,
        reason,
      };
    })
  );

  return NextResponse.json(results);
}
