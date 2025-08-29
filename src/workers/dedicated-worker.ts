// Dedicated worker that becomes active when promoted by the SharedWorker coordinator.
let tabId: string | null = null;

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
  result: { echo: string; tabId: string | null };
};

// Use WorkerGlobalScope to avoid depending on lib.dom type DedicatedWorkerGlobalScope
const ctx = self as unknown as Worker & {
  postMessage: (msg: unknown) => void;
  onmessage: (e: MessageEvent) => void;
};

ctx.onmessage = (e: MessageEvent<InboundMessage>) => {
  const m = e.data;
  if (m.type === "INIT") {
    tabId = m.tabId;
    ctx.postMessage({ type: "WORKER_READY", tabId } as WorkerReady);
  }

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
      ctx.postMessage({
        type: "QUERY_RESULT",
        requestId,
        fromTabId,
        result: { echo: sql, tabId },
      } as QueryResult);
    }, 20);
  }
};
