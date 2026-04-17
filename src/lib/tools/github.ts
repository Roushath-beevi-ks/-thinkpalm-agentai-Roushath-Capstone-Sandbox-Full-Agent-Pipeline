export type GithubFetchResult =
  | { ok: true; url: string; content: string }
  | { ok: false; error: string; status?: number };

export type ParsedGithubBlob = {
  owner: string;
  repo: string;
  ref: string;
  path: string;
};

/** Parse https://github.com/owner/repo/blob/ref/path/to/file */
export function parseGithubBlobUrl(url: string): ParsedGithubBlob | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[2] !== "blob") return null;
    const [owner, repo, , ref, ...pathParts] = parts;
    if (!owner || !repo || !ref || pathParts.length === 0) return null;
    return { owner, repo, ref, path: pathParts.join("/") };
  } catch {
    return null;
  }
}

export function toRawGithubUrl(p: ParsedGithubBlob): string {
  return `https://raw.githubusercontent.com/${p.owner}/${p.repo}/${p.ref}/${p.path}`;
}

export async function githubFetchRaw(
  rawUrl: string,
  token?: string,
): Promise<GithubFetchResult> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.raw",
      "User-Agent": "frontend-code-reviewer/1.0",
    };
    if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    const r = await fetch(rawUrl, { headers, signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);

    if (!r.ok) {
      return {
        ok: false,
        error: `GitHub HTTP ${r.status}: ${r.statusText || "request failed"}`,
        status: r.status,
      };
    }
    const content = await r.text();
    return { ok: true, url: rawUrl, content };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: msg.includes("abort") ? "GitHub request timed out" : msg };
  }
}
