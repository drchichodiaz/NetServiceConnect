'use client';
import { useState } from 'react';
import { ChevronDown, UserPlus, StickyNote, CheckCircle, Clock, XCircle, PanelRight } from 'lucide-react';
import { Conversation } from '@/types';
import { useInboxStore } from '@/store/inbox.store';
import { usersApi } from '@/lib/api';
import toast from 'react-hot-toast';
import InternalNoteModal from './InternalNoteModal';
import NetServicePanel from './NetServicePanel';
import clsx from 'clsx';

interface Props {
  conversation: Conversation;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

const STATUS_OPTIONS = [
  { value: 'OPEN',    label: 'Abierto',   icon: CheckCircle, color: '#25D366', bg: '#E8FBF0' },
  { value: 'PENDING', label: 'Pendiente', icon: Clock,       color: '#F59E0B', bg: '#FFFBEB' },
  { value: 'CLOSED',  label: 'Cerrado',   icon: XCircle,     color: '#9CA3AF', bg: '#F3F4F6' },
];

export default function ConversationHeader({ conversation, sidebarOpen, onToggleSidebar }: Props) {
  const { updateConversation } = useInboxStore();
  const [showNoteModal,   setShowNoteModal]   = useState(false);
  const [showStatusMenu,  setShowStatusMenu]  = useState(false);
  const [showAssignMenu,  setShowAssignMenu]  = useState(false);
  const [users,           setUsers]           = useState<any[]>([]);

  const current = STATUS_OPTIONS.find((s) => s.value === conversation.status) ?? STATUS_OPTIONS[0];
  const { contact } = conversation;
  const displayName = contact.name || contact.phone;

  async function handleStatusChange(status: string) {
    setShowStatusMenu(false);
    try {
      await updateConversation(conversation.id, { status });
    } catch {
      toast.error('Error al cambiar estado');
    }
  }

  async function openAssignMenu() {
    if (users.length === 0) {
      const data = await usersApi.list();
      setUsers(data);
    }
    setShowAssignMenu(true);
  }

  async function handleAssign(userId: string | null) {
    setShowAssignMenu(false);
    try {
      await updateConversation(conversation.id, { assignedUserId: userId });
      toast.success(userId ? 'Agente asignado' : 'Sin asignar');
    } catch {
      toast.error('Error al asignar');
    }
  }

  return (
    <>
      <div
        className="bg-white flex items-center gap-3 px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {/* Contact avatar + info */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
          style={{ background: '#E8FBF0', color: '#128C7E' }}
        >
          {displayName[0]?.toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink text-sm leading-tight truncate">{displayName}</p>
          <p className="text-xs text-ink-subtle">{contact.phone}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">

          {/* Status picker */}
          <div className="relative">
            <button
              onClick={() => { setShowStatusMenu(!showStatusMenu); setShowAssignMenu(false); }}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-all duration-150 hover:bg-surface-muted"
              style={{ borderColor: current.color + '40', color: current.color, background: current.bg }}
            >
              <current.icon className="w-3 h-3" />
              <span className="hidden sm:inline">{current.label}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>

            {showStatusMenu && (
              <div
                className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-float z-20 overflow-hidden animate-pop"
                style={{ border: '1px solid var(--border)', minWidth: '140px' }}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleStatusChange(opt.value)}
                    className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-sm hover:bg-surface-muted transition-colors text-left"
                  >
                    <opt.icon className="w-3.5 h-3.5" style={{ color: opt.color }} />
                    <span className="text-ink">{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Assign agent */}
          <div className="relative">
            <button
              onClick={() => { openAssignMenu(); setShowStatusMenu(false); }}
              className="btn-ghost w-8 h-8 p-0 relative"
              title="Asignar agente"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {conversation.assignedUser && (
                <span
                  className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-white"
                  style={{ background: '#25D366' }}
                />
              )}
            </button>

            {showAssignMenu && (
              <div
                className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-float z-20 overflow-hidden animate-pop"
                style={{ border: '1px solid var(--border)', minWidth: '180px', maxHeight: '220px', overflowY: 'auto' }}
              >
                <button
                  onClick={() => handleAssign(null)}
                  className="w-full px-3.5 py-2.5 text-sm text-ink-muted hover:bg-surface-muted transition-colors text-left border-b border-border"
                >
                  Sin asignar
                </button>
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleAssign(u.id)}
                    className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-sm hover:bg-surface-muted transition-colors text-left"
                  >
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{ background: '#E8FBF0', color: '#128C7E' }}
                    >
                      {u.name[0]}
                    </span>
                    <span className="text-ink truncate">{u.name}</span>
                    {u.id === conversation.assignedUserId && (
                      <CheckCircle className="w-3 h-3 ml-auto shrink-0" style={{ color: '#25D366' }} />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Internal note */}
          <button
            onClick={() => setShowNoteModal(true)}
            className="btn-ghost w-8 h-8 p-0"
            title="Nota interna"
          >
            <StickyNote className="w-3.5 h-3.5" />
          </button>

          {/* NetService integration actions */}
          <NetServicePanel conversation={conversation} />

          {/* Contact sidebar toggle */}
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className={clsx('btn-ghost w-8 h-8 p-0', sidebarOpen && 'bg-surface-muted')}
              title="Panel de contacto"
              style={sidebarOpen ? { color: '#25D366' } : undefined}
            >
              <PanelRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Click outside to close menus */}
      {(showStatusMenu || showAssignMenu) && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => { setShowStatusMenu(false); setShowAssignMenu(false); }}
        />
      )}

      {showNoteModal && (
        <InternalNoteModal conversationId={conversation.id} onClose={() => setShowNoteModal(false)} />
      )}
    </>
  );
}
