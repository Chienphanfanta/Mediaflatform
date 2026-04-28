# UI Components — patterns & component choice

> Stack: Next.js 14 App Router + shadcn/ui + TailwindCSS + react-hook-form + Zod + React Query.
> Icons: `lucide-react`. Animations: `tailwindcss-animate`.

---

## 1. Server Component vs Client Component — quyết định đúng

| Dùng Server (default) khi | Dùng Client (`'use client'`) khi |
|---------------------------|----------------------------------|
| Fetch data từ DB/API | `useState`, `useEffect`, `useRef` |
| SEO matters | Event handlers (`onClick`, `onChange`) |
| Async trong body | Browser API (`localStorage`, `window`) |
| Không cần interactivity | React Query hook, form, animation |

Pattern phổ biến: **Server layout/page** fetch session → truyền **Client component** xử lý tương tác.

```tsx
// page.tsx — server
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { DashboardClient } from './dashboard-client';

export default async function Page() {
  const session = await auth();
  if (!session) redirect('/login');
  return <DashboardClient userName={session.user.name} />;
}
```

```tsx
// dashboard-client.tsx — 'use client'
'use client';
export function DashboardClient({ userName }: { userName: string }) {
  const [open, setOpen] = useState(false);
  return <button onClick={() => setOpen(true)}>{userName}</button>;
}
```

---

## 2. Chọn component cho UI case

| Tình huống | Component | Import từ |
|------------|-----------|-----------|
| Box chứa content có header | `Card`, `CardHeader`, `CardContent` | `@/components/ui/card` |
| Modal trung tâm màn hình | `Dialog` | `@/components/ui/dialog` |
| Panel trượt từ cạnh | `Sheet` (mobile menu, filter drawer) | `@/components/ui/sheet` |
| Menu xổ xuống từ button | `DropdownMenu` | `@/components/ui/dropdown-menu` |
| Avatar user | `Avatar`, `AvatarFallback`, `AvatarImage` | `@/components/ui/avatar` |
| Tag nhỏ, status, count | `Badge` | `@/components/ui/badge` |
| Message inline (error, info) | `Alert`, `AlertDescription` | `@/components/ui/alert` |
| Loading placeholder | `Skeleton` | `@/components/ui/skeleton` |
| Text input | `Input` | `@/components/ui/input` |
| Multiline text | `Textarea` | `@/components/ui/textarea` |
| Dropdown select | native `<select>` styled (chưa có shadcn Select) | — |
| Form label | `Label` | `@/components/ui/label` |
| Checkbox 1 state | `Checkbox` | `@/components/ui/checkbox` |
| Button chính | `Button` (default) | `@/components/ui/button` |
| Button destructive | `<Button variant="destructive">` | |
| Button phụ | `<Button variant="outline">` hoặc `"ghost"` | |
| Button link | `<Button asChild><Link>...</Link></Button>` | |
| Đường kẻ phân tách | `Separator` | `@/components/ui/separator` |

---

## 3. Form — react-hook-form + Zod

Pattern chuẩn trong project:

```tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiFetch } from '@/lib/api-client';

const schema = z.object({
  email: z.string().min(1, 'Vui lòng nhập email').email('Email không hợp lệ'),
  name: z.string().min(1, 'Tên bắt buộc').max(100),
});
type FormInput = z.infer<typeof schema>;

export function MyForm({ onSaved }: { onSaved: () => void }) {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput>({ resolver: zodResolver(schema) });

  const mutation = useMutation({
    mutationFn: (input: FormInput) =>
      apiFetch('/api/v1/users', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onSaved();
    },
  });

  return (
    <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" aria-invalid={!!errors.email} {...register('email')} />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Tên</Label>
        <Input id="name" aria-invalid={!!errors.name} {...register('name')} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      {mutation.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{(mutation.error as Error).message}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={mutation.isPending} className="w-full">
        {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Lưu
      </Button>
    </form>
  );
}
```

Ví dụ thật trong project:
- [login-form.tsx](../../apps/web/src/app/(auth)/login/login-form.tsx) — form đơn giản
- [create-post-dialog.tsx](../../apps/web/src/components/calendar/create-post-dialog.tsx) — form phức tạp với `Controller` cho multi-checkbox

---

## 4. Dialog (modal)

```tsx
'use client';
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function MyDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Mở modal</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tiêu đề</DialogTitle>
          <DialogDescription>Mô tả phụ.</DialogDescription>
        </DialogHeader>
        <div>{/* nội dung */}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Huỷ</Button>
          <Button onClick={() => setOpen(false)}>Lưu</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Controlled pattern (mở từ ngoài): dùng `open` + `onOpenChange` prop, không dùng `DialogTrigger`.

---

## 5. Data fetching — React Query

Pattern hook wrapper:

```tsx
// hooks/use-my-data.ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

export function useMyData(filters: Filters) {
  return useQuery<MyData[], Error>({
    queryKey: ['my-data', filters],
    queryFn: () => apiFetch<MyData[]>('/api/v1/my-data?...'),
    staleTime: 60_000,
  });
}
```

Dùng:
```tsx
const { data, isLoading, isError, error, refetch, isFetching } = useMyData(filters);
```

Mutation pattern:
```tsx
const qc = useQueryClient();
const mutation = useMutation({
  mutationFn: (input) => apiFetch('/api/v1/...', { method: 'POST', body: JSON.stringify(input) }),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['my-data'] }),
});
mutation.mutate(input);
```

---

## 6. Loading states — Skeleton

3 cấp độ tuỳ trường hợp:

### (a) Inline skeleton — khi component tự biết loading

```tsx
function MyList({ data, isLoading }: { data?: Item[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  return <ul>{data!.map(...)}</ul>;
}
```

### (b) Suspense boundary — server component

```tsx
<Suspense fallback={<Skeleton className="h-64 w-full" />}>
  <SlowComponent />
</Suspense>
```

### (c) Button loading

```tsx
<Button disabled={mutation.isPending}>
  {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
  Lưu
</Button>
```

Quan trọng: Skeleton **phải** cùng kích thước với nội dung thật → tránh layout shift (CLS).

Ví dụ thực tế chi tiết: [metric-cards.tsx](../../apps/web/src/components/dashboard/overview/metric-cards.tsx).

---

## 7. Data table (chưa có shadcn Table — dùng pattern sau)

Cho đến khi tạo shadcn Table component, dùng `<table>` styled tailwind:

```tsx
export function MyTable({ rows, isLoading }: Props) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Tên</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="w-20 px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                <td colSpan={4} className="p-2">
                  <Skeleton className="h-8 w-full" />
                </td>
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                Không có dữ liệu.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-accent/50">
                <td className="px-4 py-2">{r.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.email}</td>
                <td className="px-4 py-2">
                  <Badge variant="outline">{r.role}</Badge>
                </td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" size="sm">Sửa</Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

Khi cần sort/filter/pagination phức tạp → cân nhắc `@tanstack/react-table` (chưa cài).

---

## 8. Empty state

```tsx
{items.length === 0 ? (
  <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12">
    <FileX className="h-8 w-8 text-muted-foreground" />
    <p className="text-sm font-medium">Chưa có dữ liệu</p>
    <p className="text-xs text-muted-foreground">Tạo mục đầu tiên để bắt đầu.</p>
    <Button size="sm" className="mt-2">+ Tạo mới</Button>
  </div>
) : (
  <List items={items} />
)}
```

---

## 9. Icons

```tsx
import { Plus, Edit, Trash2, AlertCircle } from 'lucide-react';

<Button><Plus className="h-4 w-4" />Thêm</Button>
```

Size convention:
- `h-3 w-3` — badge, tooltip
- `h-4 w-4` — button text, inline
- `h-5 w-5` — topbar icons
- `h-8 w-8` — empty state, hero
- `h-16 w-16` — error page

---

## 10. Dark mode

Project đã setup `next-themes` (xem [providers.tsx](../../apps/web/src/components/providers.tsx)). Dùng CSS vars — tự động theo class `.dark` trên `<html>`.

```tsx
// ✅ Dùng semantic vars (auto light/dark)
className="bg-background text-foreground border-border"
className="bg-card text-card-foreground"
className="bg-muted/30 text-muted-foreground"
className="bg-destructive text-destructive-foreground"

// ⚠ Hardcode màu cần dark variant
className="bg-emerald-500 dark:bg-emerald-600"

// Exception: brand colors (platform) hardcode OK
className="bg-red-600"    // YouTube
className="bg-blue-600"   // Facebook
```

Toggle: `useTheme()` từ `next-themes` — xem [theme-toggle.tsx](../../apps/web/src/components/dashboard/theme-toggle.tsx).

---

## 11. Responsive breakpoints

```
sm:  640px   - small tablet
md:  768px   - tablet
lg:  1024px  - laptop
xl:  1280px  - desktop
2xl: 1536px  - large desktop
```

Project pattern:
- `< lg`: sidebar ẩn, dùng Sheet mobile
- `< md`: breadcrumb ẩn, topbar gọn
- `< sm`: search input ẩn hoàn toàn

---

## 12. Danh sách import phổ biến (copy-paste)

```tsx
// React
import { useState, useEffect, useMemo, useRef } from 'react';

// Next.js
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { redirect } from 'next/navigation';

// Auth
import { auth, signIn, signOut } from '@/auth';
import { usePermission } from '@/hooks/use-permission';

// API + data
import { apiFetch } from '@/lib/api-client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Forms
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// UI
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Date + format
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import { formatCompact, formatPct } from '@/lib/format';

// Icons
import { Loader2, AlertCircle, Plus, Edit, Trash2, Search } from 'lucide-react';

// Utils
import { cn } from '@/lib/utils';
```
