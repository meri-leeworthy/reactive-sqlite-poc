# Reactive SQLite poc

Testing a new frontend architecture for Roomy. Big ideas:

- Register Service Worker to receive push events
- Sync client in Service Worker receives a stream of events
- Service worker can queue incoming events in IDB if no tabs open
- Dedicated Workers are spawned when a tab is opened and destroyed when a tab is closed
- Dedicated Workers run a SQLite database (OPFS SyncAccessHandle Pool VFS)
- Events are sent from Service Worker to Shared Worker which coordinates between Dedicated Workers
- Shared worker forwards queries to the active tab's Dedicated Worker
- Dedicated Worker transforms each event into SQL transaction and applies to DB
- Tabs running UI can subscribe to queries which are recomputed when data is updated
- Need to find way to optimise data recomputation for incremental updates - Timely/Differential Dataflow layer?

## Service Worker

It's worth noting that Sveltekit only bundles Service Workers in production, and in dev uses ES Modules. ES Modules in Service Workers, however, are not widely supported, which constrains us to using Chrome when using dev mode.

## SharedWorker coordinator (design, setup, and testing)

This project includes a minimal but production-leaning SharedWorker coordinator that ensures only one tab is active for database work, forwards queries from any tab to the active tab, and fails over when the active tab closes.

- **Coordinator**: `src/workers/shared-worker.ts`
- **Per-tab worker (mock DB)**: `src/workers/dedicated-worker.ts`
- **Main-thread wrapper**: `src/lib/workers/WorkerManager.ts`
- **Message contracts**: `src/lib/workers/messages.ts`
- **Integration tests**: `tests/sharedworker.spec.ts`

### How it works

- **Environment detection**
  - `WorkerManager` chooses `SharedWorker` when available and initialises one per-origin coordinator.
- **Registration & promotion**
  - Each page registers with the SharedWorker: `{ type: 'REGISTER_TAB', tabId }`.
  - If no active tab exists, the SharedWorker promotes one by sending `{ type: 'PROMOTE_TO_ACTIVE', tabId }` to that page.
  - The page forwards this to its per-tab Dedicated Worker which simulates opening the DB and replies `{ type: 'DB_OPENED', tabId }` back via the page to the SharedWorker.
- **Query routing**
  - Any tab sends `QUERY { tabId, requestId, sql }` to the SharedWorker.
  - The SharedWorker forwards `FORWARD_QUERY` to the active tab's page, which forwards it to that tab's Dedicated Worker.
  - The Dedicated Worker responds with `QUERY_RESULT { requestId, fromTabId, result }`.
  - The SharedWorker translates that into `{ type: 'QUERY_RESPONSE', requestId, result }` and posts it back to the origin tab.
- **Failover**
  - If the active tab is closed, the SharedWorker elects another connected tab and promotes it.
  - Pending queries retry with exponential backoff until an active, healthy tab is available.

### Test hooks (for Playwright and manual inspection)

To make integration tests deterministic, the app exposes a few globals after the app mounts (see `src/routes/+layout.svelte`):

- `window.__TAB_ID`: the current page's tab identifier (UUID)
- `window.__ACTIVE`: the coordinator's current active tab id (or `null`)
- `window.__sendQuery(sql, requestId)`: runs a query and resolves with `{ type: 'QUERY_RESPONSE', requestId, result }`

Example (in tests):

```ts
const res = await page.evaluate(
  ([sql, requestId]) => window.__sendQuery(sql, requestId),
  ["SELECT 1", "q1"]
);
// res.type === 'QUERY_RESPONSE'
```

### Running and testing

- Dev server: `pnpm dev` (SvelteKit on `http://127.0.0.1:5173`)
- Tests: `pnpm test` (Playwright starts/reuses the dev server per `playwright.config.ts`)

Notes:
- The Playwright config sets `reuseExistingServer: true`. If you already have a dev server on `127.0.0.1:5173`, tests will reuse it.
- If the port is in use by another project, either stop that server or change one of the ports.

### File overview

- `src/lib/workers/WorkerManager.ts`
  - Creates the SharedWorker and a per-tab Dedicated Worker
  - Forwards messages between SharedWorker and Dedicated Worker
  - Provides a small subscription API and `sendQuery(sql, requestId)`
- `src/workers/shared-worker.ts`
  - Tracks connected tabs, elects an active tab, forwards queries, handles retries
  - Translates `QUERY_RESULT` (from Dedicated Worker) into `QUERY_RESPONSE` (to page)
- `src/workers/dedicated-worker.ts`
  - Mock of DB worker for tests: opens on promotion and echoes queries after a short delay
- `tests/sharedworker.spec.ts`
  - Verifies page bootstrap, message flow, single-tab query, multi-tab forwarding, and failover

### Troubleshooting

- "Port 5173 is already in use"
  - Stop any other Vite dev server, or change the port in either project. Playwright will attempt to reuse an existing server if compatible.
- Tests hang awaiting `__sendQuery`
  - Ensure the page fully mounted (tests wait for `__TAB_ID` before issuing queries).
  - Check devtools logs: the app logs `ACTIVE_CHANGED`, `PROMOTE_TO_ACTIVE`, and query routing steps.
- SharedWorker not supported
  - `WorkerManager` detects environment; if you need a non-SharedWorker fallback, extend it to use a dedicated worker-only mode.

### Extending to a real SQLite worker later

Replace the mock logic in `src/workers/dedicated-worker.ts` with your WASM SQLite integration. Keep the wire protocol the same:

- On promotion, open the OPFS connection and emit `DB_OPENED`.
- On `FORWARD_QUERY`, execute and respond with `QUERY_RESULT { requestId, fromTabId, result }` (or `QUERY_ERROR`).
- The SharedWorker will keep translating results into `QUERY_RESPONSE` for pages and handle failover.

## SQL Schema Design

Good — I’ll give a tight, critical analysis with concrete schema patterns and trade-offs. I’ll assume the frontend will ingest ordered events (possibly out-of-order sometimes), apply them locally, and you want fast reads for timeline UI (channels/threads) while keeping a small, composable component model.

### 1 — High level design choices (trade-offs)

Keep these options in mind; pick one or mix patterns for different data:

**A. True ECS (Entity + many small component tables)**

* Pros: very modular, easy to add component types, compact joins for targeted reads.
* Cons: lots of joins for common operations (e.g. render a message + author + reactions), more schema churn, can degrade in SQLite if you join many tiny tables repeatedly.

**B. Read-model centric (events → projections / denormalised tables)**

* Pros: fast reads, simple SQL for UI, good for timelines.
* Cons: projection logic complexity and duplication; must keep projections deterministic and idempotent.

**C. Hybrid (components for modelling domain, plus denormalised read tables for hot paths)** — recommended for your app.

* Store canonical entity/component state (fine-grained) *and* maintain denormalised projection tables for timelines, search, and subscription lists.

### 2 — Sync & conflict rules (how events get applied)

* Treat the event stream as the source of truth. Store raw events with metadata (event\_id, stream\_seq, origin, wall\_clock, lamport/vector clock, causal\_deps). Make projections idempotent.
* Keep an `applied_events` log with a unique constraint on `event_id` so replays are safe.
* Prefer deterministic projection logic. For conflicts (concurrent edits), decide per type: LWW for simple fields, CRDT or three-way merge for docs, or surface conflicts to user for manual resolution.

### 3 — Materialisation strategy (how to go from events → SQLite)

* Keep two classes of tables:

  1. **Event storage**: append-only `events` table (source of truth locally).
  2. **Projections (read models)**: denormalised tables (e.g. `timeline_items`, `messages_view`) that are updated by applying events transactionally.

* Apply batches of events in single transactions to keep projections consistent. Use WAL mode and moderate page/cache settings for throughput.

### 4 — Representation of references

* Use a single global `entity.id` (TEXT or INTEGER depending on your ID scheme). Prefer `INTEGER PRIMARY KEY` if you control id generation locally (faster joins), otherwise use compact TEXT (e.g. ULID/KSUID).
* For polymorphic references, prefer one canonical approach: store `entity_id` + optional `entity_type` when you must, but for most internal joins only `entity_id` is required because components will indicate types.

### 5 — Performance guidelines for SQLite

* Use `WAL` journaling for concurrent reads/writes (`PRAGMA journal_mode=WAL`).
* Create indexes only where you need them (timeline\_id + order\_key desc, entity\_id, unread flags). Each index costs on writes.
* For frequently-read timelines, store a snapshot row (`timeline_items`) with enough denormalised fields to render the list without joins (author\_name, snippet, edited\_at, reaction\_counts). Lazy-load full message only on open.
* Use `FTS5` for full-text search on message content / documents. Keep FTS table updated by the same projection process.
* Avoid excessive small joins in the UI hot path — favour denormalisation.

### 6 — Concrete example schema (hybrid approach)

Below is a compact starting point. Adjust types (INTEGER vs TEXT IDs) to your ID system.

```sql
-- canonical entities
CREATE TABLE entities (
  id TEXT PRIMARY KEY,           -- global entity id, e.g. "msg:ulid..." or plain UUID
  kind TEXT NOT NULL,            -- "user", "message", "document", "channel", etc.
  created_at INTEGER NOT NULL    -- unix ms
);

-- raw event log (append-only)
CREATE TABLE events (
  event_id TEXT PRIMARY KEY,     -- unique event id (ULID/UUID)
  stream_seq INTEGER,            -- monotonic stream seq (null if not assigned)
  origin TEXT,                   -- server/client origin
  created_at INTEGER NOT NULL,
  event_type TEXT NOT NULL,      -- "create", "edit", "react", "delete", "membership", ...
  target_entity_id TEXT,         -- the primary entity affected (nullable)
  timeline_id TEXT,              -- optional timeline target
  payload TEXT NOT NULL,         -- JSON payload (use JSON1)
  meta TEXT,                     -- JSON metadata (lamport/vector deps etc)
  applied_at INTEGER             -- when local projection applied; null until applied
);

CREATE UNIQUE INDEX idx_events_stream ON events(stream_seq);

-- component-style tables for canonical state (only store frequently-read small components)
CREATE TABLE component_text (
  entity_id TEXT PRIMARY KEY,
  body TEXT,
  excerpt TEXT,
  updated_at INTEGER
);

CREATE TABLE component_author (
  entity_id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  created_at INTEGER
);

-- timeline read-model (denormalised, fast reads)
CREATE TABLE timeline_items (
  id TEXT PRIMARY KEY,              -- either same as entity_id for messages, or synthetic
  timeline_id TEXT NOT NULL,
  order_key INTEGER NOT NULL,       -- monotonic ordering key (server seq, lamport, created_at)
  entity_id TEXT,                   -- referenced entity
  entity_kind TEXT,
  author_id TEXT,
  snippet TEXT,                     -- short content for list rendering
  full_content_cached INTEGER,      -- boolean: 0/1
  edited_at INTEGER,
  deleted INTEGER DEFAULT 0,
  reactions JSON,                   -- small summary e.g. {"👍":3,"❤️":1}
  pinned INTEGER DEFAULT 0
);

CREATE INDEX idx_timeline_order ON timeline_items(timeline_id, order_key DESC);

-- applied events tracking (idempotency + debugging)
CREATE TABLE applied_events (
  event_id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  batch_id TEXT
);
```

Notes:

* `events.payload` is JSON; projection logic extracts fields and writes to `timeline_items` and component tables.
* `order_key` can be server sequence if available; if not, a composite of (lamport, origin\_id) or monotonic counter per timeline.

### 7 — Timeline semantics & queries

* When ingesting `create_message`:

  * insert event into `events`.
  * projection: insert into `entities`, `component_text`, `component_author`, then insert `timeline_items` with denormalised snippet and `order_key = stream_seq` or `created_at`.
* For `edit_message`:

  * update `component_text`, update `timeline_items.snippet` and `edited_at`.
* For `react`:

  * update `timeline_items.reactions` summary and optionally a detailed `reactions` table if you need per-user reactions.

Example fast read for recent messages in a channel:

```sql
SELECT id, author_id, snippet, reactions, edited_at
FROM timeline_items
WHERE timeline_id = ?
  AND deleted = 0
ORDER BY order_key DESC
LIMIT 50;
```

This returns UI-ready rows without joins.

### 8 — When to normalise vs denormalise

* Normalise when:

  * You need to update many projections from a single component change.
  * Component is used in many contexts and size is small.
* Denormalise when:

  * Read path is hot (timelines), and you want single-row rendering.
  * You want to avoid N joins per timeline render.

### 9 — Search & document editing

* Use FTS5 virtual table for full text content and search ranking. Keep it in sync from projection layer.
* For collaborative documents, prefer operational transforms or CRDTs for conflict resolution. Store the authoritative document state as a component (e.g., `component_doc` JSON) and store document edit events in `events`. Projection applies CRDT merge to derive current state deterministically.

### 10 — Indexing & write cost

* Indexes that matter: `(timeline_id, order_key)`, `entity_id` on component tables, FTS index.
* Avoid indexing every column. Every extra index increases write latency during event application; choose indexes based on measured query patterns.

### 11 — Practical engineering checklist

* Make projection logic idempotent and test via replay.
* Store event metadata for debugging (origin, deps, clocks).
* Keep small denormalised fields in `timeline_items` to avoid joins.
* Batch apply events in transactions.
* Use WAL + tuned pragmas for browser SQLite (OPFS/wa-sqlite: tune `cache_size` etc).
* Provide a compact compacted snapshot export (if users want offline transfer), e.g. dump denormalised tables plus last-applied stream\_seq.

### 12 — Examples of choices for your three concerns

1. **Everything as ECS:** good for experimentation and “transformable data” UX. But for messages/timelines add read-model projection to avoid repeated joins.

2. **Distinguish timeline-targetable entities vs content blobs:** sensible. Let timelines reference entities, and treat content blobs as components. Use `entity.kind` to filter what can appear in timelines.

3. **Performance worries about indirection:** eliminate hot-path indirection by caching minimal renderable snapshot in timeline rows, and lazy-join for detail. That keeps ECS composability without UI cost.

---

Potential next steps:

* produce a slightly expanded SQL schema that includes `reactions` table, `memberships`, and example projection pseudo-code (idempotent apply function) — or
* sketch projection logic in TypeScript for a browser projection worker that applies events into SQLite transactionally.



## Reproducing the Notion approach

### Quick take
- You’ve reproduced the high‑level “SharedWorker coordinator + per‑tab worker + single active tab for DB work” pattern reasonably well.
- The core Notion specifics (Web Locks for liveness, WASM SQLite on OPFS SAH Pool, async loading, true SQL execution + persistence) are not implemented yet.

### What matches the article
- SharedWorker coordinator that elects a single active tab and forwards queries
  - Evidence:
```147:158:src/workers/shared-worker.ts
function promoteTab(tabId: TabId) {
  setTimeout(() => {
    if (!connections.has(tabId)) return;
    setActive(tabId);
    const conn = connections.get(tabId)!;
    conn.port.postMessage({
      type: "PROMOTE_TO_ACTIVE",
      tabId,
    } as PromoteToActiveMsg);
  }, PROMOTION_GRACE_MS);
}
```
- Query routing from any tab to the active tab with retries/backoff and failover
```178:201:src/workers/shared-worker.ts
function enqueueQuery(originTabId: TabId, requestId: string, sql: string, params?: unknown) {
  const now = Date.now();
  const pq: PendingQuery = { originTabId, requestId, sql, params, attempts: 0, nextRetryMs: 0, enqueuedAt: now };
  pendingQueries.set(requestId, pq);
  scheduleQueryAttempt(pq);
}
```
- Per‑tab dedicated worker that opens when promoted and answers forwarded queries (currently mocked)
```37:55:src/workers/dedicated-worker.ts
if (m.type === "PROMOTE_TO_ACTIVE") {
  if (m.tabId === tabId) {
    setTimeout(() => {
      ctx.postMessage({ type: "DB_OPENED", tabId } as DbOpened);
    }, 20);
  }
}
if (m.type === "FORWARD_QUERY") {
  const { requestId, fromTabId, sql } = m;
  setTimeout(() => {
    ctx.postMessage({ type: "QUERY_RESULT", requestId, fromTabId, result: { echo: sql, tabId } });
  }, 20);
}
```

### What’s missing or diverges from the article

- Web Locks are not used (article’s “infinite Web Lock per tab” liveness)
  - You have lock message types in the coordinator but nothing acquires and maintains real Web Locks in the page, nor sends those messages.
```18:25:src/workers/shared-worker.ts
interface LockHeldMsg extends BaseMsg { type: "LOCK_HELD"; tabId: TabId; }
interface LockReleasedMsg extends BaseMsg { type: "LOCK_RELEASED"; tabId: TabId; }
```
```365:381:src/workers/shared-worker.ts
case "LOCK_HELD": { ... }
case "LOCK_RELEASED": { ... }
```
  - Current liveness relies on beforeunload + heartbeats; no `navigator.locks.request(...)` anywhere.

- No WASM SQLite/OPFS integration (the essence of the piece)
  - Dependency is present but unused.
```60:64:package.json
"dependencies": {
  "@sqlite.org/sqlite-wasm": "3.50.4-build1",
  "vite-plugin-arraybuffer": "^0.1.0",
  "vite-plugin-top-level-await": "^1.6.0",
  "vite-plugin-wasm": "^3.5.0"
}
```
  - Worker logic is a placeholder; per‑tab worker just echoes.
```1:3:src/workers/worker-logic.ts
// Intentionally left as a placeholder. The wa-sqlite implementation has been removed.
```

- No OPFS SAH Pool VFS selection or single-writer constraints (the key concurrency fix)
  - The active‑tab routing exists, but the DB isn’t actually opened via `opfs-sahpool` and isn’t persisted.

- Heartbeat pongs aren’t wired from the page
  - Coordinator sends HEARTBEAT, but nothing replies with HEARTBEAT_PONG. This is weaker than the article’s Web Lock approach and could cause spurious failovers.
```291:316:src/workers/shared-worker.ts
conn.port.postMessage({ type: "HEARTBEAT" });
// expects HEARTBEAT_PONG, but WorkerManager/page never respond
```

- No async, non‑blocking loading of the SQLite WASM bundle (article’s perf mitigation)
  - There’s no lazy import/init path in `dedicated-worker.ts` for SQLite.

- No “race network vs cache” behavior for slow devices (article mitigation)
  - Tests indicate intent to validate DDL/DML and persistence, but current implementation can’t pass them (as your test artifacts show).

- No fallback when SharedWorker is unavailable
  - Manager detects SharedWorker, but if absent, it does not fall back to a dedicated‑only mode.
```29:35:src/lib/workers/WorkerManager.ts
if (typeof SharedWorker !== "undefined") { this.workerKind = "shared"; } else { this.workerKind = "none"; }
```

### Concrete gaps to close (in priority order)
- Implement real Web Locks on the page:
  - Acquire a never‑resolving lock on mount; send `LOCK_HELD`/`LOCK_RELEASED` to the coordinator.
- Wire SQLite WASM (opfs-sahpool) inside `src/workers/dedicated-worker.ts`:
  - On PROMOTE_TO_ACTIVE, open DB via SAH Pool; on FORWARD_QUERY, run SQL and return real results.
  - Load the WASM module asynchronously to avoid blocking page load.
- Add heartbeat pong from the page (or drop heartbeat entirely once Web Locks are in place).
- Enable persistence tests by actually using OPFS-backed VFS.
- Add a dedicated‑only fallback if SharedWorker is unavailable.

### Bottom line
- Core coordinator/forwarder shape matches the article.
- The critical pieces that made it robust and fast at Notion (Web Locks liveness, WASM SQLite on OPFS SAH Pool, async load, true SQL/persistence, device-sensitive behavior) are not yet implemented, so the current code is an architectural scaffold rather than a faithful reproduction.

- Summary:
  - Implement Web Locks and SQLite WASM (OPFS SAH Pool) in the dedicated worker.
  - Reply to HEARTBEAT or remove it after Web Locks.
  - Load WASM async and consider “race network vs cache” later.
  - Then your integration tests should pass and the setup will align closely with the Notion approach.