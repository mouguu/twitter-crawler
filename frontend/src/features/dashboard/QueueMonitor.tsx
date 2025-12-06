import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
}

interface QueueStats {
  name: string;
  counts: QueueCounts;
  timestamp: string;
}

interface Job {
  id: string;
  name: string;
  state: string;
  progress: number | { percentage?: number; current?: number; total?: number };
  data: {
    type?: string;
    config?: {
      username?: string;
      query?: string;
      subreddit?: string;
    };
  };
  returnvalue?: {
    downloadUrl?: string;
    stats?: {
      tweetsCollected?: number;
      postsCollected?: number;
    };
  };
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  attemptsMade: number;
}

interface JobListResponse {
  jobs: Job[];
  count: number;
  filter: string;
}

export function QueueMonitor() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/admin/queues');
      if (!res.ok) throw new Error('Failed to fetch queue stats');
      const data = await res.json();
      setStats(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const fetchJobs = useCallback(async (filter: string) => {
    try {
      const url = filter === 'all' ? '/admin/queues/jobs' : `/admin/queues/jobs?state=${filter}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch jobs');
      const data: JobListResponse = await res.json();
      setJobs(data.jobs);
    } catch (err: any) {
      console.error('Failed to fetch jobs:', err);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchStats(), fetchJobs(activeFilter)]);
      setLoading(false);
    };
    load();

    const interval = setInterval(() => {
      fetchStats();
      fetchJobs(activeFilter);
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchStats, fetchJobs, activeFilter]);

  const handleRetry = async (jobId: string) => {
    try {
      await fetch(`/admin/queues/job/${jobId}/retry`, { method: 'POST' });
      fetchJobs(activeFilter);
    } catch (err) {
      console.error('Failed to retry job:', err);
    }
  };

  const handleClean = async (type: string) => {
    try {
      await fetch('/admin/queues/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, grace: 0 }),
      });
      fetchStats();
      fetchJobs(activeFilter);
    } catch (err) {
      console.error('Failed to clean queue:', err);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getJobProgress = (progress: Job['progress']): number => {
    if (typeof progress === 'number') return progress;
    if (progress?.percentage) return progress.percentage;
    if (progress?.current && progress?.total) return (progress.current / progress.total) * 100;
    return 0;
  };

  const getJobLabel = (job: Job): string => {
    const config = job.data?.config;
    if (config?.username) return `@${config.username}`;
    if (config?.query) return `"${config.query}"`;
    if (config?.subreddit) return `r/${config.subreddit}`;
    return job.name || job.id;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-foreground border-t-transparent"></div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchStats();
              fetchJobs(activeFilter);
            }}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const counts = stats?.counts || {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    total: 0,
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Queue Status</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {stats?.timestamp ? new Date(stats.timestamp).toLocaleTimeString() : '—'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => handleClean('completed')}>
            Clear Done
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleClean('failed')}>
            Clear Failed
          </Button>
        </div>
      </div>

      {/* Stats - Minimal Design */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: 'Waiting', value: counts.waiting },
          { label: 'Active', value: counts.active },
          { label: 'Completed', value: counts.completed },
          { label: 'Failed', value: counts.failed },
          { label: 'Delayed', value: counts.delayed },
        ].map((stat) => (
          <div key={stat.label} className="text-center py-6 border rounded-lg">
            <div className="text-3xl font-light tabular-nums">{stat.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Progress Bar - Simple */}
      {counts.total > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>
              {counts.completed + counts.failed} of {counts.total} processed
            </span>
            <span>{Math.round(((counts.completed + counts.failed) / counts.total) * 100)}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground transition-all duration-300"
              style={{ width: `${((counts.completed + counts.failed) / counts.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Jobs List */}
      <div className="space-y-4">
        <Tabs value={activeFilter} onValueChange={setActiveFilter}>
          <TabsList className="bg-transparent border-b rounded-none w-full justify-start gap-4 h-auto p-0">
            {['all', 'active', 'waiting', 'completed', 'failed'].map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent px-0 pb-2 capitalize"
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={activeFilter} className="mt-4">
            {jobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No jobs</div>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between py-3 px-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          job.state === 'active'
                            ? 'bg-foreground animate-pulse'
                            : job.state === 'completed'
                              ? 'bg-foreground'
                              : job.state === 'failed'
                                ? 'bg-foreground/30'
                                : 'bg-muted-foreground/30'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{getJobLabel(job)}</span>
                          <span className="text-xs text-muted-foreground capitalize">
                            {job.state}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {job.id.substring(0, 12)}... • {formatTime(job.timestamp)}
                        </div>
                        {job.state === 'active' && (
                          <div className="h-1 bg-muted rounded-full mt-2 w-32 overflow-hidden">
                            <div
                              className="h-full bg-foreground transition-all"
                              style={{ width: `${getJobProgress(job.progress)}%` }}
                            />
                          </div>
                        )}
                        {job.failedReason && (
                          <div className="text-xs text-muted-foreground mt-1 truncate">
                            {job.failedReason}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      {job.state === 'completed' && job.returnvalue?.downloadUrl && (
                        <a
                          href={job.returnvalue.downloadUrl}
                          className="text-sm px-3 py-1 rounded border hover:bg-muted transition-colors"
                          download
                        >
                          Download
                        </a>
                      )}
                      {job.state === 'failed' && (
                        <Button variant="ghost" size="sm" onClick={() => handleRetry(job.id)}>
                          Retry
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
