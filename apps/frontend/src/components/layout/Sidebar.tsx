'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MessageSquare, Users, Tag, Settings, LogOut, LayoutDashboard, Zap, Sparkles, BookUser, ShieldCheck, Building2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { User } from '@/types';
import clsx from 'clsx';

interface Props { user: User | null; }

const navItems = [
  { href: '/dashboard',          icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/inbox',              icon: MessageSquare,   label: 'Conversaciones' },
  { href: '/contacts',           icon: BookUser,        label: 'Contactos' },
  { href: '/settings/team',      icon: Users,           label: 'Equipo' },
  { href: '/settings/tags',      icon: Tag,             label: 'Etiquetas' },
  { href: '/settings/quick-replies', icon: Zap,       label: 'Respuestas rápidas' },
  { href: '/settings/ai',            icon: Sparkles,  label: 'Configuración IA', roles: ['ADMIN', 'SUPERVISOR'] },
  { href: '/settings/whatsapp',      icon: Settings,     label: 'WhatsApp',      roles: ['ADMIN', 'SUPERVISOR'] },
  { href: '/settings/system',        icon: ShieldCheck,  label: 'Sistema',       superAdminOnly: true },
  { href: '/settings/tenants',       icon: Building2,    label: 'Empresas',      superAdminOnly: true },
];

export default function Sidebar({ user }: Props) {
  const pathname = usePathname();
  const router   = useRouter();
  const logout   = useAuthStore((s) => s.logout);
  const visibleItems = navItems.filter((item) => {
    if (item.superAdminOnly) return !!user?.isSuperAdmin;
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

  return (
    <aside
      className="w-[60px] shrink-0 flex flex-col items-center py-4 gap-1"
      style={{
        background:   'var(--sidebar-bg)',
        borderRight:  '1px solid var(--sidebar-border)',
      }}
    >
      {/* Logo */}
      <div className="mb-5 mt-1">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: '#25D366' }}
        >
          <MessageSquare className="w-4 h-4 text-white" />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1 w-full px-2">
        {visibleItems.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <div key={href} className="relative group">
              <Link
                href={href}
                className={clsx(
                  'flex items-center justify-center w-full h-9 rounded-lg transition-all duration-150',
                  active
                    ? 'text-white'
                    : 'text-gray-500 hover:text-gray-300',
                )}
                style={active ? { background: 'var(--sidebar-active)' } : {}}
                onMouseEnter={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-hover)';
                }}
                onMouseLeave={(e) => {
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

              {/* Tooltip */}
              <div
                className="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50
                           bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg
                           whitespace-nowrap pointer-events-none
                           opacity-0 group-hover:opacity-100 translate-x-[-4px] group-hover:translate-x-0
                           transition-all duration-150 shadow-float"
                style={{ border: '1px solid #21262D' }}
              >
                {label}
                <span
                  className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent"
                  style={{ borderRightColor: '#111827' }}
                />
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="flex flex-col items-center gap-2 w-full px-2">
        {/* Logout */}
        <div className="relative group">
          <button
            onClick={handleLogout}
            className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:text-gray-300 transition-all duration-150"
            style={{}}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-hover)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
          >
            <LogOut className="w-4 h-4" />
          </button>
          <div
            className="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50
                       bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg
                       whitespace-nowrap pointer-events-none
                       opacity-0 group-hover:opacity-100 transition-all duration-150 shadow-float"
            style={{ border: '1px solid #21262D' }}
          >
            Cerrar sesión
          </div>
        </div>

        {/* Avatar */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ background: '#25D366' }}
          title={user?.name}
        >
          {initials}
        </div>
      </div>
    </aside>
  );
}
