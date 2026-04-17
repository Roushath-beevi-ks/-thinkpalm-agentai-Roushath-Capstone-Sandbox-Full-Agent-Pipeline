"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ReActStep = {
  agent: string;
  phase: string;
  title: string;
  detail: string;
  payload?: Record<string, unknown>;
  at: string;
};

type PipelineResponse = {
  trace: ReActStep[];
  originalCode: string;
  fixedCode: string | null;
  unifiedDiff: string | null;
  explainer: string;
  plannerPlan: unknown;
  findings: unknown;
  error?: string;
};

function randomSession(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `sess-${Date.now()}`;
}

export default function Home() {
  const [sessionKey, setSessionKey] = useState("");
  const [filename, setFilename] = useState("Component.tsx");
  const [code, setCode] = useState(`import { useState } from "react";

export default function Counter() {
  const [n, setN] = useState(0);
  return (
    <button onClick={() => setN(n + 1)}>
      Count: {n}
    </buton>
  );
}
`);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [runFix, setRunFix] = useState(true);
  const [strictLint, setStrictLint] = useState(false);
  const [preferA11y, setPreferA11y] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PipelineResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const k = localStorage.getItem("fcr_session") ?? randomSession();
    localStorage.setItem("fcr_session", k);
    setSessionKey(k);
  }, []);

  useEffect(() => {
    if (!sessionKey) return;
    void (async () => {
      try {
        const r = await fetch(`/api/preferences?sessionKey=${encodeURIComponent(sessionKey)}`);
        if (!r.ok) return;
        const p = (await r.json()) as {
          strictLint: boolean;
          preferA11y: boolean;
        };
        setStrictLint(p.strictLint);
        setPreferA11y(p.preferA11y);
      } catch {
        /* ignore */
      }
    })();
  }, [sessionKey]);

  const syncPrefs = useCallback(async () => {
    if (!sessionKey) return;
    await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey, strictLint, preferA11y }),
    });
  }, [sessionKey, strictLint, preferA11y]);

  useEffect(() => {
    const t = setTimeout(() => {
      void syncPrefs();
    }, 400);
    return () => clearTimeout(t);
  }, [strictLint, preferA11y, syncPrefs]);

  const run = async () => {
    setErr(null);
    setResult(null);
    setLoading(true);
    try {
      const r = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey,
          filename,
          code: githubUrl.trim() ? undefined : code,
          githubUrl: githubUrl.trim() || undefined,
          githubToken: githubToken.trim() || undefined,
          runFix,
        }),
      });
      const data = (await r.json()) as PipelineResponse & { error?: string };
      if (!r.ok) {
        setErr(data.error ?? `HTTP ${r.status}`);
        return;
      }
      setResult(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const onFile = (f: FileList | null) => {
    const file = f?.[0];
    if (!file) return;
    setFilename(file.name);
    void file.text().then(setCode);
  };

  const agentColor = useMemo(
    () =>
      ({
        orchestrator: "text-sky-400",
        planner: "text-violet-400",
        reviewer: "text-amber-400",
        fixer: "text-emerald-400",
        explainer: "text-pink-400",
      }) as Record<string, string>,
    [],
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Assessment · Agentic pipeline
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
              AI frontend code reviewer + auto-fixer
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Four agents (Planner → Reviewer → Fixer → Explainer), three live tools (GitHub raw,
              npm registry, TypeScript compiler), SQLite + optional OpenAI embeddings for memory, and
              a full ReAct-style trace in the UI.
            </p>
          </div>
          <a
            className="mt-4 inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 sm:mt-0"
            href="https://stackblitz.com/fork/github/stackblitz/starters/tree/main/nextjs"
            target="_blank"
            rel="noreferrer"
          >
            StackBlitz · Next starter
          </a>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-2">
        <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Input</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-zinc-400">
              Filename
              <input
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Session key (memory scope)
              <input
                readOnly
                className="mt-1 w-full cursor-not-allowed rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 font-mono text-xs text-zinc-500"
                value={sessionKey}
              />
            </label>
          </div>

          <label className="block text-xs text-zinc-400">
            GitHub file URL (optional — blob link)
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
              placeholder="https://github.com/owner/repo/blob/main/src/App.tsx"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
            />
          </label>

          <label className="block text-xs text-zinc-400">
            GitHub token (optional — higher rate limits)
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-sky-500"
              type="password"
              autoComplete="off"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
            />
          </label>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
              <input type="checkbox" checked={runFix} onChange={(e) => setRunFix(e.target.checked)} />
              Run Fixer agent (auto-patch)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
              <input
                type="checkbox"
                checked={strictLint}
                onChange={(e) => setStrictLint(e.target.checked)}
              />
              Strict lint prefs
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
              <input
                type="checkbox"
                checked={preferA11y}
                onChange={(e) => setPreferA11y(e.target.checked)}
              />
              Prefer a11y hints
            </label>
          </div>

          <label className="block text-xs text-zinc-400">
            Upload file
            <input
              type="file"
              accept=".tsx,.ts,.jsx,.js"
              className="mt-1 block w-full text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:text-zinc-200"
              onChange={(e) => onFile(e.target.files)}
            />
          </label>

          <label className="block text-xs text-zinc-400">
            Code
            <textarea
              className="mt-1 h-64 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs leading-relaxed outline-none focus:border-sky-500"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
            />
          </label>

          <button
            type="button"
            disabled={loading || !sessionKey}
            onClick={() => void run()}
            className="w-full rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 hover:from-sky-500 hover:to-cyan-500 disabled:opacity-50"
          >
            {loading ? "Running pipeline…" : "Run multi-agent pipeline"}
          </button>

          {err ? (
            <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {err}
            </p>
          ) : null}
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Explainer output
            </h2>
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-3 font-sans text-sm leading-relaxed text-zinc-200">
              {result?.explainer ?? "Run the pipeline to see the Explainer agent summary."}
            </pre>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Findings</h2>
            <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
              {result?.findings
                ? JSON.stringify(result.findings, null, 2)
                : "// Structured Reviewer JSON will appear here"}
            </pre>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Diff</h2>
              {result?.fixedCode ? (
                <button
                  type="button"
                  className="rounded-lg border border-zinc-600 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                  onClick={() => void navigator.clipboard.writeText(result.fixedCode ?? "")}
                >
                  Copy fixed code
                </button>
              ) : null}
            </div>
            <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
              {result?.unifiedDiff ?? "// Unified diff after Fixer runs"}
            </pre>
          </div>
        </section>

        <section className="lg:col-span-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              ReAct trace · Thought → Action → Observation
            </h2>
            <ol className="mt-4 space-y-3">
              {(result?.trace ?? []).map((s, i) => (
                <li
                  key={`${s.at}-${i}`}
                  className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className={`font-semibold ${agentColor[s.agent] ?? "text-zinc-400"}`}>
                      {s.agent}
                    </span>
                    <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                      {s.phase}
                    </span>
                    <span className="text-zinc-500">{new Date(s.at).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-zinc-100">{s.title}</p>
                  <p className="mt-1 text-sm text-zinc-400">{s.detail}</p>
                  {s.payload && Object.keys(s.payload).length > 0 ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-sky-400">Payload</summary>
                      <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[10px] text-zinc-400">
                        {JSON.stringify(s.payload, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ol>
            {!result?.trace?.length ? (
              <p className="mt-4 text-sm text-zinc-500">Trace steps appear after a successful run.</p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
