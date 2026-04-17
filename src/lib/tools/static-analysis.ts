import ts from "typescript";

export type StaticIssue = {
  line: number;
  column: number;
  code: string;
  message: string;
  category: "syntax" | "type";
};

export type StaticAnalysisResult = {
  virtualPath: string;
  language: "tsx" | "ts" | "jsx" | "js" | "unknown";
  issues: StaticIssue[];
};

function scriptKindForFilename(filename: string): { kind: ts.ScriptKind; language: StaticAnalysisResult["language"] } {
  const f = filename.toLowerCase();
  if (f.endsWith(".tsx")) return { kind: ts.ScriptKind.TSX, language: "tsx" };
  if (f.endsWith(".ts")) return { kind: ts.ScriptKind.TS, language: "ts" };
  if (f.endsWith(".jsx")) return { kind: ts.ScriptKind.JSX, language: "jsx" };
  if (f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs")) {
    return { kind: ts.ScriptKind.JS, language: "js" };
  }
  return { kind: ts.ScriptKind.Unknown, language: "unknown" };
}

/** Single-file TypeScript/JSX analysis using the compiler API (real static tool). */
export function analyzeTypeScriptLike(code: string, filename: string): StaticAnalysisResult {
  const { kind: scriptKind, language } = scriptKindForFilename(filename);
  const virtualPath = `/virtual/${filename.split(/[/\\]/).pop() ?? "snippet.tsx"}`;

  if (language === "unknown") {
    return { virtualPath, language, issues: [] };
  }

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    esModuleInterop: true,
    isolatedModules: true,
  };

  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (f) => f === virtualPath || defaultHost.fileExists(f),
    readFile: (f) => (f === virtualPath ? code : defaultHost.readFile(f)),
    getSourceFile: (fileName, languageVersion, onError) => {
      if (fileName === virtualPath) {
        return ts.createSourceFile(fileName, code, languageVersion, true, scriptKind);
      }
      return defaultHost.getSourceFile(fileName, languageVersion, onError);
    },
  };

  const program = ts.createProgram([virtualPath], compilerOptions, host);
  const sf = program.getSourceFile(virtualPath);
  if (!sf) {
    return {
      virtualPath,
      language,
      issues: [
        {
          line: 1,
          column: 1,
          code: "no-source",
          message: "Could not load virtual source file for analysis",
          category: "syntax",
        },
      ],
    };
  }

  const syntactic = program.getSyntacticDiagnostics(sf);
  const semantic = program.getSemanticDiagnostics(sf);

  const issues: StaticIssue[] = [];

  const pushIssues = (diagnostics: readonly ts.Diagnostic[], category: StaticIssue["category"]) => {
    for (const d of diagnostics) {
      if (!d.file || d.start === undefined) continue;
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      issues.push({
        line: pos.line + 1,
        column: pos.character + 1,
        code: typeof d.code === "number" ? String(d.code) : "diag",
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        category,
      });
    }
  };

  pushIssues(syntactic, "syntax");
  pushIssues(semantic, "type");

  return { virtualPath, language, issues };
}

export function extractNpmSpecifiers(code: string, max = 8): string[] {
  const re =
    /(?:from\s+["']([^"']+)["'])|(?:import\s*\(\s*["']([^"']+)["']\s*\))|(?:require\(\s*["']([^"']+)["']\s*\))/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("~/")) continue;
    const pkg = spec.startsWith("@")
      ? spec.split("/").slice(0, 2).join("/")
      : spec.split("/")[0]!;
    if (pkg) out.add(pkg);
    if (out.size >= max) break;
  }
  return [...out];
}
