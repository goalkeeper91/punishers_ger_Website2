"""Growth-over-time and Twitch-viewer helpers built entirely on data this
app already collects - see models.SocialStatsSnapshot/TwitchViewerSnapshot.
No extra platform integration needed: every place that sets a follower
count (auto-sync, manual entry, Twitch connect, screenshot OCR) also calls
record_follower_snapshot() below, and a trend is just "latest vs. the
closest snapshot ~N days ago"."""

from datetime import timedelta
from typing import Optional

from django.utils import timezone

from .models import SocialStatsSnapshot, TwitchViewerSnapshot

DEFAULT_TREND_DAYS = 30


def record_follower_snapshot(*, user=None, social_link=None, platform: str, **metrics) -> None:
    """`metrics` is any subset of follower_count/view_count/like_count/
    comment_count/share_count/reach_count/impressions_count - whichever the
    caller actually has a fresh value for (see
    social_stats.models.ENGAGEMENT_METRIC_FIELDS)."""
    if not any(value is not None for value in metrics.values()):
        return  # nothing to log
    SocialStatsSnapshot.objects.create(user=user, social_link=social_link, platform=platform, **metrics)


def compute_follower_trend(*, user=None, social_link=None, platform: str, days: int = DEFAULT_TREND_DAYS) -> Optional[dict]:
    """Returns {"change": int, "percent": float|None, "days": int} comparing
    the latest snapshot to the closest one at least `days` old, or None if
    there isn't enough history yet (fewer than 2 snapshots)."""
    qs = SocialStatsSnapshot.objects.filter(platform=platform, follower_count__isnull=False)
    qs = qs.filter(user=user) if user is not None else qs.filter(social_link=social_link)
    snapshots = list(qs.order_by("recorded_at"))
    if len(snapshots) < 2:
        return None

    latest = snapshots[-1]
    cutoff = latest.recorded_at - timedelta(days=days)
    baseline = snapshots[0]
    for snapshot in snapshots:
        if snapshot.recorded_at <= cutoff:
            baseline = snapshot
        else:
            break
    if baseline is latest:
        return None

    change = latest.follower_count - baseline.follower_count
    percent = round(change / baseline.follower_count * 100, 1) if baseline.follower_count > 0 else None
    return {"change": change, "percent": percent, "days": (latest.recorded_at - baseline.recorded_at).days}


def compute_viewer_stats(*, user=None, social_link=None, days: int = DEFAULT_TREND_DAYS) -> Optional[dict]:
    """Returns {"avg_viewers": float, "peak_viewers": int, "samples": int}
    over the last `days`, or None if no viewer snapshots exist yet."""
    since = timezone.now() - timedelta(days=days)
    qs = TwitchViewerSnapshot.objects.filter(recorded_at__gte=since)
    qs = qs.filter(user=user) if user is not None else qs.filter(social_link=social_link)
    counts = list(qs.values_list("viewer_count", flat=True))
    if not counts:
        return None
    return {"avg_viewers": round(sum(counts) / len(counts), 1), "peak_viewers": max(counts), "samples": len(counts)}
