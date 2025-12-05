/**
 * Active Jobs Panel - Displays running and queued jobs
 * Shows real-time progress for each job with SSE connections
 */

import { useState, useEffect } from 'react';
import { connectToJobStream, cancelJob, type JobProgressEvent } from '../utils/queueClient';

type PlatformName = string;

const platformBadges: Record<string, { label: string; badge: string }> = {
  twitter: { label: 'Twitter/X', badge: '𝕏' },
  reddit: { label: 'Reddit', badge: '👽' },
};

const renderPlatform = (platform: PlatformName) => {
  const meta = platformBadges[platform.toLowerCase()] || { label: platform, badge: '🌐' };
  return (
    <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-1 bg-stone-100 rounded">
      <span className="opacity-70">{meta.badge}</span>
      <span>{meta.label}</span>
    </span>
  );
};

interface ActiveJob {
  jobId: string;
  type: PlatformName;
  state: string;
  progress?: JobProgressEvent;
  logs: string[];
  result?: {
    downloadUrl?: string;
    stats?: { count: number; duration: number };
  };
  eventSource?: EventSource;
}

interface ActiveJobsPanelProps {
  onJobComplete?: (jobId: string, downloadUrl?: string) => void;
}

export function ActiveJobsPanel({ onJobComplete }: ActiveJobsPanelProps) {
  const [activeJobs, setActiveJobs] = useState<Map<string, ActiveJob>>(new Map());

// Helper to update a job in state
  const updateJob = (jobId: string, updates: Partial<ActiveJob>) => {
    setActiveJobs(prev => {
      const updated = new Map(prev);
      const existing = updated.get(jobId);
      if (existing) {
        // Handle logs specially if it's a function
        const processedUpdates = { ...updates };
        if (typeof processedUpdates.logs === 'function') {
          processedUpdates.logs = (processedUpdates.logs as any)(existing.logs || []);
        }
        updated.set(jobId, { ...existing, ...processedUpdates });
      }
      return updated;
    });
  };

  // Add a new job and connect to its stream
  const addJob = (jobId: string, type: PlatformName) => {
    const job: ActiveJob = {
      jobId,
      type,
      state: 'connecting',
      logs: [`Connecting to job ${jobId}...`],
    };

    // Connect to SSE stream
    const eventSource = connectToJobStream(jobId, {
      onConnected: (data) => {
        updateJob(jobId, {
          state: data.state,
          logs: [`Connected! Job state: ${data.state}`],
        });
      },

      onProgress: (progress) => {
        const job = activeJobs.get(jobId);
        updateJob(jobId, {
          progress,
          logs: [
            ...(job?.logs || []),
            `Progress: ${progress.current}/${progress.target} - ${progress.action}`,
          ].slice(-10),
        });
      },

      onLog: (log) => {
        const job = activeJobs.get(jobId);
        updateJob(jobId, {
          logs: [
            ...(job?.logs || []),
            `[${log.level}] ${log.message}`,
          ].slice(-10),
        });
      },

      onCompleted: (result) => {
        const job = activeJobs.get(jobId);
        updateJob(jobId, {
          state: 'completed',
          result: result.result,
          logs: [...(job?.logs || []), '✅ Job completed!'],
        });

        // Notify parent
        onJobComplete?.(jobId, result.result?.downloadUrl);

        // Auto-remove after 5 seconds
        setTimeout(() => {
          removeJob(jobId);
        }, 5000);
      },

      onFailed: (error) => {
        const job = activeJobs.get(jobId);
        updateJob(jobId, {
          state: 'failed',
          logs: [...(job?.logs || []), `❌ Job failed: ${error}`],
        });
      },
    });

    job.eventSource = eventSource;
    setActiveJobs(prev => new Map(prev).set(jobId, job));
  };

  // Remove a job and close its connection
  const removeJob = (jobId: string) => {
    const job = activeJobs.get(jobId);
    if (job?.eventSource) {
      job.eventSource.close();
    }
    setActiveJobs(prev => {
      const updated = new Map(prev);
      updated.delete(jobId);
      return updated;
    });
  };

  // Cancel a job
  const handleCancel = async (jobId: string) => {
    try {
      await cancelJob(jobId);
      const job = activeJobs.get(jobId);
      updateJob(jobId, {
        state: 'cancelled',
        logs: [...(job?.logs || []), '🛑 Job cancelled by user'],
      });

      // Remove after 2 seconds
      setTimeout(() => removeJob(jobId), 2000);
    } catch (error) {
      console.error('Failed to cancel job:', error);
      const job = activeJobs.get(jobId);
      updateJob(jobId, {
        logs: [...(job?.logs || []), `❌ Failed to cancel: ${error}`],
      });
    }
  };

  // Fetch active jobs on mount
  useEffect(() => {
    const fetchActiveJobs = async () => {
      try {
        // Fetch jobs in active, waiting, or delayed states
        const states = ['active', 'waiting', 'delayed'];
        const jobPromises = states.map(state =>
          fetch(`/api/jobs?state=${state}&count=50`)
            .then(res => res.json())
            .catch(() => ({ jobs: [] }))
        );

        const results = await Promise.all(jobPromises);
        const allJobs = results.flatMap(r => r.jobs || []);

        // Add each job to the panel and reconnect to its stream
        allJobs.forEach(job => {
          if (job.id && job.type) {
            addJob(job.id, job.type);
          }
        });

        if (allJobs.length > 0) {
          console.log(`Restored ${allJobs.length} active jobs from server`);
        }
      } catch (error) {
        console.error('Failed to fetch active jobs:', error);
      }
    };

    fetchActiveJobs();
  }, []);

  // Cleanup all connections on unmount
  useEffect(() => {
    return () => {
      activeJobs.forEach(job => {
        if (job.eventSource) {
          job.eventSource.close();
        }
      });
    };
  }, []);

  // Expose addJob to parent (via window global for now - can use context later)
  useEffect(() => {
    (window as any).__addJobToPanel = addJob;
    return () => {
      delete (window as any).__addJobToPanel;
    };
  }, []);

  const jobsArray = Array.from(activeJobs.values());

  if (jobsArray.length === 0) {
    return null; // Hide panel when no jobs
  }

  return (
    <div className="mt-4 space-y-4">
      <h3 className="text-lg font-semibold text-stone-900">
        Active Jobs ({jobsArray.length})
      </h3>

      {jobsArray.map(job => (
        <div
          key={job.jobId}
          className="border border-stone-300 rounded-lg p-4 bg-white shadow-sm"
        >
          {/* Job Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className={`
                w-3 h-3 rounded-full
                ${job.state === 'active' ? 'bg-blue-500 animate-pulse' : ''}
                ${job.state === 'waiting' ? 'bg-yellow-500' : ''}
                ${job.state === 'completed' ? 'bg-green-500' : ''}
                ${job.state === 'failed' ? 'bg-red-500' : ''}
              `} />
              <div>
                <span className="font-mono text-sm text-stone-600">
                  {job.jobId.slice(0, 20)}...
                </span>
                {renderPlatform(job.type)}
                <span className="ml-2 text-xs text-stone-500">
                  {job.state}
                </span>
              </div>
            </div>

            {/* Cancel Button */}
            {job.state !== 'completed' && job.state !== 'failed' && job.state !== 'cancelled' && (
              <button
                onClick={() => handleCancel(job.jobId)}
                className="px-3 py-1 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors"
              >
                Cancel
              </button>
            )}

            {/* Download Button */}
            {job.result?.downloadUrl && (
              <a
                href={job.result.downloadUrl}
                className="px-3 py-1 text-sm text-green-600 border border-green-300 rounded hover:bg-green-50 transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                Download
              </a>
            )}
          </div>

          {/* Progress Bar */}
          {job.progress && job.progress.target > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs text-stone-600 mb-1">
                <span>{job.progress.action}</span>
                <span>
                  {job.progress.current} / {job.progress.target} ({job.progress.percentage}%)
                </span>
              </div>
              <div className="w-full bg-stone-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${job.progress.percentage}%` }}
                />
              </div>
            </div>
          )}

          {/* Recent Logs */}
          <div className="mt-2 space-y-1">
            {job.logs.slice(-3).map((log, idx) => (
              <div
                key={idx}
                className="text-xs font-mono text-stone-600 px-2 py-1 bg-stone-50 rounded"
              >
                {log}
              </div>
            ))}
          </div>

          {/* Stats */}
          {job.result?.stats && (
            <div className="mt-2 text-xs text-stone-500">
              ✅ Scraped {job.result.stats.count} items in {(job.result.stats.duration / 1000).toFixed(1)}s
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
