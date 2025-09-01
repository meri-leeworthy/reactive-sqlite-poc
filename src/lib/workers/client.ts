export class LeafClient {
  active: string | null = null;
  tabId: string | null = null;
  handler: (e: MessageEvent) => void = () => {};
  private sendQuery:
    | ((sql: string, requestId: string) => Promise<unknown>)
    | null = null;

  private genId() {
    return Math.random().toString(36).slice(2);
  }

  onMount() {
    if (!this.sendQuery) {
      this.sendQuery = window.__sendQuery;
    }
    this.tabId = window.__TAB_ID || null;
    this.active = window.__ACTIVE || null;
    this.handler = (e: MessageEvent) => {
      if (e?.data?.type === "ACTIVE_CHANGED") {
        this.active = e.data.activeTabId;
      }
    };
    window.addEventListener("message", this.handler);
  }

  onUnMount() {
    window.removeEventListener("message", this.handler);
  }

  async run(sql: string) {
    if (!this.sendQuery) {
      this.sendQuery = window.__sendQuery;
    }
    const id = this.genId();
    try {
      const res = await this.sendQuery(sql, id);
      const json = JSON.stringify(res, null, 2);
      console.log(json);
      return json;
    } catch (e) {
      return String(e);
    }
  }

  async initSchema() {
    await this.run(pragmaLockingMode);
    await this.run(pragmaWal);
    await this.run(createEventsTable);
    await this.run(createEventsIndex);
    await this.run(createEntitiesTable);
    return "Schema initialized";
  }
}

const pragmaLockingMode = `PRAGMA locking_mode=exclusive;`;
const pragmaWal = `PRAGMA journal_mode = WAL;`;

const createEventsTable = `CREATE TABLE IF NOT EXISTS events (
  event_ulid TEXT PRIMARY KEY,   -- ULID (time-sortable)
  event_type TEXT NOT NULL,
  entity_id TEXT,                -- optional target entity id (ULID)
  payload TEXT CHECK (json_valid(payload)),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;
const createEventsIndex = `CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);`;

const createEntitiesTable = `CREATE TABLE IF NOT EXISTS entities (id UUID PRIMARY KEY, type TEXT, created_at TIMESTAMP);`;
