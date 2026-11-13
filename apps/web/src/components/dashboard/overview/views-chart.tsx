'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCompact } from '@/lib/format';
import type { ViewsByDay } from '@/lib/types/dashboard';
import { PLATFORM_HEX, PLATFORM_LABEL } from '@/lib/platform';

type Props = { data?: ViewsByDay[]; isLoading: boolean };

const PLATFORM_COLORS: Record<keyof Omit<ViewsByDay, 'date'>, string> = PLATFORM_HEX;

function labelOf(key: string): string {
  return (PLATFORM_LABEL as Record<string, string>)[key] ?? key;
}

export function ViewsChart({ data, isLoading }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Views 7 ngày qua</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-[280px] w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => format(parseISO(d), 'dd/MM')}
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <YAxis
                tickFormatter={(v: number) => formatCompact(v)}
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(d: string) => format(parseISO(d), 'EEEE, dd/MM/yyyy')}
                formatter={(v: number, name: string) => [formatCompact(v), labelOf(name)]}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(v: string) => labelOf(v)}
              />
              {(Object.keys(PLATFORM_COLORS) as Array<keyof typeof PLATFORM_COLORS>).map((p) => (
                <Line
                  key={p}
                  type="monotone"
                  dataKey={p}
                  stroke={PLATFORM_COLORS[p]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
