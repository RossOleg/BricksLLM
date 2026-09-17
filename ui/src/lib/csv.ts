/**
 * Выгрузка таблицы в CSV — чтобы расходы можно было посчитать в чём угодно.
 */

/** Одна колонка: заголовок и как достать значение из строки. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/**
 * Экранирование по RFC 4180: кавычки удваиваются, а поле берётся в кавычки,
 * если в нём есть разделитель, кавычка или перевод строки.
 *
 * Отдельный случай — значение, начинающееся с =, +, - или @: Excel выполнит его
 * как формулу. Поэтому такому полю предпосылается апостроф.
 */
function escape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  let text = String(value);

  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escape(c.header)).join(",")];

  for (const row of rows) {
    lines.push(columns.map((c) => escape(c.value(row))).join(","));
  }

  return lines.join("\r\n");
}

export function downloadCsv<T>(name: string, rows: T[], columns: CsvColumn<T>[]) {
  // BOM, иначе Excel прочитает utf-8 как windows-1251 и покажет кракозябры.
  const blob = new Blob(["﻿" + toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/** Секунды unix в читаемую дату для выгрузки. */
export function csvDate(seconds?: number | null): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}
