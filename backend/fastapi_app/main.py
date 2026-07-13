from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hashlib

import logging

import jwt
from fastapi import FastAPI, HTTPException, status, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
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
from faceit_integration import sync as faceit_sync
from faceit_integration.models import FaceitSyncRun, TeamFaceitMatch, PlayerMatchStats
from faceit_integration.scheduler import start_scheduler, stop_scheduler
from twitch_integration.client import TwitchClient, TwitchAPIError, extract_twitch_login
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
    yield
    stop_scheduler()
    stop_social_stats_scheduler()

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
SOCIAL_PLATFORMS = {"twitch", "youtube", "twitter", "instagram", "discord", "tiktok", "other"}

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
    user_id: int  # Player.user is required (one player profile per user account)

class PlayerUpdate(BaseModel):
    ingame_name: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    team_id: Optional[int] = None
    user_id: Optional[int] = None

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
        setattr(user, field, value)
        update_fields.append(field)

    if update_fields:
        await sync_to_async(user.save)(update_fields=update_fields)

    return await build_user_schema(user)

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
    await sync_to_async(user.save)(update_fields=['is_active'])
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
    users = await sync_to_async(list)(CustomUser.objects.all().order_by('username'))
    return [await build_user_schema(user) for user in users]

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

    try:
        user = await sync_to_async(CustomUser.objects.get)(id=payload.user_id)
    except CustomUser.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found")
    if await sync_to_async(Player.objects.filter(user=user).exists)():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This user already has a player profile")

    player = await sync_to_async(Player.objects.create)(
        team=team,
        user=user,
        ingame_name=payload.ingame_name,
        role=payload.role,
        description=payload.description,
    )
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
    await sync_to_async(player.save)()
    await sync_to_async(_log_action)(current_user, "update", "Player", player.id, player.ingame_name, {"fields": update_fields})
    return await build_player_schema(player)

@app.delete("/admin/players/{player_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_player(player_id: int, current_user: CustomUser = Depends(require_team_management_access)):
    try:
        player = await sync_to_async(Player.objects.select_related('team').get)(id=player_id)
    except Player.DoesNotExist:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")
    if player.team is not None:
        await ensure_team_access(current_user, player.team)
    elif not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to perform this action")
    player_name = player.ingame_name
    await sync_to_async(player.delete)()
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

# Curated subset of the auto-generated Django permissions that actually
# correspond to a manageable resource in this app (as opposed to every
# add/change/delete/view permission Django creates per model, which would be
# both noisier than useful here and finer-grained than any endpoint checks).
MANAGEABLE_PERMISSIONS: List[tuple[str, str, str]] = [
    ("news", "manage_news", "News verwalten"),
    ("sponsors", "manage_sponsors", "Sponsoren & Social Links verwalten"),
    ("teams", "manage_teams", "Alle Teams & Spieler verwalten (nicht nur eigenes Team)"),
    ("users", "manage_users", "Nutzer aktivieren/deaktivieren"),
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
    match = m.match
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
    match_stats = list(
        PlayerMatchStats.objects.filter(player=player)
        .select_related('match').order_by('-match__finished_at')
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
