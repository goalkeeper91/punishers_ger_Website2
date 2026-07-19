// Which /admin/* sections a user may open, mirroring the backend's
// require_permission()/require_team_management_access()/ensure_team_access()
// checks in fastapi_app/main.py. Shared by AdminNav.tsx (inside /admin/*)
// and the Profile page's sidebar, so both surfaces always agree on what a
// given role can actually reach.

import { hasRole, ROLE_TEAM_MANAGER, type AuthUser } from "./auth";

export type AdminNavKey = "dashboard" | "users" | "news" | "teams" | "sponsors" | "social-stats" | "audit-log" | "site-settings" | "applications" | "discord" | "social-media" | "gameservers";

export interface AdminNavItem {
  key: AdminNavKey;
  href: string;
  label: string;
  badgeCount?: number;
}

export function getAdminNavItems(
  user: AuthUser | null,
  opts?: { pendingUsersCount?: number; pendingApplicationsCount?: number },
): AdminNavItem[] {
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
  const canSocialMediaVault = hasPerm("social_media.manage_social_media_vault");
  const canGameservers = hasPerm("gameservers.manage_gameservers");

  const items: AdminNavItem[] = [];

  if (isAdmin || isTeamManager || canNews || canSponsors || canManageUsers || canBlanketTeams || canSiteSettings || canApplications || canDiscordBot || canSocialMediaVault || canGameservers) {
    items.push({ key: "dashboard", href: "/admin", label: "Dashboard" });
  }
  const pendingUsersCount = opts?.pendingUsersCount;
  if (isAdmin) {
    items.push({ key: "users", href: "/admin/users", label: "Benutzer & Rollen", badgeCount: pendingUsersCount });
  } else if (canManageUsers) {
    items.push({ key: "users", href: "/admin/users", label: "Benutzer", badgeCount: pendingUsersCount });
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
    items.push({ key: "applications", href: "/admin/applications", label: "Bewerbungen", badgeCount: opts?.pendingApplicationsCount });
  }
  if (isAdmin || canDiscordBot) {
    items.push({ key: "discord", href: "/admin/discord", label: "Discord-Bot" });
  }
  if (isAdmin || canSocialMediaVault) {
    items.push({ key: "social-media", href: "/admin/social-media", label: "Social Media" });
  }
  if (isAdmin || canGameservers) {
    // Teammanagers don't get this automatically yet - the shared VPS power
    // switch affects every team at once, unlike Praccs (a later phase,
    // scoped per-team like Applications/Teams). An admin can still grant
    // gameservers.manage_gameservers to a specific Teammanager via the
    // existing roles UI if desired.
    items.push({ key: "gameservers", href: "/admin/gameservers", label: "Gameserver" });
  }
  if (isAdmin) {
    items.push({ key: "audit-log", href: "/admin/audit-log", label: "Audit-Log" });
  }

  return items;
}
