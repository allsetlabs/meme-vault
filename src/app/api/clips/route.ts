import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import type {
  Clip,
  ClipsListResponse,
  CreateClipRequest,
  CreateJobPayload,
  UpdateJobPayload,
  QueueJobResponse,
  UpdateClipRequest,
} from '@/types/clip';
import { deleteMeme } from '../../../../independent_node_skills/delete-meme';

/**
 * GET /api/clips - List clips with pagination and filtering
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const search = searchParams.get('search') || '';
    const tags = searchParams.get('tags')?.split(',').filter(Boolean) || [];

    const offset = (page - 1) * limit;

    // Build query
    let query = supabase.from('clips').select('*', { count: 'exact' });

    // Apply search filter (partial matching on name, caption)
    if (search) {
      query = query.or(`name.ilike.%${search}%,caption.ilike.%${search}%`);
    }

    // Apply tags filter
    if (tags.length > 0) {
      query = query.contains('tags', tags);
    }

    // Apply pagination
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data: clips, count, error } = await query;

    if (error) {
      console.error('Supabase query error:', error);
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    const response: ClipsListResponse = {
      clips: clips as Clip[],
      total,
      page,
      limit,
      totalPages,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('GET /api/clips error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/clips - Queue a new clip for processing
 * Creates a job in the jobs table that will be processed by the local worker
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreateClipRequest = await request.json();
    const { name, source_url, start_seconds, stop_seconds, caption, thumbnail_second, tags, user } =
      body;

    // Validate required fields
    if (!source_url || start_seconds === undefined || stop_seconds === undefined || !user) {
      return NextResponse.json(
        { error: 'Missing required fields (source_url, start_seconds, stop_seconds, user)' },
        { status: 400 }
      );
    }

    // Create job payload
    const payload: CreateJobPayload = {
      name,
      source_url,
      start_seconds,
      stop_seconds,
      caption,
      thumbnail_second,
      tags,
    };

    // Insert job into queue with type 'create'
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({ type: 'create', payload, status: 'pending', user })
      .select('id, status')
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({ error: 'Failed to queue job' }, { status: 500 });
    }

    const response: QueueJobResponse = {
      job_id: job.id,
      status: job.status,
      message: 'Job queued successfully. Run the worker locally to process.',
    };

    return NextResponse.json(response, { status: 202 });
  } catch (error) {
    console.error('POST /api/clips error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/clips - Toggle clip approval status
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, approved } = body;

    if (!id || typeof approved !== 'boolean') {
      return NextResponse.json({ error: 'Missing id or approved field' }, { status: 400 });
    }

    const { data: clip, error } = await supabase
      .from('clips')
      .update({ approved })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Supabase update error:', error);
      return NextResponse.json({ error: 'Failed to update clip' }, { status: 500 });
    }

    return NextResponse.json({ clip });
  } catch (error) {
    console.error('PATCH /api/clips error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/clips - Delete a clip from Supabase, GitHub, and Instagram
 */
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing clip id' }, { status: 400 });
    }

    // Validate required env vars
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.NEXT_PUBLIC_GITHUB_REPO;
    const githubBranch = process.env.NEXT_PUBLIC_GITHUB_BRANCH || 'main';
    const instagramAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!supabaseUrl || !supabaseKey || !githubToken || !githubRepo) {
      console.error('Missing required environment variables for delete');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Call the full delete function
    const result = await deleteMeme({
      clipId: id,
      supabaseUrl,
      supabaseKey,
      githubToken,
      githubRepo,
      githubBranch,
      instagramAccessToken,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Partial deletion - some services failed',
          result,
        },
        { status: 207 }
      );
    }

    return NextResponse.json({ deleted: true, result });
  } catch (error) {
    console.error('DELETE /api/clips error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/clips - Queue an update job for a clip
 *
 * Queues a job that will be processed by the local worker:
 * - If start/stop changed: Re-downloads video, regenerates everything
 * - If only caption changed: Regenerates video, gif, thumbnail
 * - If only thumbnail_second changed: Regenerates thumbnail only
 * - Updates GitHub, Instagram (if video changed), and database
 */
export async function PUT(request: NextRequest) {
  try {
    const body: UpdateClipRequest = await request.json();
    const { id, start_seconds, stop_seconds, caption, thumbnail_second, name, tags, user } = body;

    if (!id || !user) {
      return NextResponse.json({ error: 'Missing required fields (id, user)' }, { status: 400 });
    }

    // Verify the clip exists
    const { data: existingClip, error: fetchError } = await supabase
      .from('clips')
      .select('id')
      .eq('id', id)
      .single();

    if (fetchError || !existingClip) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }

    // Create update job payload
    const payload: UpdateJobPayload = {
      clip_id: id,
      start_seconds,
      stop_seconds,
      caption,
      thumbnail_second,
      name,
      tags,
    };

    // Insert job into queue with type 'update'
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({ type: 'update', payload, status: 'pending', user })
      .select('id, status')
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({ error: 'Failed to queue update job' }, { status: 500 });
    }

    const response: QueueJobResponse = {
      job_id: job.id,
      status: job.status,
      message: 'Update job queued successfully. Run the worker locally to process.',
    };

    return NextResponse.json(response, { status: 202 });
  } catch (error) {
    console.error('PUT /api/clips error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
