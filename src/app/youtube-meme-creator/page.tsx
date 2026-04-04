'use client';

import { Suspense } from 'react';
import { MemeEditor } from '@/components/MemeEditor';

function YouTubeMemeCreatorContent() {
  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-8 text-3xl font-bold text-foreground">YouTube Meme Creator</h1>
        <MemeEditor playerId="youtube-player-create" />
      </div>
    </div>
  );
}

export default function YouTubeMemeCreator() {
  return (
    <Suspense
      fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}
    >
      <YouTubeMemeCreatorContent />
    </Suspense>
  );
}
