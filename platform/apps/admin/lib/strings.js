/** Bulgarian merchant copy — DESIGN.md §5.2 (core strings) plus the few states it implies. */
export const t = {
  loginTitle: "Вход в Amboras",
  email: "Имейл",
  password: "Парола",
  signIn: "Вход",
  signingIn: "Влизане…",
  loginFailed: "Грешен имейл или парола.",
  loading: "Зареждаме черновата…",
  loadFailed: "Не можахме да заредим магазина. Опитайте отново.",
  retry: "Опитай отново",

  draftBadge: "Чернова",
  inPreviewBadge: "В прегледа",
  desktop: "Настолен",
  mobile: "Мобилен",
  history: "История",
  undo: "Отмени",
  promote: "Обнови прегледа",
  promoteRunning: "Подготвяме прегледа…",
  promoteDone: "Прегледът е обновен.",
  promoteFailed: "Прегледът не се обнови. Черновата е запазена — опитайте отново.",
  openPreview: "Отвори прегледа",
  conversation: "Разговор",
  store: "Магазин",
  more: "Още действия",
  close: "Затвори",
  frameTitle: "Чернова на магазина",

  emptyConversation: "Посочете елемент от магазина и кажете какво да променим.",
  composerPlaceholder: "Например: направете заглавието по-кратко",
  composerLabel: "Съобщение",
  send: "Изпрати",
  selected: (label) => `Избрано: ${label}`,
  clearSelection: "Премахни избора",
  selectionGone: "Този елемент вече не е в черновата. Изберете отново.",
  running: "Работя по промяната…",
  applied: (summary, n) => `Готово: ${summary}. Версия ${n}`,
  undoDone: "Върнах предишната версия.",
  cancelled: "Промяната беше спряна.",
  turnInProgress: "Изчакайте текущата промяна да завърши.",

  restore: "Върни тази версия",
  restoreConfirm: (n) => `Ще върнем версия ${n}. Текущата промяна ще бъде спряна, но нищо няма да се изгуби.`,
  confirmRestore: "Върни",
  keep: "Откажи",
  version: (n) => `Версия ${n}`,
  authorYou: "Вие",
  authorAmboras: "Amboras",

  screenshots: "Снимка на прегледа",
  takeMobile: "Снимка: мобилен",
  takeDesktop: "Снимка: настолен",
  capturing: "Правим снимка…",
  noPreviewYet: "Първо обновете прегледа, за да направите снимка.",

  contrastRejection: "Тези цветове не се четат достатъчно добре. Опитайте по-тъмен текст или по-светъл фон.",
  tooLong: "Текстът е твърде дълъг за това място. Съкратете го малко.",
  productRequest: "Продуктите и цените не се променят оттук. Тук променяме външния вид и текстовете на магазина.",
  conflict: "Черновата беше променена междувременно. Показваме последната версия.",
  rateLimited: (m) => `Направихте много промени за кратко. Опитайте отново след ${m} мин.`,
  reconnecting: "Връзката прекъсна. Свързваме се отново…",
  genericFailure: "Нещо не се получи. Черновата е запазена.",
  rejected: "Не можах да приложа тази промяна. Черновата е запазена.",
  readOnly: "Имате достъп само за преглед.",
}

/** Merchant-facing copy for a stable designer error code. */
export function errorCopy(code) {
  switch (code) {
    case "unsupported_request":
      return t.productRequest
    case "revision_conflict":
      return t.conflict
    case "limit_reached":
      return t.rateLimited(60)
    case "policy_rejected":
    case "model_output_rejected":
      return t.rejected
    default:
      return t.genericFailure
  }
}

export function relativeTime(value, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000))
  if (seconds < 60) return "току-що"
  if (seconds < 3600) return `преди ${Math.round(seconds / 60)} мин`
  if (seconds < 86400) return `преди ${Math.round(seconds / 3600)} ч`
  return new Date(value).toLocaleDateString("bg-BG")
}
