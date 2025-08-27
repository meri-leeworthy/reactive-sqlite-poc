// Shared Worker for SQLite instance management

import { handleMessage } from "./worker-logic";
import type { ToWorker } from "$lib/workers/messages";

// @ts-expect-error - onconnect is not defined in the worker context
onconnect = (e: MessageEvent & { ports: MessagePort[] }) => {
  const port = e.ports[0];

  if (!port) {
    console.error("Shared Worker: No port found");
    return;
  }

  port.onmessage = (event: MessageEvent<ToWorker>) => {
    handleMessage(event.data, (reply) => port?.postMessage(reply));
  };
};
