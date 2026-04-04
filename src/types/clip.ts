export interface Clip {
  id: string;
  name: string;
  tags: string[];
  source_url: string;
  start_seconds: number;
  stop_seconds: number;
  caption: string;
  thumbnail_second: number;
  approved: boolean;
  created_at: string;
  insta_reel_link: string | null;
  createdBy: string;
  updatedBy: string | null;
}

export interface ClipCreateInput {
  youtube_url: string;
  start_time: string;
  end_time?: string;
  caption: string;
  thumbnail_timestamp?: string;
  name?: string;
  tags?: string[];
}

export interface ClipsListParams {
  search?: string;
  tags?: string[];
  page?: number;
  limit?: number;
}

export interface ClipsListResponse {
  clips: Clip[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateClipRequest {
  name?: string;
  source_url: string;
  start_seconds: number;
  stop_seconds: number;
  caption?: string;
  thumbnail_second?: number;
  tags?: string[];
  user: string;
}

export interface UpdateClipRequest {
  id: string;
  start_seconds?: number;
  stop_seconds?: number;
  caption?: string;
  thumbnail_second?: number;
  name?: string;
  tags?: string[];
  user: string;
}

// Job types for async processing
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type JobType = 'create' | 'update';

// Payload for creating a new meme
export interface CreateJobPayload {
  name?: string;
  source_url: string;
  start_seconds: number;
  stop_seconds: number;
  caption?: string;
  thumbnail_second?: number;
  tags?: string[];
}

// Payload for updating an existing meme
export interface UpdateJobPayload {
  clip_id: string;
  start_seconds?: number;
  stop_seconds?: number;
  caption?: string;
  thumbnail_second?: number;
  name?: string;
  tags?: string[];
}

// Union type for job payloads
export type JobPayload = CreateJobPayload | UpdateJobPayload;

export interface JobResult {
  clip_id: string;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: JobPayload;
  result: JobResult | null;
  error: string | null;
  user: string;
  created_at: string;
  updated_at: string;
}

export interface QueueJobResponse {
  job_id: string;
  status: JobStatus;
  message: string;
}

// Helper to generate asset paths from clip ID
export function getClipPaths(id: string) {
  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO;
  const branch = process.env.NEXT_PUBLIC_GITHUB_BRANCH;
  if (!repo || !branch) {
    throw new Error('Missing environment variables');
  }
  const baseUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${id}`;
  return {
    source: `${baseUrl}/source.mp4`,
    video: `${baseUrl}/video.mp4`,
    audio: `${baseUrl}/audio.mp3`,
    gif: `${baseUrl}/captioned.gif`,
    thumbnail: `${baseUrl}/thumbnail.png`,
  };
}
