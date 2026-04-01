// app/api/agent/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { runApprovedAction } from "@/lib/agent";

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { cibaRequestId, context } = await req.json();

  if (!cibaRequestId) {
    return NextResponse.json({ error: "cibaRequestId is required" }, { status: 400 });
  }

  const result = await runApprovedAction(
    cibaRequestId,
    context ?? { site: "unknown", url: "", title: "" },
    session.user.sub
  );

  return NextResponse.json(result);
}
