import { describe, it, expect } from "vitest";
import { decodeBody, prettyJson, preview, formatSize, parseMetadata, daminionFields, PREVIEW_LIMIT } from "./payload";

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

describe("parseMetadata", () => {
  it("разбирает base64, в котором Go отдаёт JSONB", () => {
    expect(parseMetadata(encode('{"catalog":"Photos","mediaType":"video"}'))).toEqual({
      catalog: "Photos",
      mediaType: "video",
    });
  });

  // До правки X-METADATA в колонку попадала строка с JSON внутри.
  it("разбирает дважды закодированный JSON старых событий", () => {
    expect(parseMetadata(encode(JSON.stringify('{"catalog":"Photos"}')))).toEqual({ catalog: "Photos" });
  });

  it("пустые и битые метаданные - пустой объект", () => {
    expect(parseMetadata(undefined)).toEqual({});
    expect(parseMetadata(null)).toEqual({});
    expect(parseMetadata(encode("{}"))).toEqual({});
    expect(parseMetadata(encode("[1,2]"))).toEqual({});
    expect(parseMetadata("не base64")).toEqual({});
  });
});

describe("daminionFields", () => {
  it("делит custom id на id и guid элемента", () => {
    expect(
      daminionFields({
        custom_id: "12345:0f1e-aa",
        metadata: encode('{"catalog":"Photos","mediaType":"photo"}'),
      }),
    ).toEqual({ catalog: "Photos", mediaType: "photo", itemId: "12345", itemGuid: "0f1e-aa" });
  });

  it("чужой custom id показывает целиком", () => {
    expect(daminionFields({ custom_id: "run-7" })).toEqual({
      catalog: "",
      mediaType: "",
      itemId: "run-7",
      itemGuid: "",
    });
  });
});
