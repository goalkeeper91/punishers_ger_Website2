// Which /admin/* sections a user may open, mirroring the backend's
// require_permission()/require_team_management_access()/ensure_team_access()
// checks in fastapi_app/main.py. Shared by AdminNav.tsx (inside /admin/*)
// and the Profile page's sidebar, so both surfaces always agree on what a
// given role can actually reach.

import { hasRole, ROLE_TEAM_MANAGER, type AuthUser } from "./auth";

export type AdminNavKey = "dashboard" | "users" | "news" | "teams" | "sponsors" | "social-stats" | "audit-log" | "site-settings" | "applications" | "discord";

export interface AdminNavItem {
  key: AdminNavKey;
  href: string;
  label: string;
}

export function getAdminNavItems(user: AuthUser | null): AdminNavItem[] {
  if (!user) return [];

  const isAdmin = user.is_superuser;
  const isTeamManager = hasRole(user, ROLE_TEAM_MANAGER);
  // Superuser bypasses has_perm() entirely on the backend, so every check
  // here must fall back to `isAdmin ||` the same way - this exactly
  // mirrors Django's own ModelBackend.has_perm() semantics.
  const hasPerm = (codename: string) => isAdmin || user.permissions.includes(codename);

  const canNews = hasPerm("news.manage_news");
  const canSponsors = hasPerm("sponsors.manage_sponsors");
  const canManageUsers = hasPerm("users.manage_users");
  const canBlanketTeams = hasPerm("teams.manage_teams");
  const canSiteSettings = hasPerm("site_settings.manage_site_settings");
  const canApplications = hasPerm("applications.manage_applications");
  const canDiscordBot = hasPerm("discord_bot.manage_discord_bot");

  const items: AdminNavItem[] = [];

  if (isAdmin || isTeamManager || canNews || canSponsors || canManageUsers || canBlanketTeams || canSiteSettings || canApplications || canDiscordBot) {
    items.push({ key: "dashboard", href: "/admin", label: "Dashboard" });
  }
  if (isAdmin) {
    items.push({ key: "users", href: "/admin/users", label: "Benutzer & Rollen" });
  } else if (canManageUsers) {
    items.push({ key: "users", href: "/admin/users", label: "Benutzer" });
  }
  if (canNews) {
    items.push({ key: "news", href: "/admin/news", label: "News" });
  }
  if (isAdmin || canBlanketTeams) {
    items.push({ key: "teams", href: "/admin/teams", label: "Teams" });
  } else if (isTeamManager) {
    items.push({
      key: "teams",
      href: user.team_id ? `/admin/teams/${user.team_id}/edit` : "/admin",
      label: "Mein Team",
    });
  }
  if (isAdmin || canSponsors) {
    items.push({ key: "sponsors", href: "/admin/sponsors", label: "Sponsoren & Socials" });
    items.push({ key: "social-stats", href: "/admin/social-stats", label: "Reichweite" });
  }
  if (isAdmin || canSiteSettings) {
    items.push({ key: "site-settings", href: "/admin/site-settings", label: "Seiteneinstellungen" });
  }
  if (isAdmin || canApplications || isTeamManager) {
    items.push({ key: "applications", href: "/admin/applications", label: "Bewerbungen" });
  }
  if (isAdmin || canDiscordBot) {
    items.push({ key: "discord", href: "/admin/discord", label: "Discord-Bot" });
  }
  if (isAdmin) {
    items.push({ key: "audit-log", href: "/admin/audit-log", label: "Audit-Log" });
  }

  return items;
}
