import * as ExcelJS from 'exceljs';
import { PHONE_REGEX } from './dto/create-contact.dto';

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedContactRow {
  row: number; // 1-based, contando la fila de headers como 1
  name?: string;
  phone: string;
  email?: string;
  company?: string;
  /**
   * Las etiquetas de la columna "Etiquetas", separadas por coma o punto y coma. Vienen
   * como texto tal cual lo escribieron: quien importa las convierte en ContactTag,
   * creando las que falten.
   */
  tags: string[];
  /**
   * Las columnas que NO son name/phone/email/company, con su encabezado original
   * como clave. El import de contactos las ignora; las campañas las usan como los
   * valores de las variables de la plantilla, que cambian fila por fila.
   */
  extra: Record<string, string>;
}

export interface ParseRowError {
  row: number;
  reason: string;
}

export interface ParseResult {
  rows: ParsedContactRow[];
  errors: ParseRowError[];
}

type KnownField = 'name' | 'phone' | 'email' | 'company' | 'tags';

const HEADER_ALIASES: Record<string, KnownField> = {
  nombre: 'name',
  name: 'name',
  telefono: 'phone',
  'teléfono': 'phone',
  phone: 'phone',
  email: 'email',
  correo: 'email',
  empresa: 'company',
  company: 'company',
  // Tratar "Etiquetas" como columna conocida se la saca de `extra`, o sea que en un
  // Excel de campaña deja de poder mapearse a una variable de la plantilla. Se acepta
  // a proposito: una columna llamada asi son etiquetas mucho mas seguido de lo que es
  // el valor de un {{1}}, y para eso ultimo alcanza con llamarla de otra forma.
  etiquetas: 'tags',
  etiqueta: 'tags',
  tags: 'tags',
};

/** "vip, mayorista; moroso" → ["vip", "mayorista", "moroso"]. */
export function splitTagCell(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Deja solo dígitos (sin "+") — los Excel reales casi siempre traen espacios/guiones/
 * paréntesis, y a veces un "+" inicial. Se descarta el "+" a propósito: los contactos
 * que llegan por un mensaje real de WhatsApp se guardan con `msg.from` de Meta, que
 * siempre es solo dígitos — si un contacto importado quedara con "+", nunca haría
 * match con `(tenantId, phone)` cuando esa persona escriba de verdad más adelante.
 */
export function normalizePhone(raw: string): string {
  return raw.trim().replace(/\D/g, '');
}

function normalizeHeader(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in (value as any)) return String((value as any).text ?? '');
  if (typeof value === 'object' && 'result' in (value as any)) return String((value as any).result ?? '');
  return String(value).trim();
}

/**
 * Parsea un .xlsx o .csv subido y devuelve las filas ya mapeadas a name/phone/email/company,
 * mas las columnas que no reconocimos en `extra`.
 *
 * Lo usan dos cosas con intenciones opuestas: el import de contactos (donde un telefono
 * que ya existe es un error a saltear) y las campañas (donde un contacto que ya existe es
 * el caso normal). Por eso esta funcion solo parsea y valida forma — que hacer con cada
 * fila lo decide quien llama.
 */
export async function parseWorkbookRows(buffer: Buffer, filename: string): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  const isCsv = filename.toLowerCase().endsWith('.csv');

  if (isCsv) {
    const { Readable } = await import('stream');
    await workbook.csv.read(Readable.from(buffer));
  } else {
    await workbook.xlsx.load(buffer as any);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('El archivo no tiene ninguna hoja con datos');
  }

  const headerRow = worksheet.getRow(1);
  const columnMap = new Map<number, KnownField>();
  // Las columnas que no reconocemos no se descartan: se guardan con su encabezado tal
  // como vino, para que una campaña pueda mapearlas a las variables de la plantilla.
  const extraColumns = new Map<number, string>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const raw = cellToString(cell.value).trim();
    if (!raw) return;
    const key = HEADER_ALIASES[normalizeHeader(raw)];
    if (key) columnMap.set(colNumber, key);
    else extraColumns.set(colNumber, raw);
  });

  if (!Array.from(columnMap.values()).includes('phone')) {
    throw new Error('No encontramos una columna "Teléfono" en el archivo');
  }

  const rows: ParsedContactRow[] = [];
  const errors: ParseRowError[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // headers

    const values: Partial<Record<KnownField, string>> = {};
    columnMap.forEach((key, colNumber) => {
      const v = cellToString(row.getCell(colNumber).value);
      if (v) values[key] = v;
    });

    const extra: Record<string, string> = {};
    extraColumns.forEach((header, colNumber) => {
      const v = cellToString(row.getCell(colNumber).value);
      if (v) extra[header] = v;
    });

    // Una fila con solo columnas extra y sin telefono no sirve para nada: se ignora
    // igual que una vacia, en vez de reportarla como error por cada fila de relleno.
    if (!values.name && !values.phone && !values.email && !values.company) return;

    if (!values.phone) {
      errors.push({ row: rowNumber, reason: 'Falta el teléfono' });
      return;
    }

    const phone = normalizePhone(values.phone);
    if (!PHONE_REGEX.test(phone)) {
      errors.push({ row: rowNumber, reason: `Teléfono inválido: "${values.phone}"` });
      return;
    }

    if (values.email && !EMAIL_REGEX.test(values.email)) {
      errors.push({ row: rowNumber, reason: `Email inválido: "${values.email}"` });
      return;
    }

    rows.push({
      row: rowNumber,
      name: values.name,
      phone,
      email: values.email,
      company: values.company,
      tags: values.tags ? splitTagCell(values.tags) : [],
      extra,
    });
  });

  return { rows, errors };
}

/** Genera la plantilla .xlsx descargable con las columnas esperadas y una fila de ejemplo. */
export async function buildTemplateWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Contactos');
  sheet.columns = [
    { header: 'Nombre', key: 'name', width: 24 },
    { header: 'Telefono', key: 'phone', width: 18 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Empresa', key: 'company', width: 24 },
    // Separadas por coma. Las que no existan se crean solas al importar, asi que la
    // planilla es tambien la forma mas rapida de cargar las primeras etiquetas.
    { header: 'Etiquetas', key: 'tags', width: 30 },
  ];
  sheet.addRow({
    name: 'Juan Pérez',
    phone: '50760000000',
    email: 'juan@ejemplo.com',
    company: 'Ejemplo S.A.',
    tags: 'mayorista, cliente vip',
  });
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
