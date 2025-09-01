<script lang="ts">
  import { LeafClient } from "$lib/workers/client";
  import { onMount } from "svelte";

  let sql = "SELECT datetime('now') as now;";
  let output: string = "";

  const client = new LeafClient();

  async function run() {
    output = "Running...";
    // output = await client.run(sql);
    output = await client.initSchema();
  }

  onMount(() => {
    client.onMount();
    return () => client.onUnMount;
  });
</script>

<div class="p-6 space-y-4">
  <h1 class="text-2xl font-semibold">Reactive SQLite Demo</h1>
  <div class="text-sm text-gray-600">
    <div>Tab ID: {client.tabId}</div>
    <div>Active Tab: {client.active ?? "(none)"}</div>
  </div>

  <div class="space-y-2">
    <label for="sql" class="block text-sm font-medium">SQL</label>
    <textarea
      id="sql"
      bind:value={sql}
      rows={4}
      class="p-2 w-full rounded border"
    ></textarea>
    <button on:click={run} class="px-3 py-1.5 text-white bg-black rounded"
      >Run</button
    >
  </div>

  <div class="space-y-2">
    <label for="result" class="block text-sm font-medium">Result</label>
    <pre
      id="result"
      class="overflow-auto p-3 text-xs bg-gray-100 rounded">{output}</pre>
  </div>
</div>
