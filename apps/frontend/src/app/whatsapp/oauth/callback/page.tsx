'use client';
import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

function CallbackInner() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const code  = searchParams.get('code');
    const error = searchParams.get('error');

    if (window.opener) {
      window.opener.postMessage(
        { type: 'WA_OAUTH_CODE', code: code ?? null, error: error ?? null },
        window.location.origin,
      );
      window.close();
    } else {
      window.location.href = '/settings/whatsapp';
    }
  }, [searchParams]);

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-3 text-gray-500">
      <Loader2 className="w-6 h-6 animate-spin text-green-500" />
      <p className="text-sm">Completando la conexión con Meta...</p>
    </div>
  );
}

export default function WhatsAppOAuthCallback() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center h-screen gap-3 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin text-green-500" />
          <p className="text-sm">Cargando...</p>
        </div>
      }
    >
      <CallbackInner />
    </Suspense>
  );
}
