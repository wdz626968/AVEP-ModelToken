# AVEP-ModelToken — Comprehensive Review Report
**Date:** 2026-03-23
**Branch:** dev-kevin
**Deployment:** https://avep-modeltoken.vercel.app
**Reviews Run:** /qa · /plan-ceo-review · /plan-eng-review

---

## Executive Summary

Three reviews were run on the AVEP-ModelToken (HiveGrid) project on branch `dev-kevin`. The project is a Next.js + Prisma + Supabase AI-agent task marketplace currently at version V0.5.

| Review | Focus | Outcome | Critical Findings |
|--------|-------|---------|-------------------|
| QA | Live site bugs | 3 bugs found, 3 fixed, deployed | ISSUE-001/002/003 |
| CEO | Product strategy | SELECTIVE EXPANSION, 4 P1 fixes | Rate limiter, settle race, naming |
| Eng | Architecture + code | 12 issues, 2 critical gaps | Dead code, race condition |

**Overall health:** Site QA score 62 → 84. Two critical security/financial gaps require immediate P1 fixes before V0.6.

---

## Part 1: QA Report Summary

**Full report:** `.gstack/qa-reports/qa-report-avep-modeltoken-vercel-app-2026-03-23.md`

### Bugs Found and Fixed

| ID | Severity | Description | Fix | Commit |
|----|----------|-------------|-----|--------|
| ISSUE-001 | HIGH | Login error message silently lost when `authLoading` unmounts form | Change auth guard condition in `login/page.tsx` | `cced1d5` |
| ISSUE-002 | MEDIUM | Task marketplace (`/tasks`) required auth but API is public | Add `/tasks` to `PUBLIC_PATHS` in `auth-guard.tsx` | `4b21f72` |
| ISSUE-003 | MEDIUM | Dashboard shows "暂无记录" during data loading | Add `dataLoading` state + animate-pulse in `dashboard/page.tsx` | `41d25f3` |

### Health Score

```
Baseline: 62/100  →  Final: 84/100  (+22)
```

### Regression Tests Added

- `__tests__/nectar.regression-1.test.ts` — Login form guard logic
- `__tests__/auth-guard.regression-1.test.ts` — PUBLIC_PATHS includes /tasks

### Deferred (minor)

- ISSUE-003b: Two 401 API calls on every dashboard cold start (SSR hydration timing). No user-visible impact. Deferred to V0.6.

---

## Part 2: CEO Review Summary

**Full plan:** `~/.gstack/projects/wdz626968-AVEP-ModelToken/ceo-plans/2026-03-23-avep-hivegrid-v0.5-review.md`
**Mode:** SELECTIVE EXPANSION | **Adversarial rounds:** 2 | **Final score:** 7/10

### Product Premise

Best framing for AVEP: **trust-enabled AI agent work marketplace**. The probe engine (LLM model identity verification) is the defensible moat — no competitor has it. The idle-token hook is a smart acquisition angle but should not be the primary narrative.

### Dream State

```
V0.5 TODAY          THIS PLAN           12-MONTH IDEAL
────────────        ─────────────       ──────────────────────────
9 live tasks        Stability +         10+ active agent operators
3 test agents       QA foundation       Probe engine as trust API
3 bugs fixed        No new features     Full ANP integration
                                        Nectar as real settlement layer
```

### Scope Decisions

| Proposal | Decision | Notes |
|----------|----------|-------|
| Fix rate limiter (Vercel KV) | **ACCEPT P1** | Dead code — must wire to routes |
| Settle idempotency | **ACCEPT P1** | Race condition, financial risk |
| Prisma migrate deploy | **ACCEPT P1** | `db push` in prod = data loss risk |
| ~~Probe engine timeout~~ | **REMOVED** | Non-issue — no outbound LLM calls |
| Agent discovery page | Defer → V0.6 | Feature, not bug |
| Trust score display | Defer → V0.6 | Needs discovery page first |
| Settlement confirm dialog | Defer → V0.6 | UX polish |
| Structured observability | Defer → V0.6 | Foundation work |
| Staging environment | Defer → V0.7 | Infrastructure |
| Full DID signature auth | Defer → V1.0 | Major refactor |

### Strategic Recommendations

1. **Resolve the AVEP vs HiveGrid naming split.** "HiveGrid" is richer. Pick one before V0.6.
2. **The probe engine is the moat.** Build it out as a public API / network primitive. Nobody else has cryptographic LLM model identity verification.
3. **Current phase:** Stability-first is correct. Don't add features until the financial integrity gap (double-settle) is closed.

---

## Part 3: Engineering Review Summary

**Full report:** `docs/ENG-REVIEW-2026-03-23.md`
**Test plan:** `~/.gstack/projects/wdz626968-AVEP-ModelToken/node-dev-kevin-eng-review-test-plan-20260323.md`

### EUREKA Findings (CEO Plan Corrections)

**EUREKA-1:** The probe engine makes **no outbound LLM calls from the server**. The architecture is: server generates a math challenge → drone agent calls their own LLM locally → drone submits response → server verifies against static lookup tables. CEO plan's "CRITICAL-3: probe timeout" was invalid and has been removed from scope.

**EUREKA-2:** The rate limiter is **dead code**. `authenticateAndRateLimit()` is correctly implemented in `lib/auth.ts` but **zero routes call it** — all routes call `authenticateDrone()` directly. The fix is simply to wire the existing function to high-volume routes.

### Critical Gaps

**GAP-1 (CRITICAL): Settle race condition — double Nectar charge**

```
settle/route.ts reads task.status='accepted' (line 21)
↓ check passes (line 29) — NON-ATOMIC
↓ settleTask() in $transaction (lib/nectar.ts)
↓ prisma.task.update(status='completed') — SEPARATE OPERATION

Race: Two concurrent requests both pass status check → both run settleTask()
→ Worker gets paid twice, Publisher charged twice
```

**Fix:** Merge task status update INTO the `settleTask` transaction using `updateMany WHERE status='accepted'`. Check `count === 0` → return 409.

**GAP-2 (CRITICAL): Rate limiter dead code**

```
lib/rate-limit.ts  →  checkRateLimit()
lib/auth.ts        →  authenticateAndRateLimit() [defined but never called]
API routes         →  authenticateDrone() [bypasses rate limiting]
```

**Fix:** In 4 high-volume routes, replace `authenticateDrone` with `authenticateAndRateLimit`. Handle `rateLimited: true` → return 429.

### Architecture Issues

| # | Severity | Issue | Location | Fix |
|---|----------|-------|----------|-----|
| ARCH-1 | HIGH | Rate limiter dead code | `lib/auth.ts`, 4 route files | Wire `authenticateAndRateLimit` |
| ARCH-2 | HIGH | Settle not atomic | `settle/route.ts`, `lib/nectar.ts` | Move status update into transaction |
| ARCH-3 | MED | Auth cache in-memory | `lib/cache.ts` | Performance only — defer to V0.6 |
| ARCH-4 | LOW | heartbeat God function (212 lines) | `heartbeat/route.ts` | Refactor into lib/ — V0.6 |

### Code Quality Issues

| # | Severity | Issue | Location |
|---|----------|-------|----------|
| Q-1 | HIGH | settleTask and status update not atomic | `settle/route.ts:57-67` |
| Q-2 | MED | `calculateOverallScore` duplicated in 2 files | `probe/route.ts`, `probe/challenge/route.ts` |
| Q-3 | MED | No type validation on `actualTokens` | `settle/route.ts:50` |
| Q-4 | LOW | Heartbeat body parse swallows all JSON errors | `heartbeat/route.ts:42` |
| Q-5 | LOW | Auth cache never invalidates on drone update | `lib/cache.ts` |

### Test Coverage

```
Current: 2/18 critical paths tested (11%)
Required tests: 4 new test files
  - __tests__/settle.regression-1.test.ts (CRITICAL)
  - __tests__/rate-limit.test.ts (CRITICAL)
  - __tests__/nectar.test.ts
  - __tests__/auth.test.ts
```

### Task State Machine (Actual)

```
"pending" → accept() → "accepted" → settle() → "completed"
             ↓                       ↓
          cancel()                cancel()
             ↓                       ↓
         "cancelled"            "cancelled" (+ compensation)
```

**Note:** There is NO `"in_progress"` status. The CEO plan incorrectly used this term. The actual status values are: `pending | accepted | completed | cancelled`.

---

## Part 4: Consolidated P1 Fix Plan

All three reviews converge on the same prioritized fix list:

### Fix Sequence (correct order)

```
1. Wire rate limiter (30 min CC)
   └── Replace authenticateDrone → authenticateAndRateLimit in 4 routes

2. Atomic settle (20 min CC)
   └── Move task.update(status) INTO settleTask transaction
   └── Use updateMany WHERE status='accepted', check count

3. Write regression tests (20 min CC)
   └── settle.regression-1.test.ts (concurrent settle → 409)
   └── rate-limit.test.ts (checkRateLimit per-agent limit)

4. Prisma migrate baseline (30 min CC)
   └── prisma migrate dev --name init (generate baseline)
   └── prisma migrate resolve --applied "init" (mark applied)
   └── Update vercel.json build to run prisma migrate deploy
```

### Files to Modify

| File | Change | Risk |
|------|--------|------|
| `app/api/drones/heartbeat/route.ts` | `authenticateDrone` → `authenticateAndRateLimit` | Low |
| `app/api/drones/probe/route.ts` | Same | Low |
| `app/api/drones/probe/challenge/route.ts` | Same | Low |
| `app/api/tasks/route.ts` | Same | Low |
| `app/api/tasks/[id]/settle/route.ts` | Remove separate task.update, pass to lib | Medium |
| `lib/nectar.ts` | Add task status update + count check in settleTask() | Medium |
| `vercel.json` | Add `prisma migrate deploy` to build command | Medium |
| `__tests__/settle.regression-1.test.ts` | New file | Low |
| `__tests__/rate-limit.test.ts` | New file | Low |

Total: 9 files. ~90 minutes with CC.

---

## Part 5: V0.6 Roadmap (deferred)

Based on all three reviews, V0.6 should focus on:

1. **Agent Discovery** (`/drones` page with public profiles + TrustScore display)
2. **UX polish** (settlement confirm dialog, better error states in task detail)
3. **Observability** (structured logging, `/api/stats` completion, Vercel spending alert for usage)
4. **Auth cache** (replace in-memory cache with Redis for auth performance at scale)
5. **heartbeat refactor** (extract auto-match and TrustScore logic to lib/)

And the **V0.6 feature bet**: expose the probe engine as a public trust API. This is the product's defensible moat.

---

## Appendix: All Commits This Session

| SHA | Description |
|-----|-------------|
| `cced1d5` | fix(qa): ISSUE-001 — login error message lost when authLoading unmounts form |
| `4b21f72` | fix(qa): ISSUE-002 — /tasks page now publicly accessible without login |
| `41d25f3` | fix(qa): ISSUE-003 — dashboard sections show loading state instead of empty |
| `d77b7aa` | chore: bootstrap vitest test framework + regression tests for ISSUE-001 and ISSUE-002 |

**Branch:** dev-kevin
**Live at:** https://avep-modeltoken.vercel.app
