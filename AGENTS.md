# Meme Vault — Meme Collection & Management App

## Goal

Collect, process, and publish meme clips from YouTube through an automated media pipeline to GitHub and Instagram.

## Description

A Next.js web application for managing meme clips. The pipeline downloads videos from YouTube, burns captions, converts to GIFs, and uploads to GitHub (storage) and Instagram. Supabase stores metadata. A background worker handles async pipeline jobs and a cron job syncs GitHub storage with Supabase metadata.

## Architecture

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

## Progress

Core media pipeline is functional. Web UI, worker, and cron are running. GitHub and Instagram upload integrations are in place.

## Media Pipeline

YouTube download → caption burning → GIF conversion → GitHub upload → Instagram upload → Supabase metadata save. Each step is a dedicated skill in the parent repo's `independent_node_skills/`.

## Environment

Requires `.env.development` (local) or `.env` (production) with Supabase URL/key, GitHub token, and Instagram credentials. The app auto-starts Supabase via `npm run db:start`.
