// Fallback for Shared Worker if not supported
import { handleMessage } from "./worker-logic";
import type { ToWorker } from "$lib/workers/messages";

onmessage = (event: MessageEvent<ToWorker>) => {
  handleMessage(event.data, (reply) => postMessage(reply));
};
