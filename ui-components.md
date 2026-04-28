# Skill: UI Components & Mobile Responsive — Media Ops Platform

> Đọc file này trước khi viết bất kỳ React component nào, đặc biệt là mobile UI.

---

## Breakpoints Convention

```typescript
// tailwind.config.ts
extend: {
  screens: {
    'xs': '375px',   // nhỏ nhất (iPhone SE)
    'sm': '640px',   // mobile landscape / tablet portrait
    'md': '768px',   // tablet
    'lg': '1024px',  // desktop nhỏ
    'xl': '1280px',  // desktop thường
    '2xl': '1536px', // desktop lớn
  }
}

// Mobile-first: viết style default cho mobile, rồi override lên lớn hơn
// ✅ ĐÚNG: <div className="p-3 sm:p-4 lg:p-6">
// ❌ SAI:  <div className="p-6 max-sm:p-3">
```

---

## useMobile Hook

```typescript
// /apps/web/src/hooks/use-mobile.ts
'use client'
import { useState, useEffect } from 'react'

export function useMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])

  return isMobile
}

// Usage:
const isMobile = useMobile()
return isMobile ? <MobileCalendar /> : <DesktopCalendar />
```

---

## Bottom Navigation (Mobile)

```tsx
// /components/layout/bottom-nav.tsx
'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, Calendar, BarChart2, Radio, Menu } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/calendar',   icon: Calendar,        label: 'Lịch' },
  { href: '/channels',   icon: Radio,           label: 'Kênh' },
  { href: '/analytics',  icon: BarChart2,        label: 'Analytics' },
  { href: '/menu',       icon: Menu,            label: 'Menu' },
]

export function BottomNav() {
  const pathname = usePathname()
  
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 flex lg:hidden">
      {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
        const active = pathname.startsWith(href)
        return (
          <Link key={href} href={href}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 min-h-[56px]
              ${active ? 'text-purple-600' : 'text-gray-400'}`}
          >
            <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
            <span className="text-[10px] font-medium">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
```

---

## Bottom Sheet (Mobile Modal)

```tsx
// /components/ui/bottom-sheet.tsx — thay thế Dialog trên mobile
'use client'
import { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  snapPoints?: ('50%' | '75%' | '100%')[]
}

export function BottomSheet({ open, onClose, title, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      {/* Sheet */}
      <div ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl 
                   max-h-[90vh] flex flex-col animate-slide-up"
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>
        {title && (
          <div className="px-4 py-2 border-b border-gray-100">
            <h2 className="text-base font-medium">{title}</h2>
          </div>
        )}
        <div className="overflow-y-auto flex-1 pb-safe">{children}</div>
      </div>
    </>
  )
}
// tailwind.config: extend.animation: { 'slide-up': 'slideUp 0.3s ease-out' }
// extend.keyframes: slideUp: { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } }
```

---

## Responsive Data Table → Mobile Card List

```tsx
// Pattern: table trên desktop, cards trên mobile
// /components/posts/posts-list.tsx

export function PostsList({ posts }: { posts: Post[] }) {
  const isMobile = useMobile()
  
  if (isMobile) {
    return (
      <div className="space-y-3 p-4">
        {posts.map(post => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    )
  }
  
  return (
    <table className="w-full text-sm">
      <thead>...</thead>
      <tbody>
        {posts.map(post => <PostTableRow key={post.id} post={post} />)}
      </tbody>
    </table>
  )
}

// Mobile card
function PostCard({ post }: { post: Post }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 flex gap-3">
      <div className="w-12 h-12 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden">
        {post.thumbnail && <img src={post.thumbnail} className="w-full h-full object-cover" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{post.title}</p>
        <div className="flex items-center gap-2 mt-1">
          <PlatformBadge platform={post.platform} />
          <StatusBadge status={post.status} />
        </div>
        <p className="text-xs text-gray-400 mt-1">{formatDate(post.scheduledAt)}</p>
      </div>
      <button className="self-center p-1"><MoreVertical size={16} /></button>
    </div>
  )
}
```

---

## Touch-friendly Swipe Actions

```tsx
// Swipe left để reveal delete/edit actions
// /components/ui/swipe-action.tsx
'use client'
import { useRef, useState } from 'react'

export function SwipeAction({ children, onDelete, onEdit }: {
  children: React.ReactNode
  onDelete?: () => void
  onEdit?: () => void
}) {
  const [offset, setOffset] = useState(0)
  const startX = useRef(0)
  const ACTION_WIDTH = 80

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Actions revealed on swipe */}
      <div className="absolute right-0 top-0 bottom-0 flex items-center">
        {onEdit && (
          <button onClick={onEdit}
            className="w-20 h-full bg-blue-500 text-white text-xs font-medium flex flex-col items-center justify-center gap-1">
            <Pencil size={16} /><span>Sửa</span>
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete}
            className="w-20 h-full bg-red-500 text-white text-xs font-medium flex flex-col items-center justify-center gap-1">
            <Trash2 size={16} /><span>Xóa</span>
          </button>
        )}
      </div>
      {/* Content — slides left */}
      <div style={{ transform: `translateX(${-offset}px)`, transition: offset === 0 ? 'transform 0.2s' : 'none' }}
        onTouchStart={e => { startX.current = e.touches[0].clientX }}
        onTouchMove={e => {
          const delta = startX.current - e.touches[0].clientX
          setOffset(Math.max(0, Math.min(delta, ACTION_WIDTH * (onEdit && onDelete ? 2 : 1))))
        }}
        onTouchEnd={() => {
          setOffset(prev => prev > ACTION_WIDTH / 2 ? ACTION_WIDTH * (onEdit && onDelete ? 2 : 1) : 0)
        }}
      >
        {children}
      </div>
    </div>
  )
}
```

---

## Recharts Mobile Optimization

```tsx
// Chart responsive — tự điều chỉnh theo màn hình
import { useEffect, useState } from 'react'

function useChartConfig() {
  const [config, setConfig] = useState({ height: 320, showLegend: true, dataPoints: 30 })
  
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setConfig(w < 640
        ? { height: 180, showLegend: false, dataPoints: 7 }
        : w < 1024
        ? { height: 240, showLegend: true, dataPoints: 14 }
        : { height: 320, showLegend: true, dataPoints: 30 }
      )
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  
  return config
}
```

---

## Loading Skeletons

```tsx
// /components/ui/skeleton.tsx
export function MetricCardSkeleton() {
  return (
    <div className="bg-gray-50 rounded-xl p-4 animate-pulse">
      <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
      <div className="h-7 w-32 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-16 bg-gray-200 rounded" />
    </div>
  )
}

export function ChartSkeleton({ height = 320 }: { height?: number }) {
  return (
    <div className="animate-pulse" style={{ height }}>
      <div className="h-full bg-gray-50 rounded-xl flex items-end justify-around px-4 pb-4 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="bg-gray-200 rounded-t w-full"
            style={{ height: `${30 + Math.random() * 60}%` }} />
        ))}
      </div>
    </div>
  )
}
```

---

## PWA Install Banner

```tsx
// /components/pwa/install-banner.tsx
'use client'
import { useState, useEffect } from 'react'

export function PWAInstallBanner() {
  const [prompt, setPrompt] = useState<any>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!prompt || dismissed) return null

  return (
    <div className="fixed bottom-20 left-4 right-4 bg-white border border-gray-200 rounded-2xl p-4 shadow-lg z-50 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
        <Smartphone size={20} className="text-purple-600" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium">Thêm vào màn hình chính</p>
        <p className="text-xs text-gray-400">Truy cập nhanh không cần trình duyệt</p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setDismissed(true)} className="text-xs text-gray-400 px-2">Bỏ qua</button>
        <button onClick={async () => { await prompt.prompt(); setPrompt(null) }}
          className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg font-medium">
          Cài
        </button>
      </div>
    </div>
  )
}
```
