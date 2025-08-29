// SharedWorker Coordinator
// Ported from sw-coordinator-test/test-server/shared-worker.ts (TypeScript)

type TabId = string;

interface BaseMsg {
  type: string;
}

interface RegisterTabMsg extends BaseMsg {
  type: "REGISTER_TAB";
  tabId: TabId;
}
interface UnregisterTabMsg extends BaseMsg {
  type: "UNREGISTER_TAB";
  tabId: TabId;
}
interface LockHeldMsg extends BaseMsg {
  type: "LOCK_HELD";
  tabId: TabId;
}
interface LockReleasedMsg extends BaseMsg {
  type: "LOCK_RELEASED";
  tabId: TabId;
}
interface QueryMsg extends BaseMsg {
  type: "QUERY";
  tabId: TabId;
  requestId: string;
  sql: string;
  params?: unknown;
}
interface ForwardQueryMsg extends BaseMsg {
  type: "FORWARD_QUERY";
  requestId: string;
  fromTabId: TabId;
  sql: string;
  params?: unknown;
}
interface QueryResultMsg extends BaseMsg {
  type: "QUERY_RESULT";
  requestId: string;
  fromTabId: TabId;
  result: unknown;
}
interface QueryErrorMsg extends BaseMsg {
  type: "QUERY_ERROR";
  requestId: string;
  fromTabId?: TabId;
  error: string;
}
interface PromoteToActiveMsg extends BaseMsg {
  type: "PROMOTE_TO_ACTIVE";
  tabId: TabId;
}
interface DBOpenedMsg extends BaseMsg {
  type: "DB_OPENED";
  tabId: TabId;
}
interface HeartbeatMsg extends BaseMsg {
  type: "HEARTBEAT";
}
interface HeartbeatPongMsg extends BaseMsg {
  type: "HEARTBEAT_PONG";
  tabId: TabId;
}

type IncomingMsg =
  | RegisterTabMsg
  | UnregisterTabMsg
  | LockHeldMsg
  | LockReleasedMsg
  | QueryMsg
  | QueryResultMsg
  | QueryErrorMsg
  | DBOpenedMsg
  | HeartbeatPongMsg
  | BaseMsg;

interface Connection {
  port: MessagePort;
  tabId: TabId;
  lastSeen: number;
  metrics?: Record<string, unknown>;
}

interface PendingQuery {
  originTabId: TabId;
  requestId: string;
  sql: string;
  params?: unknown;
  attempts: number;
  nextRetryMs: number;
  enqueuedAt: number;
  resolvePort?: MessagePort;
}

const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 3000;
const QUERY_BASE_BACKOFF_MS = 50;
const QUERY_MAX_RETRIES = 6;
const PROMOTION_GRACE_MS = 200;

const connections = new Map<TabId, Connection>();
let activeTabId: TabId | null = null;
let dbOpenedBy: TabId | null = null;

const pendingQueries = new Map<string, PendingQuery>();

const metrics = {
  connectedTabs: 0,
  forwardedQueries: 0,
  failovers: 0,
};

function log(
  level: "info" | "warn" | "error" | "debug",
  msg: string,
  meta?: Record<string, unknown>,
) {
  const out = { ts: new Date().toISOString(), level, msg, meta };
  console.log(JSON.stringify(out));
}

function broadcast(message: BaseMsg) {
  for (const [, conn] of connections) {
    conn.port.postMessage(message);
  }
}

function pickNextActive(exclude?: TabId | null): TabId | null {
  for (const [tabId] of connections) {
    if (tabId === exclude) continue;
    return tabId;
  }
  return null;
}

function setActive(tabId: TabId | null) {
  if (activeTabId === tabId) return;
  activeTabId = tabId;
  metrics.connectedTabs = connections.size;
  log("info", "active_changed", { activeTabId, connected: connections.size });
  broadcast({ type: "ACTIVE_CHANGED", activeTabId } as BaseMsg);
}

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

function forwardQueryToActive(pq: PendingQuery) {
  if (!activeTabId) {
    throw new Error("no-active");
  }
  const activeConn = connections.get(activeTabId);
  if (!activeConn) throw new Error("active-not-connected");

  const msg: ForwardQueryMsg = {
    type: "FORWARD_QUERY",
    requestId: pq.requestId,
    fromTabId: pq.originTabId,
    sql: pq.sql,
    params: pq.params,
  };

  metrics.forwardedQueries++;
  activeConn.port.postMessage(msg);
}

function enqueueQuery(
  originTabId: TabId,
  requestId: string,
  sql: string,
  params?: unknown,
) {
  const now = Date.now();
  const pq: PendingQuery = {
    originTabId,
    requestId,
    sql,
    params,
    attempts: 0,
    nextRetryMs: 0,
    enqueuedAt: now,
  };
  pendingQueries.set(requestId, pq);
  log("debug", "enqueued_query", {
    requestId,
    originTabId,
    activeTabId,
    dbOpenedBy,
  });
  scheduleQueryAttempt(pq);
}

function scheduleQueryAttempt(pq: PendingQuery) {
  pq.attempts++;
  log("debug", "scheduling_query_attempt", {
    requestId: pq.requestId,
    attempts: pq.attempts,
    maxRetries: QUERY_MAX_RETRIES,
  });

  if (pq.attempts > QUERY_MAX_RETRIES) {
    const originConn = connections.get(pq.originTabId);
    if (originConn)
      originConn.port.postMessage({
        type: "QUERY_ERROR",
        requestId: pq.requestId,
        error: "max_retries_exhausted",
      } as QueryErrorMsg);
    pendingQueries.delete(pq.requestId);
    log("warn", "query_max_retries_exhausted", {
      requestId: pq.requestId,
      origin: pq.originTabId,
    });
    return;
  }

  const backoff = QUERY_BASE_BACKOFF_MS * Math.pow(2, pq.attempts - 1);
  pq.nextRetryMs = backoff;
  log("debug", "query_attempt_scheduled", {
    requestId: pq.requestId,
    attempts: pq.attempts,
    backoff,
    nextRetryMs: pq.nextRetryMs,
  });

  setTimeout(() => {
    log("debug", "attempting_query_forward", {
      requestId: pq.requestId,
      activeTabId,
      dbOpenedBy,
      hasActive: !!activeTabId,
      hasConnection: activeTabId ? connections.has(activeTabId) : false,
    });

    if (
      activeTabId &&
      connections.has(activeTabId) &&
      activeTabId === dbOpenedBy
    ) {
      try {
        log("debug", "forwarding_to_active", {
          requestId: pq.requestId,
          activeTabId,
        });
        forwardQueryToActive(pq);
      } catch (err) {
        log("warn", "forward_failed", {
          err: String(err),
          requestId: pq.requestId,
        });
        scheduleQueryAttempt(pq);
      }
    } else if (activeTabId && connections.has(activeTabId) && !dbOpenedBy) {
      log("debug", "forwarding_to_active_no_db", {
        requestId: pq.requestId,
        activeTabId,
      });
      try {
        forwardQueryToActive(pq);
      } catch {
        scheduleQueryAttempt(pq);
      }
    } else {
      log("debug", "no_active_electing", {
        requestId: pq.requestId,
        originTabId: pq.originTabId,
        hasOrigin: connections.has(pq.originTabId),
      });
      if (connections.has(pq.originTabId)) {
        promoteTab(pq.originTabId);
      } else {
        const next = pickNextActive(null);
        if (next) promoteTab(next);
      }
      scheduleQueryAttempt(pq);
    }
  }, pq.nextRetryMs);
}

setInterval(() => {
  if (!activeTabId) return;
  const conn = connections.get(activeTabId);
  if (!conn) {
    log("warn", "active_missing_connection", { activeTabId });
    metrics.failovers++;
    const next = pickNextActive(activeTabId);
    setActive(next);
    if (next) promoteTab(next);
    return;
  }
  try {
    conn.port.postMessage({ type: "HEARTBEAT" } as HeartbeatMsg);
  } catch (e) {
    log("warn", "heartbeat_send_failed", { err: String(e), activeTabId });
  }

  const since = Date.now() - (conn.lastSeen || 0);
  if (since > HEARTBEAT_TIMEOUT_MS) {
    log("warn", "active_heartbeat_timeout", { activeTabId, since });
    metrics.failovers++;
    const next = pickNextActive(activeTabId);
    setActive(next);
    if (next) promoteTab(next);
  }
}, HEARTBEAT_INTERVAL_MS);

// @ts-expect-error - onconnect is a global in SharedWorker
onconnect = (e: MessageEvent) => {
  const ports = (e as MessageEvent & { ports?: MessagePort[] }).ports;
  const port: MessagePort | undefined = ports && ports[0];
  if (!port) {
    log("error", "onconnect_no_port");
    return;
  }

  let localTabId: TabId | null = null;
  port.onmessage = (ev: MessageEvent) => {
    const m = ev.data as IncomingMsg;
    log("debug", "received_message", {
      type: (m as BaseMsg).type,
      tabId: localTabId,
    });

    if (localTabId && connections.has(localTabId)) {
      connections.get(localTabId)!.lastSeen = Date.now();
    }

    switch ((m as BaseMsg).type) {
      case "REGISTER_TAB": {
        const { tabId } = m as RegisterTabMsg;
        localTabId = tabId;
        connections.set(tabId, { port, tabId, lastSeen: Date.now() });
        metrics.connectedTabs = connections.size;
        log("info", "tab_registered", { tabId, connected: connections.size });
        if (!activeTabId) promoteTab(tabId);
        else {
          port.postMessage({ type: "ACTIVE_CHANGED", activeTabId } as BaseMsg);
        }
        break;
      }
      case "UNREGISTER_TAB": {
        const { tabId } = m as UnregisterTabMsg;
        connections.delete(tabId);
        metrics.connectedTabs = connections.size;
        log("info", "tab_unregistered", { tabId, connected: connections.size });
        if (tabId === activeTabId) {
          metrics.failovers++;
          const next = pickNextActive(tabId);
          setActive(next);
          if (next) promoteTab(next);
        }
        break;
      }
      case "LOCK_HELD": {
        const { tabId } = m as LockHeldMsg;
        log("debug", "lock_held", { tabId });
        if (!activeTabId || activeTabId !== tabId) {
          promoteTab(tabId);
        }
        break;
      }
      case "LOCK_RELEASED": {
        const { tabId } = m as LockReleasedMsg;
        log("debug", "lock_released", { tabId });
        if (tabId === activeTabId) {
          const next = pickNextActive(tabId);
          setActive(next);
          if (next) promoteTab(next);
        }
        break;
      }
      case "HEARTBEAT_PONG": {
        const { tabId } = m as HeartbeatPongMsg;
        const conn = connections.get(tabId);
        if (conn) conn.lastSeen = Date.now();
        break;
      }
      case "DB_OPENED": {
        const { tabId } = m as DBOpenedMsg;
        dbOpenedBy = tabId;
        log("info", "db_opened_by", { tabId });
        break;
      }
      case "QUERY": {
        const qm = m as QueryMsg;
        log("debug", "processing_query", {
          requestId: qm.requestId,
          sql: qm.sql,
          tabId: qm.tabId,
        });
        enqueueQuery(qm.tabId, qm.requestId, qm.sql, qm.params);
        break;
      }
      case "QUERY_RESULT": {
        const r = m as QueryResultMsg;
        log("debug", "received_query_result", {
          requestId: r.requestId,
          fromTabId: r.fromTabId,
        });
        const origin = connections.get(r.fromTabId);
        if (origin) {
          const response = {
            type: "QUERY_RESPONSE",
            requestId: r.requestId,
            result: r.result,
          } as BaseMsg;
          log("debug", "forwarding_query_response", {
            requestId: r.requestId,
            toTabId: r.fromTabId,
          });
          origin.port.postMessage(response);
        } else {
          log("warn", "origin_tab_not_found", {
            requestId: r.requestId,
            fromTabId: r.fromTabId,
          });
        }
        pendingQueries.delete(r.requestId);
        break;
      }
      case "QUERY_ERROR": {
        const err = m as QueryErrorMsg;
        const origin =
          (err.fromTabId && connections.get(err.fromTabId)) ||
          (localTabId && connections.get(localTabId));
        if (origin) origin.port.postMessage(err as BaseMsg);
        pendingQueries.delete(err.requestId);
        break;
      }
      default: {
        log("debug", "unknown_message_type", {
          type: (m as BaseMsg) && (m as BaseMsg).type,
        });
      }
    }
  };

  port.start();
};
