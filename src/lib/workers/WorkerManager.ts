import type {
  ToSharedWorker,
  FromSharedWorker,
  PromoteToActive,
  ForwardQuery,
  QueryResponse,
  QueryError,
  Heartbeat,
  HeartbeatPong,
} from "./messages";

export type WorkerKind = "shared" | "none";

type Listener = (msg: FromSharedWorker) => void;

export class WorkerManager {
  private isInitialized = false;
  private workerKind: WorkerKind = "none";

  private sharedWorker: SharedWorker | null = null;
  private dedicatedWorker: Worker | null = null;

  private listeners = new Set<Listener>();

  private tabId: string = crypto.randomUUID();

  // Web Locks state
  private lockRelease: (() => void) | null = null;
  private lockHeld = false;

  constructor() {
    this.detectEnvironment();
  }

  private detectEnvironment(): void {
    if (typeof SharedWorker !== "undefined") {
      this.workerKind = "shared";
    } else {
      this.workerKind = "none";
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (this.workerKind === "shared") {
      this.sharedWorker = new SharedWorker(
        new URL("../../workers/shared-worker.ts", import.meta.url),
        { type: "module", name: "coordinator-shared-worker" },
      );
      this.sharedWorker.port.onmessage = (e) =>
        this.dispatch(e.data as FromSharedWorker);
      this.sharedWorker.port.start();

      // Start dedicated worker per tab
      this.dedicatedWorker = new Worker(
        new URL("../../workers/dedicated-worker.ts", import.meta.url),
        { type: "module", name: "tab-dedicated-worker" },
      );
      this.dedicatedWorker.onmessage = (e) => {
        const m = e.data as
          | PromoteToActive
          | QueryResponse
          | QueryError
          | { type: string };
        // Forward everything from dedicated to shared
        this.sharedWorker!.port.postMessage(m);
      };

      // Register this tab with shared worker
      this.sharedWorker.port.postMessage({
        type: "REGISTER_TAB",
        tabId: this.tabId,
      } satisfies ToSharedWorker);

      // Initialize dedicated worker with tabId
      this.dedicatedWorker.postMessage({ type: "INIT", tabId: this.tabId });

      // Cleanup on unload
      addEventListener("beforeunload", () => {
        try {
          this.sharedWorker?.port.postMessage({
            type: "UNREGISTER_TAB",
            tabId: this.tabId,
          });
          // Release the lock to proactively notify LOCK_RELEASED
          this.lockRelease?.();
        } catch {
          /* noop */
        }
      });

      // Acquire long-held Web Lock for liveness (best-effort)
      this.acquireWebLock().catch(() => {
        /* ignore */
      });
    }

    this.isInitialized = true;
  }

  private dispatch(msg: FromSharedWorker) {
    // If coordinator asks to promote, forward to dedicated worker
    if ((msg as PromoteToActive).type === "PROMOTE_TO_ACTIVE") {
      this.dedicatedWorker?.postMessage(msg);
    }
    // If coordinator forwards a query to active, pass to dedicated
    if ((msg as ForwardQuery).type === "FORWARD_QUERY") {
      this.dedicatedWorker?.postMessage(msg);
    }
    // Reply to heartbeat from coordinator
    if ((msg as Heartbeat).type === "HEARTBEAT") {
      this.sharedWorker?.port.postMessage({
        type: "HEARTBEAT_PONG",
        tabId: this.tabId,
      } as HeartbeatPong as ToSharedWorker);
    }
    for (const l of this.listeners) l(msg);
  }

  sendQuery(sql: string, requestId: string): void {
    if (!this.sharedWorker) {
      console.warn("WorkerManager: SharedWorker not available");
      return;
    }
    this.sharedWorker.port.postMessage({
      type: "QUERY",
      tabId: this.tabId,
      requestId,
      sql,
    } as ToSharedWorker);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getWorkerKind(): WorkerKind {
    return this.workerKind;
  }

  async cleanup(): Promise<void> {
    if (this.dedicatedWorker) {
      this.dedicatedWorker.terminate();
      this.dedicatedWorker = null;
    }
    if (this.sharedWorker) {
      this.sharedWorker.port.close();
      this.sharedWorker = null;
    }
    this.isInitialized = false;
  }

  getTabId(): string {
    return this.tabId;
  }

  private async acquireWebLock(): Promise<void> {
    // Feature-detect Web Locks
    const locksApi = navigator;
    if (!locksApi.locks || typeof locksApi.locks.request !== "function") {
      return;
    }
    const lockName = `reactive-sqlite-liveness:${this.tabId}`;
    // Hold the lock until explicitly released (or page closes)
    await locksApi.locks
      .request(lockName, { mode: "exclusive" }, async () => {
        // Notify coordinator
        this.lockHeld = true;
        try {
          this.sharedWorker?.port.postMessage({
            type: "LOCK_HELD",
            tabId: this.tabId,
          } as ToSharedWorker);
        } catch {
          /* noop */
        }

        // Keep lock forever until release is called
        await new Promise<void>((resolve) => {
          this.lockRelease = resolve;
        });
      })
      .finally(() => {
        if (this.lockHeld) {
          try {
            this.sharedWorker?.port.postMessage({
              type: "LOCK_RELEASED",
              tabId: this.tabId,
            } as ToSharedWorker);
          } catch {
            /* noop */
          }
        }
        this.lockHeld = false;
        this.lockRelease = null;
      });
  }
}
