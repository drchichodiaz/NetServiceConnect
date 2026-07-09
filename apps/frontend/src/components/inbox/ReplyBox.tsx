'use client';
import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Sparkles, Loader2, Zap, Paperclip, X, FileText } from 'lucide-react';
import { whatsappApi, aiApi, quickRepliesApi } from '@/lib/api';
import { useInboxStore } from '@/store/inbox.store';
import { Contact, Message } from '@/types';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import EmojiPickerButton from '@/components/ui/EmojiPickerButton';

interface Props {
  conversationId: string;
  contact: Contact;
}

interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  body: string;
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // debe coincidir con el limite del backend

function whatsappTypeFor(file: File): string {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ReplyBox({ conversationId, contact }: Props) {
  const [text,         setText]         = useState('');
  const [isSending,    setIsSending]    = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);

  // Quick replies state
  const [allReplies,   setAllReplies]   = useState<QuickReply[]>([]);
  const [qrOpen,       setQrOpen]       = useState(false);
  const [qrFilter,     setQrFilter]     = useState('');
  const [qrIndex,      setQrIndex]      = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addMessage } = useInboxStore();

  // Cargar quick replies al montar
  useEffect(() => {
    quickRepliesApi.list().then(setAllReplies).catch(() => {});
  }, []);

  const filteredReplies = allReplies.filter(
    (r) =>
      r.shortcut.includes(qrFilter.toLowerCase()) ||
      r.title.toLowerCase().includes(qrFilter.toLowerCase()),
  );

  // ── Send ────────────────────────────────────────────────────────────────────
  async function handleSend() {
    if (isSending) return;
    if (attachedFile) return handleSendMedia();
    if (!text.trim()) return;

    const body = text.trim();
    setText('');
    setQrOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsSending(true);
    try {
      const message = await whatsappApi.send({ conversationId, to: contact.phone, type: 'text', body });
      addMessage(message as Message);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al enviar');
      setText(body);
    } finally {
      setIsSending(false);
    }
  }

  async function handleSendMedia() {
    if (!attachedFile || isSending) return;
    const file = attachedFile;
    const caption = text.trim();
    setText('');
    setAttachedFile(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsSending(true);
    try {
      const message = await whatsappApi.sendMedia({
        conversationId,
        to: contact.phone,
        type: whatsappTypeFor(file),
        caption: caption || undefined,
        file,
      });
      addMessage(message as Message);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al enviar el archivo');
      setAttachedFile(file);
      setText(caption);
    } finally {
      setIsSending(false);
    }
  }

  // ── Attach ──────────────────────────────────────────────────────────────────
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-seleccionar el mismo archivo despues
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error('El archivo supera el límite de 25MB');
      return;
    }
    setAttachedFile(file);
  }

  // ── AI suggest ──────────────────────────────────────────────────────────────
  async function handleAiSuggest() {
    setIsGenerating(true);
    try {
      const { suggestion } = await aiApi.suggest(conversationId);
      setText(suggestion);
      setTimeout(() => {
        textareaRef.current?.focus();
        autoResize();
      }, 0);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al generar sugerencia');
    } finally {
      setIsGenerating(false);
    }
  }

  // ── Insert emoji at cursor ───────────────────────────────────────────────────
  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    if (!el) { setText((t) => t + emoji); return; }
    const start = el.selectionStart ?? text.length;
    const end   = el.selectionEnd   ?? text.length;
    const next  = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
      autoResize();
    }, 0);
  }

  // ── Insert quick reply ───────────────────────────────────────────────────────
  function insertReply(reply: QuickReply) {
    setText(reply.body);
    setQrOpen(false);
    setQrFilter('');
    setQrIndex(0);
    setTimeout(() => {
      textareaRef.current?.focus();
      autoResize();
    }, 0);
  }

  // ── Textarea handlers ────────────────────────────────────────────────────────
  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setText(val);

    // Detectar trigger: línea que empieza con "/"
    const lastLine = val.split('\n').pop() ?? '';
    if (lastLine.startsWith('/')) {
      setQrFilter(lastLine.slice(1));
      setQrOpen(true);
      setQrIndex(0);
    } else {
      setQrOpen(false);
      setQrFilter('');
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Navegar dropdown con teclado
    if (qrOpen && filteredReplies.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setQrIndex((i) => Math.min(i + 1, filteredReplies.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setQrIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && qrOpen)) {
        e.preventDefault();
        insertReply(filteredReplies[qrIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setQrOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend = (text.trim().length > 0 || !!attachedFile) && !isSending;

  return (
    <div
      className="bg-white px-4 py-3 shrink-0"
      style={{ borderTop: '1px solid var(--border)' }}
    >
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* ── Attached file preview ── */}
      {attachedFile && (
        <div
          className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl animate-fade-in"
          style={{ background: '#E8FBF0', border: '1px solid #C8F0D8' }}
        >
          <FileText className="w-4 h-4 shrink-0" style={{ color: '#128C7E' }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-ink truncate">{attachedFile.name}</p>
            <p className="text-[11px] text-ink-subtle">{formatSize(attachedFile.size)}</p>
          </div>
          <button
            onClick={() => setAttachedFile(null)}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── AI loading hint ── */}
      {isGenerating && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
                style={{ background: '#A855F7', animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
          <span className="text-xs text-ink-subtle">Generando sugerencia con IA...</span>
        </div>
      )}

      {/* ── Quick replies dropdown ── */}
      {qrOpen && (
        <div
          className="mb-2 rounded-xl overflow-hidden shadow-float animate-pop"
          style={{ border: '1px solid var(--border)', background: 'white' }}
        >
          {filteredReplies.length === 0 ? (
            <div className="px-4 py-3 text-xs text-ink-muted italic">
              Sin resultados para &quot;/{qrFilter}&quot;
            </div>
          ) : (
            filteredReplies.slice(0, 6).map((r, i) => (
              <button
                key={r.id}
                onMouseDown={(e) => { e.preventDefault(); insertReply(r); }}
                className={clsx(
                  'w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors',
                  i === qrIndex ? 'bg-surface-muted' : 'hover:bg-surface-muted',
                )}
              >
                <span
                  className="shrink-0 mt-0.5 text-[10px] font-mono font-semibold rounded px-1.5 py-0.5"
                  style={{ background: '#E8FBF0', color: '#128C7E' }}
                >
                  /{r.shortcut}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink truncate">{r.title}</p>
                  <p className="text-xs text-ink-muted truncate">{r.body}</p>
                </div>
              </button>
            ))
          )}
          <div
            className="px-4 py-2 flex items-center gap-1.5 text-[10px] text-ink-subtle"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <kbd className="px-1 py-0.5 rounded text-[9px] bg-surface-muted border border-border">↑↓</kbd>
            navegar
            <kbd className="px-1 py-0.5 rounded text-[9px] bg-surface-muted border border-border ml-1">Tab</kbd>
            insertar
            <kbd className="px-1 py-0.5 rounded text-[9px] bg-surface-muted border border-border ml-1">Esc</kbd>
            cerrar
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Textarea */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onInput={autoResize}
            placeholder={attachedFile ? 'Agregar un texto (opcional)...' : 'Escribe un mensaje o / para respuestas rápidas...'}
            rows={1}
            className={clsx(
              'w-full resize-none text-sm text-ink rounded-xl px-3.5 py-2.5 transition-all duration-150',
              'border focus:outline-none focus:ring-2',
              text.length > 0
                ? 'border-green-500 ring-2 ring-green-500/10 bg-white'
                : 'border-border bg-surface-muted focus:border-green-500 focus:ring-green-500/10',
            )}
            style={{ maxHeight: '240px', overflowY: 'auto' }}
          />
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-1.5 pb-0.5">
          {/* Attach */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            title="Adjuntar archivo"
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 border border-border bg-white text-ink-muted hover:text-green-600 hover:border-green-200 hover:bg-green-50 disabled:opacity-50"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          {/* Emoji */}
          <EmojiPickerButton onEmojiSelect={insertEmoji} dropUp />

          {/* AI */}
          <button
            onClick={handleAiSuggest}
            disabled={isGenerating}
            title="Sugerir respuesta con IA"
            className={clsx(
              'w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150',
              'border disabled:opacity-50',
              isGenerating
                ? 'border-purple-200 bg-purple-50 text-purple-400'
                : 'border-border bg-white text-ink-muted hover:text-purple-500 hover:border-purple-200 hover:bg-purple-50',
            )}
          >
            {isGenerating
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Sparkles className="w-4 h-4" />}
          </button>

          {/* Send */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={clsx(
              'w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150',
              canSend ? 'text-white shadow-card-md' : 'bg-surface-subtle text-ink-ghost cursor-not-allowed',
            )}
            style={canSend ? { background: '#25D366' } : {}}
          >
            {isSending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Quick reply hint */}
      {!qrOpen && allReplies.length > 0 && !text && (
        <div className="flex items-center gap-1 mt-1.5 px-0.5">
          <Zap className="w-3 h-3 text-ink-subtle" />
          <span className="text-[11px] text-ink-subtle">
            Escribe <kbd className="px-1 py-px rounded text-[10px] bg-surface-muted border border-border font-mono">/</kbd> para usar respuestas rápidas
          </span>
        </div>
      )}
    </div>
  );
}
