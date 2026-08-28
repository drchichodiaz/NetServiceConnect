/**
 * Config de marca — permite correr el mismo código con distinta identidad según el
 * deploy (ver apps/frontend/.env.example). Los defaults reproducen exactamente el
 * comportamiento de siempre, así que un deploy existente que no defina estas
 * variables no nota ningún cambio.
 */
export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || 'NetService Connect',
  tagline:
    process.env.NEXT_PUBLIC_BRAND_TAGLINE ||
    'Plataforma SaaS multiagente para atención al cliente por WhatsApp',
  // El panel de acciones rápidas ("Crear ticket/tarea/cliente") simula integrar con
  // el sistema interno "NetService Core" — tiene sentido solo en el deploy de esa
  // marca. Se apaga explícitamente con NEXT_PUBLIC_ENABLE_NETSERVICE_PANEL=false.
  showNetServicePanel: process.env.NEXT_PUBLIC_ENABLE_NETSERVICE_PANEL !== 'false',
};
