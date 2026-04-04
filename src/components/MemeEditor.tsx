'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@subbiah/reusable/components/ui/card';
import { Button } from '@subbiah/reusable/components/ui/button';
import { Input } from '@subbiah/reusable/components/ui/input';
import { Label } from '@subbiah/reusable/components/ui/label';
import { Textarea } from '@subbiah/reusable/components/ui/textarea';
import {
  VideoRangeSlider,
  formatTimeToMSS,
  parseMSSToSeconds,
} from '@subbiah/reusable/components/ui/video-range-slider';
import { useAuth } from '@subbiah/reusable/statefulComponents/auth/context';
import type { Clip, UpdateClipRequest, QueueJobResponse } from '@/types/clip';

declare global {
  interface Window {
    YT: {
      Player: new (
        elementId: string,
        config: {
          videoId: string;
          events: {
            onReady: (event: { target: YTPlayer }) => void;
            onStateChange?: (event: { data: number; target: YTPlayer }) => void;
          };
          playerVars?: {
            controls?: number;
            modestbranding?: number;
            rel?: number;
          };
        }
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  getDuration: () => number;
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
  setPlaybackQuality: (quality: string) => void;
  getAvailableQualityLevels: () => string[];
}

// Use lowest quality for faster loading during preview
const PREVIEW_QUALITY = 'small';

interface CreateClipData {
  name: string;
  source_url: string;
  start_seconds: number;
  stop_seconds: number;
  caption: string;
  thumbnail_second: number;
  user: string;
}

interface QueueResponse {
  job_id: string;
  status: string;
  message: string;
}

// Props for edit mode
export interface MemeEditorProps {
  // If provided, the editor is in edit mode
  clip?: Clip;
  // Callback when edit/create is successful
  onSuccess?: () => void;
  // Callback to close the editor (for dialog mode)
  onClose?: () => void;
  // Player element ID (unique per instance)
  playerId?: string;
}

async function queueClip(data: CreateClipData): Promise<QueueResponse> {
  const res = await fetch('/api/clips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to queue clip');
  }

  return res.json();
}

async function updateClip(data: UpdateClipRequest): Promise<QueueJobResponse> {
  const res = await fetch('/api/clips', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || error.errors?.join(', ') || 'Failed to queue update');
  }

  return res.json();
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function MemeEditor({
  clip,
  onSuccess,
  onClose,
  playerId = 'youtube-player',
}: MemeEditorProps) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const isEditMode = Boolean(clip);

  // URL state - in edit mode, use the clip's source_url
  const [youtubeUrl, setYoutubeUrl] = useState(clip?.source_url || '');
  const [videoId, setVideoId] = useState<string | null>(
    clip ? extractVideoId(clip.source_url) : null
  );
  const [duration, setDuration] = useState(0);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Trim state - in edit mode, prefill from clip
  // Note: thumbnail_second in DB is relative to start, so actual = start + thumbnail_second
  const [startTime, setStartTime] = useState(clip?.start_seconds || 0);
  const [endTime, setEndTime] = useState(clip?.stop_seconds || 0);
  const [thumbnailTime, setThumbnailTime] = useState(
    clip ? clip.start_seconds + clip.thumbnail_second : 0
  );
  const [caption, setCaption] = useState(clip?.caption || '');

  // Manual time inputs (M.SS format)
  const [startInput, setStartInput] = useState(clip ? formatTimeToMSS(clip.start_seconds) : '0.00');
  const [endInput, setEndInput] = useState(clip ? formatTimeToMSS(clip.stop_seconds) : '0.00');
  const [thumbnailInput, setThumbnailInput] = useState(
    clip ? formatTimeToMSS(clip.start_seconds + clip.thumbnail_second) : '0.00'
  );

  // Preview playback state
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  const playerRef = useRef<YTPlayer | null>(null);
  const apiLoadedRef = useRef(false);
  const previewIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const playerWrapperRef = useRef<HTMLDivElement>(null);
  const [playerScale, setPlayerScale] = useState(1);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: queueClip,
    onSuccess: (data) => {
      alert(`Meme queued successfully! Job ID: ${data.job_id}`);
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      onSuccess?.();
    },
    onError: (error) => {
      alert(error.message);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: updateClip,
    onSuccess: (data) => {
      alert(
        `Update queued successfully! Job ID: ${data.job_id}\n\nRun the worker locally to process the update.`
      );
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      onSuccess?.();
      onClose?.();
    },
    onError: (error) => {
      alert(error.message);
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Load YouTube IFrame API
  useEffect(() => {
    if (apiLoadedRef.current) return;

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    apiLoadedRef.current = true;
  }, []);

  // Calculate player scale to fill container while keeping iframe small
  useEffect(() => {
    const updateScale = () => {
      if (playerWrapperRef.current) {
        const wrapperWidth = playerWrapperRef.current.offsetWidth;
        const scale = wrapperWidth / 320; // 320px forces YouTube to use 240p
        setPlayerScale(scale);
      }
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [videoId]);

  // Cleanup preview interval on unmount
  useEffect(() => {
    return () => {
      if (previewIntervalRef.current) {
        clearInterval(previewIntervalRef.current);
      }
      // Destroy player on unmount
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, []);

  const initPlayer = useCallback(
    (videoIdToLoad: string, initialStart?: number, initialEnd?: number) => {
      // Destroy existing player if any
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }

      const createPlayer = () => {
        if (!playerContainerRef.current) return;

        playerRef.current = new window.YT.Player(playerId, {
          videoId: videoIdToLoad,
          events: {
            onReady: (event) => {
              const videoDuration = event.target.getDuration();
              setDuration(videoDuration);

              // Set video quality to lowest for faster loading
              event.target.setPlaybackQuality(PREVIEW_QUALITY);

              // In edit mode, use existing values; otherwise set defaults
              if (initialStart !== undefined && initialEnd !== undefined) {
                setStartTime(initialStart);
                setEndTime(initialEnd);
                setStartInput(formatTimeToMSS(initialStart));
                setEndInput(formatTimeToMSS(initialEnd));
              } else {
                setEndTime(Math.min(videoDuration, 10));
                setThumbnailTime(0);
                setStartTime(0);
                setStartInput('0.00');
                setEndInput(formatTimeToMSS(Math.min(videoDuration, 10)));
                setThumbnailInput('0.00');
              }
              setIsPlayerReady(true);
            },
          },
          playerVars: {
            controls: 1,
            modestbranding: 1,
            rel: 0,
          },
        });
      };

      if (window.YT && window.YT.Player) {
        createPlayer();
      } else {
        window.onYouTubeIframeAPIReady = createPlayer;
      }
    },
    [playerId]
  );

  const handleLoadVideo = useCallback(
    (urlToLoad?: string) => {
      const url = urlToLoad || youtubeUrl;
      setError(null);
      const id = extractVideoId(url);

      if (!id) {
        setError('Invalid YouTube URL. Please enter a valid YouTube video link.');
        return;
      }

      setVideoId(id);
      setIsPlayerReady(false);

      // Update URL param (only in create mode)
      if (!isEditMode) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('url', url);
        router.replace(`?${params.toString()}`, { scroll: false });
      }

      // Small delay to ensure DOM is ready
      setTimeout(() => {
        initPlayer(id);
      }, 100);
    },
    [youtubeUrl, initPlayer, isEditMode, searchParams, router]
  );

  // Load video from URL param on mount (create mode only)
  useEffect(() => {
    if (isEditMode || initialLoadDone) return;

    const urlParam = searchParams.get('url');
    if (urlParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setYoutubeUrl(urlParam);
      // Wait for YouTube API to load before initializing
      const checkAndLoad = () => {
        if (window.YT && window.YT.Player) {
          handleLoadVideo(urlParam);
        } else {
          setTimeout(checkAndLoad, 100);
        }
      };
      checkAndLoad();
    }
  }, [searchParams, isEditMode, initialLoadDone, handleLoadVideo]);

  // Load video on mount for edit mode
  useEffect(() => {
    if (initialLoadDone) return;

    if (isEditMode && clip) {
      const id = extractVideoId(clip.source_url);
      if (id) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVideoId(id);
        // Wait for YouTube API to load before initializing
        const checkAndLoad = () => {
          if (window.YT && window.YT.Player) {
            initPlayer(id, clip.start_seconds, clip.stop_seconds);
            setInitialLoadDone(true);
          } else {
            setTimeout(checkAndLoad, 100);
          }
        };
        checkAndLoad();
      }
    } else {
      setInitialLoadDone(true);
    }
  }, [isEditMode, clip, initialLoadDone, initPlayer]);

  // Sync slider changes to inputs
  const handleStartChange = (time: number) => {
    setStartTime(time);
    setStartInput(formatTimeToMSS(time));
  };

  const handleEndChange = (time: number) => {
    setEndTime(time);
    setEndInput(formatTimeToMSS(time));
  };

  const handleThumbnailChange = (time: number) => {
    setThumbnailTime(time);
    setThumbnailInput(formatTimeToMSS(time));
  };

  // Sync manual input changes to slider
  const handleStartInputBlur = () => {
    const seconds = parseMSSToSeconds(startInput);
    const maxStart = endTime - 2;
    const clamped = Math.max(0, Math.min(seconds, maxStart));
    setStartTime(clamped);
    setStartInput(formatTimeToMSS(clamped));
    if (thumbnailTime < clamped) {
      setThumbnailTime(clamped);
      setThumbnailInput(formatTimeToMSS(clamped));
    }
  };

  const handleEndInputBlur = () => {
    const seconds = parseMSSToSeconds(endInput);
    const minEnd = startTime + 2;
    const clamped = Math.max(minEnd, Math.min(seconds, duration));
    setEndTime(clamped);
    setEndInput(formatTimeToMSS(clamped));
    if (thumbnailTime > clamped) {
      setThumbnailTime(clamped);
      setThumbnailInput(formatTimeToMSS(clamped));
    }
  };

  const handleThumbnailInputBlur = () => {
    const seconds = parseMSSToSeconds(thumbnailInput);
    const clamped = Math.max(startTime, Math.min(seconds, endTime));
    setThumbnailTime(clamped);
    setThumbnailInput(formatTimeToMSS(clamped));
  };

  // Seek video to specific time when clicking on time display
  const seekToTime = (seconds: number) => {
    if (playerRef.current) {
      playerRef.current.pauseVideo();
      playerRef.current.seekTo(seconds, true);
    }
  };

  // Play preview from start to end
  const playPreview = () => {
    if (!playerRef.current) return;

    // Clear any existing interval
    if (previewIntervalRef.current) {
      clearInterval(previewIntervalRef.current);
    }

    // Seek to start and play
    playerRef.current.seekTo(startTime, true);
    playerRef.current.playVideo();
    setIsPreviewPlaying(true);

    // Check position every 100ms and stop at end
    previewIntervalRef.current = setInterval(() => {
      if (playerRef.current) {
        const currentTime = playerRef.current.getCurrentTime();
        if (currentTime >= endTime) {
          stopPreview();
        }
      }
    }, 100);
  };

  const stopPreview = () => {
    if (previewIntervalRef.current) {
      clearInterval(previewIntervalRef.current);
      previewIntervalRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.pauseVideo();
    }
    setIsPreviewPlaying(false);
  };

  const handleSubmit = () => {
    if (!videoId || !youtubeUrl) {
      alert('Please load a video first');
      return;
    }

    if (endTime - startTime < 2) {
      alert('Clip must be at least 2 seconds long');
      return;
    }

    // Calculate thumbnail_second relative to start
    const relativeThumbnailSecond = thumbnailTime - startTime;

    if (isEditMode && clip) {
      // Update existing clip
      updateMutation.mutate({
        id: clip.id,
        start_seconds: startTime,
        stop_seconds: endTime,
        caption,
        thumbnail_second: relativeThumbnailSecond,
        user: user?.email || '',
      });
    } else {
      // Create new clip
      createMutation.mutate({
        name: '',
        source_url: youtubeUrl,
        start_seconds: startTime,
        stop_seconds: endTime,
        caption,
        thumbnail_second: relativeThumbnailSecond,
        user: user?.email || '',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* URL Input Section - Only show in create mode */}
      {!isEditMode && (
        <Card>
          <CardContent className="p-6">
            <div className="flex gap-4">
              <div className="flex-1 space-y-2">
                <Label htmlFor={`${playerId}-url`}>YouTube Video URL</Label>
                <Input
                  id={`${playerId}-url`}
                  type="url"
                  placeholder="https://youtube.com/watch?v=... or https://youtu.be/..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={() => handleLoadVideo()} disabled={!youtubeUrl.trim()}>
                  Load Video
                </Button>
              </div>
            </div>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}

      {/* Video Player Section */}
      {videoId && (
        <Card>
          <CardContent className="p-6">
            {/* Small iframe scaled up visually - YouTube sends low quality to small player */}
            <div
              ref={playerWrapperRef}
              className="aspect-video w-full overflow-hidden rounded-lg bg-muted"
            >
              <div
                ref={playerContainerRef}
                className="h-[180px] w-[320px] origin-top-left"
                style={{ transform: `scale(${playerScale})` }}
              >
                <div id={playerId} className="h-full w-full" />
              </div>
            </div>

            {!isPlayerReady && (
              <div className="mt-4 text-center text-muted-foreground">Loading video...</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Trim Controls Section */}
      {isPlayerReady && duration > 0 && (
        <>
          <Card>
            <CardContent className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Trim Selection</h2>
                <Button
                  variant={isPreviewPlaying ? 'destructive' : 'default'}
                  size="sm"
                  onClick={isPreviewPlaying ? stopPreview : playPreview}
                >
                  {isPreviewPlaying ? (
                    <>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="mr-2 h-4 w-4"
                      >
                        <path d="M6 6h12v12H6z" />
                      </svg>
                      Stop Preview
                    </>
                  ) : (
                    <>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="mr-2 h-4 w-4"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      Play Preview
                    </>
                  )}
                </Button>
              </div>

              <VideoRangeSlider
                duration={duration}
                startTime={startTime}
                endTime={endTime}
                thumbnailTime={thumbnailTime}
                minDuration={2}
                onStartChange={handleStartChange}
                onEndChange={handleEndChange}
                onThumbnailChange={handleThumbnailChange}
                onSeek={seekToTime}
                className="mb-6"
              />

              {/* Manual Time Inputs */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`${playerId}-start-input`}>Start (s)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${playerId}-start-input`}
                      value={startInput}
                      onChange={(e) => setStartInput(e.target.value)}
                      onBlur={handleStartInputBlur}
                      placeholder="0.00"
                      className="font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => seekToTime(startTime)}
                      title="Seek to start"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="h-4 w-4"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${playerId}-thumbnail-input`}>Thumbnail (s)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${playerId}-thumbnail-input`}
                      value={thumbnailInput}
                      onChange={(e) => setThumbnailInput(e.target.value)}
                      onBlur={handleThumbnailInputBlur}
                      placeholder="0.00"
                      className="font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => seekToTime(thumbnailTime)}
                      title="Seek to thumbnail"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="h-4 w-4"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${playerId}-end-input`}>End (s)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${playerId}-end-input`}
                      value={endInput}
                      onChange={(e) => setEndInput(e.target.value)}
                      onBlur={handleEndInputBlur}
                      placeholder="0.00"
                      className="font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => seekToTime(endTime)}
                      title="Seek to end"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="h-4 w-4"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </Button>
                  </div>
                </div>
              </div>

              <p className="mt-4 text-sm text-muted-foreground">
                Clip duration: {formatTimeToMSS(endTime - startTime)}s (min 2s)
              </p>
            </CardContent>
          </Card>

          {/* Caption Section */}
          <Card>
            <CardContent className="p-6">
              <div className="space-y-2">
                <Label htmlFor={`${playerId}-caption`}>Caption</Label>
                <Textarea
                  id={`${playerId}-caption`}
                  placeholder="Enter meme caption..."
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Submit Button */}
          <Button onClick={handleSubmit} disabled={isPending} className="w-full" size="lg">
            {isPending
              ? isEditMode
                ? 'Updating Clip...'
                : 'Creating Meme...'
              : isEditMode
                ? 'Update Clip'
                : 'Create Meme'}
          </Button>
        </>
      )}
    </div>
  );
}
