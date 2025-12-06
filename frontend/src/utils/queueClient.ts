/**
 * Queue API Client
 *
 * Utility for interacting with the queue-based scraping API
 */

import { safeJsonParse } from './safe-json';

export interface JobInfo {
  jobId: string;
  statusUrl: string;
  progressUrl: string;
}

export interface JobStatus {
  id: string;
  type: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  progress?: {
    current: number;
    target: number;
    action: string;
    percentage?: number;
  };
  result?: {
    success: boolean;
    downloadUrl?: string;
    stats?: {
      count: number;
      duration: number;
    };
  };
  createdAt: number;
  processedAt?: number;
  finishedAt?: number;
}

export interface JobProgressEvent {
  current: number;
  target: number;
  action: string;
  percentage?: number;
}

export interface JobLogEvent {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
}

/**
 * Submit a scraping job to the queue
 */
export async function submitJob(params: {
  type: 'profile' | 'thread' | 'search' | 'reddit';
  input: string;
  limit?: number;
  mode?: string;
  likes?: boolean;
  enableRotation?: boolean;
  enableProxy?: boolean;
  dateRange?: { start: string; end: string };
  strategy?: string;
  antiDetectionLevel?: 'low' | 'medium' | 'high' | 'paranoid';
}): Promise<JobInfo> {
  const response = await fetch('/api/scrape-v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to submit job');
  }

  return response.json();
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const response = await fetch(`/api/jobs/${jobId}`);

  if (!response.ok) {
    throw new Error('Failed to get job status');
  }

  return response.json();
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId: string): Promise<void> {
  const response = await fetch(`/api/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    let errorMsg = 'Failed to cancel job';
    try {
      const errorData = await response.json();
      if (errorData.error) errorMsg = errorData.error;
    } catch (e) {
      // Ignore JSON parse error, use default message
    }
    throw new Error(`${errorMsg} (${response.status})`);
  }
}

/**
 * Connect to job progress stream (SSE)
 */
export function connectToJobStream(
  jobId: string,
  callbacks: {
    onProgress?: (data: JobProgressEvent) => void;
    onLog?: (data: JobLogEvent) => void;
    onCompleted?: (result: any) => void;
    onFailed?: (error: string) => void;
    onConnected?: (data: any) => void;
  },
): EventSource {
  const eventSource = new EventSource(`/api/jobs/${jobId}/stream`);

  eventSource.addEventListener('connected', (e) => {
    const data = safeJsonParse(e.data);
    callbacks.onConnected?.(data);
  });

  eventSource.addEventListener('progress', (e) => {
    const data = safeJsonParse(e.data);
    callbacks.onProgress?.(data as JobProgressEvent);
  });

  eventSource.addEventListener('log', (e) => {
    const data = safeJsonParse(e.data);
    callbacks.onLog?.(data as JobLogEvent);
  });

  eventSource.addEventListener('completed', (e) => {
    const data = safeJsonParse(e.data);
    callbacks.onCompleted?.(data);
    eventSource.close();
  });

  eventSource.addEventListener('failed', (e) => {
    const data = safeJsonParse(e.data) as { error: string };
    callbacks.onFailed?.(data.error);
    eventSource.close();
  });

  eventSource.onerror = (error) => {
    console.error('SSE connection error:', error);
    eventSource.close();
  };

  return eventSource;
}

/**
 * List all jobs
 */
export async function listJobs(filters?: {
  state?: 'waiting' | 'active' | 'completed' | 'failed';
  type?: string;
}): Promise<JobStatus[]> {
  const params = new URLSearchParams();
  if (filters?.state) params.append('state', filters.state);
  if (filters?.type) params.append('type', filters.type);

  const response = await fetch(`/api/jobs?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to list jobs');
  }

  const data = await response.json();
  return data.jobs;
}
