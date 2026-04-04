#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=== Syncing local environment with production ==="

# Parse env file to get a specific variable
get_env_var() {
  local file=$1
  local var=$2
  grep "^${var}=" "$file" 2>/dev/null | cut -d'=' -f2 | tr -d '\n\r'
}

# Get branch names from env files
LOCAL_BRANCH=$(get_env_var ".env.development" "NEXT_PUBLIC_GITHUB_BRANCH")
PROD_BRANCH=$(get_env_var ".env" "NEXT_PUBLIC_GITHUB_BRANCH")
GITHUB_TOKEN=$(get_env_var ".env" "GITHUB_TOKEN")
GITHUB_REPO=$(get_env_var ".env" "NEXT_PUBLIC_GITHUB_REPO")

echo "Local branch: $LOCAL_BRANCH"
echo "Prod branch: $PROD_BRANCH"
echo "Repo: $GITHUB_REPO"

# 1. Sync local branch with prod branch (force update to match)
if [ -n "$GITHUB_TOKEN" ] && [ -n "$GITHUB_REPO" ] && [ -n "$LOCAL_BRANCH" ] && [ -n "$PROD_BRANCH" ]; then
  echo ""
  echo "Syncing '$LOCAL_BRANCH' branch with '$PROD_BRANCH'..."

  # Get prod branch SHA
  PROD_SHA=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/$GITHUB_REPO/git/refs/heads/$PROD_BRANCH" | \
    grep -o '"sha": "[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -n "$PROD_SHA" ]; then
    echo "Source branch SHA: $PROD_SHA"

    # Force update local branch to match prod branch
    RESPONSE=$(curl -s -X PATCH -H "Authorization: token $GITHUB_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"sha\": \"$PROD_SHA\", \"force\": true}" \
      "https://api.github.com/repos/$GITHUB_REPO/git/refs/heads/$LOCAL_BRANCH" 2>/dev/null)

    if echo "$RESPONSE" | grep -q '"ref"'; then
      echo "Synced '$LOCAL_BRANCH' with '$PROD_BRANCH' ($PROD_SHA)"
    else
      # Branch might not exist, create it
      echo "Branch doesn't exist, creating..."
      RESPONSE=$(curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"ref\": \"refs/heads/$LOCAL_BRANCH\", \"sha\": \"$PROD_SHA\"}" \
        "https://api.github.com/repos/$GITHUB_REPO/git/refs" 2>/dev/null)

      if echo "$RESPONSE" | grep -q '"ref"'; then
        echo "Created '$LOCAL_BRANCH' from '$PROD_BRANCH' ($PROD_SHA)"
      else
        echo "Warning: Could not sync/create branch"
      fi
    fi
  else
    echo "Warning: Could not get '$PROD_BRANCH' branch SHA"
  fi
else
  echo "Warning: Missing GitHub config in env files"
fi

# 2. Sync production database to local
echo ""
echo "Syncing production database to local..."
node --experimental-strip-types "$SCRIPT_DIR/sync-prod-db.ts"

echo ""
echo "=== Sync complete ==="
