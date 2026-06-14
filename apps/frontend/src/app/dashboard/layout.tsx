'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import Sidebar from '@/components/layout/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, user, hydrate } = useAuthStore();

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    if (!token && typeof window !== 'undefined') {
      if (!localStorage.getItem('access_token')) router.replace('/login');
    }
  }, [token, router]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
      <Sidebar user={user} />
      <main className="flex-1 overflow-y-auto scrollbar-thin">
        {children}
      </main>
    </div>
  );
}
