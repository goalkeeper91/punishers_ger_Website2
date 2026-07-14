// Centralized runtime config, sourced from Vite env vars (see .env.example).
// Never hardcode the backend URL or asset-mode checks anywhere else.

// VITE_API_BASE_URL is "/api" in production - a relative path, deliberately,
// so the same built image works on any domain via the reverse proxy (see
// .env.production). That resolves fine in the browser (against the current
// page's origin), but every public route's `loader` runs server-side during
// SSR inside this container's Node process, where a relative URL has no
// origin to resolve against - Node's fetch() throws on it. INTERNAL_API_BASE_URL
// (set in docker-compose.yml's frontend service, not a VITE_ build-time var)
// points SSR fetches directly at the backend container instead, over the
// internal Docker network - only read server-side, never touches `process`
// in the browser bundle since `typeof window` short-circuits first.
export const API_BASE_URL: string =
  typeof window === "undefined" && process.env.INTERNAL_API_BASE_URL
    ? process.env.INTERNAL_API_BASE_URL
    : import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// true -> render obvious placeholder images/sponsor logos (dev/demo mode).
// false -> render real production assets, falling back to a neutral "no
// image" graphic where no real asset exists yet.
export const USE_SAMPLE_ASSETS: boolean = import.meta.env.VITE_USE_SAMPLE_ASSETS !== "false";
