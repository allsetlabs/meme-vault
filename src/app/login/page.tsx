'use client';

import { useRouter } from 'next/navigation';
import { AuthLogin } from '@allsetlabs/forge/components/auth-login';
import { useAuth } from '@allsetlabs/forge/statefulComponents/auth/context';
import type { AuthTokenResponse } from '@allsetlabs/forge/types/auth';

async function googleLogin(credential: string): Promise<AuthTokenResponse> {
  const response = await fetch('/api/auth/google-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }

  return response.json();
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const handleSuccess = async (credential: string) => {
    const tokenResponse = await googleLogin(credential);
    login(tokenResponse);
    router.push('/');
  };

  return (
    <AuthLogin
      title="Meme Vault"
      description="Sign in to manage your memes"
      onSuccessLogin={handleSuccess}
    />
  );
}
