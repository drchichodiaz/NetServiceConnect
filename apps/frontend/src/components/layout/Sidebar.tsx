'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MessageSquare, Users, Settings, LogOut, LayoutDashboard, Zap, Sparkles, BookUser, ShieldCheck, Building2, FileText, Bot, UserCircle, Megaphone, LifeBuoy, Handshake, Coins, CalendarDays, Stethoscope, History } from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useAgendaSettings } from '@/hooks/useAgendaSettings';
import SupportModal from '@/components/support/SupportModal';
import { User } from '@/types';
import clsx from 'clsx';

interface Props { user: User | null; }

const navItems = [
  { href: '/dashboard',          icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/inbox',              icon: MessageSquare,   label: 'Conversaciones' },
  { href: '/activity',           icon: History,         label: 'Actividad' },
  { href: '/contacts',           icon: BookUser,        label: 'Contactos' },
  // Solo en las empresas con la agenda activada (se vende aparte).
  { href: '/agenda',             icon: CalendarDays,    label: 'Agenda', requiresAgenda: true },
  { href: '/settings/team',      icon: Users,           label: 'Equipo' },
  { href: '/settings/quick-replies', icon: Zap,       label: 'Respuestas rápidas' },
  // El saldo de IA de la propia empresa. El super admin no lo ve: para eso tiene el
  // panel de la plataforma, y dos entradas que dicen "IA" en el mismo menu confunden.
  { href: '/settings/ai',            icon: Sparkles,  label: 'Créditos de IA', roles: ['ADMIN', 'SUPERVISOR'], hideForSuperAdmin: true },
  { href: '/settings/whatsapp',      icon: Settings,     label: 'WhatsApp',      roles: ['ADMIN', 'SUPERVISOR'] },
  { href: '/settings/templates',     icon: FileText,     label: 'Plantillas',    roles: ['ADMIN', 'SUPERVISOR'] },
  { href: '/campaigns',              icon: Megaphone,    label: 'Campañas',      roles: ['ADMIN', 'SUPERVISOR'] },
  { href: '/settings/bot',           icon: Bot,          label: 'Bots de WhatsApp', roles: ['ADMIN', 'SUPERVISOR'] },
  { href: '/settings/agenda',        icon: Stethoscope,  label: 'Doctores y turnos', roles: ['ADMIN', 'SUPERVISOR'], requiresAgenda: true },
  { href: '/settings/system',        icon: ShieldCheck,  label: 'Sistema',       superAdminOnly: true },
  { href: '/settings/tenants',       icon: Building2,    label: 'Empresas',      superAdminOnly: true },
  { href: '/settings/partners',      icon: Handshake,    label: 'Partners',      superAdminOnly: true },
  { href: '/settings/ai-credits',    icon: Coins,        label: 'Créditos de IA', superAdminOnly: true },
];

export default function Sidebar({ user }: Props) {
  const pathname = usePathname();
  const router   = useRouter();
  const logout   = useAuthStore((s) => s.logout);
  // El boton de soporte vive aca y no en una pantalla: un error puede pasar en
  // cualquier lado, y si hay que ir a buscar el formulario, nadie lo reporta.
  const [showSupport, setShowSupport] = useState(false);
  const agenda = useAgendaSettings(!!user);
  const visibleItems = navItems.filter((item) => {
    if ((item as { requiresAgenda?: boolean }).requiresAgenda && !agenda?.enabled) return false;
    if (item.superAdminOnly) return !!user?.isSuperAdmin;
    if ((item as { hideForSuperAdmin?: boolean }).hideForSuperAdmin && user?.isSuperAdmin) return false;
    if (item.roles) return !!user?.role && (item.roles as string[]).includes(user.role);
    return true;
  });

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  // Un solo tooltip, con posicion fija, para todo el menu. Cada opcion tenia el suyo
  // colgando a la derecha, pero la lista ahora hace scroll y un contenedor con scroll
  // recorta todo lo que se sale de el, tooltips incluidos.
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  const showTip = (label: string) => (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);

  return (
    // h-full + min-h-0: sin alto propio el menu crecia con la cantidad de opciones y en
    // pantallas bajas lo de abajo (soporte, mi cuenta, salir) quedaba fuera de la
    // ventana sin forma de llegar. Ahora la lista del medio hace scroll y el pie queda
    // siempre a la vista. En pantallas bajas ademas se compacta, para que el scroll sea
    // la excepcion.
    <aside
      className="w-[60px] shrink-0 h-full min-h-0 flex flex-col items-center py-4 [@media(max-height:760px)]:py-2"
      style={{
        background:   'var(--sidebar-bg)',
        borderRight:  '1px solid var(--sidebar-border)',
      }}
    >
      {/* Logo */}
      <div className="mb-5 mt-1 shrink-0 [@media(max-height:760px)]:mb-2 [@media(max-height:760px)]:mt-0">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center [@media(max-height:760px)]:w-8 [@media(max-height:760px)]:h-8"
          style={{ background: '#25D366' }}
        >
          <MessageSquare className="w-4 h-4 text-white" />
        </div>
      </div>

      {/* Nav */}
      <nav
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-sidebar flex flex-col gap-1 [@media(max-height:760px)]:gap-0.5 w-full px-2"
        onScroll={hideTip}
      >
        {visibleItems.map(({ href, icon: Icon, label }) => {
          // Coincidencia por tramo completo, no por prefijo de texto: con startsWith,
          // "/settings/ai-credits" tambien marcaba activo a "/settings/ai" y se
          // encendian los dos. El "/" del final es lo que deja funcionar las subpaginas
          // (/inbox/123 marca /inbox) sin que un nombre mas largo pise a otro.
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <div key={href} className="relative shrink-0">
              <Link
                href={href}
                aria-label={label}
                className={clsx(
                  'flex items-center justify-center w-full h-9 [@media(max-height:760px)]:h-8 rounded-lg transition-all duration-150',
                  active
                    ? 'text-white'
                    : 'text-gray-500 hover:text-gray-300',
                )}
                style={active ? { background: 'var(--sidebar-active)' } : {}}
                onMouseEnter={(e) => {
                  showTip(label)(e);
                  if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-hover)';
                }}
                onMouseLeave={(e) => {
                  hideTip();
                  if (!active) (e.currentTarget as HTMLElement).style.background = '';
                }}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                    style={{ background: '#25D366' }}
                  />
                )}
                <Icon className="w-4 h-4" />
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Footer: nunca se achica, es lo que no puede quedar fuera de la pantalla */}
      <div
        className="shrink-0 flex flex-col items-center gap-2 [@media(max-height:760px)]:gap-1 w-full px-2 pt-2 mt-1"
        style={{ borderTop: '1px solid var(--sidebar-border)' }}
      >
        <FooterButton label="Reportar un problema" onClick={() => setShowSupport(true)} onTip={showTip} onHideTip={hideTip}>
          <LifeBuoy className="w-4 h-4" />
        </FooterButton>
        <FooterButton label="Mi cuenta" onClick={() => router.push('/settings/account')} onTip={showTip} onHideTip={hideTip}>
          <UserCircle className="w-4 h-4" />
        </FooterButton>
        <FooterButton label="Cerrar sesión" onClick={handleLogout} onTip={showTip} onHideTip={hideTip}>
          <LogOut className="w-4 h-4" />
        </FooterButton>

        {/* Avatar */}
        <div
          className="w-8 h-8 [@media(max-height:760px)]:w-7 [@media(max-height:760px)]:h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ background: '#25D366' }}
          title={user?.name}
        >
          {initials}
        </div>
      </div>

      {tip && (
        <div
          className="fixed left-[68px] -translate-y-1/2 z-50
                     bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg
                     whitespace-nowrap pointer-events-none shadow-float"
          style={{ top: tip.top, border: '1px solid #21262D' }}
        >
          {tip.label}
          <span
            className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent"
            style={{ borderRightColor: '#111827' }}
          />
        </div>
      )}

      {showSupport && <SupportModal onClose={() => setShowSupport(false)} />}
    </aside>
  );
}

function FooterButton({
  label, onClick, onTip, onHideTip, children,
}: {
  label: string;
  onClick: () => void;
  onTip: (label: string) => (e: React.MouseEvent<HTMLElement>) => void;
  onHideTip: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex items-center justify-center w-9 h-9 [@media(max-height:760px)]:h-8 rounded-lg text-gray-500 hover:text-gray-300 transition-all duration-150"
      onMouseEnter={(e) => { onTip(label)(e); (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-hover)'; }}
      onMouseLeave={(e) => { onHideTip(); (e.currentTarget as HTMLElement).style.background = ''; }}
    >
      {children}
    </button>
  );
}
