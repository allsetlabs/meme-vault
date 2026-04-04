# Meme Vault — Meme Collection & Management App

A Next.js web application for collecting, processing, and managing meme clips. Features a media pipeline that downloads videos from YouTube, adds captions, converts to GIFs, and uploads to GitHub and Instagram. Uses Supabase for metadata storage and a background worker for async processing.

## Structure

```
meme-vault/
├── src/
│   ├── app/          # Next.js app router pages
│   ├── components/   # React components
│   ├── lib/          # Utilities, API clients, helpers
│   └── types/        # TypeScript type definitions
├── worker/           # Background job processor
├── cron/             # Scheduled tasks (storage sync)
├── scripts/          # Shell scripts (DB reset, etc.)
├── supabase/         # Local Supabase config and migrations
└── independent_node_skills/  # Standalone Node.js scripts for media processing
```

## Key Services

- **Web App** — Next.js frontend for browsing and managing memes
- **Worker** — Background process for async media pipeline jobs
- **Cron** — Scheduled sync between GitHub storage and Supabase metadata
- **Supabase** — Local Supabase instance for database and storage

## Environment

Requires `.env.development` (local) or `.env` (production) with Supabase, GitHub, and Instagram credentials. The app auto-starts Supabase via `npm run db:start`.

## Media Pipeline

The meme creation flow: YouTube download → caption burning → GIF conversion → GitHub upload → Instagram upload → Supabase metadata save. Each step is handled by dedicated skills in the parent repo.
