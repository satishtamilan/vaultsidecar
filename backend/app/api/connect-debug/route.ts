import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export async function GET(req: NextRequest) {
  const connection = req.nextUrl.searchParams.get("connection") ?? "github";
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/extension-callback";

  try {
    return await auth0.connectAccount({ connection, returnTo });
  } catch (error: any) {
    return NextResponse.json(
      {
        message: error?.message ?? "connectAccount failed",
        code: error?.code ?? null,
        cause: error?.cause
          ? {
              type: error.cause.type ?? null,
              title: error.cause.title ?? null,
              detail: error.cause.detail ?? null,
              status: error.cause.status ?? null,
              validationErrors: error.cause.validationErrors ?? null,
            }
          : null,
      },
      { status: 500 }
    );
  }
}
