/**
 * Address search for placing the office pin (Admin only), via OpenStreetMap Nominatim.
 * Usage policy (https://operations.osmfoundation.org/policies/nominatim/): no search-as-you-type,
 * at most 1 request per second, attribution. So we search only on an explicit "Search", and the
 * browser's Referer identifies the app. The result only moves the map; the Admin confirms the pin.
 */
export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export type Place = { label: string; latitude: number; longitude: number };

export type SearchResult = { ok: true; places: Place[] } | { ok: false; message: string };

let lastSearchAt = 0;

export async function searchAddress(
  query: string,
  opts: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<SearchResult> {
  const q = query.trim();
  if (q.length < 3) return { ok: false, message: "Type at least 3 characters." };
  if (q.length > 200) return { ok: false, message: "That address is too long." };

  const now = opts.now ?? Date.now;
  if (now() - lastSearchAt < 1000) return { ok: false, message: "One moment, then search again." };
  lastSearchAt = now();

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", "en");

  try {
    const res = await (opts.fetch ?? fetch)(url, { headers: { accept: "application/json" } });
    if (!res.ok)
      return { ok: false, message: "Address search isn't available right now. Place the pin on the map." };
    const rows = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
    const places = rows
      .map((r) => ({ label: r.display_name ?? "", latitude: Number(r.lat), longitude: Number(r.lon) }))
      .filter(
        (p) =>
          p.label &&
          Number.isFinite(p.latitude) &&
          Number.isFinite(p.longitude) &&
          Math.abs(p.latitude) <= 90 &&
          Math.abs(p.longitude) <= 180,
      );
    return { ok: true, places };
  } catch {
    return { ok: false, message: "You're offline. Check your connection and try again." };
  }
}
