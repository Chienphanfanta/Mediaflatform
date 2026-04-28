// Layout riêng cho trang auth (login, register, forgot-password).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-muted/40 via-background to-muted p-4 sm:p-6">
      {children}
    </div>
  );
}
