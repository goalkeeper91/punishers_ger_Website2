import type { ClientActionFunction } from "react-router";
import { Form, useActionData, useNavigation } from "react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "~/lib/config";
import { extractErrorMessage } from "~/lib/errors";

const GAMES = ["Counter-Strike 2", "Valorant", "League of Legends", "Rocket League", "Rainbow Six Siege"] as const;

// Tier-only (no sub-divisions/roman numerals) - keeps each dropdown short,
// fine-grained precision isn't that useful for a first-pass application
// screen. CS2 uses FACEIT Level since that's the skill signal already used
// elsewhere on the site (see profile FACEIT linking / faceit_integration).
const RANKS_BY_GAME: Record<string, string[]> = {
  "Counter-Strike 2": Array.from({ length: 10 }, (_, i) => `FACEIT Level ${i + 1}`),
  "Valorant": ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal", "Radiant"],
  "League of Legends": ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Emerald", "Diamond", "Master", "Grandmaster", "Challenger"],
  "Rocket League": ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Champion", "Grand Champion", "Supersonic Legend"],
  "Rainbow Six Siege": ["Copper", "Bronze", "Silver", "Gold", "Platinum", "Emerald", "Diamond", "Champion"],
};

export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const payload = {
    ingame_name: String(formData.get("ingame_name") || ""),
    game: String(formData.get("game") || ""),
    rank: String(formData.get("rank") || ""),
    full_name: String(formData.get("full_name") || "") || null,
    email: String(formData.get("email") || ""),
    discord_tag: String(formData.get("discord_tag") || "") || null,
    age: formData.get("age") ? Number(formData.get("age")) : null,
    message: String(formData.get("message") || "") || null,
  };

  try {
    const response = await fetch(`${API_BASE_URL}/applications/players/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function ApplyPlayerPage() {
  const { t } = useTranslation("apply");
  const actionData = useActionData() as { success?: boolean; error?: string } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [selectedGame, setSelectedGame] = useState<string>(GAMES[0]);
  const rankOptions = RANKS_BY_GAME[selectedGame] || [];

  const inputClass = "mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm";
  const labelClass = "block text-sm font-medium text-gray-300";

  if (actionData?.success) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
        <div className="max-w-xl mx-auto text-center px-4 py-24">
          <h1 className="text-4xl font-bold text-white mb-4">{t("success.heading")}</h1>
          <p className="text-gray-300 mb-8">{t("success.description")}</p>
          <a href="/join-us" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-8 rounded-full transition-colors duration-300">
            {t("success.back")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main className="py-16 md:py-24">
        <div className="max-w-2xl mx-auto px-4">
          <h1 className="text-4xl font-bold text-white mb-2 text-center">{t("heading")}</h1>
          <p className="text-gray-400 mb-10 text-center">{t("description")}</p>

          {actionData?.error && (
            <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>
          )}

          <Form method="post" className="bg-gray-800 p-8 rounded-lg shadow-xl space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="ingame_name" className={labelClass}>{t("fields.ingame_name")} <span className="text-red-500">*</span></label>
                <input type="text" id="ingame_name" name="ingame_name" required className={inputClass} />
              </div>
              <div>
                <label htmlFor="game" className={labelClass}>{t("fields.game")}</label>
                <select
                  id="game"
                  name="game"
                  value={selectedGame}
                  onChange={(e) => setSelectedGame(e.target.value)}
                  className={inputClass}
                >
                  {GAMES.map((game) => (
                    <option key={game} value={game}>{game}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="rank" className={labelClass}>{t("fields.rank")} <span className="text-red-500">*</span></label>
                <select id="rank" name="rank" required className={inputClass}>
                  {rankOptions.map((rank) => (
                    <option key={rank} value={rank}>{rank}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="full_name" className={labelClass}>{t("fields.full_name")}</label>
                <input type="text" id="full_name" name="full_name" className={inputClass} />
              </div>
              <div>
                <label htmlFor="email" className={labelClass}>{t("fields.email")} <span className="text-red-500">*</span></label>
                <input type="email" id="email" name="email" required className={inputClass} />
              </div>
              <div>
                <label htmlFor="discord_tag" className={labelClass}>{t("fields.discord_tag")}</label>
                <input type="text" id="discord_tag" name="discord_tag" placeholder="username" className={inputClass} />
              </div>
              <div>
                <label htmlFor="age" className={labelClass}>{t("fields.age")}</label>
                <input type="number" id="age" name="age" min={1} max={120} className={inputClass} />
              </div>
            </div>
            <div>
              <label htmlFor="message" className={labelClass}>{t("fields.message")}</label>
              <textarea id="message" name="message" rows={4} className={inputClass} />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full inline-flex justify-center py-3 px-4 border border-transparent shadow-sm text-base font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t("submitting") : t("submit")}
            </button>
          </Form>
        </div>
      </main>
    </div>
  );
}
