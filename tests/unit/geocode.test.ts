import { describe, expect, it, vi } from "vitest";
import { searchAddress } from "@/features/settings/geocode";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let clock = 10_000;
const tick = () => (clock += 5_000); // each test searches "later" than the last (1 req/s policy)

describe("address search (Nominatim)", () => {
  it("asks Nominatim for up to 5 matches and returns clean places", async () => {
    const fetch = vi.fn().mockResolvedValue(
      json([
        { display_name: "Ayala Triangle Gardens, Makati", lat: "14.5566", lon: "121.0233" },
        { display_name: "Broken", lat: "abc", lon: "121" },
      ]),
    );
    const result = await searchAddress("  Ayala Triangle ", { fetch, now: tick });
    expect(result).toEqual({
      ok: true,
      places: [{ label: "Ayala Triangle Gardens, Makati", latitude: 14.5566, longitude: 121.0233 }],
    });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: "Ayala Triangle",
      format: "jsonv2",
      limit: "5",
    });
  });

  it("rejects too-short queries without calling the service", async () => {
    const fetch = vi.fn();
    expect(await searchAddress("ab", { fetch, now: tick })).toEqual({
      ok: false,
      message: "Type at least 3 characters.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows at most one search per second", async () => {
    const fetch = vi.fn().mockResolvedValue(json([]));
    const t = tick();
    await searchAddress("Makati", { fetch, now: () => t });
    expect(await searchAddress("Makati", { fetch, now: () => t + 300 })).toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("explains outages and offline plainly", async () => {
    expect(
      await searchAddress("Makati", { fetch: vi.fn().mockResolvedValue(json({}, 503)), now: tick }),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/isn't available right now/),
    });
    expect(
      await searchAddress("Makati", {
        fetch: vi.fn().mockRejectedValue(new TypeError("offline")),
        now: tick,
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/You're offline/),
    });
  });
});
