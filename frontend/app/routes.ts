import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("/news", "routes/news.tsx"),
  route("/news/:slug", "routes/news.$slug.tsx"),
  route("/teams", "routes/teams.tsx"),
  route("/teams/:id", "routes/teams.$id.tsx"),
  route("/creators", "routes/creators.tsx"),
  route("/join-us", "routes/join-us.tsx"),
  route("/sponsors", "routes/sponsors.tsx"),
  route("/contact", "routes/contact.tsx"),
  route("/imprint", "routes/imprint.tsx"),
  route("/privacy", "routes/privacy.tsx"),
  route("/about-us", "routes/about-us.tsx"),
  route("/login", "routes/login.tsx"),      // New login route
  route("/register", "routes/register.tsx"), // New register route
  route("/register-success", "routes/register-success.tsx"), // New register success route
  route("/forgot-password", "routes/forgot-password.tsx"), // Request a password-reset email
  route("/reset-password", "routes/reset-password.tsx"), // Set a new password from the emailed link
  route("/profile", "routes/profile/index.tsx"),   // Route for logged-in user's profile
  route("/profile/:username", "routes/profile.$username.tsx"), // Route for public profiles
  route("/stats", "routes/stats.tsx"), // Stats dashboard: role-scoped (Admin/Teammanager/Player)
  route("/admin", "routes/admin/dashboard.tsx"), // Admin dashboard overview
  route("/admin/users", "routes/admin/users.tsx"), // Admin user management dashboard
  route("/admin/news", "routes/admin/news.tsx"), // Admin news list
  route("/admin/news/new", "routes/admin/news.new.tsx"), // Admin: create news article
  route("/admin/news/:id/edit", "routes/admin/news.$id.edit.tsx"), // Admin: edit news article
  route("/admin/teams", "routes/admin/teams.tsx"), // Admin team list
  route("/admin/teams/new", "routes/admin/teams.new.tsx"), // Admin: create team
  route("/admin/teams/:id/edit", "routes/admin/teams.$id.edit.tsx"), // Admin: edit team & roster
  route("/admin/players/:id/edit", "routes/admin/players.$id.edit.tsx"), // Admin: edit a single player
  route("/admin/sponsors", "routes/admin/sponsors.tsx"), // Admin sponsors & social links
  route("/admin/social-stats", "routes/admin/social-stats.tsx"), // Admin: social media reach (org/players/teams)
  route("/admin/audit-log", "routes/admin/audit-log.tsx"), // Admin audit log (superuser-only)
] satisfies RouteConfig;
