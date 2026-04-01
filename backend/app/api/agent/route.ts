// app/api/agent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { runAgent } from "@/lib/agent";

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { message, context } = await req.json();

  if (!message || !context) {
    return NextResponse.json({ error: "message and context are required" }, { status: 400 });
  }

  console.log(`[agent] message="${message}" site=${context?.site}`);
  const result = await runAgent(message, context, session.user.sub);
  console.log(`[agent] result:`, JSON.stringify(result).slice(0, 500));
  return NextResponse.json(result);
}
