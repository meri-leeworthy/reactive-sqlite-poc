---
title: "Notion engineers sped up Notion's browser speed with WASM SQLite"
source: "https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite"
author:
  - "[[Carlo Francisco]]"
published: July 10
created: 2025-08-29
description: "Notion engineers sped up Notion's browser speed with WASM SQLite"
tags:
  - "clippings"
---
[All posts](https://www.notion.com/blog)

[All posts](https://www.notion.com/blog)

Published in [Tech](https://www.notion.com/blog/topic/tech)

## How we sped up Notion in the browser with WASM SQLite

10 min read

Three years ago we successfully [sped up the Notion app for Mac and Windows](https://www.notion.so/blog/faster-page-load-navigation) by using a SQLite database to cache data on the client. We also use this SQLite caching in our native mobile application.

This year we’ve been able to deliver this same improvement to users who access Notion through their web browsers. This article is a deep dive into how we used [the WebAssembly (WASM) implementation of sqlite3](https://sqlite.org/wasm/doc/tip/about.md) to improve Notion’s performance in the browser.

Using SQLite **improved** **page navigation times by 20 percent in all modern browsers.** And the difference was even more pronounced for users who are subject to especially slow API response times due to external factors like their Internet connection. For example, page navigation times sped up by 28 percent for users in Australia, by 31 percent for users in China, and by 33 percent for users in India.

Let’s jump into how we set up SQLite on the browser!

## Core technologies: OPFS and Web Workers

In order to persist data across sessions, the WASM SQLite library uses the [Origin Private File System (OPFS)](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system), a modern browser API that lets a site read from and write to files on the user’s device.

The WASM SQLite library can only use OPFS for its persistence layer in [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers). A Web Worker can be thought of as code that runs in a separate thread than the main thread in the browser where most JavaScript is executed. Notion is bundled together with [Webpack](https://webpack.js.org/), which fortunately provides an [easy-to-use syntax](https://webpack.js.org/guides/web-workers/) to load a Web Worker. We set up our Web Worker to either create a SQLite database file using OPFS or load an existing file. We then ran our existing caching code on this Web Worker. We used the excellent [Comlink](https://github.com/GoogleChromeLabs/comlink) library to easily manage messages passing between the main thread and the Worker.

## Our SharedWorker-powered approach

Our final architecture was based on a novel solution that Roy Hashimoto laid out in [this GitHub discussion](https://github.com/rhashimoto/wa-sqlite/discussions/81). Hashimoto described an approach where only one tab accesses SQLite at a time, while still permitting other tabs to execute SQLite queries.

How does this new architecture work? In a nutshell, each tab has its own dedicated Web Worker that can write to SQLite. However, only one tab is permitted to actually use its Web Worker. A SharedWorker is responsible for managing which is the **“active tab.”** When the active tab closes, the SharedWorker knows to select a new active tab. To detect closed tabs, we open an infinitely-open Web Lock on each tab—and if that Web Lock closes, the tab must have closed.

To execute any SQLite query, the main thread of each tab sends that query to the SharedWorker, which redirects to the active tab’s dedicated Worker. Any number of tabs can make simultaneous SQLite queries as many times as they want, and it will always be routed to the single active tab.

Each Web Worker accesses the SQLite database using the [OPFS SyncAccessHandle Pool VFS](https://sqlite.org/wasm/doc/trunk/persistence.md#vfs-opfs-sahpool) implementation, which works on all major browsers.

In the following sections, we’ll explain why we needed to build it this way, and what roadblocks we ran into when we tried different approaches.

## Why a simpler approach didn’t work

Prior to building the architecture described above, we tried to get WASM SQLite running in a more straightforward way—one dedicated Web Worker per tab, with each Web Worker writing to the SQLite database.

There were two alternative implementations of WASM SQLite we could pick from:

- [OPFS via sqlite3\_vfs](https://sqlite.org/wasm/doc/trunk/persistence.md#vfs-opfs)
- [OPFS SyncAccessHandle Pool VFS](https://sqlite.org/wasm/doc/trunk/persistence.md#vfs-opfs-sahpool)

We ultimately found that neither one, if used in a straightforward way, was sufficient for our needs.

### Stumbling block #1: cross-origin isolation

OPFS via sqlite3\_vfs requires that your site be “cross-origin isolated.” Adding cross-origin isolation to a page involves setting a few security headers that limit what scripts can be loaded. A good place to learn more about this is [“COOP and COEP Explained](https://docs.google.com/document/d/1zDlfvfTJ_9e8Jdc8ehuV4zMEu9ySMCiTGMS9y0GU92k/edit)."

Setting these headers would have been a significant task. With cross-origin isolation, it’s not enough to set these two headers on your page. All cross-origin resources loaded by your application must set a different header, and all cross-origin iframes must append an additional attribute which permits them to work in a cross-origin isolated environment. At Notion we depend on many third-party scripts to power various features of our web infrastructure, and achieving full cross-origin isolation would have involved asking each of these vendors to set the new header and change how their iframes work—an unrealistic ask.

In our testing we were able to get crucial performance data by shipping this variant to a subset of users using [Origin Trials](https://developer.chrome.com/docs/web-platform/origin-trials) for SharedArrayBuffer available on the Chrome and Edge browsers. These Origin Trials allowed us to temporarily bypass the requirement of cross-origin isolation.

Using this workaround meant that we could only turn this feature on in Chrome and Edge, and not in other commonly used browsers like Safari. But Notion traffic from those browsers was more than ample to gather some performance data.

### Stumbling block #2: corruption issues

When we turned on OPFS via sqlite3\_vfs to a small percentage of our users, we started seeing a severe bug for some of them. These users would see the *wrong data on a page* —a comment attributed to the wrong co-worker, for example, or a link to a new page whose preview was a completely different page.

Obviously, we couldn’t launch this feature to 100% of traffic in this state. Looking at the database files of users who were affected by this bug, we noticed a pattern: their SQLite databases were corrupt in some way. Selecting rows in certain tables would throw an error, and when we examined the rows themselves, we found data consistency issues like multiple rows with the same ID but different content.

This was obviously the cause of the incorrect data. But how did the SQLite database get into such a state? We hypothesized that the problem was caused by concurrency issues. Multiple tabs might be open, and each tab had a dedicated Web Worker that had an active connection to the SQLite database. The Notion application frequently writes to the cache—it does so every time it gets an update from the server, meaning tabs would write to the same file at the same time. Even though we were already using a transactional approach that batched SQLite queries together, we strongly suspected that the corruption was due to poor concurrency handling on behalf of the OPFS API. [A few discussions](https://sqlite.org/forum/forumpost/5543370423fe67d0) on the SQLite forum seemed to confirm that others were struggling with how OPFS managed concurrency (which is to say, not much at all).

The architecture of WASM Sqlite at the point we observed corruption issues.

So we started logging corruption errors and then tried a few band-aid approaches like adding [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) and only having the in-focus tab write to SQLite. These tweaks lowered the rate of corruption, but not enough that we were confident we could turn the feature on to production traffic again. Still, we’d confirmed that concurrency issues were significantly contributing to corruption.

The Notion desktop app didn’t suffer from this issue. On that platform, only a single parent process ever writes to SQLite; you can open as many tabs in the app as you want, and only a single thread will ever be accessing the database file. Our mobile native app can only have one page open at a time, but even if it had multiple tabs, it has a similar architecture to the desktop app in this regard.

### Stumbling block #3: the alternative could only run in one tab at a time

We also evaluated the [OPFS SyncAccessHandle Pool VFS](https://sqlite.org/wasm/doc/trunk/persistence.md#vfs-opfs-sahpool) variant. This variant doesn’t require SharedArrayBuffer, meaning it can be used on Safari, Firefox, and other browsers that don’t have an Origin Trial for SharedArrayBuffer.

The tradeoff for this variant is that it can only run in one tab at a time; any attempt to open the SQLite database in a subsequent tab will simply throw an error.

On the one hand, this meant that OPFS SyncAccessHandle Pool VFS didn’t have the OPFS via sqlite3\_vfs variant’s concurrency problems. We confirmed this when we turned it on to a small percentage of users and saw no corruption issues. On the other hand, we couldn’t launch this variant out of the box either, since we wanted all our users’ tabs to benefit from caching.

### Resolution

The fact that neither variant could be used out of the box is what prompted us to build the SharedWorker architecture described above, which is compatible with either of these SQLite variants. When using the OPFS via sqlite3\_vfs variant we avoid corruption issues, since only one tab writes at a time. When using the OPFS SyncAccessHandle Pool VFS variant, all tabs can have caching thanks to the SharedWorker.

After we confirmed that the architecture worked on both variants, that the performance gain was noticeable in our metrics, and that there were no corruption issues, it was time to make our final choice of which variant to ship. We went with OPFS SyncAccessHandle Pool VFS because it didn’t have the requirement of cross-origin isolation, which would have prevented us from rolling out to any browser beyond Chrome and Edge.

## Mitigating regressions

When we first started shipping this improvement to users, we noticed a few regressions that we had to fix along the way, including slower load times.

### Page load was slower

Our first observation was that while navigating from one Notion page to another was faster, the initial page load was slower. After some profiling, we realized that page load wasn’t typically bottlenecked on data fetching—our app bootup code executes other operations (parsing JS, setting up the app, etc) while waiting for API calls to finish, and thus didn’t stand to benefit from SQLite caching as much as navigation did.

Why was it slower? Because users had to download and process the WASM SQLite library, which blocked the page load process, preventing other page load operations from happening concurrently. Since this library is a few hundred kilobytes, the extra time was noticeable in our metrics.

To fix this, we made a slight modification to how we loaded the library— **we loaded WASM SQLite completely asynchronously and ensured that it didn’t block the page load**. This meant that the initial page data would seldom be loaded from SQLite. This was fine, as **we’d determined objectively that the speed-up from loading the initial page from SQLite did not outweigh the slowdown from downloading the library.**

After pushing this change, our initial page load metric became identical between the experiment’s test group and control group.

### Slow devices didn’t benefit from caching

Another phenomenon we noticed in our metrics was that while the *median* time to navigate from one Notion page to another was faster, the *95th percentile time was slower*. Certain devices, like mobile phones whose browsers were pointed at Notion, didn’t benefit from the caching, and in fact even got worse.

We found the answer to this riddle in a previous investigation run by our mobile team. When they implemented this caching in our native mobile application, some devices, such as older Android phones, read from the disk extremely slowly. We therefore couldn't assume that loading data from the disk cache will be faster than loading the same data from the API.

As a result of this mobile investigation, our page load already had some logic by which we “raced” the two asynchronous requests (SQLite and API) against each other. We simply re-implemented this logic in the code path for navigation clicks. This equalized the 95th percentile of navigation time between our two experiment groups.

## Conclusion

Delivering the performance improvements of SQLite to Notion in the browser had its share of challenges. We faced a series of unknowns, particularly around new technologies, and learned a few lessons along the way:

- OPFS doesn’t come with graceful handling of concurrency out of the box. Developers should be aware of this and design around it.
- Web Workers and SharedWorkers (and their cousin not mentioned in this post, Service Workers) have different capabilities, and it can be useful to combine them if necessary.
- As of spring 2024, fully implementing cross-origin isolation on a sophisticated web application is not easy, especially if you use third-party scripts.

With SQLite for browsers caching data for our users, we’ve seen the aforementioned 20 percent improvement to navigation times and haven’t seen any other metric regress. Importantly, we haven’t observed any issues attributable to SQLite corruption. We credit the success and stability of our final approach to the team behind the official WASM implementation of SQLite, and to Roy Hashimoto and the experimental approaches they made available to the public.

Interested in contributing to this type of work at Notion? Check out our [open roles here →](https://www.notion.so/careers)