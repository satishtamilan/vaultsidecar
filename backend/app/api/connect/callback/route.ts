// app/api/connect/callback/route.ts
// Handles the callback after user authorizes the external provider
import { NextRequest, NextResponse } from "next/server";

function getAuth0Domain() {
  return (
    process.env.AUTH0_DOMAIN ??
    (process.env.AUTH0_ISSUER_BASE_URL ?? "").replace(/^https?:\/\//, "")
  );
}

export async function GET(req: NextRequest) {
  const connectCode = req.nextUrl.searchParams.get("connect_code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const errorDescription = req.nextUrl.searchParams.get("error_description");

  if (error) {
    console.error(`[connect/callback] Error from provider: ${error} — ${errorDescription}`);
    return NextResponse.json({ error, error_description: errorDescription }, { status: 400 });
  }

  const connectStateCookie = req.cookies.get("connect_state")?.value;
  if (!connectStateCookie) {
    console.error("[connect/callback] No connect_state cookie found");
    return NextResponse.json({ error: "Missing connect state. Please try again." }, { status: 400 });
  }

  let connectState: any;
  try {
    connectState = JSON.parse(connectStateCookie);
  } catch {
    return NextResponse.json({ error: "Invalid connect state" }, { status: 400 });
  }

  if (stateParam !== connectState.state) {
    console.error("[connect/callback] State mismatch");
    return NextResponse.json({ error: "State mismatch. Please try again." }, { status: 400 });
  }

  if (!connectCode) {
    console.error("[connect/callback] No connect_code in callback");
    return NextResponse.json({ error: "No connect_code received from provider." }, { status: 400 });
  }

  const domain = getAuth0Domain();

  // Complete the Connected Accounts flow
  console.log(`[connect/callback] Completing connect flow for ${connectState.connection}…`);
  const completeRes = await fetch(`https://${domain}/me/v1/connected-accounts/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connectState.meToken}`,
    },
    body: JSON.stringify({
      auth_session: connectState.auth_session,
      connect_code: connectCode,
      redirect_uri: connectState.redirectUri,
    }),
  });

  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({ message: "Unknown error" }));
    console.error("[connect/callback] Failed to complete connect flow:", err);
    return NextResponse.json({ error: "Failed to complete connect flow", details: err }, { status: 400 });
  }

  const result = await completeRes.json();
  console.log(`[connect/callback] Successfully connected ${connectState.connection}!`, result);

  // Clear the cookie and redirect
  const baseUrl = process.env.AUTH0_BASE_URL ?? "http://localhost:3000";
  const response = NextResponse.redirect(`${baseUrl}${connectState.returnTo}`);
  response.cookies.delete("connect_state");
  return response;
}
