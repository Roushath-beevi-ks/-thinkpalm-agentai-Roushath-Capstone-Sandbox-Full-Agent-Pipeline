import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import OpenAI from "openai";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Parses "Please retry in 24.4s" from Gemini quota errors. */
function parseRetryAfterMs(message: string): number | null {
  const m = message.match(/retry in ([\d.]+)s/i);
  if (!m) return null;
  return Math.ceil(parseFloat(m[1]) * 1000) + 500;
}

async function geminiGenerateWithRetry(
  model: GenerativeModel,
  request: Parameters<GenerativeModel["generateContent"]>[0],
  maxAttempts = 5,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await model.generateContent(request);
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const isQuota =
        msg.includes("429") ||
        msg.includes("Too Many Requests") ||
        msg.includes("RESOURCE_EXHAUSTED") ||
        msg.includes("quota");
      if (!isQuota || attempt === maxAttempts - 1) throw e;
      const waitMs = parseRetryAfterMs(msg) ?? Math.min(60_000, 2500 * 2 ** attempt);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmProvider = "anthropic" | "openai" | "gemini";

function geminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
}

/**
 * Which LLM backend to use. Set LLM_PROVIDER=gemini|openai|anthropic to force one
 * (must have the matching key). Otherwise: Anthropic → OpenAI → Gemini.
 */
export function getLlmProvider(): LlmProvider | null {
  const forced = process.env.LLM_PROVIDER?.trim().toLowerCase();

  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (forced === "openai" && process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (forced === "gemini" && geminiApiKey()) return "gemini";

  if (forced === "anthropic" || forced === "openai" || forced === "gemini") {
    return null;
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (geminiApiKey()) return "gemini";
  return null;
}

/** JSON-only agent outputs (Planner / Reviewer / Fixer) — OpenAI + Gemini support native JSON mode. */
export function supportsAgentJsonMode(): boolean {
  const p = getLlmProvider();
  return p === "openai" || p === "gemini";
}

export async function completeChat(
  messages: LLMMessage[],
  options?: { jsonMode?: boolean },
): Promise<string> {
  const provider = getLlmProvider();
  if (!provider) {
    throw new Error(
      "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY (or GOOGLE_API_KEY) in .env",
    );
  }

  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const rest = messages.filter((m) => m.role !== "system");
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 8192,
      system: system || "You are a helpful assistant.",
      messages: rest.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });
    const block = msg.content.find((b) => b.type === "text");
    if (block && block.type === "text") return block.text;
    return "";
  }

  if (provider === "gemini") {
    const apiKey = geminiApiKey();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is not set");
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const rest = messages.filter((m) => m.role !== "system");
    const userPayload = rest.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n---\n\n");

    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      systemInstruction: system || undefined,
    });

    const result = await geminiGenerateWithRetry(model, {
      contents: [{ role: "user", parts: [{ text: userPayload }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        ...(options?.jsonMode ? { responseMimeType: "application/json" as const } : {}),
      },
    });
    return result.response.text();
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    response_format: options?.jsonMode ? { type: "json_object" } : undefined,
  });
  return res.choices[0]?.message?.content ?? "";
}
