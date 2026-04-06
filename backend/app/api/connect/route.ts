// app/api/connect/route.ts
// Manual Connected Accounts flow — bypasses SDK middleware for reliability
import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0-client";
import crypto from "crypto";

function getAuth0Domain() {
  return (
    process.env.AUTH0_DOMAIN ??
    (process.env.AUTH0_ISSUER_BASE_URL ?? "").replace(/^https?:\/\//, "")
  );
}

export async function GET(req: NextRequest) {
  const connection = req.nextUrl.searchParams.get("connection") ?? "github";
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/extension-callback";

  // 1. Verify the user is logged in
  const session = await auth0.getSession();
  if (!session) {
    console.error("[connect] No session found — user not logged in");
    return NextResponse.json({ error: "Not authenticated. Please log in first." }, { status: 401 });
  }

  const refreshToken = (session.tokenSet as any)?.refreshToken as string | undefined;
  if (!refreshToken) {
    console.error("[connect] No refresh token in session");
    return NextResponse.json({ error: "No refresh token. Re-login with offline_access scope." }, { status: 400 });
  }

  const domain = getAuth0Domain();
  const clientId = process.env.AUTH0_CLIENT_ID!;
  const clientSecret = process.env.AUTH0_CLIENT_SECRET!;
  const baseUrl = process.env.AUTH0_BASE_URL ?? "http://localhost:3000";

  // 2. Exchange refresh token for My Account API access token (MRRT)
  console.log("[connect] Exchanging refresh token for My Account API access token…");
  const tokenRes = await fetch(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      audience: `https://${domain}/me/`,
      scope: "openid profile offline_access create:me:connected_accounts read:me:connected_accounts delete:me:connected_accounts",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json();
    console.error("[connect] Failed to get My Account API token:", err);
    return NextResponse.json({ error: "Failed to get My Account API token", details: err }, { status: 400 });
  }

  const { access_token: meToken } = await tokenRes.json();
  console.log("[connect] Got My Account API token");

  // 3. Initiate Connected Accounts flow
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${baseUrl}/api/connect/callback`;

  console.log(`[connect] Initiating connect flow for ${connection}…`);
  const connectRes = await fetch(`https://${domain}/me/v1/connected-accounts/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${meToken}`,
    },
    body: JSON.stringify({
      connection,
      redirect_uri: redirectUri,
      state,
      scopes: connection === "github"
        ? ["repo", "read:user", "user:email"]
        : connection === "slack"
        ? ["channels:read", "chat:write", "users:read", "im:history", "channels:history"]
        : ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
    }),
  });

  if (!connectRes.ok) {
    const err = await connectRes.json();
    console.error("[connect] Failed to initiate connect flow:", err);
    return NextResponse.json({ error: "Failed to initiate connect flow", details: err }, { status: 400 });
  }

  const connectData = await connectRes.json();
  console.log("[connect] Got connect_uri, redirecting user…");

  // 4. Store state + auth_session in a cookie for the callback
  const connectState = JSON.stringify({
    auth_session: connectData.auth_session,
    state,
    connection,
    returnTo,
    meToken,
    redirectUri,
  });

  const response = NextResponse.redirect(
    `${connectData.connect_uri}?ticket=${connectData.connect_params.ticket}`
  );

  response.cookies.set("connect_state", connectState, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });

  return response;
}
