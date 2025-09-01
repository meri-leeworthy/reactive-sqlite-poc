type SQLiteDb = {
  exec: (opts: {
    sql: string;
    rowMode?: string;
    returnValue?: string;
    bind?: unknown;
  }) => unknown;
  close?: () => void;
  // Convenience helpers available in oo1
  selectObjects?: (sql: string, bind?: unknown) => unknown[];
  selectArrays?: (sql: string, bind?: unknown) => unknown[];
};

type SQLiteAPI = {
  oo1: {
    DB: new (name: string) => SQLiteDb;
    OpfsDb?: new (name: string) => SQLiteDb;
  };
  installOpfsSAHPoolVfs?: (opts?: {
    clearOnInit?: boolean;
    initialCapacity?: number;
    directory?: string;
    name?: string;
    forceReinitIfPreviouslyFailed?: boolean;
  }) => Promise<{ OpfsSAHPoolDb: new (name: string) => SQLiteDb }>;
};

let sqlite3: SQLiteAPI | null = null;
let db: SQLiteDb | null = null;
let initPromise: Promise<void> | null = null;

export function isDatabaseReady(): boolean {
  return !!db;
}

export async function initializeDatabase(
  dbName: string = "/reactive.sqlite3",
): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!sqlite3) {
      const mod = await import("@sqlite.org/sqlite-wasm");
      const init = (mod as { default: (opts?: unknown) => Promise<SQLiteAPI> })
        .default;
      sqlite3 = await init({ print: console.log, printErr: console.error });
    }

    try {
      // Prefer OPFS SAH Pool VFS. It avoids COOP/COEP and works across modern browsers.
      if (sqlite3?.installOpfsSAHPoolVfs) {
        let lastErr: unknown = null;
        // Retry a few times because SAH Pool can transiently fail during context handoff
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            const pool = await sqlite3.installOpfsSAHPoolVfs({
              name: "opfs-sahpool",
              directory: "/reactive-sqlite",
              forceReinitIfPreviouslyFailed: true,
            });
            db = new pool.OpfsSAHPoolDb(dbName);
            break;
          } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)));
          }
        }
        if (!db) throw lastErr ?? new Error("sahpool_init_failed");
      } else if (sqlite3?.oo1?.OpfsDb) {
        // Fallback to OPFS vfs if available (requires COOP/COEP)
        db = new sqlite3.oo1.OpfsDb(dbName);
      } else {
        // Last resort: non-OPFS DB (likely memory-backed)
        // In tests we want to fail hard if persistence is not available to avoid
        // silently using memory DB. Detect Playwright by userAgent if possible.
        const ua = (self as unknown as { navigator?: { userAgent?: string } })
          ?.navigator?.userAgent;
        const isPlaywright =
          typeof ua === "string" && ua.includes("HeadlessChrome");
        if (isPlaywright) {
          throw new Error("persistent_vfs_unavailable");
        }
        db = new sqlite3.oo1.DB(dbName);
      }
    } catch {
      // If SAH Pool API exists but initialization failed, do not silently fall back
      // to memory, as that would break cross-tab persistence. Only fall back if
      // neither SAH Pool nor OpfsDb are usable.
      if (sqlite3?.installOpfsSAHPoolVfs || sqlite3?.oo1?.OpfsDb) {
        throw new Error("persistent_vfs_unavailable");
      } else {
        db = new sqlite3.oo1.DB(dbName);
      }
    }
  })();
  await initPromise;
}

export async function executeQuery(
  sql: string,
  params?: unknown,
): Promise<unknown> {
  if (!db && initPromise) await initPromise;
  if (!db) throw new Error("database_not_initialized");

  try {
    const trimmed = sql.trim();
    const upper = trimmed.slice(0, 10).toUpperCase();
    const looksLikeSelect =
      upper.startsWith("SELECT") ||
      upper.startsWith("WITH") ||
      upper.startsWith("PRAGMA");

    if (looksLikeSelect) {
      if (typeof db.selectObjects === "function") {
        const rows = db.selectObjects(trimmed, params);
        return { rows };
      }
      const result = db.exec({
        sql: trimmed,
        rowMode: "object",
        returnValue: "resultRows",
        bind: params,
      });
      return Array.isArray(result) ? { rows: result } : { rows: [] };
    }

    // DDL/DML or multi-statement: let exec run them. It does not return rows.
    db.exec({ sql: trimmed, bind: params });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(message);
  }
}

export async function closeDatabase(): Promise<void> {
  if (db && typeof db.close === "function") {
    try {
      db.close();
    } finally {
      db = null;
    }
  }
}
