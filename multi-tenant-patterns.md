# Skill: Multi-tenant Patterns — HR + Channel Tracker

> Đọc file này trước khi viết bất kỳ code nào liên quan tenant isolation.

---

## Quy tắc vàng

**KHÔNG BAO GIỜ** query/mutate database mà không có `tenantId` filter, trừ khi user là `SUPER_ADMIN`.

Vi phạm = data leak giữa tenants = thảm họa.

---

## Tenant Context Pattern

### 1. Inject context vào request (NestJS)

```typescript
// /apps/api/src/common/tenant/tenant.middleware.ts
import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private jwt: JwtService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) throw new UnauthorizedException()
    
    const payload = await this.jwt.verifyAsync(token)
    
    // Attach to request
    req['tenantId'] = payload.tenantId
    req['userId'] = payload.userId
    req['userRole'] = payload.role
    req['isSuperAdmin'] = payload.role === 'SUPER_ADMIN'
    
    next()
  }
}
```

### 2. Custom decorator để lấy tenant context

```typescript
// /apps/api/src/common/decorators/tenant.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest()
    return {
      tenantId: request.tenantId,
      userId: request.userId,
      role: request.userRole,
      isSuperAdmin: request.isSuperAdmin,
    }
  }
)

// Usage in controller:
@Get()
async findAll(@CurrentTenant() tenant: TenantContext) {
  return this.service.findAll(tenant.tenantId)
}
```

---

## Prisma Extension Pattern

```typescript
// /packages/db/tenant-extension.ts
import { Prisma } from '@prisma/client'

export interface TenantContext {
  tenantId: string | null
  isSuperAdmin: boolean
}

export function tenantExtension(ctx: TenantContext) {
  return Prisma.defineExtension({
    name: 'tenantFilter',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // 1. Bypass cho Tenant model (root level)
          if (model === 'Tenant') return query(args)
          
          // 2. Bypass cho super admin
          if (ctx.isSuperAdmin) return query(args)
          
          // 3. Require tenant context
          if (!ctx.tenantId) {
            throw new Error(
              `❌ Refusing to query ${model}.${operation} without tenant context`
            )
          }
          
          // 4. READ operations: inject where.tenantId
          if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'].includes(operation)) {
            args.where = { ...args.where, tenantId: ctx.tenantId }
          }
          
          // 5. CREATE: inject data.tenantId
          if (operation === 'create') {
            args.data = { ...args.data, tenantId: ctx.tenantId }
          }
          if (operation === 'createMany') {
            args.data = (Array.isArray(args.data) ? args.data : [args.data])
              .map(d => ({ ...d, tenantId: ctx.tenantId }))
          }
          
          // 6. UPDATE/DELETE: inject where.tenantId (prevent cross-tenant mutations)
          if (['update', 'updateMany', 'delete', 'deleteMany'].includes(operation)) {
            args.where = { ...args.where, tenantId: ctx.tenantId }
          }
          
          // 7. UPSERT: tenantId in both where + create
          if (operation === 'upsert') {
            args.where = { ...args.where, tenantId: ctx.tenantId }
            args.create = { ...args.create, tenantId: ctx.tenantId }
          }
          
          return query(args)
        }
      }
    }
  })
}
```

---

## Per-request Prisma client (NestJS)

```typescript
// /apps/api/src/common/tenant/tenant-prisma.service.ts
import { Injectable, Scope } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { tenantExtension } from '@packages/db/tenant-extension'
import { REQUEST } from '@nestjs/core'

@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private client: PrismaClient
  
  constructor(@Inject(REQUEST) private request: Request) {
    const baseClient = new PrismaClient()
    this.client = baseClient.$extends(tenantExtension({
      tenantId: request['tenantId'],
      isSuperAdmin: request['isSuperAdmin']
    })) as any
  }
  
  // Expose Prisma models
  get tenant() { return this.client.tenant }
  get employee() { return this.client.employee }
  get channel() { return this.client.channel }
  // ... etc
  
  $transaction = this.client.$transaction.bind(this.client)
}

// Usage trong service:
@Injectable()
export class EmployeesService {
  constructor(private prisma: TenantPrismaService) {}
  
  async findAll() {
    // tenantId tự động inject — không cần truyền
    return this.prisma.employee.findMany({
      include: { department: true }
    })
  }
}
```

---

## Subdomain Routing

```typescript
// /apps/web/src/middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

const PUBLIC_PATHS = ['/login', '/signup', '/api/auth', '/_next']

export async function middleware(req: NextRequest) {
  const host = req.headers.get('host')!
  const subdomain = host.split('.')[0]
  const pathname = req.nextUrl.pathname
  
  // Public paths bypass
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }
  
  // Admin subdomain
  if (subdomain === 'admin') {
    const token = await getToken({ req })
    if (!token || token.role !== 'SUPER_ADMIN') {
      return NextResponse.redirect(new URL('/login', req.url))
    }
    // Inject super-admin flag
    const res = NextResponse.next()
    res.headers.set('x-is-super-admin', 'true')
    return res
  }
  
  // Tenant subdomain
  const token = await getToken({ req })
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  
  // Verify token's tenantSlug matches subdomain
  if (token.tenantSlug !== subdomain) {
    return NextResponse.redirect(
      new URL(`https://${token.tenantSlug}.${process.env.ROOT_DOMAIN}/dashboard`, req.url)
    )
  }
  
  // Inject tenant headers for downstream
  const res = NextResponse.next()
  res.headers.set('x-tenant-id', token.tenantId as string)
  res.headers.set('x-tenant-slug', subdomain)
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
```

---

## Tenant Limit Enforcement

```typescript
// /apps/api/src/common/decorators/check-limit.decorator.ts
const TIER_LIMITS = {
  FREE: { maxEmployees: 5, maxChannels: 10, syncFrequency: 21600 },
  STARTER: { maxEmployees: 20, maxChannels: 50, syncFrequency: 3600 },
  PRO: { maxEmployees: 100, maxChannels: 500, syncFrequency: 3600 },
  ENTERPRISE: { maxEmployees: Infinity, maxChannels: Infinity, syncFrequency: 900 }
}

@Injectable()
export class TenantLimitGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const tenantId = request.tenantId
    const limitType = Reflect.getMetadata('limitType', context.getHandler())
    
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { subscriptionTier: true, _count: { select: { employees: true, channels: true } } }
    })
    
    const limits = TIER_LIMITS[tenant.subscriptionTier]
    
    if (limitType === 'maxEmployees' && tenant._count.employees >= limits.maxEmployees) {
      throw new ForbiddenException(`Đã đạt giới hạn ${limits.maxEmployees} nhân viên cho gói ${tenant.subscriptionTier}. Hãy nâng cấp gói.`)
    }
    
    if (limitType === 'maxChannels' && tenant._count.channels >= limits.maxChannels) {
      throw new ForbiddenException(`Đã đạt giới hạn ${limits.maxChannels} kênh cho gói ${tenant.subscriptionTier}.`)
    }
    
    return true
  }
}

// Decorator
export const CheckLimit = (limitType: 'maxEmployees' | 'maxChannels') =>
  SetMetadata('limitType', limitType)

// Usage:
@Post()
@UseGuards(TenantLimitGuard)
@CheckLimit('maxChannels')
async create(...) { ... }
```

---

## Common Pitfalls

### 1. Quên tenantId trong unique constraints

```prisma
// SAI: email unique global → 2 tenants không thể có email trùng nhau
model Employee {
  email String @unique
}

// ĐÚNG: email unique trong tenant
model Employee {
  email String
  @@unique([tenantId, email])
}
```

### 2. Quên check ownership khi access channel

```typescript
// SAI: ai cũng update được channel
async updateChannel(channelId: string, data) {
  return prisma.channel.update({ where: { id: channelId }, data })
}

// ĐÚNG: verify channel thuộc tenant + user có quyền
async updateChannel(channelId: string, userId: string, data) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { ownerships: true }
  })
  
  if (!channel) throw new NotFoundException()
  
  // Tenant filter đã tự done qua extension
  // Nhưng cần check ownership cho STAFF role:
  if (userRole === 'STAFF') {
    const isOwner = channel.ownerships.some(o => o.employeeId === userId)
    if (!isOwner) throw new ForbiddenException()
  }
  
  return prisma.channel.update({ where: { id: channelId }, data })
}
```

### 3. Cross-tenant data leak qua includes

```typescript
// Khi include relations, vẫn cần tenant filter
const employee = await prisma.employee.findUnique({
  where: { id: employeeId },
  include: {
    ownedChannels: {
      where: { /* tenantId tự inject qua extension */ }
    }
  }
})
```

### 4. Background jobs forgot tenant context

```typescript
// SAI: cron job không có tenant context
@Cron('0 * * * *')
async syncAllChannels() {
  const channels = await prisma.channel.findMany() // ❌ throw error
}

// ĐÚNG: dùng raw client (skip extension) cho system-level jobs
@Cron('0 * * * *')
async syncAllChannels() {
  const channels = await this.systemPrisma.channel.findMany({
    where: { status: 'ACTIVE' }
  })
  
  // Group by tenant for tenant-specific logic
  const byTenant = groupBy(channels, 'tenantId')
  for (const [tenantId, tenantChannels] of Object.entries(byTenant)) {
    await this.syncTenantChannels(tenantId, tenantChannels)
  }
}
```

---

## Testing Multi-tenant

```typescript
// /apps/api/test/multi-tenant.spec.ts
describe('Multi-tenant isolation', () => {
  let tenantA, tenantB, employeeA, employeeB
  
  beforeAll(async () => {
    tenantA = await createTenant({ name: 'Tenant A', slug: 'a' })
    tenantB = await createTenant({ name: 'Tenant B', slug: 'b' })
    employeeA = await createEmployee({ tenantId: tenantA.id })
    employeeB = await createEmployee({ tenantId: tenantB.id })
  })
  
  it('Employee A cannot see Employee B', async () => {
    const ctx = { tenantId: tenantA.id, isSuperAdmin: false }
    const prisma = getPrismaWithContext(ctx)
    
    const employees = await prisma.employee.findMany()
    expect(employees).toHaveLength(1)
    expect(employees[0].id).toBe(employeeA.id)
  })
  
  it('Cannot create channel for another tenant', async () => {
    const ctx = { tenantId: tenantA.id, isSuperAdmin: false }
    const prisma = getPrismaWithContext(ctx)
    
    // Even if we manually pass tenantB.id, extension overrides it
    const channel = await prisma.channel.create({
      data: { 
        tenantId: tenantB.id, // ← bị override
        name: 'Hacker Channel',
        platform: 'YOUTUBE',
        externalId: 'fake'
      }
    })
    
    expect(channel.tenantId).toBe(tenantA.id) // Forced to tenant A
  })
  
  it('Super admin sees all', async () => {
    const ctx = { tenantId: null, isSuperAdmin: true }
    const prisma = getPrismaWithContext(ctx)
    
    const employees = await prisma.employee.findMany()
    expect(employees).toHaveLength(2) // Cả A và B
  })
})
```
