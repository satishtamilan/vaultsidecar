// lib/auth0-client.ts
// Minimal Auth0Client for use in middleware (no @auth0/ai-langchain imports)

import { Auth0Client } from "@auth0/nextjs-auth0/server";

function getAuth0Domain(): string {
  return (
    process.env.AUTH0_DOMAIN ??
    (process.env.AUTH0_ISSUER_BASE_URL ?? "").replace(/^https?:\/\//, "")
  );
}

export const auth0 = new Auth0Client({
  domain: getAuth0Domain(),
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  secret: process.env.AUTH0_SECRET!,
  appBaseUrl: process.env.AUTH0_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000",
  authorizationParameters: {
    scope: "openid profile email offline_access",
    audience: process.env.AUTH0_AUDIENCE,
  },
  enableConnectAccountEndpoint: true,
  session: {
    cookie: {
      sameSite: "none",
      secure: true,
    },
  },
  routes: {
    login: "/api/auth/login",
    logout: "/api/auth/logout",
    callback: "/api/auth/callback",
    connectAccount: "/api/auth/connect",
  },
} as any);
