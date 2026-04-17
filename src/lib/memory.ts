import OpenAI from "openai";
import { prisma } from "./prisma";

function parseEmbedding(s: string | null | undefined): number[] | null {
  if (!s) return null;
  try {
    const arr = JSON.parse(s) as unknown;
    if (!Array.isArray(arr)) return null;
    return arr.map((n) => Number(n));
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  try {
    const client = new OpenAI({ apiKey: key });
    const res = await client.embeddings.create({
      model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
      input: text.slice(0, 8000),
    });
    return res.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

export async function getOrCreatePreferences(sessionKey: string) {
  return prisma.userPreference.upsert({
    where: { sessionKey },
    create: { sessionKey },
    update: {},
  });
}

export async function updatePreferences(
  sessionKey: string,
  data: Partial<{
    strictLint: boolean;
    preferA11y: boolean;
    maxFixFiles: number;
    notes: string | null;
  }>,
) {
  return prisma.userPreference.upsert({
    where: { sessionKey },
    create: { sessionKey, ...data },
    update: data,
  });
}

export async function storeReviewMemory(sessionKey: string, title: string, summary: string) {
  const embedding = await embedText(`${title}\n${summary}`);
  await prisma.reviewMemory.create({
    data: {
      sessionKey,
      title,
      summary,
      embedding: embedding ? JSON.stringify(embedding) : null,
    },
  });
}

export async function retrieveRelevantMemories(sessionKey: string, query: string, topK = 4) {
  const rows = await prisma.reviewMemory.findMany({
    where: { sessionKey },
    orderBy: { createdAt: "desc" },
    take: 48,
  });

  const qEmb = await embedText(query);
  if (qEmb) {
    return rows
      .map((r) => {
        const e = parseEmbedding(r.embedding);
        const score = e ? cosineSimilarity(qEmb, e) : 0;
        return { id: r.id, title: r.title, summary: r.summary, createdAt: r.createdAt, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  return rows.slice(0, topK).map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    createdAt: r.createdAt,
    score: 0,
  }));
}

export async function savePipelineRun(sessionKey: string, traceJson: string) {
  await prisma.pipelineRun.create({
    data: { sessionKey, traceJson },
  });
}
