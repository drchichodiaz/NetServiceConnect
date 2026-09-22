import { BadRequestException } from '@nestjs/common';

/**
 * Reglas de armado de una plantilla de WhatsApp, en un solo lugar.
 *
 * Meta las valida del otro lado, pero sus mensajes de error son opacos (un
 * INVALID_FORMAT sin decir cual de los cuatro componentes fallo) y el rechazo
 * llega despues de haber creado la plantilla. Validar antes de llamar es la
 * diferencia entre "el boton 3 se pasa de 25 caracteres" y "revisa tu plantilla".
 *
 * Las mismas reglas sirven para dos caminos distintos:
 *  - el ALTA (`buildCreateComponents`), que manda los componentes en MAYUSCULAS
 *    con sus `example`;
 *  - el ENVIO (`buildSendComponents`), que manda los parametros en minusculas.
 * Que Meta use dos formas distintas para lo mismo es la fuente clasica de bugs acá.
 */

export type HeaderFormat = 'TEXT' | 'IMAGE';
export type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';

export interface TemplateButton {
  type: ButtonType;
  text: string;
  /** Solo URL. Puede terminar en {{1}} para una parte variable. */
  url?: string;
  /** Solo URL dinamica: el valor de ejemplo del {{1}} que Meta exige para aprobar. */
  urlExample?: string;
  /** Solo PHONE_NUMBER, en formato internacional. */
  phoneNumber?: string;
}

export interface TemplateShape {
  headerFormat?: HeaderFormat | null;
  headerText?: string | null;
  headerExampleValues?: string[];
  headerMediaHandle?: string | null;
  bodyText: string;
  exampleValues?: string[];
  footerText?: string | null;
  buttons?: TemplateButton[];
}

export const LIMITS = {
  headerText: 60,
  bodyText: 1024,
  footerText: 60,
  buttonText: 25,
  buttons: 10,
  urlButtons: 2,
  phoneButtons: 1,
};

/** Variables distintas ({{1}}, {{2}}…) que aparecen en un texto. */
export function countVariables(text: string): number {
  const matches = text.match(/\{\{\d+\}\}/g);
  return matches ? new Set(matches).size : 0;
}

function variableNumbers(text: string): number[] {
  const matches = text.match(/\{\{(\d+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => Number(m.replace(/\D/g, ''))))].sort((a, b) => a - b);
}

/**
 * Meta exige que las variables del body sean correlativas desde {{1}}: un body con
 * {{1}} y {{3}} se rechaza, y el motivo que devuelve no menciona la numeracion.
 */
function assertSequential(text: string, field: string) {
  const nums = variableNumbers(text);
  nums.forEach((n, i) => {
    if (n !== i + 1) {
      throw new BadRequestException(
        `Las variables ${field} tienen que ir numeradas desde {{1}} y sin saltos. ` +
          `Encontré {{${nums.join('}}, {{')}}} — deberían ser {{${nums.map((_, k) => k + 1).join('}}, {{')}}}.`,
      );
    }
  });
}

function assertMaxLength(value: string, max: number, field: string) {
  if (value.length > max) {
    throw new BadRequestException(`${field} no puede pasar de ${max} caracteres (tiene ${value.length}).`);
  }
}

function validateButtons(buttons: TemplateButton[]) {
  if (buttons.length > LIMITS.buttons) {
    throw new BadRequestException(`Una plantilla admite hasta ${LIMITS.buttons} botones (pusiste ${buttons.length}).`);
  }

  const urlCount = buttons.filter((b) => b.type === 'URL').length;
  if (urlCount > LIMITS.urlButtons) {
    throw new BadRequestException(`Meta admite hasta ${LIMITS.urlButtons} botones de enlace (pusiste ${urlCount}).`);
  }

  const phoneCount = buttons.filter((b) => b.type === 'PHONE_NUMBER').length;
  if (phoneCount > LIMITS.phoneButtons) {
    throw new BadRequestException(`Meta admite un solo botón de teléfono (pusiste ${phoneCount}).`);
  }

  // Si se mezclan respuestas rapidas con botones de accion, Meta exige que las
  // rapidas vayan todas juntas. Intercaladas, el alta se rechaza sin explicar por que.
  const quickIdx = buttons.map((b, i) => (b.type === 'QUICK_REPLY' ? i : -1)).filter((i) => i >= 0);
  if (quickIdx.length > 0 && quickIdx.length < buttons.length) {
    const contiguous = quickIdx.every((v, i) => i === 0 || v === quickIdx[i - 1] + 1);
    if (!contiguous) {
      throw new BadRequestException(
        'Las respuestas rápidas tienen que ir todas juntas, sin botones de enlace o teléfono en el medio.',
      );
    }
  }

  const seen = new Set<string>();
  buttons.forEach((button, i) => {
    const label = `El botón ${i + 1}`;
    // "de el botón" queda mal; esta es la forma contraida para los mensajes que la necesitan.
    const ofLabel = `del botón ${i + 1}`;

    if (!button.text?.trim()) throw new BadRequestException(`${label} no tiene texto.`);
    assertMaxLength(button.text, LIMITS.buttonText, label);

    // Dos botones con el mismo texto se ven igual en el telefono y Meta los rechaza.
    const key = button.text.trim().toLowerCase();
    if (seen.has(key)) throw new BadRequestException(`Hay dos botones con el texto "${button.text}".`);
    seen.add(key);

    if (button.type === 'URL') {
      if (!button.url?.trim()) throw new BadRequestException(`${label} es de enlace pero no tiene URL.`);
      if (!/^https?:\/\//i.test(button.url)) {
        throw new BadRequestException(`La URL ${ofLabel} tiene que empezar con http:// o https://`);
      }
      const vars = variableNumbers(button.url);
      if (vars.length > 1 || (vars.length === 1 && vars[0] !== 1)) {
        throw new BadRequestException(
          `La URL ${ofLabel} admite una sola variable y tiene que ser {{1}}.`,
        );
      }
      if (vars.length === 1) {
        // Meta solo acepta la variable como sufijo: https://sitio.com/{{1}} sirve,
        // https://sitio.com/{{1}}/detalle no.
        if (!button.url.trim().endsWith('{{1}}')) {
          throw new BadRequestException(
            `La variable ${ofLabel} tiene que ir al final de la URL (Meta solo la acepta como sufijo).`,
          );
        }
        if (!button.urlExample?.trim()) {
          throw new BadRequestException(
            `${label} tiene una URL con variable, así que necesita un valor de ejemplo para que Meta pueda aprobarla.`,
          );
        }
      }
    }

    if (button.type === 'PHONE_NUMBER') {
      if (!button.phoneNumber?.trim()) throw new BadRequestException(`${label} es de teléfono pero no tiene número.`);
      if (!/^\+?[0-9]{7,15}$/.test(button.phoneNumber.replace(/[\s-]/g, ''))) {
        throw new BadRequestException(
          `El número ${ofLabel} no parece válido. Usá formato internacional, por ejemplo +507 6000-0000.`,
        );
      }
    }
  });
}

/**
 * Valida la plantilla entera y devuelve cuantas variables tiene el body — el unico
 * dato derivado que el modelo guarda.
 */
export function validateShape(shape: TemplateShape): { variableCount: number; headerVariableCount: number } {
  if (!shape.bodyText?.trim()) throw new BadRequestException('El cuerpo del mensaje no puede estar vacío.');
  assertMaxLength(shape.bodyText, LIMITS.bodyText, 'El cuerpo del mensaje');
  assertSequential(shape.bodyText, 'del cuerpo');

  const variableCount = countVariables(shape.bodyText);
  if (variableCount > 0 && shape.exampleValues?.filter((v) => v?.trim()).length !== variableCount) {
    throw new BadRequestException(
      `El cuerpo tiene ${variableCount} variable(s) — necesitás un valor de ejemplo para cada una (Meta lo exige para poder aprobarla).`,
    );
  }

  let headerVariableCount = 0;

  if (shape.headerFormat === 'TEXT') {
    if (!shape.headerText?.trim()) throw new BadRequestException('Elegiste encabezado de texto pero está vacío.');
    assertMaxLength(shape.headerText, LIMITS.headerText, 'El encabezado');
    if (/[\r\n]/.test(shape.headerText)) {
      throw new BadRequestException('El encabezado tiene que ser una sola línea.');
    }
    const nums = variableNumbers(shape.headerText);
    if (nums.length > 1 || (nums.length === 1 && nums[0] !== 1)) {
      throw new BadRequestException('El encabezado admite una sola variable y tiene que ser {{1}}.');
    }
    headerVariableCount = nums.length;
    if (headerVariableCount === 1 && !shape.headerExampleValues?.[0]?.trim()) {
      throw new BadRequestException('El encabezado tiene una variable, así que necesita un valor de ejemplo.');
    }
  }

  if (shape.headerFormat === 'IMAGE' && !shape.headerMediaHandle?.trim()) {
    throw new BadRequestException('Elegiste encabezado con imagen pero no subiste ninguna.');
  }

  if (shape.footerText?.trim()) {
    assertMaxLength(shape.footerText, LIMITS.footerText, 'El pie de página');
    if (countVariables(shape.footerText) > 0) {
      throw new BadRequestException('El pie de página no admite variables.');
    }
  }

  if (shape.buttons?.length) validateButtons(shape.buttons);

  return { variableCount, headerVariableCount };
}

/** Los componentes tal como los espera el alta de plantillas de Meta (en MAYUSCULAS). */
export function buildCreateComponents(shape: TemplateShape): any[] {
  const components: any[] = [];

  if (shape.headerFormat === 'TEXT' && shape.headerText) {
    const header: any = { type: 'HEADER', format: 'TEXT', text: shape.headerText };
    if (countVariables(shape.headerText) > 0) {
      header.example = { header_text: [shape.headerExampleValues![0]] };
    }
    components.push(header);
  } else if (shape.headerFormat === 'IMAGE') {
    // En el alta, el ejemplo de una imagen NO es una URL: es el handle que devuelve
    // la Resumable Upload API. Mandar un link acá da INVALID_FORMAT.
    components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [shape.headerMediaHandle] } });
  }

  const body: any = { type: 'BODY', text: shape.bodyText };
  if (countVariables(shape.bodyText) > 0) {
    body.example = { body_text: [shape.exampleValues] };
  }
  components.push(body);

  if (shape.footerText?.trim()) {
    components.push({ type: 'FOOTER', text: shape.footerText.trim() });
  }

  if (shape.buttons?.length) {
    components.push({
      type: 'BUTTONS',
      buttons: shape.buttons.map((b) => {
        if (b.type === 'URL') {
          const button: any = { type: 'URL', text: b.text, url: b.url };
          if (countVariables(b.url!) > 0) button.example = [b.urlExample];
          return button;
        }
        if (b.type === 'PHONE_NUMBER') {
          return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phoneNumber };
        }
        return { type: 'QUICK_REPLY', text: b.text };
      }),
    });
  }

  return components;
}

export interface SendVariables {
  /** Valores del body, en orden de {{1}} en adelante. */
  body?: string[];
  /** Valor del {{1}} del encabezado de texto, si lo tiene. */
  header?: string[];
  /** Valor del {{1}} de un boton de enlace, por indice del boton. */
  buttons?: { index: number; value: string }[];
}

/**
 * Los componentes tal como los espera el ENVIO (en minusculas, con `parameters`).
 * `headerMediaId` es el media id ya subido a la linea que envia — se resuelve afuera
 * porque depende del numero y de un cache.
 */
export function buildSendComponents(
  template: {
    headerFormat?: string | null;
    headerText?: string | null;
    bodyText: string;
    buttons?: TemplateButton[] | null;
  },
  vars: SendVariables,
  headerMediaId?: string,
): any[] {
  const components: any[] = [];

  if (template.headerFormat === 'IMAGE' && headerMediaId) {
    components.push({ type: 'header', parameters: [{ type: 'image', image: { id: headerMediaId } }] });
  } else if (template.headerFormat === 'TEXT' && countVariables(template.headerText ?? '') > 0) {
    components.push({ type: 'header', parameters: [{ type: 'text', text: vars.header?.[0] ?? '' }] });
  }

  const bodyVars = vars.body ?? [];
  if (bodyVars.length > 0) {
    components.push({ type: 'body', parameters: bodyVars.map((v) => ({ type: 'text', text: v })) });
  }

  // Solo los botones de enlace con {{1}} llevan parametro. Las respuestas rapidas no
  // necesitan nada acá: su payload por defecto es el propio texto del boton.
  (template.buttons ?? []).forEach((button, index) => {
    if (button.type !== 'URL' || countVariables(button.url ?? '') === 0) return;
    const value = vars.buttons?.find((b) => b.index === index)?.value ?? '';
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(index),
      parameters: [{ type: 'text', text: value }],
    });
  });

  return components;
}

/** Cuantos valores hay que pedir al enviar, para que el frontend arme el formulario. */
export function describeSendVariables(template: {
  headerFormat?: string | null;
  headerText?: string | null;
  bodyText: string;
  buttons?: TemplateButton[] | null;
}) {
  return {
    header: template.headerFormat === 'TEXT' ? countVariables(template.headerText ?? '') : 0,
    body: countVariables(template.bodyText),
    buttons: (template.buttons ?? [])
      .map((b, index) => ({ index, text: b.text }))
      .filter((_, i) => {
        const b = (template.buttons ?? [])[i];
        return b.type === 'URL' && countVariables(b.url ?? '') > 0;
      }),
  };
}
