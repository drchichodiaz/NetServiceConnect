'use client';
import { useEffect } from 'react';
import { useInboxStore } from '@/store/inbox.store';
import ConversationList from '@/components/inbox/ConversationList';
import MessagePanel from '@/components/inbox/MessagePanel';
import EmptyState from '@/components/inbox/EmptyState';

export default function InboxPage() {
  const { loadConversations, selectedConversationId } = useInboxStore();

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

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
