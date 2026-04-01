// app/api/me/route.ts
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export async function GET() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json(null, { status: 401 });

  return NextResponse.json({
    sub: session.user.sub,
    name: session.user.name,
    email: session.user.email,
    picture: session.user.picture,
  });
}
