"use client";

import { useMemo, useRef, useState } from "react";
import Map, { Layer, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Served from /public by scripts/copy-maplibre-worker.mjs (Turbopack can't bundle the worker).
setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");

/** OpenFreeMap: free, no API key, commercial use allowed; attribution rendered by MapLibre. */
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_CENTER = { latitude: 14.5995, longitude: 120.9842, zoom: 11 }; // Metro Manila

export type LatLng = { latitude: number; longitude: number };

type Props = {
  value: LatLng | null;
  radiusM: number;
  onChange: (value: LatLng) => void;
  mapRef?: React.RefObject<MapRef | null>;
};

/** One draggable office pin with its geofence radius. Tap the map to place, drag to move. */
export default function OfficeMap({ value, radiusM, onChange, mapRef }: Props) {
  const localRef = useRef<MapRef>(null);
  const ref = mapRef ?? localRef;
  const [initialView] = useState(() =>
    value ? { latitude: value.latitude, longitude: value.longitude, zoom: 16 } : DEFAULT_CENTER,
  );

  // MapLibre paint needs a literal colour; read the design token (this component is client-only).
  const [accent] = useState(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim(),
  );
  const circle = useMemo(() => (value ? circlePolygon(value, radiusM) : null), [value, radiusM]);

  return (
    <Map
      ref={ref}
      initialViewState={initialView}
      mapStyle={MAP_STYLE}
      style={{ width: "100%", height: "100%" }}
      cooperativeGestures
      attributionControl={{ compact: true }}
      onClick={(e) => onChange({ latitude: e.lngLat.lat, longitude: e.lngLat.lng })}
      // Readiness hook for tests / tooling.
      onLoad={(e) => e.target.getContainer().setAttribute("data-map-ready", "")}
      cursor="crosshair"
    >
      <NavigationControl position="top-right" showCompass={false} />
      {circle ? (
        <Source id="geofence" type="geojson" data={circle}>
          <Layer id="geofence-fill" type="fill" paint={{ "fill-color": accent, "fill-opacity": 0.08 }} />
          <Layer
            id="geofence-line"
            type="line"
            paint={{ "line-color": accent, "line-width": 2, "line-dasharray": [2, 2] }}
          />
        </Source>
      ) : null}
      {value ? (
        <Marker
          latitude={value.latitude}
          longitude={value.longitude}
          draggable
          onDragEnd={(e) => onChange({ latitude: e.lngLat.lat, longitude: e.lngLat.lng })}
        >
          {/* 44px touch target around a 22px pin */}
          <span
            role="img"
            aria-label="Office location pin"
            className="flex size-11 cursor-grab items-center justify-center active:cursor-grabbing"
          >
            <span className="size-5.5 rounded-full border-[3px] border-surface bg-clock-out ring-1 ring-ink/30" />
          </span>
        </Marker>
      ) : null}
    </Map>
  );
}

function circlePolygon(center: LatLng, radiusM: number, steps = 72): GeoJSON.Feature<GeoJSON.Polygon> {
  const R = 6371008.8;
  const lat = (center.latitude * Math.PI) / 180;
  const lng = (center.longitude * Math.PI) / 180;
  const d = radiusM / R;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(brng));
    const lng2 =
      lng +
      Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(lat2));
    coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}
