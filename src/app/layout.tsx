import type { Metadata } from 'next';
import { Providers } from './providers';

// eslint-disable-next-line react-refresh/only-export-components
export const metadata: Metadata = {
  title: 'Meme Vault',
  description: 'Your personal meme clip collection',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
