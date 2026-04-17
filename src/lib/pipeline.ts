import { createPatch } from "diff";
import { z } from "zod";
import { completeChat, getLlmProvider, supportsAgentJsonMode, type LLMMessage } from "./llm";
import {
  getOrCreatePreferences,
  retrieveRelevantMemories,
  savePipelineRun,
  storeReviewMemory,
} from "./memory";
import { githubFetchRaw, parseGithubBlobUrl, toRawGithubUrl } from "./tools/github";
import { fetchNpmPackageMetadata } from "./tools/npm-registry";
import { analyzeTypeScriptLike, extractNpmSpecifiers } from "./tools/static-analysis";

export type ReActStep = {
  agent: "orchestrator" | "planner" | "reviewer" | "fixer" | "explainer";
  phase: "thought" | "action" | "observation" | "handoff" | "final";
  title: string;
  detail: string;
  payload?: Record<string, unknown>;
  at: string;
};

const PlanSchema = z.object({
  goals: z.array(z.string()),
  focusAreas: z.array(z.string()),
  riskNotes: z.array(z.string()).optional(),
});

const FindingsSchema = z.object({
  findings: z.array(
    z.object({
      severity: z.enum(["critical", "major", "minor", "nit"]),
      title: z.string(),
      detail: z.string(),
      suggestion: z.string().optional(),
    }),
  ),
});

const FixSchema = z.object({
  fixedCode: z.string(),
  changeLog: z.array(z.string()),
});

function traceStep(
  agent: ReActStep["agent"],
  phase: ReActStep["phase"],
  title: string,
  detail: string,
  payload?: Record<string, unknown>,
): ReActStep {
  return { agent, phase, title, detail, payload, at: new Date().toISOString() };
}

function extractLikelyJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function safeJsonParse<T>(raw: string, schema: z.ZodType<T>): T | null {
  const candidates = [raw, extractLikelyJsonObject(raw)];
  for (const c of candidates) {
    try {
      const j = JSON.parse(c) as unknown;
      const p = schema.safeParse(j);
      if (p.success) return p.data;
    } catch {
      /* try next */
    }
  }
  return null;
}

export type PipelineInput = {
  sessionKey: string;
  filename: string;
  code?: string;
  githubUrl?: string;
  githubToken?: string;
  runFix: boolean;
};

export type PipelineResult = {
  trace: ReActStep[];
  originalCode: string;
  fixedCode: string | null;
  unifiedDiff: string | null;
  explainer: string;
  plannerPlan: z.infer<typeof PlanSchema> | null;
  findings: z.infer<typeof FindingsSchema> | null;
};

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const trace: ReActStep[] = [];

  if (!getLlmProvider()) {
    throw new Error("Configure ANTHROPIC_API_KEY or OPENAI_API_KEY");
  }

  const prefs = await getOrCreatePreferences(input.sessionKey);

  let workingCode = (input.code ?? "").trim();
  let workingFilename = input.filename || "snippet.tsx";

  trace.push(
    traceStep(
      "orchestrator",
      "thought",
      "Session context",
      `Preferences: strictLint=${prefs.strictLint}, preferA11y=${prefs.preferA11y}, maxFixFiles=${prefs.maxFixFiles}.`,
      { sessionKey: input.sessionKey },
    ),
  );

  const memoryQuery = `${workingFilename}\n${workingCode.slice(0, 2000)}`;
  const memories = await retrieveRelevantMemories(input.sessionKey, memoryQuery, 4);
  trace.push(
    traceStep(
      "orchestrator",
      "observation",
      "Memory retrieval",
      memories.length
        ? `Loaded ${memories.length} prior memory entr(y/ies) for this session.`
        : "No prior vector memory for this session (yet).",
      { memories: memories.map((m) => ({ title: m.title, score: m.score })) },
    ),
  );

  if (input.githubUrl?.trim()) {
    trace.push(
      traceStep("orchestrator", "action", "Tool: GitHub raw fetch", `Resolving ${input.githubUrl}`, {
        url: input.githubUrl,
      }),
    );
    const parsed = parseGithubBlobUrl(input.githubUrl.trim());
    if (!parsed) {
      trace.push(
        traceStep(
          "orchestrator",
          "observation",
          "GitHub tool error",
          "URL is not a github.com/blob/... link.",
          { error: "parse" },
        ),
      );
    } else {
      const raw = toRawGithubUrl(parsed);
      const res = await githubFetchRaw(raw, input.githubToken);
      if (!res.ok) {
        trace.push(
          traceStep("orchestrator", "observation", "GitHub tool result", res.error, {
            status: res.status,
          }),
        );
      } else {
        workingCode = res.content;
        workingFilename = parsed.path.split("/").pop() || workingFilename;
        trace.push(
          traceStep(
            "orchestrator",
            "observation",
            "GitHub tool result",
            `Fetched ${workingFilename} (${workingCode.length} chars).`,
            { rawUrl: raw },
          ),
        );
      }
    }
  }

  trace.push(
    traceStep(
      "orchestrator",
      "action",
      "Tool: TypeScript static analysis",
      `Analyzing ${workingFilename}`,
      { filename: workingFilename },
    ),
  );
  const staticRes = analyzeTypeScriptLike(workingCode, workingFilename);
  trace.push(
    traceStep(
      "orchestrator",
      "observation",
      "Static analysis observations",
      staticRes.issues.length
        ? `Compiler reported ${staticRes.issues.length} diagnostic(s).`
        : "No TypeScript/JSX diagnostics for this virtual program (or non-TS file).",
      {
        language: staticRes.language,
        sample: staticRes.issues.slice(0, 12),
      },
    ),
  );

  const specs = extractNpmSpecifiers(workingCode, 8);
  const npmResults: Array<Record<string, unknown>> = [];
  trace.push(
    traceStep(
      "orchestrator",
      "action",
      "Tool: npm registry metadata",
      specs.length ? `Packages: ${specs.join(", ")}` : "No external npm imports detected.",
      { packages: specs },
    ),
  );
  for (const pkg of specs) {
    const meta = await fetchNpmPackageMetadata(pkg);
    npmResults.push(meta);
  }
  trace.push(
    traceStep(
      "orchestrator",
      "observation",
      "npm registry observations",
      npmResults.length
        ? "Fetched packument metadata for detected imports."
        : "Skipped npm metadata.",
      { npm: npmResults },
    ),
  );

  const toolBrief = [
    `STATIC: ${staticRes.issues.length} issue(s); language=${staticRes.language}`,
    `NPM: ${JSON.stringify(npmResults).slice(0, 4000)}`,
  ].join("\n");

  trace.push(
    traceStep(
      "planner",
      "thought",
      "Planner handoff",
      "Planner will turn tool observations into a focused review plan for the Reviewer agent.",
    ),
  );

  const plannerMessages: LLMMessage[] = [
    {
      role: "system",
      content: [
        "You are the Planner agent in a frontend code review pipeline.",
        "Output ONLY valid JSON matching: { goals: string[], focusAreas: string[], riskNotes?: string[] }.",
        "Respect user preferences:",
        `- strictLint: ${prefs.strictLint}`,
        `- preferA11y: ${prefs.preferA11y}`,
        `- maxFixFiles constraint applies to scope (single file here): ${prefs.maxFixFiles}`,
        memories.length
          ? `Prior session memories (may be relevant):\n${memories.map((m) => `- ${m.title}: ${m.summary}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      role: "user",
      content: [
        `Filename: ${workingFilename}`,
        "Tool observations:",
        toolBrief,
        "Code (may be truncated in your reasoning; full code is in the next message for other agents):",
        workingCode.length > 12000
          ? `${workingCode.slice(0, 12000)}\n/* ... truncated ... */`
          : workingCode,
      ].join("\n\n"),
    },
  ];

  const planRaw = await completeChat(plannerMessages, { jsonMode: supportsAgentJsonMode() });
  let plannerPlan = safeJsonParse(planRaw, PlanSchema);
  if (!plannerPlan) {
    plannerPlan = {
      goals: ["Summarize issues", "Suggest safe fixes"],
      focusAreas: ["React/Next correctness", "hooks", "performance", "a11y"],
      riskNotes: ["Planner JSON parse failed; using fallback plan."],
    };
  }
  trace.push(
    traceStep("planner", "handoff", "Plan for Reviewer", JSON.stringify(plannerPlan, null, 2), {
      plan: plannerPlan,
    }),
  );

  trace.push(
    traceStep(
      "reviewer",
      "thought",
      "Reviewer starting",
      "Reviewer consumes Planner plan + tool results and emits structured findings.",
    ),
  );

  const reviewerMessages: LLMMessage[] = [
    {
      role: "system",
      content: [
        "You are the Reviewer agent: senior frontend engineer reviewing React/Next/TypeScript code.",
        "Return ONLY JSON: { findings: [{ severity, title, detail, suggestion? }] }.",
        "severity is one of critical|major|minor|nit.",
        "Incorporate static diagnostics and npm deprecation notes when relevant.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Filename: ${workingFilename}`,
        `Planner plan: ${JSON.stringify(plannerPlan)}`,
        `Static diagnostics sample: ${JSON.stringify(staticRes.issues.slice(0, 24))}`,
        `npm tool: ${JSON.stringify(npmResults)}`,
        "Full code:",
        workingCode,
      ].join("\n\n"),
    },
  ];

  const findingsRaw = await completeChat(reviewerMessages, { jsonMode: supportsAgentJsonMode() });
  let findings = safeJsonParse(findingsRaw, FindingsSchema);
  if (!findings) {
    findings = {
      findings: [
        {
          severity: "major",
          title: "Reviewer output was not valid JSON",
          detail: "The model returned non-JSON; inspect raw response in server logs or retry.",
          suggestion: "Retry with JSON-capable provider (OpenAI/Gemini) or shorten input.",
        },
      ],
    };
  }
  trace.push(
    traceStep(
      "reviewer",
      "handoff",
      "Findings for Fixer",
      `${findings.findings.length} finding(s)`,
      { findings },
    ),
  );

  let fixedCode: string | null = null;
  let fixMeta: z.infer<typeof FixSchema> | null = null;

  if (input.runFix) {
    trace.push(
      traceStep("fixer", "thought", "Fixer starting", "Fixer rewrites code to address Reviewer findings."),
    );
    const fixerMessages: LLMMessage[] = [
      {
        role: "system",
        content: [
          "You are the Fixer agent.",
          "Return ONLY JSON: { fixedCode: string, changeLog: string[] }.",
          "fixedCode must be the complete updated file contents.",
          "Do not add markdown fences. Preserve exports and file purpose.",
          "Prefer minimal, safe edits; avoid large unrelated refactors.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Filename: ${workingFilename}`,
          `Findings: ${JSON.stringify(findings)}`,
          "Original code:",
          workingCode,
        ].join("\n\n"),
      },
    ];
    const fixRaw = await completeChat(fixerMessages, { jsonMode: supportsAgentJsonMode() });
    fixMeta = safeJsonParse(fixRaw, FixSchema);
    fixedCode = fixMeta?.fixedCode ?? null;
    trace.push(
      traceStep(
        "fixer",
        "handoff",
        "Fixed code for Explainer",
        fixMeta?.changeLog?.length
          ? fixMeta.changeLog.join("\n")
          : fixedCode
            ? "Fixer produced updated code."
            : "Fixer did not return valid JSON.",
        { changeLog: fixMeta?.changeLog },
      ),
    );
  } else {
    trace.push(
      traceStep("fixer", "final", "Fixer skipped", "User disabled auto-fix for this run.", {}),
    );
  }

  const unifiedDiff =
    fixedCode && fixedCode !== workingCode
      ? createPatch(workingFilename, workingCode, fixedCode, "", "")
      : null;

  trace.push(
    traceStep(
      "explainer",
      "thought",
      "Explainer starting",
      "Explainer summarizes impact for a frontend developer in simple language.",
    ),
  );

  const explainerMessages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You are the Explainer agent. Write concise, friendly explanations with bullet points. No JSON.",
    },
    {
      role: "user",
      content: [
        `Filename: ${workingFilename}`,
        `Findings: ${JSON.stringify(findings)}`,
        input.runFix
          ? fixedCode
            ? "A fixed version was generated. Summarize what changed and why it helps."
            : "Auto-fix was requested but no valid fixed code was produced."
          : "Auto-fix was not requested; explain the top issues and next steps.",
        fixMeta?.changeLog?.length
          ? `Change log from fixer:\n${fixMeta.changeLog.join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];

  const explainer = await completeChat(explainerMessages);

  trace.push(
    traceStep("explainer", "final", "User-facing summary", explainer.slice(0, 4000), {
      truncated: explainer.length > 4000,
    }),
  );

  await storeReviewMemory(
    input.sessionKey,
    `Review: ${workingFilename}`,
    [
      explainer.slice(0, 1200),
      findings.findings[0]?.title ? `Top issue: ${findings.findings[0].title}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  await savePipelineRun(input.sessionKey, JSON.stringify(trace));

  return {
    trace,
    originalCode: workingCode,
    fixedCode,
    unifiedDiff,
    explainer,
    plannerPlan,
    findings,
  };
}
