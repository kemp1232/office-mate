"use client";

import { useEffect } from "react";

/** Registers the minimal offline-fallback service worker (production only). */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Installability and attendance don't depend on the worker; ignore failures.
    });
  }, []);
  return null;
}
