/*
 * Percent-decoding for privacy checks (Task 7b re-review 3 M1). decodeURIComponent throws on the
 * whole text when any escape is malformed (a stray "%", an escape cut short by a length cap, a lone
 * UTF-8 byte), and an encoded email address beside it then went unseen. This never throws.
 * Relative imports only: lib/observability/sentry-config.ts uses it.
 */

/** One round: each run of escapes decoded where it can be; failing that, its ASCII escapes one by one. */
function decodeRound(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run.replace(/%[0-9a-f]{2}/gi, (escape) => {
        const code = Number.parseInt(escape.slice(1), 16);
        return code < 0x80 ? String.fromCharCode(code) : escape;
      });
    }
  });
}

/** The text percent-decoded up to `rounds` times (`%2540` takes two), leaving anything malformed as it is. */
export function decodeLeniently(text: string, rounds = 3): string {
  let current = text;
  for (let round = 0; round < rounds && current.includes("%"); round += 1) {
    const next = decodeRound(current);
    if (next === current) break;
    current = next;
  }
  return current;
}
