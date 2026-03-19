#!/usr/bin/env bash
# Build DATABASE_URL from individual ECS secret env vars (if present)
if [ -n "$DB_HOST" ] && [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

# Build CORS_ORIGIN from CloudFront URL if not set
if [ -z "$CORS_ORIGIN" ] && [ -n "$CLOUDFRONT_URL" ]; then
  export CORS_ORIGIN="$CLOUDFRONT_URL"
fi

exec node server/dist/index.js
