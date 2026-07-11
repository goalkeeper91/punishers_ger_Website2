import {type ClientLoaderFunction, type ClientActionFunction, useActionData} from "react-router";
import { useLoaderData, Form, redirect } from "react-router";
import { authFetch, isLoggedIn, type AuthUser } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

type UserProfile = AuthUser;

interface Role {
  id: number;
  name: string;
  permissions: string[];
}

interface Permission {
  codename: string;
  label: string;
}

// --- CLIENT LOADER FUNCTION ---
// Runs in the browser, since the session lives in localStorage (see
// app/lib/auth.ts), which the server can't read.
export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  try {
    const meRes = await authFetch("/users/me/");
    if (!meRes.ok) {
      if (meRes.status === 401 || meRes.status === 403) throw redirect("/login");
      throw new Error(`HTTP error! status: ${meRes.status}`);
    }
    const me: UserProfile = await meRes.json();

    const usersRes = await authFetch("/admin/users/");
    if (!usersRes.ok) {
      if (usersRes.status === 401) throw redirect("/login");
      if (usersRes.status === 403) throw redirect("/admin"); // logged in, just lacks users.manage_users
      throw new Error(`HTTP error! status: ${usersRes.status}`);
    }
    const users: UserProfile[] = await usersRes.json();

    // Role/permission administration (who may HOLD which capability) stays
    // superuser-only - a delegated "users.manage_users" holder only gets
    // the activate/deactivate list below, never the control surface itself.
    if (!me.is_superuser) {
      return { users, roles: [] as Role[], permissions: [] as Permission[], isSuperuser: false, currentUserId: me.id };
    }

    const [rolesRes, permsRes] = await Promise.all([
      authFetch("/admin/roles/"),
      authFetch("/admin/permissions/"),
    ]);
    const roles: Role[] = rolesRes.ok ? await rolesRes.json() : [];
    const permissions: Permission[] = permsRes.ok ? await permsRes.json() : [];
    return { users, roles, permissions, isSuperuser: true, currentUserId: me.id };
  } catch (error) {
    if (error instanceof Response) {
      throw error; // Re-throw redirect responses
    }
    console.error("Failed to fetch users for admin dashboard:", error);
    return { users: [], roles: [], permissions: [], isSuperuser: false, currentUserId: null, error: "Failed to load users." };
  }
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
    </div>
  );
}

// --- CLIENT ACTION FUNCTION ---
export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  try {
    if (intent === "createRole") {
      const name = formData.get("name");
      const response = await authFetch("/admin/roles/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { error: extractErrorMessage(data, "Rolle konnte nicht erstellt werden.") };
      }
      return { success: "Rolle erstellt." };
    }

    if (intent === "deleteRole") {
      const roleId = formData.get("roleId");
      const response = await authFetch(`/admin/roles/${roleId}/`, { method: "DELETE" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Rolle gelöscht." };
    }

    if (intent === "setRolePermissions") {
      const roleId = formData.get("roleId");
      const permissions = formData.getAll("permissions").map(String);
      const response = await authFetch(`/admin/roles/${roleId}/permissions/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Berechtigungen aktualisiert." };
    }

    if (intent === "setRoles") {
      const userId = formData.get("userId");
      const roles = formData.getAll("roles").map(String);
      const response = await authFetch(`/admin/users/${userId}/roles/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Rollen aktualisiert." };
    }

    if (intent === "setSuperuser") {
      const userId = formData.get("userId");
      const isSuperuser = formData.get("isSuperuser") === "true";
      const response = await authFetch(`/admin/users/${userId}/superuser/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_superuser: isSuperuser }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        return { error: extractErrorMessage(errorData, "Admin-Status konnte nicht geändert werden.") };
      }
      return { success: isSuperuser ? "Admin-Rechte gewährt." : "Admin-Rechte entzogen." };
    }

    // Default: activate/deactivate toggle
    const userId = formData.get("userId");
    const newStatus = formData.get("newStatus");
    if (typeof userId !== "string" || typeof newStatus !== "string") {
      return { error: "Invalid form submission." };
    }
    const response = await authFetch(`/users/${userId}/activate/`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_active: newStatus === "true" }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
    }

    return { success: "Benutzerstatus erfolgreich aktualisiert!" };
  } catch (error: any) {
    console.error("Admin users action failed:", error);
    return { error: error.message || "Failed to update user." };
  }
};

export default function AdminUsersPage() {
  const loaderData = useLoaderData() as {
    users: UserProfile[];
    roles: Role[];
    permissions: Permission[];
    isSuperuser: boolean;
    currentUserId: number | null;
    error?: string;
  };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  const { users, roles, permissions, isSuperuser, currentUserId, error: loaderError } = loaderData;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="users" />

        {loaderError && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">
            {loaderError}
          </div>
        )}
        {actionData?.error && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">
            {actionData.error}
          </div>
        )}
        {actionData?.success && (
          <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">
            {actionData.success}
          </div>
        )}

        {/* Roles & permissions management - superuser only. Roles are named
            bundles of real permissions (see backend fastapi_app/main.py
            MANAGEABLE_PERMISSIONS): a role only gets to do what's checked
            here, nothing more. */}
        {isSuperuser && (
          <div className="bg-gray-800 rounded-lg shadow-xl p-6 mb-8">
            <h2 className="text-xl font-bold text-white mb-4">Rollen & Berechtigungen</h2>
            <Form method="post" className="flex gap-2 items-end mb-6">
              <input type="hidden" name="_intent" value="createRole" />
              <div>
                <label className="block text-xs text-gray-400 mb-1">Neue Rolle</label>
                <input name="name" required placeholder="z.B. Community Manager" className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-red-500 focus:border-red-500" />
              </div>
              <button type="submit" className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-red-600 hover:bg-red-700">+ Rolle anlegen</button>
            </Form>

            {roles.length === 0 ? (
              <p className="text-sm text-gray-400">Noch keine Rollen angelegt.</p>
            ) : (
              <div className="space-y-4">
                {roles.map((role) => (
                  <div key={role.id} className="bg-gray-900 rounded-md p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-semibold text-white">{role.name}</span>
                      <Form method="post" onSubmit={(e) => { if (!confirm(`Rolle "${role.name}" wirklich löschen?`)) e.preventDefault(); }}>
                        <input type="hidden" name="_intent" value="deleteRole" />
                        <input type="hidden" name="roleId" value={role.id} />
                        <button type="submit" className="text-xs text-red-500 hover:text-red-400">Rolle löschen</button>
                      </Form>
                    </div>
                    <Form method="post" className="flex flex-wrap items-center gap-3">
                      <input type="hidden" name="_intent" value="setRolePermissions" />
                      <input type="hidden" name="roleId" value={role.id} />
                      {permissions.map((perm) => (
                        <label key={perm.codename} className="flex items-center gap-1.5 text-xs text-gray-300">
                          <input
                            type="checkbox"
                            name="permissions"
                            value={perm.codename}
                            defaultChecked={role.permissions.includes(perm.codename)}
                            className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-red-600"
                          />
                          {perm.label}
                        </label>
                      ))}
                      <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500">Speichern</button>
                    </Form>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="overflow-x-auto bg-gray-800 rounded-lg shadow-xl p-6">
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-700">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  ID
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Benutzername
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  E-Mail
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Aktiv
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Rollen
                </th>
                {isSuperuser && (
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Admin
                  </th>
                )}
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Aktionen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-700">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-200">
                    {user.id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">
                    {user.username}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">
                    {user.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {user.is_active ? 'Ja' : 'Nein'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-200">
                    {isSuperuser ? (
                      <Form method="post" className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="_intent" value="setRoles" />
                        <input type="hidden" name="userId" value={user.id} />
                        {roles.map((role) => (
                          <label key={role.id} className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              name="roles"
                              value={role.name}
                              defaultChecked={user.roles.includes(role.name)}
                              className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-red-600"
                            />
                            {role.name}
                          </label>
                        ))}
                        {roles.length === 0 && <span className="text-gray-500 text-xs">Keine Rollen verfügbar</span>}
                        <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500">Speichern</button>
                      </Form>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {user.roles.length === 0 ? (
                          <span className="text-gray-500 text-xs">–</span>
                        ) : (
                          user.roles.map((r) => (
                            <span key={r} className="px-2 py-0.5 bg-gray-700 text-gray-200 text-xs rounded-full">{r}</span>
                          ))
                        )}
                      </div>
                    )}
                  </td>
                  {isSuperuser && (
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {user.is_superuser ? (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800 mr-2">Admin</span>
                      ) : null}
                      <Form method="post" className="inline">
                        <input type="hidden" name="_intent" value="setSuperuser" />
                        <input type="hidden" name="userId" value={user.id} />
                        <input type="hidden" name="isSuperuser" value={String(!user.is_superuser)} />
                        <button
                          type="submit"
                          disabled={user.id === currentUserId && user.is_superuser}
                          title={user.id === currentUserId && user.is_superuser ? "Du kannst dir selbst nicht die Admin-Rechte entziehen." : undefined}
                          className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {user.is_superuser ? "Admin entziehen" : "Admin machen"}
                        </button>
                      </Form>
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Form method="post">
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="newStatus" value={String(!user.is_active)} />
                      <button
                        type="submit"
                        className={`py-2 px-4 rounded-md text-white text-xs font-semibold ${user.is_active ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                      >
                        {user.is_active ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
