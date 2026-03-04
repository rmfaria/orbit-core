#!/usr/bin/env bash
# linkedin-post.sh — Post to LinkedIn via n8n webhook
# Usage:
#   linkedin-post.sh "Text to post"
#   linkedin-post.sh --file path/to/markdown.md
#
# Requires: N8N_WEBHOOK_URL env var (or edit default below)

set -euo pipefail

N8N_WEBHOOK_URL="${N8N_WEBHOOK_URL:-https://n8n.nesecurity.com.br/webhook/linkedin-post}"

# ── Parse input ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--file" ]]; then
  FILE="${2:?Usage: $0 --file <path>}"
  if [[ ! -f "$FILE" ]]; then
    echo "Error: file not found: $FILE" >&2
    exit 1
  fi
  TEXT=$(cat "$FILE")
elif [[ -n "${1:-}" ]]; then
  TEXT="$1"
else
  echo "Usage: $0 \"Post text here\""
  echo "       $0 --file path/to/post.md"
  exit 1
fi

# ── Send to n8n webhook ───────────────────────────────────────────────────
echo "Posting to LinkedIn via n8n..."
RESPONSE=$(curl -sf -X POST "$N8N_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg text "$TEXT" '{ text: $text }')")

STATUS=$(echo "$RESPONSE" | jq -r '.status // "unknown"')

if [[ "$STATUS" == "posted" ]]; then
  echo "Published successfully!"
else
  echo "Response: $RESPONSE"
fi
