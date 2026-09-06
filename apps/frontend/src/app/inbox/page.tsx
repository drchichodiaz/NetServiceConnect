'use client';
import { useEffect } from 'react';
import { useInboxStore } from '@/store/inbox.store';
import ConversationList from '@/components/inbox/ConversationList';
import MessagePanel from '@/components/inbox/MessagePanel';
import EmptyState from '@/components/inbox/EmptyState';

export default function InboxPage() {
  const { loadConversations, loadAccounts, selectedConversationId } = useInboxStore();

  useEffect(() => {
    loadConversations();
    loadAccounts();
  }, [loadConversations, loadAccounts]);

  return (
    <div className="flex h-full">
      <ConversationList />
      {selectedConversationId ? (
        <MessagePanel conversationId={selectedConversationId} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}
