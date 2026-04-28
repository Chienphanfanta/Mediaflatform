# Media Ops Platform

Web quản lý nhân sự và đa kênh truyền thông — YouTube, Facebook, Instagram, Telegram, X, WhatsApp.

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + TailwindCSS
- **Backend**: NestJS + TypeScript
- **Database**: PostgreSQL (qua Prisma ORM)
- **Cache / Queue**: Redis
- **Monorepo**: npm workspaces + Turborepo

## Cấu trúc dự án

```
media-ops-platform/
├── apps/
│   ├── web/              # Next.js 14 frontend (App Router)
│   └── api/              # NestJS backend API
├── packages/
│   ├── shared/           # Types, utils, constants dùng chung
│   └── db/               # Prisma schema + migrations
├── package.json          # Root workspaces
├── .env.example          # Mẫu biến môi trường
└── README.md
```

## Yêu cầu

- Node.js >= 20
- npm >= 10
- PostgreSQL >= 15
- Redis >= 7

## Bắt đầu

```bash
# Cài đặt dependencies
npm install

# Copy biến môi trường
cp .env.example .env

# Sinh Prisma client + chạy migrations
npm run db:generate
npm run db:migrate

# Chạy dev (web + api song song)
npm run dev

# Hoặc chạy riêng
npm run dev:web    # http://localhost:3000
npm run dev:api    # http://localhost:4000
```

## Scripts chính

| Lệnh | Mô tả |
|------|-------|
| `npm run dev` | Chạy tất cả apps ở chế độ dev |
| `npm run build` | Build toàn bộ workspace |
| `npm run lint` | Lint toàn bộ workspace |
| `npm run test` | Chạy test toàn bộ workspace |
| `npm run db:studio` | Mở Prisma Studio |

## Kênh tích hợp

- [ ] YouTube Data API v3
- [ ] Facebook Graph API
- [ ] Instagram Graph API
- [ ] Telegram Bot API
- [ ] X (Twitter) API v2
- [ ] WhatsApp Business API
