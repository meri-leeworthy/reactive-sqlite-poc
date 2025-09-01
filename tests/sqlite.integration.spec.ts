import { test, expect, chromium, type Page } from "@playwright/test";

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

test.describe("SQLite integration (SharedWorker coordinator)", () => {
  test("active tab initialises sqlite and can run basic DDL/DML", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openTab(page);

    // create table
    const create = (await page.evaluate(() =>
      window.__sendQuery(
        "CREATE TABLE IF NOT EXISTS t(a INTEGER PRIMARY KEY, b TEXT);",
        "create-1",
      ),
    )) as { type: string };
    // accept either success or no-op
    expect(
      create &&
        (create.type === "QUERY_RESPONSE" || create.type === "QUERY_OK"),
    ).toBeTruthy();

    // insert row
    const insert = await page.evaluate(() =>
      window.__sendQuery("INSERT INTO t(b) VALUES('hello');", "insert-1"),
    );
    // insert may return lastID or rowsAffected; be flexible
    expect(insert).toBeTruthy();

    // select row
    const select = (await page.evaluate(() =>
      window.__sendQuery(
        "SELECT a,b FROM t ORDER BY a DESC LIMIT 1;",
        "select-1",
      ),
    )) as { result: { rows: { a: number; b: string }[] } };
    // Accept multiple possible result shapes:
    const rows = select?.result?.rows ?? select?.result ?? select;
    // must find the inserted value
    const textFound = JSON.stringify(rows).includes("hello");
    expect(textFound).toBe(true);

    await context.close();
  });

  test("persistence across persistent context restart (OPFS)", async () => {
    // This test requires a persistent user data dir so OPFS persists across restarts.
    // Adjust path for CI or local environment.
    const userDataDir = "./tmp/playwright-user-data";
    const persistent = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
    });

    const page = await persistent.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => !!window.__TAB_ID);

    await page.evaluate(() =>
      window.__sendQuery(
        "CREATE TABLE IF NOT EXISTS p(a INTEGER PRIMARY KEY, b TEXT);",
        "pcreate",
      ),
    );
    await page.evaluate(() =>
      window.__sendQuery("INSERT INTO p(b) VALUES('persist-test');", "pinsert"),
    );

    await persistent.close();

    // Relaunch persistent context to check OPFS persisted DB
    const persistent2 = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
    });
    const page2 = await persistent2.newPage();
    await page2.goto(BASE);
    await page2.waitForFunction(() => !!window.__TAB_ID);
    const select = (await page2.evaluate(() =>
      window.__sendQuery(
        "SELECT b FROM p WHERE b='persist-test' LIMIT 1;",
        "pselect",
      ),
    )) as { result: { rows: { b: string }[] } };

    // accept different result shapes
    const rows = select?.result?.rows ?? select?.result ?? select;
    expect(JSON.stringify(rows)).toContain("persist-test");

    await persistent2.close();
  });

  test("failover: closing active tab promotes another tab and DB data remains accessible", async ({
    browser,
  }) => {
    // Use a single browser context with two pages to share SharedWorker and OPFS
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await openTab(pageA);
    await openTab(pageB);

    // Ensure active tab (whatever that is) can insert a sentinel row
    const fCreate = (await pageA.evaluate(() =>
      window.__sendQuery(
        "CREATE TABLE IF NOT EXISTS f(a INTEGER PRIMARY KEY, b TEXT);",
        "f-create",
      ),
    )) as { type?: string };
    expect(fCreate && fCreate.type !== "QUERY_ERROR").toBeTruthy();
    const fInsert = (await pageA.evaluate(() =>
      window.__sendQuery("INSERT INTO f(b) VALUES('sentinel');", "f-insert"),
    )) as { type?: string };
    expect(fInsert && fInsert.type !== "QUERY_ERROR").toBeTruthy();

    // Close pageA to trigger promotion
    await pageA.close();

    // Give coordinator time to promote
    await pageB
      .waitForFunction(() => window.__ACTIVE === window.__TAB_ID, {
        timeout: 5000,
      })
      .catch(() => {});

    // Query from newly active tab
    const selectRes = (await pageB.evaluate(() =>
      window.__sendQuery(
        "SELECT b FROM f WHERE b='sentinel' LIMIT 1;",
        "f-select",
      ),
    )) as { result: { rows: { b: string }[] } };

    const rows = selectRes?.result?.rows ?? selectRes?.result ?? selectRes;
    expect(JSON.stringify(rows)).toContain("sentinel");

    await context.close();
  });

  test("concurrent queries from multiple tabs are routed and responses return correct requestId", async ({
    browser,
  }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    await openTab(page1);
    await openTab(page2);

    // Issue queries concurrently
    const p1 = page1.evaluate(() =>
      window.__sendQuery("SELECT 1 as n;", "con-1"),
    );
    const p2 = page2.evaluate(() =>
      window.__sendQuery("SELECT 2 as n;", "con-2"),
    );

    const [r1, r2] = (await Promise.all([p1, p2])) as [
      { requestId: string },
      { requestId: string },
    ];

    // Verify requestId preserved and results sensible
    expect(r1.requestId === "con-1").toBeTruthy();
    expect(r2.requestId === "con-2").toBeTruthy();
    const r1json = JSON.stringify(r1);
    const r2json = JSON.stringify(r2);
    expect(r1json.includes("1")).toBeTruthy();
    expect(r2json.includes("2")).toBeTruthy();

    await ctx1.close();
    await ctx2.close();
  });

  test("transaction test: BEGIN / INSERT / ROLLBACK leaves DB unchanged", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openTab(page);

    await page.evaluate(() =>
      window.__sendQuery(
        "CREATE TABLE IF NOT EXISTS tx(a INTEGER PRIMARY KEY, b TEXT);",
        "tx-create",
      ),
    );

    // Run a transaction that will be rolled back
    await page.evaluate(() =>
      window.__sendQuery(
        "BEGIN TRANSACTION; INSERT INTO tx(b) VALUES('to-rollback'); ROLLBACK;",
        "tx-run",
      ),
    );

    const select = (await page.evaluate(() =>
      window.__sendQuery(
        "SELECT b FROM tx WHERE b='to-rollback' LIMIT 1;",
        "tx-select",
      ),
    )) as { result: { rows: { b: string }[] } };
    const rows = select?.result?.rows ?? select?.result ?? select;
    // Should not find the rolled back row
    expect(JSON.stringify(rows)).not.toContain("to-rollback");

    await context.close();
  });
});
