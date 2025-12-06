import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, CheckCircle2, XCircle, Loader2, Clock, Zap } from 'lucide-react';
import { connectToJobStream, cancelJob, type JobProgressEvent } from '@/utils/queueClient';

import { Button } from '@/shared/ui/button';
import { Progress } from '@/shared/ui/progress';
import { Badge } from '@/shared/ui/badge';

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
  isCancelling?: boolean;
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
            updateJob(jobId, {
              state: data.state,
              logs: [`Connected! Job state: ${data.state}`],
            });
          },
          onProgress: (progress) => {
            updateJob(jobId, (currentJob: ActiveJob) => ({
              progress,
              logs: [
                ...(currentJob.logs || []),
                `Progress: ${progress.current}/${progress.target} - ${progress.action}`,
              ].slice(-50),
            }));
          },
          onLog: (log) => {
            updateJob(jobId, (currentJob: ActiveJob) => ({
              logs: [...(currentJob.logs || []), `[${log.level}] ${log.message}`].slice(-50),
            }));
          },
          onCompleted: (result) => {
            const updateWithResult = async () => {
              const latestResult =
                (result.result && result.result.downloadUrl ? result.result : undefined) ||
                (await fetchJobStatus(jobId)) ||
                result.result;
              
              updateJob(jobId, (currentJob: ActiveJob) => ({
                state: 'completed',
                result: latestResult,
                logs: [...(currentJob.logs || []), '✅ Job completed!'],
              }));
              
              onJobComplete?.(jobId, latestResult?.downloadUrl);
            };
            updateWithResult();
          },
          onFailed: (error) => {
            const errorMessage = String(error);
            const isCancelled = errorMessage.toLowerCase().includes('cancel');

            updateJob(jobId, (currentJob: ActiveJob) => ({
              state: isCancelled ? 'cancelled' : 'failed',
              logs: [...(currentJob.logs || []), isCancelled ? '🛑 Job cancelled by user' : `❌ Job failed: ${errorMessage}`],
            }));

            // Do not remove from list automatically. Let user dismiss.
            // setTimeout(() => removeJob(jobId), 2000);
          },
        });

        job.eventSource = eventSource;
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
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    if (job.result?.downloadUrl) {
      setResolvedDownload(appendApiKey?.(job.result.downloadUrl) || job.result.downloadUrl);
    }
  }, [job.result?.downloadUrl, appendApiKey]);

  const handleResolveDownload = async () => {
    if (resolvedDownload || resolving) return;
    setResolving(true);
    const latest = await fetchJobStatus(job.jobId);
    if (latest?.downloadUrl) {
      setResolvedDownload(appendApiKey?.(latest.downloadUrl) || latest.downloadUrl);
    }
    setResolving(false);
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
              <a href={resolvedDownload} download>
                <Download className="w-4 h-4" />
                Download
              </a>
            </Button>
          ) : (
            isCompleted && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResolveDownload}
                disabled={resolving}
              >
                {resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Get Link'}
              </Button>
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
            <div className="p-4 max-h-48 overflow-y-auto font-mono text-xs space-y-1">
              {job.logs.length === 0 ? (
                <p className="text-muted-foreground italic">Waiting for logs...</p>
              ) : (
                job.logs.map((log, i) => (
                  <div
                    key={i}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {log}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
