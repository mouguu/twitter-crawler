import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, CheckCircle2, XCircle, Loader2, Clock, Zap } from 'lucide-react';
import { connectToJobStream, cancelJob, type JobProgressEvent } from '@/utils/queueClient';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

interface ActiveJob {
  jobId: string;
  type: 'twitter' | 'reddit';
  state: string;
  progress?: JobProgressEvent;
  logs: string[];
  result?: {
    downloadUrl?: string;
    stats?: { count: number; duration: number };
  };
  eventSource?: EventSource;
  statusCheckInterval?: NodeJS.Timeout;
  isCancelling?: boolean;
  hasConnected?: boolean; // Track if we've already shown connection message
}

interface DashboardPanelProps {
  onJobComplete?: (jobId: string, downloadUrl?: string) => void;
  appendApiKey?: (url: string | null) => string | null;
  fetchJobStatus?: (jobId: string) => Promise<ActiveJob['result'] | undefined>;
}

export function DashboardPanel({
  onJobComplete,
  appendApiKey,
  fetchJobStatus: fetchJobStatusProp,
}: DashboardPanelProps) {
  const [activeJobs, setActiveJobs] = useState<Map<string, ActiveJob>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const updateJob = useCallback((jobId: string, updatesOrFn: Partial<ActiveJob> | ((job: ActiveJob) => Partial<ActiveJob>)) => {
    setActiveJobs((prev) => {
      const updated = new Map(prev);
      const existing = updated.get(jobId);
      if (existing) {
        const updates = typeof updatesOrFn === 'function' ? updatesOrFn(existing) : updatesOrFn;
        updated.set(jobId, { ...existing, ...updates });
      }
      return updated;
    });
  }, []);

  const fetchJobStatus = useCallback(
    async (jobId: string): Promise<ActiveJob['result'] | undefined> => {
      if (fetchJobStatusProp) return fetchJobStatusProp(jobId);
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return undefined;
        const data = await res.json();
        return data?.result;
      } catch {
        return undefined;
      }
    },
    [fetchJobStatusProp],
  );

  const removeJob = useCallback((jobId: string) => {
    setActiveJobs((prev) => {
      const updated = new Map(prev);
      const job = updated.get(jobId);
      if (job?.eventSource) {
        job.eventSource.close();
      }
      if (job?.statusCheckInterval) {
        clearInterval(job.statusCheckInterval);
      }
      updated.delete(jobId);
      return updated;
    });
  }, []);

  const addJob = useCallback(
    (jobId: string, type: 'twitter' | 'reddit') => {
      // Check if job already exists to avoid duplicate connections
      setActiveJobs((prev) => {
        if (prev.has(jobId)) return prev;

        const job: ActiveJob = {
          jobId,
          type,
          state: 'connecting',
          logs: [`Connecting to job ${jobId}...`],
        };

        const eventSource = connectToJobStream(jobId, {
          onConnected: (data) => {
            updateJob(jobId, (currentJob) => {
              // Use hasConnected flag to avoid duplicate connection messages
              if (currentJob?.hasConnected) {
                // Already connected, just update state silently
                return {
                  state: data.state,
                };
              }

              // First connection - add connection logs
              const existingLogs = currentJob?.logs || [];
              return {
                state: data.state,
                hasConnected: true,
                logs: [...existingLogs, `✅ Connected! Job state: ${data.state}`, `📊 Starting job monitoring...`],
              };
            });
          },
          onProgress: (progress) => {
            updateJob(jobId, (currentJob: ActiveJob) => {
              const percentage = progress.target > 0
                ? Math.round((progress.current / progress.target) * 100)
                : 0;
              const progressMsg = `📊 Progress: ${progress.current}/${progress.target} (${percentage}%) - ${progress.action}`;
              const existingLogs = currentJob.logs || [];
              return {
                progress,
                logs: [...existingLogs, progressMsg],
              };
            });
          },
          onLog: (log) => {
            updateJob(jobId, (currentJob: ActiveJob) => {
              // Format log message with emoji based on level
              const emoji = log.level === 'error' ? '❌' : log.level === 'warn' ? '⚠️' : 'ℹ️';
              const logMessage = `${emoji} ${log.message}`;
              const existingLogs = currentJob.logs || [];
              const newLogs = [...existingLogs, logMessage];

              // Debug: log if logs are being truncated unexpectedly
              if (existingLogs.length > 0 && newLogs.length < existingLogs.length) {
                console.warn(`[DashboardPanel] Logs truncated: ${existingLogs.length} -> ${newLogs.length}`);
              }

              return {
                logs: newLogs,
              };
            });
          },
          onCompleted: (result) => {
            const updateWithResult = async () => {
              const latestResult =
                (result.result && result.result.downloadUrl ? result.result : undefined) ||
                (await fetchJobStatus(jobId)) ||
                result.result;

              updateJob(jobId, (currentJob: ActiveJob) => {
                const existingLogs = currentJob.logs || [];
                return {
                  state: 'completed',
                  result: latestResult,
                  logs: [...existingLogs, '✅ Job completed!'],
                };
              });

              onJobComplete?.(jobId, latestResult?.downloadUrl);
            };
            updateWithResult();
          },
          onFailed: (error) => {
            const errorMessage = String(error);
            const isCancelled = errorMessage.toLowerCase().includes('cancel');

            updateJob(jobId, (currentJob: ActiveJob) => {
              const existingLogs = currentJob.logs || [];
              return {
                state: isCancelled ? 'cancelled' : 'failed',
                logs: [...existingLogs, isCancelled ? '🛑 Job cancelled by user' : `❌ Job failed: ${errorMessage}`],
              };
            });

            // Do not remove from list automatically. Let user dismiss.
            // setTimeout(() => removeJob(jobId), 2000);
          },
        });

        job.eventSource = eventSource;

        // Add periodic status check as fallback (in case SSE fails)
        const statusCheckInterval = setInterval(async () => {
          try {
            // Use getJobStatus to get full job info (not just result)
            const res = await fetch(`/api/jobs/${jobId}`);
            if (!res.ok) return;
            const status = await res.json();

            if (status) {
              const currentState = status.state;
              // If job is completed or failed but SSE didn't notify, update manually
              if (currentState === 'completed' || currentState === 'failed') {
                if (currentState === 'completed') {
                  updateJob(jobId, (currentJob: ActiveJob) => {
                    const existingLogs = currentJob.logs || [];
                    return {
                      state: 'completed',
                      result: status.result,
                      logs: [...existingLogs, '✅ Job completed (detected via status check)'],
                    };
                  });
                  onJobComplete?.(jobId, status.result?.downloadUrl);
                } else {
                  updateJob(jobId, (currentJob: ActiveJob) => {
                    const existingLogs = currentJob.logs || [];
                    return {
                      state: 'failed',
                      logs: [...existingLogs, `❌ Job failed: ${status.failedReason || 'Unknown error'}`],
                    };
                  });
                }
                clearInterval(statusCheckInterval);
                if (job.eventSource) {
                  job.eventSource.close();
                }
              }
            }
          } catch (error) {
            // Silently fail - status check is just a fallback
            console.debug('Status check failed (this is OK):', error);
          }
        }, 5000); // Check every 5 seconds

        // Store interval ID for cleanup
        job.statusCheckInterval = statusCheckInterval;

        const updated = new Map(prev);
        updated.set(jobId, job);
        return updated;
      });
    },
    [updateJob, fetchJobStatus, onJobComplete, removeJob],
  );

  const handleCancel = useCallback(
    async (jobId: string) => {
      try {
        // Optimistic UX update: Log intent, but do not change state to 'cancelled' or remove
        updateJob(jobId, (currentJob: ActiveJob) => ({
          isCancelling: true,
          logs: [...(currentJob.logs || []), '🛑 Sending cancel request...'],
        }));

        await cancelJob(jobId);
        // Do nothing else; wait for SSE 'failed' event with "cancelled" message
      } catch (error) {
        console.error('Failed to cancel job:', error);
        updateJob(jobId, (currentJob: ActiveJob) => ({
            isCancelling: false,
            logs: [...(currentJob.logs || []), `❌ Failed to send cancel request: ${error}`],
        }));
      }
    },
    [updateJob],
  );

  // Fetch active jobs on mount and restore them
  useEffect(() => {
    let mounted = true;
    const fetchActiveJobs = async () => {
      if (!mounted) return;
      console.log('🔄 [DashboardPanel] Fetching active jobs on mount...');
      try {
        const states = ['active', 'waiting', 'delayed'];
        const jobPromises = states.map((state) =>
          fetch(`/api/jobs?state=${state}&count=50`)
            .then((res) => {
              console.log(`📡 [API] GET /api/jobs?state=${state} - Status: ${res.status}`);
              return res.json();
            })
            .catch((err) => {
              console.error(`❌ [API] Failed to fetch ${state} jobs:`, err);
              return { jobs: [] };
            }),
        );

        const results = await Promise.all(jobPromises);
        if (!mounted) return;

        const allJobs = results.flatMap((r) => r.jobs || []);

        console.log(`📦 [DashboardPanel] Fetched ${allJobs.length} jobs from API:`, allJobs);

        // Add each job to the panel and reconnect to its stream
        allJobs.forEach((job) => {
          if (job.id && job.type) {
            // Only add if not already present (handled inside addJob, but we can verify here too)
            addJob(job.id, job.type);
          }
        });

        if (allJobs.length > 0) {
          console.log(`✅ [DashboardPanel] Restored ${allJobs.length} active jobs from server`);
        } else {
          console.log('ℹ️ [DashboardPanel] No active jobs found');
        }
      } catch (error) {
        console.error('❌ [DashboardPanel] Failed to fetch active jobs:', error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    fetchActiveJobs();

    return () => {
      mounted = false;
    };
  }, [addJob]);

  useEffect(() => {
    return () => {
      activeJobs.forEach((job) => {
        if (job.eventSource) {
          job.eventSource.close();
        }
      });
    };
  }, []);

  useEffect(() => {
    (window as any).__addJobToPanel = addJob;
    return () => {
      delete (window as any).__addJobToPanel;
    };
  }, [activeJobs]);

  const jobsArray = Array.from(activeJobs.values());
  const activeCount = jobsArray.filter((j) => j.state === 'active').length;
  const completedCount = jobsArray.filter((j) => j.state === 'completed').length;

  return (
    <section id="dashboard" className="py-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Active Jobs</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor your extraction tasks in real-time
            </p>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-2xl font-semibold">{activeCount}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Running</div>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-right">
              <div className="text-2xl font-semibold">{completedCount}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">
                Completed
              </div>
            </div>
          </div>
        </div>

        {/* Jobs List */}
        <div className="min-h-[300px]">
          {isLoading ? (
            <div className="h-[300px] border border-dashed border-border/50 rounded-2xl bg-muted/10 flex flex-col items-center justify-center text-muted-foreground animate-pulse">
              <Loader2 className="w-8 h-8 mb-4 animate-spin text-primary/50" />
              <p>Loading active tasks...</p>
            </div>
          ) : jobsArray.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="h-[300px] border border-dashed border-border rounded-2xl p-12 text-center flex flex-col items-center justify-center"
            >
              <div className="w-16 h-16 mb-4 rounded-2xl bg-muted flex items-center justify-center">
                <Zap className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">No active jobs</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Start an extraction task above to see your jobs here. Jobs will appear in real-time
                as they process.
              </p>
            </motion.div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {jobsArray.map((job) => (
                  <JobCard
                    key={job.jobId}
                    job={job}
                    appendApiKey={appendApiKey}
                    fetchJobStatus={fetchJobStatus}
                    onCancel={() => handleCancel(job.jobId)}
                    onRemove={() => removeJob(job.jobId)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function JobCard({
  job,
  onCancel,
  onRemove,
  appendApiKey,
  fetchJobStatus,
}: {
  job: ActiveJob;
  onCancel: () => void;
  onRemove: () => void;
  appendApiKey?: (url: string | null) => string | null;
  fetchJobStatus: (jobId: string) => Promise<ActiveJob['result'] | undefined>;
}) {
  const progressPercent = job.progress?.percentage || 0;
  const isCompleted = job.state === 'completed';
  const isFailed = job.state === 'failed';
  const isCancelled = job.state === 'cancelled';
  const isActive = job.state === 'active';

  const [resolvedDownload, setResolvedDownload] = useState<string | null>(
    job.result?.downloadUrl
      ? appendApiKey?.(job.result.downloadUrl) || job.result.downloadUrl
      : null,
  );
  const [resolving, setResolving] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Show logs by default for active jobs so users can see progress
  const [showLogs, setShowLogs] = useState(isActive);

  useEffect(() => {
    if (job.result?.downloadUrl) {
      setResolvedDownload(appendApiKey?.(job.result.downloadUrl) || job.result.downloadUrl);
    }
  }, [job.result?.downloadUrl, appendApiKey]);

  const handleResolveDownload = async () => {
    if (resolvedDownload || resolving) return;
    setResolving(true);
    setDownloadError(null);
    try {
      const latest = await fetchJobStatus(job.jobId);
      if (latest?.downloadUrl) {
        const url = appendApiKey?.(latest.downloadUrl) || latest.downloadUrl;
        setResolvedDownload(url);
        // Automatically trigger download
        window.open(url, '_blank');
      } else {
        // If no download URL, show error
        setDownloadError('No download URL available. The job may have been cancelled with no data scraped.');
      }
    } catch (error: any) {
      console.error('Failed to resolve download URL:', error);
      setDownloadError(`Failed to get download URL: ${error?.message || error}`);
    } finally {
      setResolving(false);
    }
  };

  const StatusIcon = () => {
    if (isCompleted) return <CheckCircle2 className="w-5 h-5 text-foreground" />;
    if (isFailed) return <XCircle className="w-5 h-5 text-red-600" />;
    if (job.isCancelling) return <Loader2 className="w-5 h-5 text-red-500 animate-spin" />;
    if (isActive) return <Loader2 className="w-5 h-5 text-foreground animate-spin" />;
    return <Clock className="w-5 h-5 text-muted-foreground" />;
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="border border-border/50 rounded-2xl bg-card overflow-hidden hover:border-border transition-colors"
    >
      {/* Main Row */}
      <div className="p-5 flex items-center gap-4">
        {/* Status Icon */}
        <div className="flex-shrink-0">
          <StatusIcon />
        </div>

        {/* Job Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm truncate">{job.jobId}</span>
            <Badge variant="secondary" className="uppercase text-2xs">
              {job.type}
            </Badge>
            <Badge
              variant={isCompleted ? 'success' : isFailed ? 'destructive' : 'outline'}
              className="uppercase text-2xs"
            >
              {job.state}
            </Badge>
          </div>

          {/* Progress Bar */}
          {isActive && (
            <div className="mt-3 flex items-center gap-3">
              <Progress value={progressPercent} className="flex-1 h-2" />
              <span className="text-xs font-mono text-muted-foreground w-12 text-right">
                {progressPercent}%
              </span>
            </div>
          )}

          {/* Stats */}
          {job.result?.stats && (
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span>{job.result.stats.count} items</span>
              <span>{(job.result.stats.duration / 1000).toFixed(1)}s</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Log Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLogs(!showLogs)}
            className="text-xs"
          >
            {showLogs ? 'Hide' : 'Logs'}
          </Button>

          {/* Download or Fetch */}
          {resolvedDownload ? (
            <Button asChild size="sm" className="gap-2">
              <a href={resolvedDownload} download target="_blank" rel="noopener noreferrer">
                <Download className="w-4 h-4" />
                Download
              </a>
            </Button>
          ) : (
            isCompleted && (
              <div className="flex flex-col items-end gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResolveDownload}
                  disabled={resolving}
                  className="gap-2"
                >
                  {resolving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Download
                    </>
                  )}
                </Button>
                {downloadError && (
                  <span className="text-xs text-red-600 max-w-[200px] text-right">
                    {downloadError}
                  </span>
                )}
              </div>
            )
          )}

          {/* Cancel/Remove */}
          {isCompleted || isFailed || isCancelled ? (
            <Button variant="ghost" size="icon" onClick={onRemove}>
              <X className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={job.isCancelling}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              {job.isCancelling ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cancelling
                </>
              ) : (
                'Cancel'
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Logs Panel */}
      <AnimatePresence>
        {showLogs && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/50 bg-muted/30"
          >
            <div className="p-4 max-h-96 overflow-y-auto font-mono text-xs space-y-1">
              {job.logs.length === 0 ? (
                <p className="text-muted-foreground italic">Waiting for logs...</p>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground/70 mb-2 sticky top-0 bg-muted/30 py-1 px-2 rounded">
                    Showing {job.logs.length} log entries (scroll to see more)
                  </div>
                  {job.logs.map((log, i) => {
                    // Use log content + index as key to ensure proper rendering
                    const logKey = `log-${i}-${log.slice(0, 20).replace(/\s/g, '-')}`;
                    return (
                      <div
                        key={logKey}
                        className="text-muted-foreground hover:text-foreground transition-colors py-0.5 border-b border-border/20 last:border-0 break-words"
                      >
                        <span className="text-muted-foreground/50 mr-2 font-bold">
                          {String(i + 1).padStart(3, '0')}
                        </span>
                        <span className="whitespace-pre-wrap">{log}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
