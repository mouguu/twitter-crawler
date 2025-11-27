import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface SessionHealthProps {
    sessionSwitches: number;
    rateLimitHits: number;
    successfulRequests: number; // We might need to estimate this or get it from backend
}

export function SessionHealthChart({ sessionSwitches, rateLimitHits, successfulRequests }: SessionHealthProps) {
    const data = [
        { name: 'Success', value: Math.max(1, successfulRequests), color: '#22c55e' }, // Green
        { name: 'Rate Limits', value: rateLimitHits, color: '#ef4444' }, // Red
        { name: 'Switches', value: sessionSwitches, color: '#eab308' }, // Yellow
    ];

    // Filter out zero values to avoid ugly empty segments, but keep at least one if all are zero
    const activeData = data.filter(d => d.value > 0);
    if (activeData.length === 0) {
        activeData.push({ name: 'Ready', value: 1, color: '#e5e7eb' });
    }

    return (
        <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={activeData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                    >
                        {activeData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                        ))}
                    </Pie>
                    <Tooltip 
                         contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
            </ResponsiveContainer>
            
            {/* Center Text */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none mb-8">
                <div className="text-center">
                    <p className="text-2xl font-bold text-charcoal">{rateLimitHits}</p>
                    <p className="text-xs text-stone uppercase tracking-wider">Limits</p>
                </div>
            </div>
        </div>
    );
}
