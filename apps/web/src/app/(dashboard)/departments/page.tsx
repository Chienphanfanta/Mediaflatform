// /departments — placeholder cho Day 6+ (Department model + UI).
import { Building2, Sparkles } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DepartmentsPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Building2 className="h-7 w-7" />
          Phòng ban
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quản lý phòng ban + manager assignment + nhân viên thuộc dept.
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
          <p>
            Module Phòng ban (Department) chưa có trong Sprint 5. Sprint 6 sẽ thêm:
          </p>
          <ul className="ml-4 list-disc space-y-1 text-xs">
            <li>
              <strong>Schema Department</strong>: id, tenantId, name, description,
              color, managerId
            </li>
            <li>
              <strong>User.departmentId</strong> — gán nhân viên vào dept
            </li>
            <li>
              <strong>API CRUD</strong> /api/v1/departments + assign manager
              endpoint
            </li>
            <li>
              <strong>UI</strong>: list dept với member count + chart breakdown
              theo dept
            </li>
            <li>
              <strong>Permission scope</strong>: MANAGER chỉ xem nhân sự trong
              dept của mình (department-level RBAC)
            </li>
          </ul>
          <p className="text-xs">
            Hiện tại: tổ chức tạm dùng Group (HR/CONTENT/ANALYTICS/SYSTEM) — Sprint 6
            sẽ tách Group (RBAC scope) khỏi Department (tổ chức).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
