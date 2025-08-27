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

      wm.subscribe((msg) => {
        if (msg.type === "RESULT") {
          console.log("Worker result:", msg.payload.output);
        }
      });

      wm.send({ type: "COMPUTE", payload: { input: 21 } });
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
