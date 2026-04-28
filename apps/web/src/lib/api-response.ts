// Response helpers — thống nhất format { success, data, error, meta } theo CLAUDE.md §8
import { NextResponse } from 'next/server';

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ApiSuccess<T> = {
  success: true;
  data: T;
  meta?: { pagination?: Pagination; [k: string]: unknown };
};

export type ApiError = {
  success: false;
  error: { code: string; message: string; details?: unknown };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function ok<T>(
  data: T,
  init?: { status?: number; meta?: ApiSuccess<T>['meta'] },
): NextResponse<ApiSuccess<T>> {
  return NextResponse.json<ApiSuccess<T>>(
    { success: true, data, ...(init?.meta ? { meta: init.meta } : {}) },
    { status: init?.status ?? 200 },
  );
}

export function fail(
  code: string,
  message: string,
  opts?: { status?: number; details?: unknown },
): NextResponse<ApiError> {
  return NextResponse.json<ApiError>(
    {
      success: false,
      error: { code, message, ...(opts?.details !== undefined ? { details: opts.details } : {}) },
    },
    { status: opts?.status ?? 400 },
  );
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}
