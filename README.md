# Punishers Germany

Website und Verwaltungssystem für die Esport-Organisation **Punishers Germany**: eine öffentliche Seite (Teams, News, Sponsoren, Content Creators, Bewerbung) plus ein Admin-Dashboard zur Verwaltung von Nutzern, Rollen, Teams, Spielern, News-Artikeln, Sponsoren und Social Links.

## Architektur

Das Backend besteht aus zwei Teilen, die sich dieselbe Datenbank/Models teilen:

- **Django** – ORM, Models, Migrationen und das eingebaute Django-Admin (`/admin/` auf Backend-Seite, nicht zu verwechseln mit dem Frontend-Dashboard unter `/admin` im Frontend).
- **FastAPI** (`backend/fastapi_app/main.py`) – die eigentliche, einzige HTTP-API für das Frontend. Läuft im selben Prozess wie Django (per `django.setup()`), nutzt aber async Views + JWT-Auth statt Django-Sessions.

```
Browser  ──►  React Router Frontend (SSR, Port 5173/3000)
                    │  fetch()
                    ▼
             FastAPI (Port 8000)  ──►  Django ORM  ──►  SQLite
                    ▲
             Django Admin (/admin/, Session-Auth, nur intern)
```

Es gibt **keinen Django REST Framework Layer mehr** – die komplette API läuft über FastAPI mit Pydantic-Schemas.

## Tech-Stack

| Bereich | Technologie |
|---|---|
| Backend-Framework | Django 6 (Models/Admin) + FastAPI (API) |
| Auth | JWT (Access + Refresh Token, PyJWT) |
| Externe API | FACEIT Data API v4 (`requests` + APScheduler für Auto-Sync) |
| Datenbank | SQLite (dev) |
| Bilder-Uploads | Django `ImageField`, lokal unter `backend/media/` |
| Frontend | React Router 7 (SSR), TypeScript, Tailwind CSS 4 |
| Build/Dev-Server | Vite |

## Features

### Öffentliche Seite

- **Home** – Hero-Sektion mit Video-Hintergrund (Produktionsmodus) bzw. animiertem CSS-Placeholder (Sample-Modus), automatisch rotierende Sponsoren-Showcase direkt unter dem Hero, Teams-/Creators-/Join-Us-/Kontakt-Sektionen. Zusätzlich ein schwebendes "Match-Highlight"-Widget unten rechts (nächstes/letztes Match, siehe unten).
- **News** – öffentliche Artikelliste (`/news`) inkl. Detailseite (`/news/:slug`, nur `status=published`) mit Markdown-Rendering (react-markdown; Fett/Kursiv/Überschriften/Listen/Links/Zitate) und sauberen Klartext-Excerpts auf der Listenseite.
- **Teams** – Team-Übersicht mit vollständigem Roster (verknüpfte Spieler-/Nutzerprofile).
- **Sponsoren** – Premium-/allgemeine Partnerliste, gespeist aus echten Backend-Daten; Klicks auf Logos/Website-Links werden gezählt.
- **Content Creators** (`/creators`) – datengetriebene Liste der im Admin als Creator markierten Nutzer, inkl. Live-Badge + Direktlink zum Stream, wenn einer von ihnen gerade auf Twitch live ist (siehe unten). **Beitreten, Kontakt, Impressum, Datenschutz, Über uns** – statische Infoseiten.
- **Registrierung & Login** – Registrierung erstellt ein inaktives Konto (muss von einem Admin freigeschaltet werden), Login liefert ein JWT-Token-Paar.
- **Profil** (`/profile`, `/profile/:username`) – eigenes Profil bearbeiten (Name, Steam-ID, Social Links, Profilbild-Upload), öffentliches Profil einsehen.
- Vollständig **responsive**: funktionierendes Mobile-Menü, Layout bricht nicht mehr bei mittleren Breiten um.
- **Dev/Prod-Asset-Umschaltung** (`VITE_USE_SAMPLE_ASSETS`): im Sample-Modus werden überall offensichtliche Platzhalterbilder verwendet (voll browsbar ohne echte Assets); im Produktionsmodus greifen echte Bilder/Sponsoren, mit neutralem Fallback-Grafik statt kaputter Platzhalter.

### Auth (JWT)

- `POST /register/` – Registrierung (Konto startet inaktiv).
- `POST /login/` – liefert `access_token` (kurzlebig, Standard 60 Min) + `refresh_token` (Standard 30 Tage) + Nutzerdaten.
- `POST /token/refresh/` – neuen Access-Token gegen einen gültigen Refresh-Token tauschen.
- Alle geschützten Endpunkte erwarten `Authorization: Bearer <access_token>`.
- Frontend-seitig übernimmt `frontend/app/lib/auth.ts` (`authFetch`) automatisches Anhängen des Tokens und einmaliges Refreshen bei 401.

### E-Mail-Benachrichtigungen (`backend/users/emails.py`)

- **Konto aktiviert**: Wenn ein Admin einen Nutzer über `PUT /users/{id}/activate/` freischaltet, verschickt der Endpunkt automatisch eine E-Mail ("Dein Konto wurde aktiviert" mit Login-Link) – nur beim Übergang inaktiv → aktiv, nicht bei jedem Speichern.
- **Passwort zurücksetzen** (`POST /password-reset/request/`, `POST /password-reset/confirm/`, Frontend `/forgot-password` + `/reset-password`): Die Anfrage liefert immer dieselbe generische Antwort, unabhängig davon, ob die E-Mail-Adresse existiert (kein Enumerieren von Konten). Der Reset-Link ist ein signiertes JWT (`type=password_reset`, Standard 30 Min gültig) nach demselben Muster wie der Twitch-OAuth-`state`-Parameter – es gibt dafür bewusst **keine eigene DB-Tabelle**: Das Token enthält einen kurzen Fingerabdruck des aktuellen Passwort-Hashes, der sich beim Zurücksetzen automatisch ändert, wodurch der Link danach (oder nach jeder anderen Passwortänderung) von selbst ungültig wird.
- Templates liegen unter `backend/users/templates/emails/` (HTML + Text-Variante je Mail, gemeinsames `base_email.html`-Layout).
- **Kein E-Mail-Anbieter konfiguriert (`EMAIL_HOST` leer) → Mails werden nur in die Server-Konsole geloggt, nichts wird tatsächlich verschickt.** Das ist der Standard in der Entwicklung und erfordert keine Zugangsdaten. Für echten Versand `EMAIL_HOST`/`EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD` setzen (siehe Environment-Variablen) – funktioniert mit jedem SMTP-Anbieter, z. B. einem Gmail-Konto mit App-Passwort oder dem kostenlosen Brevo-Tarif (300 Mails/Tag), da die Organisation aktuell keine Sponsoreneinnahmen hat.

### Admin-Dashboard (Frontend `/admin/*`, erfordert mindestens eine passende Rolle/Permission)

Welche Bereiche sichtbar sind, entscheidet `~/lib/adminNav.ts` (gemeinsam genutzt von `AdminNav` und der Profil-Sidebar) anhand von Rolle **und** den unten beschriebenen Permissions – nicht mehr pauschal "Admin oder eine feste Rolle".

| Bereich | Route | Funktion | Zugriff |
|---|---|---|---|
| Dashboard | `/admin` | Kennzahlen – Inhalt hängt von der Rolle ab (siehe unten) | Admin, Teammanager, Author, oder jede Rolle mit mind. einer der unten genannten Permissions |
| Benutzer & Rollen | `/admin/users` | Aktivieren/Deaktivieren aller Nutzer; **nur für Admin sichtbar:** Rollen anlegen/löschen, Permissions je Rolle setzen, Rollen zuweisen, Admin-Status vergeben/entziehen | Aktivieren/Deaktivieren mit `users.manage_users`-Permission; Rollen-/Rechte-Verwaltung nur Admin |
| News | `/admin/news`, `/new`, `/:id/edit` | Erstellen, bearbeiten, veröffentlichen/zurückziehen, löschen, Titelbild-Upload (nach dem Anlegen auf der Bearbeiten-Seite), Markdown-Formatierung (Toolbar: Fett/Kursiv/Überschrift/Zitat/Listen/Link) | `news.manage_news`-Permission (Author-Rolle hat das automatisch) |
| Teams | `/admin/teams`, `/new`, `/:id/edit` | Team-CRUD, Teambild-Upload, Roster-Verwaltung | Anlegen/Löschen/alle Teams bearbeiten: Admin oder `teams.manage_teams`-Permission; Bearbeiten & Roster des **eigenen** Teams: zusätzlich Teammanager |
| Spieler | `/admin/players/:id/edit` | Einzelnen Spieler bearbeiten, Spielerbild-Upload | Admin, `teams.manage_teams`, oder Teammanager des Teams, dem der Spieler angehört |
| Sponsoren & Socials | `/admin/sponsors` | CRUD für Sponsoren und Social Links, inkl. Klick-Statistik | `sponsors.manage_sponsors`-Permission (oder Admin) |
| Audit-Log | `/admin/audit-log` | Wer hat wann was geändert | nur Admin |

### Rollenbasierte Rechte & echtes Berechtigungssystem

Rollen sind Django-Gruppen (`GET/POST /admin/roles/`, `PUT /admin/users/{id}/roles/`), aber sie sind jetzt **echte Berechtigungsbündel**, keine reinen Anzeige-Labels mehr: jede Rolle bekommt über `PUT /admin/roles/{id}/permissions/` gezielt einzelne der folgenden Django-Permissions zugewiesen (`GET /admin/permissions/` listet sie auf) – eine Rolle kann also z.B. nur Sponsoren verwalten, ohne auch News oder Nutzer anzufassen. Damit lässt sich eine Orga mit mehreren Verantwortlichen abbilden, ohne dass eine Person alles machen muss/kann.

| Permission (`app_label.codename`) | Bedeutung |
|---|---|
| `news.manage_news` | News-Artikel erstellen/bearbeiten/löschen |
| `sponsors.manage_sponsors` | Sponsoren & Social Links verwalten |
| `teams.manage_teams` | **Alle** Teams & Spieler verwalten (nicht nur ein einzelnes) |
| `users.manage_users` | Nutzer aktivieren/deaktivieren |

- **Admin** (`is_superuser`) – uneingeschränkter Zugriff auf alles; besteht jeden `has_perm()`-Check automatisch (Djangos eigenes Verhalten, nicht extra nachgebaut). Admin-Status selbst wird über `PUT /admin/users/{id}/superuser/` vergeben/entzogen (nur durch bereits existierende Admins) – mit eingebauter Schutzsperre gegen versehentliche Selbst-Entmachtung (man kann sich selbst nicht die eigenen Admin-Rechte entziehen, das muss ein anderer Admin tun).
- **Teammanager** (System-Rolle, `backend/users/models.py: ROLE_TEAM_MANAGER`) – darf weiterhin nur das über `CustomUser.team` zugewiesene *eigene* Team verwalten (Bearbeiten, Bild-Upload, Roster). Wer stattdessen **alle** Teams verwalten soll (z.B. ein "Head of Teams" ohne Admin-Status), bekommt die `teams.manage_teams`-Permission auf seiner Rolle – Team anlegen/löschen bleibt aber weiterhin entweder Admin oder `teams.manage_teams` vorbehalten, ein einfacher Teammanager kann sein eigenes Team nicht löschen.
- **Author** (System-Rolle, `ROLE_AUTHOR`) – bekommt automatisch (per Migration `users/migrations/0005_author_gets_manage_news.py`) die `news.manage_news`-Permission und verwaltet damit alle News-Artikel, nicht nur eigene.
- **Beliebige neue Rolle** (z.B. "Community Manager") – im Admin-Dashboard unter „Benutzer & Rollen" anlegen, dann genau die benötigten Permissions ankreuzen (z.B. nur `sponsors.manage_sponsors`) und Nutzern zuweisen.
- Durchgesetzt über `require_permission(codename)` (generischer Permission-Check via Djangos eigenem `user.has_perm()`) sowie weiterhin `require_roles`/`ensure_team_access` für die teambezogene Eigentümer-Logik der Teammanager-Rolle, alles in `fastapi_app/main.py`.
- Das Frontend (`AdminNav`, Profil-Sidebar – beide nutzen denselben `~/lib/adminNav.ts`-Helper) blendet Bereiche, die eine Rolle nicht öffnen darf, direkt aus, statt erst auf ein 403 zu laufen.

### Audit-Log (`GET /admin/audit-log/`, `/admin/audit-log` im Dashboard)

Jede admin-verändernde Aktion (News/Teams/Spieler/Sponsoren/Social-Links anlegen/ändern/löschen, Nutzer aktivieren/deaktivieren, Rollen anlegen/löschen, Berechtigungen zuweisen, Rollen einem Nutzer zuweisen, Admin-Rechte gewähren/entziehen, manueller FACEIT-Sync) schreibt über `_log_action()` einen Eintrag ins `audit_log.AuditLogEntry`-Modell: wer (Snapshot des Benutzernamens, überlebt auch eine spätere Account-Löschung), was, an welcher Ressource, wann, mit optionalen Details (z.B. geänderte Felder oder zugewiesene Rollen). Nur für Superuser einsehbar (`GET /admin/audit-log/`) – das ist bewusst die zentrale Kontrollinstanz des Superadmins, nicht delegierbar.

### FACEIT-Integration (`backend/faceit_integration/`)

Synchronisiert Spieler-Statistiken und Team-Matches von der [FACEIT Data API v4](https://docs.faceit.com/docs/data-api/data). Das nächste/letzte Match wird direkt auf der Startseite angezeigt (siehe unten); Spieler-Stats sind noch nirgends im Frontend sichtbar (siehe "Nächste Schritte").

- **Woher kommen die IDs?** `Player.faceit_player_id` identifiziert den Spieler auf FACEIT. `League.faceit_organizer_id` ist die FACEIT-**Organizer**-ID der Liga (ablesbar aus der URL `faceit.com/de/organizers/<id>/<name>`, z.B. getrennt für DACH CS und ESEA). Da ein Team in mehreren Ligen mit unterschiedlichen FACEIT-Team-IDs registriert sein kann, liegt die FACEIT-Team-ID nicht direkt auf `Team`, sondern auf `TeamLeagueEntry` (Team ↔ League, je Liga eine eigene `faceit_team_id`). Alle drei Felder sind aktuell nur über das **Django-Admin** (`/admin/`, nicht das Frontend-Dashboard) befüllbar.
- **Wie werden Matches gefunden?** Pro Liga: Organizer-ID → alle Championships/Seasons des Organizers (`GET /organizers/{id}/championships`) → Matches jeder Season (`GET /championships/{id}/matches`, upcoming + past) → gefiltert auf Matches, in denen eine unserer registrierten `faceit_team_id` je Liga vorkommt. So werden automatisch auch neue Seasons erfasst, ohne dass eine Championship-ID von Hand nachgetragen werden muss.
- **Was wird gespeichert?** `PlayerFaceitStats` (1:1 zu Player – Nickname, Skill-Level, Elo, Matches, Win-Rate, K/D, Headshot-%, komplette Rohantwort als JSON) und `TeamFaceitMatch` (n:1 zu TeamLeagueEntry – Status upcoming/ongoing/finished/cancelled, Termin, Gegner, Ergebnis, Score, Season-Name). `FaceitSyncRun` protokolliert jeden Lauf (Trigger-Art, Zähler, Fehler).
- **Automatisch:** ein In-Prozess-Scheduler (`faceit_integration/scheduler.py`, APScheduler) läuft direkt im FastAPI-Prozess und synchronisiert alle `FACEIT_SYNC_INTERVAL_MINUTES` (Default 360 = 6h). Kein externer Cron nötig; `FACEIT_SYNC_INTERVAL_MINUTES=0` deaktiviert es.
- **Manuell:** `POST /admin/faceit/sync/` 🔒👑 (synchron, liefert eine Zusammenfassung zurück) oder `python manage.py sync_faceit` auf der Kommandozeile (z.B. für eigenen Cron/Task-Scheduler). `GET /admin/faceit/status/` 🔒👑 zeigt den letzten Lauf.
- Sync-Funktionen brechen nie beim ersten Fehler ab: eine Liga ohne `faceit_organizer_id`, ohne Teams mit `faceit_team_id`, oder ein einzelner falscher Spieler wird übersprungen und geloggt, der Rest läuft weiter.
- Ohne `FACEIT_API_KEY` liefern alle drei Trigger-Wege einen klaren Fehler statt eines Crashs.

### Match-Highlight-Widget (Startseite)

`GET /matches/highlights/` (öffentlich) liefert eine flache Liste: **ein** "nächstes Match" und **ein** "letztes Match" pro Team, das synchronisierte FACEIT-Match-Daten hat (leer, wenn ein Team noch keine Matches hat). Im Frontend zeigt `MatchHighlightWidget` das als schwebende Karte unten rechts auf der Startseite – bewusst kein voller Abschnitt wie bei großen Orgas (NAVI, G2 – siehe Recherche), sondern am "Score Bug"-Muster aus Sport-Streaming-UIs orientiert: kompakt, auffällig durch Slide-in-Animation und Akzentfarbe, aber minimal-invasiv. Rotiert alle 6s durch die komplette Liste, lässt sich minimieren (Pill-Button) oder für die Session komplett schließen (`sessionStorage`).

**Mehrere Teams:** Jedes Team mit Match-Daten bekommt seinen Platz in der Rotation – Haupt- wie Nebenteams gleichberechtigt, keine Bevorzugung nach `is_main_team`. Ein Team ohne synchronisierte Matches liefert einfach keinen Eintrag, statt einen Platzhalter zu erzeugen. Per Test verifiziert: mit einem Haupt- und einem Nebenteam (beide mit Matches) sowie einem dritten Team ganz ohne Matches erscheinen exakt die ersten beiden in der Liste, das dritte korrekt gar nicht.

**Dev/Prod-Trennung:** Die Demo-Karte (`sampleMatchHighlights`) erscheint ausschließlich, wenn `VITE_USE_SAMPLE_ASSETS=true` ist (Dev-Standard) *und* das Backend keine echten Daten liefert – geprüft in `app/lib/publicContent.ts:fetchMatchHighlights`. Im Produktivmodus (`VITE_USE_SAMPLE_ASSETS=false`, `.env.production`) rendert das Widget bei fehlenden Daten **überhaupt nichts** (per echtem Produktions-Build/-Server verifiziert, nicht nur im Dev-Server), um auf der Live-Seite keine Verwirrung durch Fake-Daten zu erzeugen.

### Twitch-Integration & Content Creators

`GET /creators/` (öffentlich) liefert alle Nutzer mit `is_content_creator=True` (Feld im Django-Admin unter Nutzer → "Content Creator", aktuell die einzige Stelle, an der das gesetzt werden kann – keine Frontend-UI dafür), inkl. Live-Status von Twitch für alle, die einen `twitch_link` hinterlegt haben. Das Frontend (`/creators`) zeigt Featured- und restliche Creator getrennt, mit einem pulsierenden "LIVE"-Badge (Titel + Zuschauerzahl) plus Direktlink zum Stream, wenn `live` gesetzt ist.

- **Warum keine Suche nach Stream-Titeln?** Ursprünglich angefragt, um auch fremde Streamer zu erkennen, die zufällig eines unserer Matches casten. Die Twitch Helix API bietet dafür keine Volltextsuche über Stream-Titel – nur eine Kanal-Namens-/Beschreibungssuche (`search/channels`), die Titel nicht durchsucht (offiziell bestätigte Lücke, siehe [twitchdev/issues #762](https://github.com/twitchdev/issues/issues/762), "Channel Search does not search titles"). Deshalb beschränkt sich die Integration bewusst auf die in der DB hinterlegten Creator – kein Scannen fremder Streams.
- **Auth:** OAuth2 Client-Credentials-Flow (App Access Token, kein User-Login/keine Redirect-URL nötig) – `backend/twitch_integration/client.py`. Token wird gecacht und automatisch erneuert (auch bei einem 401 mitten im Request).
- **Kein eigenes Datenmodell:** anders als bei FACEIT wird hier nichts persistiert – Live-Status ist bei jedem Aufruf von `/creators/` frisch von Twitch abgefragt (Helix erlaubt bis zu 100 Kanal-Logins pro Request, wird bei Bedarf automatisch gebatcht).
- **Graceful Degradation:** ohne `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` (oder bei einem Twitch-API-Fehler) liefert `/creators/` weiterhin alle Creator, nur `live` ist dann `null` – kein Crash, nur ein Log-Warning.
- **Dev/Prod-Trennung:** wie bei Sponsoren/Match-Highlights greift `fetchCreators()` (`app/lib/publicContent.ts`) nur dann auf `sampleCreators` (`app/lib/sampleAssets.ts`) zurück, wenn das Backend leer ist *und* `VITE_USE_SAMPLE_ASSETS=true` – verifiziert per echtem Backend-Roundtrip (Creator anlegen → erscheint statt Sample-Daten; wieder löschen → `[]`, im Dev-Server dann Sample-Fallback inkl. Demo-Live-Badge, im Produktions-Build stattdessen der leere "Noch keine Content Creator"-Zustand).

### Stats-Dashboard (`/stats`, erfordert Login)

Rollenbasierte Statistik-Ansicht, getrennt vom Admin-Dashboard (`/admin/*`) – hier bekommt **jeder** eingeloggte Nutzer eine Seite, nicht nur Admin/Teammanager/Author. Backend: `GET /stats/me/`, `GET /stats/teams/`, `GET /stats/teams/{id}/`, `GET /stats/players/`, `GET /stats/players/{id}/` in `fastapi_app/main.py`. Frontend: `app/routes/stats.tsx` (Nav-Link "Statistiken" im Header, nur für eingeloggte Nutzer sichtbar).

| Rolle | Sieht | Endpunkt(e) |
|---|---|---|
| **Admin** | Alle Teams (Übersichtstabelle: Matches, Sieg/Niederlage, Win-Rate, Spielerzahl) und alle Spieler mit vollen FACEIT-Stats (Level, Elo, Matches, Win-Rate, K/D, HS-%) | `GET /stats/teams/`, `GET /stats/players/` |
| **Teammanager ("Team-Captain")** | Eigene Team-Statistiken + die individuellen FACEIT-Stats **aller** Team-Mitglieder | `GET /stats/teams/{eigenes_team_id}/` (mit Roster) |
| **Spieler** | Nur die eigenen FACEIT-Stats + die Team-Statistiken des eigenen Teams – **ohne** Einblick in die individuellen Werte der Mitspieler | `GET /stats/me/` |

- **Team-Statistiken erfassen bewusst nur Maps:** kein aggregiertes Team-KD o.ä., sondern ausschließlich das Map-Sieg/Niederlage-Verhältnis (`TeamFaceitMatch.map_name`). Individuelle Spieler-Stats bleiben getrennt auf Player-Ebene (`PlayerFaceitStats` + `PlayerMatchStats`, siehe unten).
- **Zugriffskontrolle:** durchgesetzt über `_resolve_team_stats_access` / `_resolve_player_stats_access` in `fastapi_app/main.py` – ein Teammanager sieht fremde Teams gar nicht (403), ein Spieler bekommt für sein eigenes Team nur die Map-Zahlen (`players: null` in der Antwort), nie die Kennzahlen seiner Mitspieler. Per echtem HTTP-Roundtrip mit drei Test-Logins (Admin/Captain/Spieler) verifiziert, inkl. aller 403-Fälle.

**CS2-Detailstatistiken pro Match (`PlayerMatchStats`, `faceit_integration/models.py`):** Zusätzlich zu den FACEIT-Lifetime-Stats (`PlayerFaceitStats`) synct `sync_all_match_player_stats()` (`faceit_integration/sync.py`) für jedes beendete Match von `GET /matches/{id}/stats` die detaillierten Rundenstatistiken – ausschließlich für die **eigenen** Roster-Spieler, nie für Gegner. Erfasst werden: Kills/Deaths/Assists, K/D- und K/R-Ratio, Headshot-%, MVPs, Multi-Kills (Triple/Quadro/Penta), sowie FACEITs CS2-"Advanced Stats": Utility-Schaden, Flash-Count & -Erfolgsquote, **geflashte Gegner**, Entry-Count & -Erfolgsquote, 1v1-/1v2-Clutch-Quoten. `TeamFaceitMatch.map_name` wird dabei zusätzlich aus der Match-Stats-Antwort (`round_stats.Map`, die tatsächlich gespielte Map) aktualisiert – zuverlässiger als die reine Veto-Vorhersage aus dem Match-Sync.

- **Bewusst nur FACEIT-Daten in dieser Version:** "Movement" (Laufwege/Positionierung) ist **nicht** enthalten – das steckt nicht in FACEITs API, sondern nur in rohen Demo-Replays (.dem) und bräuchte einen eigenen Demo-Parser (z.B. `demoparser2`/`awpy`) als separates, deutlich aufwändigeres Subsystem. Auf expliziten Wunsch zurückgestellt.
- Erfasst und im Stats-Dashboard sichtbar: `GET /stats/me/` liefert `player.advanced` (aggregiert über alle synchronisierten Matches) + `player.recent_matches` (letzte 10 Matches im Detail). Roster-Tabellen (Admin/Teammanager) zeigen zusätzlich Ø Utility-Schaden, Ø geflashte Gegner und Entry-Rate pro Spieler.
- **Effizienz:** ein einmal gespeichertes `PlayerMatchStats`-Row für ein beendetes Match wird nie erneut abgerufen (FACEITs Zahlen ändern sich für ein beendetes Match nicht mehr) – jeder Sync-Lauf ruft nur noch-nicht-synchronisierte Matches ab, gedeckelt auf 30 pro Lauf (`MAX_MATCH_STATS_PER_RUN`), der Rest folgt beim nächsten Lauf.
- **Nächster Schritt (bewusst noch nicht gebaut):** Trend-Auswertungen ("Verbesserung/Verschlechterung über Zeit") – dafür sind mit `PlayerMatchStats` jetzt erstmals echte Zeitreihen-Rohdaten vorhanden, es gibt aber noch keine Auswertungslogik/UI dafür. Demo-basierte Movement-Stats (s.o.) ebenfalls offen.

### Social-Media-Reichweite (`/admin/social-stats`, erfordert `sponsors.manage_sponsors`)

Für Sponsoren-Reportings: aggregierte Reichweite (Follower/Abos) der Org-eigenen Kanäle, aller Spieler und – daraus abgeleitet – aller Teams. Teams haben bewusst **keine eigenen** Social-Media-Kanäle; die Team-Reichweite ist einfach die Summe der Roster-Spieler-Werte. Backend: `backend/social_stats/` (Modell `PlayerSocialStats`, YouTube-/Discord-Clients, Sync-Logik, In-Prozess-Scheduler + `python manage.py sync_social_stats`), Endpunkte `GET/PUT /admin/social-stats/...` in `fastapi_app/main.py`. Frontend: `app/routes/admin/social-stats.tsx`, `app/lib/socialStats.ts`.

- **YouTube (Abos + Views) und Discord (Mitgliederzahl über die öffentliche Invite-API, kein Bot nötig) werden automatisch synchronisiert** – beide haben eine öffentliche, key-only API ohne Kanal-eigenes OAuth. Twitter/Instagram/TikTok bieten das (Stand heute) nicht mehr an, daher pflegt ein Admin diese Werte manuell über dieselbe Seite (`data_source: "manual"` vs. `"auto"`, mit Zeitstempel).
- **Twitch-Kanäle können per OAuth verbunden werden** (Button auf `/profile` für Spieler, auf `/admin/social-stats` für Org-Kanäle) und synchronisieren danach ebenfalls automatisch – Twitch hat die Follower-Zahl 2023 aus der öffentlichen API entfernt, sie ist seither nur noch über einen `moderator:read:followers`-Scope vom Kanal-Betreiber selbst abrufbar. Modell `social_stats.TwitchAuthorization` speichert Access-/Refresh-Token pro Kanal (Spieler XOR Org-Kanal); `state`-Parameter im OAuth-Flow ist ein signiertes JWT (selbes Secret wie Access-/Refresh-Tokens), da der Redirect von Twitch keinen Authorization-Header mitschickt. Endpunkte: `GET /social-stats/twitch/authorize-url/`, `GET /social-stats/twitch/callback/`, `DELETE /social-stats/twitch/player/`, `DELETE /admin/social-stats/twitch/org/{id}/` in `fastapi_app/main.py`; OAuth-Client-Erweiterungen in `twitch_integration/client.py`.
- **Engagement-Metriken über reine Follower-Zahlen hinaus**: `follower_count`/`view_count`/`like_count`/`comment_count`/`share_count`/`reach_count`/`impressions_count` auf `sponsors.SocialLink`, `social_stats.PlayerSocialStats` und `social_stats.SocialStatsSnapshot` (siehe `social_stats.models.ENGAGEMENT_METRIC_FIELDS`) - reine Follower-Zahlen sagen wenig über echten Sponsoren-Wert aus (gekaufte/inaktive Follower verzerren sie), Views/Likes/Kommentare/Shares/Reichweite/Impressionen liefern ein deutlich vollständigeres Bild für ein Sponsoren-Reporting.
- **Screenshot-Auswertung liest jetzt mehrere Metriken auf einmal** (`POST /social-stats/screenshot/`): ein einzelner Screenshot (z.B. eine Instagram-Insights-Karte mit Followern/Likes/Kommentaren/Shares/Reichweite/Impressionen) füllt alle erkannten Felder gleichzeitig - lokales, kostenloses Tesseract-OCR (`social_stats/ocr_client.py`, kein bezahlter Vision-API-Aufruf), pro Metrik ein eigenes Set an Keywords (`METRIC_KEYWORDS`), Kontextfenster bewusst durch Zeilenumbrüche UND benachbarte Zahlen-Treffer begrenzt (nicht nur eine feste Zeichenanzahl), damit das Label einer Zeile nicht fälschlich der Zahl einer benachbarten Zeile zugeordnet wird. **Gespeichert wird erst, wenn der Mensch die Werte bestätigt/korrigiert und "Speichern" klickt**, das Bild selbst wird nie auf die Festplatte geschrieben (Verarbeitung nur im Arbeitsspeicher der Anfrage). Spieler können darüber auch **ihre eigenen** Twitter/Instagram/TikTok-Werte selbst pflegen (`GET/PUT /social-stats/me/{platform}/`), ohne einen Admin zu bitten.
- **`SocialMetricsCard`** (`frontend/app/components/SocialMetricsCard.tsx`) bündelt Anzeige (Badges, Trend), das komplette Eingabe-Grid für alle Metriken, Screenshot-Upload und Speichern-Button in einer einzigen wiederverwendeten Komponente - ersetzt die vorherige, visuell überladene Einzeilen-Darstellung auf `/admin/social-stats` und `/profile` durch eine Karten-Ansicht.
- **Wachstumstrend (letzte 30 Tage) und Twitch-Zuschauerzahlen** – reine Follower-Zahlen sagen wenig über die tatsächliche Sponsoren-Relevanz aus (gekaufte/inaktive Follower verzerren sie), daher zusätzlich: (1) `social_stats.SocialStatsSnapshot` protokolliert **jede** Follower-/View-Zahl als Zeitreihen-Eintrag statt sie nur zu überschreiben – bei jedem Auto-Sync, jeder manuellen Eingabe, jedem Twitch-Connect und jeder Screenshot-Bestätigung (`social_stats/trends.py: record_follower_snapshot()`), sodass "+12% in 30 Tagen" ganz ohne zusätzliche Plattform-Anbindung berechenbar ist (`compute_follower_trend()`, `TrendSchema` auf jedem Kanal). (2) `social_stats.TwitchViewerSnapshot` loggt bei jedem Sync-Lauf opportunistisch die aktuelle Live-Zuschauerzahl verbundener/verlinkter Twitch-Kanäle (`sync_twitch_viewer_snapshots()`, nutzt den bereits vorhandenen App-Token-Live-Status-Abruf) und liefert Ø/Peak-Zuschauer der letzten 30 Tage (`compute_viewer_stats()`, `ViewerStatsSchema`). Beides sparse/stichprobenartig (im Sync-Intervall), aber ausreichend für ein Richtungssignal ohne dedizierten Dauer-Poller.
- `sponsors.SocialLink` (Org-Kanäle) und `social_stats.PlayerSocialStats` (pro Spieler + Plattform) tragen dieselben Reichweiten-Felder (`follower_count`, `view_count`, `data_source`, `stats_updated_at`, `trend`, `viewer_stats`).
- Zugriffskontrolle: Org-Kanäle und Fremdzugriff auf andere Spieler über dieselbe `sponsors.manage_sponsors`-Permission wie die Sponsoren/Socials-Verwaltung; die neuen `/social-stats/me/...`-Endpunkte brauchen nur ein gültiges Login, da sie strukturell nie eine andere Zeile als die eigene berühren können (kein `user_id`-Parameter).

### Sicherheit

- **SQL-Injection:** ausgeschlossen, da ausschließlich über das Django-ORM auf die Datenbank zugegriffen wird (`.filter()`, `.create()`, `.get()`, ...) – keine rohen SQL-Strings, kein `.raw()`, keine String-Interpolation in Queries irgendwo im Backend.
- **XSS:** React escaped jeden `{variable}`-Ausdruck in JSX automatisch – `dangerouslySetInnerHTML` wird an keiner Stelle im Frontend verwendet. News-Inhalte werden über `react-markdown` gerendert, das nur erkannte Markdown-Syntax in React-Elemente übersetzt und **niemals** rohes HTML interpretiert (kein `rehype-raw`-Plugin) – ein eingefügtes `<script>`-Tag im Artikeltext landet als sichtbarer Text, nicht als ausgeführter Code (per Test verifiziert).
- **Passwörter & Auth:** Django-Passwort-Hashing (PBKDF2, `make_password`/`check_password`), signierte JWTs (kurzlebiger Access-Token + langlebiger Refresh-Token), CORS auf `CORS_ORIGINS` beschränkt. `AUTH_PASSWORD_VALIDATORS` (Mindestlänge, keine zu große Ähnlichkeit zu Benutzername/E-Mail, keine gängigen Passwörter) werden jetzt auch tatsächlich durchgesetzt (`POST /register/`, `POST /password-reset/confirm/`) – vorher nur in `settings.py` konfiguriert, aber nie aufgerufen, da dieses Projekt Djangos eigene Auth-Views komplett umgeht.
- **Keine Konten-Enumeration über E-Mail:** `POST /register/` gibt bei bereits vergebener E-Mail **dieselbe** generische Erfolgsmeldung zurück wie bei einer neuen (kein Konto wird dabei doppelt angelegt, aber der Aufrufer kann den Unterschied nicht erkennen); `POST /password-reset/request/` antwortet unabhängig davon, ob die Adresse existiert, immer identisch. `POST /login/` lieferte zwar schon immer dieselbe Fehlermeldung für "E-Mail unbekannt" und "Passwort falsch", aber der fehlende DB-Treffer ließ sich über die Antwortzeit unterscheiden (kein Passwort-Hash zu prüfen) – jetzt wird bei unbekannter E-Mail trotzdem einmal `make_password()` ausgeführt (gleiches Vorgehen wie Djangos eigenes `ModelBackend.authenticate()`), damit beide Fälle zeitlich nicht unterscheidbar sind. Benutzernamen bleiben bewusst ausgenommen – die sind an anderer Stelle ohnehin öffentlich sichtbar (Rosters, Profile).
- **Deaktivierte Konten:** `is_active` wird bei **jeder** Anfrage geprüft (`get_current_user`, nicht nur beim Login) – ein bereits ausgestelltes Access-Token verliert seinen Zugriff also sofort nach einer Deaktivierung, nicht erst nach Ablauf. `POST /password-reset/confirm/` lehnt zusätzlich deaktivierte Konten ab, falls ein Link kurz vor einer Deaktivierung angefragt wurde.
- **Öffentliche Endpunkte gaben zu viele Nutzerdaten preis (behoben):** `GET /teams/`, `/teams/{id}/` und `/users/{username}/` sind bewusst unauthentifiziert (öffentliche Team-/Profilseiten), lieferten dabei aber das komplette `CustomUserSchema` inklusive **E-Mail-Adresse, `is_staff`/`is_superuser`-Flag und der exakten Rollen-/Berechtigungsliste** jedes Spielers – abrufbar von jedem Browser aus, z.B. direkt über die Konsole (`fetch('/users/irgendeinuser/')`). Jetzt über ein eigenes `PublicUserSchema`/`PublicPlayerSchema`/`PublicTeamSchema` (`fastapi_app/main.py`) auf wirklich öffentliche Felder reduziert (Name, Profilbild, Social-Links) – nach demselben Muster wie das bereits vorhandene `Creator`-Schema für `GET /creators/`. Admin-Endpunkte (`/admin/teams/...`, `/admin/players/...`) sind davon nicht betroffen und liefern weiterhin die vollen Daten.
- **OAuth-Tokens verschlüsselt statt Klartext:** `TwitchAuthorization.access_token`/`refresh_token` (die einzigen in der DB gespeicherten Zugangsdaten Dritter) lagen zuvor im Klartext. Jetzt über ein `EncryptedTextField` (`social_stats/crypto.py`, Fernet/AES-128-CBC+HMAC) transparent verschlüsselt/entschlüsselt – bewusst reversible Verschlüsselung statt Hashing, da diese Werte später wieder für echte Twitch-API-Aufrufe gebraucht werden (anders als ein Passwort, das nie zurückgelesen werden muss). Auch aus dem Django-Admin-Formular entfernt (`exclude`), damit selbst ein Superuser sie dort nie im Klartext sieht.
- **Security-Header:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` auf jeder FastAPI-Antwort. HSTS bewusst nicht gesetzt – das hängt davon ab, dass TLS überhaupt terminiert wird, eine Aufgabe des Deployments/Reverse-Proxys, nicht der Anwendung selbst.
- **Datei-Uploads:** zentrale `save_uploaded_image()`-Helper-Funktion (`fastapi_app/main.py`) für alle 5 Upload-Endpunkte (Profilbild, Team-/Spielerbild, Sponsor-Logo, News-Titelbild) – Endungs-Allowlist (`.jpg/.jpeg/.png/.gif/.webp`), Content-Type-Prüfung und 5 MB-Größenlimit, statt dem Client-Dateinamen blind zu vertrauen.
- **Behobener Bug (Media-Auslieferung):** hochgeladene Bilder waren zuvor **gar nicht abrufbar** – es gab keinen Static-File-Mount im laufenden FastAPI/uvicorn-Prozess (Djangos `static()`-Helper in `urls.py` greift nur unter `manage.py runserver`, das aber gar nicht der aktive Server ist). Jetzt behoben über `app.mount(MEDIA_URL, StaticFiles(directory=MEDIA_ROOT))`.
- **Bekannte, nicht behobene Punkte:** kein Rate-Limiting auf `/login/`/`/register/` (Brute-Force-Schutz wäre ein sinnvoller nächster Schritt); Auth-Tokens liegen im `localStorage` statt in einem httpOnly-Cookie (für die aktuelle Same-Origin-Architektur ausreichend, aber XSS-anfälliger als eine Cookie-Lösung, falls doch einmal eine XSS-Lücke entsteht); keine CSP/HSTS-Security-Header (Deployment-Aufgabe, kein Code-Thema).
- **Dependency-Sicherheit:** `npm audit` lief im Rahmen dieser Änderung sauber durch – dabei wurde eine **High-Severity-Lücke in react-router 7.14.0** entdeckt und behoben (Update auf 7.18.1: u.a. eine RCE-nahe Deserialisierungslücke in `turbo-stream`, ein Open-Redirect und eine CSRF-Schwachstelle), unabhängig vom eigenen Code.

### Nicht (mehr) enthalten / bekannte Lücken

- Kein Django REST Framework mehr (bewusst entfernt zugunsten von FastAPI).
- FACEIT-**Spieler-Statistiken** werden synchronisiert und gespeichert, aber noch **nirgends im Frontend angezeigt** (Matches dagegen schon, siehe oben) – das ist der nächste Schritt, sobald echte FACEIT-IDs hinterlegt sind.
- Content Creator markieren (`is_content_creator`/`is_featured_creator`) geht aktuell nur über das Django-Admin, nicht über das Frontend-Dashboard.
- Kein echtes Hero-Video im Repo enthalten – `frontend/public/videos/hero-background.mp4` muss selbst ergänzt werden, sonst bleibt der CSS-Placeholder aktiv (siehe `VITE_USE_SAMPLE_ASSETS`).

## Projektstruktur

```
backend/
  punishers_ger/       Django-Settings, URLs, .env-Loading
  fastapi_app/main.py  Die komplette API (Auth, News, Teams, Sponsoren, Admin, ...)
  users/                CustomUser-Model (AbstractUser + eSport-Felder)
  teams/                Team- und Player-Models
  news/                 NewsArticle-Model
  sponsors/             Sponsor- und SocialLink-Models (inkl. click_count)
  leagues/              League-Model (+ faceit_organizer_id)
  faceit_integration/   FACEIT-Sync: client.py, sync.py, scheduler.py, models.py
    management/commands/sync_faceit.py   CLI-Befehl für manuelle/Cron-Läufe
  twitch_integration/   Twitch-Helix-Client (App-Token, Live-Stream-Lookup) – kein Django-Model, nichts persistiert
  audit_log/            AuditLogEntry-Modell - Protokoll aller admin-verändernden Aktionen
  media/                Hochgeladene Bilder (gitignored)
  .env / .env.example   Secrets & Konfiguration (.env ist gitignored)

frontend/
  app/routes/           Öffentliche Seiten + admin/* Dashboard-Seiten
  app/routes/admin/      Dashboard, Users, News, Teams, Players, Sponsors
  app/components/        AdminNav, HeroBackground, SponsorRotation
  app/lib/
    auth.ts              JWT-Session-Handling (authFetch, Token-Refresh)
    config.ts             API_BASE_URL / USE_SAMPLE_ASSETS aus Vite-Env
    publicContent.ts       Sponsoren-/Social-Fetches + Klick-Tracking
    sampleAssets.ts         Placeholder-Daten für den Sample-Modus
    adminNav.ts             Rollen-/Permission-basierte Nav-Items - von AdminNav & Profil-Sidebar geteilt
    stats.ts                Stats-Dashboard-Fetches (/stats/...)
    errors.ts               extractErrorMessage() - sicheres Auslesen von FastAPI-Fehlerantworten
  .env.development / .env.production / .env.example
```

## Setup

### Voraussetzungen

- Python 3.11+ mit einem virtuellen Environment unter `.venv/`
- Node.js 20+
- Tesseract-OCR (Systempaket, kein Python-Package) für den Screenshot-Auswertungs-Flow unter `/social-stats/screenshot/`
  (siehe "Social-Media-Reichweite" unten) - Windows: `scoop install tesseract tesseract-languages`, Linux:
  `apt install tesseract-ocr`, macOS: `brew install tesseract`. Ohne installiertes Tesseract liefert der Endpunkt
  einen 503-Fehler statt zu crashen; alle anderen Features funktionieren unabhängig davon weiter.

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env          # Werte anpassen (SECRET_KEY, JWT_SECRET_KEY, ...)
python manage.py migrate
python manage.py createsuperuser
uvicorn fastapi_app.main:app --reload --port 8000
```

Das Django-Backend selbst (`python manage.py runserver`) wird nur für `/admin/` (Django-Admin) und Migrationen gebraucht; die eigentliche API läuft über `uvicorn`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Standardmäßig läuft der Vite-Dev-Server auf Port `5173`. `.env.development` ist bereits so konfiguriert, dass das Backend unter `http://localhost:8000` erwartet wird.

### Produktions-Build (Frontend)

```bash
npm run build
npm run start
```

`.env.production` sollte vor dem Deploy auf die echte Backend-URL zeigen (`VITE_API_BASE_URL`) und `VITE_USE_SAMPLE_ASSETS=false` gesetzt lassen, damit keine Platzhalterbilder in Produktion landen.

## Environment-Variablen

**`backend/.env`** (siehe `backend/.env.example`):

| Variable | Bedeutung | Default |
|---|---|---|
| `DJANGO_SECRET_KEY` | Django Secret Key | – (Pflicht in Produktion) |
| `DJANGO_DEBUG` | Debug-Modus | `True` |
| `DJANGO_ALLOWED_HOSTS` | Kommagetrennte Liste | `localhost,127.0.0.1` |
| `BACKEND_BASE_URL` | Öffentliche URL des FastAPI-Backends (für absolute Media-URLs und den Twitch-OAuth-Redirect) | `http://localhost:8000` |
| `FRONTEND_BASE_URL` | Öffentliche URL des Frontends (Redirect-Ziel nach Twitch-OAuth) | `http://localhost:5173` |
| `CORS_ORIGINS` | Kommagetrennte Liste erlaubter Frontend-Origins | `http://localhost:5173,http://localhost:3000` |
| `JWT_SECRET_KEY` | Signier-Secret für JWTs | fällt auf `DJANGO_SECRET_KEY` zurück |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | Gültigkeit Access-Token | `60` |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | Gültigkeit Refresh-Token | `30` |
| `ENCRYPTION_KEY` | Fernet-Schlüssel zur Verschlüsselung gespeicherter OAuth-Tokens (`social_stats/crypto.py`) – mit `Fernet.generate_key()` erzeugen | wird deterministisch aus `DJANGO_SECRET_KEY` abgeleitet |
| `FACEIT_API_KEY` | Server-Side API Key von [developers.faceit.com](https://developers.faceit.com/) | leer (Sync liefert dann einen Fehler statt zu crashen) |
| `FACEIT_DEFAULT_GAME_ID` | FACEIT-Spiel-ID für Stats-Abfragen | `cs2` |
| `FACEIT_SYNC_INTERVAL_MINUTES` | Intervall des In-Prozess-Schedulers; `0` deaktiviert ihn | `360` |
| `TWITCH_CLIENT_ID` | App-Client-ID von [dev.twitch.tv/console](https://dev.twitch.tv/console) - für den OAuth-Connect-Flow muss dort zusätzlich `{BACKEND_BASE_URL}/social-stats/twitch/callback/` als Redirect-URI eingetragen werden | leer (`/creators/` liefert dann `live: null`; Twitch-Connect liefert 503 statt zu crashen) |
| `TWITCH_CLIENT_SECRET` | App-Client-Secret dazu | leer |
| `YOUTUBE_API_KEY` | API-Key von [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) (YouTube Data API v3 aktivieren) | leer (Social-Stats-Sync überspringt YouTube dann) |
| `SOCIAL_STATS_SYNC_INTERVAL_MINUTES` | Intervall des In-Prozess-Schedulers für Social-Media-Reichweite; `0` deaktiviert ihn | `360` |
| `PASSWORD_RESET_TOKEN_EXPIRE_MINUTES` | Gültigkeit eines Passwort-Reset-Links | `30` |
| `EMAIL_HOST` | SMTP-Server für E-Mail-Versand (Aktivierungs-/Passwort-Reset-Mails) | leer (Mails landen dann nur in der Server-Konsole, es wird nichts verschickt) |
| `EMAIL_PORT` | SMTP-Port | `587` |
| `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` | SMTP-Zugangsdaten (z. B. Gmail-Adresse + App-Passwort, oder ein kostenloser Anbieter wie Brevo) | leer |
| `EMAIL_USE_TLS` | TLS beim SMTP-Versand verwenden | `true` |
| `DEFAULT_FROM_EMAIL` | Absenderadresse | `Punishers Germany <no-reply@punishers.gg>` |

**`frontend/.env.development` / `.env.production`** (siehe `frontend/.env.example`):

| Variable | Bedeutung | Default (dev) |
|---|---|---|
| `VITE_API_BASE_URL` | Backend-URL | `http://localhost:8000` |
| `VITE_USE_SAMPLE_ASSETS` | Placeholder- vs. Produktionsbilder | `true` |

## API-Referenz (Auszug)

Alle Routen liegen unter der FastAPI-App (`backend/fastapi_app/main.py`). `🔒` = Login erforderlich, `🔒👑` = Admin-Login erforderlich.

**Auth & Profil**
- `POST /register/`, `POST /login/`, `POST /token/refresh/`
- `GET /users/me/` 🔒, `PUT /users/me/` 🔒, `POST /users/me/profile_picture/` 🔒
- `GET /users/{username}/` – öffentliches Profil

**News**
- `GET /news/`, `GET /news/{slug}/` – öffentlich, nur veröffentlichte Artikel
- `GET/POST /admin/news/`, `GET/PUT/DELETE /admin/news/{id}/`, `POST /admin/news/{id}/image/` 🔒 (Admin oder Author)

**Teams & Spieler**
- `GET /teams/`, `GET /teams/{id}/` – öffentlich
- `POST/PUT/DELETE /admin/teams/{id}/`, `POST /admin/teams/{id}/image/` 🔒 (Admin oder Teammanager des eigenen Teams; Create/Delete nur Admin)
- `GET/POST/PUT/DELETE /admin/players/...`, `POST /admin/players/{id}/image/` 🔒 (Admin oder Teammanager des Teams des Spielers)

**Match-Highlights**
- `GET /matches/highlights/` – öffentlich, `{ next, last }` fürs Startseiten-Widget

**Content Creators**
- `GET /creators/` – öffentlich, alle als Creator markierten Nutzer inkl. Twitch-Live-Status (`live: null`, falls offline oder Twitch nicht konfiguriert)

**Stats-Dashboard** 🔒
- `GET /stats/me/` – eigene Spieler-Stats (inkl. `advanced`-CS2-Stats + `recent_matches`) + Team-Map-Stats (jeder eingeloggte Nutzer)
- `GET /stats/teams/` 🔒👑, `GET /stats/players/` 🔒👑 – alle Teams / alle Spieler (nur Admin)
- `GET /stats/teams/{id}/` – Map-Stats für alle Team-Mitglieder; Roster-Aufschlüsselung nur für Admin/Teammanager des Teams, sonst 403 bei fremden Teams
- `GET /stats/players/{id}/` – ein einzelner Spieler (Admin, Teammanager des Teams, oder der Spieler selbst)

**Sponsoren & Social Links**
- `GET /sponsors/`, `POST /sponsors/{id}/click/` – öffentlich
- `GET /socials/`, `POST /socials/{id}/click/` – öffentlich
- `GET/POST/PUT/DELETE /admin/sponsors/...`, `POST /admin/sponsors/{id}/logo/` 🔒👑
- `GET/POST/PUT/DELETE /admin/socials/...` 🔒👑

**Nutzerverwaltung, Rollen & Berechtigungen**
- `GET /admin/users/`, `PUT /users/{id}/activate/` – braucht `users.manage_users`-Permission (oder Admin)
- `GET /admin/permissions/` 🔒👑 – Liste verfügbarer Permissions
- `GET/POST/DELETE /admin/roles/` 🔒👑, `PUT /admin/roles/{id}/permissions/` 🔒👑 – Rollen anlegen/löschen und Permissions zuweisen
- `PUT /admin/users/{id}/roles/` 🔒👑 – Rollen einem Nutzer zuweisen
- `PUT /admin/users/{id}/superuser/` 🔒👑 – Admin-Rechte gewähren/entziehen (Selbst-Entmachtung blockiert)

**Audit-Log**
- `GET /admin/audit-log/` 🔒👑 – wer hat wann was geändert (optional `?resource_type=...&limit=...`)

**Dashboard**
- `GET /admin/dashboard/` 🔒👑 – Kennzahlen + Klick-Statistiken

**FACEIT-Sync**
- `POST /admin/faceit/sync/` 🔒👑 – vollständigen Sync manuell anstoßen (synchron, liefert Zusammenfassung)
- `GET /admin/faceit/status/` 🔒👑 – letzter Sync-Lauf (Trigger-Art, Zähler, Fehler)

## Nächste Schritte

- FACEIT-IDs (`Player.faceit_player_id`, `TeamLeagueEntry.faceit_team_id`, `League.faceit_organizer_id`) über das Django-Admin für echte Spieler/Teams/Ligen hinterlegen, dann `python manage.py sync_faceit` testen.
- Trend-Auswertungen im Stats-Dashboard (Verbesserung/Verschlechterung über Zeit) – braucht zuerst eine Historientabelle für `PlayerFaceitStats`-Snapshots, siehe Stats-Dashboard-Sektion oben.
- Content-Creator-Markierung (`is_content_creator`/`is_featured_creator`) auch im Frontend-Dashboard bearbeitbar machen, nicht nur im Django-Admin.
- Automatisches Anlegen eines Default-Admin-Kontos beim Erstsetup (aktuell nur manuell per `manage.py createsuperuser`).
- Echtes Hero-Video ergänzen (`public/videos/hero-background.mp4`).
- Reale Sponsoren-/Social-Daten über das Admin-Dashboard anlegen, sobald verfügbar.
