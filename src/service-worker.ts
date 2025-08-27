// Service Worker for sync client and background tasks

// Disables access to DOM typings like `HTMLElement` which are not available
// inside a service worker and instantiates the correct globals
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Ensures that the `$service-worker` import has proper type definitions
/// <reference types="@sveltejs/kit" />

// This gives `self` the correct types
// @ts-expect-error - self is not defined in the worker context
const self = globalThis.self as unknown as ServiceWorkerGlobalScope;

self.addEventListener("install", (event: Event) => {
  console.log("SW: install", event);
});

self.addEventListener("activate", (event: Event) => {
  console.log("SW: activate", event);
});

// Example: cache-first for GET requests
// self.addEventListener("fetch", (event: Event) => {
//   if (event.request.method === "GET") {
//     event.respondWith(fetch(event.request));
//   }
// });
