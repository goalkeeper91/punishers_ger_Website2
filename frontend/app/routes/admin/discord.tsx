import { useEffect, useState } from "react";
import type { ClientLoaderFunction, ClientActionFunction } from "react-router";
import { useLoaderData, useActionData, Form, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

interface ChannelMapping {
  event_type: string;
  channel_id: string;
  channel_label: string | null;
}

interface VoiceTrigger {
  trigger_channel_id: string;
  category_id: string;
  name_prefix: string;
  user_limit: number | null;
  is_private: boolean;
}

interface ReactionRole {
  channel_id: string;
  message_id: string;
  emoji: string;
  role_id: string;
  label: string;
  removable: boolean;
  enabled: boolean;
}

interface DiscordGuild {
  guild_id: string;
  name: string;
  icon_url: string | null;
  member_count: number;
  last_seen_at: string;
  channel_mappings: ChannelMapping[];
  voice_triggers: VoiceTrigger[];
  reaction_roles: ReactionRole[];
}

interface BotStatus {
  online: boolean;
  guild_count?: number | null;
  uptime_seconds?: number | null;
  last_heartbeat?: string | null;
}

interface AnnouncementLogEntry {
  id: number;
  event_type: string;
  guild_name: string | null;
  channel_id: string;
  title: string;
  description: string | null;
  triggered_by_username: string | null;
  success: boolean;
  error_message: string | null;
  created_at: string;
}

const EVENT_TYPES: { key: string; label: string }[] = [
  { key: "match_result", label: "Match-Ergebnisse" },
  { key: "news_published", label: "Neue News-Artikel" },
  { key: "stream_live", label: "Stream-Start" },
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  match_result: "Match-Ergebnis",
  news_published: "News",
  stream_live: "Stream-Start",
  manual: "Manuell",
};

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  try {
    const [statusRes, guildsRes, logRes] = await Promise.all([
      authFetch("/admin/discord/status/"),
      authFetch("/admin/discord/guilds/"),
      authFetch("/admin/discord/log/"),
    ]);
    for (const response of [statusRes, guildsRes, logRes]) {
      if (!response.ok) {
        if (response.status === 401) throw redirect("/login");
        if (response.status === 403) throw redirect("/admin");
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }
    const botStatus: BotStatus = await statusRes.json();
    const guilds: DiscordGuild[] = await guildsRes.json();
    const log: AnnouncementLogEntry[] = await logRes.json();
    return { botStatus, guilds, log };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("Failed to fetch Discord bot data:", error);
    return {
      botStatus: { online: false } as BotStatus,
      guilds: [],
      log: [],
      error: "Discord-Bot-Daten konnten nicht geladen werden.",
    };
  }
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
    </div>
  );
}

export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  try {
    if (intent === "save-channels") {
      const guildId = formData.get("guild_id");
      if (typeof guildId !== "string") {
        return { error: "Invalid form submission." };
      }
      const mappings = EVENT_TYPES.map(({ key }) => ({
        event_type: key,
        channel_id: ((formData.get(`channel_id_${key}`) as string) || "").trim(),
        channel_label: ((formData.get(`channel_label_${key}`) as string) || "").trim() || null,
      })).filter((m) => m.channel_id.length > 0);

      const response = await authFetch(`/admin/discord/guilds/${guildId}/channels/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Kanäle gespeichert." };
    }

    if (intent === "save-voice-triggers") {
      const guildId = formData.get("guild_id");
      const triggersJson = formData.get("triggers_json");
      if (typeof guildId !== "string" || typeof triggersJson !== "string") {
        return { error: "Invalid form submission." };
      }
      let triggers: unknown;
      try {
        triggers = JSON.parse(triggersJson);
      } catch {
        return { error: "Ungültige Trigger-Daten." };
      }
      const response = await authFetch(`/admin/discord/guilds/${guildId}/voice-triggers/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggers }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Sprachkanal-Trigger gespeichert." };
    }

    if (intent === "save-reaction-roles") {
      const guildId = formData.get("guild_id");
      const rolesJson = formData.get("reaction_roles_json");
      if (typeof guildId !== "string" || typeof rolesJson !== "string") {
        return { error: "Invalid form submission." };
      }
      let reaction_roles: unknown;
      try {
        reaction_roles = JSON.parse(rolesJson);
      } catch {
        return { error: "Ungültige Reaction-Role-Daten." };
      }
      const response = await authFetch(`/admin/discord/guilds/${guildId}/reaction-roles/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction_roles }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Reaction-Roles gespeichert." };
    }

    if (intent === "announce") {
      const guildId = formData.get("guild_id");
      const channelId = formData.get("channel_id");
      const title = formData.get("title");
      const description = formData.get("description");
      if (typeof guildId !== "string" || !guildId || typeof channelId !== "string" || !channelId.trim() || typeof title !== "string" || !title.trim()) {
        return { error: "Bitte Server, Kanal-ID und Titel angeben." };
      }
      const response = await authFetch("/admin/discord/announce/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guild_id: guildId,
          channel_id: channelId.trim(),
          title: title.trim(),
          description: typeof description === "string" && description.trim() ? description.trim() : null,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Ankündigung gesendet." };
    }

    return { error: "Unbekannte Aktion." };
  } catch (error: any) {
    console.error("Admin Discord action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

const inputClass =
  "block w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-red-500 focus:border-red-500";

function emptyTrigger(): VoiceTrigger {
  return { trigger_channel_id: "", category_id: "", name_prefix: "Voice", user_limit: null, is_private: false };
}

/** Temporäre Sprachkanäle (Join-to-Create): a variable-length list of
 * trigger channels, kept in local state and serialized into one hidden
 * JSON field on submit - the individual rows aren't real form fields since
 * their count changes at runtime. */
function VoiceTriggersEditor({ guildId, initial }: { guildId: string; initial: VoiceTrigger[] }) {
  const [triggers, setTriggers] = useState<VoiceTrigger[]>(initial);

  const updateTrigger = (index: number, patch: Partial<VoiceTrigger>) => {
    setTriggers((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };
  const removeTrigger = (index: number) => {
    setTriggers((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Form method="post" className="space-y-3 mt-4 pt-4 border-t border-gray-700">
      <input type="hidden" name="intent" value="save-voice-triggers" />
      <input type="hidden" name="guild_id" value={guildId} />
      <input type="hidden" name="triggers_json" value={JSON.stringify(triggers)} />
      <h4 className="text-sm font-semibold text-gray-200">Temporäre Sprachkanäle</h4>
      {triggers.length === 0 && (
        <p className="text-xs text-gray-400">Kein Trigger-Kanal konfiguriert.</p>
      )}
      {triggers.map((trigger, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-5 items-end bg-gray-900/40 rounded-md p-3">
          <div>
            <label className="block text-xs font-medium text-gray-300">Trigger-Kanal-ID</label>
            <input
              type="text"
              value={trigger.trigger_channel_id}
              onChange={(e) => updateTrigger(index, { trigger_channel_id: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300">Ziel-Kategorie-ID</label>
            <input
              type="text"
              value={trigger.category_id}
              onChange={(e) => updateTrigger(index, { category_id: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300">Namens-Präfix</label>
            <input
              type="text"
              value={trigger.name_prefix}
              onChange={(e) => updateTrigger(index, { name_prefix: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300">Nutzerlimit</label>
            <input
              type="number"
              min={0}
              value={trigger.user_limit ?? ""}
              onChange={(e) => updateTrigger(index, { user_limit: e.target.value ? Number(e.target.value) : null })}
              placeholder="kein Limit"
              className={inputClass}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={trigger.is_private}
                onChange={(e) => updateTrigger(index, { is_private: e.target.checked })}
                className="rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-500"
              />
              privat
            </label>
            <button
              type="button"
              onClick={() => removeTrigger(index)}
              className="text-red-400 text-xs hover:text-red-300"
            >
              Entfernen
            </button>
          </div>
        </div>
      ))}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setTriggers((prev) => [...prev, emptyTrigger()])}
          className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500"
        >
          + Trigger hinzufügen
        </button>
        <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">
          Speichern
        </button>
      </div>
    </Form>
  );
}

function emptyReactionRole(): ReactionRole {
  return { channel_id: "", message_id: "", emoji: "✅", role_id: "", label: "", removable: true, enabled: true };
}

/** Reaction-Roles: a variable-length list of message+emoji -> role mappings
 * (e.g. Regel-Akzeptanz with "entfernbar" off, plus one row per Game auf
 * einer "Wähle deine Spiele"-Nachricht mit "entfernbar" an) - same
 * local-state/hidden-JSON pattern as VoiceTriggersEditor above. The admin
 * creates/pins the actual message in Discord by hand and pastes its ID
 * here (the bot doesn't expose a live message picker). */
function ReactionRolesEditor({ guildId, initial }: { guildId: string; initial: ReactionRole[] }) {
  const [roles, setRoles] = useState<ReactionRole[]>(initial);

  const updateRole = (index: number, patch: Partial<ReactionRole>) => {
    setRoles((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const removeRole = (index: number) => {
    setRoles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Form method="post" className="space-y-3 mt-4 pt-4 border-t border-gray-700">
      <input type="hidden" name="intent" value="save-reaction-roles" />
      <input type="hidden" name="guild_id" value={guildId} />
      <input type="hidden" name="reaction_roles_json" value={JSON.stringify(roles)} />
      <h4 className="text-sm font-semibold text-gray-200">Reaction-Roles</h4>
      {roles.length === 0 && (
        <p className="text-xs text-gray-400">Keine Reaction-Role konfiguriert.</p>
      )}
      {roles.map((role, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 items-end bg-gray-900/40 rounded-md p-3">
          <div>
            <label className="block text-xs font-medium text-gray-300">Bezeichnung</label>
            <input
              type="text"
              value={role.label}
              placeholder="z.B. CS2"
              onChange={(e) => updateRole(index, { label: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300">Kanal-ID</label>
            <input
              type="text"
              value={role.channel_id}
              onChange={(e) => updateRole(index, { channel_id: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300">Nachrichten-ID</label>
            <input
              type="text"
              value={role.message_id}
              onChange={(e) => updateRole(index, { message_id: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300">Emoji</label>
            <input
              type="text"
              value={role.emoji}
              placeholder="✅ oder Emoji-ID"
              title="Standard-Emoji direkt einfügen, oder bei eigenen Server-Emojis die Emoji-ID (Rechtsklick auf das Emoji in Discord -> ID kopieren)"
              onChange={(e) => updateRole(index, { emoji: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300">Rollen-ID</label>
            <input
              type="text"
              value={role.role_id}
              onChange={(e) => updateRole(index, { role_id: e.target.value })}
              className={inputClass}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-1.5 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={role.removable}
                  onChange={(e) => updateRole(index, { removable: e.target.checked })}
                  className="rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-500"
                />
                entfernbar
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={role.enabled}
                  onChange={(e) => updateRole(index, { enabled: e.target.checked })}
                  className="rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-500"
                />
                aktiv
              </label>
            </div>
            <button
              type="button"
              onClick={() => removeRole(index)}
              className="text-red-400 text-xs hover:text-red-300"
            >
              Entfernen
            </button>
          </div>
        </div>
      ))}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setRoles((prev) => [...prev, emptyReactionRole()])}
          className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500"
        >
          + Reaction-Role hinzufügen
        </button>
        <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">
          Speichern
        </button>
      </div>
    </Form>
  );
}

export default function AdminDiscordPage() {
  const { botStatus, guilds, log, error: loaderError } = useLoaderData() as {
    botStatus: BotStatus;
    guilds: DiscordGuild[];
    log: AnnouncementLogEntry[];
    error?: string;
  };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  // Live-ish status: the loader's value is a snapshot from page load, so
  // poll the same endpoint client-side to keep the online/offline dot and
  // uptime fresh without a full page reload.
  const [liveStatus, setLiveStatus] = useState<BotStatus>(botStatus);
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const response = await authFetch("/admin/discord/status/");
        if (response.ok) {
          setLiveStatus(await response.json());
        }
      } catch {
        // Silently keep the last known status - a transient poll failure
        // shouldn't flip the indicator to a misleading state.
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="discord" />

        {loaderError && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{loaderError}</div>
        )}
        {actionData?.error && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>
        )}
        {actionData?.success && (
          <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>
        )}

        <h2 className="text-2xl font-bold text-white mb-6">Discord-Bot</h2>

        {/* Status card */}
        <div className="bg-gray-800 rounded-lg shadow-xl p-6 mb-8 flex items-center gap-4">
          <span
            className={`inline-block h-3 w-3 rounded-full ${liveStatus.online ? "bg-green-500" : "bg-red-500"}`}
            aria-hidden="true"
          />
          <div>
            <p className="text-white font-semibold">{liveStatus.online ? "Online" : "Offline"}</p>
            <p className="text-sm text-gray-400">
              {liveStatus.online
                ? `${liveStatus.guild_count ?? 0} Server verbunden${
                    liveStatus.uptime_seconds != null ? ` · Uptime: ${formatUptime(liveStatus.uptime_seconds)}` : ""
                  }`
                : "Bot ist gerade nicht erreichbar (kein Heartbeat)."}
            </p>
          </div>
        </div>

        {/* Guilds + channel routing */}
        <div className="bg-gray-800 rounded-lg shadow-xl p-6 mb-8">
          <h3 className="text-xl font-bold text-white mb-4">Server & Ankündigungs-Kanäle</h3>
          {guilds.length === 0 && (
            <p className="text-sm text-gray-400">
              Der Bot ist noch keinem Server beigetreten (oder war seit dem letzten Neustart dieses Backends noch nicht online).
            </p>
          )}
          <div className="space-y-6">
            {guilds.map((guild) => {
              const mappingByType = Object.fromEntries(guild.channel_mappings.map((m) => [m.event_type, m]));
              return (
                <div key={guild.guild_id} className="border border-gray-700 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-3">
                    {guild.icon_url && (
                      <img src={guild.icon_url} alt="" className="h-8 w-8 rounded-full" />
                    )}
                    <div>
                      <p className="text-white font-semibold">{guild.name}</p>
                      <p className="text-xs text-gray-400">{guild.member_count} Mitglieder · ID: {guild.guild_id}</p>
                    </div>
                  </div>
                  <Form method="post" className="grid gap-3 sm:grid-cols-3">
                    <input type="hidden" name="intent" value="save-channels" />
                    <input type="hidden" name="guild_id" value={guild.guild_id} />
                    {EVENT_TYPES.map(({ key, label }) => (
                      <div key={key} className="space-y-1">
                        <label className="block text-xs font-medium text-gray-300">{label}</label>
                        <input
                          type="text"
                          name={`channel_id_${key}`}
                          placeholder="Channel-ID"
                          defaultValue={mappingByType[key]?.channel_id || ""}
                          className="block w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-red-500 focus:border-red-500"
                        />
                        <input
                          type="text"
                          name={`channel_label_${key}`}
                          placeholder="Notiz (z.B. #match-ergebnisse)"
                          defaultValue={mappingByType[key]?.channel_label || ""}
                          className="block w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-xs focus:outline-none focus:ring-red-500 focus:border-red-500"
                        />
                      </div>
                    ))}
                    <div className="sm:col-span-3">
                      <button
                        type="submit"
                        className="py-1.5 px-4 rounded-md text-white text-sm font-semibold bg-red-600 hover:bg-red-700"
                      >
                        Kanäle speichern
                      </button>
                    </div>
                  </Form>

                  <VoiceTriggersEditor guildId={guild.guild_id} initial={guild.voice_triggers} />
                  <ReactionRolesEditor guildId={guild.guild_id} initial={guild.reaction_roles} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Manual announcement composer */}
        <div className="bg-gray-800 rounded-lg shadow-xl p-6 mb-8">
          <h3 className="text-xl font-bold text-white mb-4">Manuelle Ankündigung senden</h3>
          <Form method="post" className="space-y-4 max-w-xl">
            <input type="hidden" name="intent" value="announce" />
            <div>
              <label className="block text-sm font-medium text-gray-300">Server</label>
              <select
                name="guild_id"
                required
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              >
                {guilds.map((guild) => (
                  <option key={guild.guild_id} value={guild.guild_id}>{guild.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300">Channel-ID</label>
              <input
                type="text"
                name="channel_id"
                required
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300">Titel</label>
              <input
                type="text"
                name="title"
                required
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300">Beschreibung</label>
              <textarea
                name="description"
                rows={3}
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={guilds.length === 0}
              className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Senden
            </button>
          </Form>
        </div>

        {/* Recent log */}
        <div className="overflow-x-auto bg-gray-800 rounded-lg shadow-xl p-6">
          <h3 className="text-xl font-bold text-white mb-4">Letzte Ankündigungen</h3>
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-700">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Typ</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Titel</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Server</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Ausgelöst von</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Zeitpunkt</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {log.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-700">
                  <td className="px-4 py-4 text-sm text-gray-200 whitespace-nowrap">{EVENT_TYPE_LABELS[entry.event_type] || entry.event_type}</td>
                  <td className="px-4 py-4 text-sm text-gray-200">{entry.title}</td>
                  <td className="px-4 py-4 text-sm text-gray-200 whitespace-nowrap">{entry.guild_name || "-"}</td>
                  <td className="px-4 py-4 text-sm text-gray-200 whitespace-nowrap">{entry.triggered_by_username || "Automatisch"}</td>
                  <td className="px-4 py-4 text-sm text-gray-200 whitespace-nowrap">{formatDate(entry.created_at)}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm">
                    {entry.success ? (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Gesendet</span>
                    ) : (
                      <span
                        className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800"
                        title={entry.error_message || undefined}
                      >
                        Fehlgeschlagen
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-400">
                    Noch keine Ankündigungen gesendet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
