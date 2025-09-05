<script lang="ts">
  import { LeafClient } from "$lib/db/client";
  import { onMount } from "svelte";
  import { ulid } from "ulid";

  let output: string = "";

  const client = new LeafClient();

  const log = (v: unknown) => (output = JSON.stringify(v, null, 2));

  async function initSchema() {
    output = "Initializing schema...";
    const res = await client.initSchema();
    log(res);
  }

  // Sample event actions
  async function sampleUserCreate() {
    const userId = ulid();
    const res = await client.userCreate(userId, {
      name: { name: "Ada Lovelace" },
      description: { description: "First programmer" },
      profile: {
        blueskyHandle: "@ada.example",
        bannerUrl: null,
        joinedDate: Date.now(),
      },
      config: { config: { theme: "dark" } as unknown },
    });
    log({ userId, res });
  }

  async function sampleThreadAndMessage() {
    const spaceId = ulid();
    const threadId = ulid();
    const messageId = ulid();
    const authorId = ulid();
    await client.spaceCreate(spaceId, { name: { name: "General" } });
    await client.threadCreate(threadId, {
      spaceId,
      name: { name: "Introductions" },
      description: { description: "Say hi" },
    });
    const res = await client.messagePost(messageId, threadId, authorId, {
      text: "Hello, world!",
      format: "plain",
    });
    log({ spaceId, threadId, messageId, authorId, res });
  }

  async function sampleEdges() {
    const userId = ulid();
    const threadId = ulid();
    await client.userSubscribeThread(userId, threadId);
    const res = await client.edgeUpdate(
      "ignored-entity",
      "last_read",
      userId,
      threadId,
      {
        timestamp: Date.now(),
      },
    );
    log({ userId, threadId, res });
  }

  async function sampleUploadFlow() {
    const uploadId = ulid();
    await client.uploadStart(uploadId, "image");
    const res = await client.uploadComplete(
      uploadId,
      "https://example.com/pic.jpg",
    );
    log({ uploadId, res });
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

  <div class="space-y-3">
    <div class="flex flex-wrap gap-2">
      <button
        on:click={initSchema}
        class="px-3 py-1.5 text-white bg-black rounded"
      >
        Init Schema
      </button>
      <button
        on:click={sampleUserCreate}
        class="px-3 py-1.5 text-white bg-blue-600 rounded"
      >
        Sample: Create User
      </button>
      <button
        on:click={sampleThreadAndMessage}
        class="px-3 py-1.5 text-white bg-green-600 rounded"
      >
        Sample: Thread + Message
      </button>
      <button
        on:click={sampleEdges}
        class="px-3 py-1.5 text-white bg-purple-600 rounded"
      >
        Sample: Edges (subscribe/last_read)
      </button>
      <button
        on:click={sampleUploadFlow}
        class="px-3 py-1.5 text-white bg-orange-600 rounded"
      >
        Sample: Upload Flow
      </button>
    </div>
  </div>

  <div class="space-y-2">
    <label for="result" class="block text-sm font-medium">Result</label>
    <pre
      id="result"
      class="overflow-auto p-3 text-xs bg-gray-100 rounded">{output}</pre>
  </div>
</div>
