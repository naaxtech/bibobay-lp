# Cloudflare Client Address Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind the Cloudflare proxy, every form's rate limit counts each visitor separately again, instead of pooling everyone who reaches the site through the same Cloudflare server.

**Architecture:** `clientKeyFromHeaders` (`lib/leads/http.ts`) keys the rate-limit bucket on the address Vercel saw. When www.bibobay.com is proxied, that address is a Cloudflare server: Vercel overwrites `x-forwarded-for` with the connecting address and does not forward external addresses on Hobby. Cloudflare sends the visitor's address in `CF-Connecting-IP`. The helper uses that header only when the address Vercel saw is inside Cloudflare's published ranges. Anyone connecting to Vercel directly has their own address there, so a forged header from them is ignored.

**Tech Stack:** Next.js 16.3.8, TypeScript, Vitest. No new dependency.

**Spec:** This plan's Goal and the owner's request of 2026-10-22: "how do I protect the site via Cloudflare?" The owner is keeping the proxy, which fires the Layer 11 trigger written in `docs/superpowers/plans/2026-10-22-bot-check.md` ("the owner keeping the proxy").

## Global Constraints

- The next free ruling number is R245.
- Match the repo's style: long lines, the existing comment density, `node:` imports, and no `any`.
- Do not change `clientAddressBucket`'s behaviour or the HMAC.
- The Cloudflare ranges are exactly the 22 published ones (15 IPv4 + 7 IPv6). Cite them as `// src: https://www.cloudflare.com/ips/ · list last updated 2023-09-28 · fetched 2026-10-22`.
- Sources for the Vercel behaviour, cited in the doc comment:
  - `https://vercel.com/docs/headers/request-headers` ("we currently overwrite the X-Forwarded-For header and do not forward external IPs"; custom X-Forwarded-For needs Enterprise Trusted Proxy);
  - `https://vercel.com/docs/security/reverse-proxy` (Verified Proxy Lite lists Cloudflare's `CF-Connecting-IP`).

## Rulings

- **R245.** The visitor's address is the `CF-Connecting-IP` value only when the left-most `x-forwarded-for` address (or `x-real-ip` when that is absent) is inside a Cloudflare range AND the header parses as an IPv4 or IPv6 address. Otherwise it is the address Vercel saw, as today.
  - Why: Cloudflare overwrites `CF-Connecting-IP` at its edge, so only a request Cloudflare forwarded carries a trustworthy one. A direct caller cannot make Vercel record a Cloudflare address.
  - Cost if wrong: a list gone stale (Cloudflare adds a range) means visitors arriving through the new range pool on the Cloudflare server's address again. That is no worse than today. The trigger to refresh is Cloudflare changing its published list.
- **R246.** An IPv4-mapped IPv6 edge address (`::ffff:a.b.c.d`) counts as IPv4 for the range check, the same way `clientAddressBucket` treats it.
- **R247.** No secret header (Transform Rule) and no origin lock.
  - Why: the range check needs no owner setup.
  - What bypassing Cloudflare still meets: a direct caller skips Cloudflare's WAF, but still meets Vercel's own firewall, the bot check and these rate limits.
  - The trigger to add an origin lock is abuse seen arriving directly at Vercel.

## Review Focus

1. A forged `CF-Connecting-IP` from a non-Cloudflare address must change nothing.
2. A range's first and last address must be inside it, and the address just past its end must be outside it. Watch for an off-by-one in prefix masking, especially IPv4 prefixes that are not multiples of 8 (/13, /14, /15, /17, /18, /20, /22) and the IPv6 /29.
3. A garbage, empty, comma-list or bracketed `CF-Connecting-IP` must neither throw nor produce a fresh bucket per value. A comma list or garbage falls back to the edge address. A bracketed `[v6]` may be accepted only if `clientAddressBucket` already reads it.
4. Two visitors behind the same Cloudflare server must get different keys. This is the defect being fixed.
5. A request with no `x-forwarded-for` and no `x-real-ip` must behave as today (the `unknown` bucket), whatever `CF-Connecting-IP` says.

---

### Task 1: Trust CF-Connecting-IP only from Cloudflare's ranges

**Files:**
- Create: `lib/leads/cloudflare-ranges.ts`. It exports `CLOUDFLARE_RANGES: readonly string[]` and `isCloudflareAddress(address: string): boolean`.
- Modify: `lib/leads/http.ts`.
  - `clientKeyFromHeaders` applies R245.
  - Rewrite its doc comment's last paragraph ("revisit this before hosting anywhere else") to describe the Cloudflare case with the two Vercel citations.
  - Export the existing `parseIpv4`/`parseIpv6` helpers only if `cloudflare-ranges.ts` needs them. Otherwise keep them private and parse in the new file.
- Test: `tests/leads/client-key.test.ts` (extend it, keeping its style), plus a new `tests/leads/cloudflare-ranges.test.ts`.
- Docs:
  - `docs/deployment.md`: one short paragraph in the Cloudflare / bot-check area saying rate limits read `CF-Connecting-IP` only from Cloudflare addresses (R245), and refresh the list when Cloudflare changes it.
  - `CHANGELOG.md`: a dated entry at the top, 2026-10-22, in the file's existing style.

**Interfaces:**
- Consumes: `clientAddressBucket(raw: string): string`, unchanged.
- Produces: `clientKeyFromHeaders(headers: Headers, secret: string): string`, with the same signature and the new behaviour. `isCloudflareAddress(address: string): boolean` accepts the same raw forms as `clientAddressBucket` (spaces, `:port`, `[v6]`, `%zone`, IPv4-mapped).

- [ ] **Step 1: Write the failing tests.**
  - `cloudflare-ranges.test.ts`:
    - `CLOUDFLARE_RANGES` equals exactly the 22 published ranges, in the published order.
    - The first address of each range is inside.
    - Boundaries:
      - `104.23.255.255` is in and `104.24.0.0` is in (the next range); `104.28.0.0` is out.
      - `172.71.255.255` is in; `172.72.0.0` is out.
      - `162.159.255.255` is in; `162.160.0.0` is out.
      - `198.41.255.255` is in; `198.42.0.0` is out.
      - `2a06:98c7:ffff::1` is in; `2a06:98c8::` is out.
      - `2606:4700:ffff::1` is in; `2606:4701::` is out.
    - `::ffff:104.16.0.1` is in.
    - These are all out: `203.0.113.7`, `2001:db8::1`, `""`, `"garbage"`, `"104.16.0.1, 10.0.0.1"`.
  - `client-key.test.ts`, using the existing secret fixture:
    - (a) Cloudflare edge `104.16.0.1` + `cf-connecting-ip: 203.0.113.7` gives the same key as a direct `203.0.113.7`.
    - (b) Two different `cf-connecting-ip` values behind the same edge give different keys.
    - (c) Non-Cloudflare edge `198.51.100.1` + `cf-connecting-ip: 203.0.113.7` gives the same key as a direct `198.51.100.1`.
    - (d) A Cloudflare edge + a missing, empty, `garbage` or `1.2.3.4, 5.6.7.8` header gives the key of the edge address.
    - (e) IPv6 edge `2606:4700::1` + `cf-connecting-ip: 2001:db8:1:2::5` gives the same key as a direct `2001:db8:1:2::9` (same /64).
    - (f) An edge from `x-real-ip` only (`104.16.0.1`) + a header is treated like (a).
    - (g) No `x-forwarded-for` or `x-real-ip` + a header gives the `unknown` bucket's key.
- [ ] **Step 2: Run the tests.** `npx vitest run tests/leads/client-key.test.ts tests/leads/cloudflare-ranges.test.ts`. Expected: the new cases FAIL (the module is missing, and the header is ignored).
- [ ] **Step 3: Implement** `cloudflare-ranges.ts` and the R245 branch in `clientKeyFromHeaders`. CIDR matching is integer prefix masking over the parsed octets or 16-bit groups. Add no dependency.
- [ ] **Step 4: Run the tests, then the full gate.**
  - Run the same two files. Expected: PASS.
  - Then `npm run typecheck`, `npm run lint` and `npx vitest run`. Expected: exit 0 and no new warnings.
- [ ] **Step 5: Leave the changes in the tree.** The coordinator reviews and commits; subagents make no git writes.
