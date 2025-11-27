import { SpeedTrendChart } from './charts/SpeedTrendChart';
import { SessionHealthChart } from './charts/SessionHealthChart';
import { Activity, HeartPulse } from 'lucide-react';

interface PerformanceDashboardProps {
    speedHistory: { time: string; speed: number }[];
    sessionStats: {
        sessionSwitches: number;
        rateLimitHits: number;
        successfulRequests: number;
    };
}

export function PerformanceDashboard({ speedHistory, sessionStats }: PerformanceDashboardProps) {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Speed Trend Chart - Takes up 2 columns */}
            <div className="lg:col-span-2 bg-white/50 backdrop-blur-sm rounded-xl border border-stone/20 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-6">
                    <Activity className="w-5 h-5 text-moss" />
                    <div>
                        <h3 className="text-xl font-display text-charcoal">Scraping Velocity</h3>
                        <p className="text-sm text-stone font-serif mt-1">
                            Real-time tweets per second
                        </p>
                    </div>
                </div>
                <SpeedTrendChart data={speedHistory} />
            </div>

            {/* Session Health Chart - Takes up 1 column */}
            <div className="bg-white/50 backdrop-blur-sm rounded-xl border border-stone/20 p-6 shadow-sm relative">
                <div className="flex items-center gap-2 mb-6">
                    <HeartPulse className="w-5 h-5 text-rust" />
                    <div>
                        <h3 className="text-xl font-display text-charcoal">Session Health</h3>
                        <p className="text-sm text-stone font-serif mt-1">
                            Rate limits & rotations
                        </p>
                    </div>
                </div>
                <SessionHealthChart 
                    sessionSwitches={sessionStats.sessionSwitches}
                    rateLimitHits={sessionStats.rateLimitHits}
                    successfulRequests={sessionStats.successfulRequests}
                />
            </div>
        </div>
    );
}
