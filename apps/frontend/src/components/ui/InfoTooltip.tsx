'use client';
import { Info } from 'lucide-react';

interface Props {
  text: string;
  example?: string;
}

/** Ícono de ayuda con un tooltip al pasar el mouse o al enfocar con teclado. */
export default function InfoTooltip({ text, example }: Props) {
  return (
    <span className="relative inline-flex group align-middle">
      <Info
        tabIndex={0}
        className="w-3.5 h-3.5 text-ink-subtle hover:text-ink-muted cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded-full"
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-2 hidden w-60 -translate-x-1/2
                   rounded-lg bg-ink p-2.5 text-[11px] leading-relaxed text-white shadow-lg
                   group-hover:block group-focus-within:block"
      >
        {text}
        {example && (
          <span className="mt-1.5 block rounded-md bg-white/10 px-2 py-1 text-white/80">
            Ej: {example}
          </span>
        )}
      </span>
    </span>
  );
}
