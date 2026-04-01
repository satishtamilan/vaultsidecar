// lib/auth0.ts
// Centralises Auth0 SDK setup and Token Vault helpers

import { Auth0AI } from "@auth0/ai-langchain";
import { auth0 } from "./auth0-client";
export { auth0 } from "./auth0-client";

// ─── Helper: resolve Auth0 domain (without scheme) ───────────────────────────
function getAuth0Domain(): string {
  return (
    process.env.AUTH0_DOMAIN ??
    (process.env.AUTH0_ISSUER_BASE_URL ?? "").replace(/^https?:\/\//, "")
  );
}

// ─── Auth0 AI / Token Vault client ───────────────────────────────────────────
export const auth0AI = new Auth0AI({
  auth0: {
    domain: getAuth0Domain(),
    clientId: process.env.AUTH0_CLIENT_ID!,
    clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  },
});

// ─── Supported connections ────────────────────────────────────────────────────
export const CONNECTIONS = {
  github: process.env.AUTH0_GITHUB_CONNECTION ?? "github",
  google: process.env.AUTH0_GOOGLE_CONNECTION ?? "google-oauth2",
} as const;

export type Connection = keyof typeof CONNECTIONS;

// ─── Refresh token resolver ───────────────────────────────────────────────────
// Tries LangGraph configurable context first, falls back to Next.js session
async function resolveRefreshToken(_params: unknown, config?: any): Promise<string | undefined> {
  const rt = config?.configurable?._credentials?.refreshToken;
  if (rt) return rt;
  try {
    const session = await auth0.getSession();
    return (session?.tokenSet as any)?.refreshToken as string | undefined;
  } catch {
    return undefined;
  }
}

// ─── Token Vault wrappers (used to wrap LangChain tools) ─────────────────────
export const withGitHub = auth0AI.withTokenVault({
  connection: CONNECTIONS.github,
  scopes: [],
  refreshToken: resolveRefreshToken,
});

export const withGmailRead = auth0AI.withTokenVault({
  connection: CONNECTIONS.google,
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  refreshToken: resolveRefreshToken,
});

export const withGmailSend = auth0AI.withTokenVault({
  connection: CONNECTIONS.google,
  scopes: ["https://www.googleapis.com/auth/gmail.send"],
  refreshToken: resolveRefreshToken,
});

// ─── Token Vault: direct check (for token bar UI) ────────────────────────────
// Performs the federated token exchange directly — not via LangChain tool context
export async function getTokenForConnection(
  connection: Connection,
  scopes: string[]
): Promise<string | null> {
  try {
    const session = await auth0.getSession();
    const refreshToken = (session?.tokenSet as any)?.refreshToken as string | undefined;
    if (!refreshToken) return null;

    const domain = getAuth0Domain();
    const res = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        client_id: process.env.AUTH0_CLIENT_ID!,
        client_secret: process.env.AUTH0_CLIENT_SECRET!,
        subject_token: refreshToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:refresh_token",
        requested_token_type:
          "urn:auth0:params:oauth:token-type:federated-connection-access-token",
        connection: CONNECTIONS[connection],
        scope: scopes.join(" "),
      }),
    });

    if (!res.ok) return null;
    const { access_token } = await res.json();
    return access_token ?? null;
  } catch (err) {
    console.error(`[Token Vault] Failed to get token for ${connection}:`, err);
    return null;
  }
}

// ─── Fallback: get IDP token from user identity via Management API ──────────
// Used when Token Vault is not available (Connected Accounts not completed)
export async function getIdpTokenForConnection(
  connection: Connection
): Promise<string | null> {
  try {
    const session = await auth0.getSession();
    if (!session?.user?.sub) return null;

    const domain = getAuth0Domain();
    const mgmtRes = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.AUTH0_CLIENT_ID!,
        client_secret: process.env.AUTH0_CLIENT_SECRET!,
        audience: `https://${domain}/api/v2/`,
        grant_type: "client_credentials",
      }),
    });
    if (!mgmtRes.ok) return null;
    const { access_token: mgmtToken } = await mgmtRes.json();

    const userRes = await fetch(
      `https://${domain}/api/v2/users/${encodeURIComponent(session.user.sub)}?fields=identities&include_fields=true`,
      { headers: { Authorization: `Bearer ${mgmtToken}` } }
    );
    if (!userRes.ok) return null;
    const { identities } = await userRes.json();

    const identity = identities?.find(
      (id: any) => id.connection === CONNECTIONS[connection]
    );
    return identity?.access_token ?? null;
  } catch (err) {
    console.error(`[IDP fallback] Failed for ${connection}:`, err);
    return null;
  }
}

// ─── CIBA: initiate async authorization ──────────────────────────────────────
// Calls Auth0's /bc-authorize endpoint directly
export async function initiateCIBA(
  userId: string,
  bindingMessage: string
): Promise<{ requestId: string }> {
  const domain = getAuth0Domain();
  const res = await fetch(`https://${domain}/bc-authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH0_CLIENT_ID!,
      client_secret: process.env.AUTH0_CLIENT_SECRET!,
      login_hint: JSON.stringify({
        format: "iss_sub",
        iss: `https://${domain}/`,
        sub: userId,
      }),
      binding_message: bindingMessage,
      scope: "openid",
    }),
  });

  if (!res.ok) throw new Error(`CIBA initiate failed: ${await res.text()}`);
  const { auth_req_id } = await res.json();
  return { requestId: auth_req_id };
}

// ─── CIBA: poll / confirm approval ───────────────────────────────────────────
export async function confirmCIBA(requestId: string): Promise<boolean> {
  try {
    const domain = getAuth0Domain();
    const res = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH0_CLIENT_ID!,
        client_secret: process.env.AUTH0_CLIENT_SECRET!,
        grant_type: "urn:openid:params:grant-type:ciba",
        auth_req_id: requestId,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
