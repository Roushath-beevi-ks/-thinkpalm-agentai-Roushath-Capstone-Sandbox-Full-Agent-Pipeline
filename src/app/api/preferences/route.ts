import { NextResponse } from "next/server";
import { getOrCreatePreferences, updatePreferences } from "@/lib/memory";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionKey = searchParams.get("sessionKey")?.trim() || "default-session";
  const prefs = await getOrCreatePreferences(sessionKey);
  return NextResponse.json(prefs);
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as {
      sessionKey?: string;
      strictLint?: boolean;
      preferA11y?: boolean;
      maxFixFiles?: number;
      notes?: string | null;
    };
    const sessionKey = body.sessionKey?.trim() || "default-session";
    const prefs = await updatePreferences(sessionKey, {
      ...(body.strictLint !== undefined ? { strictLint: body.strictLint } : {}),
      ...(body.preferA11y !== undefined ? { preferA11y: body.preferA11y } : {}),
      ...(body.maxFixFiles !== undefined ? { maxFixFiles: body.maxFixFiles } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });
    return NextResponse.json(prefs);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
