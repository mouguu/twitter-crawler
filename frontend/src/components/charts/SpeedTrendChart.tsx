import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface SpeedDataPoint {
    time: string;
    speed: number;
}

interface SpeedTrendChartProps {
    data: SpeedDataPoint[];
}

export function SpeedTrendChart({ data }: SpeedTrendChartProps) {
    return (
        <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={data}
                    margin={{
                        top: 10,
                        right: 30,
                        left: 0,
                        bottom: 0,
                    }}
                >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} />
                    <XAxis 
                        dataKey="time" 
                        stroke="#78716c" 
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis 
                        stroke="#78716c" 
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        label={{ value: 'Tweets/sec', angle: -90, position: 'insideLeft', fill: '#78716c', fontSize: 12 }}
                    />
                    <Tooltip 
                        contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        itemStyle={{ color: '#0f766e' }}
                    />
                    <Area 
                        type="monotone" 
                        dataKey="speed" 
                        stroke="#0f766e" 
                        fill="#ccfbf1" 
                        strokeWidth={2}
                        animationDuration={500}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
