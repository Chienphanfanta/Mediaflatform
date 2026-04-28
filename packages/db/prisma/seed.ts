/**
 * Media Ops Platform — seed dữ liệu mẫu
 * Chạy: npm run seed   (từ packages/db hoặc root với workspace filter)
 *
 * Seed idempotent: xoá sạch data trước khi chèn lại → chạy lại bao nhiêu lần cũng OK.
 * KHÔNG chạy trong production.
 */

import {
  PrismaClient,
  Prisma,
  GroupType,
  MemberRole,
  PermissionAction,
  Platform,
  ChannelStatus,
  AlertType,
  AlertSeverity,
  UserStatus,
} from '@prisma/client';
import { fakerVI as faker } from '@faker-js/faker';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Faker deterministic (chạy ra cùng data mỗi lần — dễ test)
faker.seed(42);

const BCRYPT_ROUNDS = 10;
const DEFAULT_PASSWORD = 'User123!';
const SUPERADMIN_EMAIL = 'admin@company.com';
const SUPERADMIN_PASSWORD = 'Admin123!';

// =============================================================================
// RBAC — ma trận quyền mặc định (đơn giản hoá từ §5 CLAUDE.md)
// =============================================================================

const RESOURCES = [
  'user',
  'group',
  'channel',
  'post',
  'task',
  'analytics',
  'media',
  'report',
  'setting',
] as const;

// Role → permissions nó có (theo dạng `${resource}:${action}`)
// FULL = tất cả CRUD + các action khác trên resource đó.
const ROLE_MATRIX: Record<MemberRole, Array<`${(typeof RESOURCES)[number]}:${PermissionAction}`>> = {
  ADMIN: RESOURCES.map((r) => `${r}:FULL` as const),

  MANAGER: [
    // Channel & Post & Task: CRUD đầy đủ
    'channel:CREATE', 'channel:READ', 'channel:UPDATE', 'channel:DELETE',
    'post:CREATE', 'post:READ', 'post:UPDATE', 'post:DELETE',
    'task:CREATE', 'task:READ', 'task:UPDATE', 'task:DELETE',
    // Media: CRUD
    'media:CREATE', 'media:READ', 'media:UPDATE', 'media:DELETE',
    // Analytics & Report: chỉ đọc
    'analytics:READ',
    'report:READ',
    // User/Group: chỉ đọc (quản lý nhân sự là việc của ADMIN)
    'user:READ',
    'group:READ',
  ],

  STAFF: [
    'post:CREATE', 'post:READ', 'post:UPDATE',
    'task:READ', 'task:UPDATE',
    'media:CREATE', 'media:READ',
    'channel:READ',
    'analytics:READ',
    'user:READ',
    'group:READ',
  ],

  VIEWER: [
    'post:READ',
    'task:READ',
    'channel:READ',
    'analytics:READ',
    'report:READ',
    'media:READ',
    'user:READ',
    'group:READ',
  ],
};

// =============================================================================
// HELPERS
// =============================================================================

async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function hoursFromNow(n: number): Date {
  return new Date(Date.now() + n * 60 * 60 * 1000);
}

// =============================================================================
// CLEANUP
// =============================================================================

async function cleanup() {
  console.log('🧹 Xoá dữ liệu cũ...');
  // Thứ tự: con trước, cha sau (tránh vi phạm FK)
  await prisma.alert.deleteMany();
  await prisma.analytics.deleteMany();
  // V1-REMOVED: task/post/mediaLibrary entities bỏ V2.
  await prisma.channelGroup.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();
}

// =============================================================================
// 1. PERMISSIONS + ROLE_PERMISSIONS
// =============================================================================

async function seedPermissions() {
  console.log('🔐 Seed permissions + role permissions...');

  // Tạo đủ FULL + CRUD cho mọi resource
  const rows: Array<{ resource: string; action: PermissionAction; description: string }> = [];
  for (const resource of RESOURCES) {
    for (const action of Object.values(PermissionAction)) {
      rows.push({
        resource,
        action: action as PermissionAction,
        description: `${action} ${resource}`,
      });
    }
  }

  await prisma.permission.createMany({ data: rows, skipDuplicates: true });

  const all = await prisma.permission.findMany();
  const byKey = new Map(all.map((p) => [`${p.resource}:${p.action}`, p.id]));

  // Map role → permissions
  const rpRows: Array<{ roleId: MemberRole; permissionId: string }> = [];
  for (const [role, keys] of Object.entries(ROLE_MATRIX) as [MemberRole, string[]][]) {
    for (const key of keys) {
      const pid = byKey.get(key);
      if (!pid) throw new Error(`Permission không tồn tại: ${key}`);
      rpRows.push({ roleId: role, permissionId: pid });
    }
  }

  await prisma.rolePermission.createMany({ data: rpRows, skipDuplicates: true });

  return { permissionsCount: all.length, rolePermsCount: rpRows.length };
}

// =============================================================================
// 2. GROUPS
// =============================================================================

async function seedGroups() {
  console.log('🏢 Seed groups...');

  const systemGroup = await prisma.group.create({
    data: {
      name: 'System',
      type: GroupType.SYSTEM,
      description: 'Nhóm hệ thống — SuperAdmin nằm ở đây',
    },
  });

  const hrGroup = await prisma.group.create({
    data: {
      name: 'HR Group',
      type: GroupType.HR,
      description: 'Nhóm nhân sự — tuyển dụng, onboarding, quản lý user',
    },
  });

  const contentGroup = await prisma.group.create({
    data: {
      name: 'Content Group',
      type: GroupType.CONTENT,
      description: 'Nhóm sản xuất nội dung trên tất cả kênh truyền thông',
    },
  });

  const analyticsGroup = await prisma.group.create({
    data: {
      name: 'Analytics Group',
      type: GroupType.ANALYTICS,
      description: 'Nhóm phân tích số liệu, báo cáo hiệu quả kênh',
    },
  });

  return { systemGroup, hrGroup, contentGroup, analyticsGroup };
}

// =============================================================================
// 3. USERS + GROUP MEMBERS
// =============================================================================

async function seedUsers(groups: Awaited<ReturnType<typeof seedGroups>>) {
  console.log('👥 Seed users...');

  const superAdminPass = await hash(SUPERADMIN_PASSWORD);
  const userPass = await hash(DEFAULT_PASSWORD);

  // --- SuperAdmin ---
  const superAdmin = await prisma.user.create({
    data: {
      email: SUPERADMIN_EMAIL,
      password: superAdminPass,
      name: 'Super Admin',
      avatar: faker.image.avatar(),
      status: UserStatus.ACTIVE,
      groupMembers: {
        create: { groupId: groups.systemGroup.id, role: MemberRole.ADMIN },
      },
    },
  });

  // --- 5 regular users ---
  const hrAdmin = await prisma.user.create({
    data: {
      email: 'hr.admin@company.com',
      password: userPass,
      name: faker.person.fullName({ sex: 'female' }),
      avatar: faker.image.avatar(),
      status: UserStatus.ACTIVE,
      groupMembers: {
        create: { groupId: groups.hrGroup.id, role: MemberRole.ADMIN },
      },
    },
  });

  const contentManager = await prisma.user.create({
    data: {
      email: 'content.manager@company.com',
      password: userPass,
      name: faker.person.fullName({ sex: 'male' }),
      avatar: faker.image.avatar(),
      status: UserStatus.ACTIVE,
      groupMembers: {
        create: { groupId: groups.contentGroup.id, role: MemberRole.MANAGER },
      },
    },
  });

  const contentStaff1 = await prisma.user.create({
    data: {
      email: 'content.staff1@company.com',
      password: userPass,
      name: faker.person.fullName(),
      avatar: faker.image.avatar(),
      status: UserStatus.ACTIVE,
      groupMembers: {
        create: { groupId: groups.contentGroup.id, role: MemberRole.STAFF },
      },
    },
  });

  const contentStaff2 = await prisma.user.create({
    data: {
      email: 'content.staff2@company.com',
      password: userPass,
      name: faker.person.fullName(),
      avatar: faker.image.avatar(),
      status: UserStatus.ACTIVE,
      groupMembers: {
        create: { groupId: groups.contentGroup.id, role: MemberRole.STAFF },
      },
    },
  });

  const analyst = await prisma.user.create({
    data: {
      email: 'analyst@company.com',
      password: userPass,
      name: faker.person.fullName(),
      avatar: faker.image.avatar(),
      status: UserStatus.ACTIVE,
      groupMembers: {
        create: { groupId: groups.analyticsGroup.id, role: MemberRole.VIEWER },
      },
    },
  });

  return { superAdmin, hrAdmin, contentManager, contentStaff1, contentStaff2, analyst };
}

// =============================================================================
// 4. CHANNELS + CHANNEL_GROUPS
// =============================================================================

async function seedChannels(
  users: Awaited<ReturnType<typeof seedUsers>>,
  groups: Awaited<ReturnType<typeof seedGroups>>,
) {
  console.log('📺 Seed channels...');

  const owner = users.contentManager.id;

  // --- YouTube ---
  const youtube = await prisma.channel.create({
    data: {
      name: 'Company Official YouTube',
      platform: Platform.YOUTUBE,
      accountId: 'UC' + faker.string.alphanumeric(22),
      // LƯU Ý: trong production token PHẢI mã hoá AES-256-GCM trước khi ghi.
      // Ở seed chỉ là dummy — tuyệt đối không copy pattern này vào code thật.
      accessToken: 'SEED_DUMMY_NOT_ENCRYPTED',
      refreshToken: 'SEED_DUMMY_NOT_ENCRYPTED',
      tokenExpiresAt: hoursFromNow(24 * 30),
      status: ChannelStatus.ACTIVE,
      ownerId: owner,
      metadata: {
        channelId: faker.string.alphanumeric(24),
        channelHandle: '@companyofficial',
        subscriberCount: faker.number.int({ min: 10_000, max: 500_000 }),
        viewCount: faker.number.int({ min: 1_000_000, max: 50_000_000 }),
        country: 'VN',
        defaultLanguage: 'vi',
        madeForKids: false,
        monetizationEnabled: true,
      },
      groups: { create: { groupId: groups.contentGroup.id } },
    },
  });

  // --- Facebook ---
  const facebook = await prisma.channel.create({
    data: {
      name: 'Company Facebook Page',
      platform: Platform.FACEBOOK,
      accountId: faker.string.numeric(15),
      accessToken: 'SEED_DUMMY_NOT_ENCRYPTED',
      tokenExpiresAt: hoursFromNow(24 * 60),
      status: ChannelStatus.ACTIVE,
      ownerId: owner,
      metadata: {
        pageId: faker.string.numeric(15),
        pageName: 'Company Official',
        category: 'Media/News Company',
        fanCount: faker.number.int({ min: 50_000, max: 1_000_000 }),
        verificationStatus: 'blue_verified',
      },
      groups: { create: { groupId: groups.contentGroup.id } },
    },
  });

  // --- Instagram ---
  const instagram = await prisma.channel.create({
    data: {
      name: 'Company Instagram',
      platform: Platform.INSTAGRAM,
      accountId: faker.string.numeric(17),
      accessToken: 'SEED_DUMMY_NOT_ENCRYPTED',
      tokenExpiresAt: hoursFromNow(24 * 60),
      status: ChannelStatus.ACTIVE,
      ownerId: owner,
      metadata: {
        igUserId: faker.string.numeric(17),
        username: 'companyofficial',
        linkedFacebookPageId: facebook.accountId,
        accountType: 'BUSINESS',
        followersCount: faker.number.int({ min: 20_000, max: 500_000 }),
        followsCount: faker.number.int({ min: 100, max: 1_000 }),
        mediaCount: faker.number.int({ min: 100, max: 5_000 }),
      },
      groups: { create: { groupId: groups.contentGroup.id } },
    },
  });

  return { youtube, facebook, instagram };
}

// V2 stripped: seedPosts + seedTasks (Post + Task entities bỏ).

// =============================================================================
// 5. ANALYTICS (30 ngày cho mỗi channel)
// =============================================================================

async function seedAnalytics(channels: Awaited<ReturnType<typeof seedChannels>>) {
  console.log('📊 Seed analytics (30 ngày × 3 kênh)...');

  const rows: Prisma.AnalyticsCreateManyInput[] = [];

  const channelList = [
    { ch: channels.youtube, baseViews: 50_000, baseSubs: 200_000, baseRev: 50 },
    { ch: channels.facebook, baseViews: 30_000, baseSubs: 150_000, baseRev: 20 },
    { ch: channels.instagram, baseViews: 20_000, baseSubs: 80_000, baseRev: 10 },
  ];

  for (const { ch, baseViews, baseSubs, baseRev } of channelList) {
    let runningSubs = baseSubs;
    for (let d = 29; d >= 0; d--) {
      const date = daysAgo(d);
      const delta = faker.number.int({ min: -50, max: 300 });
      runningSubs += delta;

      rows.push({
        channelId: ch.id,
        date,
        platform: ch.platform,
        views: faker.number.int({ min: baseViews * 0.5, max: baseViews * 1.8 }),
        watchTimeHours:
          ch.platform === Platform.YOUTUBE
            ? faker.number.float({ min: 100, max: 2000, fractionDigits: 2 })
            : 0,
        subscribers: runningSubs,
        subscriberDelta: delta,
        revenue: faker.number.float({ min: baseRev * 0.3, max: baseRev * 2, fractionDigits: 2 }),
        engagementRate: faker.number.float({ min: 0.8, max: 8.5, fractionDigits: 2 }),
        impressions: faker.number.int({ min: baseViews * 2, max: baseViews * 6 }),
        clicks: faker.number.int({ min: 500, max: 5_000 }),
        fetchedAt: new Date(),
      });
    }
  }

  // createMany nhanh hơn create từng bản
  await prisma.analytics.createMany({ data: rows });
  return rows.length;
}

// =============================================================================
// 8. ALERTS (vài cảnh báo mẫu)
// =============================================================================

async function seedAlerts(channels: Awaited<ReturnType<typeof seedChannels>>) {
  console.log('🚨 Seed alerts...');

  await prisma.alert.createMany({
    data: [
      {
        channelId: channels.youtube.id,
        type: AlertType.VIEW_DROP,
        severity: AlertSeverity.MEDIUM,
        message: 'Views giảm 35% so với 7 ngày trước',
        isRead: false,
        metadata: { dropPercent: 35, comparedDays: 7 },
      },
      {
        channelId: channels.facebook.id,
        type: AlertType.TOKEN_EXPIRING,
        severity: AlertSeverity.MEDIUM,
        message: 'Access token sẽ hết hạn trong 5 ngày',
        isRead: false,
        metadata: { daysRemaining: 5 },
      },
      {
        channelId: channels.instagram.id,
        type: AlertType.API_ERROR,
        severity: AlertSeverity.CRITICAL,
        message: 'Rate limit exceeded khi gọi Graph API',
        isRead: true,
        readAt: daysAgo(1),
        metadata: { errorCode: 17, retryAfter: 3600 },
      },
    ],
  });
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('🌱 Bắt đầu seed Media Ops Platform...\n');

  await cleanup();
  const permResult = await seedPermissions();
  const groups = await seedGroups();
  const users = await seedUsers(groups);
  const channels = await seedChannels(users, groups);
  // V2 stripped: seedPosts + seedTasks (Post + Task entities bỏ).
  const analyticsCount = await seedAnalytics(channels);
  await seedAlerts(channels);

  console.log('\n✅ Seed hoàn tất!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Permissions           : ${permResult.permissionsCount}`);
  console.log(`  Role-permission rows  : ${permResult.rolePermsCount}`);
  console.log(`  Groups                : 4 (SYSTEM + HR + Content + Analytics)`);
  console.log(`  Users                 : 6 (1 SuperAdmin + 5 regular)`);
  console.log(`  Channels              : 3 (YouTube + Facebook + Instagram)`);
  console.log(`  Posts                 : 5 (DRAFT, SCHEDULED, PUBLISHED, REVIEWING, REJECTED)`);
  console.log(`  Tasks                 : 5`);
  console.log(`  Analytics rows        : ${analyticsCount}`);
  console.log(`  Alerts                : 3`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔑 Login:');
  console.log(`  SuperAdmin : ${SUPERADMIN_EMAIL} / ${SUPERADMIN_PASSWORD}`);
  console.log(`  Regular    : <role>@company.com / ${DEFAULT_PASSWORD}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((err) => {
    console.error('❌ Seed thất bại:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
