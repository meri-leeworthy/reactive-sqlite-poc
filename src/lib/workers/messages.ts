// Message types shared between main thread and workers
export type BaseMsg = { type: string };

export type RegisterTab = { type: "REGISTER_TAB"; tabId: string };
export type UnregisterTab = { type: "UNREGISTER_TAB"; tabId: string };
export type PromoteToActive = { type: "PROMOTE_TO_ACTIVE"; tabId: string };
export type ActiveChanged = {
  type: "ACTIVE_CHANGED";
  activeTabId: string | null;
};
export type Heartbeat = { type: "HEARTBEAT" };
export type HeartbeatPong = { type: "HEARTBEAT_PONG"; tabId: string };
export type DbOpened = { type: "DB_OPENED"; tabId: string };
export type Demote = { type: "DEMOTE"; tabId: string };
export type Demoted = { type: "DEMOTED"; tabId: string };

// Web Locks liveness notifications (from page to SharedWorker)
export type LockHeld = { type: "LOCK_HELD"; tabId: string };
export type LockReleased = { type: "LOCK_RELEASED"; tabId: string };

export type Query = {
  type: "QUERY";
  tabId: string;
  requestId: string;
  sql: string;
  params?: unknown;
};

// Application-level event dispatching
export type AppEvent = {
  type: "APP_EVENT";
  tabId: string;
  requestId: string;
  event: import("../db/types/events").AnyEvent;
};

export type ForwardQuery = {
  type: "FORWARD_QUERY";
  requestId: string;
  fromTabId: string;
  sql: string;
  params?: unknown;
};

export type ForwardAppEvent = {
  type: "FORWARD_APP_EVENT";
  requestId: string;
  fromTabId: string;
  event: import("../db/types/events").AnyEvent;
};

export type QueryResponse = {
  type: "QUERY_RESPONSE";
  requestId: string;
  result: unknown;
};

export type QueryError = {
  type: "QUERY_ERROR";
  requestId: string;
  error: string;
  fromTabId?: string;
};

export type AppEventResponse = {
  type: "APP_EVENT_RESPONSE";
  requestId: string;
  result: unknown;
};

export type AppEventError = {
  type: "APP_EVENT_ERROR";
  requestId: string;
  error: string;
  fromTabId?: string;
};

export type ToSharedWorker =
  | RegisterTab
  | UnregisterTab
  | Query
  | AppEvent
  | HeartbeatPong
  | LockHeld
  | LockReleased
  | BaseMsg;
export type FromSharedWorker =
  | ActiveChanged
  | PromoteToActive
  | Demote
  | DbOpened
  | ForwardQuery
  | ForwardAppEvent
  | QueryResponse
  | QueryError
  | AppEventResponse
  | AppEventError
  | Heartbeat
  | BaseMsg;
