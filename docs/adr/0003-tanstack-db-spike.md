# Phase 6 spike: TanStack DB over session summaries

Date: 2026-06-23
Branch: `spike/tanstack-db-sessions` (NOT merged to main)
Packages: `@tanstack/react-db` 0.1.87 (+ transitive `@tanstack/db` 0.6.9),
`@tanstack/query-db-collection` 1.0.41

This is the isolation spike the handoff (Phase 6) asks for. It wraps the
*existing* session-summary server functions in a TanStack DB collection and
answers the five required questions from real running code + tests, then gives a
go/no-go recommendation. Nothing here is wired into the app.

## What was built

- `src/client/lib/sessions-collection.ts` — `createSessionsCollection(queryClient,
  userId)` (a Query-backed collection whose `queryFn` **is** the existing
  `listSessions` server-fn adapter, keyed `["sessions", userId]`, `getKey` =
  `id`), plus `createRenameSessionAction(collection)` (a `createOptimisticAction`
  for optimistic title rename + refetch).
- `src/client/hooks/use-db-sessions.ts` — a `useLiveQuery`-based session-list
  hook for the Q2 side-by-side comparison. **Not wired into the app.**
- `test/sessions-collection-spike.test.ts` — 4 passing tests that prove Q1, Q3,
  Q4, and source-of-truth behavior against the real `@tanstack/db` +
  `@tanstack/query-db-collection` code (session server fns mocked).

Run: `CI=true pnpm exec vitest run test/sessions-collection-spike.test.ts` →
4 passed. Full suite: 267 passed. `pnpm typecheck:tsc` clean.

## Answers to the spike questions

### Q1 — Can a DB collection wrap the existing server functions without changing D1 schema?

**Yes.** `queryCollectionOptions` takes a `queryFn` that IS the existing
`listSessions` adapter, plus the same `["sessions", userId]` query key the
TanStack Query hook already uses. No D1 schema change, no new endpoint. The
collection and the existing Query hook even share one cache entry. Test
`Q1: wraps existing server fns` asserts `listSessions` is called exactly once to
populate the store and the rows match.

### Q2 — Does `useLiveQuery` simplify the session list or make it harder to follow?

**Marginally simpler for the list read; not simpler overall.** The list read
itself drops ~2 lines (one hook call returns `data` + `isLoading`, no `.data ??
[]`). But `useTutorSessions`'s real complexity is the imperative orchestration
around the list: active-session selection, hydrate-on-switch, create-if-empty,
the per-user reset effect, and switching flags. None of that maps onto a
collection read. So DB would coexist with the existing orchestration rather than
replace it — net simplification is small. (See the side-by-side in
`use-db-sessions.ts`.)

### Q3 — Can optimistic session title updates be represented cleanly?

**Yes.** `createOptimisticAction({ onMutate, mutationFn })` applies the new title
locally via `collection.utils.writeUpdate` synchronously (test
`Q3: optimistic title rename applies immediately` asserts the value is already
renamed before the round-trip resolves), then `mutationFn` writes to the server
and `await collection.utils.refetch()` re-syncs. The optimistic write is
discarded in favor of the server value on return. This is clean and readable.

### Q4 — What is the rollback story if a server mutation fails?

**Workable, but with a sharp edge.** When `mutationFn` throws, the returned
Transaction **does NOT reject** and **does NOT transition to `failed`** in this
version — it resolves with `state === 'completed'` (test `Q4` pins this). So
errors are not surfaced through the promise/transaction state. The optimistic
value is only corrected by the server: `collection.utils.refetch()` reasserts the
real value (the source-of-truth test confirms a local-only write is overwritten
by refetch). This means the caller must **catch the mutation error itself** and
trigger a refetch; relying on the transaction to report failure would silently
hide errors. That is acceptable but worth knowing before adopting.

### Q5 — Does it reduce code in `use-tutor-sessions.ts` or just move complexity?

**It moves complexity more than it removes it.** The ~6-line list read would
shrink slightly, but you'd add: a collection factory, a `useLiveQuery` wiring, an
optimistic-action definition, and (because of Q4) explicit error-handling +
refetch glue that the current `useMutation({ onSuccess: setQueryData })` already
does implicitly and concisely. For a list that is already well-served by
`useQuery` + a `useMutation` that patches the cache, DB adds a second mental
model (collections, transactions, optimistic actions) on top of the Query one the
app already uses everywhere. The session list does not have the local-first
mutate-heavy workload that would make DB's optimistic model pay off.

## Recommendation: DO NOT ADOPT YET

- The only real win is optimistic rename UX (Q3), and the existing `useMutation`
  can already give that by patching the Query cache optimistically (the current
  `updateSessionAsync` already does `setQueryData` on success; an optimistic
  `onMutate` is a ~5-line addition).
- The rollback story (Q4) has a sharp edge (no transaction failure surfacing) that
  means error handling must be hand-written anyway.
- It adds a second state model (DB collections/transactions) alongside the Query
  model the whole app already uses, for a list that isn't the bottleneck.
- `@tanstack/react-db` is 0.1.87 (alpha); the transitive `@tanstack/db` resolved
  to 0.6.9, not a stable line.

This matches the handoff's own stop conditions: "If the only win is 'more
TanStack', do not adopt" and "If it fights TanStack Query instead of
complementing it, do not adopt." (It does complement Query via the shared
queryClient — but not enough to justify the extra model here.)

## Revisit when

- A genuinely local-first, mutate-heavy surface arrives (e.g. collaborative
  editing of steps, offline drafts) where optimistic mutations + automatic
  conflict resolution would clearly beat hand-rolled cache patching.
- `@tanstack/react-db` stabilizes past 0.x and the transaction failure contract
  (Q4) is fixed.
