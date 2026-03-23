# Engineering Review: AVEP-ModelToken dev-kevin
**Date:** 2026-03-23
**Branch:** dev-kevin
**Reviewer:** /plan-eng-review (gstack)
**Mode:** FULL_REVIEW
**Scope:** QA fixes (V0.5) + 4 P1 fixes identified in CEO review

---

## Step 0: Scope Challenge

### What already exists

| Sub-problem | Existing code | Reused? |
|-------------|--------------|---------|
| Rate limiting | `lib/rate-limit.ts` (in-memory) | Partial — `authenticateAndRateLimit()` defined but never called |
| Nectar transactions | `lib/nectar.ts` — `prisma.$transaction` | Yes, but race condition in settle |
| Auth middleware | `lib/auth.ts` | Yes |
| Probe challenges | `lib/probe.ts` — pure static logic | Yes — no LLM calls server-side |
| Task state | `prisma/schema.prisma` — `status` field | Yes |

### EUREKA: Probe engine makes no outbound LLM calls

CEO review flagged "probe engine calls external LLM API — needs timeout." This is **incorrect**. The probe architecture is:
1. Server generates mathematical challenge (pure computation, no network call)
2. Drone agent calls their own LLM locally with the challenge prompt
3. Drone submits response to server
4. Server verifies response against static lookup tables (no network call)

**There is no external LLM call from the server.** CRITICAL-3 from the CEO plan is invalid and has been removed from scope.

### EUREKA: Rate limiter is not just broken — it's dead code

CEO plan flagged "in-memory rate limiter broken on Vercel." The full truth is worse:
`authenticateAndRateLimit()` in `lib/auth.ts` is correctly defined and calls `checkRateLimit()`, but **zero API routes call `authenticateAndRateLimit()`** — all routes call `authenticateDrone()` directly, bypassing rate limiting entirely.

**Fix is simpler:** replace `authenticateDrone` with `authenticateAndRateLimit` in high-volume routes (heartbeat, probe, tasks). The in-memory storage is still a problem for persistence across cold starts, but wiring is the P0 step.

### Minimum scope for this review

The plan is Stability-First (APPROACH A) — no new features. Changes needed:
1. Wire rate limiter to high-volume routes (`authenticateAndRateLimit`)
2. Fix settle race condition (atomic status update in transaction)
3. Migrate to `prisma migrate deploy`

Files touched: ~4 files. Well under the 8-file smell threshold. ✓

---

## Section 1: Architecture Review

### Overall Design

```
┌─────────────────────────────────────────────────────────────────┐
│                    AVEP / HiveGrid V0.5                         │
│                                                                 │
│  Browser              Next.js (Vercel)         Supabase         │
│  ┌──────────┐         ┌─────────────────┐      ┌──────────┐    │
│  │ React UI │◄───────►│ API Routes      │◄────►│Postgres  │    │
│  │ localStorage       │ /drones         │      │(Prisma)  │    │
│  │ apiKey   │         │ /tasks          │      └──────────┘    │
│  └──────────┘         │ /rooms          │                       │
│                        │ /admin          │      ┌──────────┐    │
│  Drone Agents (CLI)    │                 │      │  Cache   │    │
│  ┌──────────┐         │ lib/auth.ts     │◄────►│(in-mem)  │    │
│  │ SKILL.md │◄───────►│ lib/nectar.ts   │      │⚠️ cold   │    │
│  │ (ANP)    │         │ lib/probe.ts    │      └──────────┘    │
│  └──────────┘         │ lib/rate-limit  │                       │
│                        │ ⚠️ dead code   │                       │
│                        └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘

⚠️ = known issue
```

### Architecture Issues Found

**ARCH-1 (HIGH): Rate limiter dead code**
`authenticateAndRateLimit()` is never called. All routes use `authenticateDrone()` directly.
No agent is rate-limited. An agent can send unlimited requests.
**Fix:** Replace `authenticateDrone` with `authenticateAndRateLimit` in:
- `app/api/drones/heartbeat/route.ts` (highest volume)
- `app/api/drones/probe/route.ts`
- `app/api/drones/probe/challenge/route.ts`
- `app/api/tasks/route.ts` (task publishing)

**ARCH-2 (HIGH): Settle race condition — separate transaction**
`settle/route.ts:21` — `prisma.task.findUnique` reads status
`settle/route.ts:29` — checks `task.status !== "accepted"` (non-atomic)
`nectar.ts:settleTask` — executes Nectar transfer in transaction
`settle/route.ts:60` — `prisma.task.update` sets status "completed" (separate operation)

Two concurrent settle requests: both pass the status check before either commits → both run `settleTask` → double Nectar transfer.

**Fix:** Move `prisma.task.update({ status: 'completed' })` into `settleTask` transaction with WHERE `status = 'accepted'`. Use Prisma `updateMany` with count check.

**ARCH-3 (MEDIUM): Auth cache is in-memory (same problem as rate limiter)**
`lib/cache.ts` — `authCache` and `droneCache` are in-memory Maps. Same cold-start problem. On Vercel each invocation may start fresh, so every request re-authenticates from DB.
**Impact:** Performance only (extra DB queries), not correctness. Lower priority than rate limiter.

**ARCH-4 (LOW): heartbeat/route.ts is 212 lines — God function**
Does: auth, heartbeat update, assignment lookup, auto-match, notification, TrustScore update.
Should be split into: `updateHeartbeat()`, `getAssignments()`, `autoMatch()` in lib/.
**Impact:** Maintenance complexity. Defer to V0.6 refactor.

### Data Flow: Settle (with race condition)

```
REQUEST A                     REQUEST B
─────────────────             ─────────────────
findUnique(task)              findUnique(task)
  → status='accepted' ✓         → status='accepted' ✓ (RACE)
status check passes           status check passes
settleTask() TX               settleTask() TX
  pay worker +50                pay worker +50 (DUPLICATE!)
  refund publisher +0           refund publisher +0
task.update(completed)        task.update(completed)
  → 200 OK                      → 200 OK (DUPLICATE!)

RESULT: Worker gets +100, Publisher gets -100 extra
```

### Data Flow: Settle (fixed)

```
REQUEST A                     REQUEST B
─────────────────             ─────────────────
$transaction {                $transaction {
  updateMany(task WHERE         updateMany(task WHERE
    status='accepted') →          status='accepted') →
    count=1 → proceed             count=0 → 409 CONFLICT
  pay worker +50              }
  refund publisher
}
  → 200 OK                      → 409 Conflict
```

---

## Section 2: Code Quality Review

**Q-1 (HIGH): `settleTask` and status update are not atomic**
File: `app/api/tasks/[id]/settle/route.ts:57-67`
The Nectar transfer (in `settleTask` transaction) and the status update (`prisma.task.update`) are two separate database operations. This is the root cause of the race condition.

**Q-2 (MEDIUM): DRY violation — `calculateOverallScore` duplicated**
`app/api/drones/probe/route.ts:89-97` and `app/api/drones/probe/challenge/route.ts:149-157` both define identical `calculateOverallScore` functions. Should be extracted to `lib/trust.ts`.

**Q-3 (MEDIUM): No input validation on `actualTokens` overflow**
`settle/route.ts:50` — checks `actualTokens > 0` but doesn't validate it's an integer or reject non-numeric values. A drone could pass `actualTokens: Infinity` or `actualTokens: 1e308`.
Already has `Math.min(actualTokens, task.lockedNectar)` cap — so financial impact is bounded — but should validate type.

**Q-4 (LOW): Heartbeat body parsing swallows all JSON errors silently**
`heartbeat/route.ts:42` — `catch { // No body or invalid JSON — that's fine }` is too broad. Should distinguish "no body" (OK) from "malformed JSON" (worth logging).

**Q-5 (LOW): `lib/cache.ts` in-memory cache never invalidates on drone update**
If a drone's apiKey is revoked or drone is deleted, the cache returns stale auth for up to cache TTL. Minor security concern for revocation.

---

## Section 3: Test Review

### Framework

Vitest + @testing-library/react (bootstrapped this session). Config: `vitest.config.ts`.

### Step 1: Code Path Tracing — P1 Fixes

```
CODE PATH COVERAGE — P1 FIXES
===============================

[+] lib/rate-limit.ts
    │
    ├── checkRateLimit(agentId)
    │   ├── [GAP] Per-agent limit exceeded → {allowed:false} — NO TEST
    │   ├── [GAP] Global limit exceeded → {allowed:false} — NO TEST
    │   └── [GAP] Within limits → {allowed:true, remaining:N} — NO TEST
    │
    └── (wiring — authenticateAndRateLimit integration)
        └── [GAP] Route returns 429 when rate limited — NO TEST

[+] app/api/tasks/[id]/settle/route.ts
    │
    ├── status !== 'accepted' → 409
    │   └── [★★ TESTED partial] regression-1.test.ts covers state logic but
    │        not the actual route
    │
    ├── settleTask() [RACE CONDITION PATH]
    │   ├── [GAP] Concurrent settle → second should 409 — NO TEST
    │   └── [GAP] Nectar only transferred once on concurrent calls — NO TEST
    │
    ├── actualTokens > lockedNectar → capped at lockedNectar
    │   └── [GAP] Cap behavior untested — NO TEST
    │
    └── Settlement response structure
        └── [GAP] Response fields (earnedByWorker, refundedToPublisher) — NO TEST

[+] lib/nectar.ts
    │
    ├── lockNectar() → Prisma transaction
    │   ├── [GAP] Insufficient Nectar → throws — NO TEST
    │   └── [GAP] Happy path → balance decremented — NO TEST
    │
    ├── settleTask() → Prisma transaction
    │   ├── [GAP] Worker balance after settle — NO TEST
    │   ├── [GAP] Publisher refund when actualTokens < locked — NO TEST
    │   └── [GAP] No double-entry: settled task cannot be settled again — NO TEST
    │
    └── cancelWithCompensation()
        ├── [GAP] progress=0 → worker gets 0, publisher full refund — NO TEST
        └── [GAP] progress=0.5 → worker gets 50%, publisher 50% — NO TEST

[+] lib/auth.ts
    │
    ├── authenticateDrone() → happy path
    │   └── [GAP] Valid apiKey → AuthResult — NO TEST
    │
    └── authenticateAndRateLimit()
        ├── [GAP] Rate limited → {rateLimited: true} — NO TEST
        └── [GAP] Auth fails → {auth: null, rateLimited: false} — NO TEST

[+] Existing regression tests (2)
    │
    ├── [★★ TESTED] auth-guard.regression-1 — PUBLIC_PATHS includes /tasks
    └── [★★ TESTED] nectar.regression-1 — Login form guard logic

─────────────────────────────────────────────────────
COVERAGE: 2/18 paths tested (11%)
  Code paths: 0/16 new P1 paths (0%)
  Regression: 2/2 existing tests (100%)
QUALITY:  ★★: 2  ★: 0  ★★★: 0
GAPS: 16 new paths need tests
─────────────────────────────────────────────────────
```

### Required Test Additions (Priority Order)

**TEST-1 (CRITICAL): Settle idempotency**
```typescript
// __tests__/settle.regression-1.test.ts
describe('settle idempotency', () => {
  it('second concurrent settle returns 409 and does not double-charge Nectar', async () => {
    // Mock Prisma updateMany returning count=0 on second call
    // Assert: second call returns 409
    // Assert: settleTask called exactly once
  })
})
```

**TEST-2 (CRITICAL): Rate limiter wiring**
```typescript
// __tests__/rate-limit.regression-1.test.ts
describe('checkRateLimit', () => {
  it('allows requests within per-agent limit', () => {
    for (let i = 0; i < 30; i++) expect(checkRateLimit('agent-1').allowed).toBe(true)
  })
  it('blocks after per-agent limit exceeded', () => {
    // ... 30 allowed, 31st blocked
    expect(checkRateLimit('agent-1').allowed).toBe(false)
  })
  it('allows different agents independently', () => {
    // agent-2 not affected by agent-1 exhaustion
  })
})
```

**TEST-3: Nectar transaction correctness**
```typescript
// __tests__/nectar.test.ts
describe('settleTask', () => {
  it('transfers correct Nectar to worker', ...)
  it('refunds excess to publisher when actualTokens < locked', ...)
  it('caps payment at lockedNectar amount', ...)
})
describe('cancelWithCompensation', () => {
  it('worker gets 0 compensation at progress=0', ...)
  it('worker gets proportional compensation at progress=0.5', ...)
})
```

### Test Plan Artifact

Written to: `/home/node/.gstack/projects/wdz626968-AVEP-ModelToken/node-dev-kevin-eng-review-test-plan-20260323.md`

---

## Section 4: Performance Review

**PERF-1 (MEDIUM): `heartbeat/route.ts` makes 3-5 DB queries per call**
Heartbeat updates drone, fetches assignments, conditionally fetches tasks for auto-match, creates WorkerAssignment if matched. On Vercel with cold starts, each query adds ~50ms. Bundle into fewer queries or use `prisma.$transaction` for read-then-write in auto-match.

**PERF-2 (LOW): Auth cache is per-invocation (cold starts)**
`lib/cache.ts` LRU cache is in-memory. Each cold start re-reads all drone auth from DB.
For current scale (3 agents), this is acceptable. Flag for V0.6 if agent count grows.

**PERF-3 (LOW): NectarLedger grows unbounded**
No archival or pagination on ledger entries. At 100 tasks/month, grows ~400 rows/month. Fine for years. Not a concern until 10,000+ tasks.

---

## Failure Modes Registry

| Codepath | Failure Mode | Test? | Error Handling? | User Sees? | Status |
|----------|-------------|-------|-----------------|------------|--------|
| `settle` concurrent calls | Double Nectar charge | NO | NO | Silent duplicate | **CRITICAL GAP** |
| `checkRateLimit` | Not wired to routes | NO | N/A | No rate limiting | **CRITICAL GAP** |
| `lockNectar` insufficient balance | Throws in tx | NO | Yes (throws) | 500 error (unhandled) | WARNING |
| `settleTask` DB connection fails | Throws | NO | No retry | 500 error | WARNING |
| `heartbeat` auto-match concurrent | Double assignment | NO | No check | Both workers assigned | WARNING |
| `authenticateDrone` invalid token | Returns null → 401 | NO | Yes (401) | Correct error | OK |
| `cancel` on already-cancelled task | Status check | NO | Yes (409) | Correct error | OK |

**2 CRITICAL GAPS:** Both are the same root cause — missing wiring + missing atomicity.

---

## NOT in Scope

| Item | Rationale |
|------|-----------|
| Probe engine timeout fix | No outbound LLM calls from server — non-issue |
| Agent discovery page | Feature, not bug — V0.6 |
| Trust score display | Feature — V0.6 |
| heartbeat God function refactor | Maintenance, not correctness — V0.6 |
| Auth cache Redis migration | Performance, not correctness — V0.6 |
| Staging environment | Infrastructure — V0.7 |
| Full DID auth | Major refactor — V1.0 |

## What Already Exists

| Needed | Exists | Notes |
|--------|--------|-------|
| Nectar transaction logic | `lib/nectar.ts::settleTask` | Add atomic status update into this transaction |
| Rate limit check function | `lib/auth.ts::authenticateAndRateLimit` | Just wire it to routes |
| Auth middleware | `lib/auth.ts::authenticateDrone` | Replace with `authenticateAndRateLimit` in 4 routes |
| Task status validation | `settle/route.ts:29` | Move into DB-level WHERE clause |
| Prisma migrations | Schema exists, using `db push` | Run `prisma migrate dev --name init` to baseline |

---

## Corrected P1 Fix List

(Updated from CEO plan — CRITICAL-3 probe timeout removed as invalid)

| # | Fix | File(s) | Effort CC | Risk |
|---|-----|---------|-----------|------|
| P1-A | Wire rate limiter to routes | 4 route files | ~15 min | Low |
| P1-B | Atomic settle (status in transaction) | `settle/route.ts`, `lib/nectar.ts` | ~20 min | Medium |
| P1-C | Prisma migrate baseline | CLI commands + vercel.json | ~30 min | Medium |
| P1-D | Add TEST-1 + TEST-2 regression tests | `__tests__/` | ~20 min | Low |

---

## Diagrams

### Task State Machine (corrected — no "in_progress" status)

```
            ┌─────────┐
            │ pending │◄── POST /api/tasks (publisher)
            └────┬────┘
  accept() by    │         cancel() by publisher
  worker         │──────────────────────────────► ┌───────────┐
                 ▼                                │ cancelled │
          ┌──────────┐                            └───────────┘
          │ accepted │◄── POST /tasks/[id]/assign
          └─────┬────┘
   settle()     │         cancel() by publisher or worker
   (publisher)  │──────────────────────────────► ┌───────────┐
                ▼                                │ cancelled │
         ┌───────────┐                           └───────────┘
         │ completed │
         └───────────┘

  STATUS VALUES: "pending" | "accepted" | "completed" | "cancelled"
  NOTE: There is NO "in_progress" status in the actual implementation.
  The CEO plan document used "in_progress" — this was incorrect.
```

### Settle Flow (atomic fix)

```typescript
// BEFORE (race condition):
const task = await prisma.task.findUnique(...)    // Read
if (task.status !== 'accepted') return 409        // Check (non-atomic)
await settleTask(...)                              // Write Nectar
await prisma.task.update({ status: 'completed' }) // Write status (separate)

// AFTER (atomic):
await prisma.$transaction(async (tx) => {
  const updated = await tx.task.updateMany({
    where: { id: taskId, status: 'accepted' },    // Atomic check+write
    data: { status: 'completed', ... }
  })
  if (updated.count === 0) throw new ConflictError()
  // Pay worker, refund publisher...
})
```

---

## Completion Summary

```
+====================================================================+
|         ENG REVIEW — AVEP/HiveGrid V0.5 — 2026-03-23              |
+====================================================================+
| Step 0         | Scope accepted (3 fixes, ~4 files, EUREKA x2)    |
| Architecture   | 4 issues found (2 HIGH: rate limiter, settle)    |
| Code Quality   | 5 issues found (1 HIGH, 2 MED, 2 LOW)            |
| Test Review    | 16 gaps, 2 CRITICAL regression tests required    |
| Performance    | 3 issues (1 MED, 2 LOW)                           |
| NOT in scope   | 7 items                                           |
| What exists    | All fixes reuse existing code — no new abstractions|
| Failure modes  | 7 mapped, 2 CRITICAL GAPS                        |
| Outside voice  | Dispatching subagent                              |
| Critical gaps  | 2 (settle double-charge, rate limiter dead code) |
| Lake score     | 3/3 recommendations chose complete option         |
+====================================================================+
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_open | 10 proposals, 4 accepted, 6 deferred |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 12 issues, 2 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

**UNRESOLVED:** 0 decisions unresolved
**VERDICT:** ENG REVIEW COMPLETE — 2 critical gaps identified and documented, fixes specified. Implement P1-A through P1-D before shipping.
