import type { ToWorker, FromWorker } from "$lib/workers/messages";
import wasmUrl from "wa-sqlite/dist/wa-sqlite.wasm?url";
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";

import * as SQLite from "wa-sqlite";

export async function handleMessage(
  msg: ToWorker,
  send: (reply: FromWorker) => void,
) {
  if (msg.type === "PING") {
    send({ type: "PONG" });
  }

  if (msg.type === "COMPUTE") {
    console.log("setting up sqlite");
    const module = await SQLiteESMFactory({ locateFile: () => wasmUrl });
    const sqlite3 = SQLite.Factory(module);
    const db = await sqlite3.open_v2("myDB");
    await sqlite3.exec(db, `SELECT 'Hello, world!'`, (row, columns) => {
      console.log(row, columns);
    });
    await sqlite3.close(db);
    const output = msg.payload.input * 2;
    send({ type: "RESULT", payload: { output } });
  }
}
