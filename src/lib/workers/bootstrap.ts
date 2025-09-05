import { WorkerManager } from "./WorkerManager";

export type WorkerBridge = {
  manager: WorkerManager;
  dispose: () => void;
};

export async function installWorkerBridge(): Promise<WorkerBridge> {
  const wm = new WorkerManager();
  await wm.initialize();

  const unsub = wm.subscribe((msg) => {
    if (msg.type === "ACTIVE_CHANGED") {
      (window as unknown as { __ACTIVE: string | null }).__ACTIVE = (
        msg as unknown as { activeTabId: string | null }
      ).activeTabId;
      window.postMessage(msg, "*");
    }
    if (msg.type === "DB_OPENED") {
      (window as unknown as { __DB_READY: boolean }).__DB_READY = true;
      window.postMessage(msg, "*");
    }
  });

  (window as unknown as { __TAB_ID: string }).__TAB_ID = wm.getTabId();

  (
    window as unknown as {
      __sendQuery: (sql: string, requestId: string) => Promise<unknown>;
    }
  ).__sendQuery = (sql: string, requestId: string) => {
    return new Promise((resolve) => {
      const unsubLocal = wm.subscribe((m) => {
        const rid = (m as unknown as { requestId?: string }).requestId;
        if (rid !== requestId) return;
        if (m.type === "QUERY_RESPONSE" || m.type === "QUERY_ERROR") {
          unsubLocal();
          resolve(m);
        }
      });
      wm.sendQuery(sql, requestId);
    });
  };

  (
    window as unknown as {
      __sendEvent: (
        event: import("../db/types/events").AnyEvent,
        requestId: string,
      ) => Promise<unknown>;
    }
  ).__sendEvent = (event, requestId) => {
    return new Promise((resolve) => {
      const unsubLocal = wm.subscribe((m) => {
        const rid = (m as unknown as { requestId?: string }).requestId;
        if (rid !== requestId) return;
        if (m.type === "APP_EVENT_RESPONSE" || m.type === "APP_EVENT_ERROR") {
          unsubLocal();
          resolve(m);
        }
      });
      wm.sendAppEvent(event, requestId);
    });
  };

  return {
    manager: wm,
    dispose: () => {
      try {
        unsub();
      } catch {
        /* noop */
      }
    },
  };
}
