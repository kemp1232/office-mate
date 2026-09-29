"use client";

import { useId, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { searchAddress, type Place } from "./geocode";

/**
 * "Search address" for the office pin. It sits inside the Settings <form>, so it's a plain group
 * (not a nested form) and Enter in the box searches instead of saving the settings.
 */
export function AddressSearch({ onPick }: { onPick: (place: Place) => void }) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [message, setMessage] = useState<string>();

  async function run() {
    if (pending) return;
    setPending(true);
    setMessage(undefined);
    const result = await searchAddress(query);
    setPending(false);
    if (!result.ok) {
      setPlaces(null);
      setMessage(result.message);
      return;
    }
    setPlaces(result.places);
    if (result.places.length === 0)
      setMessage("No matches. Try adding the city, or place the pin on the map.");
  }

  function pick(place: Place) {
    onPick(place);
    setPlaces(null);
    setMessage("Pin placed. Drag it to the exact spot if needed, then save.");
  }

  return (
    <div role="search" aria-label="Find the office address" className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-bold text-ink-strong">
        Search address
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="street-address"
          placeholder="Building, street or area, e.g. Ayala Avenue, Makati"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // don't submit the settings form
              void run();
            }
          }}
          className="min-h-(--button-height) w-full min-w-0 scroll-mb-32 rounded-input border border-line-strong bg-surface px-4 text-base text-ink-strong transition-colors duration-(--duration-base) placeholder:text-ink-muted focus:border-accent"
        />
        <Button
          variant="secondary"
          onClick={run}
          aria-disabled={pending || undefined}
          icon={<Search aria-hidden className="size-5" />}
          className="shrink-0"
        >
          {pending ? "Searching…" : "Search"}
        </Button>
      </div>

      {places && places.length > 0 ? (
        <ul
          aria-label="Matching places"
          className="flex flex-col overflow-hidden rounded-panel border border-stroke"
        >
          {places.map((place) => (
            <li
              key={`${place.latitude},${place.longitude}`}
              className="border-t border-stroke first:border-t-0"
            >
              <button
                type="button"
                onClick={() => pick(place)}
                className="flex min-h-(--touch-min) w-full items-start gap-2 px-4 py-3 text-left text-sm text-ink transition-colors duration-(--duration-base) hover:bg-accent-tint"
              >
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                <span>{place.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-sm text-ink-muted empty:hidden" aria-live="polite">
        {message}
      </p>
      <p className="text-xs text-ink-muted">Address search by OpenStreetMap Nominatim.</p>
    </div>
  );
}
