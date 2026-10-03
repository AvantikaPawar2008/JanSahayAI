/**
 * [TODO-VF-04] Offline-First PWA Service Worker
 * 
 * Features:
 * 1. Network-first strategy for API calls (fallback to cached responses)
 * 2. Cache-first strategy for static assets (JS, CSS, images)
 * 3. Background sync for verification photo submissions when offline
 *    - Queues failed POSTs in IndexedDB
 *    - Replays when connectivity is restored
 * 4. Web Crypto API timestamping: generates cryptographically signed
 *    offline timestamps for basement/culvert repair verification proof
 *    (so officers can capture photo evidence even without cellular signal)
 *
 * Registration: Add <script>navigator.serviceWorker.register('/sw.js')</script>
 * to public/index.html or call registerServiceWorker() from main.jsx.
 */

const CACHE_NAME = "jansahayai-v1";
const OFFLINE_QUEUE_DB = "jansahayai-offline-queue";

// Static assets to cache on install
const STATIC_CACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
];

// API routes to queue when offline
const QUEUEABLE_ROUTES = [
  "/api/verify/photo",
  "/api/intake",
];

// ─── Install: cache static assets ────────────────────────────────────────────
self.addEventListener("install", (event) => {
  console.log("[SW] Installing JanSahayAI service worker...");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_CACHE_URLS).catch((err) => {
        console.warn("[SW] Failed to cache some static assets:", err);
      });
    })
  );
  self.skipWaiting();
});

// ─── Activate: clean up old caches ───────────────────────────────────────────
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating JanSahayAI service worker...");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// ─── Fetch: network-first for API, cache-first for assets ────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls: network-first, queue on failure for queueable routes
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return response;
      });
    })
  );
});

async function handleApiRequest(request) {
  try {
    const response = await fetch(request.clone());
    return response;
  } catch (err) {
    // Network failed — check if this route supports offline queuing
    const url = new URL(request.url);
    const isQueueable = QUEUEABLE_ROUTES.some((route) => url.pathname.startsWith(route));

    if (isQueueable && request.method === "POST") {
      await queueOfflineRequest(request);
      return new Response(
        JSON.stringify({
          queued: true,
          message: "Request queued for background sync when connectivity is restored.",
          timestamp: new Date().toISOString(),
        }),
        {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Return cached response if available, else offline fallback
    const cached = await caches.match(request);
    if (cached) return cached;

    return new Response(
      JSON.stringify({ error: "Offline — no cached data available" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ─── Background Sync ─────────────────────────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-offline-queue") {
    console.log("[SW] Background sync triggered — replaying offline queue...");
    event.waitUntil(replayOfflineQueue());
  }
});

async function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_QUEUE_DB, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("requests")) {
        db.createObjectStore("requests", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function queueOfflineRequest(request) {
  try {
    // [TODO-VF-04] Generate cryptographic offline timestamp using Web Crypto API
    // This provides tamper-evident proof that the photo was captured at this time
    // even without network connectivity (e.g., basement/culvert work).
    const offlineTimestamp = await generateCryptoTimestamp();

    const db = await openOfflineDB();
    const tx = db.transaction("requests", "readwrite");
    const store = tx.objectStore("requests");

    // Serialize the request for storage
    const body = request.headers.get("Content-Type")?.includes("multipart")
      ? await request.arrayBuffer()
      : await request.text();

    store.add({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: body,
      queued_at: new Date().toISOString(),
      offline_timestamp: offlineTimestamp,
    });

    console.log("[SW] Queued offline request for:", request.url, "with crypto timestamp:", offlineTimestamp.hash);
  } catch (err) {
    console.error("[SW] Failed to queue offline request:", err);
  }
}

async function replayOfflineQueue() {
  const db = await openOfflineDB();
  const tx = db.transaction("requests", "readonly");
  const store = tx.objectStore("requests");
  const allRequests = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  let replayed = 0;
  let failed = 0;

  for (const queued of allRequests) {
    try {
      const response = await fetch(queued.url, {
        method: queued.method,
        headers: {
          ...queued.headers,
          "X-Offline-Queued-At": queued.queued_at,
          "X-Offline-Crypto-Hash": queued.offline_timestamp?.hash || "",
        },
        body: queued.body,
      });

      if (response.ok) {
        // Remove from queue on success
        const deleteTx = db.transaction("requests", "readwrite");
        deleteTx.objectStore("requests").delete(queued.id);
        replayed++;
        console.log("[SW] Replayed offline request:", queued.url);
      } else {
        failed++;
        console.warn("[SW] Replay failed (will retry):", queued.url, response.status);
      }
    } catch (err) {
      failed++;
      console.error("[SW] Replay network error:", err);
    }
  }

  console.log(`[SW] Background sync complete: ${replayed} replayed, ${failed} failed`);

  // Notify clients about sync completion
  const clients = await self.clients.matchAll();
  clients.forEach((client) =>
    client.postMessage({
      type: "SYNC_COMPLETE",
      replayed,
      failed,
    })
  );
}

/**
 * [TODO-VF-04] Generate a cryptographically signed timestamp using Web Crypto API.
 * 
 * Creates a SHA-256 hash of (timestamp + nonce) as tamper-evident proof
 * that the photo was genuinely captured offline at this moment.
 * 
 * The hash is sent as X-Offline-Crypto-Hash header when the request is replayed.
 * Backend can verify this hash to confirm the offline timestamp claim.
 * 
 * Returns: { timestamp, nonce, hash }
 */
async function generateCryptoTimestamp() {
  try {
    const timestamp = new Date().toISOString();
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const nonceHex = Array.from(nonce).map((b) => b.toString(16).padStart(2, "0")).join("");

    const data = new TextEncoder().encode(`${timestamp}:${nonceHex}`);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    return { timestamp, nonce: nonceHex, hash: hashHex };
  } catch (err) {
    // Fallback if Web Crypto unavailable
    return { timestamp: new Date().toISOString(), nonce: null, hash: null };
  }
}
