// app/api/debug/route.ts — TEMPORARY: diagnose token vault issues
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { CONNECTIONS, getIdpTokenForConnection } from "@/lib/auth0";

function getAuth0Domain() {
  return (
    process.env.AUTH0_DOMAIN ??
    (process.env.AUTH0_ISSUER_BASE_URL ?? "").replace(/^https?:\/\//, "")
  );
}

async function tryTokenExchange(
  domain: string,
  refreshToken: string,
  connection: string,
  scope: string
) {
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
      connection,
      scope,
    }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

export async function GET() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "no session" }, { status: 401 });

  const refreshToken = (session.tokenSet as any)?.refreshToken as string | undefined;
  const tokenSetKeys = Object.keys(session.tokenSet ?? {});
  const connectionTokenSets = (session as any).connectionTokenSets ?? [];

  let githubExchangeResult: any = null;
  let googleExchangeResult: any = null;

  let sdkGithubResult: any = null;
  let sdkGoogleResult: any = null;

  if (refreshToken) {
    const domain = getAuth0Domain();
    [githubExchangeResult, googleExchangeResult] = await Promise.all([
      tryTokenExchange(domain, refreshToken, CONNECTIONS.github, "repo"),
      tryTokenExchange(domain, refreshToken, CONNECTIONS.google, "https://www.googleapis.com/auth/gmail.readonly"),
    ]);
  }

  try {
    const result = await auth0.getAccessTokenForConnection({ connection: CONNECTIONS.github });
    sdkGithubResult = { success: true, hasToken: !!result.token, expiresAt: result.expiresAt };
  } catch (err: any) {
    sdkGithubResult = { success: false, code: err?.code, message: err?.message };
  }

  try {
    const result = await auth0.getAccessTokenForConnection({ connection: CONNECTIONS.google });
    sdkGoogleResult = { success: true, hasToken: !!result.token, expiresAt: result.expiresAt };
  } catch (err: any) {
    sdkGoogleResult = { success: false, code: err?.code, message: err?.message };
  }

  // Test IDP token against GitHub API
  let idpGithubTest: any = null;
  try {
    const idpToken = await getIdpTokenForConnection("github");
    if (idpToken) {
      const ghRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${idpToken}`,
          Accept: "application/vnd.github+json",
        },
      });
      const scopes = ghRes.headers.get("x-oauth-scopes");
      const body = await ghRes.json();
      idpGithubTest = {
        hasToken: true,
        tokenPrefix: idpToken.slice(0, 8) + "…",
        status: ghRes.status,
        scopes,
        login: body.login ?? null,
        error: body.message ?? null,
      };
    } else {
      idpGithubTest = { hasToken: false };
    }
  } catch (err: any) {
    idpGithubTest = { error: err.message };
  }

  return NextResponse.json({
    user: { sub: session.user.sub, email: session.user.email },
    tokenSetKeys,
    hasRefreshToken: !!refreshToken,
    connectionTokenSets: connectionTokenSets.map((c: any) => ({
      connection: c.connection,
      hasAccessToken: !!c.accessToken,
      expiresAt: c.expiresAt,
      scope: c.scope,
    })),
    connections: CONNECTIONS,
    sdkGithubResult,
    sdkGoogleResult,
    githubExchangeResult,
    googleExchangeResult,
    idpGithubTest,
  });
}
