export type NpmPackumentResult =
  | {
      ok: true;
      name: string;
      latest: string;
      deprecated?: string;
    }
  | { ok: false; name: string; error: string; status?: number };

export async function fetchNpmPackageMetadata(packageName: string): Promise<NpmPackumentResult> {
  const name = packageName.trim();
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (!r.ok) {
      return {
        ok: false,
        name,
        error: `npm registry HTTP ${r.status}: ${r.statusText}`,
        status: r.status,
      };
    }

    const j = (await r.json()) as {
      "dist-tags"?: { latest?: string };
      versions?: Record<string, { deprecated?: string }>;
    };

    const latest = j["dist-tags"]?.latest;
    if (!latest) return { ok: false, name, error: "No dist-tags.latest in packument" };

    const deprecated = j.versions?.[latest]?.deprecated;
    return { ok: true, name, latest, deprecated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return {
      ok: false,
      name,
      error: msg.includes("abort") ? "npm registry request timed out" : msg,
    };
  }
}
