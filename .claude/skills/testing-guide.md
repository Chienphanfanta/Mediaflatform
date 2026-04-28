# Testing Guide — Vitest

> **Note**: CLAUDE.md mục Tech Stack ghi Jest; doc này giới thiệu **Vitest** cho `apps/web` vì chạy nhanh hơn và tích hợp native với Next.js/TS không cần babel config. `apps/api` (NestJS) vẫn giữ Jest do NestJS CLI.

---

## 1. Setup Vitest cho `apps/web`

### Cài deps

```bash
npm install -D vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom --workspace=@media-ops/web
```

### `apps/web/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';   // npm i -D @vitejs/plugin-react
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts', 'src/hooks/**/*.ts', 'src/app/api/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
```

### `apps/web/vitest.setup.ts`

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// Mock next/navigation — hầu hết test cần
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
```

### `apps/web/package.json` scripts

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui",
  "test:cov": "vitest run --coverage"
}
```

### Chạy

```bash
npm test -w @media-ops/web                       # one-shot
npm run test:watch -w @media-ops/web             # watch mode
```

---

## 2. Unit test — pure utils

Test file cạnh source: `src/lib/format.ts` → `src/lib/format.test.ts`.

```ts
// src/lib/format.test.ts
import { describe, it, expect } from 'vitest';
import { formatCompact, formatPct, formatHours } from './format';

describe('formatCompact', () => {
  it('format số nhỏ giữ nguyên', () => {
    expect(formatCompact(42)).toBe('42');
    expect(formatCompact(999)).toBe('999');
  });

  it('rút gọn số lớn theo locale VI', () => {
    expect(formatCompact(1_234)).toBe('1,2K');
    expect(formatCompact(1_500_000)).toBe('1,5Tr');
  });

  it('trả "—" cho null/undefined', () => {
    expect(formatCompact(null)).toBe('—');
    expect(formatCompact(undefined)).toBe('—');
  });
});

describe('formatPct', () => {
  it('thêm dấu cho số dương và âm', () => {
    expect(formatPct(12.34)).toBe('+12.3%');
    expect(formatPct(-5)).toBe('−5.0%');
    expect(formatPct(0)).toBe('0.0%');
  });

  it('ẩn dấu khi signed=false', () => {
    expect(formatPct(12.34, { signed: false })).toBe('12.3%');
  });

  it('trả "—" cho Infinity / NaN', () => {
    expect(formatPct(Infinity)).toBe('—');
    expect(formatPct(NaN)).toBe('—');
  });
});
```

---

## 3. Unit test — RBAC logic (quan trọng!)

RBAC logic có thể vỡ mà TS không bắt được. Test kỹ.

```ts
// src/lib/rbac.test.ts
import { describe, it, expect } from 'vitest';
import { hasPermission, getEffectiveRole, meetsRole, type SessionUser } from './rbac';

const superAdmin: SessionUser = {
  id: 'u1',
  groups: [{ id: 'g-sys', name: 'System', type: 'SYSTEM', role: 'ADMIN' }],
  permissions: {},
  isSuperAdmin: true,
};

const manager: SessionUser = {
  id: 'u2',
  groups: [{ id: 'g-content', name: 'Content', type: 'CONTENT', role: 'MANAGER' }],
  permissions: {
    'g-content': ['post:CREATE', 'post:READ', 'post:UPDATE', 'channel:READ'],
  },
  isSuperAdmin: false,
};

describe('hasPermission', () => {
  it('SuperAdmin luôn true', () => {
    expect(hasPermission(superAdmin, 'post', 'DELETE')).toBe(true);
    expect(hasPermission(superAdmin, 'setting', 'FULL', { groupId: 'any' })).toBe(true);
  });

  it('null user → false', () => {
    expect(hasPermission(null, 'post', 'READ')).toBe(false);
  });

  it('Manager có perm trong group của mình', () => {
    expect(hasPermission(manager, 'post', 'CREATE', { groupId: 'g-content' })).toBe(true);
  });

  it('Manager không có perm trong group khác', () => {
    expect(hasPermission(manager, 'post', 'CREATE', { groupId: 'g-other' })).toBe(false);
  });

  it('FULL implies tất cả action', () => {
    const u: SessionUser = {
      ...manager,
      permissions: { 'g-content': ['post:FULL'] },
    };
    expect(hasPermission(u, 'post', 'DELETE', { groupId: 'g-content' })).toBe(true);
  });

  it('không có groupId → match bất kỳ group', () => {
    expect(hasPermission(manager, 'post', 'CREATE')).toBe(true);
    expect(hasPermission(manager, 'post', 'DELETE')).toBe(false);
  });
});

describe('getEffectiveRole', () => {
  it('SYSTEM/ADMIN → SUPERADMIN', () => {
    expect(getEffectiveRole(superAdmin)).toBe('SUPERADMIN');
  });

  it('non-SYSTEM/ADMIN → GROUP_ADMIN', () => {
    const groupAdmin: SessionUser = {
      ...manager,
      groups: [{ id: 'g1', name: 'HR', type: 'HR', role: 'ADMIN' }],
      isSuperAdmin: false,
    };
    expect(getEffectiveRole(groupAdmin)).toBe('GROUP_ADMIN');
  });

  it('MANAGER → MANAGER', () => {
    expect(getEffectiveRole(manager)).toBe('MANAGER');
  });

  it('không có group → null', () => {
    const u = { ...manager, groups: [], isSuperAdmin: false };
    expect(getEffectiveRole(u)).toBeNull();
  });
});

describe('meetsRole', () => {
  it('SuperAdmin đạt mọi min', () => {
    expect(meetsRole(superAdmin, 'VIEWER')).toBe(true);
    expect(meetsRole(superAdmin, 'SUPERADMIN')).toBe(true);
  });

  it('Manager đạt MANAGER/STAFF/VIEWER nhưng không đạt GROUP_ADMIN', () => {
    expect(meetsRole(manager, 'VIEWER')).toBe(true);
    expect(meetsRole(manager, 'MANAGER')).toBe(true);
    expect(meetsRole(manager, 'GROUP_ADMIN')).toBe(false);
  });
});
```

---

## 4. Unit test — Zod schema

```ts
// src/lib/schemas/post.test.ts
import { describe, it, expect } from 'vitest';
import { createPostsSchema, updatePostSchema } from './post';

describe('createPostsSchema', () => {
  it('accepts minimal valid input', () => {
    const res = createPostsSchema.safeParse({
      channelIds: ['ch1'],
      title: 'Hello world',
      status: 'DRAFT',
    });
    expect(res.success).toBe(true);
  });

  it('fails when channelIds empty', () => {
    const res = createPostsSchema.safeParse({
      channelIds: [],
      title: 'x',
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toEqual(['channelIds']);
    }
  });

  it('requires scheduledAt when status=SCHEDULED', () => {
    const res = createPostsSchema.safeParse({
      channelIds: ['ch1'],
      title: 'x',
      status: 'SCHEDULED',
    });
    expect(res.success).toBe(false);
  });

  it('coerces scheduledAt string to Date', () => {
    const res = createPostsSchema.safeParse({
      channelIds: ['ch1'],
      title: 'x',
      status: 'SCHEDULED',
      scheduledAt: '2026-05-01T10:00:00Z',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.scheduledAt).toBeInstanceOf(Date);
    }
  });

  it('title > 500 chars fails', () => {
    const res = createPostsSchema.safeParse({
      channelIds: ['ch1'],
      title: 'a'.repeat(501),
    });
    expect(res.success).toBe(false);
  });
});
```

---

## 5. Component test

```tsx
// src/components/ui/button.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled state', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button disabled onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('asChild renders custom element', () => {
    render(
      <Button asChild>
        <a href="/target">Link</a>
      </Button>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/target');
  });
});
```

### Test form component — với React Query

```tsx
// src/app/(auth)/login/login-form.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { signIn } from 'next-auth/react';
import { LoginForm } from './login-form';

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('LoginForm', () => {
  it('validates email format', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LoginForm />);
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Mật khẩu'), '123');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));
    expect(await screen.findByText(/không hợp lệ/i)).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('calls signIn với credentials khi valid', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, error: null } as any);
    const user = userEvent.setup();
    renderWithQuery(<LoginForm />);
    await user.type(screen.getByLabelText('Email'), 'admin@company.com');
    await user.type(screen.getByLabelText('Mật khẩu'), 'Admin123!');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));
    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('credentials', {
        email: 'admin@company.com',
        password: 'Admin123!',
        redirect: false,
      });
    });
  });

  it('hiện error khi signIn fail', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: false, error: 'CredentialsSignin' } as any);
    const user = userEvent.setup();
    renderWithQuery(<LoginForm />);
    await user.type(screen.getByLabelText('Email'), 'x@y.com');
    await user.type(screen.getByLabelText('Mật khẩu'), 'wrong');
    await user.click(screen.getByRole('button', { name: /đăng nhập/i }));
    expect(await screen.findByText(/không đúng/i)).toBeInTheDocument();
  });
});
```

---

## 6. Hook test

```tsx
// src/hooks/use-permission.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePermission } from './use-permission';

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: {
      user: {
        id: 'u1',
        groups: [{ id: 'g1', name: 'C', type: 'CONTENT', role: 'MANAGER' }],
        permissions: { g1: ['post:CREATE', 'post:READ'] },
        isSuperAdmin: false,
      },
    },
  }),
}));

describe('usePermission', () => {
  it('can(post, CREATE) = true', () => {
    const { result } = renderHook(() => usePermission());
    expect(result.current.can('post', 'CREATE')).toBe(true);
    expect(result.current.can('post', 'DELETE')).toBe(false);
  });

  it('atLeast(VIEWER) = true', () => {
    const { result } = renderHook(() => usePermission());
    expect(result.current.atLeast('VIEWER')).toBe(true);
    expect(result.current.atLeast('GROUP_ADMIN')).toBe(false);
  });

  it('effectiveRole = MANAGER', () => {
    const { result } = renderHook(() => usePermission());
    expect(result.current.effectiveRole).toBe('MANAGER');
  });
});
```

---

## 7. Integration test — API route handler với DB thật

CLAUDE.md §9 rule #20: **KHÔNG mock Prisma**. Dùng test database thật (Postgres test container hoặc DB riêng).

### Setup — `.env.test`

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/media_ops_test?schema=public"
AUTH_SECRET=test-secret-not-for-prod
TOKEN_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
```

### `apps/web/src/test-utils/db.ts`

```ts
// Helper reset DB trước mỗi test suite
import { execSync } from 'node:child_process';
import { prisma } from '@/lib/prisma';

export async function resetDb() {
  // Truncate tất cả bảng theo đúng thứ tự FK
  await prisma.$transaction([
    prisma.alert.deleteMany(),
    prisma.analytics.deleteMany(),
    prisma.task.deleteMany(),
    prisma.post.deleteMany(),
    prisma.mediaLibrary.deleteMany(),
    prisma.channelGroup.deleteMany(),
    prisma.channel.deleteMany(),
    prisma.groupMember.deleteMany(),
    prisma.rolePermission.deleteMany(),
    prisma.permission.deleteMany(),
    prisma.group.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

export function applyMigrations() {
  execSync('npx prisma migrate deploy --schema=../../packages/db/prisma/schema.prisma', {
    stdio: 'inherit',
  });
}
```

### Test route handler — `api/v1/groups/route.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resetDb } from '@/test-utils/db';
import { GET, POST } from './route';

// Mock auth() để inject user thẳng vào request
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));
import { auth } from '@/auth';

function makeReq(url: string, init?: RequestInit) {
  return new NextRequest(url, init);
}

function mockUser(overrides: Partial<any> = {}) {
  const user = {
    id: 'u1',
    email: 'admin@test',
    groups: [{ id: 'g-sys', name: 'System', type: 'SYSTEM', role: 'ADMIN' }],
    permissions: {},
    isSuperAdmin: true,
    ...overrides,
  };
  vi.mocked(auth).mockResolvedValue({ user } as any);
  return user;
}

describe('GET /api/v1/groups', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('401 khi chưa login', async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const res = await GET(makeReq('http://localhost/api/v1/groups'), { params: {} });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('SuperAdmin thấy tất cả groups', async () => {
    mockUser();
    await prisma.group.createMany({
      data: [
        { name: 'HR', type: 'HR' },
        { name: 'Content', type: 'CONTENT' },
      ],
    });

    const res = await GET(makeReq('http://localhost/api/v1/groups'), { params: {} });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.meta.pagination.total).toBe(2);
  });

  it('user thường chỉ thấy group mình thuộc về', async () => {
    const [myGroup, otherGroup] = await Promise.all([
      prisma.group.create({ data: { name: 'My', type: 'CONTENT' } }),
      prisma.group.create({ data: { name: 'Other', type: 'HR' } }),
    ]);
    const u = await prisma.user.create({
      data: {
        email: 'x@y.com', password: 'hash', name: 'X',
        groupMembers: { create: { groupId: myGroup.id, role: 'MANAGER' } },
      },
    });
    mockUser({
      id: u.id,
      groups: [{ id: myGroup.id, name: 'My', type: 'CONTENT', role: 'MANAGER' }],
      isSuperAdmin: false,
    });

    const res = await GET(makeReq('http://localhost/api/v1/groups'), { params: {} });
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(myGroup.id);
  });
});

describe('POST /api/v1/groups', () => {
  beforeEach(resetDb);

  it('403 khi không phải SuperAdmin', async () => {
    mockUser({ isSuperAdmin: false });
    const res = await POST(
      makeReq('http://localhost/api/v1/groups', {
        method: 'POST',
        body: JSON.stringify({ name: 'X', type: 'CONTENT' }),
      }),
      { params: {} },
    );
    expect(res.status).toBe(403);
  });

  it('422 khi body invalid', async () => {
    mockUser();
    const res = await POST(
      makeReq('http://localhost/api/v1/groups', {
        method: 'POST',
        body: JSON.stringify({ name: '', type: 'INVALID' }),
      }),
      { params: {} },
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toBeInstanceOf(Array);
  });

  it('201 tạo group thành công', async () => {
    mockUser();
    const res = await POST(
      makeReq('http://localhost/api/v1/groups', {
        method: 'POST',
        body: JSON.stringify({ name: 'New Group', type: 'CONTENT', description: 'x' }),
      }),
      { params: {} },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBeTruthy();
    expect(body.data.name).toBe('New Group');

    // Verify DB
    const row = await prisma.group.findUnique({ where: { id: body.data.id } });
    expect(row).toMatchObject({ name: 'New Group', type: 'CONTENT' });
  });
});
```

---

## 8. Cấu hình CI — GitHub Actions snippet

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        ports: [5432:5432]
        options: --health-cmd pg_isready --health-interval 5s
      redis:
        image: redis:7
        ports: [6379:6379]
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/media_ops_test
      REDIS_URL: redis://localhost:6379
      AUTH_SECRET: test
      TOKEN_ENCRYPTION_KEY: "0".repeat(64)
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
      - run: npm test
```

---

## 9. Testing priorities — cái gì test trước

| Ưu tiên | Khu vực | Lý do |
|---------|---------|-------|
| 🔴 Cao | `lib/rbac.ts` | Bug ở đây = lỗ bảo mật |
| 🔴 Cao | `lib/schemas/*.ts` | Validate mọi input |
| 🔴 Cao | API route permission checks | End-to-end bảo mật |
| 🟠 Trung | `lib/format.ts`, helpers thuần | Dễ test, bug hiển nhiên |
| 🟠 Trung | Custom hooks | Logic chạy trên client |
| 🟡 Thấp | Shadcn primitives (`ui/*`) | Đã test upstream |
| 🟡 Thấp | Layout components (sidebar, topbar) | Visual test tốt hơn |

---

## 10. Common mocking patterns

```ts
// Mock auth()
vi.mock('@/auth', () => ({ auth: vi.fn() }));

// Mock React Query hook
vi.mock('@/hooks/use-dashboard-overview', () => ({
  useDashboardOverview: () => ({
    data: mockData,
    isLoading: false,
    isError: false,
  }),
}));

// Mock fetch
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ success: true, data: { id: 'x' } }),
}) as any;

// Mock date — deterministic "now"
vi.setSystemTime(new Date('2026-04-24T10:00:00Z'));

// Spy on function without replacing
const spy = vi.spyOn(prisma.post, 'create');
```

---

## 11. Debugging

```bash
# Chạy 1 file test
npx vitest run src/lib/rbac.test.ts

# Chạy test match pattern
npx vitest run -t "SuperAdmin"

# UI mode — xem trong browser
npm run test:ui

# Verbose
npx vitest run --reporter=verbose
```

Nếu test pass local nhưng fail CI → check:
- Timezone (dùng UTC trong test)
- Locale (Intl.NumberFormat khác giữa env)
- DATABASE_URL đúng test DB, không production

---

## 12. E2E Testing với Playwright

> Vitest = unit/integration (rbac, format, schemas). Playwright = browser-level
> flow thật, click + DOM check + network + cookie. Không thay thế nhau.

### Setup

```bash
npm install -D @playwright/test --workspace=@media-ops/web
npx playwright install --with-deps chromium webkit
```

[apps/web/playwright.config.ts](../../apps/web/playwright.config.ts) đã setup —
xem file đó cho config thật. Test files trong `apps/web/e2e/`.

### Run

```bash
# Chạy full suite (Chrome + WebKit cho mobile flows)
npx playwright test

# 1 file
npx playwright test e2e/login.spec.ts

# Headed mode (xem browser)
npx playwright test --headed

# UI mode (debug interactive)
npx playwright test --ui

# Generate test bằng codegen (record clicks)
npx playwright codegen http://localhost:3000
```

### Pattern chuẩn

```ts
import { test, expect } from '@playwright/test';

test.describe('Feature X', () => {
  // Login fixture — share giữa nhiều test
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@mediaops.app');
    await page.getByLabel('Mật khẩu').fill('Test123!@#');
    await page.getByRole('button', { name: /đăng nhập/i }).click();
    await page.waitForURL('/dashboard');
  });

  test('happy path', async ({ page }) => {
    // ... assertions
  });
});
```

### Selector priority (theo Testing Library philosophy)

1. **Role-based** — `page.getByRole('button', { name: /lưu/i })` ✅
2. **Label** — `page.getByLabel('Email')` ✅
3. **Placeholder** — `page.getByPlaceholder(/tìm kiếm/i)` ✅
4. **Text** — `page.getByText('Cảnh báo')` ✅
5. **Test ID** — `page.getByTestId('post-card-123')` (last resort, thêm
   `data-testid` vào component khi role/text không unique).

KHÔNG dùng `page.locator('.css-class')` hoặc xpath — fragile, vỡ khi đổi style.

### 5 critical flows (đã viết)

| File | Flow |
|---|---|
| [`e2e/login.spec.ts`](../../apps/web/e2e/login.spec.ts) | Login đúng/sai password, forgot password redirect |
| [`e2e/post-create.spec.ts`](../../apps/web/e2e/post-create.spec.ts) | Tạo post DRAFT + schedule post |
| [`e2e/analytics.spec.ts`](../../apps/web/e2e/analytics.spec.ts) | Mở dashboard analytics, đổi period, KPI hiển thị |
| [`e2e/alerts.spec.ts`](../../apps/web/e2e/alerts.spec.ts) | Nhận alert, click bell, dismiss |
| [`e2e/mobile-nav.spec.ts`](../../apps/web/e2e/mobile-nav.spec.ts) | iPhone viewport, bottom nav 5 tabs |

### Test data

Playwright test KHÔNG nên seed riêng — chia sẻ DB với dev:

```bash
# Reset DB + seed cho test (chạy 1 lần trước E2E)
DATABASE_URL=postgresql://test:test@localhost:5432/media_ops_test \
  npm run db:reset -w @media-ops/db

DATABASE_URL=postgresql://test:test@localhost:5432/media_ops_test \
  npm run db:seed -w @media-ops/db
```

Tài khoản default sau seed (xem [seed.ts](../../packages/db/prisma/seed.ts)):
- `admin@mediaops.app` / `Test123!@#` — SuperAdmin
- `manager@mediaops.app` / `Test123!@#` — Group MANAGER
- `staff@mediaops.app` / `Test123!@#` — STAFF

### Mocking external API (network)

Khi cần mock platform call (vd YouTube upload) trong E2E:

```ts
test('publish post — YT API mock', async ({ page }) => {
  await page.route('https://www.googleapis.com/youtube/v3/videos**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'mock-video-id', status: { uploadStatus: 'uploaded' } }),
    }),
  );
  // ... rest of test
});
```

Cho UI flow không gọi platform thật → đủ. Cho integration thực (BullMQ → real
worker), dùng môi trường staging riêng.

### CI tips

- Set `workers: 1` khi test ghi DB chung — tránh race condition.
- `retries: 2` cho flake do timing.
- Upload `playwright-report/` artifact khi fail để debug.
- `--shard` để split suite chạy parallel trên multiple runners.

```yaml
# .github/workflows/e2e.yml (chưa setup)
- run: npx playwright test --shard=1/2
```

### Khi test fail

1. Xem screenshot ở `test-results/` (Playwright tự chụp khi fail).
2. Xem trace (`npx playwright show-trace test-results/.../trace.zip`).
3. Re-chạy 1 test với `--headed --slow-mo=500` để mắt theo dõi.
4. Đừng skip test bằng `.skip()` — fix gốc hoặc flag bug ở KNOWN ISSUES.
