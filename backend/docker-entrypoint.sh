#!/bin/sh
set -e

echo "Running database migrations..."
python manage.py migrate --noinput

# Optional one-time admin bootstrap - only runs if all three vars are set
# and no superuser exists yet, so the target server needs zero shell access
# to get its first admin account (see README "Produktion mit Docker").
if [ -n "$DJANGO_SUPERUSER_USERNAME" ] && [ -n "$DJANGO_SUPERUSER_EMAIL" ] && [ -n "$DJANGO_SUPERUSER_PASSWORD" ]; then
  echo "Ensuring initial superuser exists..."
  python manage.py shell -c "
from users.models import CustomUser
if not CustomUser.objects.filter(is_superuser=True).exists():
    CustomUser.objects.create_superuser('$DJANGO_SUPERUSER_USERNAME', '$DJANGO_SUPERUSER_EMAIL', '$DJANGO_SUPERUSER_PASSWORD')
    print('Superuser created.')
else:
    print('A superuser already exists, skipping.')
"
fi

echo "Collecting static files..."
python manage.py collectstatic --noinput --clear

# Single process, no --workers flag (defaults to 1) - the in-process
# APScheduler jobs (faceit_integration/scheduler.py, social_stats/scheduler.py)
# are not safe to run more than once, so this backend service must stay at
# exactly one replica (see docker-compose.yml).
echo "Starting FastAPI app..."
exec uvicorn fastapi_app.main:app --host 0.0.0.0 --port 8000
