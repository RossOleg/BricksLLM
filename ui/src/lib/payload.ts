/**
 * Тела запроса и ответа из события.
 *
 * В базе это bytea, и Go отдаёт такие поля в JSON строкой base64 - поэтому в
 * ответе события лежит не текст, а его кодировка, и показывать её как есть
 * бессмысленно.
 */

/** Сколько символов показываем на экране. Остальное остаётся доступным для копирования и скачивания. */
export const PREVIEW_LIMIT = 20000;

/** Выше этого размера не пытаемся разбирать и переформатировать JSON: на картинках в base64 это минуты работы вкладки. */
const PRETTY_LIMIT = 200000;

/**
 * Декодирует base64 в текст.
 *
 * Через TextDecoder, а не atob напрямую: atob отдаёт байты как символы latin-1,
 * и любая кириллица в промпте превратилась бы в мусор.
 *
 * Тело может оказаться и не base64 - например, когда лог запроса выключен и
 * вместо него лежит пустой объект. Тогда возвращаем как есть.
 */
export function decodeBody(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";

  try {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return raw;
  }
}

/** Разворачивает JSON в читаемый вид, если это JSON и он не слишком велик. */
export function prettyJson(text: string): string {
  if (text.length === 0 || text.length > PRETTY_LIMIT) return text;

  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Что показать на экране: длинное тело обрезается, целиком оно остаётся в копии и в файле. */
export function preview(text: string): { shown: string; truncated: boolean } {
  if (text.length <= PREVIEW_LIMIT) return { shown: text, truncated: false };

  return { shown: text.slice(0, PREVIEW_LIMIT), truncated: true };
}

export function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;

  return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
}

/** Отдаёт тело файлом - единственный способ унести многомегабайтный ответ целиком. */
export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");

  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Метаданные события - заголовок X-METADATA.
 *
 * Колонка JSONB, но в Go это []byte, и в ответ API она приходит тоже строкой
 * base64. События, записанные до правки заголовка, хранят JSON дважды
 * закодированным - строкой с объектом внутри; такие разбираем второй раз.
 * Всё, что объектом не оказалось, считаем отсутствием метаданных.
 */
export function parseMetadata(raw: unknown): Record<string, unknown> {
  let value: unknown = raw;

  if (typeof value === "string") value = parseJson(decodeBody(value));
  if (typeof value === "string") value = parseJson(value);

  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Что Daminion кладёт в событие: каталог и тип медиа - из X-METADATA, элемент - из X-CUSTOM-EVENT-ID. */
export interface DaminionFields {
  catalog: string;
  mediaType: string;
  /** Id элемента внутри каталога. */
  itemId: string;
  /** Guid элемента: id уникален только в своём каталоге. */
  itemGuid: string;
}

export function daminionFields(event: { custom_id?: string; metadata?: unknown }): DaminionFields {
  const meta = parseMetadata(event.metadata);
  const customId = event.custom_id ?? "";

  // X-CUSTOM-EVENT-ID приходит как "<id>:<guid>". Без двоеточия это чужой
  // custom id, и показываем его целиком.
  const colon = customId.indexOf(":");

  return {
    catalog: typeof meta.catalog === "string" ? meta.catalog : "",
    mediaType: typeof meta.mediaType === "string" ? meta.mediaType : "",
    itemId: colon < 0 ? customId : customId.slice(0, colon),
    itemGuid: colon < 0 ? "" : customId.slice(colon + 1),
  };
}
