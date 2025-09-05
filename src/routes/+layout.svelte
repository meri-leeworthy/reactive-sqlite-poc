<script lang="ts">
  import "../app.css";
  import favicon from "$lib/assets/favicon.svg";
  import { installWorkerBridge } from "../lib/workers";
  import { onMount } from "svelte";
  import { onDestroy } from "svelte";

  let { children } = $props();
  let dispose: (() => void) | null = null;

  onMount(async () => {
    try {
      const bridge = await installWorkerBridge();
      dispose = bridge.dispose;

      console.log("App: WorkerManager initialized successfully");
    } catch (error) {
      console.error("App: Failed to initialize WorkerManager:", error);
    }
  });

  onDestroy(() => {
    try {
      dispose?.();
    } catch {
      /* noop */
    }
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{@render children?.()}
