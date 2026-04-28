import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LoginForm } from './login-form';

export const metadata = {
  title: 'Đăng nhập — Media Ops Platform',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string };
}) {
  const session = await auth();
  if (session) redirect(searchParams.callbackUrl ?? '/dashboard');

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary text-xl font-bold">
          M
        </div>
        <div>
          <CardTitle className="text-2xl">Media Ops Platform</CardTitle>
          <CardDescription className="mt-2">
            Đăng nhập để quản lý nhân sự và kênh truyền thông
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}
