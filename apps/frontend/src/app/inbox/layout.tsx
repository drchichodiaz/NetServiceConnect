'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import Sidebar from '@/components/layout/Sidebar';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';

function RealtimeProvider() {
  useRealtimeEvents();
  return null;
}

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, user, hydrate } = useAuthStore();

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    if (token === null && typeof window !== 'undefined') {
      if (!localStorage.getItem('access_token')) router.replace('/login');
    }
  }, [token, router]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <Sidebar user={user} />
      <main className="flex-1 overflow-hidden">{children}</main>
      <RealtimeProvider />
    </div>
  );
}
