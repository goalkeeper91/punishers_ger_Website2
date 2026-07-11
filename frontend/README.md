# Punishers Germany – Frontend

React Router 7 (SSR) + TypeScript + Tailwind CSS 4 Frontend für die Punishers Germany Website und das Admin-Dashboard.

Für die Gesamtübersicht des Projekts (Backend-Architektur, Features, Setup beider Teile, Environment-Variablen, API-Referenz) siehe die [Haupt-README](../README.md).

## Entwicklung

```bash
npm install
cp .env.example .env.development.local   # optional, überschreibt .env.development
npm run dev
```

Läuft standardmäßig auf `http://localhost:5173` und erwartet das Backend unter der in `.env.development` gesetzten `VITE_API_BASE_URL` (Standard: `http://localhost:8000`).

## Build & Start

```bash
npm run build
npm run start
```

## Typecheck

```bash
npm run typecheck
```

## Wichtige Verzeichnisse

- `app/routes/` – öffentliche Seiten (`home.tsx`, `news.tsx`, `teams.tsx`, ...) und `admin/` (Dashboard, Users, News, Teams, Players, Sponsors)
- `app/components/` – `AdminNav`, `HeroBackground`, `SponsorRotation`
- `app/lib/auth.ts` – JWT-Session-Handling (`authFetch`, Token-Refresh)
- `app/lib/config.ts` – `API_BASE_URL` / `USE_SAMPLE_ASSETS` aus den Vite-Env-Variablen
- `app/lib/sampleAssets.ts` – Placeholder-Daten für den Sample-Modus (`VITE_USE_SAMPLE_ASSETS=true`)

## Umgebungsvariablen

Siehe `.env.example`. `.env.development` und `.env.production` sind bereits eingecheckt (enthalten keine Secrets); `.env.local`-Varianten überschreiben sie lokal und sind gitignored.
