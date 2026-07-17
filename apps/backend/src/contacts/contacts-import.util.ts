import * as ExcelJS from 'exceljs';
import { PHONE_REGEX } from './dto/create-contact.dto';

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedContactRow {
  row: number; // 1-based, contando la fila de headers como 1
  name?: string;
  phone: string;
  email?: string;
  company?: string;
}

export interface ParseRowError {
  row: number;
  reason: string;
}

export interface ParseResult {
  rows: ParsedContactRow[];
  errors: ParseRowError[];
}

const HEADER_ALIASES: Record<string, keyof Omit<ParsedContactRow, 'row'>> = {
  nombre: 'name',
  name: 'name',
  telefono: 'phone',
  'teléfono': 'phone',
  phone: 'phone',
  email: 'email',
  correo: 'email',
  empresa: 'company',
  company: 'company',
};

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

/** Parsea un .xlsx o .csv subido y devuelve las filas ya mapeadas a name/phone/email/company. */
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
  const columnMap = new Map<number, keyof Omit<ParsedContactRow, 'row'>>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = HEADER_ALIASES[normalizeHeader(cellToString(cell.value))];
    if (key) columnMap.set(colNumber, key);
  });

  if (!Array.from(columnMap.values()).includes('phone')) {
    throw new Error('No encontramos una columna "Teléfono" en el archivo');
  }

  const rows: ParsedContactRow[] = [];
  const errors: ParseRowError[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // headers

    const values: Partial<Record<keyof Omit<ParsedContactRow, 'row'>, string>> = {};
    columnMap.forEach((key, colNumber) => {
      const v = cellToString(row.getCell(colNumber).value);
      if (v) values[key] = v;
    });

    if (!values.name && !values.phone && !values.email && !values.company) return; // fila vacía

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

    rows.push({ row: rowNumber, name: values.name, phone, email: values.email, company: values.company });
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
  ];
  sheet.addRow({ name: 'Juan Pérez', phone: '50760000000', email: 'juan@ejemplo.com', company: 'Ejemplo S.A.' });
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
