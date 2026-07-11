import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import { API_BASE_URL } from "~/lib/config";
import { imageFallback } from "~/lib/sampleAssets";

// Removed Remix-specific MetaFunction
// export const meta: MetaFunction = () => {
//   return [
//     { title: "Profil - Punishers Germany" },
//     { name: "description", content: "Dein Benutzerprofil bei Punishers Germany." },
//   ];
// };

interface UserProfile {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  profile_picture_url: string | null;
  steam_id: string | null;
  game_profile_link: string | null;
  twitter_link: string | null;
  twitch_link: string | null;
  youtube_link: string | null;
  team_name: string | null;
}

export const loader: LoaderFunction = async ({ params }) => {
  const username = params.username; // Assuming the route is defined as /profile/:username
  if (!username) {
    return { user: null }; // Or throw an error
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
    const user: UserProfile = await response.json();
    return { user };
  } catch (error) {
    console.error(`Failed to fetch user profile for ${username}:`, error);
    return { user: null };
  }
};

export default function ProfilePage() {
  const { user } = useLoaderData() as { user: UserProfile | null };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
        <h1 className="text-4xl font-bold text-white">Benutzerprofil nicht gefunden.</h1>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-10">Dein Profil</h1>

        <div className="max-w-4xl mx-auto bg-gray-800 p-8 rounded-lg shadow-xl">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
            <div className="flex-shrink-0">
              <img
                className="h-32 w-32 rounded-full object-cover border-4 border-red-600"
                src={user.profile_picture_url || imageFallback("https://via.placeholder.com/150?text=User")}
                alt={`${user.username}'s profile`}
              />
            </div>
            <div className="flex-grow text-center md:text-left">
              <h2 className="text-3xl font-bold text-white mb-2">{user.username}</h2>
              <p className="text-gray-400 text-lg mb-4">{user.email}</p>

              {user.team_name && (
                <p className="text-red-600 text-xl font-semibold mb-2">Team: {user.team_name}</p>
              )}
              {/* Description is not directly in CustomUser, but could be added to Player model */}
              {/* {user.description && (
                <p className="text-gray-300 mb-4">{user.description}</p>
              )} */}

              <div className="flex justify-center md:justify-start space-x-4 mt-4">
                {user.twitch_link && (
                  <a href={user.twitch_link} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">Twitch</a>
                )}
                {user.twitter_link && (
                  <a href={user.twitter_link} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">Twitter</a>
                )}
                {user.youtube_link && (
                  <a href={user.youtube_link} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">YouTube</a>
                )}
                {user.steam_id && (
                  <span className="text-gray-400">Steam ID: {user.steam_id}</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-10 border-t border-gray-700 pt-8">
            <h3 className="text-2xl font-bold text-white mb-4">Profil bearbeiten</h3>
            <form className="space-y-6">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-300">Vorname</label>
                <input
                  type="text"
                  id="firstName"
                  name="firstName"
                  defaultValue={user.first_name}
                  className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-300">Nachname</label>
                <input
                  type="text"
                  id="lastName"
                  name="lastName"
                  defaultValue={user.last_name}
                  className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
              </div>
              {/* Description is not directly in CustomUser, but could be added to Player model */}
              {/* <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-300">Über mich</label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  defaultValue={user.description}
                  className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                ></textarea>
              </div> */}
              {/* Add more fields for social media, steam ID etc. */}
              <button
                type="submit"
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Profil speichern
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
