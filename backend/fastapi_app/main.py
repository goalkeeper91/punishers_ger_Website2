from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import re
import secrets

import logging

import jwt
from fastapi import FastAPI, HTTPException, status, Depends, UploadFile, File, Form, Header, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, FileResponse
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import List, Optional
import os
import django
from asgiref.sync import sync_to_async

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'punishers_ger.settings')
django.setup()

from news.models import NewsArticle, NewsArticleTranslation
from news.translation import sync_translations_for_article, SUPPORTED_LANGUAGES as NEWS_SUPPORTED_LANGUAGES
from teams.models import Team, Player
from users.models import CustomUser, ROLE_TEAM_MANAGER, ROLE_AUTHOR
from users.emails import send_account_activated_email, send_password_reset_email
from sponsors.models import Sponsor, SocialLink
from site_settings.models import SiteSettings, PageBackground
from applications.models import PlayerApplication
from discord_bot.models import (
    DiscordGuild,
    AnnouncementChannelMapping,
    AnnouncementLog,
    VoiceChannelTrigger,
    ReactionRole,
)
from discord_bot import redis_bridge as discord_redis_bridge
from discord_bot.listener import start_listener as start_discord_listener, stop_listener as stop_discord_listener
from discord_bot.scheduler import start_scheduler as start_discord_config_scheduler, stop_scheduler as stop_discord_config_scheduler
from social_media.models import SocialMediaVaultSettings
from gameservers.models import HetznerVPS, Pracc, ServerConfig, ServerSlot
from gameservers import redis_bridge as gameserver_redis_bridge
from gameservers.listener import start_listener as start_gameserver_listener, stop_listener as stop_gameserver_listener
from faceit_integration import sync as faceit_sync
from faceit_integration.client import FaceitClient, FaceitAPIError
from faceit_integration.models import FaceitSyncRun, TeamFaceitMatch, PlayerMatchStats
from faceit_integration.scheduler import start_scheduler, stop_scheduler
from twitch_integration.client import TwitchClient, TwitchAPIError, extract_twitch_login
from twitch_integration.scheduler import start_scheduler as start_twitch_live_scheduler, stop_scheduler as stop_twitch_live_scheduler
from audit_log.models import AuditLogEntry
from social_stats.models import PlayerSocialStats, TwitchAuthorization
from social_stats import sync as social_stats_sync
from social_stats import ocr_client
from social_stats.trends import compute_follower_trend, compute_viewer_stats, record_follower_snapshot
from social_stats.scheduler import start_scheduler as start_social_stats_scheduler, stop_scheduler as stop_social_stats_scheduler
from django.conf import settings
from django.contrib.auth.hashers import make_password, check_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.contrib.auth.models import Group, Permission
from django.db.models import F
from django.utils.text import slugify

logger = logging.getLogger(__name__)

def build_media_url(file_field) -> Optional[str]:
    """Return an absolute URL for a Django FileField/ImageField, or None if empty."""
    if not file_field:
        return None
    return f"{settings.BACKEND_BASE_URL}{settings.MEDIA_URL}{file_field.name}"

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB

async def save_uploaded_image(file: UploadFile, directory: str, filename_base: str) -> str:
    """Validates and writes an uploaded image, returning the file name to
    store on the model's ImageField (caller prefixes the relative media
    subpath). Rejects anything outside a small image-extension allowlist,
    anything whose declared content-type isn't image/*, and anything over
    MAX_UPLOAD_SIZE_BYTES - all before the request handler ever assumes the
    upload succeeded. Centralized here so all 5 upload endpoints (profile
    picture, team/player image, sponsor logo, news image) enforce the same
    rules instead of each trusting the client-supplied filename verbatim."""
    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nicht unterstütztes Dateiformat. Erlaubt: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}",
        )
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Datei ist kein Bild.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Datei ist leer.")
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Datei zu groß (max. {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB).",
        )

    await sync_to_async(os.makedirs)(directory, exist_ok=True)
    file_name = f"{filename_base}{extension}"
    file_path = os.path.join(directory, file_name)

    def _write():
        with open(file_path, "wb") as buffer:
            buffer.write(content)

    try:
        await sync_to_async(_write)()
    finally:
        await file.close()

    return file_name

ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".webm"}
MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB

async def save_uploaded_video(file: UploadFile, directory: str, filename_base: str) -> str:
    """Same validation/write shape as save_uploaded_image() above, sized for
    the hero background video instead of a thumbnail-sized image (100MB cap,
    .mp4/.webm only). nginx's client_max_body_size must independently allow
    a request this large, or it never reaches this code at all."""
    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nicht unterstütztes Dateiformat. Erlaubt: {', '.join(sorted(ALLOWED_VIDEO_EXTENSIONS))}",
        )
    if file.content_type and not file.content_type.startswith("video/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Datei ist kein Video.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Datei ist leer.")
    if len(content) > MAX_VIDEO_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Datei zu groß (max. {MAX_VIDEO_SIZE_BYTES // (1024 * 1024)} MB).",
        )

    await sync_to_async(os.makedirs)(directory, exist_ok=True)
    file_name = f"{filename_base}{extension}"
    file_path = os.path.join(directory, file_name)

    def _write():
        with open(file_path, "wb") as buffer:
            buffer.write(content)

    try:
        await sync_to_async(_write)()
    finally:
        await file.close()

    return file_name

def _log_action(
    actor: Optional[CustomUser],
    action: str,
    resource_type: str,
    resource_id: Optional[object] = None,
    resource_label: Optional[str] = None,
    details: Optional[dict] = None,
) -> None:
    """Writes one audit_log.AuditLogEntry row. Plain sync function - callers
    must `await sync_to_async(_log_action)(...)`. Never raises on its own
    (a logging failure shouldn't take down the actual mutation it's
    recording), but Django ORM errors here are rare enough not to warrant
    a broad except - if the DB is unreachable the endpoint's own save above
    would already have failed first."""
    AuditLogEntry.objects.create(
        actor=actor,
        actor_username=actor.username if actor else None,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        resource_label=resource_label,
        details=details,
    )

@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    start_social_stats_scheduler()
    start_twitch_live_scheduler()
    start_discord_listener()
    start_discord_config_scheduler()
    start_gameserver_listener()
    yield
    stop_scheduler()
    stop_social_stats_scheduler()
    stop_twitch_live_scheduler()
    stop_discord_listener()
    stop_discord_config_scheduler()
    stop_gameserver_listener()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request, call_next):
    # Baseline hardening against a third-party page tricking a browser into
    # misusing this API (framing, MIME-sniffing a served upload as HTML/JS,
    # leaking the current URL to an external site via Referer). HSTS is
    # deliberately not set here - it depends on TLS actually being terminated
    # in front of this app, which is a deployment/reverse-proxy concern, not
    # something this application process can promise on its own.
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    return response

# Serve uploaded media (profile pics, team/player images, sponsor logos, news
# images) - build_media_url() above builds URLs as BACKEND_BASE_URL + MEDIA_URL,
# i.e. this same FastAPI app on the same port, so it has to be the one
# serving them. (Django's urls.py also has a static() helper for MEDIA_URL,
# but that only ever runs under `manage.py runserver`, which isn't the
# server this app actually uses - without this mount, every uploaded image
# 404s no matter how successfully it was uploaded.)
os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
app.mount(settings.MEDIA_URL, StaticFiles(directory=settings.MEDIA_ROOT), name="media")

# =====================================================================
# Schemas
# =====================================================================

class NewsArticleSchema(BaseModel):
    id: int
    title: str
    slug: str
    content: str
    author_name: Optional[str] = None
    image_url: Optional[str] = None
    published_date: str
    updated_date: str
    status: str
    original_language: str = "de"
    # True when title/content above are a machine translation (the reader
    # requested a different ?lang= than the article was written in) rather
    # than the author's own words - shown as a small disclaimer badge.
    is_machine_translated: bool = False

    class Config:
        from_attributes = True

class CustomUserSchema(BaseModel):
    id: int
    username: str
    email: str
    first_name: str
    last_name: str
    profile_picture_url: Optional[str] = None
    steam_id: Optional[str] = None
    game_profile_link: Optional[str] = None
    twitter_link: Optional[str] = None
    twitch_link: Optional[str] = None
    youtube_link: Optional[str] = None
    instagram_link: Optional[str] = None
    tiktok_link: Optional[str] = None
    twitch_connected: bool = False
    twitch_authorized_login: Optional[str] = None
    team_id: Optional[int] = None
    team_name: Optional[str] = None
    is_active: bool
    is_staff: bool = False
    is_superuser: bool = False
    activated_at: Optional[str] = None
    roles: List[str] = []
    permissions: List[str] = []

    class Config:
        from_attributes = True

class PlayerSchema(BaseModel):
    id: int
    ingame_name: str
    role: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    team_id: Optional[int] = None
    faceit_player_id: Optional[str] = None
    user: Optional[CustomUserSchema] = None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True

class TeamSchema(BaseModel):
    id: int
    name: str
    game: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    is_main_team: bool
    players: List[PlayerSchema] = []
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True

# Public, unauthenticated view of a user - deliberately excludes email,
# steam_id, is_staff/is_superuser, roles and permissions. CustomUserSchema
# (above) is the full picture and must only ever go out behind auth
# (see get_current_user/require_permission); anything reachable without a
# token - GET /teams/, /teams/{id}/, /users/{username}/ - uses this instead,
# same idea as the existing public Creator schema for GET /creators/.
class PublicUserSchema(BaseModel):
    id: int
    username: str
    profile_picture_url: Optional[str] = None
    game_profile_link: Optional[str] = None
    twitter_link: Optional[str] = None
    twitch_link: Optional[str] = None
    youtube_link: Optional[str] = None
    instagram_link: Optional[str] = None
    tiktok_link: Optional[str] = None

    class Config:
        from_attributes = True

class PublicPlayerSchema(BaseModel):
    id: int
    ingame_name: str
    role: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    team_id: Optional[int] = None
    user: Optional[PublicUserSchema] = None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True

class PublicTeamSchema(BaseModel):
    id: int
    name: str
    game: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    is_main_team: bool
    players: List[PublicPlayerSchema] = []
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True

class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserActivation(BaseModel):
    is_active: bool

class PasswordResetRequest(BaseModel):
    email: EmailStr

class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str

STEAM64_BASE = 76561197960265728  # SteamID64 for the lowest valid account (Y=0, Z=0)
STEAM2_PATTERN = re.compile(r"STEAM_([0-5]):([01]):(\d+)", re.IGNORECASE)

class UserProfileUpdate(BaseModel):
    # max_length values mirror the CharField/URLField columns in
    # users/models.py exactly - without these, an over-length value (e.g. a
    # full profile URL pasted into steam_id, CharField(max_length=17)) hits
    # an unhandled django.db.utils.DataError at save time instead of a clean
    # validation error, surfacing to the frontend as a raw, non-JSON
    # "Internal Server Error" response.
    first_name: Optional[str] = Field(None, max_length=150)
    last_name: Optional[str] = Field(None, max_length=150)
    steam_id: Optional[str] = Field(None, max_length=17)
    game_profile_link: Optional[str] = Field(None, max_length=200)
    twitter_link: Optional[str] = Field(None, max_length=200)
    twitch_link: Optional[str] = Field(None, max_length=200)
    youtube_link: Optional[str] = Field(None, max_length=200)
    instagram_link: Optional[str] = Field(None, max_length=200)
    tiktok_link: Optional[str] = Field(None, max_length=200)

    @field_validator("steam_id", mode="before")
    @classmethod
    def _normalize_steam_id(cls, value):
        # Runs in "before" mode (ahead of the max_length=17 check above) so
        # a legacy Steam2 ID (e.g. "STEAM_0:1:123456789", 19 chars) gets
        # converted to its canonical SteamID64 form before that length check
        # ever sees it - the raw SteamID64 (17-digit numeric string) that
        # most tools also show is left untouched.
        if not isinstance(value, str):
            return value
        value = value.strip()
        match = STEAM2_PATTERN.fullmatch(value)
        if not match:
            return value
        y, z = int(match.group(2)), int(match.group(3))
        return str(STEAM64_BASE + z * 2 + y)

class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: CustomUserSchema

class AccessToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int

class RefreshRequest(BaseModel):
    refresh_token: str

NEWS_STATUSES = {"draft", "published"}

class NewsArticleCreate(BaseModel):
    title: str
    slug: Optional[str] = None
    content: str
    status: str = "draft"

class NewsArticleUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    content: Optional[str] = None
    status: Optional[str] = None

SPONSOR_TIERS = {"premium", "general"}
# Derived from the model's own choices, not hardcoded a second time here -
# a hardcoded duplicate of this list is exactly what caused "facebook" to be
# selectable in the admin UI but rejected with a 400 on save (the model's
# PLATFORM_CHOICES was updated, this separate copy wasn't).
SOCIAL_PLATFORMS = {choice[0] for choice in SocialLink.PLATFORM_CHOICES}

class SponsorSchema(BaseModel):
    id: int
    name: str
    logo_url: Optional[str] = None
    website_url: Optional[str] = None
    tier: str
    is_active: bool
    order: int
    click_count: int

    class Config:
        from_attributes = True

class SponsorCreate(BaseModel):
    name: str
    website_url: Optional[str] = None
    tier: str = "general"
    is_active: bool = True
    order: int = 0

class SponsorUpdate(BaseModel):
    name: Optional[str] = None
    website_url: Optional[str] = None
    tier: Optional[str] = None
    is_active: Optional[bool] = None
    order: Optional[int] = None

PAGE_BACKGROUND_KEYS = {choice[0] for choice in PageBackground.PAGE_CHOICES}

class SiteSettingsSchema(BaseModel):
    hero_video_url: Optional[str] = None

class PageBackgroundSchema(BaseModel):
    page_key: str
    image_url: Optional[str] = None

class TrendSchema(BaseModel):
    change: int
    percent: Optional[float] = None
    days: int

class ViewerStatsSchema(BaseModel):
    avg_viewers: float
    peak_viewers: int
    samples: int

class SocialLinkSchema(BaseModel):
    id: int
    platform: str
    url: str
    is_active: bool
    order: int
    click_count: int
    follower_count: Optional[int] = None
    view_count: Optional[int] = None
    like_count: Optional[int] = None
    comment_count: Optional[int] = None
    share_count: Optional[int] = None
    reach_count: Optional[int] = None
    impressions_count: Optional[int] = None
    data_source: str = "manual"
    stats_updated_at: Optional[str] = None
    twitch_connected: bool = False
    twitch_authorized_login: Optional[str] = None
    trend: Optional[TrendSchema] = None
    viewer_stats: Optional[ViewerStatsSchema] = None

    class Config:
        from_attributes = True

class SocialLinkCreate(BaseModel):
    platform: str
    url: str
    is_active: bool = True
    order: int = 0

class SocialLinkUpdate(BaseModel):
    platform: Optional[str] = None
    url: Optional[str] = None
    is_active: Optional[bool] = None
    order: Optional[int] = None

# Platforms that can carry a per-player reach number. Deliberately excludes
# "discord" (players don't run their own Discord servers) and "other" (no
# well-defined follower concept) - see social_stats/models.py.
PLAYER_SOCIAL_PLATFORMS = ["twitch", "youtube", "twitter", "instagram", "tiktok"]

class SocialStatsManualUpdate(BaseModel):
    follower_count: Optional[int] = None
    view_count: Optional[int] = None
    like_count: Optional[int] = None
    comment_count: Optional[int] = None
    share_count: Optional[int] = None
    reach_count: Optional[int] = None
    impressions_count: Optional[int] = None

class PlayerSocialChannelSchema(BaseModel):
    platform: str
    follower_count: Optional[int] = None
    view_count: Optional[int] = None
    like_count: Optional[int] = None
    comment_count: Optional[int] = None
    share_count: Optional[int] = None
    reach_count: Optional[int] = None
    impressions_count: Optional[int] = None
    data_source: str = "manual"
    stats_updated_at: Optional[str] = None
    trend: Optional[TrendSchema] = None
    viewer_stats: Optional[ViewerStatsSchema] = None

class PlayerReachSchema(BaseModel):
    user_id: int
    username: str
    ingame_name: str
    team_id: Optional[int] = None
    team_name: Optional[str] = None
    channels: List[PlayerSocialChannelSchema] = []
    total_followers: int = 0

class TeamReachSchema(BaseModel):
    team_id: int
    team_name: str
    player_count: int
    total_followers: int = 0

class SocialStatsOverviewSchema(BaseModel):
    org_channels: List[SocialLinkSchema] = []
    org_total_followers: int = 0
    players: List[PlayerReachSchema] = []
    teams: List[TeamReachSchema] = []

class SocialStatsSyncSummary(BaseModel):
    org_channels_synced: int
    org_channels_failed: int
    player_channels_synced: int
    player_channels_failed: int
    viewer_snapshots_logged: int = 0
    viewer_snapshots_failed: int = 0
    trigger: str

class ScreenshotOcrResult(BaseModel):
    raw_text: str
    candidates: List[int]
    metrics: dict[str, int] = {}

class RoleSchema(BaseModel):
    id: int
    name: str
    permissions: List[str] = []

    class Config:
        from_attributes = True

class RoleCreate(BaseModel):
    name: str

class RolePermissionsUpdate(BaseModel):
    permissions: List[str]  # "app_label.codename", e.g. "news.manage_news"

class UserRolesUpdate(BaseModel):
    roles: List[str]

class SuperuserUpdate(BaseModel):
    is_superuser: bool

class PermissionSchema(BaseModel):
    codename: str  # "app_label.codename"
    label: str

class AuditLogEntrySchema(BaseModel):
    id: int
    actor_username: Optional[str] = None
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    resource_label: Optional[str] = None
    details: Optional[dict] = None
    created_at: str

class TeamCreate(BaseModel):
    name: str
    game: str
    description: Optional[str] = None
    is_main_team: bool = False

class TeamUpdate(BaseModel):
    name: Optional[str] = None
    game: Optional[str] = None
    description: Optional[str] = None
    is_main_team: Optional[bool] = None

class PlayerCreate(BaseModel):
    team_id: int
    ingame_name: str
    role: Optional[str] = None
    description: Optional[str] = None
    user_id: Optional[int] = None  # None = guest roster member with no registered account

class PlayerUpdate(BaseModel):
    ingame_name: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    team_id: Optional[int] = None
    user_id: Optional[int] = None
    faceit_player_id: Optional[str] = None

# Self-service versions of the two above, deliberately without team_id -
# team assignment stays exclusively an admin/Team-Manager action via the
# /admin/players/ endpoints above. See POST/PUT /players/me/.
class PlayerSelfCreate(BaseModel):
    ingame_name: str
    faceit_player_id: Optional[str] = None

class PlayerSelfUpdate(BaseModel):
    ingame_name: Optional[str] = None
    faceit_player_id: Optional[str] = None

class FaceitPlayerLookupSchema(BaseModel):
    player_id: str
    nickname: str
    avatar: Optional[str] = None
    skill_level: Optional[int] = None
    faceit_elo: Optional[int] = None

class ClickStat(BaseModel):
    id: int
    label: str
    click_count: int

class DashboardStats(BaseModel):
    # "admin": everything below; "team_manager": only my_team_*; "author":
    # only news_*. Every field besides `role` is optional so each role only
    # gets sent the numbers that are actually theirs to see.
    role: str
    total_users: Optional[int] = None
    active_users: Optional[int] = None
    pending_users: Optional[int] = None
    total_teams: Optional[int] = None
    total_players: Optional[int] = None
    total_news: Optional[int] = None
    published_news: Optional[int] = None
    draft_news: Optional[int] = None
    total_sponsors: Optional[int] = None
    total_social_links: Optional[int] = None
    sponsor_clicks: Optional[List[ClickStat]] = None
    social_clicks: Optional[List[ClickStat]] = None
    my_team_name: Optional[str] = None
    my_team_player_count: Optional[int] = None
    my_news_count: Optional[int] = None

# =====================================================================
# Serialization helpers
# =====================================================================

async def build_user_schema(user: CustomUser) -> CustomUserSchema:
    """Build a CustomUserSchema from a CustomUser instance, resolving its
    lazy relations (team, roles) via sync_to_async so this is safe to call
    from any async endpoint regardless of what's already been prefetched."""
    team_name = await sync_to_async(lambda: user.team.name if user.team else None)()
    roles = await sync_to_async(lambda: user.roles)()
    # Django's own has_perm()/get_all_permissions() already short-circuits to
    # "everything" for superusers and merges group + user-level permissions -
    # no need to reimplement that logic here.
    permissions = await sync_to_async(lambda: sorted(user.get_all_permissions()))()
    twitch_auth = await sync_to_async(lambda: getattr(user, "twitch_authorization", None))()
    return CustomUserSchema(
        id=user.id,
        username=user.username,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        profile_picture_url=build_media_url(user.profile_picture),
        steam_id=user.steam_id,
        game_profile_link=user.game_profile_link,
        twitter_link=user.twitter_link,
        twitch_link=user.twitch_link,
        youtube_link=user.youtube_link,
        instagram_link=user.instagram_link,
        tiktok_link=user.tiktok_link,
        twitch_connected=twitch_auth is not None,
        twitch_authorized_login=twitch_auth.twitch_login if twitch_auth else None,
        team_id=user.team_id,
        team_name=team_name,
        is_active=user.is_active,
        is_staff=user.is_staff,
        is_superuser=user.is_superuser,
        activated_at=user.activated_at.isoformat() if user.activated_at else None,
        roles=roles,
        permissions=permissions,
    )

# =====================================================================
# JWT auth
# =====================================================================
# Access tokens are short-lived and sent as `Authorization: Bearer <token>`
# on every request. Refresh tokens are longer-lived and only ever sent to
# POST /token/refresh/ to mint a new access token, so a stolen access token
# has a small blast radius.

JWT_ALGORITHM = settings.JWT_ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES
REFRESH_TOKEN_EXPIRE_DAYS = settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS

bearer_scheme = HTTPBearer(auto_error=False)


def _create_token(user_id: int, token_type: str, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_access_token(user_id: int) -> str:
    return _create_token(user_id, "access", timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))


def create_refresh_token(user_id: int) -> str:
    return _create_token(user_id, "refresh", timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))


def _decode_token(token: str, expected_type: str) -> int:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if payload.get("type") != expected_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    try:
        return int(payload["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")


PASSWORD_RESET_TOKEN_TYPE = "password_reset"


def _create_password_reset_token(user: CustomUser) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "type": PASSWORD_RESET_TOKEN_TYPE,
        # A fingerprint of the current password hash, not the hash itself.
        # Resetting the password (or requesting a fresh link) changes this,
        # so the token is single-use without needing a DB table for it.
        "pwd_fp": hashlib.sha256(user.password.encode()).hexdigest()[:16],
        "iat": now,
        "exp": now + timedelta(minutes=settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def _decode_password_reset_token(token: str) -> CustomUser:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Der Link ist abgelaufen. Bitte fordere einen neuen an.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ungültiger Link.")

    if payload.get("type") != PASSWORD_RESET_TOKEN_TYPE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ungültiger Link.")
    try:
        user = CustomUser.objects.get(id=int(payload["sub"]))
    except (CustomUser.DoesNotExist, KeyError, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ungültiger Link.")

    current_fp = hashlib.sha256(user.password.encode()).hexdigest()[:16]
    if payload.get("pwd_fp") != current_fp:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dieser Link wurde bereits verwendet oder ist nicht mehr gültig.")
    return user


async def issue_token_pair(user: CustomUser) -> TokenPair:
    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=await build_user_schema(user),
    )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> CustomUser:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials missing",
        )

    user_id = _decode_token(credentials.credentials, "access")
    try:
        user = await sync_to_async(CustomUser.objects.get)(id=user_id)
    except CustomUser.DoesNotExist:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account not active. Please wait for administrator activation."
        )
    return user

async def get_current_admin_user(current_user: CustomUser = Depends(get_current_user)) -> CustomUser:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to perform this action (Admin privileges required)",
        )
    return current_user

def require_roles(*allowed_roles: str):
    """Dependency factory: superusers always pass; everyone else needs at
    least one of the given Django Group names (see users.models system
    roles). Used for role-gated but not team-scoped resources (e.g. news).
    For team-scoped resources, combine with ensure_team_access() below."""
    async def dependency(current_user: CustomUser = Depends(get_current_user)) -> CustomUser:
        if current_user.is_superuser:
            return current_user
        user_roles = await sync_to_async(lambda: set(current_user.roles))()
        if not user_roles.intersection(allowed_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to perform this action",
            )
        return current_user
    return dependency

def require_permission(codename: str):
    """Dependency factory backed by Django's real permission system
    (Group.permissions / Permission model - see the custom "manage_*" perms
    declared on NewsArticle/Sponsor/Team/CustomUser). Unlike require_roles(),
    this isn't tied to a hardcoded role name: any role (including ones an
    admin creates on the fly, e.g. "Community Manager") can be granted this
    permission via PUT /admin/roles/{id}/permissions/. current_user.has_perm()
    already returns True unconditionally for superusers."""
    async def dependency(current_user: CustomUser = Depends(get_current_user)) -> CustomUser:
        has_perm = await sync_to_async(current_user.has_perm)(codename)
        if not has_perm:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to perform this action",
            )
        return current_user
    return dependency

async def require_team_management_access(current_user: CustomUser = Depends(get_current_user)) -> CustomUser:
    """Base gate for team/player endpoints: passes for a superuser, anyone
    granted the blanket 'teams.manage_teams' permission, or a Teammanager
    (whose access is then further restricted to their own team by
    ensure_team_access once the target team is known)."""
    if current_user.is_superuser:
        return current_user
    has_blanket = await sync_to_async(current_user.has_perm)("teams.manage_teams")
    if has_blanket:
        return current_user
    user_roles = await sync_to_async(lambda: set(current_user.roles))()
    if ROLE_TEAM_MANAGER in user_roles:
        return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to perform this action")

async def require_blanket_team_access(current_user: CustomUser = Depends(get_current_user)) -> CustomUser:
    """For structural, org-wide team actions (create/delete a whole team)
    that must NOT be available to a Teammanager scoped to just their own
    team - only a superuser or someone holding the blanket
    'teams.manage_teams' permission."""
    if current_user.is_superuser:
        return current_user
    has_blanket = await sync_to_async(current_user.has_perm)("teams.manage_teams")
    if has_blanket:
        return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to perform this action")

async def ensure_team_access(current_user: CustomUser, team: Team) -> None:
    """Raise 403 unless current_user is a superuser, holds the blanket
    'teams.manage_teams' permission, or is the Teammanager of this specific
    team. Call this in addition to Depends(require_team_management_access)
    once the target team is known (FastAPI dependencies alone can't see
    path/body-derived team IDs)."""
    if current_user.is_superuser:
        return
    has_blanket = await sync_to_async(current_user.has_perm)("teams.manage_teams")
    if has_blanket:
        return
    if current_user.team_id == team.id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Du kannst nur dein eigenes Team verwalten.",
    )

# =====================================================================
# Routes
# =====================================================================

@app.get("/")
async def root():
    return {"message": "Welcome to the FastAPI backend!"}

def _validate_password_or_400(password: str, user: Optional[CustomUser] = None) -> None:
    try:
        validate_password(password, user)
    except DjangoValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=" ".join(exc.messages))


@app.post("/register/", status_code=status.HTTP_201_CREATED)
async def register_user(user_data: UserRegister):
    if await sync_to_async(CustomUser.objects.filter(username=user_data.username).exists)():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )

    # Uses Django's configured AUTH_PASSWORD_VALIDATORS (min length, not too
    # similar to username/email, not a common password, ...) - this project
    # bypasses Django's own auth views entirely, so nothing else enforces them.
    candidate = CustomUser(username=user_data.username, email=user_data.email)
    await sync_to_async(_validate_password_or_400)(user_data.password, candidate)

    email_taken = await sync_to_async(CustomUser.objects.filter(email=user_data.email).exists)()
    if not email_taken:
        hashed_password = await sync_to_async(make_password)(user_data.password)
        await sync_to_async(CustomUser.objects.create)(
            username=user_data.username,
            email=user_data.email,
            password=hashed_password,
            is_active=False,
        )

    # Identical response whether or not the email was already registered -
    # this can't be used to enumerate accounts by email address. Whoever
    # actually owns that email is unaffected (no duplicate account, no
    # notification sent to them) and the caller can't tell the difference.
    return {"detail": "Registrierung erfolgreich. Ein Administrator wird dein Konto prüfen und freischalten."}


_DUMMY_PASSWORD_HASH = make_password("not-a-real-password-used-only-for-timing")


@app.post("/login/", response_model=TokenPair)
async def login_user(user_data: UserLogin):
    def _authenticate() -> Optional[CustomUser]:
        try:
            user = CustomUser.objects.get(email=user_data.email)
        except CustomUser.DoesNotExist:
            # Mirrors Django's own ModelBackend.authenticate(): run the
            # password hasher anyway, so a nonexistent email doesn't respond
            # measurably faster than a wrong password for a real one - a
            # timing side-channel that could otherwise be used to enumerate
            # registered email addresses even though the error message here
            # is already identical either way.
            check_password(user_data.password, _DUMMY_PASSWORD_HASH)
            return None
        if not check_password(user_data.password, user.password):
            return None
        return user

    user = await sync_to_async(_authenticate)()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account not active. Please wait for administrator activation."
        )

    return await issue_token_pair(user)

@app.post("/password-reset/request/")
async def request_password_reset(body: PasswordResetRequest):
    user = await sync_to_async(CustomUser.objects.filter(email=body.email).first)()
    if user is not None and user.is_active:
        token = _create_password_reset_token(user)
        reset_url = f"{settings.FRONTEND_BASE_URL}/reset-password?token={token}"
        await sync_to_async(send_password_reset_email)(user, reset_url)

    # Same response whether or not the address is registered, so this
    # endpoint can't be used to enumerate valid accounts.
    return {"detail": "Falls ein Konto mit dieser E-Mail-Adresse existiert, haben wir einen Link zum Zurücksetzen des Passworts gesendet."}

@app.post("/password-reset/confirm/")
async def confirm_password_reset(body: PasswordResetConfirm):
    user = await sync_to_async(_decode_password_reset_token)(body.token)

    # Belt-and-suspenders: request_password_reset() already only emails
    # active users, but a deactivated account must never regain access
    # through any path, including one where a link was requested just
    # before an admin deactivated it.
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dieses Konto ist deaktiviert.")

    await sync_to_async(_validate_password_or_400)(body.new_password, user)

    user.password = await sync_to_async(make_password)(body.new_password)
    await sync_to_async(user.save)(update_fields=["password"])
    return {"detail": "Passwort erfolgreich zurückgesetzt."}

@app.post("/token/refresh/", response_model=AccessToken)
async def refresh_access_token(body: RefreshRequest):
    user_id = _decode_token(body.refresh_token, "refresh")
    try:
        user = await sync_to_async(CustomUser.objects.get)(id=user_id)
    except CustomUser.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account not active. Please wait for administrator activation."
        )

    return AccessToken(
        access_token=create_access_token(user.id),
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

# New endpoint to get the current user's profile
@app.get("/users/me/", response_model=CustomUserSchema)
async def get_my_profile(current_user: CustomUser = Depends(get_current_user)):
    return await build_user_schema(current_user)


@app.put("/users/me/", response_model=CustomUserSchema)
async def update_user_profile(
    user_update: UserProfileUpdate,
    current_user: CustomUser = Depends(get_current_user)
):
    user = current_user # Identity comes from the access token, not the request body/path

    update_fields = []
    for field, value in user_update.model_dump(exclude_unset=True).items():
        # first_name/last_name are Django's own AbstractUser CharFields:
        # blank=True but NOT null=True, so the DB column rejects NULL - the
        # frontend sends null for a cleared field (see profile/index.tsx),
        # which is fine for the columns CustomUser defines itself with
        # null=True (steam_id, the *_link fields) but crashes with an
        # IntegrityError on these two. Django's own field introspection
        # tells us which is which, rather than hardcoding a field list here.
        if value is None and not CustomUser._meta.get_field(field).null:
            value = ""
        setattr(user, field, value)
        update_fields.append(field)

    if update_fields:
        await sync_to_async(user.save)(update_fields=update_fields)

    return await build_user_schema(user)

# Resolves a FACEIT nickname to a player_id - the opaque FACEIT player_id
# (a UUID, e.g. "f5f...") is effectively impossible for a regular user to
# find on their own, but their nickname is exactly what they see everywhere
# on faceit.com. Any logged-in user may look up any nickname (read-only,
# same trust level as the public /creators/ or /teams/ endpoints); nothing
# is written here, so this doesn't need require_team_management_access.
@app.get("/players/faceit-lookup/", response_model=FaceitPlayerLookupSchema)
async def lookup_faceit_player(nickname: str, current_user: CustomUser = Depends(get_current_user)):
    nickname = nickname.strip()
    if not nickname:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nickname darf nicht leer sein.")

    def _lookup():
        return FaceitClient().get_player_by_nickname(nickname, game_id=settings.FACEIT_DEFAULT_GAME_ID)

    try:
        profile = await sync_to_async(_lookup)()
    except FaceitAPIError as exc:
        if "(404)" in str(exc):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Kein FACEIT-Spieler mit dem Nickname \"{nickname}\" gefunden (oder kein CS2-Profil).",
            )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="FACEIT-Dienst momentan nicht erreichbar.")

    game_info = (profile.get("games") or {}).get(settings.FACEIT_DEFAULT_GAME_ID, {})
    return FaceitPlayerLookupSchema(
        player_id=profile["player_id"],
        nickname=profile.get("nickname", nickname),
        avatar=profile.get("avatar") or None,
        skill_level=game_info.get("skill_level"),
        faceit_elo=game_info.get("faceit_elo"),
    )

# Self-service Player profile (ingame_name + faceit_player_id), independent
# of team membership - team assignment stays exclusively an admin/
# Team-Manager action via /admin/players/. Lets a teamless player link their
# own FACEIT ID so faceit_integration.sync can pick them up (see
# sync_all_players/sync_all_solo_matches, both already team-agnostic).
@app.get("/players/me/", response_model=Optional[PlayerSchema])
async def get_my_player(current_user: CustomUser = Depends(get_current_user)):
    # select_related is required, not just an optimization: build_player_schema
    # accesses player.user/.team synchronously (not wrapped in sync_to_async),
    # which crashes with SynchronousOnlyOperation from this async endpoint if
    # they weren't already prefetched (matches the pattern every other Player
    # read path - get_player_admin, update_player - already follows).
    player = await sync_to_async(Player.objects.select_related('user', 'team').filter(user=current_user).first)()
    return await build_player_schema(player) if player else None

@app.post("/players/me/", response_model=PlayerSchema, status_code=status.HTTP_201_CREATED)
async def create_my_player(payload: PlayerSelfCreate, background_tasks: BackgroundTasks, current_user: CustomUser = Depends(get_current_user)):
    if await sync_to_async(Player.objects.filter(user=current_user).exists)():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Du hast bereits ein Spielerprofil.")
    if payload.faceit_player_id and await sync_to_async(
        Player.objects.filter(faceit_player_id=payload.faceit_player_id).exists
    )():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Diese FACEIT-ID ist bereits mit einem anderen Profil verknüpft.",
        )

    player = await sync_to_async(Player.objects.create)(
        team=None,
        user=current_user,
        ingame_name=payload.ingame_name,
        faceit_player_id=payload.faceit_player_id or None,
    )
    await sync_to_async(_log_action)(current_user, "create", "Player", player.id, player.ingame_name, {"self_service": True})
    if player.faceit_player_id:
        # Runs after the response is sent (see faceit_sync.sync_single_player)
        # so the freshly-linked profile doesn't sit empty until the next
        # scheduled sync_all(), up to FACEIT_SYNC_INTERVAL_MINUTES later.
        background_tasks.add_task(faceit_sync.sync_single_player, player)
    return await build_player_schema(player)

@app.put("/players/me/", response_model=PlayerSchema)
async def update_my_player(payload: PlayerSelfUpdate, background_tasks: BackgroundTasks, current_user: CustomUser = Depends(get_current_user)):
    # select_related required - see get_my_player above for why.
    player = await sync_to_async(Player.objects.select_related('user', 'team').filter(user=current_user).first)()
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kein Spielerprofil vorhanden.")

    data = payload.model_dump(exclude_unset=True)
    if "faceit_player_id" in data and data["faceit_player_id"]:
        already_linked = await sync_to_async(
            Player.objects.exclude(id=player.id).filter(faceit_player_id=data["faceit_player_id"]).exists
        )()
        if already_linked:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Diese FACEIT-ID ist bereits mit einem anderen Profil verknüpft.",
            )

    for field, value in data.items():
        setattr(player, field, value or None if field == "faceit_player_id" else value)

    await sync_to_async(player.save)(update_fields=list(data.keys()))
    await sync_to_async(_log_action)(current_user, "update", "Player", player.id, player.ingame_name, {"self_service": True, "fields": list(data.keys())})
    if "faceit_player_id" in data and player.faceit_player_id:
        background_tasks.add_task(faceit_sync.sync_single_player, player)
    return await build_player_schema(player)

@app.post("/users/me/profile_picture/", response_model=CustomUserSchema)
async def upload_profile_picture(
    file: UploadFile = File(...),
    current_user: CustomUser = Depends(get_current_user)
):
    user = current_user

    profile_pics_dir = os.path.join(settings.MEDIA_ROOT, 'profile_pics')
    file_name = await save_uploaded_image(file, profile_pics_dir, f"user_{user.id}_profile")

    user.profile_picture = f'profile_pics/{file_name}'
    await sync_to_async(user.save)(update_fields=['profile_picture'])

    return await build_user_schema(user)


@app.put("/users/{user_id}/activate/", response_model=CustomUserSchema)
async def activate_user(
    user_id: int,
    activation_data: UserActivation,
    current_admin: CustomUser = Depends(require_permission("users.manage_users")),
):
    try:
        user = await sync_to_async(CustomUser.objects.get)(id=user_id)
    except CustomUser.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    was_inactive = not user.is_active
    user.is_active = activation_data.is_active
    update_fields = ['is_active']
    if was_inactive and user.is_active and user.activated_at is None:
        user.activated_at = datetime.now(timezone.utc)
        update_fields.append('activated_at')
    await sync_to_async(user.save)(update_fields=update_fields)
    await sync_to_async(_log_action)(
        current_admin, "activate" if activation_data.is_active else "deactivate", "CustomUser", user.id, user.username,
    )

    if was_inactive and user.is_active:
        await sync_to_async(send_account_activated_email)(user)

    return await build_user_schema(user)

@app.get("/admin/users/", response_model=List[CustomUserSchema])
async def get_all_users_for_admin(
    current_admin: CustomUser = Depends(require_permission("users.manage_users")),
):
    users = await sync_to_async(list)(CustomUser.objects.filter(is_deleted=False).order_by('username'))
    return [await build_user_schema(user) for user in users]

class PendingCountSchema(BaseModel):
    count: int

@app.get("/admin/users/pending-count/", response_model=PendingCountSchema)
async def get_pending_users_count(current_user: CustomUser = Depends(require_permission("users.manage_users"))):
    count = await sync_to_async(CustomUser.objects.filter(is_active=False, is_deleted=False).count)()
    return PendingCountSchema(count=count)

@app.delete("/admin/users/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_account(
    user_id: int,
    current_admin: CustomUser = Depends(require_permission("users.manage_users")),
):
    """Hard delete - only for accounts that were NEVER activated (fresh/spam
    registrations). A previously-real account (activated_at set, even if
    currently deactivated) must go through soft_delete_user_account instead,
    so an admin can't accidentally destroy real user history."""
    if user_id == current_admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Du kannst dein eigenes Konto nicht löschen.")
    try:
        user = await sync_to_async(CustomUser.objects.get)(id=user_id)
    except CustomUser.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.activated_at is not None or user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nur nie aktivierte Konten können endgültig gelöscht werden. Nutze für aktivierte Konten die Soft-Delete-Funktion.",
        )
    username = user.username
    await sync_to_async(user.delete)()
    await sync_to_async(_log_action)(current_admin, "delete", "CustomUser", user_id, username)

@app.put("/admin/users/{user_id}/soft-delete/", response_model=CustomUserSchema)
async def soft_delete_user_account(
    user_id: int,
    current_admin: CustomUser = Depends(require_permission("users.manage_users")),
):
    """Soft delete - for accounts that were activated at some point. Keeps
    the row (and its history/relations) but hides it from the admin list
    (get_all_users_for_admin filters is_deleted=False) and revokes access."""
    if user_id == current_admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Du kannst dein eigenes Konto nicht löschen.")
    try:
        user = await sync_to_async(CustomUser.objects.get)(id=user_id)
    except CustomUser.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.is_active and user.activated_at is None:
        # Mirror image of delete_user_account's eligibility check - a
        # currently-active account that happens to have no activated_at
        # stamp (e.g. seeded directly in the DB, never through
        # activate_user) must still go through soft-delete, not fall into a
        # gap where neither endpoint accepts it.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Konto wurde noch nie aktiviert. Nutze stattdessen die endgültige Löschfunktion.")
    if user.is_deleted:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Konto ist bereits gelöscht.")

    def _save():
        user.is_deleted = True
        user.deleted_at = datetime.now(timezone.utc)
        user.is_active = False
        user.save(update_fields=['is_deleted', 'deleted_at', 'is_active'])
        return user

    user = await sync_to_async(_save)()
    await sync_to_async(_log_action)(current_admin, "soft_delete", "CustomUser", user.id, user.username)
    return await build_user_schema(user)

async def build_news_schema(article: NewsArticle, lang: Optional[str] = None) -> NewsArticleSchema:
    author_name = await sync_to_async(lambda: article.author.username if article.author else None)()

    title, content, is_machine_translated = article.title, article.content, False
    if lang and lang in NEWS_SUPPORTED_LANGUAGES and lang != article.original_language:
        translation = await sync_to_async(
            lambda: NewsArticleTranslation.objects.filter(article=article, language=lang).first()
        )()
        # Falls back to the original if no translation exists yet (e.g. the
        # translation service was down when the article was saved) - the
        # reader always sees something rather than a blank article.
        if translation:
            title, content, is_machine_translated = translation.title, translation.content, translation.is_machine_translated

    return NewsArticleSchema(
        id=article.id,
        title=title,
        slug=article.slug,
        content=content,
        author_name=author_name,
        image_url=build_media_url(article.image),
        published_date=article.published_date.isoformat(),
        updated_date=article.updated_date.isoformat(),
        status=article.status,
        original_language=article.original_language,
        is_machine_translated=is_machine_translated,
    )

@app.get("/news/", response_model=List[NewsArticleSchema])
async def get_all_news_articles(lang: Optional[str] = None):
    articles = await sync_to_async(list)(NewsArticle.objects.filter(status='published').order_by('-published_date'))
    return [await build_news_schema(article, lang) for article in articles]

@app.get("/news/{slug}/", response_model=NewsArticleSchema)
async def get_news_article_by_slug(slug: str, lang: Optional[str] = None):
    try:
        article = await sync_to_async(NewsArticle.objects.get)(slug=slug, status='published')
    except NewsArticle.DoesNotExist:
        raise HTTPException(status_code=404, detail="News article not found or not published")

    return await build_news_schema(article, lang)

# --- Admin news management (list/create/edit/delete, incl. drafts) ---

@app.get("/admin/news/", response_model=List[NewsArticleSchema])
async def get_all_news_articles_admin(current_user: CustomUser = Depends(require_permission("news.manage_news"))):
    articles = await sync_to_async(list)(NewsArticle.objects.all().order_by('-published_date'))
    return [await build_news_schema(article) for article in articles]

@app.get("/admin/news/{article_id}/", response_model=NewsArticleSchema)
async def get_news_article_admin(article_id: int, current_user: CustomUser = Depends(require_permission("news.manage_news"))):
    try:
        article = await sync_to_async(NewsArticle.objects.get)(id=article_id)
    except NewsArticle.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News article not found")
    return await build_news_schema(article)

def _announce_news_published(article: NewsArticle) -> None:
    """Fires a Discord "news published" announcement - called from the
    create/update news endpoints below, only on a draft->published
    transition (or direct creation as published)."""
    from discord_bot.models import AnnouncementChannelMapping
    from discord_bot.redis_bridge import publish_notification

    excerpt = (article.content or "")[:300]
    article_url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/news/{article.slug}"

    mappings = AnnouncementChannelMapping.objects.filter(
        event_type="news_published", guild__is_active=True
    ).select_related("guild")
    for mapping in mappings:
        publish_notification(
            event_type="news_published",
            guild=mapping.guild,
            channel_id=mapping.channel_id,
            title=article.title,
            description=excerpt,
            fields=[{"name": "Link", "value": article_url, "inline": False}],
        )

@app.post("/admin/news/", response_model=NewsArticleSchema, status_code=status.HTTP_201_CREATED)
async def create_news_article(
    payload: NewsArticleCreate,
    current_user: CustomUser = Depends(require_permission("news.manage_news")),
):
    if payload.status not in NEWS_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status")

    slug = (payload.slug or "").strip() or slugify(payload.title)
    if await sync_to_async(NewsArticle.objects.filter(slug=slug).exists)():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Slug already in use")

    article = await sync_to_async(NewsArticle.objects.create)(
        title=payload.title,
        slug=slug,
        content=payload.content,
        status=payload.status,
        author=current_user,
    )
    await sync_to_async(_log_action)(current_user, "create", "NewsArticle", article.id, article.title)
    await sync_to_async(sync_translations_for_article)(article)
    if article.status == 'published':
        await sync_to_async(_announce_news_published)(article)
    return await build_news_schema(article)

@app.put("/admin/news/{article_id}/", response_model=NewsArticleSchema)
async def update_news_article(
    article_id: int,
    payload: NewsArticleUpdate,
    current_user: CustomUser = Depends(require_permission("news.manage_news")),
):
    try:
        article = await sync_to_async(NewsArticle.objects.get)(id=article_id)
    except NewsArticle.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News article not found")

    data = payload.model_dump(exclude_unset=True)

    if "status" in data and data["status"] not in NEWS_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status")

    if data.get("slug"):
        slug_taken = await sync_to_async(
            NewsArticle.objects.exclude(id=article_id).filter(slug=data["slug"]).exists
        )()
        if slug_taken:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Slug already in use")

    was_published = article.status == 'published'

    update_fields = []
    for field, value in data.items():
        setattr(article, field, value)
        update_fields.append(field)

    if update_fields:
        await sync_to_async(article.save)(update_fields=update_fields)
        await sync_to_async(_log_action)(current_user, "update", "NewsArticle", article.id, article.title, {"fields": update_fields})
        # Only worth re-translating if the text that gets translated actually
        # changed - a status/slug-only edit shouldn't hit LibreTranslate.
        if "title" in update_fields or "content" in update_fields:
            await sync_to_async(sync_translations_for_article)(article)
        if not was_published and article.status == 'published':
            await sync_to_async(_announce_news_published)(article)

    return await build_news_schema(article)

@app.delete("/admin/news/{article_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_news_article(article_id: int, current_user: CustomUser = Depends(require_permission("news.manage_news"))):
    try:
        article = await sync_to_async(NewsArticle.objects.get)(id=article_id)
    except NewsArticle.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News article not found")
    article_title = article.title
    await sync_to_async(article.delete)()
    await sync_to_async(_log_action)(current_user, "delete", "NewsArticle", article_id, article_title)

@app.post("/admin/news/{article_id}/image/", response_model=NewsArticleSchema)
async def upload_news_article_image(
    article_id: int,
    file: UploadFile = File(...),
    current_user: CustomUser = Depends(require_permission("news.manage_news")),
):
    try:
        article = await sync_to_async(NewsArticle.objects.get)(id=article_id)
    except NewsArticle.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News article not found")

    news_images_dir = os.path.join(settings.MEDIA_ROOT, 'news_images')
    file_name = await save_uploaded_image(file, news_images_dir, f"article_{article.id}")

    article.image = f'news_images/{file_name}'
    await sync_to_async(article.save)(update_fields=['image'])
    await sync_to_async(_log_action)(current_user, "update", "NewsArticle", article.id, article.title, {"fields": ["image"]})

    return await build_news_schema(article)

@app.post("/admin/news/{article_id}/translate/", response_model=NewsArticleSchema)
async def retranslate_news_article(
    article_id: int,
    current_user: CustomUser = Depends(require_permission("news.manage_news")),
):
    """Manually re-run auto-translation - e.g. after the translation service
    was down when the article was last saved, or after a manual copy-edit
    that didn't change title/content field-for-field enough to trigger the
    automatic re-translation in update_news_article(). Mirrors the existing
    manual-trigger pattern used for FACEIT/social-stats sync."""
    try:
        article = await sync_to_async(NewsArticle.objects.get)(id=article_id)
    except NewsArticle.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News article not found")

    await sync_to_async(sync_translations_for_article)(article)
    await sync_to_async(_log_action)(current_user, "translate", "NewsArticle", article.id, article.title)
    return await build_news_schema(article)

# --- Sponsors (public list + click tracking, admin CRUD) ---

def build_sponsor_schema(sponsor: Sponsor) -> SponsorSchema:
    return SponsorSchema(
        id=sponsor.id,
        name=sponsor.name,
        logo_url=build_media_url(sponsor.logo),
        website_url=sponsor.website_url,
        tier=sponsor.tier,
        is_active=sponsor.is_active,
        order=sponsor.order,
        click_count=sponsor.click_count,
    )

@app.get("/sponsors/", response_model=List[SponsorSchema])
async def get_active_sponsors():
    sponsors = await sync_to_async(list)(Sponsor.objects.filter(is_active=True))
    return [build_sponsor_schema(s) for s in sponsors]

@app.post("/sponsors/{sponsor_id}/click/", status_code=status.HTTP_204_NO_CONTENT)
async def track_sponsor_click(sponsor_id: int):
    updated = await sync_to_async(
        Sponsor.objects.filter(id=sponsor_id).update
    )(click_count=F('click_count') + 1)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sponsor not found")

@app.get("/admin/sponsors/", response_model=List[SponsorSchema])
async def get_all_sponsors_admin(current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors"))):
    sponsors = await sync_to_async(list)(Sponsor.objects.all())
    return [build_sponsor_schema(s) for s in sponsors]

@app.post("/admin/sponsors/", response_model=SponsorSchema, status_code=status.HTTP_201_CREATED)
async def create_sponsor(payload: SponsorCreate, current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors"))):
    if payload.tier not in SPONSOR_TIERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tier")
    sponsor = await sync_to_async(Sponsor.objects.create)(
        name=payload.name,
        website_url=payload.website_url,
        tier=payload.tier,
        is_active=payload.is_active,
        order=payload.order,
    )
    await sync_to_async(_log_action)(current_admin, "create", "Sponsor", sponsor.id, sponsor.name)
    return build_sponsor_schema(sponsor)

@app.put("/admin/sponsors/{sponsor_id}/", response_model=SponsorSchema)
async def update_sponsor(sponsor_id: int, payload: SponsorUpdate, current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors"))):
    try:
        sponsor = await sync_to_async(Sponsor.objects.get)(id=sponsor_id)
    except Sponsor.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sponsor not found")

    data = payload.model_dump(exclude_unset=True)
    if "tier" in data and data["tier"] not in SPONSOR_TIERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tier")

    update_fields = []
    for field, value in data.items():
        setattr(sponsor, field, value)
        update_fields.append(field)
    if update_fields:
        await sync_to_async(sponsor.save)(update_fields=update_fields)
        await sync_to_async(_log_action)(current_admin, "update", "Sponsor", sponsor.id, sponsor.name, {"fields": update_fields})
    return build_sponsor_schema(sponsor)

@app.delete("/admin/sponsors/{sponsor_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sponsor(sponsor_id: int, current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors"))):
    try:
        sponsor = await sync_to_async(Sponsor.objects.get)(id=sponsor_id)
    except Sponsor.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sponsor not found")
    sponsor_name = sponsor.name
    await sync_to_async(sponsor.delete)()
    await sync_to_async(_log_action)(current_admin, "delete", "Sponsor", sponsor_id, sponsor_name)

@app.post("/admin/sponsors/{sponsor_id}/logo/", response_model=SponsorSchema)
async def upload_sponsor_logo(
    sponsor_id: int,
    file: UploadFile = File(...),
    current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors")),
):
    try:
        sponsor = await sync_to_async(Sponsor.objects.get)(id=sponsor_id)
    except Sponsor.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sponsor not found")

    logos_dir = os.path.join(settings.MEDIA_ROOT, 'sponsors', 'logos')
    file_name = await save_uploaded_image(file, logos_dir, f"sponsor_{sponsor.id}")

    sponsor.logo = f'sponsors/logos/{file_name}'
    await sync_to_async(sponsor.save)(update_fields=['logo'])
    await sync_to_async(_log_action)(current_admin, "update", "Sponsor", sponsor.id, sponsor.name, {"fields": ["logo"]})
    return build_sponsor_schema(sponsor)

# --- Social links (public list + click tracking, admin CRUD) ---

async def build_social_link_schema(link: SocialLink) -> SocialLinkSchema:
    twitch_auth = await sync_to_async(lambda: getattr(link, "twitch_authorization", None))()
    trend = await sync_to_async(compute_follower_trend)(social_link=link, platform=link.platform)
    viewer_stats = (
        await sync_to_async(compute_viewer_stats)(social_link=link) if link.platform == "twitch" else None
    )
    return SocialLinkSchema(
        id=link.id,
        platform=link.platform,
        url=link.url,
        is_active=link.is_active,
        order=link.order,
        click_count=link.click_count,
        follower_count=link.follower_count,
        view_count=link.view_count,
        like_count=link.like_count,
        comment_count=link.comment_count,
        share_count=link.share_count,
        reach_count=link.reach_count,
        impressions_count=link.impressions_count,
        data_source=link.data_source,
        stats_updated_at=link.stats_updated_at.isoformat() if link.stats_updated_at else None,
        twitch_connected=twitch_auth is not None,
        twitch_authorized_login=twitch_auth.twitch_login if twitch_auth else None,
        trend=TrendSchema(**trend) if trend else None,
        viewer_stats=ViewerStatsSchema(**viewer_stats) if viewer_stats else None,
    )

@app.get("/socials/", response_model=List[SocialLinkSchema])
async def get_active_social_links():
    links = await sync_to_async(list)(SocialLink.objects.filter(is_active=True))
    return [await build_social_link_schema(l) for l in links]

@app.post("/socials/{link_id}/click/", status_code=status.HTTP_204_NO_CONTENT)
async def track_social_click(link_id: int):
    updated = await sync_to_async(
        SocialLink.objects.filter(id=link_id).update
    )(click_count=F('click_count') + 1)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Social link not found")

@app.get("/admin/socials/", response_model=List[SocialLinkSchema])
async def get_all_social_links_admin(current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors"))):
    links = await sync_to_async(list)(SocialLink.objects.all())
    return [await build_social_link_schema(l) for l in links]

@app.post("/admin/socials/", response_model=SocialLinkSchema, status_code=status.HTTP_201_CREATED)
async def create_social_link(payload: SocialLinkCreate, current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors"))):
    if payload.platform not in SOCIAL_PLATFORMS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid platform")
    link = await sync_to_async(SocialLink.objects.create)(
        platform=payload.platform,
        url=payload.url,
        is_active=payload.is_active,
        order=payload.order,
    )
    await sync_to_async(_log_action)(current_admin, "create", "SocialLink", link.id, link.platform)
    return await build_social_link_schema(link)

@app.put("/admin/socials/{link_id}/", response_model=SocialLinkSchema)
async def update_social_link(link_id: int, payload: SocialLinkUpdate, current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors"))):
    try:
        link = await sync_to_async(SocialLink.objects.get)(id=link_id)
    except SocialLink.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Social link not found")

    data = payload.model_dump(exclude_unset=True)
    if "platform" in data and data["platform"] not in SOCIAL_PLATFORMS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid platform")

    update_fields = []
    for field, value in data.items():
        setattr(link, field, value)
        update_fields.append(field)
    if update_fields:
        await sync_to_async(link.save)(update_fields=update_fields)
        await sync_to_async(_log_action)(current_admin, "update", "SocialLink", link.id, link.platform, {"fields": update_fields})
    return await build_social_link_schema(link)

@app.delete("/admin/socials/{link_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_social_link(link_id: int, current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors"))):
    try:
        link = await sync_to_async(SocialLink.objects.get)(id=link_id)
    except SocialLink.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Social link not found")
    link_platform = link.platform
    await sync_to_async(link.delete)()
    await sync_to_async(_log_action)(current_admin, "delete", "SocialLink", link_id, link_platform)

# --- Site settings (hero video + per-page background images) ---
# Public GET endpoints are unauthenticated and read once per page load
# (root.tsx loader) - PageBackground rows only exist once an admin has
# uploaded something for that page, so an unconfigured page_key simply
# doesn't appear in the returned dict and the frontend keeps its existing
# placeholder fallback.

@app.get("/site-settings/", response_model=SiteSettingsSchema)
async def get_site_settings():
    site_settings_obj = await sync_to_async(SiteSettings.load)()
    return SiteSettingsSchema(hero_video_url=build_media_url(site_settings_obj.hero_video))

@app.get("/site-settings/page-backgrounds/")
async def get_page_backgrounds() -> dict[str, Optional[str]]:
    rows = await sync_to_async(list)(PageBackground.objects.exclude(image=""))
    return {row.page_key: build_media_url(row.image) for row in rows}

@app.post("/admin/site-settings/hero-video/", response_model=SiteSettingsSchema)
async def upload_hero_video(
    file: UploadFile = File(...),
    current_admin: CustomUser = Depends(require_permission("site_settings.manage_site_settings")),
):
    video_dir = os.path.join(settings.MEDIA_ROOT, 'site')
    file_name = await save_uploaded_video(file, video_dir, "hero_video")

    site_settings_obj = await sync_to_async(SiteSettings.load)()
    site_settings_obj.hero_video = f'site/{file_name}'
    await sync_to_async(site_settings_obj.save)()
    await sync_to_async(_log_action)(current_admin, "update", "SiteSettings", site_settings_obj.pk, "Hero-Video", {"fields": ["hero_video"]})
    return SiteSettingsSchema(hero_video_url=build_media_url(site_settings_obj.hero_video))

@app.post("/admin/site-settings/page-backgrounds/{page_key}/", response_model=PageBackgroundSchema)
async def upload_page_background(
    page_key: str,
    file: UploadFile = File(...),
    current_admin: CustomUser = Depends(require_permission("site_settings.manage_site_settings")),
):
    if page_key not in PAGE_BACKGROUND_KEYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unbekannte Seite")

    backgrounds_dir = os.path.join(settings.MEDIA_ROOT, 'site', 'page_backgrounds')
    file_name = await save_uploaded_image(file, backgrounds_dir, f"page_bg_{page_key}")

    page_background, _ = await sync_to_async(PageBackground.objects.get_or_create)(page_key=page_key)
    page_background.image = f'site/page_backgrounds/{file_name}'
    await sync_to_async(page_background.save)()
    await sync_to_async(_log_action)(current_admin, "update", "PageBackground", page_background.pk, page_key, {"fields": ["image"]})
    return PageBackgroundSchema(page_key=page_key, image_url=build_media_url(page_background.image))

# --- Social media reach stats (org + players + teams), for sponsor reporting ---
# Teams don't have their own channels (per product decision) - a team's
# reach is just the sum of its roster players' reach.

def _player_link_for_platform(user: CustomUser, platform: str) -> Optional[str]:
    return {
        "twitch": user.twitch_link,
        "youtube": user.youtube_link,
        "twitter": user.twitter_link,
        "instagram": user.instagram_link,
        "tiktok": user.tiktok_link,
    }.get(platform)

async def _build_player_channel_schema(
    user: CustomUser, platform: str, row: Optional[PlayerSocialStats]
) -> PlayerSocialChannelSchema:
    trend = await sync_to_async(compute_follower_trend)(user=user, platform=platform)
    viewer_stats = await sync_to_async(compute_viewer_stats)(user=user) if platform == "twitch" else None
    return PlayerSocialChannelSchema(
        platform=platform,
        follower_count=row.follower_count if row else None,
        view_count=row.view_count if row else None,
        like_count=row.like_count if row else None,
        comment_count=row.comment_count if row else None,
        share_count=row.share_count if row else None,
        reach_count=row.reach_count if row else None,
        impressions_count=row.impressions_count if row else None,
        data_source=row.data_source if row else "manual",
        stats_updated_at=row.stats_updated_at.isoformat() if row and row.stats_updated_at else None,
        trend=TrendSchema(**trend) if trend else None,
        viewer_stats=ViewerStatsSchema(**viewer_stats) if viewer_stats else None,
    )

async def _build_social_stats_overview() -> SocialStatsOverviewSchema:
    org_links = await sync_to_async(list)(SocialLink.objects.filter(is_active=True))
    org_channels = [await build_social_link_schema(l) for l in org_links]
    org_total = sum(c.follower_count or 0 for c in org_channels)

    players = await sync_to_async(list)(Player.objects.select_related('user', 'team').filter(user__isnull=False))
    stats_rows = await sync_to_async(list)(PlayerSocialStats.objects.all())
    stats_by_user: dict = {}
    for row in stats_rows:
        stats_by_user.setdefault(row.user_id, {})[row.platform] = row

    players_schema: List[PlayerReachSchema] = []
    team_totals: dict = {}

    for player in players:
        user = player.user
        user_stats = stats_by_user.get(user.id, {})
        channels = []
        total = 0
        for platform in PLAYER_SOCIAL_PLATFORMS:
            row = user_stats.get(platform)
            if not _player_link_for_platform(user, platform) and not row:
                continue  # no channel linked and nothing manually entered - skip
            channel = await _build_player_channel_schema(user, platform, row)
            channels.append(channel)
            total += channel.follower_count or 0

        players_schema.append(PlayerReachSchema(
            user_id=user.id,
            username=user.username,
            ingame_name=player.ingame_name,
            team_id=player.team_id,
            team_name=player.team.name if player.team else None,
            channels=channels,
            total_followers=total,
        ))

        if player.team_id:
            bucket = team_totals.setdefault(
                player.team_id, {"team_name": player.team.name, "player_count": 0, "total_followers": 0}
            )
            bucket["player_count"] += 1
            bucket["total_followers"] += total

    players_schema.sort(key=lambda p: p.total_followers, reverse=True)
    teams_schema = sorted(
        (
            TeamReachSchema(team_id=team_id, **data)
            for team_id, data in team_totals.items()
        ),
        key=lambda t: t.total_followers,
        reverse=True,
    )

    return SocialStatsOverviewSchema(
        org_channels=org_channels,
        org_total_followers=org_total,
        players=players_schema,
        teams=teams_schema,
    )

@app.get("/admin/social-stats/", response_model=SocialStatsOverviewSchema)
async def get_social_stats_overview(current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors"))):
    return await _build_social_stats_overview()

@app.put("/admin/social-stats/org/{link_id}/", response_model=SocialLinkSchema)
async def update_org_social_stats(
    link_id: int,
    payload: SocialStatsManualUpdate,
    current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors")),
):
    try:
        link = await sync_to_async(SocialLink.objects.get)(id=link_id)
    except SocialLink.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Social link not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(link, field, value)
    link.data_source = "manual"
    link.stats_updated_at = datetime.now(timezone.utc)
    await sync_to_async(link.save)(update_fields=list(data.keys()) + ["data_source", "stats_updated_at"])
    await sync_to_async(record_follower_snapshot)(social_link=link, platform=link.platform, **data)
    await sync_to_async(_log_action)(
        current_admin, "update", "SocialLinkStats", link.id, link.platform, {"fields": list(data.keys())}
    )
    return await build_social_link_schema(link)

@app.put("/admin/social-stats/players/{user_id}/{platform}/", response_model=PlayerSocialChannelSchema)
async def update_player_social_stats(
    user_id: int,
    platform: str,
    payload: SocialStatsManualUpdate,
    current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors")),
):
    if platform not in PLAYER_SOCIAL_PLATFORMS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid platform")
    try:
        user = await sync_to_async(CustomUser.objects.get)(id=user_id)
    except CustomUser.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    data = payload.model_dump(exclude_unset=True)
    now = datetime.now(timezone.utc)
    row, _ = await sync_to_async(PlayerSocialStats.objects.update_or_create)(
        user=user, platform=platform, defaults={**data, "data_source": "manual", "stats_updated_at": now}
    )
    await sync_to_async(record_follower_snapshot)(user=user, platform=platform, **data)
    await sync_to_async(_log_action)(
        current_admin, "update", "PlayerSocialStats", user.id, f"{user.username} ({platform})", {"fields": list(data.keys())}
    )
    return await _build_player_channel_schema(user, platform, row)

@app.get("/social-stats/me/", response_model=List[PlayerSocialChannelSchema])
async def get_my_social_stats(current_user: CustomUser = Depends(get_current_user)):
    """Self-service view of the current user's own channels - separate from
    the admin-only /admin/social-stats/ overview so a player never needs an
    admin to see or update their own numbers (screenshot upload flow)."""
    stats_by_platform = await sync_to_async(
        lambda: {row.platform: row for row in PlayerSocialStats.objects.filter(user=current_user)}
    )()
    channels = []
    for platform in PLAYER_SOCIAL_PLATFORMS:
        row = stats_by_platform.get(platform)
        if not _player_link_for_platform(current_user, platform) and not row:
            continue
        channels.append(await _build_player_channel_schema(current_user, platform, row))
    return channels

@app.put("/social-stats/me/{platform}/", response_model=PlayerSocialChannelSchema)
async def update_my_social_stats(
    platform: str,
    payload: SocialStatsManualUpdate,
    current_user: CustomUser = Depends(get_current_user),
):
    """Same as update_player_social_stats but self-scoped - no
    sponsors.manage_sponsors permission needed since a player can only ever
    touch their own row here."""
    if platform not in PLAYER_SOCIAL_PLATFORMS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid platform")

    data = payload.model_dump(exclude_unset=True)
    now = datetime.now(timezone.utc)
    row, _ = await sync_to_async(PlayerSocialStats.objects.update_or_create)(
        user=current_user, platform=platform, defaults={**data, "data_source": "manual", "stats_updated_at": now}
    )
    await sync_to_async(record_follower_snapshot)(user=current_user, platform=platform, **data)
    await sync_to_async(_log_action)(
        current_user, "update", "PlayerSocialStats", current_user.id, f"{current_user.username} ({platform})", {"fields": list(data.keys())}
    )
    return await _build_player_channel_schema(current_user, platform, row)

@app.post("/admin/social-stats/sync/", response_model=SocialStatsSyncSummary)
async def trigger_social_stats_sync(current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors"))):
    summary = await sync_to_async(social_stats_sync.sync_all)(trigger="manual")
    await sync_to_async(_log_action)(current_admin, "sync", "SocialStats", None, None, summary)
    return SocialStatsSyncSummary(**summary)

@app.post("/social-stats/screenshot/", response_model=ScreenshotOcrResult)
async def analyze_social_screenshot(
    file: UploadFile = File(...),
    current_user: CustomUser = Depends(get_current_user),
):
    """Reads a follower-count screenshot with local OCR and suggests a
    number - never saved on its own. The caller (profile page or admin
    social-stats page) pre-fills the existing manual follower_count input
    with the suggestion so a human still confirms/corrects before the
    normal update_org_social_stats/update_player_social_stats endpoint
    actually persists anything. The upload is never written to disk -
    processed entirely from the in-memory bytes below."""
    content = await file.read()
    await file.close()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Datei ist leer.")
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Datei zu groß (max. {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB).",
        )
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Datei ist kein Bild.")

    try:
        result = await sync_to_async(ocr_client.extract_follower_candidates)(content)
    except ocr_client.OcrError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return ScreenshotOcrResult(**result)

# --- Twitch OAuth (user-context) - connecting a channel so its follower
# count can be synced automatically. Separate from the app-token flow used
# for live status; see twitch_integration/client.py for why Twitch requires
# this per-channel consent since 2023. `state` carries who's connecting
# (signed with our own JWT secret, same as access/refresh tokens) since the
# browser redirect back from Twitch has no Authorization header to identify
# the request. ---

TWITCH_OAUTH_STATE_TYPE = "twitch_oauth_state"
TWITCH_OAUTH_STATE_EXPIRE_MINUTES = 10

def _twitch_redirect_uri() -> str:
    # Must exactly match a redirect URI registered for this app at
    # https://dev.twitch.tv/console - see README "Environment-Variablen".
    return f"{settings.BACKEND_BASE_URL}/social-stats/twitch/callback/"

def _create_twitch_oauth_state(user_id: int, target: str, social_link_id: Optional[int]) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": TWITCH_OAUTH_STATE_TYPE,
        "target": target,
        "social_link_id": social_link_id,
        "iat": now,
        "exp": now + timedelta(minutes=TWITCH_OAUTH_STATE_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)

def _decode_twitch_oauth_state(state: str) -> dict:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Twitch-Autorisierung abgelaufen, bitte erneut versuchen.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ungültiger State-Parameter.")
    if payload.get("type") != TWITCH_OAUTH_STATE_TYPE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ungültiger State-Parameter.")
    return payload

async def _store_twitch_authorization(
    *, user: Optional[CustomUser], social_link: Optional[SocialLink], token_data: dict, twitch_user: dict
) -> TwitchAuthorization:
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=token_data.get("expires_in", 3600))
    defaults = {
        "twitch_user_id": twitch_user["id"],
        "twitch_login": twitch_user["login"],
        "access_token": token_data["access_token"],
        "refresh_token": token_data["refresh_token"],
        "token_expires_at": expires_at,
    }
    if user is not None:
        auth, _ = await sync_to_async(TwitchAuthorization.objects.update_or_create)(user=user, defaults=defaults)
    else:
        auth, _ = await sync_to_async(TwitchAuthorization.objects.update_or_create)(social_link=social_link, defaults=defaults)
    return auth

@app.get("/social-stats/twitch/authorize-url/")
async def get_twitch_authorize_url(
    target: str,
    social_link_id: Optional[int] = None,
    current_user: CustomUser = Depends(get_current_user),
):
    if target not in ("player", "org"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid target")

    if target == "org":
        has_perm = await sync_to_async(current_user.has_perm)("sponsors.manage_sponsors")
        if not has_perm:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        if social_link_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="social_link_id required for org target")
        try:
            link = await sync_to_async(SocialLink.objects.get)(id=social_link_id)
        except SocialLink.DoesNotExist:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Social link not found")
        if link.platform != "twitch":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Social link is not a Twitch channel")

    try:
        client = TwitchClient()
    except TwitchAPIError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    state = _create_twitch_oauth_state(current_user.id, target, social_link_id)
    return {"url": client.build_user_authorize_url(_twitch_redirect_uri(), state)}

@app.get("/social-stats/twitch/callback/")
async def twitch_oauth_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    frontend_base = settings.FRONTEND_BASE_URL
    if error or not code or not state:
        return RedirectResponse(f"{frontend_base}/profile?twitch_error=1")

    payload = _decode_twitch_oauth_state(state)
    try:
        user = await sync_to_async(CustomUser.objects.get)(id=int(payload["sub"]))
    except (CustomUser.DoesNotExist, KeyError, ValueError, TypeError):
        return RedirectResponse(f"{frontend_base}/profile?twitch_error=1")

    target = payload.get("target")
    social_link_id = payload.get("social_link_id")

    try:
        client = TwitchClient()
        token_data = client.exchange_authorization_code(code, _twitch_redirect_uri())
        twitch_user = client.get_authenticated_user(token_data["access_token"])
        follower_count = client.get_follower_count(twitch_user["id"], token_data["access_token"])
    except TwitchAPIError:
        logger.exception("Twitch-OAuth-Austausch fehlgeschlagen")
        redirect_path = "/admin/social-stats" if target == "org" else "/profile"
        return RedirectResponse(f"{frontend_base}{redirect_path}?twitch_error=1")

    now = datetime.now(timezone.utc)
    if target == "org":
        try:
            link = await sync_to_async(SocialLink.objects.get)(id=social_link_id)
        except SocialLink.DoesNotExist:
            return RedirectResponse(f"{frontend_base}/admin/social-stats?twitch_error=1")
        await _store_twitch_authorization(user=None, social_link=link, token_data=token_data, twitch_user=twitch_user)
        link.follower_count = follower_count
        link.data_source = "auto"
        link.stats_updated_at = now
        await sync_to_async(link.save)(update_fields=["follower_count", "data_source", "stats_updated_at"])
        await sync_to_async(record_follower_snapshot)(social_link=link, platform="twitch", follower_count=follower_count)
        await sync_to_async(_log_action)(user, "connect", "SocialLinkTwitch", link.id, twitch_user["login"])
        return RedirectResponse(f"{frontend_base}/admin/social-stats?twitch_connected=1")

    await _store_twitch_authorization(user=user, social_link=None, token_data=token_data, twitch_user=twitch_user)
    await sync_to_async(PlayerSocialStats.objects.update_or_create)(
        user=user,
        platform="twitch",
        defaults={"follower_count": follower_count, "data_source": "auto", "stats_updated_at": now},
    )
    await sync_to_async(record_follower_snapshot)(user=user, platform="twitch", follower_count=follower_count)
    if not user.twitch_link:
        user.twitch_link = f"https://www.twitch.tv/{twitch_user['login']}"
        await sync_to_async(user.save)(update_fields=["twitch_link"])
    await sync_to_async(_log_action)(user, "connect", "PlayerTwitch", user.id, twitch_user["login"])
    return RedirectResponse(f"{frontend_base}/profile?twitch_connected=1")

@app.delete("/social-stats/twitch/player/", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_twitch_player(current_user: CustomUser = Depends(get_current_user)):
    await sync_to_async(TwitchAuthorization.objects.filter(user=current_user).delete)()

@app.delete("/admin/social-stats/twitch/org/{link_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_twitch_org(link_id: int, current_admin: CustomUser = Depends(require_permission("sponsors.manage_sponsors"))):
    await sync_to_async(TwitchAuthorization.objects.filter(social_link_id=link_id).delete)()
    await sync_to_async(_log_action)(current_admin, "disconnect", "SocialLinkTwitch", link_id)

async def build_player_schema(player: Player) -> PlayerSchema:
    player_user = await build_user_schema(player.user) if player.user else None
    team_id = await sync_to_async(lambda: player.team.id if player.team else None)()
    return PlayerSchema(
        id=player.id,
        ingame_name=player.ingame_name,
        role=player.role,
        description=player.description,
        image_url=build_media_url(player.image),
        team_id=team_id,
        faceit_player_id=player.faceit_player_id,
        user=player_user,
        created_at=player.created_at.isoformat(),
        updated_at=player.updated_at.isoformat(),
    )

async def build_team_schema(team: Team) -> TeamSchema:
    players_for_team = await sync_to_async(list)(team.players.select_related('user').all())
    team_players = [await build_player_schema(player) for player in players_for_team]
    return TeamSchema(
        id=team.id,
        name=team.name,
        game=team.game,
        description=team.description,
        image_url=build_media_url(team.image),
        is_main_team=team.is_main_team,
        players=team_players,
        created_at=team.created_at.isoformat(),
        updated_at=team.updated_at.isoformat(),
    )

async def build_public_user_schema(user: CustomUser) -> PublicUserSchema:
    return PublicUserSchema(
        id=user.id,
        username=user.username,
        profile_picture_url=build_media_url(user.profile_picture),
        game_profile_link=user.game_profile_link,
        twitter_link=user.twitter_link,
        twitch_link=user.twitch_link,
        youtube_link=user.youtube_link,
        instagram_link=user.instagram_link,
        tiktok_link=user.tiktok_link,
    )

async def build_public_player_schema(player: Player) -> PublicPlayerSchema:
    player_user = await build_public_user_schema(player.user) if player.user else None
    team_id = await sync_to_async(lambda: player.team.id if player.team else None)()
    return PublicPlayerSchema(
        id=player.id,
        ingame_name=player.ingame_name,
        role=player.role,
        description=player.description,
        image_url=build_media_url(player.image),
        team_id=team_id,
        user=player_user,
        created_at=player.created_at.isoformat(),
        updated_at=player.updated_at.isoformat(),
    )

async def build_public_team_schema(team: Team) -> PublicTeamSchema:
    players_for_team = await sync_to_async(list)(team.players.select_related('user').all())
    team_players = [await build_public_player_schema(player) for player in players_for_team]
    return PublicTeamSchema(
        id=team.id,
        name=team.name,
        game=team.game,
        description=team.description,
        image_url=build_media_url(team.image),
        is_main_team=team.is_main_team,
        players=team_players,
        created_at=team.created_at.isoformat(),
        updated_at=team.updated_at.isoformat(),
    )

@app.get("/teams/", response_model=List[PublicTeamSchema])
async def get_all_teams():
    teams = await sync_to_async(list)(Team.objects.all().order_by('name'))
    return [await build_public_team_schema(team) for team in teams]

@app.get("/teams/{team_id}/", response_model=PublicTeamSchema)
async def get_team_by_id(team_id: int):
    try:
        team = await sync_to_async(Team.objects.get)(id=team_id)
    except Team.DoesNotExist:
        raise HTTPException(status_code=404, detail="Team not found")

    return await build_public_team_schema(team)

# --- Public match highlights (for the homepage widget) ---

class MatchHighlight(BaseModel):
    kind: str  # "next" | "last"
    faceit_match_id: str
    team_name: str
    opponent_name: Optional[str] = None
    competition_name: Optional[str] = None
    scheduled_at: Optional[str] = None
    finished_at: Optional[str] = None
    status: str
    result: Optional[str] = None
    team_score: Optional[int] = None
    opponent_score: Optional[int] = None

def _build_match_highlight(match: TeamFaceitMatch, kind: str) -> MatchHighlight:
    return MatchHighlight(
        kind=kind,
        faceit_match_id=match.faceit_match_id,
        team_name=match.league_entry.team.name,
        opponent_name=match.opponent_name,
        competition_name=match.competition_name,
        scheduled_at=match.scheduled_at.isoformat() if match.scheduled_at else None,
        finished_at=match.finished_at.isoformat() if match.finished_at else None,
        status=match.status,
        result=match.result,
        team_score=match.team_score,
        opponent_score=match.opponent_score,
    )

@app.get("/matches/highlights/", response_model=List[MatchHighlight])
async def get_match_highlights():
    """One "next match" and one "last match" highlight per team that has
    synced FACEIT match data - so the homepage widget rotates through every
    team's matches instead of picking a single one. Every team (main roster
    or not) that has a match gets its moment; teams with no synced matches
    yet simply don't contribute an entry. Public: no login required, this
    is marketing content for visitors."""
    def _collect():
        team_ids = (
            TeamFaceitMatch.objects.values_list('league_entry__team_id', flat=True).distinct()
        )
        teams = Team.objects.filter(id__in=team_ids).order_by('name')

        highlights: List[MatchHighlight] = []
        for team in teams:
            next_match = (
                TeamFaceitMatch.objects.filter(
                    status='upcoming', scheduled_at__isnull=False, league_entry__team=team,
                )
                .select_related('league_entry__team')
                .order_by('scheduled_at')
                .first()
            )
            last_match = (
                TeamFaceitMatch.objects.filter(
                    status='finished', finished_at__isnull=False, league_entry__team=team,
                )
                .select_related('league_entry__team')
                .order_by('-finished_at')
                .first()
            )
            if next_match:
                highlights.append(_build_match_highlight(next_match, "next"))
            if last_match:
                highlights.append(_build_match_highlight(last_match, "last"))
        return highlights

    return await sync_to_async(_collect)()

# --- Public creators list (with live Twitch status) ---

class CreatorLiveStatus(BaseModel):
    title: Optional[str] = None
    game_name: Optional[str] = None
    viewer_count: Optional[int] = None
    thumbnail_url: Optional[str] = None
    started_at: Optional[str] = None

class Creator(BaseModel):
    id: int
    username: str
    profile_picture_url: Optional[str] = None
    bio: Optional[str] = None
    is_featured: bool = False
    twitch_link: Optional[str] = None
    youtube_link: Optional[str] = None
    twitter_link: Optional[str] = None
    live: Optional[CreatorLiveStatus] = None

@app.get("/creators/", response_model=List[Creator])
async def get_creators():
    """Registered content creators (CustomUser.is_content_creator=True),
    with live Twitch status where available. Public: no login required.

    Degrades gracefully: if TWITCH_CLIENT_ID/SECRET aren't configured, or
    the Twitch API call fails for any reason, every creator is still
    returned with `live=None` rather than the whole endpoint failing - the
    creator list itself never depends on Twitch being reachable.
    """
    def _load_creators():
        return list(
            CustomUser.objects.filter(is_content_creator=True)
            .order_by('-is_featured_creator', 'username')
        )

    creators = await sync_to_async(_load_creators)()

    logins_by_user_id = {}
    for creator in creators:
        login = extract_twitch_login(creator.twitch_link)
        if login:
            logins_by_user_id[creator.id] = login

    live_by_login = {}
    if logins_by_user_id:
        try:
            client = TwitchClient()
            live_by_login = await sync_to_async(client.get_live_streams)(list(logins_by_user_id.values()))
        except TwitchAPIError as exc:
            logger.warning("Twitch-Live-Status nicht verfügbar: %s", exc)

    result = []
    for creator in creators:
        login = logins_by_user_id.get(creator.id)
        stream = live_by_login.get(login.lower()) if login else None
        live = None
        if stream:
            thumbnail_url = (stream.get("thumbnail_url") or "").replace("{width}", "320").replace("{height}", "180")
            live = CreatorLiveStatus(
                title=stream.get("title"),
                game_name=stream.get("game_name"),
                viewer_count=stream.get("viewer_count"),
                thumbnail_url=thumbnail_url or None,
                started_at=stream.get("started_at"),
            )
        result.append(Creator(
            id=creator.id,
            username=creator.username,
            profile_picture_url=build_media_url(creator.profile_picture),
            bio=creator.creator_bio,
            is_featured=creator.is_featured_creator,
            twitch_link=creator.twitch_link,
            youtube_link=creator.youtube_link,
            twitter_link=creator.twitter_link,
            live=live,
        ))
    return result

# --- Admin team & player management ---

@app.post("/admin/teams/", response_model=TeamSchema, status_code=status.HTTP_201_CREATED)
async def create_team(payload: TeamCreate, current_admin: CustomUser = Depends(require_blanket_team_access)):
    if await sync_to_async(Team.objects.filter(name=payload.name).exists)():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team name already in use")
    team = await sync_to_async(Team.objects.create)(
        name=payload.name,
        game=payload.game,
        description=payload.description,
        is_main_team=payload.is_main_team,
    )
    await sync_to_async(_log_action)(current_admin, "create", "Team", team.id, team.name)
    return await build_team_schema(team)

@app.put("/admin/teams/{team_id}/", response_model=TeamSchema)
async def update_team(
    team_id: int,
    payload: TeamUpdate,
    current_user: CustomUser = Depends(require_team_management_access),
):
    try:
        team = await sync_to_async(Team.objects.get)(id=team_id)
    except Team.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    await ensure_team_access(current_user, team)

    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        name_taken = await sync_to_async(Team.objects.exclude(id=team_id).filter(name=data["name"]).exists)()
        if name_taken:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team name already in use")

    update_fields = []
    for field, value in data.items():
        setattr(team, field, value)
        update_fields.append(field)
    if update_fields:
        await sync_to_async(team.save)(update_fields=update_fields)
        await sync_to_async(_log_action)(current_user, "update", "Team", team.id, team.name, {"fields": update_fields})
    return await build_team_schema(team)

@app.delete("/admin/teams/{team_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team(team_id: int, current_admin: CustomUser = Depends(require_blanket_team_access)):
    try:
        team = await sync_to_async(Team.objects.get)(id=team_id)
    except Team.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    team_name = team.name
    await sync_to_async(team.delete)()
    await sync_to_async(_log_action)(current_admin, "delete", "Team", team_id, team_name)

@app.post("/admin/teams/{team_id}/image/", response_model=TeamSchema)
async def upload_team_image(
    team_id: int,
    file: UploadFile = File(...),
    current_user: CustomUser = Depends(require_team_management_access),
):
    try:
        team = await sync_to_async(Team.objects.get)(id=team_id)
    except Team.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    await ensure_team_access(current_user, team)

    images_dir = os.path.join(settings.MEDIA_ROOT, 'teams', 'images')
    file_name = await save_uploaded_image(file, images_dir, f"team_{team.id}")

    team.image = f'teams/images/{file_name}'
    await sync_to_async(team.save)(update_fields=['image'])
    await sync_to_async(_log_action)(current_user, "update", "Team", team.id, team.name, {"fields": ["image"]})
    return await build_team_schema(team)

@app.get("/admin/players/{player_id}/", response_model=PlayerSchema)
async def get_player_admin(player_id: int, current_user: CustomUser = Depends(require_team_management_access)):
    try:
        player = await sync_to_async(Player.objects.select_related('user', 'team').get)(id=player_id)
    except Player.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")
    if player.team is not None:
        await ensure_team_access(current_user, player.team)
    elif not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to perform this action")
    return await build_player_schema(player)

@app.post("/admin/players/", response_model=PlayerSchema, status_code=status.HTTP_201_CREATED)
async def create_player(payload: PlayerCreate, current_user: CustomUser = Depends(require_team_management_access)):
    try:
        team = await sync_to_async(Team.objects.get)(id=payload.team_id)
    except Team.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team not found")
    await ensure_team_access(current_user, team)

    user = None
    if payload.user_id is not None:
        try:
            user = await sync_to_async(CustomUser.objects.get)(id=payload.user_id)
        except CustomUser.DoesNotExist:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found")
        if await sync_to_async(Player.objects.filter(user=user).exists)():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This user already has a player profile")

    def _create():
        player = Player.objects.create(
            team=team,
            user=user,
            ingame_name=payload.ingame_name,
            role=payload.role,
            description=payload.description,
        )
        if user is not None:
            # Being on the roster is what grants this user Teammanager-style
            # access to the team (see ensure_team_access) - keeps
            # CustomUser.team in sync instead of requiring the separate,
            # today-unreachable-in-production Django-admin field.
            user.team = team
            user.save(update_fields=['team'])
        return player

    player = await sync_to_async(_create)()
    await sync_to_async(_log_action)(current_user, "create", "Player", player.id, player.ingame_name, {"team_id": team.id})
    return await build_player_schema(player)

@app.put("/admin/players/{player_id}/", response_model=PlayerSchema)
async def update_player(
    player_id: int,
    payload: PlayerUpdate,
    current_user: CustomUser = Depends(require_team_management_access),
):
    try:
        player = await sync_to_async(Player.objects.select_related('user', 'team').get)(id=player_id)
    except Player.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")
    if player.team is not None:
        await ensure_team_access(current_user, player.team)
    elif not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to perform this action")

    data = payload.model_dump(exclude_unset=True)

    if "team_id" in data:
        if not current_user.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Nur Admins können einen Spieler einem anderen Team zuweisen.",
            )
        team_id = data.pop("team_id")
        try:
            player.team = await sync_to_async(Team.objects.get)(id=team_id)
        except Team.DoesNotExist:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team not found")

    if "user_id" in data:
        user_id = data.pop("user_id")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="user_id is required and cannot be cleared")
        try:
            new_user = await sync_to_async(CustomUser.objects.get)(id=user_id)
        except CustomUser.DoesNotExist:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found")
        already_linked = await sync_to_async(
            Player.objects.exclude(id=player_id).filter(user=new_user).exists
        )()
        if already_linked:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This user already has a player profile")
        player.user = new_user

    for field, value in data.items():
        setattr(player, field, value)

    update_fields = list(data.keys())

    def _save():
        player.save()
        # Keep the linked user's team-scoped access in sync with the roster,
        # same as create_player - covers both a team reassignment and a
        # user re-link landing on this player row.
        if player.user is not None and player.user.team_id != player.team_id:
            player.user.team = player.team
            player.user.save(update_fields=['team'])

    await sync_to_async(_save)()
    await sync_to_async(_log_action)(current_user, "update", "Player", player.id, player.ingame_name, {"fields": update_fields})
    return await build_player_schema(player)

@app.delete("/admin/players/{player_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_player(player_id: int, current_user: CustomUser = Depends(require_team_management_access)):
    try:
        player = await sync_to_async(Player.objects.select_related('user', 'team').get)(id=player_id)
    except Player.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")
    if player.team is not None:
        await ensure_team_access(current_user, player.team)
    elif not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to perform this action")
    player_name = player.ingame_name

    def _delete():
        # Removing someone from the roster should also remove the
        # Teammanager-style access that came from being on it - but only if
        # it still points at this same team (don't clobber a reassignment
        # that happened separately in the meantime).
        if player.user is not None and player.user.team_id == player.team_id:
            player.user.team = None
            player.user.save(update_fields=['team'])
        player.delete()

    await sync_to_async(_delete)()
    await sync_to_async(_log_action)(current_user, "delete", "Player", player_id, player_name)

@app.post("/admin/players/{player_id}/image/", response_model=PlayerSchema)
async def upload_player_image(
    player_id: int,
    file: UploadFile = File(...),
    current_user: CustomUser = Depends(require_team_management_access),
):
    try:
        player = await sync_to_async(Player.objects.select_related('user', 'team').get)(id=player_id)
    except Player.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")
    if player.team is not None:
        await ensure_team_access(current_user, player.team)
    elif not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to perform this action")

    images_dir = os.path.join(settings.MEDIA_ROOT, 'players', 'images')
    file_name = await save_uploaded_image(file, images_dir, f"player_{player.id}")

    player.image = f'players/images/{file_name}'
    await sync_to_async(player.save)(update_fields=['image'])
    await sync_to_async(_log_action)(current_user, "update", "Player", player.id, player.ingame_name, {"fields": ["image"]})
    return await build_player_schema(player)

@app.get("/users/{username}/", response_model=PublicUserSchema)
async def get_user_profile(username: str):
    # Public/unauthenticated - must never return CustomUserSchema (email,
    # is_staff/is_superuser, roles, permissions), only what's meant to be a
    # public player card.
    try:
        user = await sync_to_async(CustomUser.objects.get)(username=username)
    except CustomUser.DoesNotExist:
        raise HTTPException(status_code=404, detail="User not found")

    return await build_public_user_schema(user)

# --- Admin: roles (Django groups) & permissions ---
#
# Roles are just named bundles of real Django permissions (Group.permissions)
# - an admin can create a role like "Community Manager" and grant it exactly
# the resource permissions it needs (e.g. sponsors.manage_sponsors) without
# that role being able to touch anything else. Creating/deleting roles and
# assigning permissions stays superuser-only (get_current_admin_user) - this
# is the control surface itself, not something to delegate further.

# --- Player applications ("Jetzt bewerben") ---
# Public submission, admin/Teammanager review. A Teammanager only ever sees/
# edits applications for their own team's game (see _resolve_application_game_scope) -
# unlike every other admin-scoped resource in this file, there's no single
# "team" to check ensure_team_access() against, since an application isn't
# tied to a specific team yet, only a game.

class PlayerApplicationCreate(BaseModel):
    ingame_name: str
    game: str
    rank: str
    full_name: Optional[str] = None
    email: EmailStr
    discord_tag: Optional[str] = None
    age: Optional[int] = None
    message: Optional[str] = None

class PlayerApplicationStatusUpdate(BaseModel):
    status: str

class PlayerApplicationSchema(BaseModel):
    id: int
    ingame_name: str
    game: str
    rank: str
    full_name: Optional[str] = None
    email: str
    discord_tag: Optional[str] = None
    age: Optional[int] = None
    message: Optional[str] = None
    status: str
    created_at: str
    reviewed_at: Optional[str] = None
    reviewed_by_username: Optional[str] = None

def build_application_schema(application: PlayerApplication) -> PlayerApplicationSchema:
    return PlayerApplicationSchema(
        id=application.id,
        ingame_name=application.ingame_name,
        game=application.game,
        rank=application.rank,
        full_name=application.full_name or None,
        email=application.email,
        discord_tag=application.discord_tag or None,
        age=application.age,
        message=application.message or None,
        status=application.status,
        created_at=application.created_at.isoformat(),
        reviewed_at=application.reviewed_at.isoformat() if application.reviewed_at else None,
        reviewed_by_username=application.reviewed_by.username if application.reviewed_by else None,
    )

APPLICATION_GAME_CHOICES = {choice[0] for choice in PlayerApplication.GAME_CHOICES}
APPLICATION_STATUS_CHOICES = {choice[0] for choice in PlayerApplication.STATUS_CHOICES}

async def _resolve_application_game_scope(current_user: CustomUser) -> Optional[str]:
    """None = full access (Admin or applications.manage_applications holder).
    Otherwise the single game string a Teammanager's visibility is scoped to.
    Raises 403 for anyone else (plain members, Authors, ...)."""
    if current_user.is_superuser:
        return None
    has_blanket = await sync_to_async(current_user.has_perm)("applications.manage_applications")
    if has_blanket:
        return None
    user_roles = await sync_to_async(lambda: set(current_user.roles))()
    if ROLE_TEAM_MANAGER in user_roles and current_user.team_id:
        team_game = await sync_to_async(
            lambda: Team.objects.filter(id=current_user.team_id).values_list('game', flat=True).first()
        )()
        if team_game:
            return team_game
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Berechtigung für Bewerbungen.")

@app.post("/applications/players/", response_model=PlayerApplicationSchema, status_code=status.HTTP_201_CREATED)
async def create_player_application(payload: PlayerApplicationCreate):
    if payload.game not in APPLICATION_GAME_CHOICES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unbekanntes Spiel")
    application = await sync_to_async(PlayerApplication.objects.create)(
        ingame_name=payload.ingame_name,
        game=payload.game,
        rank=payload.rank,
        full_name=payload.full_name or "",
        email=payload.email,
        discord_tag=payload.discord_tag or "",
        age=payload.age,
        message=payload.message or "",
    )
    return build_application_schema(application)

@app.get("/admin/applications/players/", response_model=List[PlayerApplicationSchema])
async def get_player_applications(current_user: CustomUser = Depends(get_current_user)):
    game_scope = await _resolve_application_game_scope(current_user)

    def _collect():
        qs = PlayerApplication.objects.select_related('reviewed_by')
        if game_scope:
            qs = qs.filter(game=game_scope)
        return list(qs)

    applications = await sync_to_async(_collect)()
    return [build_application_schema(a) for a in applications]

@app.get("/admin/applications/pending-count/", response_model=PendingCountSchema)
async def get_pending_applications_count(current_user: CustomUser = Depends(get_current_user)):
    """Same visibility scoping as get_player_applications - a Teammanager's
    badge only counts their own game's open applications, not every game's."""
    game_scope = await _resolve_application_game_scope(current_user)

    def _count():
        qs = PlayerApplication.objects.filter(status="pending")
        if game_scope:
            qs = qs.filter(game=game_scope)
        return qs.count()

    count = await sync_to_async(_count)()
    return PendingCountSchema(count=count)

@app.put("/admin/applications/players/{application_id}/status/", response_model=PlayerApplicationSchema)
async def update_player_application_status(
    application_id: int,
    payload: PlayerApplicationStatusUpdate,
    current_user: CustomUser = Depends(get_current_user),
):
    game_scope = await _resolve_application_game_scope(current_user)
    try:
        application = await sync_to_async(PlayerApplication.objects.select_related('reviewed_by').get)(id=application_id)
    except PlayerApplication.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bewerbung nicht gefunden")
    if game_scope and application.game != game_scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Berechtigung für diese Bewerbung.")
    if payload.status not in APPLICATION_STATUS_CHOICES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ungültiger Status")

    application.status = payload.status
    application.reviewed_by = current_user
    application.reviewed_at = datetime.now(timezone.utc)
    await sync_to_async(application.save)(update_fields=['status', 'reviewed_by', 'reviewed_at'])
    await sync_to_async(_log_action)(
        current_user, "update", "PlayerApplication", application.id, application.ingame_name, {"status": payload.status}
    )
    return build_application_schema(application)

@app.delete("/admin/applications/players/{application_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_player_application(application_id: int, current_user: CustomUser = Depends(get_current_user)):
    game_scope = await _resolve_application_game_scope(current_user)
    try:
        application = await sync_to_async(PlayerApplication.objects.get)(id=application_id)
    except PlayerApplication.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bewerbung nicht gefunden")
    if game_scope and application.game != game_scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Berechtigung für diese Bewerbung.")
    application_name = application.ingame_name
    await sync_to_async(application.delete)()
    await sync_to_async(_log_action)(current_user, "delete", "PlayerApplication", application_id, application_name)

# --- Discord bot dashboard ---
# Bridges to the org's Discord bot, a separate deployment (bot-plattform)
# reachable only via Redis pub/sub (see discord_bot/redis_bridge.py and
# discord_bot/listener.py). Everything here is gated by the same permission,
# discord_bot.manage_discord_bot - there's no team/game-scoping need like
# applications has, since there's only one org-wide Discord presence.

class DiscordChannelMappingSchema(BaseModel):
    event_type: str
    channel_id: str
    channel_label: Optional[str] = None

class VoiceTriggerSchema(BaseModel):
    trigger_channel_id: str
    category_id: str
    name_prefix: str = "Voice"
    user_limit: Optional[int] = None
    is_private: bool = False

class ReactionRoleSchema(BaseModel):
    channel_id: str
    message_id: str
    emoji: str = "✅"
    role_id: str
    label: str = ""
    removable: bool = True
    enabled: bool = True

class DiscordGuildSchema(BaseModel):
    guild_id: str
    name: str
    icon_url: Optional[str] = None
    member_count: int
    last_seen_at: str
    channel_mappings: List[DiscordChannelMappingSchema]
    voice_triggers: List[VoiceTriggerSchema] = []
    reaction_roles: List[ReactionRoleSchema] = []

class DiscordChannelMappingsUpdate(BaseModel):
    mappings: List[DiscordChannelMappingSchema]

class VoiceTriggersUpdate(BaseModel):
    triggers: List[VoiceTriggerSchema]

class ReactionRolesUpdate(BaseModel):
    reaction_roles: List[ReactionRoleSchema]

class DiscordAnnounceRequest(BaseModel):
    guild_id: str
    channel_id: str
    title: str
    description: Optional[str] = None

class DiscordAnnouncementLogSchema(BaseModel):
    id: int
    event_type: str
    guild_name: Optional[str] = None
    channel_id: str
    title: str
    description: Optional[str] = None
    triggered_by_username: Optional[str] = None
    success: bool
    error_message: Optional[str] = None
    created_at: str

class DiscordBotStatusSchema(BaseModel):
    online: bool
    guild_count: Optional[int] = None
    uptime_seconds: Optional[int] = None
    last_heartbeat: Optional[str] = None

DISCORD_EVENT_TYPES = {choice[0] for choice in AnnouncementChannelMapping.EVENT_TYPE_CHOICES}

def _prefetch_discord_guilds(qs):
    """Every relation build_discord_guild_schema() touches, prefetched
    up front - callers of that function must always use a queryset built
    this way (or re-fetch through it) and only ever call it from inside a
    sync_to_async-wrapped function. A guild fetched without this and passed
    to build_discord_guild_schema from plain async code trips Django's
    SynchronousOnlyOperation guard on the lazy .reaction_roles/
    .voice_triggers access - see the manual-announce endpoint's history."""
    return qs.prefetch_related('channel_mappings', 'voice_triggers', 'reaction_roles')

def build_discord_guild_schema(guild: DiscordGuild) -> DiscordGuildSchema:
    return DiscordGuildSchema(
        guild_id=guild.guild_id,
        name=guild.name,
        icon_url=guild.icon_url or None,
        member_count=guild.member_count,
        last_seen_at=guild.last_seen_at.isoformat(),
        channel_mappings=[
            DiscordChannelMappingSchema(
                event_type=m.event_type, channel_id=m.channel_id, channel_label=m.channel_label or None
            )
            for m in guild.channel_mappings.all()
        ],
        voice_triggers=[
            VoiceTriggerSchema(
                trigger_channel_id=t.trigger_channel_id,
                category_id=t.category_id,
                name_prefix=t.name_prefix,
                user_limit=t.user_limit,
                is_private=t.is_private,
            )
            for t in guild.voice_triggers.all()
        ],
        reaction_roles=[
            ReactionRoleSchema(
                channel_id=r.channel_id,
                message_id=r.message_id,
                emoji=r.emoji,
                role_id=r.role_id,
                label=r.label,
                removable=r.removable,
                enabled=r.enabled,
            )
            for r in guild.reaction_roles.all()
        ],
    )

@app.get("/admin/discord/status/", response_model=DiscordBotStatusSchema)
async def get_discord_bot_status(current_user: CustomUser = Depends(require_permission("discord_bot.manage_discord_bot"))):
    status_data = await sync_to_async(discord_redis_bridge.get_bot_status)()
    if not status_data:
        return DiscordBotStatusSchema(online=False)
    return DiscordBotStatusSchema(
        online=True,
        guild_count=status_data.get("guild_count"),
        uptime_seconds=status_data.get("uptime_seconds"),
        last_heartbeat=status_data.get("last_heartbeat"),
    )

@app.get("/admin/discord/guilds/", response_model=List[DiscordGuildSchema])
async def get_discord_guilds(current_user: CustomUser = Depends(require_permission("discord_bot.manage_discord_bot"))):
    def _collect():
        qs = _prefetch_discord_guilds(DiscordGuild.objects.filter(is_active=True)).order_by('name')
        return [build_discord_guild_schema(g) for g in qs]
    return await sync_to_async(_collect)()

@app.put("/admin/discord/guilds/{guild_id}/channels/", response_model=DiscordGuildSchema)
async def update_discord_channel_mappings(
    guild_id: str,
    payload: DiscordChannelMappingsUpdate,
    current_user: CustomUser = Depends(require_permission("discord_bot.manage_discord_bot")),
):
    try:
        guild = await sync_to_async(DiscordGuild.objects.get)(guild_id=guild_id, is_active=True)
    except DiscordGuild.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discord-Server nicht gefunden")

    for mapping in payload.mappings:
        if mapping.event_type not in DISCORD_EVENT_TYPES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unbekannter event_type: {mapping.event_type}")

    def _save():
        for mapping in payload.mappings:
            AnnouncementChannelMapping.objects.update_or_create(
                guild=guild,
                event_type=mapping.event_type,
                defaults={"channel_id": mapping.channel_id, "channel_label": mapping.channel_label or ""},
            )
        return build_discord_guild_schema(_prefetch_discord_guilds(DiscordGuild.objects).get(id=guild.id))

    guild_schema = await sync_to_async(_save)()
    await sync_to_async(_log_action)(current_user, "update", "DiscordGuild", guild.id, guild.name, {"fields": ["channel_mappings"]})
    return guild_schema

@app.put("/admin/discord/guilds/{guild_id}/voice-triggers/", response_model=DiscordGuildSchema)
async def update_discord_voice_triggers(
    guild_id: str,
    payload: VoiceTriggersUpdate,
    current_user: CustomUser = Depends(require_permission("discord_bot.manage_discord_bot")),
):
    try:
        guild = await sync_to_async(DiscordGuild.objects.get)(guild_id=guild_id, is_active=True)
    except DiscordGuild.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discord-Server nicht gefunden")

    def _save():
        # Full replace, not merge - the dashboard is the single source of
        # truth pushed to the bot (see redis_bridge.publish_guild_config),
        # so a removed row here must also disappear from the bot's config.
        VoiceChannelTrigger.objects.filter(guild=guild).delete()
        VoiceChannelTrigger.objects.bulk_create([
            VoiceChannelTrigger(
                guild=guild,
                trigger_channel_id=t.trigger_channel_id,
                category_id=t.category_id,
                name_prefix=t.name_prefix or "Voice",
                user_limit=t.user_limit,
                is_private=t.is_private,
            )
            for t in payload.triggers
        ])
        refreshed = _prefetch_discord_guilds(DiscordGuild.objects).get(id=guild.id)
        discord_redis_bridge.publish_guild_config(refreshed)
        return build_discord_guild_schema(refreshed)

    guild_schema = await sync_to_async(_save)()
    await sync_to_async(_log_action)(current_user, "update", "DiscordGuild", guild.id, guild.name, {"fields": ["voice_triggers"]})
    return guild_schema

@app.put("/admin/discord/guilds/{guild_id}/reaction-roles/", response_model=DiscordGuildSchema)
async def update_discord_reaction_roles(
    guild_id: str,
    payload: ReactionRolesUpdate,
    current_user: CustomUser = Depends(require_permission("discord_bot.manage_discord_bot")),
):
    try:
        guild = await sync_to_async(DiscordGuild.objects.get)(guild_id=guild_id, is_active=True)
    except DiscordGuild.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discord-Server nicht gefunden")

    seen = set()
    for r in payload.reaction_roles:
        key = (r.message_id, r.emoji)
        if key in seen:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Doppelte Emoji/Nachricht-Kombination: {r.emoji} auf {r.message_id}")
        seen.add(key)

    def _save():
        # Full replace, not merge - same rationale as voice triggers above:
        # the dashboard is the single source of truth pushed to the bot.
        ReactionRole.objects.filter(guild=guild).delete()
        ReactionRole.objects.bulk_create([
            ReactionRole(
                guild=guild,
                channel_id=r.channel_id,
                message_id=r.message_id,
                emoji=r.emoji or "✅",
                role_id=r.role_id,
                label=r.label or "",
                removable=r.removable,
                enabled=r.enabled,
            )
            for r in payload.reaction_roles
        ])
        refreshed = _prefetch_discord_guilds(DiscordGuild.objects).get(id=guild.id)
        discord_redis_bridge.publish_guild_config(refreshed)
        return build_discord_guild_schema(refreshed)

    guild_schema = await sync_to_async(_save)()
    await sync_to_async(_log_action)(current_user, "update", "DiscordGuild", guild.id, guild.name, {"fields": ["reaction_roles"]})
    return guild_schema

@app.post("/admin/discord/announce/", response_model=DiscordAnnouncementLogSchema, status_code=status.HTTP_201_CREATED)
async def send_discord_announcement(
    payload: DiscordAnnounceRequest,
    current_user: CustomUser = Depends(require_permission("discord_bot.manage_discord_bot")),
):
    try:
        guild = await sync_to_async(DiscordGuild.objects.get)(guild_id=payload.guild_id, is_active=True)
    except DiscordGuild.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discord-Server nicht gefunden")

    def _send():
        discord_redis_bridge.publish_notification(
            event_type="manual",
            guild=guild,
            channel_id=payload.channel_id,
            title=payload.title,
            description=payload.description or "",
            triggered_by=current_user,
        )
        # Schema built here, inside the sync context, since it lazy-loads
        # entry.guild/entry.triggered_by - doing that in the async function
        # body instead would hit Django's SynchronousOnlyOperation guard.
        entry = AnnouncementLog.objects.select_related('guild', 'triggered_by').filter(guild=guild).order_by('-created_at').first()
        return build_discord_log_schema(entry)

    log_schema = await sync_to_async(_send)()
    await sync_to_async(_log_action)(current_user, "create", "AnnouncementLog", log_schema.id, log_schema.title)
    return log_schema

def build_discord_log_schema(entry: AnnouncementLog) -> DiscordAnnouncementLogSchema:
    return DiscordAnnouncementLogSchema(
        id=entry.id,
        event_type=entry.event_type,
        guild_name=entry.guild.name if entry.guild_id else None,
        channel_id=entry.channel_id,
        title=entry.title,
        description=entry.description or None,
        triggered_by_username=entry.triggered_by.username if entry.triggered_by_id else None,
        success=entry.success,
        error_message=entry.error_message or None,
        created_at=entry.created_at.isoformat(),
    )

@app.get("/admin/discord/log/", response_model=List[DiscordAnnouncementLogSchema])
async def get_discord_announcement_log(
    limit: int = 50,
    current_user: CustomUser = Depends(require_permission("discord_bot.manage_discord_bot")),
):
    def _collect():
        return list(AnnouncementLog.objects.select_related('guild', 'triggered_by').order_by('-created_at')[:limit])
    entries = await sync_to_async(_collect)()
    return [build_discord_log_schema(e) for e in entries]

# --- Social Media Manager: embedded Vaultwarden vault ---
# PunishersGer never stores or sees credentials itself - this just tells the
# frontend which self-hosted Vaultwarden instance to embed in an <iframe>
# (see admin/social-media.tsx). Encryption/decryption stays entirely
# client-side in that iframe, keyed to each user's own Bitwarden master
# password. Set via the PUT endpoint below (superuser-only, one-time infra
# config) rather than Django admin - Django's admin.site.urls exists
# (punishers_ger/urls.py) but isn't mounted anywhere in this ASGI app, so
# it's unreachable in this deployment.

class SocialMediaVaultSchema(BaseModel):
    vault_url: Optional[str] = None

class SocialMediaVaultUpdate(BaseModel):
    vault_url: str

@app.get("/admin/social-media/vault-url/", response_model=SocialMediaVaultSchema)
async def get_social_media_vault_url(
    current_user: CustomUser = Depends(require_permission("social_media.manage_social_media_vault")),
):
    settings_obj = await sync_to_async(SocialMediaVaultSettings.load)()
    return SocialMediaVaultSchema(vault_url=settings_obj.vault_url or None)

@app.put("/admin/social-media/vault-url/", response_model=SocialMediaVaultSchema)
async def update_social_media_vault_url(
    payload: SocialMediaVaultUpdate,
    current_admin: CustomUser = Depends(get_current_admin_user),
):
    def _save():
        settings_obj = SocialMediaVaultSettings.load()
        settings_obj.vault_url = payload.vault_url.strip()
        settings_obj.save()
        return settings_obj

    settings_obj = await sync_to_async(_save)()
    await sync_to_async(_log_action)(current_admin, "update", "SocialMediaVaultSettings", settings_obj.id, "vault_url")
    return SocialMediaVaultSchema(vault_url=settings_obj.vault_url or None)

# --- CS2 gameserver dashboard (Phase 1: Hetzner VPS power control only) ---
# PunishersGer never calls Hetzner/SSH/RCON directly - see
# gameservers/redis_bridge.py's module docstring. These endpoints just
# validate, cache to the DB, and publish a command for the separate
# gameserver-plattform repo to actually carry out.

async def require_gameservers_read(current_user: CustomUser = Depends(get_current_user)) -> CustomUser:
    """Read-only gate for infra info a Teammanager needs to see just to
    schedule a Pracc (which slot to pick) - e.g. GET .../slots/. Every
    mutating gameserver endpoint (power, create/start/stop/delete, configs)
    stays strictly admin-only via require_permission("gameservers.manage_gameservers")."""
    if current_user.is_superuser:
        return current_user
    has_blanket = await sync_to_async(current_user.has_perm)("gameservers.manage_gameservers")
    if has_blanket:
        return current_user
    user_roles = await sync_to_async(lambda: set(current_user.roles))()
    if ROLE_TEAM_MANAGER in user_roles:
        return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to perform this action")

class HetznerVPSSchema(BaseModel):
    id: int
    hetzner_server_id: str
    name: str
    ip_address: Optional[str] = None
    last_known_status: str
    last_synced_at: Optional[str] = None

    class Config:
        from_attributes = True

class HetznerVPSCreate(BaseModel):
    hetzner_server_id: str
    name: str
    ip_address: Optional[str] = None

class VPSPowerUpdate(BaseModel):
    power_on: bool

def build_hetzner_vps_schema(vps: HetznerVPS) -> HetznerVPSSchema:
    return HetznerVPSSchema(
        id=vps.id,
        hetzner_server_id=vps.hetzner_server_id,
        name=vps.name,
        ip_address=vps.ip_address,
        last_known_status=vps.last_known_status,
        last_synced_at=vps.last_synced_at.isoformat() if vps.last_synced_at else None,
    )

@app.get("/admin/gameservers/vps/", response_model=Optional[HetznerVPSSchema])
async def get_hetzner_vps(current_user: CustomUser = Depends(require_permission("gameservers.manage_gameservers"))):
    vps = await sync_to_async(HetznerVPS.objects.first)()
    return build_hetzner_vps_schema(vps) if vps else None

@app.post("/admin/gameservers/vps/", response_model=HetznerVPSSchema, status_code=status.HTTP_201_CREATED)
async def create_hetzner_vps(
    payload: HetznerVPSCreate,
    current_user: CustomUser = Depends(require_permission("gameservers.manage_gameservers")),
):
    if await sync_to_async(HetznerVPS.objects.exists)():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Es ist bereits ein VPS konfiguriert.")
    vps = await sync_to_async(HetznerVPS.objects.create)(
        hetzner_server_id=payload.hetzner_server_id.strip(),
        name=payload.name.strip(),
        ip_address=payload.ip_address or None,
    )
    await sync_to_async(_log_action)(current_user, "create", "HetznerVPS", vps.id, vps.name)
    return build_hetzner_vps_schema(vps)

@app.put("/admin/gameservers/vps/power/", response_model=HetznerVPSSchema)
async def set_hetzner_vps_power(
    payload: VPSPowerUpdate,
    current_user: CustomUser = Depends(require_permission("gameservers.manage_gameservers")),
):
    vps = await sync_to_async(HetznerVPS.objects.first)()
    if vps is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kein VPS konfiguriert.")

    published = await sync_to_async(gameserver_redis_bridge.publish_vps_power)(payload.power_on)
    if not published:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Befehl konnte nicht an den Gameserver-Dienst gesendet werden.")

    def _mark_pending():
        # Optimistic UI feedback - the gameserver-plattform side reports the
        # authoritative status back via VPS_STATUS_CHANGED once the Hetzner
        # action actually completes (see gameservers/listener.py).
        vps.last_known_status = "starting" if payload.power_on else "stopping"
        vps.save(update_fields=['last_known_status'])
        return vps

    vps = await sync_to_async(_mark_pending)()
    await sync_to_async(_log_action)(current_user, "update", "HetznerVPS", vps.id, vps.name, {"power_on": payload.power_on})
    return build_hetzner_vps_schema(vps)

# --- CS2 gameserver dashboard (Phase 2: server slots / Docker containers) ---

class ServerSlotSchema(BaseModel):
    id: int
    vps_id: int
    label: str
    kind: str
    docker_container_name: str
    port: int
    current_config_id: Optional[int] = None
    last_known_status: str
    last_synced_at: Optional[str] = None
    # rcon_password deliberately never included here - see
    # gameservers/redis_bridge.py's publish_create_slot() docstring.

    class Config:
        from_attributes = True

class ServerSlotCreate(BaseModel):
    label: str
    kind: str
    port: int
    rcon_password: str

SERVER_SLOT_KIND_CHOICES = {choice[0] for choice in ServerSlot.KIND_CHOICES}

def build_server_slot_schema(slot: ServerSlot) -> ServerSlotSchema:
    return ServerSlotSchema(
        id=slot.id,
        vps_id=slot.vps_id,
        label=slot.label,
        kind=slot.kind,
        docker_container_name=slot.docker_container_name,
        port=slot.port,
        current_config_id=slot.current_config_id,
        last_known_status=slot.last_known_status,
        last_synced_at=slot.last_synced_at.isoformat() if slot.last_synced_at else None,
    )

@app.get("/admin/gameservers/slots/", response_model=List[ServerSlotSchema])
async def get_server_slots(current_user: CustomUser = Depends(require_gameservers_read)):
    slots = await sync_to_async(list)(ServerSlot.objects.select_related('vps').all())
    return [build_server_slot_schema(s) for s in slots]

@app.post("/admin/gameservers/slots/", response_model=ServerSlotSchema, status_code=status.HTTP_201_CREATED)
async def create_server_slot(
    payload: ServerSlotCreate,
    current_user: CustomUser = Depends(require_permission("gameservers.manage_gameservers")),
):
    if payload.kind not in SERVER_SLOT_KIND_CHOICES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unbekannte Slot-Art: {payload.kind}")
    vps = await sync_to_async(HetznerVPS.objects.first)()
    if vps is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kein VPS konfiguriert - zuerst einen VPS anlegen.")

    def _create():
        slot = ServerSlot.objects.create(
            vps=vps,
            label=payload.label.strip(),
            kind=payload.kind,
            port=payload.port,
            rcon_password=payload.rcon_password,
        )
        # Auto-derived, not admin-entered - a Docker container name has to be
        # unique and shell/DNS-safe, which a free-text field can't guarantee.
        slot.docker_container_name = f"cs2-slot-{slot.id}"
        slot.save(update_fields=['docker_container_name'])
        return slot

    slot = await sync_to_async(_create)()
    published = await sync_to_async(gameserver_redis_bridge.publish_create_slot)(slot)
    if not published:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Slot gespeichert, aber der Befehl zum Erstellen des Containers konnte nicht gesendet werden.",
        )

    def _mark_creating():
        slot.last_known_status = "creating"
        slot.save(update_fields=['last_known_status'])
        return slot

    slot = await sync_to_async(_mark_creating)()
    await sync_to_async(_log_action)(current_user, "create", "ServerSlot", slot.id, slot.label)
    return build_server_slot_schema(slot)

@app.put("/admin/gameservers/slots/{slot_id}/start/", response_model=ServerSlotSchema)
async def start_server_slot(
    slot_id: int,
    current_user: CustomUser = Depends(require_permission("gameservers.manage_gameservers")),
):
    try:
        slot = await sync_to_async(ServerSlot.objects.get)(id=slot_id)
    except ServerSlot.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Slot nicht gefunden.")

    published = await sync_to_async(gameserver_redis_bridge.publish_slot_power)(slot, True)
    if not published:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Befehl konnte nicht an den Gameserver-Dienst gesendet werden.")

    def _mark():
        slot.last_known_status = "starting"
        slot.save(update_fields=['last_known_status'])
        return slot

    slot = await sync_to_async(_mark)()
    await sync_to_async(_log_action)(current_user, "update", "ServerSlot", slot.id, slot.label, {"action": "start"})
    return build_server_slot_schema(slot)

@app.put("/admin/gameservers/slots/{slot_id}/stop/", response_model=ServerSlotSchema)
async def stop_server_slot(
    slot_id: int,
    current_user: CustomUser = Depends(require_permission("gameservers.manage_gameservers")),
):
    try:
        slot = await sync_to_async(ServerSlot.objects.get)(id=slot_id)
    except ServerSlot.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Slot nicht gefunden.")

    published = await sync_to_async(gameserver_redis_bridge.publish_slot_power)(slot, False)
    if not published:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Befehl konnte nicht an den Gameserver-Dienst gesendet werden.")

    def _mark():
        slot.last_known_status = "stopping"
        slot.save(update_fields=['last_known_status'])
        return slot

    slot = await sync_to_async(_mark)()
    await sync_to_async(_log_action)(current_user, "update", "ServerSlot", slot.id, slot.label, {"action": "stop"})
    return build_server_slot_schema(slot)

@app.delete("/admin/gameservers/slots/{slot_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server_slot(
    slot_id: int,
    current_user: CustomUser = Depends(require_permission("gameservers.manage_gameservers")),
):
    try:
        slot = await sync_to_async(ServerSlot.objects.get)(id=slot_id)
    except ServerSlot.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Slot nicht gefunden.")

    published = await sync_to_async(gameserver_redis_bridge.publish_delete_slot)(slot)
    if not published:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Befehl zum Löschen des Containers konnte nicht gesendet werden.")

    slot_id_val, slot_label = slot.id, slot.label
    await sync_to_async(slot.delete)()
    await sync_to_async(_log_action)(current_user, "delete", "ServerSlot", slot_id_val, slot_label)

# --- CS2 gameserver dashboard (Phase 3: config library + loading configs) ---

ALLOWED_CONFIG_EXTENSIONS = {".cfg", ".txt"}
MAX_CONFIG_SIZE_BYTES = 1 * 1024 * 1024  # 1 MB - these are plain-text CS2 configs, not media

async def save_uploaded_config(file: UploadFile, directory: str, filename_base: str) -> str:
    """Same validate-then-write shape as save_uploaded_image()/save_uploaded_video()
    above, sized and extension-restricted for plain-text CS2 config/map-pool
    files instead of media."""
    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in ALLOWED_CONFIG_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nicht unterstütztes Dateiformat. Erlaubt: {', '.join(sorted(ALLOWED_CONFIG_EXTENSIONS))}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Datei ist leer.")
    if len(content) > MAX_CONFIG_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Datei zu groß (max. {MAX_CONFIG_SIZE_BYTES // 1024} KB).",
        )

    await sync_to_async(os.makedirs)(directory, exist_ok=True)
    file_name = f"{filename_base}{extension}"
    file_path = os.path.join(directory, file_name)

    def _write():
        with open(file_path, "wb") as buffer:
            buffer.write(content)

    try:
        await sync_to_async(_write)()
    finally:
        await file.close()

    return file_name

class ServerConfigSchema(BaseModel):
    id: int
    label: str
    kind: str
    description: str
    file_url: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True

SERVER_CONFIG_KIND_CHOICES = {choice[0] for choice in ServerConfig.KIND_CHOICES}

def build_server_config_schema(config: ServerConfig) -> ServerConfigSchema:
    return ServerConfigSchema(
        id=config.id,
        label=config.label,
        kind=config.kind,
        description=config.description,
        file_url=build_media_url(config.file),
        created_at=config.created_at.isoformat(),
    )

@app.get("/admin/gameservers/configs/", response_model=List[ServerConfigSchema])
async def get_server_configs(current_user: CustomUser = Depends(require_gameservers_read)):
    configs = await sync_to_async(list)(ServerConfig.objects.all())
    return [build_server_config_schema(c) for c in configs]

@app.post("/admin/gameservers/configs/", response_model=ServerConfigSchema, status_code=status.HTTP_201_CREATED)
async def create_server_config(
    label: str = Form(...),
    kind: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
    current_user: CustomUser = Depends(require_permission("gameservers.manage_gameservers")),
):
    if kind not in SERVER_CONFIG_KIND_CHOICES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unbekannte Config-Art: {kind}")

    configs_dir = os.path.join(settings.MEDIA_ROOT, 'gameserver_configs')
    label_clean = label.strip()

    def _create():
        config = ServerConfig.objects.create(label=label_clean, kind=kind, description=description.strip())
        return config

    config = await sync_to_async(_create)()
    file_name = await save_uploaded_config(file, configs_dir, f"config_{config.id}")
    config.file = f'gameserver_configs/{file_name}'
    await sync_to_async(config.save)(update_fields=['file'])
    await sync_to_async(_log_action)(current_user, "create", "ServerConfig", config.id, config.label)
    return build_server_config_schema(config)

@app.delete("/admin/gameservers/configs/{config_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server_config(
    config_id: int,
    current_user: CustomUser = Depends(require_permission("gameservers.manage_gameservers")),
):
    try:
        config = await sync_to_async(ServerConfig.objects.get)(id=config_id)
    except ServerConfig.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Config nicht gefunden.")
    config_id_val, config_label = config.id, config.label
    await sync_to_async(config.delete)()
    await sync_to_async(_log_action)(current_user, "delete", "ServerConfig", config_id_val, config_label)

class LoadConfigRequest(BaseModel):
    config_id: int

@app.put("/admin/gameservers/slots/{slot_id}/load-config/", response_model=ServerSlotSchema)
async def load_server_slot_config(
    slot_id: int,
    payload: LoadConfigRequest,
    current_user: CustomUser = Depends(require_permission("gameservers.manage_gameservers")),
):
    try:
        slot = await sync_to_async(ServerSlot.objects.get)(id=slot_id)
    except ServerSlot.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Slot nicht gefunden.")
    try:
        config = await sync_to_async(ServerConfig.objects.get)(id=payload.config_id)
    except ServerConfig.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Config nicht gefunden.")

    published = await sync_to_async(gameserver_redis_bridge.publish_load_config)(slot, config)
    if not published:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Befehl konnte nicht an den Gameserver-Dienst gesendet werden.")

    await sync_to_async(_log_action)(current_user, "update", "ServerSlot", slot.id, slot.label, {"action": "load_config", "config_id": config.id})
    return build_server_slot_schema(slot)

# --- CS2 gameserver dashboard (Phase 4: Pracc scheduling, Teammanager-scoped) ---

def _announce_pracc_created(pracc: Pracc) -> None:
    """Fires a Discord "pracc_created" announcement - mirrors
    _announce_news_published() above exactly. Called from create_pracc()
    below, inside the same sync context that already saved the row."""
    from discord_bot.models import AnnouncementChannelMapping
    from discord_bot.redis_bridge import publish_notification

    mappings = AnnouncementChannelMapping.objects.filter(
        event_type="pracc_created", guild__is_active=True
    ).select_related("guild")
    for mapping in mappings:
        publish_notification(
            event_type="pracc_created",
            guild=mapping.guild,
            channel_id=mapping.channel_id,
            title=f"Neuer Pracc: {pracc.own_team.name} vs. {pracc.opponent_team_name}",
            description=f"Geplant für {pracc.scheduled_at.strftime('%d.%m.%Y %H:%M')} UTC auf {pracc.slot.label}.",
        )

class PraccSchema(BaseModel):
    id: int
    slot_id: int
    slot_label: str
    own_team_id: int
    own_team_name: str
    opponent_team_name: str
    scheduled_at: str
    status: str
    created_by_username: Optional[str] = None
    # No raw URL here on purpose - the demo file lives outside MEDIA_ROOT and
    # is only readable through GET /gameservers/praccs/{id}/demo/, which
    # re-checks both team membership and the download window itself. These
    # two fields just tell the frontend whether to show that download link.
    demo_available: bool = False
    demo_expires_at: Optional[str] = None
    match_ended_at: Optional[str] = None
    created_at: str
    # Set only once the assigned slot's VPS has an IP - shown to both teams
    # so they know where to connect; MatchZy takes it from there (veto if
    # the pool has >1 map, then each team's own .ready).
    slot_ip: Optional[str] = None
    slot_port: Optional[int] = None
    map_pool_config_id: Optional[int] = None
    map_pool_config_label: Optional[str] = None

    class Config:
        from_attributes = True

class PraccCreate(BaseModel):
    slot_id: int
    own_team_id: int
    opponent_team_name: str
    scheduled_at: str
    map_pool_config_id: Optional[int] = None

class PraccStatusUpdate(BaseModel):
    status: str

PRACC_STATUS_CHOICES = {choice[0] for choice in Pracc.STATUS_CHOICES}

def build_pracc_schema(pracc: Pracc) -> PraccSchema:
    demo_expires_at = None
    demo_available = False
    if pracc.demo_filename and pracc.demo_uploaded_at:
        demo_expires_at = pracc.demo_uploaded_at + timedelta(days=settings.GAMESERVER_DEMO_DOWNLOAD_DAYS)
        demo_available = datetime.now(timezone.utc) < demo_expires_at

    return PraccSchema(
        id=pracc.id,
        slot_id=pracc.slot_id,
        slot_label=pracc.slot.label,
        own_team_id=pracc.own_team_id,
        own_team_name=pracc.own_team.name,
        opponent_team_name=pracc.opponent_team_name,
        scheduled_at=pracc.scheduled_at.isoformat(),
        status=pracc.status,
        created_by_username=pracc.created_by.username if pracc.created_by else None,
        demo_available=demo_available,
        demo_expires_at=demo_expires_at.isoformat() if demo_expires_at else None,
        match_ended_at=pracc.match_ended_at.isoformat() if pracc.match_ended_at else None,
        created_at=pracc.created_at.isoformat(),
        slot_ip=pracc.slot.vps.ip_address,
        slot_port=pracc.slot.port,
        map_pool_config_id=pracc.map_pool_config_id,
        map_pool_config_label=pracc.map_pool_config.label if pracc.map_pool_config_id else None,
    )

async def _resolve_pracc_team_scope(current_user: CustomUser) -> Optional[int]:
    """None = full access (superuser or gameservers.manage_gameservers
    holder). Otherwise the single team_id a Teammanager's Pracc access is
    scoped to. Raises 403 for anyone else - mirrors
    _resolve_application_game_scope() above exactly."""
    if current_user.is_superuser:
        return None
    has_blanket = await sync_to_async(current_user.has_perm)("gameservers.manage_gameservers")
    if has_blanket:
        return None
    user_roles = await sync_to_async(lambda: set(current_user.roles))()
    if ROLE_TEAM_MANAGER in user_roles and current_user.team_id:
        return current_user.team_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Berechtigung für Praccs.")

@app.get("/admin/gameservers/praccs/", response_model=List[PraccSchema])
async def get_praccs(current_user: CustomUser = Depends(get_current_user)):
    scope = await _resolve_pracc_team_scope(current_user)

    def _list():
        qs = Pracc.objects.select_related('slot', 'slot__vps', 'own_team', 'created_by', 'map_pool_config').all()
        if scope is not None:
            qs = qs.filter(own_team_id=scope)
        return list(qs)

    praccs = await sync_to_async(_list)()
    return [build_pracc_schema(p) for p in praccs]

@app.post("/admin/gameservers/praccs/", response_model=PraccSchema, status_code=status.HTTP_201_CREATED)
async def create_pracc(
    payload: PraccCreate,
    current_user: CustomUser = Depends(get_current_user),
):
    scope = await _resolve_pracc_team_scope(current_user)
    if scope is not None and payload.own_team_id != scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Du kannst nur für dein eigenes Team einen Pracc anlegen.")
    if not payload.opponent_team_name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Gegner-Teamname erforderlich.")

    try:
        slot = await sync_to_async(ServerSlot.objects.select_related('vps').get)(id=payload.slot_id)
    except ServerSlot.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Slot nicht gefunden.")
    try:
        team = await sync_to_async(Team.objects.get)(id=payload.own_team_id)
    except Team.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team nicht gefunden.")
    map_pool_config = None
    if payload.map_pool_config_id is not None:
        try:
            map_pool_config = await sync_to_async(ServerConfig.objects.get)(id=payload.map_pool_config_id)
        except ServerConfig.DoesNotExist:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Map-Pool-Config nicht gefunden.")
        if map_pool_config.kind != "map_pool":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Diese Config ist kein Map-Pool.")
    try:
        scheduled_at = datetime.fromisoformat(payload.scheduled_at)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ungültiges Datum.")
    if scheduled_at.tzinfo is None:
        # A plain <input type="datetime-local"> value carries no timezone -
        # treated as a raw wall-clock value in the server's own UTC (see
        # settings.TIME_ZONE), not converted from the browser's local zone.
        # The frontend renders it back the same way, without going through
        # a Date object that would otherwise silently shift it again.
        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)

    def _create():
        pracc = Pracc.objects.create(
            slot=slot,
            own_team=team,
            opponent_team_name=payload.opponent_team_name.strip(),
            scheduled_at=scheduled_at,
            created_by=current_user,
            map_pool_config=map_pool_config,
        )
        _announce_pracc_created(pracc)
        return pracc

    pracc = await sync_to_async(_create)()
    await sync_to_async(_log_action)(current_user, "create", "Pracc", pracc.id, str(pracc))
    return build_pracc_schema(pracc)

@app.put("/admin/gameservers/praccs/{pracc_id}/status/", response_model=PraccSchema)
async def update_pracc_status(
    pracc_id: int,
    payload: PraccStatusUpdate,
    current_user: CustomUser = Depends(get_current_user),
):
    if payload.status not in PRACC_STATUS_CHOICES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unbekannter Status: {payload.status}")
    try:
        pracc = await sync_to_async(Pracc.objects.select_related('slot', 'slot__vps', 'own_team', 'created_by', 'map_pool_config').get)(id=pracc_id)
    except Pracc.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pracc nicht gefunden.")

    scope = await _resolve_pracc_team_scope(current_user)
    if scope is not None and pracc.own_team_id != scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Du kannst nur Praccs deines eigenen Teams verwalten.")

    if payload.status == "live":
        if pracc.status != "scheduled":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nur ein geplanter Pracc kann gestartet werden.")
        published = await sync_to_async(gameserver_redis_bridge.publish_start_pracc)(pracc)
        if not published:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Befehl konnte nicht an den Gameserver-Dienst gesendet werden.")

        def _mark_live():
            pracc.status = "live"
            pracc.save(update_fields=['status'])
            return pracc

        pracc = await sync_to_async(_mark_live)()
    elif payload.status == "finished":
        def _mark_finished():
            pracc.status = "finished"
            pracc.match_ended_at = datetime.now(timezone.utc)
            pracc.save(update_fields=['status', 'match_ended_at'])
            return pracc

        pracc = await sync_to_async(_mark_finished)()
        # Best-effort, non-blocking: the match is already finished either
        # way, a demo-retrieval hiccup shouldn't stop the admin from closing
        # it out - gameserver-plattform just won't have anything to push
        # back via /internal/gameservers/praccs/{id}/demo/ if this fails.
        await sync_to_async(gameserver_redis_bridge.publish_retrieve_demo)(pracc)
    elif payload.status == "cancelled":
        def _mark_cancelled():
            pracc.status = "cancelled"
            pracc.save(update_fields=['status'])
            return pracc

        pracc = await sync_to_async(_mark_cancelled)()
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dieser Statusübergang wird nicht unterstützt.")

    await sync_to_async(_log_action)(current_user, "update", "Pracc", pracc.id, str(pracc), {"status": payload.status})
    return build_pracc_schema(pracc)

@app.get("/internal/gameservers/praccs/{pracc_id}/matchzy-config/")
async def get_pracc_matchzy_config(pracc_id: int):
    """Generates a MatchZy match-config JSON on the fly for a Pracc with an
    assigned map-pool config - gameserver-plattform's handle_start_pracc()
    RCONs `matchzy_loadmatch_url` pointing at this URL (see
    redis_bridge.py's publish_start_pracc()). No auth here, same as the
    Phase 3 config_url this mirrors - team names and a map list aren't
    secret, only the RCON password (which never appears in this response).
    Deliberately minimal: team names + num_maps=1 + a map pool is enough for
    MatchZy to run its own veto (if the pool has >1 map) and each team's
    `.ready` - see Pracc's own docstring for why this doesn't attempt a
    Steam-ID-locked roster config. JSON shape is a best-effort guess at
    MatchZy's documented config schema - verify against a real deploy."""
    try:
        pracc = await sync_to_async(Pracc.objects.select_related('own_team', 'map_pool_config').get)(id=pracc_id)
    except Pracc.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pracc nicht gefunden.")
    if not pracc.map_pool_config:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kein Map-Pool zugewiesen.")

    def _read_maplist():
        with open(pracc.map_pool_config.file.path, 'r', encoding='utf-8') as f:
            return [line.strip() for line in f if line.strip() and not line.strip().startswith('#')]

    maplist = await sync_to_async(_read_maplist)()
    if not maplist:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Map-Pool-Datei ist leer.")

    return {
        "matchid": str(pracc.id),
        "num_maps": 1,
        "maplist": maplist,
        "clinch_series": False,
        "team1": {"name": pracc.own_team.name},
        "team2": {"name": pracc.opponent_team_name},
    }

# --- CS2 gameserver dashboard (Phase 5: demo retrieval) ---
# Service-to-service, not a logged-in admin action: gameserver-plattform
# calls this once it's retrieved a finished Pracc's demo file over SFTP
# (see redis_bridge.py's publish_retrieve_demo() docstring) - gated by a
# static shared token in a custom header instead of a user JWT.

ALLOWED_DEMO_EXTENSIONS = {".dem"}
MAX_DEMO_SIZE_BYTES = 500 * 1024 * 1024  # 500 MB - CS2 demos run much larger than configs/images

async def save_uploaded_demo(file: UploadFile, directory: str, filename_base: str) -> str:
    """Same validate-then-write shape as save_uploaded_config() above, sized
    and extension-restricted for CS2 .dem demo files."""
    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in ALLOWED_DEMO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nicht unterstütztes Dateiformat. Erlaubt: {', '.join(sorted(ALLOWED_DEMO_EXTENSIONS))}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Datei ist leer.")
    if len(content) > MAX_DEMO_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Datei zu groß (max. {MAX_DEMO_SIZE_BYTES // (1024 * 1024)} MB).",
        )

    await sync_to_async(os.makedirs)(directory, exist_ok=True)
    file_name = f"{filename_base}{extension}"
    file_path = os.path.join(directory, file_name)

    def _write():
        with open(file_path, "wb") as buffer:
            buffer.write(content)

    try:
        await sync_to_async(_write)()
    finally:
        await file.close()

    return file_name

@app.post("/internal/gameservers/praccs/{pracc_id}/demo/", status_code=status.HTTP_204_NO_CONTENT)
async def upload_pracc_demo(
    pracc_id: int,
    file: UploadFile = File(...),
    x_service_token: Optional[str] = Header(None, alias="X-Service-Token"),
):
    if not settings.GAMESERVER_SERVICE_TOKEN or not x_service_token or not secrets.compare_digest(
        x_service_token, settings.GAMESERVER_SERVICE_TOKEN
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid service token")

    try:
        pracc = await sync_to_async(Pracc.objects.get)(id=pracc_id)
    except Pracc.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pracc nicht gefunden.")

    file_name = await save_uploaded_demo(file, settings.GAMESERVER_DEMOS_ROOT, f"pracc_{pracc.id}")
    pracc.demo_filename = file_name
    pracc.demo_uploaded_at = datetime.now(timezone.utc)
    await sync_to_async(pracc.save)(update_fields=['demo_filename', 'demo_uploaded_at'])

async def _can_access_pracc(current_user: CustomUser, pracc: Pracc) -> bool:
    """True if current_user may view/download this specific Pracc: a
    superuser, a gameservers.manage_gameservers holder, or ANY member of the
    Pracc's own_team - not just its Teammanager, unlike
    _resolve_pracc_team_scope() above (which gates the admin-scoped
    management endpoints). This broader check is what makes
    GET /gameservers/praccs/{id}/demo/ below usable by regular players."""
    if current_user.is_superuser:
        return True
    has_blanket = await sync_to_async(current_user.has_perm)("gameservers.manage_gameservers")
    if has_blanket:
        return True
    return current_user.team_id == pracc.own_team_id

@app.get("/gameservers/praccs/team/", response_model=List[PraccSchema])
async def get_my_team_praccs(current_user: CustomUser = Depends(get_current_user)):
    """Self-service surface for any registered player (not just a
    Teammanager/admin) to see their own team's Praccs and grab a finished
    match's demo - separate from the admin-scoped
    GET /admin/gameservers/praccs/ above, which stays limited to
    Teammanager/blanket-permission management."""
    if not current_user.team_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Du bist keinem Team zugeordnet.")

    def _list():
        return list(
            Pracc.objects.select_related('slot', 'slot__vps', 'own_team', 'created_by', 'map_pool_config').filter(own_team_id=current_user.team_id)
        )

    praccs = await sync_to_async(_list)()
    return [build_pracc_schema(p) for p in praccs]

@app.get("/gameservers/praccs/{pracc_id}/demo/")
async def download_pracc_demo(
    pracc_id: int,
    current_user: CustomUser = Depends(get_current_user),
):
    """Authenticated, expiry-checked demo download - the only way to read a
    file out of settings.GAMESERVER_DEMOS_ROOT (see Pracc.demo_filename's
    docstring). Open to any member of the Pracc's own team, not just its
    Teammanager - the "separate download function for our teams"."""
    try:
        pracc = await sync_to_async(Pracc.objects.select_related('own_team').get)(id=pracc_id)
    except Pracc.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pracc nicht gefunden.")

    if not await _can_access_pracc(current_user, pracc):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Berechtigung für dieses Demo.")

    if not pracc.demo_filename or not pracc.demo_uploaded_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kein Demo für diesen Pracc verfügbar.")

    expires_at = pracc.demo_uploaded_at + timedelta(days=settings.GAMESERVER_DEMO_DOWNLOAD_DAYS)
    if datetime.now(timezone.utc) >= expires_at:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=f"Der Download-Zeitraum für dieses Demo ist abgelaufen ({settings.GAMESERVER_DEMO_DOWNLOAD_DAYS} Tage nach Hochladen).",
        )

    file_path = os.path.join(settings.GAMESERVER_DEMOS_ROOT, pracc.demo_filename)
    if not await sync_to_async(os.path.isfile)(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Demo-Datei nicht gefunden.")

    return FileResponse(file_path, media_type="application/octet-stream", filename=pracc.demo_filename)

# --- CS2 gameserver dashboard (Phase 6: player self-service util-session) ---
# The util-practice slot (ServerSlot.kind == "util") is shared, unscheduled
# nade-lineup/warmup practice - unlike Praccs, any registered player may
# start/stop it themselves, not just a Teammanager/admin. No reservation
# system exists (mirrors the plan's own "no hard double-booking prevention"
# stance for Praccs) - starting an already-running slot is just a no-op.

class UtilSessionSchema(BaseModel):
    slot_id: int
    label: str
    status: str
    last_synced_at: Optional[str] = None

    class Config:
        from_attributes = True

def build_util_session_schema(slot: ServerSlot) -> UtilSessionSchema:
    return UtilSessionSchema(
        slot_id=slot.id,
        label=slot.label,
        status=slot.last_known_status,
        last_synced_at=slot.last_synced_at.isoformat() if slot.last_synced_at else None,
    )

async def _get_player_or_404(current_user: CustomUser) -> Player:
    """Mirrors the inline pattern GET/PUT /players/me/ already use - no
    shared dependency exists for this in the codebase, so this follows the
    same shape rather than inventing a new one."""
    player = await sync_to_async(Player.objects.select_related('user', 'team').filter(user=current_user).first)()
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kein Spielerprofil vorhanden.")
    return player

@app.get("/gameservers/util-session/", response_model=Optional[UtilSessionSchema])
async def get_util_session(current_user: CustomUser = Depends(get_current_user)):
    await _get_player_or_404(current_user)
    slot = await sync_to_async(ServerSlot.objects.filter(kind='util').first)()
    return build_util_session_schema(slot) if slot else None

@app.post("/gameservers/util-session/start/", response_model=UtilSessionSchema)
async def start_util_session(current_user: CustomUser = Depends(get_current_user)):
    await _get_player_or_404(current_user)
    slot = await sync_to_async(ServerSlot.objects.filter(kind='util').first)()
    if slot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kein Util-Server konfiguriert.")

    published = await sync_to_async(gameserver_redis_bridge.publish_slot_power)(slot, True)
    if not published:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Befehl konnte nicht an den Gameserver-Dienst gesendet werden.")

    def _mark():
        slot.last_known_status = "starting"
        slot.save(update_fields=['last_known_status'])
        return slot

    slot = await sync_to_async(_mark)()
    await sync_to_async(_log_action)(current_user, "update", "ServerSlot", slot.id, slot.label, {"action": "start", "self_service": True})
    return build_util_session_schema(slot)

@app.post("/gameservers/util-session/stop/", response_model=UtilSessionSchema)
async def stop_util_session(current_user: CustomUser = Depends(get_current_user)):
    await _get_player_or_404(current_user)
    slot = await sync_to_async(ServerSlot.objects.filter(kind='util').first)()
    if slot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kein Util-Server konfiguriert.")

    published = await sync_to_async(gameserver_redis_bridge.publish_slot_power)(slot, False)
    if not published:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Befehl konnte nicht an den Gameserver-Dienst gesendet werden.")

    def _mark():
        slot.last_known_status = "stopping"
        slot.save(update_fields=['last_known_status'])
        return slot

    slot = await sync_to_async(_mark)()
    await sync_to_async(_log_action)(current_user, "update", "ServerSlot", slot.id, slot.label, {"action": "stop", "self_service": True})
    return build_util_session_schema(slot)

# Curated subset of the auto-generated Django permissions that actually
# correspond to a manageable resource in this app (as opposed to every
# add/change/delete/view permission Django creates per model, which would be
# both noisier than useful here and finer-grained than any endpoint checks).
MANAGEABLE_PERMISSIONS: List[tuple[str, str, str]] = [
    ("news", "manage_news", "News verwalten"),
    ("sponsors", "manage_sponsors", "Sponsoren & Social Links verwalten"),
    ("teams", "manage_teams", "Alle Teams & Spieler verwalten (nicht nur eigenes Team)"),
    ("users", "manage_users", "Nutzer aktivieren/deaktivieren"),
    ("site_settings", "manage_site_settings", "Hero-Video & Seiten-Hintergründe verwalten"),
    ("applications", "manage_applications", "Bewerbungen einsehen & bearbeiten (alle Spiele)"),
    ("discord_bot", "manage_discord_bot", "Discord-Bot verwalten"),
    ("social_media", "manage_social_media_vault", "Social-Media-Zugangsdaten verwalten (Vaultwarden)"),
    ("gameservers", "manage_gameservers", "CS2-Gameserver verwalten"),
]

def _build_role_schema(group: Group) -> RoleSchema:
    codenames = [f"{p.content_type.app_label}.{p.codename}" for p in group.permissions.all()]
    return RoleSchema(id=group.id, name=group.name, permissions=codenames)

@app.get("/admin/permissions/", response_model=List[PermissionSchema])
async def get_manageable_permissions(current_admin: CustomUser = Depends(get_current_admin_user)):
    return [
        PermissionSchema(codename=f"{app_label}.{codename}", label=label)
        for app_label, codename, label in MANAGEABLE_PERMISSIONS
    ]

@app.get("/admin/roles/", response_model=List[RoleSchema])
async def get_all_roles(current_admin: CustomUser = Depends(get_current_admin_user)):
    def _collect():
        groups = Group.objects.all().prefetch_related('permissions__content_type').order_by('name')
        return [_build_role_schema(g) for g in groups]
    return await sync_to_async(_collect)()

@app.post("/admin/roles/", response_model=RoleSchema, status_code=status.HTTP_201_CREATED)
async def create_role(payload: RoleCreate, current_admin: CustomUser = Depends(get_current_admin_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role name must not be empty")
    if await sync_to_async(Group.objects.filter(name=name).exists)():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role already exists")
    group = await sync_to_async(Group.objects.create)(name=name)
    await sync_to_async(_log_action)(current_admin, "create", "Group", group.id, group.name)
    return RoleSchema(id=group.id, name=group.name)

@app.delete("/admin/roles/{role_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(role_id: int, current_admin: CustomUser = Depends(get_current_admin_user)):
    try:
        group = await sync_to_async(Group.objects.get)(id=role_id)
    except Group.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    group_name = group.name
    await sync_to_async(group.delete)()
    await sync_to_async(_log_action)(current_admin, "delete", "Group", role_id, group_name)

@app.put("/admin/roles/{role_id}/permissions/", response_model=RoleSchema)
async def set_role_permissions(
    role_id: int,
    payload: RolePermissionsUpdate,
    current_admin: CustomUser = Depends(get_current_admin_user),
):
    allowed_codenames = {f"{app_label}.{codename}" for app_label, codename, _ in MANAGEABLE_PERMISSIONS}
    unknown = set(payload.permissions) - allowed_codenames
    if unknown:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown permission(s): {', '.join(sorted(unknown))}")

    def _apply():
        group = Group.objects.get(id=role_id)
        perms = []
        for full_codename in payload.permissions:
            app_label, _, codename = full_codename.partition(".")
            perm = Permission.objects.get(content_type__app_label=app_label, codename=codename)
            perms.append(perm)
        group.permissions.set(perms)
        return _build_role_schema(group)

    try:
        role = await sync_to_async(_apply)()
    except Group.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    await sync_to_async(_log_action)(
        current_admin, "permission_assign", "Group", role_id, role.name, {"permissions": payload.permissions},
    )
    return role

@app.put("/admin/users/{user_id}/roles/", response_model=CustomUserSchema)
async def set_user_roles(
    user_id: int,
    payload: UserRolesUpdate,
    current_admin: CustomUser = Depends(get_current_admin_user),
):
    try:
        user = await sync_to_async(CustomUser.objects.get)(id=user_id)
    except CustomUser.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    groups = await sync_to_async(list)(Group.objects.filter(name__in=payload.roles))
    found_names = {g.name for g in groups}
    missing = set(payload.roles) - found_names
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown role(s): {', '.join(sorted(missing))}")

    await sync_to_async(user.groups.set)(groups)
    await sync_to_async(_log_action)(
        current_admin, "role_assign", "CustomUser", user.id, user.username, {"roles": payload.roles},
    )
    return await build_user_schema(user)

@app.put("/admin/users/{user_id}/superuser/", response_model=CustomUserSchema)
async def set_user_superuser(
    user_id: int,
    payload: SuperuserUpdate,
    current_admin: CustomUser = Depends(get_current_admin_user),
):
    """Grants or revokes full Admin access. Deliberately superuser-only and
    guarded against self-demotion, so a lone admin can't accidentally lock
    themselves out - another admin has to do it."""
    if user_id == current_admin.id and not payload.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Du kannst dir selbst nicht die Admin-Rechte entziehen. Lass das von einem anderen Admin machen.",
        )
    try:
        user = await sync_to_async(CustomUser.objects.get)(id=user_id)
    except CustomUser.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.is_superuser = payload.is_superuser
    user.is_staff = payload.is_superuser  # keeps Django-admin-site access in sync with API admin status
    await sync_to_async(user.save)(update_fields=["is_superuser", "is_staff"])
    await sync_to_async(_log_action)(
        current_admin,
        "superuser_grant" if payload.is_superuser else "superuser_revoke",
        "CustomUser", user.id, user.username,
    )
    return await build_user_schema(user)

# --- Admin: audit log (read-only, superuser-only oversight) ---

@app.get("/admin/audit-log/", response_model=List[AuditLogEntrySchema])
async def get_audit_log(
    current_admin: CustomUser = Depends(get_current_admin_user),
    resource_type: Optional[str] = None,
    limit: int = 200,
):
    def _collect():
        qs = AuditLogEntry.objects.all().order_by('-created_at')
        if resource_type:
            qs = qs.filter(resource_type=resource_type)
        return list(qs[:max(1, min(limit, 500))])

    entries = await sync_to_async(_collect)()
    return [
        AuditLogEntrySchema(
            id=e.id,
            actor_username=e.actor_username,
            action=e.action,
            resource_type=e.resource_type,
            resource_id=e.resource_id,
            resource_label=e.resource_label,
            details=e.details,
            created_at=e.created_at.isoformat(),
        )
        for e in entries
    ]

# --- Admin: dashboard stats ---

@app.get("/admin/dashboard/", response_model=DashboardStats)
async def get_dashboard_stats(
    current_user: CustomUser = Depends(require_roles(ROLE_TEAM_MANAGER, ROLE_AUTHOR)),
):
    def _collect():
        if current_user.is_superuser:
            active_users = CustomUser.objects.filter(is_active=True).count()
            total_users = CustomUser.objects.count()
            total_news = NewsArticle.objects.count()
            published_news = NewsArticle.objects.filter(status='published').count()
            sponsor_clicks = [
                ClickStat(id=s.id, label=s.name, click_count=s.click_count)
                for s in Sponsor.objects.order_by('-click_count')[:10]
            ]
            social_clicks = [
                ClickStat(id=l.id, label=l.get_platform_display(), click_count=l.click_count)
                for l in SocialLink.objects.order_by('-click_count')[:10]
            ]
            return DashboardStats(
                role="admin",
                total_users=total_users,
                active_users=active_users,
                pending_users=total_users - active_users,
                total_teams=Team.objects.count(),
                total_players=Player.objects.count(),
                total_news=total_news,
                published_news=published_news,
                draft_news=total_news - published_news,
                total_sponsors=Sponsor.objects.count(),
                total_social_links=SocialLink.objects.count(),
                sponsor_clicks=sponsor_clicks,
                social_clicks=social_clicks,
            )

        user_roles = set(current_user.roles)

        if ROLE_TEAM_MANAGER in user_roles:
            team = current_user.team
            return DashboardStats(
                role="team_manager",
                my_team_name=team.name if team else None,
                my_team_player_count=team.players.count() if team else 0,
            )

        # ROLE_AUTHOR (require_roles already rejected anyone with neither role)
        total_news = NewsArticle.objects.count()
        published_news = NewsArticle.objects.filter(status='published').count()
        return DashboardStats(
            role="author",
            total_news=total_news,
            published_news=published_news,
            draft_news=total_news - published_news,
            my_news_count=NewsArticle.objects.filter(author=current_user).count(),
        )

    return await sync_to_async(_collect)()

# --- Admin: FACEIT sync (manual trigger + status) ---

class FaceitSyncResult(BaseModel):
    players_synced: int = 0
    players_failed: int = 0
    matches_created: int = 0
    matches_updated: int = 0
    league_entries_failed: int = 0
    player_match_stats_synced: int = 0
    player_match_stats_failed: int = 0
    error: Optional[str] = None
    run_id: Optional[int] = None

class FaceitSyncRunSchema(BaseModel):
    id: int
    trigger: str
    started_at: str
    finished_at: Optional[str] = None
    players_synced: int
    players_failed: int
    matches_synced: int
    league_entries_failed: int
    player_match_stats_synced: int
    player_match_stats_failed: int
    error: Optional[str] = None

@app.post("/admin/faceit/sync/", response_model=FaceitSyncResult)
async def trigger_faceit_sync(current_admin: CustomUser = Depends(get_current_admin_user)):
    """Manually kick off a full FACEIT sync (all players + all team/league
    entries with FACEIT IDs set). Runs synchronously and returns a summary -
    for the automatic path see faceit_integration/scheduler.py, and for a
    CLI/cron path see `python manage.py sync_faceit`."""
    summary = await sync_to_async(faceit_sync.sync_all)(trigger="manual")
    await sync_to_async(_log_action)(current_admin, "trigger", "FaceitSync", None, None, summary)
    return FaceitSyncResult(**summary)

@app.get("/admin/faceit/status/", response_model=Optional[FaceitSyncRunSchema])
async def get_faceit_sync_status(current_admin: CustomUser = Depends(get_current_admin_user)):
    """Most recent FACEIT sync run (automatic, manual, or CLI), for the
    admin dashboard to show 'last synced at' / whether it succeeded."""
    def _latest():
        return FaceitSyncRun.objects.order_by('-started_at').first()

    run = await sync_to_async(_latest)()
    if run is None:
        return None
    return FaceitSyncRunSchema(
        id=run.id,
        trigger=run.trigger,
        started_at=run.started_at.isoformat(),
        finished_at=run.finished_at.isoformat() if run.finished_at else None,
        players_synced=run.players_synced,
        players_failed=run.players_failed,
        matches_synced=run.matches_synced,
        league_entries_failed=run.league_entries_failed,
        player_match_stats_synced=run.player_match_stats_synced,
        player_match_stats_failed=run.player_match_stats_failed,
        error=run.error,
    )

# =====================================================================
# Stats dashboard
#
# Three access levels, enforced per-endpoint below (no single require_roles
# works here since a plain player has no Django Group at all):
#   - Admin (is_superuser): every team and every player, full detail.
#   - Teammanager ("Team-Captain"): full detail (incl. every teammate's
#     individual stats) for their own team only.
#   - Everyone else (a plain player): their own individual stats, plus their
#     team's stats - but team stats intentionally only ever expose map-level
#     numbers (see _build_team_map_stats), never a per-teammate breakdown.
#
# Trend analysis ("Verbesserung/Verschlechterung über Zeit") is explicitly
# future work - PlayerFaceitStats only keeps the latest snapshot, there's no
# history table yet to compute a trend from.
# =====================================================================

class PlayerAdvancedStats(BaseModel):
    """Aggregated across every synced PlayerMatchStats row - the CS2
    "advanced stats" FACEIT exposes per match (utility, flash, entry,
    clutches), which the lifetime endpoint (/players/{id}/stats/{game}}
    doesn't provide at all."""
    matches_tracked: int
    avg_kills: Optional[float] = None
    avg_deaths: Optional[float] = None
    avg_assists: Optional[float] = None
    avg_kd_ratio: Optional[float] = None
    avg_kr_ratio: Optional[float] = None
    avg_headshots_percent: Optional[float] = None
    total_mvps: Optional[int] = None
    total_triple_kills: Optional[int] = None
    total_quadro_kills: Optional[int] = None
    total_penta_kills: Optional[int] = None
    avg_utility_damage: Optional[float] = None
    avg_enemies_flashed: Optional[float] = None
    flash_success_rate_percent: Optional[float] = None
    entry_success_rate_percent: Optional[float] = None
    clutch_1v1_success_rate_percent: Optional[float] = None
    clutch_1v2_success_rate_percent: Optional[float] = None

class PlayerMatchStatsSchema(BaseModel):
    faceit_match_id: str
    map_name: Optional[str] = None
    opponent_name: Optional[str] = None
    finished_at: Optional[str] = None
    result: Optional[str] = None
    kills: Optional[int] = None
    deaths: Optional[int] = None
    assists: Optional[int] = None
    kd_ratio: Optional[float] = None
    headshots_percent: Optional[float] = None
    mvps: Optional[int] = None
    utility_damage: Optional[float] = None
    flash_count: Optional[int] = None
    enemies_flashed: Optional[int] = None
    entry_count: Optional[int] = None
    entry_wins: Optional[int] = None

class PlayerStatsSchema(BaseModel):
    player_id: int
    ingame_name: str
    user_id: Optional[int] = None
    username: Optional[str] = None
    team_id: Optional[int] = None
    team_name: Optional[str] = None
    nickname: Optional[str] = None
    skill_level: Optional[int] = None
    faceit_elo: Optional[int] = None
    matches: Optional[int] = None
    win_rate_percent: Optional[float] = None
    avg_kd_ratio: Optional[float] = None
    avg_headshots_percent: Optional[float] = None
    last_synced_at: Optional[str] = None
    advanced: Optional[PlayerAdvancedStats] = None
    recent_matches: List[PlayerMatchStatsSchema] = []

class TeamMapStat(BaseModel):
    map_name: str
    matches_played: int
    wins: int
    losses: int
    win_rate_percent: float

class TeamStatsSchema(BaseModel):
    team_id: int
    team_name: str
    matches_played: int
    wins: int
    losses: int
    win_rate_percent: float
    maps: List[TeamMapStat]
    players: Optional[List[PlayerStatsSchema]] = None  # only for Admin/Teammanager of this team

class TeamStatsSummarySchema(BaseModel):
    """Slim per-team row for the admin's "all teams" overview - no roster
    breakdown, just enough to compare teams at a glance."""
    team_id: int
    team_name: str
    matches_played: int
    wins: int
    losses: int
    win_rate_percent: float
    player_count: int

class MyStatsSchema(BaseModel):
    player: Optional[PlayerStatsSchema] = None
    team: Optional[TeamStatsSchema] = None  # always map-only (players=None)


RECENT_MATCHES_LIMIT = 10

def _build_player_advanced_stats(match_stats: list[PlayerMatchStats]) -> Optional[PlayerAdvancedStats]:
    if not match_stats:
        return None

    def avg(attr: str) -> Optional[float]:
        values = [getattr(m, attr) for m in match_stats if getattr(m, attr) is not None]
        return round(sum(values) / len(values), 2) if values else None

    def total(attr: str) -> Optional[int]:
        values = [getattr(m, attr) for m in match_stats if getattr(m, attr) is not None]
        return sum(values) if values else None

    def rate(success_attr: str, count_attr: str) -> Optional[float]:
        successes = sum(getattr(m, success_attr) or 0 for m in match_stats)
        counts = sum(getattr(m, count_attr) or 0 for m in match_stats)
        return round(successes / counts * 100, 1) if counts else None

    return PlayerAdvancedStats(
        matches_tracked=len(match_stats),
        avg_kills=avg('kills'),
        avg_deaths=avg('deaths'),
        avg_assists=avg('assists'),
        avg_kd_ratio=avg('kd_ratio'),
        avg_kr_ratio=avg('kr_ratio'),
        avg_headshots_percent=avg('headshots_percent'),
        total_mvps=total('mvps'),
        total_triple_kills=total('triple_kills'),
        total_quadro_kills=total('quadro_kills'),
        total_penta_kills=total('penta_kills'),
        avg_utility_damage=avg('utility_damage'),
        avg_enemies_flashed=avg('enemies_flashed'),
        flash_success_rate_percent=rate('flash_successes', 'flash_count'),
        entry_success_rate_percent=rate('entry_wins', 'entry_count'),
        clutch_1v1_success_rate_percent=rate('clutch_1v1_wins', 'clutch_1v1_count'),
        clutch_1v2_success_rate_percent=rate('clutch_1v2_wins', 'clutch_1v2_count'),
    )

def _build_player_match_stats_schema(m: PlayerMatchStats) -> PlayerMatchStatsSchema:
    # Exactly one of match (roster player's league match)/solo_match
    # (teamless player's own FACEIT history) is ever set - see the
    # CheckConstraint on PlayerMatchStats. Both expose the same
    # faceit_match_id/map_name/opponent_name/finished_at shape.
    match = m.match or m.solo_match
    return PlayerMatchStatsSchema(
        faceit_match_id=match.faceit_match_id,
        map_name=match.map_name,
        opponent_name=match.opponent_name,
        finished_at=match.finished_at.isoformat() if match.finished_at else None,
        result=m.result,
        kills=m.kills,
        deaths=m.deaths,
        assists=m.assists,
        kd_ratio=m.kd_ratio,
        headshots_percent=m.headshots_percent,
        mvps=m.mvps,
        utility_damage=m.utility_damage,
        flash_count=m.flash_count,
        enemies_flashed=m.enemies_flashed,
        entry_count=m.entry_count,
        entry_wins=m.entry_wins,
    )

def _build_player_stats_schema(player: Player) -> PlayerStatsSchema:
    stats = getattr(player, 'faceit_stats', None)
    # order_by('-match__finished_at') would break/mis-sort solo_match rows
    # (match is null there) - sort in Python off whichever side is set instead.
    match_stats = sorted(
        PlayerMatchStats.objects.filter(player=player).select_related('match', 'solo_match'),
        key=lambda m: (m.match or m.solo_match).finished_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return PlayerStatsSchema(
        player_id=player.id,
        ingame_name=player.ingame_name,
        user_id=player.user_id,
        username=player.user.username if player.user else None,
        team_id=player.team_id,
        team_name=player.team.name if player.team else None,
        nickname=stats.nickname if stats else None,
        skill_level=stats.skill_level if stats else None,
        faceit_elo=stats.faceit_elo if stats else None,
        matches=stats.matches if stats else None,
        win_rate_percent=stats.win_rate_percent if stats else None,
        avg_kd_ratio=stats.avg_kd_ratio if stats else None,
        avg_headshots_percent=stats.avg_headshots_percent if stats else None,
        last_synced_at=stats.last_synced_at.isoformat() if stats and stats.last_synced_at else None,
        advanced=_build_player_advanced_stats(match_stats),
        recent_matches=[_build_player_match_stats_schema(m) for m in match_stats[:RECENT_MATCHES_LIMIT]],
    )

def _build_team_map_stats(team: Team) -> tuple[List[TeamMapStat], int, int, int]:
    """Aggregates finished TeamFaceitMatch rows for this team by map_name.
    Returns (per-map breakdown, total wins, total losses, total matches) -
    this is deliberately the *only* team-level stat: maps played and their
    win/loss record, nothing derived from individual player performance."""
    matches = TeamFaceitMatch.objects.filter(league_entry__team=team, status='finished')
    by_map: dict[str, dict] = {}
    wins = losses = 0
    for m in matches:
        if m.result == 'win':
            wins += 1
        elif m.result == 'loss':
            losses += 1
        map_key = m.map_name or "Unbekannt"
        entry = by_map.setdefault(map_key, {"played": 0, "wins": 0, "losses": 0})
        entry["played"] += 1
        if m.result == 'win':
            entry["wins"] += 1
        elif m.result == 'loss':
            entry["losses"] += 1
    maps = [
        TeamMapStat(
            map_name=name,
            matches_played=v["played"],
            wins=v["wins"],
            losses=v["losses"],
            win_rate_percent=round(v["wins"] / v["played"] * 100, 1) if v["played"] else 0.0,
        )
        for name, v in sorted(by_map.items(), key=lambda kv: -kv[1]["played"])
    ]
    return maps, wins, losses, wins + losses

def _build_team_stats_schema(team: Team, include_players: bool) -> TeamStatsSchema:
    maps, wins, losses, total = _build_team_map_stats(team)
    players_schema = None
    if include_players:
        roster = list(team.players.select_related('user', 'faceit_stats').order_by('ingame_name'))
        players_schema = [_build_player_stats_schema(p) for p in roster]
    return TeamStatsSchema(
        team_id=team.id,
        team_name=team.name,
        matches_played=total,
        wins=wins,
        losses=losses,
        win_rate_percent=round(wins / total * 100, 1) if total else 0.0,
        maps=maps,
        players=players_schema,
    )


async def _resolve_team_stats_access(current_user: CustomUser, team_id: int) -> bool:
    """Returns whether the caller may see this team's per-player roster
    breakdown (True: Admin or this team's Teammanager) or only its map-level
    summary (False: a plain member of the team). Raises 403 for anyone with
    no relationship to this team at all."""
    if current_user.is_superuser:
        return True
    if current_user.team_id != team_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Keine Berechtigung für die Statistiken dieses Teams.",
        )
    user_roles = await sync_to_async(lambda: set(current_user.roles))()
    return ROLE_TEAM_MANAGER in user_roles

async def _resolve_player_stats_access(current_user: CustomUser, player: Player) -> None:
    """Raises 403 unless the caller is an Admin, the player themself, or the
    Teammanager of the player's team."""
    if current_user.is_superuser or player.user_id == current_user.id:
        return
    if player.team_id is not None and current_user.team_id == player.team_id:
        user_roles = await sync_to_async(lambda: set(current_user.roles))()
        if ROLE_TEAM_MANAGER in user_roles:
            return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Keine Berechtigung für diese Spieler-Statistik.",
    )


@app.get("/stats/me/", response_model=MyStatsSchema)
async def get_my_stats(current_user: CustomUser = Depends(get_current_user)):
    """Every logged-in user's own entry point: their individual FACEIT
    stats (if they have a linked Player profile) plus their team's map-only
    stats (never a teammate breakdown - use /stats/teams/{id}/ for that,
    which is itself gated to Admin/Teammanager)."""
    def _collect():
        player = (
            Player.objects.select_related('team', 'user', 'faceit_stats')
            .filter(user=current_user).first()
        )
        player_schema = _build_player_stats_schema(player) if player else None
        team = player.team if player else current_user.team
        team_schema = _build_team_stats_schema(team, include_players=False) if team else None
        return MyStatsSchema(player=player_schema, team=team_schema)

    return await sync_to_async(_collect)()

@app.get("/stats/teams/", response_model=List[TeamStatsSummarySchema])
async def get_all_team_stats(current_admin: CustomUser = Depends(get_current_admin_user)):
    """Admin-only overview of every team's map-record, for comparing teams
    at a glance without drilling into each one."""
    def _collect():
        result = []
        for team in Team.objects.all().order_by('name'):
            _, wins, losses, total = _build_team_map_stats(team)
            result.append(TeamStatsSummarySchema(
                team_id=team.id,
                team_name=team.name,
                matches_played=total,
                wins=wins,
                losses=losses,
                win_rate_percent=round(wins / total * 100, 1) if total else 0.0,
                player_count=team.players.count(),
            ))
        return result

    return await sync_to_async(_collect)()

@app.get("/stats/teams/{team_id}/", response_model=TeamStatsSchema)
async def get_team_stats(team_id: int, current_user: CustomUser = Depends(get_current_user)):
    try:
        team = await sync_to_async(Team.objects.get)(id=team_id)
    except Team.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    include_players = await _resolve_team_stats_access(current_user, team_id)
    return await sync_to_async(_build_team_stats_schema)(team, include_players)

@app.get("/stats/players/", response_model=List[PlayerStatsSchema])
async def get_all_player_stats(current_admin: CustomUser = Depends(get_current_admin_user)):
    """Admin-only: every player across every team, for the full roster
    stats overview."""
    def _collect():
        players = Player.objects.select_related('user', 'team', 'faceit_stats').order_by('ingame_name')
        return [_build_player_stats_schema(p) for p in players]

    return await sync_to_async(_collect)()

@app.get("/stats/players/{player_id}/", response_model=PlayerStatsSchema)
async def get_player_stats_detail(player_id: int, current_user: CustomUser = Depends(get_current_user)):
    try:
        player = await sync_to_async(
            Player.objects.select_related('user', 'team', 'faceit_stats').get
        )(id=player_id)
    except Player.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    await _resolve_player_stats_access(current_user, player)
    return await sync_to_async(_build_player_stats_schema)(player)
