'use client';
import { useState } from 'react';
import { Search, RotateCcw, MessageSquare } from 'lucide-react';
import { useInboxStore } from '@/store/inbox.store';
import ConversationItem from './ConversationItem';
import clsx from 'clsx';

const STATUS_TABS = [
  { label: 'Abiertos',   value: 'OPEN',    dot: '#25D366' },
  { label: 'Pendientes', value: 'PENDING', dot: '#F59E0B' },
  { label: 'Cerrados',   value: 'CLOSED',  dot: '#9CA3AF' },
];

export default function ConversationList() {
  const {
    conversations, selectedConversationId, selectConversation,
    setFilter, filter, isLoadingConversations, loadConversations,
  } = useInboxStore();

  const [search, setSearch] = useState('');

  function handleStatusChange(status: string) {
    setFilter({ ...filter, status });
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setSearch(val);
    setFilter({ ...filter, search: val || undefined });
  }

  const activeTab = STATUS_TABS.find((t) => t.value === filter.status) ?? STATUS_TABS[0];

  return (
    <div
      className="w-[300px] shrink-0 flex flex-col h-full bg-white"
      style={{ borderRight: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-ink-muted" />
            <h1 className="font-semibold text-ink text-sm tracking-tight">Conversaciones</h1>
          </div>
          <button
            onClick={loadConversations}
            className="btn-ghost w-7 h-7 p-0"
            title="Actualizar"
          >
            <RotateCcw className={clsx('w-3.5 h-3.5', isLoadingConversations && 'animate-spin')} />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-subtle pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar contacto..."
            value={search}
            onChange={handleSearch}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface-muted
                       text-ink placeholder-ink-subtle
                       focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/10
                       transition-all duration-150"
          />
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex px-4 mb-1" style={{ borderBottom: '1px solid var(--border)' }}>
        {STATUS_TABS.map((tab) => {
          const isActive = filter.status === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => handleStatusChange(tab.value)}
              className={clsx(
                'flex items-center gap-1.5 pb-2.5 pt-1 px-1 mr-4 text-xs font-medium transition-all duration-150 relative',
                isActive ? 'text-ink' : 'text-ink-subtle hover:text-ink-muted',
              )}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: isActive ? tab.dot : '#D1D5DB' }}
              />
              {tab.label}
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                  style={{ background: '#25D366' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoadingConversations ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <RotateCcw className="w-4 h-4 text-ink-subtle animate-spin" />
            <p className="text-xs text-ink-subtle">Cargando...</p>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 px-6 text-center">
            <MessageSquare className="w-8 h-8 text-ink-ghost" />
            <p className="text-xs text-ink-subtle">
              {search ? 'Sin resultados para tu búsqueda' : `Sin conversaciones ${activeTab.label.toLowerCase()}`}
            </p>
          </div>
        ) : (
          <div>
            {conversations.map((conv, i) => (
              <div key={conv.id} className="animate-fade-in" style={{ animationDelay: `${i * 30}ms` }}>
                <ConversationItem
                  conversation={conv}
                  isSelected={conv.id === selectedConversationId}
                  onClick={() => selectConversation(conv.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
