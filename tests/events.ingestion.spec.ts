import { test, expect, type Page } from "@playwright/test";

const BASE = "/";

declare global {
  interface Window {
    __TAB_ID: string;
    __sendQuery: (sql: string, requestId: string) => Promise<unknown>;
  }
}

async function openTab(page: Page) {
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__TAB_ID);
  return page.evaluate(() => window.__TAB_ID);
}

test.describe("Events ingestion", () => {
  test("ingests a single event with BLOB JSON payload", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openTab(page);

    // Ensure minimal schema exists (entities + events) via dedicated worker
    await page.evaluate(async () => {
      await (
        window as unknown as {
          __sendQuery: (sql: string, requestId: string) => Promise<unknown>;
        }
      ).__sendQuery(
        "CREATE TABLE IF NOT EXISTS entities (ulid BLOB PRIMARY KEY, label TEXT CHECK(label IN ('notification','embed','device','user','timeline','message','task','space')), created_at INTEGER) STRICT;",
        "schema-entities",
      );
      await (
        window as unknown as {
          __sendQuery: (sql: string, requestId: string) => Promise<unknown>;
        }
      ).__sendQuery(
        "CREATE TABLE IF NOT EXISTS events (event_ulid BLOB PRIMARY KEY, entity_ulid BLOB REFERENCES entities(ulid) ON DELETE CASCADE, payload BLOB, created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)) STRICT;",
        "schema-events",
      );
      await (
        window as unknown as {
          __sendQuery: (sql: string, requestId: string) => Promise<unknown>;
        }
      ).__sendQuery(
        "CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);",
        "schema-idx1",
      );
    });

    // Ingest one domain event via dedicated worker
    await page.evaluate(async () => {
      const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      const ulid = () =>
        Array.from({ length: 26 }, () =>
          alphabet.charAt(Math.floor(Math.random() * alphabet.length)),
        ).join("");
      const ev = {
        type: "message.post",
        eventId: ulid(),
        messageId: ulid(),
        threadId: ulid(),
        authorUserId: ulid(),
        text: { text: "hello", format: "plain" },
      };
      await (
        window as unknown as {
          __sendEvent: (event: unknown, requestId: string) => Promise<unknown>;
        }
      ).__sendEvent(ev, "single-1");
    });

    // Verify via dedicated worker query; payload stored as BLOB but cast to TEXT should be JSON
    const typeSeen = await page.evaluate(async () => {
      const q = (await (
        window as unknown as {
          __sendQuery: (
            sql: string,
            requestId: string,
          ) => Promise<{
            result?: { rows?: unknown[] };
            rows?: unknown[];
          }>;
        }
      ).__sendQuery(
        "SELECT CAST(payload AS TEXT) as t FROM events ORDER BY created_at DESC LIMIT 1;",
        "ev1",
      )) as { result?: { rows?: { t: string }[] }; rows?: { t: string }[] };
      const rows = q?.result?.rows ?? q?.rows ?? [];
      const t = rows[0]?.t || "";
      return String(t);
    });

    expect(typeSeen).toContain('"type":"message.post"');

    await context.close();
  });

  test("ingests multiple events in a single transaction", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openTab(page);

    // Ensure minimal schema exists (entities + events)
    await page.evaluate(async () => {
      await (
        window as unknown as {
          __sendQuery: (sql: string, requestId: string) => Promise<unknown>;
        }
      ).__sendQuery(
        "CREATE TABLE IF NOT EXISTS entities (ulid BLOB PRIMARY KEY, label TEXT CHECK(label IN ('notification','embed','device','user','timeline','message','task','space')), created_at INTEGER) STRICT;",
        "schema-entities",
      );
      await (
        window as unknown as {
          __sendQuery: (sql: string, requestId: string) => Promise<unknown>;
        }
      ).__sendQuery(
        "CREATE TABLE IF NOT EXISTS events (event_ulid BLOB PRIMARY KEY, entity_ulid BLOB REFERENCES entities(ulid) ON DELETE CASCADE, payload BLOB, created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)) STRICT;",
        "schema-events",
      );
      await (
        window as unknown as {
          __sendQuery: (sql: string, requestId: string) => Promise<unknown>;
        }
      ).__sendQuery(
        "CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);",
        "schema-idx1",
      );
    });

    const beforeCount = (await page.evaluate(() =>
      (
        window as unknown as {
          __sendQuery: (
            sql: string,
            requestId: string,
          ) => Promise<{
            result?: { rows?: { n: number }[] };
            rows?: { n: number }[];
          }>;
        }
      ).__sendQuery("SELECT COUNT(*) as n FROM events;", "cnt-before"),
    )) as { result?: { rows?: { n: number }[] }; rows?: { n: number }[] };
    const beforeRows = beforeCount?.result?.rows ?? beforeCount?.rows ?? [];
    const before = beforeRows[0]?.n ?? 0;

    // Ingest a batch of events by sending an array to the dedicated worker
    const inserted = await page.evaluate(async () => {
      const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      const ulid = () =>
        Array.from({ length: 26 }, () =>
          alphabet.charAt(Math.floor(Math.random() * alphabet.length)),
        ).join("");
      const events = new Array(3).fill(0).map(() => ({
        type: "upload.start",
        eventId: ulid(),
        uploadId: ulid(),
        mediaType: "image",
      }));
      const resp = (await (
        window as unknown as {
          __sendEvent: (
            event: unknown,
            requestId: string,
          ) => Promise<{ type: string; requestId: string; result?: unknown }>;
        }
      ).__sendEvent(events, "batch-1")) as {
        type: string;
        requestId: string;
        result?: { ok?: boolean; inserted?: number };
      };
      return resp?.result?.inserted ?? 0;
    });

    expect(inserted).toBe(3);

    const afterCount = (await page.evaluate(() =>
      (
        window as unknown as {
          __sendQuery: (
            sql: string,
            requestId: string,
          ) => Promise<{
            result?: { rows?: { n: number }[] };
            rows?: { n: number }[];
          }>;
        }
      ).__sendQuery("SELECT COUNT(*) as n FROM events;", "cnt-after"),
    )) as { result?: { rows?: { n: number }[] }; rows?: { n: number }[] };
    const afterRows = afterCount?.result?.rows ?? afterCount?.rows ?? [];
    const after = afterRows[0]?.n ?? 0;

    expect(after - before).toBe(3);

    await context.close();
  });
});
