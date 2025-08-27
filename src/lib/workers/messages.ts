// src/lib/workers/messages.ts

export type ToWorker =
  | { type: "PING"; payload?: undefined }
  | { type: "COMPUTE"; payload: { input: number } };

export type FromWorker =
  | { type: "PONG" }
  | { type: "RESULT"; payload: { output: number } };
