import { useEffect, useState } from "react";
import { authFetch, type AuthUser } from "~/lib/auth";
import { getAdminNavItems, type AdminNavKey } from "~/lib/adminNav";

interface AdminNavProps {
  active: AdminNavKey;
}

/** Shows only the sections the current user is actually allowed to open -
 * mirrors the backend's require_roles()/ensure_team_access() checks in
 * fastapi_app/main.py, so a Teammanager/Author never even sees a link that
 * would 403 if clicked. Item list itself lives in ~/lib/adminNav.ts, shared
 * with the Profile page's sidebar. */
export default function AdminNav({ active }: AdminNavProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pendingUsersCount, setPendingUsersCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    authFetch("/users/me/")
      .then((res) => (res.ok ? res.json() : null))
      .then(setUser)
      .catch(() => setUser(null));

    // Not-yet-activated registration count for the "Benutzer & Rollen" badge -
    // 403s silently for anyone without users.manage_users, same "just don't
    // show it" tolerance as every other transient-failure poll in this app.
    authFetch("/admin/users/pending-count/")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPendingUsersCount(data?.count))
      .catch(() => setPendingUsersCount(undefined));
  }, []);

  const items = getAdminNavItems(user, { pendingUsersCount });

  return (
    <nav className="flex flex-wrap gap-3 justify-center mb-10">
      {items.map((item) => (
        <a
          key={item.key}
          href={item.href}
          className={`px-4 py-2 rounded-md font-semibold text-sm transition-colors duration-200 ${
            active === item.key
              ? "bg-red-600 text-white"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
        >
          {item.label}
          {item.badgeCount ? (
            <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-yellow-500 text-gray-900 text-xs font-bold">
              {item.badgeCount}
            </span>
          ) : null}
        </a>
      ))}
    </nav>
  );
}
