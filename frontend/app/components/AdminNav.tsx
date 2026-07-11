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

  useEffect(() => {
    authFetch("/users/me/")
      .then((res) => (res.ok ? res.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const items = getAdminNavItems(user);

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
        </a>
      ))}
    </nav>
  );
}
