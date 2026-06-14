'use client';
import { useEffect, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';

const Picker = dynamic(() => import('emoji-picker-react'), { ssr: false });

interface Props {
  onEmojiSelect: (emoji: string) => void;
  dropUp?: boolean;
}

export default function EmojiPickerButton({ onEmojiSelect, dropUp = true }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-ink-muted',
          open
            ? 'bg-amber-50 text-amber-500'
            : 'hover:bg-surface-muted hover:text-amber-500',
        )}
        title="Emojis"
      >
        <Smile className="w-4 h-4" />
      </button>

      {open && (
        <div
          className={clsx(
            'absolute z-50',
            dropUp ? 'bottom-full mb-2' : 'top-full mt-2',
            'right-0',
          )}
        >
          <Picker
            onEmojiClick={(e) => {
              onEmojiSelect(e.emoji);
              setOpen(false);
            }}
            skinTonesDisabled
            searchPlaceholder="Buscar emoji..."
            height={360}
            width={300}
            previewConfig={{ showPreview: false }}
          />
        </div>
      )}
    </div>
  );
}
