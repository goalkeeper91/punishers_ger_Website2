import { useEffect, useRef, useState } from "react";
import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, redirect } from "react-router";
import { authFetch, isLoggedIn, hasRole, ROLE_TEAM_MANAGER, type AuthUser } from "~/lib/auth";
import { API_BASE_URL } from "~/lib/config";
import { extractErrorMessage } from "~/lib/errors";
import { imageFallback } from "~/lib/sampleAssets";
import AdminNav from "~/components/AdminNav";

interface Player {
  id: number;
  ingame_name: string;
  role: string | null;
  image_url: string | null;
  user: { username: string } | null;
}

interface Team {
  id: number;
  name: string;
  game: string;
  description: string | null;
  image_url: string | null;
  is_main_team: boolean;
  players: Player[];
}

interface AvailableUser {
  id: number;
  username: string;
}

interface LeagueOption {
  id: number;
  name: string;
}

interface TeamLeagueEntry {
  id: number;
  league_id: number;
  league_name: string;
  faceit_team_id: string | null;
}

interface TeamMatchMap {
  id: number;
  map_name: string | null;
  team_score: number | null;
  opponent_score: number | null;
  result: string | null;
}

interface TeamMatch {
  id: number;
  league_id: number;
  league_name: string;
  opponent_name: string | null;
  competition_name: string | null;
  finished_at: string | null;
  is_manual: boolean;
  maps: TeamMatchMap[];
  team_maps_won: number;
  opponent_maps_won: number;
}

interface MatchMapDraft {
  map_name: string;
  team_score: string;
  opponent_score: string;
}

const RESULT_LABELS: Record<string, string> = { win: "Sieg", loss: "Niederlage", draw: "Unentschieden" };

const MATCH_FORMATS: { value: string; label: string; maps: number }[] = [
  { value: "bo1", label: "1 Map (Bo1)", maps: 1 },
  { value: "bo2", label: "2 Maps (Bo2)", maps: 2 },
  { value: "bo3", label: "Bo3", maps: 3 },
  { value: "bo5", label: "Bo5", maps: 5 },
];

function emptyMapDraft(): MatchMapDraft {
  return { map_name: "", team_score: "", opponent_score: "" };
}

export const clientLoader: ClientLoaderFunction = async ({ params }) => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  const meResponse = await authFetch("/users/me/");
  if (meResponse.ok) {
    const me: AuthUser = await meResponse.json();
    const isOwnTeam = hasRole(me, ROLE_TEAM_MANAGER) && String(me.team_id) === params.id;
    if (!me.is_superuser && !isOwnTeam) {
      throw redirect("/admin");
    }
  }

  const response = await fetch(`${API_BASE_URL}/teams/${params.id}/`);
  if (!response.ok) {
    if (response.status === 404) {
      throw redirect("/admin/teams");
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const team: Team = await response.json();

  let availableUsers: AvailableUser[] = [];
  const availableUsersResponse = await authFetch("/admin/users/available-for-roster/");
  if (availableUsersResponse.ok) {
    availableUsers = await availableUsersResponse.json();
  }

  let leagues: LeagueOption[] = [];
  let matches: TeamMatch[] = [];
  let leagueEntries: TeamLeagueEntry[] = [];
  const [leaguesResponse, matchesResponse, leagueEntriesResponse] = await Promise.all([
    authFetch("/admin/leagues/"),
    authFetch(`/admin/teams/${params.id}/matches/`),
    authFetch(`/admin/teams/${params.id}/league-entries/`),
  ]);
  if (leaguesResponse.ok) leagues = await leaguesResponse.json();
  if (matchesResponse.ok) matches = await matchesResponse.json();
  if (leagueEntriesResponse.ok) leagueEntries = await leagueEntriesResponse.json();

  return { team, availableUsers, leagues, matches, leagueEntries };
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
    </div>
  );
}

export const clientAction: ClientActionFunction = async ({ request, params }) => {
  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  try {
    if (intent === "update") {
      const response = await authFetch(`/admin/teams/${params.id}/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          game: formData.get("game"),
          description: formData.get("description") || null,
          is_main_team: formData.get("is_main_team") === "on",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { errors: { general: extractErrorMessage(data, "Team konnte nicht gespeichert werden.") } };
      }
      return { success: "Team gespeichert." };
    }

    if (intent === "imageUpload") {
      const file = formData.get("image");
      if (!file || !(file instanceof File) || file.size === 0) {
        return { error: "Keine Datei ausgewählt." };
      }
      const imageFormData = new FormData();
      imageFormData.append("file", file);
      const response = await authFetch(`/admin/teams/${params.id}/image/`, { method: "POST", body: imageFormData });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Bild hochgeladen." };
    }

    if (intent === "addPlayer") {
      const memberType = formData.get("member_type");
      const ingameName = formData.get("ingame_name");
      const role = formData.get("role");

      if (typeof ingameName !== "string" || !ingameName.trim()) {
        return { errors: { ingame_name: "Ingame-Name erforderlich." } };
      }

      let userId: number | null = null;
      if (memberType !== "guest") {
        const rawUserId = formData.get("user_id");
        if (typeof rawUserId !== "string" || !rawUserId) {
          return { errors: { username: "Nutzer auswählen." } };
        }
        userId = Number(rawUserId);
      }

      const response = await authFetch("/admin/players/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_id: Number(params.id),
          ingame_name: ingameName,
          role: role || null,
          user_id: userId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { errors: { general: extractErrorMessage(data, "Spieler konnte nicht hinzugefügt werden.") } };
      }
      return { success: `${ingameName} zum Roster hinzugefügt.` };
    }

    if (intent === "removePlayer") {
      const playerId = formData.get("playerId");
      const response = await authFetch(`/admin/players/${playerId}/`, { method: "DELETE" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Spieler aus dem Roster entfernt." };
    }

    if (intent === "saveFaceitRegistration") {
      const leagueId = formData.get("league_id");
      const faceitTeamId = formData.get("faceit_team_id");
      if (typeof leagueId !== "string" || !leagueId) {
        return { errors: { faceit: "Bitte eine Liga auswählen." } };
      }
      const response = await authFetch(`/admin/teams/${params.id}/league-entries/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          league_id: Number(leagueId),
          faceit_team_id: (faceitTeamId as string)?.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { errors: { faceit: extractErrorMessage(data, "FACEIT-Registrierung konnte nicht gespeichert werden.") } };
      }
      return { success: "FACEIT-Registrierung gespeichert." };
    }

    if (intent === "addMatch") {
      const leagueId = formData.get("league_id");
      const opponentName = formData.get("opponent_name");
      const finishedAt = formData.get("finished_at");
      const mapsJson = formData.get("maps_json");
      if (typeof leagueId !== "string" || !leagueId || typeof opponentName !== "string" || !opponentName.trim() || typeof finishedAt !== "string" || !finishedAt || typeof mapsJson !== "string") {
        return { errors: { match: "Bitte Liga, Gegner, Datum und mindestens eine Map angeben." } };
      }
      let mapDrafts: MatchMapDraft[];
      try {
        mapDrafts = JSON.parse(mapsJson);
      } catch {
        return { errors: { match: "Ungültige Map-Daten." } };
      }
      const maps = mapDrafts
        .filter((m) => m.team_score !== "" && m.opponent_score !== "")
        .map((m) => ({ map_name: m.map_name.trim() || null, team_score: Number(m.team_score), opponent_score: Number(m.opponent_score) }));
      if (maps.length === 0) {
        return { errors: { match: "Bitte für mindestens eine Map beide Scores eintragen." } };
      }
      const competitionName = formData.get("competition_name");
      const response = await authFetch(`/admin/teams/${params.id}/matches/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          league_id: Number(leagueId),
          opponent_name: opponentName.trim(),
          // A plain <input type="date"> gives "YYYY-MM-DD" with no time
          // component - append midnight UTC so it parses as a real
          // datetime instead of failing Pydantic's datetime validation.
          finished_at: `${finishedAt}T00:00:00Z`,
          competition_name: (competitionName as string)?.trim() || null,
          maps,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { errors: { match: extractErrorMessage(data, "Match konnte nicht angelegt werden.") } };
      }
      return { success: "Match hinzugefügt." };
    }

    if (intent === "removeMatch") {
      const matchId = formData.get("matchId");
      const response = await authFetch(`/admin/teams/${params.id}/matches/${matchId}/`, { method: "DELETE" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Match entfernt." };
    }

    return { error: "Unbekannte Aktion." };
  } catch (error: any) {
    console.error("Team edit action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

const matchInputClass = "block w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-red-500 focus:border-red-500";

/** Bo1/Bo2/Bo3/Bo5 - picking a format pre-fills that many empty map rows,
 * but the admin can still add/remove rows freely afterward (e.g. a Bo3
 * that ended 2:0 only ever had 2 maps actually played). Map scores are
 * serialized into one hidden JSON field on submit, same pattern as
 * VoiceTriggersEditor/ReactionRolesEditor in admin/discord.tsx - the
 * per-map win/loss (and the overall X:Y maps-won tally) is derived
 * server-side from these two numbers, not entered separately. */
function AddMatchForm({ leagues, isSubmitting, success, error }: { leagues: LeagueOption[]; isSubmitting: boolean; success?: string; error?: string }) {
  const [format, setFormat] = useState("bo1");
  const [maps, setMaps] = useState<MatchMapDraft[]>([emptyMapDraft()]);
  const formRef = useRef<HTMLFormElement>(null);

  const applyFormat = (value: string) => {
    setFormat(value);
    const count = MATCH_FORMATS.find((f) => f.value === value)?.maps ?? 1;
    setMaps(Array.from({ length: count }, emptyMapDraft));
  };

  const updateMap = (index: number, patch: Partial<MatchMapDraft>) => {
    setMaps((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  // Unlike the other forms on this page, the map rows are controlled state
  // (needed for the dynamic add/remove-map UI), so formRef.reset() alone
  // wouldn't clear them - and other forms on this same page (roster, team
  // details) also set `success`, so only reset on this form's own message,
  // not every unrelated submission elsewhere on the page.
  useEffect(() => {
    if (success === "Match hinzugefügt.") {
      formRef.current?.reset();
      setFormat("bo1");
      setMaps([emptyMapDraft()]);
    }
  }, [success]);

  return (
    <Form method="post" ref={formRef} className="space-y-4">
      <input type="hidden" name="_intent" value="addMatch" />
      <input type="hidden" name="maps_json" value={JSON.stringify(maps)} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <div>
          <label htmlFor="league_id" className="block text-sm font-medium text-gray-300 mb-1">Liga <span className="text-red-500">*</span></label>
          <select id="league_id" name="league_id" required defaultValue="" className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm">
            <option value="" disabled>Bitte wählen...</option>
            {leagues.map((league) => (
              <option key={league.id} value={league.id}>{league.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="opponent_name" className="block text-sm font-medium text-gray-300 mb-1">Gegner <span className="text-red-500">*</span></label>
          <input type="text" id="opponent_name" name="opponent_name" required className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
        </div>
        <div>
          <label htmlFor="finished_at" className="block text-sm font-medium text-gray-300 mb-1">Datum <span className="text-red-500">*</span></label>
          <input type="date" id="finished_at" name="finished_at" required className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
        </div>
        <div>
          <label htmlFor="format" className="block text-sm font-medium text-gray-300 mb-1">Format</label>
          <select id="format" value={format} onChange={(e) => applyFormat(e.target.value)} className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm">
            {MATCH_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label htmlFor="competition_name" className="block text-sm font-medium text-gray-300 mb-1">Wettbewerb/Notiz</label>
          <input type="text" id="competition_name" name="competition_name" placeholder="z.B. Scrim, Community-Cup" className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">Maps <span className="text-red-500">*</span></label>
        {maps.map((map, index) => (
          <div key={index} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center bg-gray-900/40 rounded-md p-3">
            <input
              type="text"
              placeholder={`Map ${index + 1} (z.B. de_mirage)`}
              value={map.map_name}
              onChange={(e) => updateMap(index, { map_name: e.target.value })}
              className={matchInputClass}
            />
            <input
              type="number"
              min={0}
              placeholder="Eigener Score"
              value={map.team_score}
              onChange={(e) => updateMap(index, { team_score: e.target.value })}
              className={matchInputClass}
            />
            <input
              type="number"
              min={0}
              placeholder="Gegner Score"
              value={map.opponent_score}
              onChange={(e) => updateMap(index, { opponent_score: e.target.value })}
              className={matchInputClass}
            />
            <button
              type="button"
              onClick={() => setMaps((prev) => prev.filter((_, i) => i !== index))}
              disabled={maps.length === 1}
              className="text-red-400 text-xs hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Map entfernen
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setMaps((prev) => [...prev, emptyMapDraft()])}
          className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500"
        >
          + Map hinzufügen
        </button>
        <p className="text-xs text-gray-500">
          Bei einer Serie endete nicht jede Map (z.B. Bo3 mit 2:0) - Map-Zeilen ohne beide Scores werden beim Speichern einfach ignoriert.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      <div>
        <button type="submit" disabled={isSubmitting || leagues.length === 0} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
          Match hinzufügen
        </button>
        {leagues.length === 0 && <p className="mt-1 text-xs text-gray-500">Keine Liga verfügbar.</p>}
      </div>
    </Form>
  );
}

export default function AdminTeamEditPage() {
  const { team, availableUsers, leagues, matches, leagueEntries } = useLoaderData() as {
    team: Team;
    availableUsers: AvailableUser[];
    leagues: LeagueOption[];
    matches: TeamMatch[];
    leagueEntries: TeamLeagueEntry[];
  };
  const actionData = useActionData() as
    | { error?: string; success?: string; errors?: { [key: string]: string } }
    | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [memberType, setMemberType] = useState<"registered" | "guest">("registered");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="teams" />

        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.errors?.general && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.errors.general}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        {/* Image */}
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl mb-8">
          <h2 className="text-2xl font-bold text-white mb-6">Teambild</h2>
          <div className="flex flex-col items-center md:flex-row md:items-start gap-8">
            <div className="w-48 h-32 bg-gray-900 rounded-md border border-gray-600 flex items-center justify-center overflow-hidden">
              <img
                className="max-w-full max-h-full object-contain"
                src={team.image_url || imageFallback("https://via.placeholder.com/300x200?text=No+Image")}
                alt={team.name}
              />
            </div>
            <Form method="post" encType="multipart/form-data" className="space-y-4 flex-grow">
              <input type="hidden" name="_intent" value="imageUpload" />
              {/* No forced crop here, unlike the other image uploads - a
                  team logo is shown at many different aspect ratios across
                  the site (grid cards, hero banner), so cropping it to one
                  fixed shape at upload time just cuts it off somewhere else
                  instead. It's rendered with object-contain everywhere so
                  the full logo is always visible. */}
              <input
                type="file"
                id="team_image"
                name="image"
                accept="image/*"
                className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-600 file:text-white hover:file:bg-red-700"
              />
              <button type="submit" disabled={isSubmitting} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
                Bild hochladen
              </button>
            </Form>
          </div>
        </div>

        {/* Details */}
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl mb-8">
          <h2 className="text-2xl font-bold text-white mb-6">Teamdetails</h2>
          <Form method="post" className="space-y-6">
            <input type="hidden" name="_intent" value="update" />
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-300">Name <span className="text-red-500">*</span></label>
              <input type="text" id="name" name="name" defaultValue={team.name} required className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div>
              <label htmlFor="game" className="block text-sm font-medium text-gray-300">Spiel <span className="text-red-500">*</span></label>
              <input type="text" id="game" name="game" defaultValue={team.game} required className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-300">Beschreibung</label>
              <textarea id="description" name="description" rows={4} defaultValue={team.description || ""} className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_main_team" name="is_main_team" defaultChecked={team.is_main_team} className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-500" />
              <label htmlFor="is_main_team" className="text-sm font-medium text-gray-300">Main Team</label>
            </div>
            <button type="submit" disabled={isSubmitting} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
              Speichern
            </button>
          </Form>
        </div>

        {/* Roster */}
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl">
          <h2 className="text-2xl font-bold text-white mb-6">Roster</h2>
          <ul className="divide-y divide-gray-700 mb-6">
            {team.players.map((player) => (
              <li key={player.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white font-medium break-words">{player.ingame_name} {player.role && <span className="text-gray-400 text-sm">({player.role})</span>}</p>
                  <p className="text-gray-500 text-xs">{player.user ? `@${player.user.username}` : "Kein Nutzerkonto"}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <a href={`/admin/players/${player.id}/edit`} className="py-2 px-4 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500">
                    Bearbeiten
                  </a>
                  <Form
                    method="post"
                    onSubmit={(event) => {
                      if (!confirm(`${player.ingame_name} aus dem Roster entfernen?`)) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="_intent" value="removePlayer" />
                    <input type="hidden" name="playerId" value={player.id} />
                    <button type="submit" className="py-2 px-4 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">
                      Entfernen
                    </button>
                  </Form>
                </div>
              </li>
            ))}
            {team.players.length === 0 && <li className="py-3 text-sm text-gray-400">Noch keine Spieler im Roster.</li>}
          </ul>

          <h3 className="text-lg font-bold text-white mb-4">Spieler hinzufügen</h3>
          <Form method="post" className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            <input type="hidden" name="_intent" value="addPlayer" />
            <div className="md:col-span-3 flex gap-6">
              <label className="flex items-center gap-1.5 text-sm text-gray-300">
                <input
                  type="radio"
                  name="member_type"
                  value="registered"
                  checked={memberType === "registered"}
                  onChange={() => setMemberType("registered")}
                  className="text-red-600 focus:ring-red-500"
                />
                Registrierter User
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-300">
                <input
                  type="radio"
                  name="member_type"
                  value="guest"
                  checked={memberType === "guest"}
                  onChange={() => setMemberType("guest")}
                  className="text-red-600 focus:ring-red-500"
                />
                Gast (kein Konto)
              </label>
            </div>
            {memberType === "registered" && (
              <div>
                <label htmlFor="user_id" className="block text-sm font-medium text-gray-300 mb-1">Benutzer <span className="text-red-500">*</span></label>
                <select id="user_id" name="user_id" required defaultValue="" className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm">
                  <option value="" disabled>Bitte wählen...</option>
                  {availableUsers.map((user) => (
                    <option key={user.id} value={user.id}>{user.username}</option>
                  ))}
                </select>
                {availableUsers.length === 0 && <p className="mt-1 text-xs text-gray-500">Keine freien registrierten Nutzer verfügbar.</p>}
                {actionData?.errors?.username && <p className="mt-1 text-sm text-red-500">{actionData.errors.username}</p>}
              </div>
            )}
            <div>
              <label htmlFor="ingame_name" className="block text-sm font-medium text-gray-300 mb-1">Ingame-Name <span className="text-red-500">*</span></label>
              <input type="text" id="ingame_name" name="ingame_name" required className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
              {actionData?.errors?.ingame_name && <p className="mt-1 text-sm text-red-500">{actionData.errors.ingame_name}</p>}
            </div>
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-300 mb-1">Rolle</label>
              <input type="text" id="role" name="role" placeholder="AWPer" className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div className="md:col-span-3">
              <button type="submit" disabled={isSubmitting} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
                Zum Roster hinzufügen
              </button>
            </div>
          </Form>
        </div>

        {/* FACEIT-Registrierung */}
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl mt-8">
          <h2 className="text-2xl font-bold text-white mb-2">FACEIT-Registrierung</h2>
          <p className="text-sm text-gray-400 mb-6">
            Damit der automatische Match-Abgleich für dieses Team in einer Liga funktioniert, braucht die Liga selbst eine FACEIT-Organizer-ID (siehe <a href="/admin/leagues" className="text-red-400 hover:text-red-300">Ligenverwaltung</a>) <strong>und</strong> das Team hier die passende FACEIT-Team-ID für diese Liga.
          </p>
          <ul className="divide-y divide-gray-700 mb-6">
            {leagueEntries.filter((e) => e.faceit_team_id).map((entry) => (
              <li key={entry.id} className="py-2 text-sm text-gray-300">
                {entry.league_name}: <span className="text-gray-400">{entry.faceit_team_id}</span>
              </li>
            ))}
            {leagueEntries.filter((e) => e.faceit_team_id).length === 0 && (
              <li className="py-2 text-sm text-gray-400">Für dieses Team ist noch keine FACEIT-Team-ID hinterlegt.</li>
            )}
          </ul>

          <h3 className="text-lg font-bold text-white mb-4">FACEIT-Team-ID setzen</h3>
          <Form method="post" className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <input type="hidden" name="_intent" value="saveFaceitRegistration" />
            <div>
              <label htmlFor="faceit_league_id" className="block text-sm font-medium text-gray-300 mb-1">Liga <span className="text-red-500">*</span></label>
              <select id="faceit_league_id" name="league_id" required defaultValue="" className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm">
                <option value="" disabled>Bitte wählen...</option>
                {leagues.map((league) => (
                  <option key={league.id} value={league.id}>{league.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="faceit_team_id" className="block text-sm font-medium text-gray-300 mb-1">FACEIT-Team-ID</label>
              <input type="text" id="faceit_team_id" name="faceit_team_id" placeholder="leer lassen zum Entfernen" className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div>
              <button type="submit" disabled={isSubmitting || leagues.length === 0} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
                Speichern
              </button>
            </div>
            {actionData?.errors?.faceit && <p className="md:col-span-3 text-sm text-red-500">{actionData.errors.faceit}</p>}
          </Form>
        </div>

        {/* Matches */}
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl mt-8">
          <h2 className="text-2xl font-bold text-white mb-6">Matches</h2>
          <ul className="divide-y divide-gray-700 mb-6">
            {matches.map((match) => (
              <li key={match.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white font-medium break-words">
                    vs. {match.opponent_name || "?"}
                    {match.maps.length > 1 && ` (${match.team_maps_won}:${match.opponent_maps_won})`}
                    {match.maps.length === 1 && match.maps[0].team_score != null && match.maps[0].opponent_score != null && ` (${match.maps[0].team_score}:${match.maps[0].opponent_score})`}
                    {match.maps.length === 1 && match.maps[0].result && (
                      <span className={`ml-2 text-xs font-semibold ${match.maps[0].result === "win" ? "text-green-400" : match.maps[0].result === "loss" ? "text-red-400" : "text-gray-400"}`}>
                        {RESULT_LABELS[match.maps[0].result!] || match.maps[0].result}
                      </span>
                    )}
                  </p>
                  <p className="text-gray-500 text-xs">
                    {match.league_name}
                    {match.finished_at && ` · ${new Date(match.finished_at).toLocaleDateString("de-DE")}`}
                    {match.is_manual && " · manuell erfasst"}
                  </p>
                  {match.maps.length > 1 && (
                    <ul className="mt-1 space-y-0.5">
                      {match.maps.map((m, i) => (
                        <li key={m.id} className="text-gray-500 text-xs">
                          Map {i + 1}{m.map_name && ` (${m.map_name})`}: {m.team_score ?? "?"}:{m.opponent_score ?? "?"}
                          {m.result && (
                            <span className={`ml-1 font-semibold ${m.result === "win" ? "text-green-400" : m.result === "loss" ? "text-red-400" : "text-gray-400"}`}>
                              {RESULT_LABELS[m.result] || m.result}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Form
                  method="post"
                  onSubmit={(event) => {
                    if (!confirm(`Match gegen ${match.opponent_name || "?"} wirklich entfernen?`)) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="_intent" value="removeMatch" />
                  <input type="hidden" name="matchId" value={match.id} />
                  <button type="submit" className="py-2 px-4 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">
                    Entfernen
                  </button>
                </Form>
              </li>
            ))}
            {matches.length === 0 && <li className="py-3 text-sm text-gray-400">Noch keine Matches erfasst.</li>}
          </ul>

          <h3 className="text-lg font-bold text-white mb-4">Match hinzufügen</h3>
          <AddMatchForm leagues={leagues} isSubmitting={isSubmitting} success={actionData?.success} error={actionData?.errors?.match} />
        </div>

        <div className="mt-6">
          <a href="/admin/teams" className="text-gray-400 hover:text-white text-sm">← Zurück zur Teamliste</a>
        </div>
      </div>
    </div>
  );
}
