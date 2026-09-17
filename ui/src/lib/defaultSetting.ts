/**
 * Настройка провайдера, которую панель подставляет в новый ключ.
 *
 * Хранится в браузере: это удобство для того, кто выписывает ключи, а не правило.
 * Правило живёт на сервере — для support-сессии настройку выбирает он сам
 * (SUPPORT_SETTING_ID либо единственная существующая), и на выбор в панели не
 * смотрит.
 */
const STORAGE_KEY = "bricks_setting_id";

export function rememberSetting(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Приватное окно или запрет на хранилище: просто не запомним.
  }
}

export function recallSetting(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}
