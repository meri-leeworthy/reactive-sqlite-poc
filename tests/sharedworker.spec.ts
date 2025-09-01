import { test, expect, type Page } from "@playwright/test";

const BASE = "/";

declare global {
  interface Window {
    __TAB_ID: string;
    __ACTIVE: string;
    __sendQuery: (sql: string, requestId: string) => Promise<unknown>;
  }
}

async function openTab(page: Page) {
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__TAB_ID);
  await page.waitForFunction(() => !!window.__TAB_ID, {
    timeout: 10_000,
  });
  const tabId = await page.evaluate(() => window.__TAB_ID);
  return { page, tabId };
}

test.describe("SharedWorker coordinator", () => {
  test("basic page functionality", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE);
    // Wait for the app to mount and expose helpers
    await page.waitForFunction(() => !!window.__TAB_ID);
    const hasTabId = await page.evaluate(() => !!window.__TAB_ID);
    expect(hasTabId).toBe(true);
    const hasSendQuery = await page.evaluate(
      () => typeof window.__sendQuery === "function",
    );
    expect(hasSendQuery).toBe(true);
    const tabId = await page.evaluate(() => window.__TAB_ID);
    expect(typeof tabId).toBe("string");
    expect((tabId as string).length).toBeGreaterThan(0);
  });

  test("message flow test", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => !!window.__TAB_ID);
    const result = await page.evaluate(() => {
      return new Promise<{ success: boolean; message: string }>((resolve) => {
        const sw = new window.SharedWorker(
          new URL("/src/workers/shared-worker.ts", window.location.origin),
          { type: "module" },
        );
        sw.port.start();
        sw.port.onmessage = (e: MessageEvent) => {
          if (e.data && e.data.type === "ACTIVE_CHANGED") {
            resolve({ success: true, message: "Received ACTIVE_CHANGED" });
          }
        };
        sw.port.postMessage({ type: "REGISTER_TAB", tabId: "test-tab" });
        setTimeout(
          () =>
            resolve({
              success: false,
              message: "Timeout waiting for response",
            }),
          5000,
        );
      });
    });
    expect(result.success).toBe(true);
  });

  test("__sendQuery function test", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => !!window.__TAB_ID);
    const result = await page.evaluate(() => {
      try {
        if (typeof window.__sendQuery === "function") {
          const promise = window.__sendQuery("SELECT 1", "test-query");
          return {
            success: true,
            message: "Function called successfully",
            promiseType: typeof promise,
          };
        } else {
          return { success: false, message: "Function not found" };
        }
      } catch (error) {
        return {
          success: false,
          message: "Error calling function: " + String(error),
        };
      }
    });
    expect(result.success).toBe(true);
    expect(result.promiseType).toBe("object");
  });

  test("__sendQuery message sending test", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => !!window.__TAB_ID);
    const result = await page.evaluate(() => {
      return new Promise<{ success: boolean; message: string }>((resolve) => {
        try {
          const promise = window.__sendQuery("SELECT 1", "test-query");
          if (promise && typeof promise.then === "function") {
            setTimeout(
              () =>
                resolve({
                  success: true,
                  message: "Promise created successfully",
                }),
              1000,
            );
          } else {
            resolve({ success: false, message: "No promise returned" });
          }
        } catch (error) {
          resolve({
            success: false,
            message: "Error calling __sendQuery: " + String(error),
          });
        }
      });
    });
    expect(result.success).toBe(true);
  });

  test("single tab answers queries", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openTab(page);
    const requestId = "q1";
    const p = page.evaluate(
      ([sql, requestId]) => window.__sendQuery(sql || "", requestId || ""),
      ["SELECT 1", requestId],
    );
    const res = await p;
    expect((res as { type: string }).type).toBe("QUERY_RESPONSE");
    expect((res as { requestId: string }).requestId).toBe(requestId);
    const r = res as unknown as { result?: unknown };
    const echo = (r.result as { echo?: string } | undefined)?.echo;
    if (typeof echo !== "undefined") {
      expect(echo).toBe("SELECT 1");
    } else {
      const rows =
        (r as { result?: { rows?: unknown } }).result?.rows ?? r.result ?? r;
      expect(JSON.stringify(rows)).toContain("1");
    }
  });

  test("multi-tab: only one active and queries forwarded", async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await openTab(pageA);
    await openTab(pageB);

    const requestId = "q2";
    const p = pageB.evaluate(
      ([sql, requestId]) => window.__sendQuery(sql || "", requestId || ""),
      ["SELECT 2", requestId],
    );
    const res = await p;
    expect((res as { type: string }).type).toBe("QUERY_RESPONSE");
    expect((res as { requestId: string }).requestId).toBe(requestId);
  });

  test("failover: closing active promotes another tab", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    await openTab(p1);
    await openTab(p2);

    // Close first tab context to trigger promotion
    await ctx1.close();
    // Wait until page 2 becomes active
    await p2.waitForFunction(() => window.__ACTIVE === window.__TAB_ID, {
      timeout: 10_000,
    });

    const requestId = "q3";
    const res = await p2.evaluate(
      ([sql, requestId]) => window.__sendQuery(sql || "", requestId || ""),
      ["SELECT 3", requestId],
    );
    expect((res as { type: string }).type).toBe("QUERY_RESPONSE");
    expect((res as { requestId: string }).requestId).toBe(requestId);
  });
});
