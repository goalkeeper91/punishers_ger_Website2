import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import { API_BASE_URL } from "~/lib/config";
import { imageFallback } from "~/lib/sampleAssets";

// Public player card - the backend endpoint (GET /users/{username}/) is
// unauthenticated by design, so it only ever returns public-safe fields
// (see fastapi_app/main.py PublicUserSchema). No email, Steam ID, roles or
// anything else personenbezogen shows up here even to a signed-out visitor.
interface PublicUserProfile {
  id: number;
  username: string;
  profile_picture_url: string | null;
  game_profile_link: string | null;
  twitter_link: string | null;
  twitch_link: string | null;
  youtube_link: string | null;
  instagram_link: string | null;
  tiktok_link: string | null;
}

export const loader: LoaderFunction = async ({ params }) => {
  const username = params.username;
  if (!username) {
    return { user: null };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/users/${username}/`);
    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`User ${username} not found.`);
        return { user: null };
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const user: PublicUserProfile = await response.json();
    return { user };
  } catch (error) {
    console.error(`Failed to fetch user profile for ${username}:`, error);
    return { user: null };
  }
};

export default function ProfilePage() {
  const { user } = useLoaderData() as { user: PublicUserProfile | null };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
        <h1 className="text-4xl font-bold text-white">Benutzerprofil nicht gefunden.</h1>
      </div>
    );
  }

  const links = [
    { href: user.twitch_link, label: "Twitch" },
    { href: user.twitter_link, label: "Twitter" },
    { href: user.youtube_link, label: "YouTube" },
    { href: user.instagram_link, label: "Instagram" },
    { href: user.tiktok_link, label: "TikTok" },
    { href: user.game_profile_link, label: "Spielerprofil" },
  ].filter((link) => link.href);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <div className="max-w-2xl mx-auto bg-gray-800 p-8 rounded-lg shadow-xl">
          <div className="flex flex-col items-center text-center gap-4">
            <img
              className="h-32 w-32 rounded-full object-cover border-4 border-red-600"
              src={user.profile_picture_url || imageFallback("https://via.placeholder.com/150?text=User")}
              alt={`${user.username}'s profile`}
            />
            <h1 className="text-3xl font-bold text-white">{user.username}</h1>

            {links.length > 0 && (
              <div className="flex flex-wrap justify-center gap-4 mt-2">
                {links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-red-600 transition-colors duration-300"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
