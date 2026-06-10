# Meme Vault — Meme Collection & Management App

## Purpose

Collect, process, and publish meme clips from YouTube through an automated media pipeline to GitHub and Instagram.

## Mental Model

A Next.js web application for managing meme clips. The pipeline downloads videos from YouTube, burns captions, converts to GIFs, and uploads to GitHub (storage) and Instagram. Supabase stores metadata. A background worker handles async pipeline jobs and a cron job syncs GitHub storage with Supabase metadata.

## Where Things Go

```
meme-vault/
├── src/
│   ├── app/          # Next.js app router pages
│   ├── components/   # React components
│   ├── lib/          # Utilities, API clients, helpers
│   └── types/        # TypeScript type definitions
├── worker/           # Background job processor (async pipeline)
├── cron/             # Scheduled tasks (GitHub → Supabase storage sync)
├── scripts/          # Shell scripts (DB reset, etc.)
├── supabase/         # Local Supabase config and migrations
└── independent_node_skills/  # Standalone Node.js scripts for media processing
```

Stack: Next.js + React + TypeScript + Tailwind CSS. Uses `@allsetlabs/reusable` from `../forge`. Supabase for database and file storage.

## Development Commands

- `make setup` — check system dependencies
- `make install` — install dependencies
- `make start` — start app, worker, and cron in tmux
- `npm run build` — build the Next.js app
- `npm run type-check` — verify TypeScript
- `npm run db:start` / `npm run db:stop` — manage local Supabase

## Current Capabilities

Core media pipeline is functional. Web UI, worker, and cron are running. GitHub and Instagram upload integrations are in place.

## Testing Expectations

Run `npm run type-check` after code changes. Run `npm run build` for app or pipeline changes that affect runtime behavior. For UI changes, open the affected page, test the workflow, and check the browser console.

## Media Pipeline

YouTube download → caption burning → GIF conversion → GitHub upload → Instagram upload → Supabase metadata save. Each step is a dedicated skill in the parent repo's `independent_node_skills/`.

## Environment

Requires `.env.development` (local) or `.env` (production) with Supabase URL/key, GitHub token, and Instagram credentials. The app auto-starts Supabase via `npm run db:start`.
