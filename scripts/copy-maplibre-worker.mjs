// MapLibre GL v6 runs its renderer in a module worker. Turbopack doesn't emit the worker's
// sibling chunks, so we serve the prebuilt files from /public (see features/settings/office-map.tsx).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const out = new URL("../public/vendor/maplibre/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])
  copyFileSync(join(dist, file), join(out, file));
console.log("copied MapLibre worker to public/vendor/maplibre");
