// /kpi — placeholder cho Day 6+ (KPI module).
import { Sparkles, Target } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function KpiPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Target className="h-7 w-7" />
          KPI
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quản lý chỉ tiêu giao theo kênh hoặc theo nhân viên + theo dõi achievement %.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Module đang xây dựng — Sprint 6
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Module KPI sẽ có ở Sprint 6:</p>
          <ul className="ml-4 list-disc space-y-1 text-xs">
            <li>
              <strong>Schema KPI</strong>: scope (PER_CHANNEL | PER_EMPLOYEE),
              periodType (MONTHLY | QUARTERLY | YEARLY), targetFollowers,
              targetViews, targetWatchTime, targetEngagement
            </li>
            <li>
              <strong>Auto-calculate achievementPercent</strong> từ ChannelMetric
              snapshot mỗi giờ
            </li>
            <li>
              <strong>API CRUD</strong> /api/v1/kpi + assign endpoint
            </li>
            <li>
              <strong>UI</strong>: list KPI với progress bar + filter theo scope/period.
              Tab KPI trong /channels/[id] và /employees/[id] sẽ wire vào đây.
            </li>
            <li>
              <strong>Status tự động</strong>: NOT_STARTED → IN_PROGRESS → ACHIEVED |
              EXCEEDED | MISSED
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
