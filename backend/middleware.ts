// middleware.ts
// Handles dynamic CORS for extension origins (moz-extension:// and chrome-extension://)
// Auth routes are handled in app/api/auth/[auth0]/route.ts (Node.js runtime)

import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  const isExtension =
    origin.startsWith("moz-extension://") ||
    origin.startsWith("chrome-extension://");

  // Handle CORS preflight
  if (req.method === "OPTIONS" && isExtension) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const res = NextResponse.next();

  if (isExtension) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
    res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
