import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp, Bytes } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { DEFAULT_CONTENT, cloneDefaults } from "./cms-defaults.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const contentRef = doc(db, "site", "content");

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const loginButton = document.getElementById("loginButton");
const loginError = document.getElementById("loginError");
const saveButton = document.getElementById("saveButton");
const resetButton = document.getElementById("resetButton");
const logoutButton = document.getElementById("logoutButton");
const saveState = document.getElementById("saveState");
const connectionState = document.getElementById("connectionState");
const toast = document.getElementById("toast");
const previewButton = document.getElementById("previewButton");
const previewOverlay = document.getElementById("previewOverlay");
const previewFrame = document.getElementById("sitePreviewFrame");
const closePreviewButton = document.getElementById("closePreviewButton");
const refreshPreviewButton = document.getElementById("refreshPreviewButton");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let content = cloneDefaults();
let publishedContent = cloneDefaults();
let currentUser = null;
let dirty = false;
let toastTimer = null;
let publishedAt = null;
let overviewMotionContext = null;
let galleryMotionContext = null;
let activeUploads = 0;
let previewReturnFocus = null;

const MEDIA_PREFIX = "firestore-media://";
const MAX_MEDIA_BYTES = 780000;
const mediaPreviewUrls = new Map();
const stagedMediaByPath = new Map();

const panelMeta = {
  overview: ["Сводка", "Управление сайтом", "Весь важный контент собран в одном месте. Откройте раздел, внесите изменения и опубликуйте."],
  general: ["Первый экран", "Главная страница", "Заголовок, ключевое обещание, рейтинг и изображение первого экрана."],
  podology: ["Услуги", "Подология", "Основные проблемы, с которыми работает студия."],
  process: ["Сценарий визита", "Этапы приёма", "Объясните клиенту путь от осмотра до рекомендаций."],
  team: ["Стандарты", "Команда студии", "Преимущества и общие правила работы мастеров."],
  training: ["Для мастеров", "Обучение", "Направления, описание и контакт для записи на обучение."],
  gallery: ["Портфолио", "Галерея работ", "Фотографии и видео по направлениям, подписи и описания для поиска."],
  reviews: ["Доверие", "Рейтинг и отзывы", "Публичные цифры и ссылка на независимые отзывы."],
  faq: ["Подсказки клиенту", "Частые вопросы", "Пять ответов, которые снимают тревогу до записи."],
  contact: ["Связь", "Контакты", "Адрес, часы работы и все ссылки для записи."],
  account: ["Безопасность", "Аккаунт", "Данные входа и смена пароля владельца сайта."]
};

function esc(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((cursor, key) => cursor[key], object);
  target[last] = value;
}

function mediaIdFromSource(source = "") {
  return String(source).startsWith(MEDIA_PREFIX) ? String(source).slice(MEDIA_PREFIX.length) : null;
}

function collectMediaIds(sourceContent) {
  if (!sourceContent) return new Set();
  return new Set([
    mediaIdFromSource(sourceContent.hero?.imageUrl),
    ...(sourceContent.gallery || []).map((item) => mediaIdFromSource(item?.src))
  ].filter(Boolean));
}

function displayMediaSource(source, fallback = "") {
  const mediaId = mediaIdFromSource(source);
  return mediaId ? mediaPreviewUrls.get(mediaId) || fallback : source || fallback;
}

async function preloadMediaPreviews() {
  const sources = [content.hero.imageUrl, ...content.gallery.map((item) => item.src)];
  const mediaIds = [...new Set(sources.map(mediaIdFromSource).filter(Boolean))];
  await Promise.all(mediaIds.map(async (mediaId) => {
    if (mediaPreviewUrls.has(mediaId)) return;
    try {
      const snapshot = await getDoc(doc(db, "media", mediaId));
      const data = snapshot.data();
      if (!snapshot.exists() || !data?.bytes?.toUint8Array) return;
      const blob = new Blob([data.bytes.toUint8Array()], { type: data.contentType || "image/webp" });
      mediaPreviewUrls.set(mediaId, URL.createObjectURL(blob));
    } catch (error) {
      console.warn("Не удалось загрузить превью изображения", mediaId, error.code || error.message);
    }
  }));
}

function photoPicker({ path, source, fallback, mediaKey, className = "" }) {
  const preview = displayMediaSource(source, fallback);
  const safeId = path.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `<label class="photo-picker ${esc(className)}" for="photo-${esc(safeId)}" role="button" tabindex="0" aria-label="Заменить фотографию" aria-describedby="status-${esc(safeId)}" data-picker-for="${esc(path)}">
    <img src="${esc(preview)}" alt="" width="1200" height="800" loading="lazy" decoding="async" data-preview-for="${esc(path)}">
    <input id="photo-${esc(safeId)}" name="photo-${esc(safeId)}" type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden data-photo-path="${esc(path)}" data-media-key="${esc(mediaKey)}">
    <span class="photo-prompt"><b>Заменить фото</b><span>Нажмите и выберите из галереи</span></span>
  </label>
  <div class="upload-status" id="status-${esc(safeId)}" data-upload-status="${esc(path)}" aria-live="polite">JPG, PNG, WEBP или фото с телефона — до 20 МБ.</div>`;
}

function deepMerge(base, incoming) {
  if (Array.isArray(base)) return Array.isArray(incoming) ? incoming : base;
  if (!base || typeof base !== "object") return incoming === undefined ? base : incoming;
  const result = { ...base };
  if (!incoming || typeof incoming !== "object") return result;
  Object.keys(incoming).forEach((key) => {
    if (key === "updatedAt") return;
    result[key] = key in base ? deepMerge(base[key], incoming[key]) : incoming[key];
  });
  return result;
}

function field(path, label, { type = "text", rows = 3, hint = "", placeholder = "" } = {}) {
  const value = getPath(content, path) ?? "";
  const id = `field-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const inputMode = type === "url" ? "url" : type === "email" ? "email" : type === "tel" ? "tel" : "text";
  const shared = `id="${esc(id)}" name="${esc(path)}" data-path="${esc(path)}" autocomplete="off"`;
  const control = type === "textarea"
    ? `<textarea ${shared} rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input ${shared} type="${esc(type)}" inputmode="${inputMode}" ${type === "url" || type === "email" ? 'spellcheck="false"' : ""} value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return `<div class="field"><label for="${esc(id)}">${esc(label)}</label>${control}${hint ? `<small style="color:var(--muted);line-height:1.4">${esc(hint)}</small>` : ""}</div>`;
}

function itemCard(index, title, inner) {
  return `<article class="card item-card span-6"><span class="item-index">${index + 1}</span><h3>${esc(title)}</h3>${inner}</article>`;
}

function formatPublicationDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "Ещё не публиковалось";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value).replace(" в ", ", ");
}

function renderAll() {
  renderOverview();
  renderGeneral();
  renderPodology();
  renderProcess();
  renderTeam();
  renderTraining();
  renderGallery();
  renderReviews();
  renderFaq();
  renderContact();
  renderAccount();
  bindEditorInputs();
  bindPhotoInputs();
}

function renderOverview() {
  const panel = document.getElementById("panel-overview");
  panel.innerHTML = `<div class="grid">
    <article class="card overview-status span-8"><div><div class="eyebrow">Рабочее пространство</div><h2>Сайт под контролем</h2><p>Редактируйте нужный раздел, проверяйте результат в предпросмотре и публикуйте одной кнопкой.</p></div><button class="btn btn-gold" type="button" data-open-preview>Посмотреть сайт</button></article>
    <article class="card publish-meta span-4"><div><div class="eyebrow">Последняя публикация</div><strong id="lastPublished">${esc(formatPublicationDate(publishedAt))}</strong></div><small>Аккаунт: ${esc(currentUser?.email || "—")}</small></article>
    <article class="card stat-card span-4"><span>Рейтинг</span><b>${esc(content.hero.rating)}</b><span>по данным сайта</span></article>
    <article class="card stat-card span-4"><span>Оценки</span><b>${esc(content.hero.ratingsCount)}</b><span>на Яндекс Картах</span></article>
    <article class="card stat-card span-4"><span>Материалы</span><b>${content.gallery.length}</b><span>фотографий и видео в галерее</span></article>
    <div class="overview-workspace" id="overviewWorkspace">
      <article class="card preview-card overview-preview" id="overviewPreview"><img src="${esc(displayMediaSource(content.hero.imageUrl, DEFAULT_CONTENT.hero.imageUrl))}" alt="" width="1200" height="900" loading="lazy" decoding="async"><div class="eyebrow">Первый экран</div><h2>${esc(content.hero.titleBefore)} ${esc(content.hero.titleAccent)} ${esc(content.hero.titleAfter)}</h2><div class="preview-actions"><button class="btn btn-gold" type="button" data-open-preview>Открыть предпросмотр</button><button class="btn btn-ghost" type="button" data-jump-panel="general">Изменить главный экран</button></div></article>
      <div class="quick-stack">
        <button class="quick-action" type="button" data-jump-panel="general"><span><b>Главная</b><span>Заголовок, рейтинг и главное фото</span></span><i aria-hidden="true">→</i></button>
        <button class="quick-action" type="button" data-jump-panel="gallery"><span><b>Галерея</b><span>Фотографии и подписи работ</span></span><i aria-hidden="true">→</i></button>
        <button class="quick-action" type="button" data-jump-panel="contact"><span><b>Контакты</b><span>Телефон, адрес и ссылки записи</span></span><i aria-hidden="true">→</i></button>
        <button class="quick-action" type="button" data-jump-panel="faq"><span><b>Вопросы</b><span>Ответы клиентам до визита</span></span><i aria-hidden="true">→</i></button>
        <button class="quick-action" type="button" data-jump-panel="team"><span><b>Команда</b><span>Стандарты и преимущества студии</span></span><i aria-hidden="true">→</i></button>
      </div>
    </div>
    <article class="card editorial-note span-12" id="tipCard"><div><div class="eyebrow">Редакторская подсказка</div><h2 id="tipTitle">Короткие заголовки</h2><p class="card-intro" id="tipText">Заголовки в две–три строки читаются лучше и сохраняют премиальный ритм страницы.</p></div><div class="note-controls"><button class="btn btn-ghost" type="button" id="tipPrev">Назад</button><button class="btn btn-ghost" type="button" id="tipNext">Далее</button></div></article>
  </div>`;
  setupTips();
  requestAnimationFrame(setupOverviewMotion);
}

function renderGeneral() {
  document.getElementById("panel-general").innerHTML = `<div class="grid">
    <article class="card span-6"><h2>Метаданные</h2><p class="card-intro">Название страницы и описание для поисковых систем.</p>${field("general.siteTitle", "Заголовок вкладки")}${field("general.siteDescription", "Описание сайта", { type: "textarea", rows: 4 })}${field("general.studioName", "Название студии")}${field("general.ownerName", "Подпись владельца")}</article>
    <article class="card span-6"><h2>Hero</h2><p class="card-intro">Главное обещание сайта. Акцентная часть выделяется золотым.</p>${field("hero.eyebrow", "Надзаголовок")}${field("hero.titleBefore", "Заголовок: начало")}${field("hero.titleAccent", "Заголовок: золотой акцент")}${field("hero.titleAfter", "Заголовок: окончание")}${field("hero.lead", "Описание", { type: "textarea", rows: 5 })}</article>
    <article class="card span-4">${field("hero.rating", "Рейтинг")}</article><article class="card span-4">${field("hero.ratingsCount", "Количество оценок")}</article><article class="card span-4">${field("hero.mastersCount", "Количество мастеров")}</article>
    <article class="card span-12"><div class="hero-photo-grid"><div>${photoPicker({ path: "hero.imageUrl", source: content.hero.imageUrl, fallback: DEFAULT_CONTENT.hero.imageUrl, mediaKey: "hero", className: "hero-photo-picker" })}</div><div class="hero-photo-copy"><div class="eyebrow">Главное изображение</div><h2>Выберите фото с телефона</h2><p class="upload-note">Кадр автоматически уменьшится и станет легче. После загрузки проверьте его в предпросмотре и нажмите «Опубликовать».</p>${field("hero.imageAlt", "Описание изображения для поиска")}<div class="upload-specs"><div><b>Лучший кадр</b><span>Горизонтальный или квадратный, без водяных знаков.</span></div><div><b>Автообработка</b><span>До 1600 px и меньше 780 КБ.</span></div></div><details class="manual-source"><summary>Указать ссылку вручную</summary>${field("hero.imageUrl", "Путь или HTTPS-ссылка")}</details></div></div></article>
  </div>`;
}

function renderPodology() {
  const cards = content.podology.services.map((item, index) => itemCard(index, item.title, `${field(`podology.services.${index}.title`, "Название")}${field(`podology.services.${index}.text`, "Описание", { type: "textarea", rows: 4 })}`)).join("");
  document.getElementById("panel-podology").innerHTML = `<div class="grid"><article class="card span-12"><div class="pair">${field("podology.heading", "Заголовок")}${field("podology.support", "Подводка", { type: "textarea", rows: 3 })}</div></article>${cards}</div>`;
}

function renderProcess() {
  const cards = content.process.steps.map((item, index) => itemCard(index, item.title, `${field(`process.steps.${index}.title`, "Название")}${field(`process.steps.${index}.text`, "Описание", { type: "textarea", rows: 4 })}${field(`process.steps.${index}.note`, "Время / примечание")}`)).join("");
  document.getElementById("panel-process").innerHTML = `<div class="grid"><article class="card span-12"><div class="pair">${field("process.heading", "Заголовок")}${field("process.support", "Подводка", { type: "textarea", rows: 3 })}</div></article>${cards}</div>`;
}

function renderTeam() {
  const cards = content.team.cards.map((item, index) => itemCard(index, item.title, `${field(`team.cards.${index}.title`, "Название")}${field(`team.cards.${index}.text`, "Описание", { type: "textarea", rows: 4 })}`)).join("");
  document.getElementById("panel-team").innerHTML = `<div class="grid"><article class="card span-12"><div class="pair">${field("team.heading", "Заголовок")}${field("team.support", "Подводка", { type: "textarea", rows: 3 })}</div>${field("team.lead", "Описание команды", { type: "textarea", rows: 5 })}</article>${cards}</div>`;
}

function renderTraining() {
  document.getElementById("panel-training").innerHTML = `<div class="grid"><article class="card span-8"><h2>Описание направления</h2>${field("training.heading", "Заголовок")}${field("training.paragraphOne", "Первый абзац", { type: "textarea", rows: 5 })}${field("training.paragraphTwo", "Второй абзац", { type: "textarea", rows: 5 })}</article><article class="card span-4"><h2>Короткие данные</h2>${field("training.direction", "Направления")}${field("training.teacher", "Кто ведёт")}${field("training.schedule", "Программа и даты")}</article></div>`;
}

function renderGallery() {
  const groups = [];
  content.gallery.forEach((item, index) => {
    let group = groups.find((entry) => entry.category === item.category);
    if (!group) {
      group = { category: item.category, items: [] };
      groups.push(group);
    }
    group.items.push({ item, index });
  });
  const cards = groups.map((group) => {
    const groupCards = group.items.map(({ item, index }) => {
      const media = item.type === "video"
        ? `<div class="gallery-thumb gallery-video-thumb"><img src="${esc(item.poster || "")}" alt="" width="1200" height="800" loading="lazy" decoding="async"><span class="media-type">Видео</span></div>`
        : photoPicker({ path: `gallery.${index}.src`, source: item.src, fallback: DEFAULT_CONTENT.gallery[index]?.src || "", mediaKey: `gallery-${index}`, className: "gallery-thumb" });
      const sourceLabel = item.type === "video" ? "Путь к видео" : "Путь или HTTPS-ссылка";
      return `<article class="card gallery-admin-card span-4">${media}<div class="gallery-fields"><span class="item-index">${index + 1}</span><h3>${esc(item.caption || item.category)}</h3>${field(`gallery.${index}.caption`, "Короткая подпись")}${field(`gallery.${index}.alt`, "Описание для поиска", { type: "textarea", rows: 3 })}<details class="manual-source"><summary>${item.type === "video" ? "Настройки видео" : "Указать ссылку вручную"}</summary>${field(`gallery.${index}.src`, sourceLabel)}${item.type === "video" ? field(`gallery.${index}.poster`, "Обложка видео") : ""}</details></div></article>`;
    }).join("");
    return `<div class="gallery-group-head span-12"><div><span>Раздел</span><h2>${esc(group.category)}</h2></div><b>${group.items.length} материалов</b></div>${groupCards}`;
  }).join("");
  document.getElementById("panel-gallery").innerHTML = `<div class="grid">${cards}</div>`;
}

function renderReviews() {
  document.getElementById("panel-reviews").innerHTML = `<div class="grid"><article class="card span-4">${field("reviews.rating", "Рейтинг")}</article><article class="card span-4">${field("reviews.ratingsCount", "Количество оценок")}</article><article class="card span-4">${field("reviews.reviewsCount", "Количество отзывов")}</article><article class="card span-12"><h2>Подпись блока</h2>${field("reviews.support", "Текст", { type: "textarea", rows: 4 })}${field("contact.reviewsUrl", "Ссылка на отзывы Яндекс Карт", { type: "url" })}</article></div>`;
}

function renderFaq() {
  const cards = content.faq.map((item, index) => itemCard(index, item.question, `${field(`faq.${index}.question`, "Вопрос")}${field(`faq.${index}.answer`, "Ответ", { type: "textarea", rows: 6 })}`)).join("");
  document.getElementById("panel-faq").innerHTML = `<div class="grid">${cards}</div>`;
}

function renderContact() {
  document.getElementById("panel-contact").innerHTML = `<div class="grid"><article class="card span-6"><h2>Адрес и режим</h2>${field("contact.address", "Адрес")}${field("contact.metro", "Ближайшее метро")}${field("contact.hours", "Часы работы")}${field("contact.amenities", "Удобства", { type: "textarea", rows: 3 })}${field("contact.mapQuery", "Запрос для карты")}</article><article class="card span-6"><h2>Телефон и ссылки</h2>${field("contact.phoneDisplay", "Телефон на сайте")}${field("contact.phoneE164", "Телефон для ссылки", { hint: "Формат: +79037662968" })}${field("contact.telegramUrl", "Telegram", { type: "url" })}${field("contact.whatsappUrl", "WhatsApp", { type: "url" })}${field("contact.yandexUrl", "Запись на Яндекс Картах", { type: "url" })}</article></div>`;
}

function renderAccount() {
  document.getElementById("panel-account").innerHTML = `<article class="card account-box"><div class="eyebrow">Текущая сессия</div><h2 style="margin-top:12px">Владелец сайта</h2><div class="account-email">${esc(currentUser?.email || "")}</div><form id="passwordForm"><div class="pair">${fieldMarkup("newPassword", "Новый пароль", "password")}${fieldMarkup("repeatPassword", "Повторите пароль", "password")}</div><button class="btn btn-gold" type="submit">Сменить пароль</button></form><p class="card-intro" style="margin-top:20px">Используйте не менее 10 символов. После смены пароль нигде не сохраняется в коде сайта.</p></article>`;
  document.getElementById("passwordForm")?.addEventListener("submit", handlePasswordChange);
}

function fieldMarkup(id, label, type) {
  return `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" name="${id}" type="${type}" minlength="10" required autocomplete="new-password"></div>`;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function compressImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("Выбранный файл не является изображением.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Фото больше 20 МБ. Выберите файл поменьше.");

  let source;
  let objectUrl = "";
  try {
    if (window.createImageBitmap) {
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
    } else {
      objectUrl = URL.createObjectURL(file);
      source = new Image();
      source.src = objectUrl;
      await source.decode();
    }

    const sourceWidth = source.width || source.naturalWidth;
    const sourceHeight = source.height || source.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error("Не удалось определить размер фотографии.");

    let scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#f5eedf";
      context.fillRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);

      const quality = Math.max(.56, .86 - attempt * .06);
      let blob = await canvasBlob(canvas, "image/webp", quality);
      if (!blob || blob.type !== "image/webp") blob = await canvasBlob(canvas, "image/jpeg", quality);
      if (blob && blob.size <= MAX_MEDIA_BYTES) return { blob, width, height };
      scale *= .82;
    }
    throw new Error("Не удалось сжать фото. Попробуйте другой кадр.");
  } catch (error) {
    if (error.message?.startsWith("Не удалось") || error.message?.includes("20 МБ")) throw error;
    throw new Error("Формат не поддерживается браузером. Сохраните фото как JPG и попробуйте снова.");
  } finally {
    if (source?.close) source.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function setUploadStatus(path, message, state = "") {
  const status = document.querySelector(`[data-upload-status="${CSS.escape(path)}"]`);
  if (!status) return;
  status.textContent = message;
  status.className = `upload-status${state ? ` ${state}` : ""}`;
}

function setUploadActivity(delta) {
  activeUploads = Math.max(0, activeUploads + delta);
  saveButton.disabled = activeUploads > 0;
  resetButton.disabled = activeUploads > 0;
  saveButton.textContent = activeUploads > 0 ? "Обработка фото…" : "Опубликовать";
}

async function handlePhotoSelection(input) {
  const file = input.files?.[0];
  if (!file) return;
  const path = input.dataset.photoPath;
  const mediaKey = input.dataset.mediaKey;
  const picker = document.querySelector(`[data-picker-for="${CSS.escape(path)}"]`);
  picker?.classList.add("is-working");
  setUploadActivity(1);
  setUploadStatus(path, "Оптимизируем фотографию…", "working");

  try {
    const { blob, width, height } = await compressImage(file);
    setUploadStatus(path, "Загружаем защищённый черновик…", "working");
    const unique = crypto.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
    const mediaId = `${mediaKey}-${Date.now()}-${unique}`;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await setDoc(doc(db, "media", mediaId), {
      bytes: Bytes.fromUint8Array(bytes),
      contentType: blob.type,
      byteSize: blob.size,
      width,
      height,
      originalName: file.name.slice(0, 140),
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.email || "unknown"
    });

    const previousStagedId = stagedMediaByPath.get(path);
    if (previousStagedId) deleteDoc(doc(db, "media", previousStagedId)).catch(() => {});
    stagedMediaByPath.set(path, mediaId);
    const marker = `${MEDIA_PREFIX}${mediaId}`;
    setPath(content, path, marker);
    const previewUrl = URL.createObjectURL(blob);
    mediaPreviewUrls.set(mediaId, previewUrl);
    const preview = document.querySelector(`[data-preview-for="${CSS.escape(path)}"]`);
    if (preview) preview.src = previewUrl;
    const manualInput = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (manualInput) manualInput.value = marker;
    dirty = true;
    updateSaveState();
    const sizeKb = Math.max(1, Math.round(blob.size / 1024));
    setUploadStatus(path, `Фото готово: ${width} × ${height}, ${sizeKb} КБ. Теперь нажмите «Опубликовать».`, "success");
    if (window.gsap && preview && !reduceMotion.matches) gsap.fromTo(preview, { scale: .92, opacity: .35 }, { scale: 1, opacity: 1, duration: .7, ease: "power3.out" });
  } catch (error) {
    setUploadStatus(path, error.message || "Не удалось загрузить фото.", "error");
  } finally {
    input.value = "";
    picker?.classList.remove("is-working");
    setUploadActivity(-1);
  }
}

function bindPhotoInputs() {
  document.querySelectorAll("[data-photo-path]").forEach((input) => {
    input.addEventListener("change", () => handlePhotoSelection(input));
  });
  document.querySelectorAll("[data-picker-for]").forEach((picker) => {
    picker.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      picker.querySelector("input[type=file]")?.click();
    });
  });
}

async function cleanupStagedMedia() {
  const mediaIds = [...stagedMediaByPath.values()];
  stagedMediaByPath.clear();
  await Promise.allSettled(mediaIds.map((mediaId) => deleteDoc(doc(db, "media", mediaId))));
}

function bindEditorInputs() {
  document.querySelectorAll("[data-path]").forEach((input) => {
    input.addEventListener("input", () => {
      setPath(content, input.dataset.path, input.value);
      dirty = true;
      updateSaveState();
      const preview = document.querySelector(`[data-preview-for="${CSS.escape(input.dataset.path)}"]`);
      if (preview && input.value) preview.src = input.value;
    });
  });
}

function setupTips() {
  const tips = [
    ["Короткие заголовки", "Заголовки в две–три строки читаются лучше и сохраняют премиальный ритм страницы."],
    ["Честные цифры", "Обновляйте рейтинг и число отзывов одновременно с карточкой студии на Яндекс Картах."],
    ["Фотографии работ", "Лучший формат — вертикальный кадр без водяного знака, не менее 1200 пикселей по длинной стороне."]
  ];
  let index = 0;
  const show = () => {
    document.getElementById("tipTitle").textContent = tips[index][0];
    document.getElementById("tipText").textContent = tips[index][1];
  };
  document.getElementById("tipPrev")?.addEventListener("click", () => { index = (index - 1 + tips.length) % tips.length; show(); });
  document.getElementById("tipNext")?.addEventListener("click", () => { index = (index + 1) % tips.length; show(); });
}

function setupOverviewMotion() {
  overviewMotionContext?.revert();
  overviewMotionContext = null;
  const panel = document.getElementById("panel-overview");
  if (!window.gsap || !panel.classList.contains("active") || reduceMotion.matches) return;
  overviewMotionContext = gsap.context(() => {
    gsap.from(".overview-status, .publish-meta, .stat-card", {
      opacity: 0,
      y: 26,
      duration: .65,
      stagger: .07,
      ease: "power3.out"
    });
    if (window.ScrollTrigger && window.innerWidth > 980) {
      gsap.registerPlugin(window.ScrollTrigger);
      ScrollTrigger.create({
        trigger: "#overviewWorkspace",
        start: "top 108px",
        end: "bottom bottom-=110",
        pin: "#overviewPreview",
        pinSpacing: false
      });
      gsap.utils.toArray(".quick-action").forEach((card, index) => {
        gsap.from(card, {
          opacity: .35,
          y: 42 + index * 6,
          scale: .96,
          ease: "none",
          scrollTrigger: {
            trigger: card,
            start: "top 92%",
            end: "top 58%",
            scrub: true
          }
        });
      });
    }
  }, panel);
}

function setupGalleryMotion() {
  galleryMotionContext?.revert();
  galleryMotionContext = null;
  const panel = document.getElementById("panel-gallery");
  if (!window.gsap || !window.ScrollTrigger || !panel.classList.contains("active") || window.innerWidth <= 620 || reduceMotion.matches) return;
  gsap.registerPlugin(window.ScrollTrigger);
  galleryMotionContext = gsap.context(() => {
    gsap.utils.toArray(".gallery-admin-card").forEach((card, index) => {
      const image = card.querySelector("img");
      gsap.fromTo(card, { y: 32 + (index % 3) * 12 }, {
        y: 0,
        ease: "none",
        scrollTrigger: { trigger: card, start: "top 94%", end: "top 62%", scrub: true }
      });
      if (image) {
        gsap.fromTo(image, { scale: .88, opacity: .45 }, {
          scale: 1,
          opacity: 1,
          ease: "none",
          scrollTrigger: { trigger: card, start: "top 94%", end: "top 58%", scrub: true }
        });
      }
    });
  }, panel);
}

function setPreviewMode(mode) {
  const isMobile = mode === "mobile";
  previewFrame.classList.toggle("mobile", isMobile);
  document.querySelectorAll("[data-preview-mode]").forEach((button) => {
    const active = button.dataset.previewMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function reloadPreview() {
  const url = new URL("index.html", window.location.href);
  url.searchParams.set("preview", Date.now());
  previewFrame.src = url.href;
}

function openPreview() {
  previewReturnFocus = document.activeElement;
  setPreviewMode(window.innerWidth <= 620 ? "mobile" : "desktop");
  reloadPreview();
  previewOverlay.classList.remove("hidden");
  previewOverlay.setAttribute("aria-hidden", "false");
  appView.inert = true;
  document.body.classList.add("preview-open");
  closePreviewButton.focus({ preventScroll: true });
  if (window.gsap && !reduceMotion.matches) {
    gsap.fromTo(".preview-dialog", { opacity: 0, y: 22, scale: .985 }, { opacity: 1, y: 0, scale: 1, duration: .42, ease: "power3.out" });
  }
}

function closePreview() {
  previewOverlay.classList.add("hidden");
  previewOverlay.setAttribute("aria-hidden", "true");
  appView.inert = false;
  document.body.classList.remove("preview-open");
  (previewReturnFocus?.isConnected ? previewReturnFocus : previewButton).focus({ preventScroll: true });
  previewReturnFocus = null;
}

function switchPanel(name) {
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.panel === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${name}`));
  const activeTab = document.querySelector(`.tab[data-panel="${name}"]`);
  if (window.innerWidth <= 980) activeTab?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "nearest", inline: "center" });
  const [eyebrow, title, lead] = panelMeta[name];
  document.getElementById("panelEyebrow").textContent = eyebrow;
  document.getElementById("panelTitle").textContent = title;
  document.getElementById("panelLead").textContent = lead;
  window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
  if (window.gsap && !reduceMotion.matches) gsap.from(`#panel-${name} > *`, { opacity: 0, y: 24, duration: .5, ease: "power2.out" });
  if (name === "overview") requestAnimationFrame(setupOverviewMotion);
  else {
    overviewMotionContext?.revert();
    overviewMotionContext = null;
  }
  if (name === "gallery") requestAnimationFrame(setupGalleryMotion);
  else {
    galleryMotionContext?.revert();
    galleryMotionContext = null;
  }
}

function updateSaveState() {
  saveState.textContent = dirty ? "Есть неопубликованные изменения" : "Все изменения опубликованы";
  saveState.classList.toggle("dirty", dirty);
}

function showToast(message, type = "success") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show${type === "error" ? " error" : ""}`;
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3600);
}

async function loadContent() {
  connectionState.textContent = "Загрузка данных";
  try {
    const snapshot = await getDoc(contentRef);
    const snapshotData = snapshot.exists() ? snapshot.data() : null;
    publishedAt = snapshotData?.updatedAt?.toDate?.() || null;
    const storedContent = snapshotData ? deepMerge(cloneDefaults(), snapshotData) : cloneDefaults();
    publishedContent = JSON.parse(JSON.stringify(storedContent));
    const requiresGalleryUpgrade = Boolean(snapshotData) && Number(snapshotData.version || 0) < DEFAULT_CONTENT.version;
    content = JSON.parse(JSON.stringify(storedContent));
    if (requiresGalleryUpgrade) {
      content.version = DEFAULT_CONTENT.version;
      content.gallery = JSON.parse(JSON.stringify(DEFAULT_CONTENT.gallery));
    }
    await preloadMediaPreviews();
    dirty = requiresGalleryUpgrade;
    renderAll();
    updateSaveState();
    connectionState.textContent = requiresGalleryUpgrade ? "Новые материалы готовы к публикации" : snapshot.exists() ? "Данные синхронизированы" : "Готово к первой публикации";
    connectionState.classList.add("online");
    if (requiresGalleryUpgrade) showToast("Новые фотографии и видео готовы. Нажмите «Опубликовать».");
  } catch (error) {
    content = cloneDefaults();
    publishedContent = cloneDefaults();
    renderAll();
    connectionState.textContent = "Нет связи с базой";
    showToast("Не удалось загрузить данные. Проверьте соединение и права доступа.", "error");
    console.error(error);
  }
}

async function saveContent() {
  saveButton.disabled = true;
  resetButton.disabled = true;
  saveButton.textContent = "Публикация…";
  try {
    const previousMediaIds = collectMediaIds(publishedContent);
    const nextMediaIds = collectMediaIds(content);
    const stagedMediaIds = new Set(stagedMediaByPath.values());
    await setDoc(contentRef, { ...content, updatedAt: serverTimestamp() });
    publishedContent = JSON.parse(JSON.stringify(content));
    publishedAt = new Date();
    stagedMediaByPath.clear();
    const unusedMediaIds = new Set([...previousMediaIds, ...stagedMediaIds].filter((mediaId) => !nextMediaIds.has(mediaId)));
    await Promise.allSettled([...unusedMediaIds].map((mediaId) => deleteDoc(doc(db, "media", mediaId))));
    dirty = false;
    updateSaveState();
    const publishedLabel = document.getElementById("lastPublished");
    if (publishedLabel) publishedLabel.textContent = formatPublicationDate(publishedAt);
    connectionState.textContent = "Данные синхронизированы";
    connectionState.classList.add("online");
    showToast("Изменения опубликованы на сайте.");
  } catch (error) {
    showToast("Публикация не удалась. Проверьте соединение и войдите заново.", "error");
    console.error(error);
  } finally {
    saveButton.disabled = false;
    resetButton.disabled = false;
    saveButton.textContent = "Опубликовать";
  }
}

async function handlePasswordChange(event) {
  event.preventDefault();
  const next = document.getElementById("newPassword").value;
  const repeat = document.getElementById("repeatPassword").value;
  if (next !== repeat) return showToast("Пароли не совпадают.", "error");
  try {
    await updatePassword(currentUser, next);
    event.target.reset();
    showToast("Пароль изменён.");
  } catch (error) {
    showToast(error.code === "auth/requires-recent-login" ? "Выйдите и войдите снова перед сменой пароля." : "Не удалось изменить пароль.", "error");
  }
}

function authMessage(code) {
  const messages = {
    "auth/invalid-credential": "Неверный email или пароль.",
    "auth/user-disabled": "Этот аккаунт отключён.",
    "auth/too-many-requests": "Слишком много попыток. Повторите позже.",
    "auth/network-request-failed": "Нет соединения с Firebase."
  };
  return messages[code] || "Не удалось войти. Проверьте данные.";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  loginButton.disabled = true;
  loginButton.textContent = "Проверка…";
  try {
    await signInWithEmailAndPassword(auth, loginForm.email.value.trim(), loginForm.password.value);
  } catch (error) {
    loginError.textContent = authMessage(error.code);
    loginForm.password.focus();
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Войти в кабинет";
  }
});

const tabsRoot = document.getElementById("tabs");
tabsRoot.querySelectorAll(".tab").forEach((tab) => { tab.tabIndex = tab.classList.contains("active") ? 0 : -1; });
tabsRoot.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (tab) switchPanel(tab.dataset.panel);
});
tabsRoot.addEventListener("keydown", (event) => {
  const current = event.target.closest(".tab");
  if (!current || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...tabsRoot.querySelectorAll(".tab")];
  const currentIndex = tabs.indexOf(current);
  let nextIndex = currentIndex;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else nextIndex = (currentIndex + 1) % tabs.length;
  tabs[nextIndex].focus();
  switchPanel(tabs[nextIndex].dataset.panel);
});

document.getElementById("panel-overview").addEventListener("click", (event) => {
  const previewTrigger = event.target.closest("[data-open-preview]");
  if (previewTrigger) return openPreview();
  const jump = event.target.closest("[data-jump-panel]");
  if (jump) switchPanel(jump.dataset.jumpPanel);
});

previewButton.addEventListener("click", openPreview);
closePreviewButton.addEventListener("click", closePreview);
refreshPreviewButton.addEventListener("click", reloadPreview);
previewOverlay.addEventListener("click", (event) => {
  if (event.target === previewOverlay) closePreview();
});
document.querySelectorAll("[data-preview-mode]").forEach((button) => {
  button.addEventListener("click", () => setPreviewMode(button.dataset.previewMode));
});
document.addEventListener("keydown", (event) => {
  if (previewOverlay.classList.contains("hidden")) return;
  if (event.key === "Escape") return closePreview();
  if (event.key !== "Tab") return;
  const focusable = [...previewOverlay.querySelectorAll('button:not([disabled]),a[href],iframe,[tabindex]:not([tabindex="-1"])')].filter((element) => element.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

saveButton.addEventListener("click", saveContent);
resetButton.addEventListener("click", async () => {
  if (!dirty) return showToast("Неопубликованных изменений нет.");
  if (!window.confirm("Отменить все неопубликованные изменения?")) return;
  resetButton.disabled = true;
  await cleanupStagedMedia();
  content = JSON.parse(JSON.stringify(publishedContent));
  dirty = false;
  renderAll();
  updateSaveState();
  resetButton.disabled = false;
  showToast("Неопубликованные правки отменены.");
});
logoutButton.addEventListener("click", async () => {
  await cleanupStagedMedia();
  await signOut(auth);
});

window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    await loadContent();
    if (window.gsap && !reduceMotion.matches) gsap.from(".topbar, .sidebar, .content", { opacity: 0, y: 14, duration: .65, stagger: .08, ease: "power2.out" });
  } else {
    appView.classList.add("hidden");
    loginView.classList.remove("hidden");
    loginForm.reset();
    if (window.gsap && !reduceMotion.matches) gsap.from(".login-copy > *, .login-form > *", { opacity: 0, y: 22, duration: .7, stagger: .06, ease: "power3.out" });
  }
});
