'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InitializeReusableChunks } from '@subbiah/reusable/InitializeReusableChunks';

const queryClient = new QueryClient();

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <InitializeReusableChunks applyToBody auth={{ googleClientId: GOOGLE_CLIENT_ID }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </InitializeReusableChunks>
  );
}
