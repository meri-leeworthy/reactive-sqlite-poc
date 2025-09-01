// Dedicated worker that becomes active when promoted by the SharedWorker coordinator.
import {
  initializeDatabase,
  executeQuery,
  isDatabaseReady,
} from "./worker-logic";

let tabId: string | null = null;
let dbInitStarted = false;
let dbInitPromise: Promise<void> | null = null;

type Pending = { requestId: string; fromTabId: string; sql: string };
const pending: Pending[] = [];

type InitMessage = { type: "INIT"; tabId: string };
type PromoteMessage = { type: "PROMOTE_TO_ACTIVE"; tabId: string };
type ForwardQueryMessage = {
  type: "FORWARD_QUERY";
  requestId: string;
  fromTabId: string;
  sql: string;
};

type InboundMessage = InitMessage | PromoteMessage | ForwardQueryMessage;

type WorkerReady = { type: "WORKER_READY"; tabId: string | null };
type DbOpened = { type: "DB_OPENED"; tabId: string | null };
type QueryResult = {
  type: "QUERY_RESULT";
  requestId: string;
  fromTabId: string;
  result: unknown;
};
type QueryError = {
  type: "QUERY_ERROR";
  requestId: string;
  fromTabId?: string;
  error: string;
};

// Use WorkerGlobalScope to avoid depending on lib.dom type DedicatedWorkerGlobalScope
const ctx = self as unknown as Worker & {
  postMessage: (msg: unknown) => void;
  onmessage: (e: MessageEvent) => void;
};

async function ensureDbInitialized(): Promise<void> {
  if (isDatabaseReady()) return;
  if (dbInitPromise) return dbInitPromise;
  dbInitStarted = true;
  dbInitPromise = initializeDatabase().catch((e) => {
    dbInitStarted = false;
    dbInitPromise = null;
    throw e;
  });
  await dbInitPromise;
}

async function flushPending() {
  if (!isDatabaseReady()) return;
  while (pending.length) {
    const { requestId, fromTabId, sql } = pending.shift()!;
    try {
      const result = await executeQuery(sql);
      ctx.postMessage({
        type: "QUERY_RESULT",
        requestId,
        fromTabId,
        result,
      } as QueryResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.postMessage({
        type: "QUERY_ERROR",
        requestId,
        fromTabId,
        error: message,
      } as QueryError);
    }
  }
}

ctx.onmessage = (e: MessageEvent<InboundMessage>) => {
  const m = e.data;
  if (m.type === "INIT") {
    tabId = m.tabId;
    ctx.postMessage({ type: "WORKER_READY", tabId } as WorkerReady);
  }

  if (m.type === "PROMOTE_TO_ACTIVE") {
    if (m.tabId === tabId) {
      // Start DB init on promotion; announce when opened
      ensureDbInitialized()
        .then(() => {
          ctx.postMessage({ type: "DB_OPENED", tabId } as DbOpened);
          flushPending();
        })
        .catch((err) => {
          // If init fails, pending queries will error when attempted later
          ctx.postMessage({
            type: "QUERY_ERROR",
            requestId: "__init__",
            error: String(err),
          } as QueryError);
        });
    }
  }

  if (m.type === "FORWARD_QUERY") {
    const { requestId, fromTabId, sql } = m;
    if (!isDatabaseReady()) {
      // Ensure initialization is started (in case a forward arrives before promotion completes)
      if (!dbInitStarted) {
        ensureDbInitialized()
          .then(() => {
            ctx.postMessage({ type: "DB_OPENED", tabId } as DbOpened);
            flushPending();
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            ctx.postMessage({
              type: "QUERY_ERROR",
              requestId,
              fromTabId,
              error: message,
            } as QueryError);
          });
      }
      pending.push({ requestId, fromTabId, sql });
      return;
    }
    executeQuery(sql)
      .then((result) => {
        ctx.postMessage({
          type: "QUERY_RESULT",
          requestId,
          fromTabId,
          result,
        } as QueryResult);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        ctx.postMessage({
          type: "QUERY_ERROR",
          requestId,
          fromTabId,
          error: message,
        } as QueryError);
      });
  }
};
