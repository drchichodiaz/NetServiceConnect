'use client';
import { motion } from 'framer-motion';
import { MessageSquare, Bot } from 'lucide-react';

// SVG inline del logo WhatsApp (lucide-react no lo incluye)
function WhatsAppSVG({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.886 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// Nodo que orbita: se mueve con el padre (rotación) y contra-rota para quedar upright
function OrbitalNode({
  duration,
  radius,
  startAngle = 0,
  direction = 1,
  children,
}: {
  duration: number;
  radius: number;
  startAngle?: number;
  direction?: 1 | -1;
  children: React.ReactNode;
}) {
  const size = radius * 2;
  return (
    // Contenedor del tamaño de la órbita, centrado en el padre
    <motion.div
      className="absolute"
      style={{
        width:       size,
        height:      size,
        marginLeft:  -radius,
        marginTop:   -radius,
        top:         '50%',
        left:        '50%',
        rotate:      startAngle,
      }}
      animate={{ rotate: startAngle + 360 * direction }}
      transition={{ duration, repeat: Infinity, ease: 'linear' }}
    >
      {/* Icono en el extremo superior, contra-rota para quedar siempre vertical */}
      <motion.div
        className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2"
        animate={{ rotate: -360 * direction }}
        transition={{ duration, repeat: Infinity, ease: 'linear' }}
        style={{ rotate: -startAngle }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

// Burbuja de chat
function ChatBubble({ text, outgoing = false }: { text: string; outgoing?: boolean }) {
  return (
    <div
      className="px-2.5 py-1.5 rounded-xl text-[10px] font-medium whitespace-nowrap leading-none"
      style={{
        background: outgoing ? '#25D36622' : '#1e293b',
        border:     outgoing ? '1px solid #25D36640' : '1px solid #334155',
        color:      outgoing ? '#25D366' : '#94a3b8',
      }}
    >
      {text}
    </div>
  );
}

// Indicador puntual central (glitch visual)
function CenterGlow() {
  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        width:      120,
        height:     120,
        background: 'radial-gradient(circle, rgba(37,211,102,0.18) 0%, transparent 70%)',
        top:        '50%',
        left:       '50%',
        x:          '-50%',
        y:          '-50%',
      }}
      animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

export default function LoginAnimation() {
  const INNER_R = 90;
  const OUTER_R = 148;

  return (
    <div className="relative w-full flex items-center justify-center" style={{ height: 320 }}>

      {/* Glow central */}
      <CenterGlow />

      {/* Anillo interno */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width:  INNER_R * 2,
          height: INNER_R * 2,
          border: '1px dashed rgba(37,211,102,0.2)',
          top:    '50%',
          left:   '50%',
          marginLeft: -INNER_R,
          marginTop:  -INNER_R,
        }}
      />

      {/* Anillo externo */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width:  OUTER_R * 2,
          height: OUTER_R * 2,
          border: '1px dashed rgba(100,116,139,0.18)',
          top:    '50%',
          left:   '50%',
          marginLeft: -OUTER_R,
          marginTop:  -OUTER_R,
        }}
      />

      {/* Nodo interno: WhatsApp — sentido horario, 12s */}
      <OrbitalNode duration={12} radius={INNER_R} direction={1}>
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{
            background: '#25D36618',
            border:     '1px solid #25D36635',
            boxShadow:  '0 0 12px rgba(37,211,102,0.15)',
            color:      '#25D366',
          }}
        >
          <WhatsAppSVG className="w-4 h-4" />
        </div>
      </OrbitalNode>

      {/* Nodo externo 1: Bot IA — sentido antihorario, 18s, parte arriba */}
      <OrbitalNode duration={18} radius={OUTER_R} direction={-1} startAngle={0}>
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{
            background: '#1e293b',
            border:     '1px solid #334155',
            boxShadow:  '0 0 12px rgba(96,165,250,0.12)',
          }}
        >
          <Bot className="w-4 h-4 text-blue-400" />
        </div>
      </OrbitalNode>

      {/* Nodo externo 2: burbuja "Hola!" — antihorario, 18s, parte abajo (180°) */}
      <OrbitalNode duration={18} radius={OUTER_R} direction={-1} startAngle={180}>
        <ChatBubble text="Hola! Necesito ayuda" />
      </OrbitalNode>

      {/* Nodo externo 3: burbuja "Respuesta IA" — antihorario, 18s, parte derecha (90°) */}
      <OrbitalNode duration={18} radius={OUTER_R} direction={-1} startAngle={90}>
        <ChatBubble text="Respuesta IA..." outgoing />
      </OrbitalNode>

      {/* Centro: logo */}
      <div className="relative z-10 flex flex-col items-center gap-2">
        <motion.div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{
            background: '#25D366',
            boxShadow:  '0 0 0 8px rgba(37,211,102,0.08), 0 0 0 16px rgba(37,211,102,0.04)',
          }}
          animate={{ boxShadow: [
            '0 0 0 8px rgba(37,211,102,0.08), 0 0 0 16px rgba(37,211,102,0.04)',
            '0 0 0 12px rgba(37,211,102,0.12), 0 0 0 24px rgba(37,211,102,0.06)',
            '0 0 0 8px rgba(37,211,102,0.08), 0 0 0 16px rgba(37,211,102,0.04)',
          ]}}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <MessageSquare className="w-7 h-7 text-white" />
        </motion.div>
        <span
          className="text-xs font-semibold tracking-wide"
          style={{ color: 'rgba(255,255,255,0.4)' }}
        >
          NetService Connect
        </span>
      </div>
    </div>
  );
}
