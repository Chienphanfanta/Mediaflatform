// MinIO / S3-compatible storage cho media bài đăng.
//
// File KHÔNG đi qua Next.js server: web cấp presigned PUT URL → trình duyệt upload
// thẳng lên MinIO; extension tải về bằng presigned GET URL.
// Presigned URL ký bằng S3_PUBLIC_ENDPOINT (host mà trình duyệt nhân viên truy cập được).
import 'server-only';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const UPLOAD_URL_TTL_SEC = 15 * 60; // 15 phút để upload xong (video lớn)
const DOWNLOAD_URL_TTL_SEC = 60 * 60; // 1 giờ cho extension tải file

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env: ${name} (cấu hình MinIO trong .env)`);
  return v;
}

function makeClient(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: env('S3_REGION', 'us-east-1'),
    forcePathStyle: true, // MinIO dùng path-style: http://host:9000/bucket/key
    credentials: {
      accessKeyId: env('S3_ACCESS_KEY'),
      secretAccessKey: env('S3_SECRET_KEY'),
    },
  });
}

let internalClient: S3Client | null = null;
let publicClient: S3Client | null = null;

/** Client gọi từ server (HEAD/DELETE) — endpoint nội bộ. */
function internal(): S3Client {
  internalClient ??= makeClient(env('S3_ENDPOINT'));
  return internalClient;
}

/** Client chỉ dùng để KÝ URL cho trình duyệt — endpoint public. */
function signer(): S3Client {
  publicClient ??= makeClient(env('S3_PUBLIC_ENDPOINT', process.env.S3_ENDPOINT));
  return publicClient;
}

export function bucket(): string {
  return env('S3_BUCKET', 'post-media');
}

export async function presignUpload(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    signer(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn: UPLOAD_URL_TTL_SEC },
  );
}

export async function presignDownload(key: string, fileName?: string): Promise<string> {
  return getSignedUrl(
    signer(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ...(fileName
        ? { ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}` }
        : {}),
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SEC },
  );
}

/** Trả size (bytes) nếu object tồn tại, null nếu chưa upload. */
export async function headObject(key: string): Promise<number | null> {
  try {
    const res = await internal().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return res.ContentLength ?? 0;
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw e;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await internal().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/** Key an toàn: {tenantId}/{yyyy}/{mm}/{assetId}-{tên-file-đã-làm-sạch} */
export function buildObjectKey(tenantId: string, assetId: string, fileName: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safe =
    fileName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(-80) || 'file';
  return `${tenantId}/${yyyy}/${mm}/${assetId}-${safe}`;
}
