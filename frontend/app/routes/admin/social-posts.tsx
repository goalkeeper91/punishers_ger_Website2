import { useState } from "react";
import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { useActionData, useLoaderData, useNavigation, redirect, useSubmit } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

interface SocialPostDraft {
  id: number;
  team_id: number;
  team_name: string;
  post_type: "announcement" | "result";
  opponent_name: string | null;
  competition_name: string | null;
  match_datetime: string | null;
  team_maps_won: number | null;
  opponent_maps_won: number | null;
  maps_summary: string | null;
  text_facebook: string;
  text_instagram: string;
  text_x: string;
  image_url: string | null;
  generation_error: string | null;
  created_at: string;
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }
  const response = await authFetch("/admin/social-posts/");
  if (!response.ok) {
    if (response.status === 401) throw redirect("/login");
    if (response.status === 403) throw redirect("/admin");
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const drafts: SocialPostDraft[] = await response.json();
  return { drafts };
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
  const intent = formData.get("_intent");
  const id = formData.get("id");

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  try {
    if (intent === "regenerate") {
      const response = await authFetch(`/admin/social-posts/${id}/regenerate/`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) return { error: extractErrorMessage(data, "Entwurf konnte nicht neu generiert werden.") };
      return { success: "Entwurf neu generiert." };
    }
    if (intent === "delete") {
      const response = await authFetch(`/admin/social-posts/${id}/`, { method: "DELETE" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Entwurf gelöscht." };
    }
    return { error: "Unbekannte Aktion." };
  } catch (error: any) {
    console.error("Social post draft action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

const POST_TYPE_LABELS: Record<string, string> = { announcement: "Ankündigung", result: "Ergebnis" };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can fail (permissions, insecure context) -
          // the text is still visible/selectable in the textarea either way.
        }
      }}
      className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {copied ? "Kopiert!" : "Kopieren"}
    </button>
  );
}

function PlatformText({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
        <CopyButton text={text} />
      </div>
      <textarea
        readOnly
        value={text || "(nicht generiert)"}
        rows={4}
        className="block w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-md text-gray-200 text-sm resize-none focus:outline-none"
      />
    </div>
  );
}

function DraftCard({ draft, isSubmitting }: { draft: SocialPostDraft; isSubmitting: boolean }) {
  const submit = useSubmit();

  return (
    <div className="bg-gray-800 rounded-lg shadow-xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <span className="inline-block mb-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-600/20 text-red-400 uppercase tracking-wide">
            {POST_TYPE_LABELS[draft.post_type] || draft.post_type}
          </span>
          <p className="text-white font-bold">{draft.team_name} vs. {draft.opponent_name || "?"}</p>
          <p className="text-gray-500 text-xs">
            {draft.competition_name}
            {draft.match_datetime && ` · ${new Date(draft.match_datetime).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}`}
            {draft.team_maps_won != null && draft.opponent_maps_won != null && ` · ${draft.team_maps_won}:${draft.opponent_maps_won}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              const fd = new FormData();
              fd.set("_intent", "regenerate");
              fd.set("id", String(draft.id));
              submit(fd, { method: "post" });
            }}
            className="py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500 disabled:opacity-50"
          >
            Neu generieren
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              if (!confirm("Diesen Entwurf wirklich löschen?")) return;
              const fd = new FormData();
              fd.set("_intent", "delete");
              fd.set("id", String(draft.id));
              submit(fd, { method: "post" });
            }}
            className="py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-50"
          >
            Löschen
          </button>
        </div>
      </div>

      {draft.generation_error && (
        <div className="bg-yellow-800/60 text-yellow-100 text-xs p-3 rounded-md mb-4">
          Teilweise fehlgeschlagen: {draft.generation_error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          {draft.image_url ? (
            <>
              <img src={draft.image_url} alt="" className="w-full rounded-md border border-gray-700" />
              <a
                href={draft.image_url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500"
              >
                Bild herunterladen
              </a>
            </>
          ) : (
            <div className="w-full aspect-square rounded-md border border-gray-700 flex items-center justify-center text-gray-500 text-xs">
              Kein Bild generiert
            </div>
          )}
        </div>
        <div className="md:col-span-2 space-y-4">
          <PlatformText label="Facebook" text={draft.text_facebook} />
          <PlatformText label="Instagram" text={draft.text_instagram} />
          <PlatformText label="X" text={draft.text_x} />
        </div>
      </div>
    </div>
  );
}

export default function AdminSocialPostsPage() {
  const { drafts } = useLoaderData() as { drafts: SocialPostDraft[] };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-4xl">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="social-posts" />

        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        <h2 className="text-2xl font-bold text-white mb-2">Social-Media-Post-Entwürfe</h2>
        <p className="text-sm text-gray-400 mb-6">
          Wird automatisch erzeugt, sobald ein Match als bevorstehend synct oder ein Ergebnis feststeht (FACEIT-Sync oder manuelle Erfassung) - Text via lokalem Ollama, Bild als Vorlage mit euren Team-/Match-Daten.
        </p>

        <div className="space-y-6">
          {drafts.map((draft) => (
            <DraftCard key={draft.id} draft={draft} isSubmitting={isSubmitting} />
          ))}
          {drafts.length === 0 && (
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 text-center text-sm text-gray-400">
              Noch keine Entwürfe. Sobald ein Match synct oder erfasst wird, erscheint hier automatisch einer.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
