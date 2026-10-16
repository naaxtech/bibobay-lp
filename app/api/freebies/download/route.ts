import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { freebieFilePath } from "@/lib/freebies/file";
import { TOKEN_QUERY, verifyDownloadToken } from "@/lib/freebies/token";
import { reportError } from "@/lib/observability/report";

/**
 * GET /api/freebies/download?t=<token>: the only way to the free activity pack (ruling R140; the
 * PDF is no longer a public file). Statuses, checked in this order: 404 no token or malformed ·
 * 503 no signing secret configured · 404 bad signature · 410 expired · 404 the file is not on disk ·
 * 200 the PDF. Nothing here names a visitor; the token carries only a file name and an expiry.
 * src: https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config · next 16.3.8 · 2026-10-16 (`runtime`)
 * src: https://nextjs.org/docs/app/guides/caching-without-cache-components#route-segment-config · next 16.3.8 · 2026-10-16 (`dynamic`)
 * (`dynamic = "force-dynamic"` because the answer depends on the token and the clock; the
 * file is traced into the function by `outputFileTracingIncludes` in next.config.ts.)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" } as const;

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...PRIVATE_HEADERS, "content-type": "text/plain; charset=utf-8" } });
}

function errnoCode(error: unknown): string | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

export async function GET(request: Request): Promise<Response> {
  const verdict = verifyDownloadToken(new URL(request.url).searchParams.get(TOKEN_QUERY), process.env);
  if (!verdict.ok) {
    if (verdict.reason === "unconfigured") return text(503, "Downloads are not open yet.");
    if (verdict.reason === "expired") return text(410, "This download link has expired. Sign up again on the page to get a new one.");
    return text(404, "Not found");
  }
  const path = freebieFilePath(verdict.fileUrl);
  if (!path) return text(404, "Not found");
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    // A signed token names only a file the server chose, so an unreadable file is an operator fault
    // (a bad trace, a renamed PDF), not a visitor error. A fresh error carries only the errno code: the original message names the path.
    reportError(new Error("freebie file unreadable"), { area: "freebies", event: "freebie_file_unreadable", code: errnoCode(error) });
    return text(404, "Not found");
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${basename(path)}"`,
      "content-length": String(bytes.length),
    },
  });
}
