import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/attendance",
    name: "First Mate Attendance",
    short_name: "Attendance",
    description: "Location-verified Clock In / Clock Out for the First Mate team.",
    start_url: "/attendance",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f9f9f9",
    theme_color: "#f9f9f9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
