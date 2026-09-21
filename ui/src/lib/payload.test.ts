import { describe, it, expect } from "vitest";
import { decodeBody, prettyJson, preview, formatSize, PREVIEW_LIMIT } from "./payload";

const encode = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

describe("decodeBody", () => {
  it("декодирует то, что отдаёт Go для bytea", () => {
    expect(decodeBody(encode('{"model":"gpt-5.4"}'))).toBe('{"model":"gpt-5.4"}');
  });

  // Через atob напрямую русский промпт превратился бы в мусор: это байты, а не символы.
  it("не портит кириллицу", () => {
    const prompt = '{"content":"Опиши эту фотографию"}';

    expect(decodeBody(encode(prompt))).toBe(prompt);
  });

  it("возвращает как есть то, что не является base64", () => {
    expect(decodeBody("{не base64}")).toBe("{не base64}");
    expect(decodeBody("")).toBe("");
    expect(decodeBody(null)).toBe("");
    expect(decodeBody(undefined)).toBe("");
  });
});

describe("prettyJson", () => {
  it("разворачивает json", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it("оставляет не-json нетронутым", () => {
    expect(prettyJson("upstream is down")).toBe("upstream is down");
  });

  // Картинка в base64 внутри запроса - это мегабайты; разбор и переформатирование
  // такого тела вешает вкладку, а пользы не даёт.
  it("не трогает слишком большое тело", () => {
    const huge = '{"image":"' + "a".repeat(300000) + '"}';

    expect(prettyJson(huge)).toBe(huge);
  });
});

describe("preview", () => {
  it("короткое тело показывает целиком", () => {
    expect(preview("{}")).toEqual({ shown: "{}", truncated: false });
  });

  it("длинное обрезает и говорит об этом", () => {
    const long = "a".repeat(PREVIEW_LIMIT + 10);
    const result = preview(long);

    expect(result.truncated).toBe(true);
    expect(result.shown.length).toBe(PREVIEW_LIMIT);
  });
});

describe("formatSize", () => {
  it("выбирает единицу по величине", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
