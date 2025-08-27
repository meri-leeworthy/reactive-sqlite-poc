import type { ToWorker, FromWorker } from "./messages";

export type WorkerKind = "shared" | "dedicated" | "none";

type Listener = (msg: FromWorker) => void;

export class WorkerManager {
  private isInitialized = false;
  private workerKind: WorkerKind = "none";

  private serviceWorkerReg: ServiceWorkerRegistration | null = null;
  private sharedWorker: SharedWorker | null = null;
  private dedicatedWorker: Worker | null = null;

  private listeners = new Set<Listener>();

  constructor() {
    this.detectEnvironment();
  }

  private detectEnvironment(): void {
    if (typeof SharedWorker !== "undefined") {
      this.workerKind = "shared";
    } else if (typeof Worker !== "undefined") {
      this.workerKind = "dedicated";
    } else {
      this.workerKind = "none";
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await this.registerServiceWorker();
    this.initializeAppWorker();

    this.isInitialized = true;
  }

  private async registerServiceWorker(): Promise<void> {
    // if ("serviceWorker" in navigator) {
    //   try {
    //     const reg = await navigator.serviceWorker.register(
    //       "/service-worker.js?worker&url",
    //       {
    //         scope: "/",
    //         type: "module",
    //       },
    //     );
    //     console.log("Service worker registered", reg);
    //   } catch (err) {
    //     console.error("SW registration failed", err);
    //   }
    // }
  }

  private initializeAppWorker(): void {
    switch (this.workerKind) {
      case "shared": {
        this.sharedWorker = new SharedWorker(
          new URL("../../workers/shared-worker.ts", import.meta.url),
          { type: "module" },
        );
        this.sharedWorker.port.onmessage = (e) =>
          this.dispatch(e.data as FromWorker);
        break;
      }
      case "dedicated": {
        this.dedicatedWorker = new Worker(
          new URL("../../workers/dedicated-worker.ts", import.meta.url),
          { type: "module" },
        );
        this.dedicatedWorker.onmessage = (e) =>
          this.dispatch(e.data as FromWorker);
        break;
      }
      case "none":
        console.warn("WorkerManager: No worker support available");
    }
  }

  private dispatch(msg: FromWorker) {
    for (const l of this.listeners) l(msg);
  }

  send(msg: ToWorker): void {
    if (this.sharedWorker) {
      this.sharedWorker.port.postMessage(msg);
    } else if (this.dedicatedWorker) {
      this.dedicatedWorker.postMessage(msg);
    } else {
      console.warn("WorkerManager: No worker available to send message", msg);
    }
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
}
