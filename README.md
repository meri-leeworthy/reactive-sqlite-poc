# Reactive SQLite poc

Testing a new frontend architecture for Roomy. Big ideas:

- Register Service Worker to receive push events
- Sync client in Service Worker receives a stream of events
- Service worker can queue incoming events in IDB if no tabs open
- Events are sent to Shared Worker running SQLite (wa-sqlite with OPFS VFS)
- Shared worker transforms each event into SQL transaction and applies
- Tabs running UI can subscribe to queries which are recomputed when data is updated
- Need to find way to optimise data recomputation for incremental updates - Timely/Differential Dataflow layer?

## Service Worker

It's worth noting that Sveltekit only bundles Service Workers in production, and in dev uses ES Modules. ES Modules in Service Workers, however, are not widely supported, which constrains us to using Chrome when using dev mode.

## Implementing WorkerManager

Yes, creating a `WorkerManager` abstraction makes perfect sense! This approach would provide a robust, environment-agnostic solution that gracefully degrades based on browser capabilities while maintaining a consistent API.

Here's a step-by-step plan to implement this:

## 1. **Create the WorkerManager Core Architecture**
- Design a `WorkerManager` class that acts as the main coordinator
- Implement environment detection to determine SharedWorker support
- Create a unified interface that abstracts away the worker type differences
- Add lifecycle management for worker initialization and cleanup

## 2. **Implement Service Worker Registration & Management**
- Create a `ServiceWorkerManager` class within the WorkerManager
- Handle Service Worker registration, updates, and lifecycle events
- Implement communication channels between the main thread and Service Worker
- Set up event listeners for sync client events and background tasks

## 3. **Build SharedWorker Implementation**
- Create a `SharedWorkerManager` for environments that support SharedWorkers
- Implement the SharedWorker script with wa-sqlite integration
- Set up message passing between main thread and SharedWorker
- Handle SharedWorker connection management and error recovery

## 4. **Create Dedicated Worker Fallback**
- Implement a `DedicatedWorkerManager` as the fallback option
- Ensure the same wa-sqlite module runs in the Dedicated Worker
- Maintain API compatibility with the SharedWorker implementation
- Handle worker spawning and message routing

## 5. **Design Unified Communication Protocol**
- Create a standardized message format that works across all worker types
- Implement request/response patterns for database operations
- Set up event broadcasting for real-time updates
- Handle connection state management and reconnection logic

## 6. **Implement Environment Detection & Auto-Selection**
- Detect browser capabilities (SharedWorker support, Service Worker support)
- Automatically select the best available worker strategy
- Provide manual override options for testing and debugging
- Log the selected strategy for debugging purposes

## 7. **Add Error Handling & Resilience**
- Implement graceful degradation when workers fail
- Add retry mechanisms for failed operations
- Handle worker crashes and automatic recovery
- Provide fallback to main-thread execution if all workers fail

## 8. **Create Configuration & Initialization System**
- Design a configuration object for worker settings
- Implement lazy initialization to defer worker creation until needed
- Add worker pooling for Dedicated Worker fallback scenarios
- Provide hooks for custom worker scripts and configurations

## 9. **Implement Testing & Debugging Tools**
- Create a debug mode that logs all worker communications
- Add worker health monitoring and status reporting
- Implement performance metrics for different worker strategies
- Provide tools to manually switch between worker types for testing

## 10. **Add Documentation & Examples**
- Document the WorkerManager API and configuration options
- Provide examples for different use cases and environments
- Create migration guides for existing wa-sqlite implementations
- Document the communication protocol and message formats

This approach gives you:
- **Environment flexibility**: Works everywhere with graceful degradation
- **Consistent API**: Same interface regardless of underlying worker type
- **Future-proofing**: Easy to add new worker strategies or update existing ones
- **Maintainability**: Clear separation of concerns and unified error handling
- **Performance**: Optimal worker type selection based on browser capabilities

The key insight is that by abstracting the worker management, you can ensure your sync client and database operations work consistently across all environments while taking advantage of SharedWorker benefits when available.


# SQL Schema Design

Good — I’ll give a tight, critical analysis with concrete schema patterns and trade-offs. I’ll assume the frontend will ingest ordered events (possibly out-of-order sometimes), apply them locally, and you want fast reads for timeline UI (channels/threads) while keeping a small, composable component model.

# 1 — High level design choices (trade-offs)

Keep these options in mind; pick one or mix patterns for different data:

**A. True ECS (Entity + many small component tables)**

* Pros: very modular, easy to add component types, compact joins for targeted reads.
* Cons: lots of joins for common operations (e.g. render a message + author + reactions), more schema churn, can degrade in SQLite if you join many tiny tables repeatedly.

**B. Read-model centric (events → projections / denormalised tables)**

* Pros: fast reads, simple SQL for UI, good for timelines.
* Cons: projection logic complexity and duplication; must keep projections deterministic and idempotent.

**C. Hybrid (components for modelling domain, plus denormalised read tables for hot paths)** — recommended for your app.

* Store canonical entity/component state (fine-grained) *and* maintain denormalised projection tables for timelines, search, and subscription lists.

# 2 — Sync & conflict rules (how events get applied)

* Treat the event stream as the source of truth. Store raw events with metadata (event\_id, stream\_seq, origin, wall\_clock, lamport/vector clock, causal\_deps). Make projections idempotent.
* Keep an `applied_events` log with a unique constraint on `event_id` so replays are safe.
* Prefer deterministic projection logic. For conflicts (concurrent edits), decide per type: LWW for simple fields, CRDT or three-way merge for docs, or surface conflicts to user for manual resolution.

# 3 — Materialisation strategy (how to go from events → SQLite)

* Keep two classes of tables:

  1. **Event storage**: append-only `events` table (source of truth locally).
  2. **Projections (read models)**: denormalised tables (e.g. `timeline_items`, `messages_view`) that are updated by applying events transactionally.

* Apply batches of events in single transactions to keep projections consistent. Use WAL mode and moderate page/cache settings for throughput.

# 4 — Representation of references

* Use a single global `entity.id` (TEXT or INTEGER depending on your ID scheme). Prefer `INTEGER PRIMARY KEY` if you control id generation locally (faster joins), otherwise use compact TEXT (e.g. ULID/KSUID).
* For polymorphic references, prefer one canonical approach: store `entity_id` + optional `entity_type` when you must, but for most internal joins only `entity_id` is required because components will indicate types.

# 5 — Performance guidelines for SQLite

* Use `WAL` journaling for concurrent reads/writes (`PRAGMA journal_mode=WAL`).
* Create indexes only where you need them (timeline\_id + order\_key desc, entity\_id, unread flags). Each index costs on writes.
* For frequently-read timelines, store a snapshot row (`timeline_items`) with enough denormalised fields to render the list without joins (author\_name, snippet, edited\_at, reaction\_counts). Lazy-load full message only on open.
* Use `FTS5` for full-text search on message content / documents. Keep FTS table updated by the same projection process.
* Avoid excessive small joins in the UI hot path — favour denormalisation.

# 6 — Concrete example schema (hybrid approach)

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

# 7 — Timeline semantics & queries

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

# 8 — When to normalise vs denormalise

* Normalise when:

  * You need to update many projections from a single component change.
  * Component is used in many contexts and size is small.
* Denormalise when:

  * Read path is hot (timelines), and you want single-row rendering.
  * You want to avoid N joins per timeline render.

# 9 — Search & document editing

* Use FTS5 virtual table for full text content and search ranking. Keep it in sync from projection layer.
* For collaborative documents, prefer operational transforms or CRDTs for conflict resolution. Store the authoritative document state as a component (e.g., `component_doc` JSON) and store document edit events in `events`. Projection applies CRDT merge to derive current state deterministically.

# 10 — Indexing & write cost

* Indexes that matter: `(timeline_id, order_key)`, `entity_id` on component tables, FTS index.
* Avoid indexing every column. Every extra index increases write latency during event application; choose indexes based on measured query patterns.

# 11 — Practical engineering checklist

* Make projection logic idempotent and test via replay.
* Store event metadata for debugging (origin, deps, clocks).
* Keep small denormalised fields in `timeline_items` to avoid joins.
* Batch apply events in transactions.
* Use WAL + tuned pragmas for browser SQLite (OPFS/wa-sqlite: tune `cache_size` etc).
* Provide a compact compacted snapshot export (if users want offline transfer), e.g. dump denormalised tables plus last-applied stream\_seq.

# 12 — Examples of choices for your three concerns

1. **Everything as ECS:** good for experimentation and “transformable data” UX. But for messages/timelines add read-model projection to avoid repeated joins.

2. **Distinguish timeline-targetable entities vs content blobs:** sensible. Let timelines reference entities, and treat content blobs as components. Use `entity.kind` to filter what can appear in timelines.

3. **Performance worries about indirection:** eliminate hot-path indirection by caching minimal renderable snapshot in timeline rows, and lazy-join for detail. That keeps ECS composability without UI cost.

---

If you want, I’ll:

* produce a slightly expanded SQL schema that includes `reactions` table, `memberships`, and example projection pseudo-code (idempotent apply function) — or
* sketch projection logic in TypeScript for a browser projection worker that applies events into SQLite transactionally.

Which of those is more useful next?

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
