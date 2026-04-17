import { NextResponse } from "next/server";
import { getLlmProvider } from "@/lib/llm";
import { runPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    if (!getLlmProvider()) {
      return NextResponse.json(
        {
          error:
            "Missing LLM API key. Set GEMINI_API_KEY (Google AI), OPENAI_API_KEY, or ANTHROPIC_API_KEY in .env and restart the dev server. For Gemini-only, use LLM_PROVIDER=gemini if you also have other keys set.",
        },
        { status: 400 },
      );
    }

    const body = (await req.json()) as {
      sessionKey?: string;
      filename?: string;
      code?: string;
      githubUrl?: string;
      githubToken?: string;
      runFix?: boolean;
    };

    const sessionKey = body.sessionKey?.trim() || "default-session";
    const filename = body.filename?.trim() || "snippet.tsx";
    const code = body.code ?? "";
    const githubUrl = body.githubUrl?.trim();
    const githubToken = body.githubToken?.trim();

    if (!githubUrl && !code.trim()) {
      return NextResponse.json(
        { error: "Provide `code` or a `githubUrl` (GitHub blob link)." },
        { status: 400 },
      );
    }

    const result = await runPipeline({
      sessionKey,
      filename,
      code: githubUrl ? undefined : code,
      githubUrl,
      githubToken,
      runFix: Boolean(body.runFix),
    });

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Pipeline failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
