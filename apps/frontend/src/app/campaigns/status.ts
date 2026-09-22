import type { CampaignStatus } from '@/lib/api';

/**
 * Vive aparte de las paginas porque lo usan la lista y el detalle, y Next no deja
 * exportar cualquier cosa desde un archivo de pagina (solo default, metadata y
 * algunas opciones reservadas).
 */
export const STATUS_STYLES: Record<CampaignStatus, { label: string; bg: string; color: string }> = {
  DRAFT:     { label: 'Sin enviar', bg: 'var(--surface-muted)', color: '#6B7280' },
  RUNNING:   { label: 'Enviando',   bg: '#E8FBF0', color: '#128C7E' },
  PAUSED:    { label: 'Pausada',    bg: '#FFF7ED', color: '#C2650A' },
  DONE:      { label: 'Terminada',  bg: '#EEF2FF', color: '#4338CA' },
  CANCELLED: { label: 'Cancelada',  bg: '#FEE2E2', color: '#B91C1C' },
};
