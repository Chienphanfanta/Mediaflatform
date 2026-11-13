'use client';

// /posts/new — soạn bài mới.
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { PostComposer } from '@/components/posts/post-composer';

export default function NewPostPage() {
  return (
    <div className="space-y-4">
      <header>
        <Link
          href="/posts"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Danh sách bài
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Soạn bài</h1>
      </header>
      <PostComposer />
    </div>
  );
}
