'use client';

// Tab "KPI" — placeholder cho Sprint 6 (KPI module).
import { Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function TabKpi() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Sparkles className="h-10 w-10 text-muted-foreground/50" />
        <div>
          <p className="text-sm font-medium">KPI module — Sprint 6</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Sprint 6 sẽ thêm KPI assignment + achievement tracking. Channel sẽ có
            chỉ tiêu giao theo period (monthly/quarterly/yearly): targetFollowers,
            targetViews, targetWatchTime, targetEngagement với % achievement
            tự động tính từ ChannelMetric.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
