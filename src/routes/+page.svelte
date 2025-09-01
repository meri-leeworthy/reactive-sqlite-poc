<script lang="ts">
  import { onMount } from "svelte";
  let active: string | null = null;
  let tabId: string | null = null;
  let sql = "SELECT datetime('now') as now;";
  let output: string = "";

  function genId() {
    return Math.random().toString(36).slice(2);
  }

  async function run() {
    output = "Running...";
    const id = genId();
    try {
      // @ts-ignore
      const res = await window.__sendQuery(sql, id);
      output = JSON.stringify(res, null, 2);
    } catch (e) {
      output = String(e);
    }
  }

  onMount(() => {
    // @ts-ignore
    tabId = window.__TAB_ID || null;
    // @ts-ignore
    active = window.__ACTIVE || null;
    const handler = (e: MessageEvent) => {
      if (e?.data?.type === "ACTIVE_CHANGED") {
        // @ts-ignore
        active = e.data.activeTabId;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  });
</script>

<div class="p-6 space-y-4">
  <h1 class="text-2xl font-semibold">Reactive SQLite Demo</h1>
  <div class="text-sm text-gray-600">
    <div>Tab ID: {tabId}</div>
    <div>Active Tab: {active ?? "(none)"}</div>
  </div>

  <div class="space-y-2">
    <label for="sql" class="block text-sm font-medium">SQL</label>
    <textarea
      id="sql"
      bind:value={sql}
      rows={4}
      class="w-full p-2 border rounded"
    ></textarea>
    <button on:click={run} class="px-3 py-1.5 bg-black text-white rounded"
      >Run</button
    >
  </div>

  <div class="space-y-2">
    <label for="result" class="block text-sm font-medium">Result</label>
    <pre
      id="result"
      class="p-3 bg-gray-100 rounded overflow-auto text-xs">{output}</pre>
  </div>
</div>
