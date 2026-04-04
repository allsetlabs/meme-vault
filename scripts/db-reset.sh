#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Parse env file to get a specific variable
get_env_var() {
  local file=$1
  local var=$2
  grep "^${var}=" "$file" 2>/dev/null | cut -d'=' -f2 | tr -d '\n\r'
}

# Get config from env files
LOCAL_BRANCH=$(get_env_var ".env.development" "NEXT_PUBLIC_GITHUB_BRANCH")
GITHUB_TOKEN=$(get_env_var ".env" "GITHUB_TOKEN")
GITHUB_REPO=$(get_env_var ".env" "NEXT_PUBLIC_GITHUB_REPO")

# Delete the branch from GitHub
if [ -n "$GITHUB_TOKEN" ] && [ -n "$GITHUB_REPO" ] && [ -n "$LOCAL_BRANCH" ]; then
  echo "Deleting '$LOCAL_BRANCH' branch from GitHub..."
  RESPONSE=$(curl -s -X DELETE -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/$GITHUB_REPO/git/refs/heads/$LOCAL_BRANCH" 2>/dev/null)

  if [ -z "$RESPONSE" ]; then
    echo "Deleted '$LOCAL_BRANCH' branch"
  else
    echo "Warning: $RESPONSE"
  fi
else
  echo "Warning: Missing GitHub config"
fi

# Reset Supabase database
echo "Resetting Supabase database..."
npx supabase db reset
