import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { AuthTokenResponse } from '@allsetlabs/reusable/types/auth';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

export async function POST(request: NextRequest) {
  try {
    const { credential } = await request.json();

    if (!credential) {
      return NextResponse.json({ error: 'Missing credential' }, { status: 400 });
    }

    // Verify Google credential with Supabase Auth
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: credential,
    });

    if (error || !data.session || !data.user) {
      console.error('Supabase auth error:', error);
      return NextResponse.json(
        { error: error?.message || 'Authentication failed' },
        { status: 401 }
      );
    }

    const googleId = data.user.user_metadata?.sub ?? data.user.id;
    const email = data.user.email ?? '';
    const name = data.user.user_metadata?.full_name ?? data.user.user_metadata?.name ?? '';
    const profilePicture =
      data.user.user_metadata?.avatar_url ?? data.user.user_metadata?.picture ?? null;

    // Upsert user in database
    const { data: dbUser, error: dbError } = await supabase
      .from('users')
      .upsert(
        { google_id: googleId, email, name, profile_picture: profilePicture },
        { onConflict: 'google_id' }
      )
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
    }

    const response: AuthTokenResponse = {
      access_token: data.session.access_token,
      token_type: 'bearer',
      user: {
        id: dbUser?.id?.toString() ?? data.user.id,
        email,
        name,
        picture: profilePicture,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Google login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
