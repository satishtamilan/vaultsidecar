// app/api/auth/[auth0]/route.ts
// All auth routes (/api/auth/login, /api/auth/callback, /api/auth/logout)
// are handled here via auth0.middleware running in Node.js runtime

import { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0-client";

export async function GET(req: NextRequest) {
  return auth0.middleware(req);
}

export async function POST(req: NextRequest) {
  return auth0.middleware(req);
}
