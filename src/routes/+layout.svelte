<script lang="ts">
  import "../app.css";
  import favicon from "$lib/assets/favicon.svg";
  import { WorkerManager } from "../lib/workers";
  import { onMount } from "svelte";

  let { children } = $props();
  let wm: WorkerManager;

  onMount(async () => {
    try {
      wm = new WorkerManager();
      await wm.initialize();

      // Expose minimal test helpers akin to sw-coordinator-test harness
      (
        window as unknown as {
          __sendQuery: (sql: string, requestId: string) => Promise<unknown>;
        }
      ).__sendQuery = (sql: string, requestId: string) => {
        return new Promise((resolve) => {
          const unsub = wm.subscribe((m) => {
            const rid = (m as unknown as { requestId?: string }).requestId;
            if (rid !== requestId) return;
            if (m.type === "QUERY_RESPONSE" || m.type === "QUERY_ERROR") {
              unsub();
              resolve(m);
            }
          });
          wm.sendQuery(sql, requestId);
        });
      };
      (window as unknown as { __TAB_ID: string }).__TAB_ID = wm.getTabId();

      wm.subscribe((msg) => {
        if (msg.type === "ACTIVE_CHANGED") {
          (window as unknown as { __ACTIVE: string | null }).__ACTIVE = (
            msg as unknown as { activeTabId: string | null }
          ).activeTabId;
          window.postMessage(msg, "*");
        }
      });

      console.log("App: WorkerManager initialized successfully");
    } catch (error) {
      console.error("App: Failed to initialize WorkerManager:", error);
    }
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{@render children?.()}
