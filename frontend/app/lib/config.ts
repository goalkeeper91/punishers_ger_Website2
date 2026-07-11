// Centralized runtime config, sourced from Vite env vars (see .env.example).
// Never hardcode the backend URL or asset-mode checks anywhere else.

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// true -> render obvious placeholder images/sponsor logos (dev/demo mode).
// false -> render real production assets, falling back to a neutral "no
// image" graphic where no real asset exists yet.
export const USE_SAMPLE_ASSETS: boolean = import.meta.env.VITE_USE_SAMPLE_ASSETS !== "false";
