import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
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

let content = cloneDefaults();
let publishedContent = cloneDefaults();
let currentUser = null;
let dirty = false;
let toastTimer = null;

const panelMeta = {
  overview: ["Сводка", "Управление сайтом", "Весь важный контент собран в одном месте. Откройте раздел, внесите изменения и опубликуйте."],
  general: ["Первый экран", "Главная страница", "Заголовок, ключевое обещание, рейтинг и изображение первого экрана."],
  podology: ["Услуги", "Подология", "Основные проблемы, с которыми работает студия."],
  process: ["Сценарий визита", "Этапы приёма", "Объясните клиенту путь от осмотра до рекомендаций."],
  team: ["Стандарты", "Команда студии", "Преимущества и общие правила работы мастеров."],
  training: ["Для мастеров", "Обучение", "Направления, описание и контакт для записи на обучение."],
  gallery: ["Портфолио", "Галерея работ", "Ссылки на изображения, подписи и альтернативный текст для поиска."],
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
  const control = type === "textarea"
    ? `<textarea data-path="${esc(path)}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input data-path="${esc(path)}" type="${esc(type)}" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return `<div class="field"><label>${esc(label)}</label>${control}${hint ? `<small style="color:var(--muted);line-height:1.4">${esc(hint)}</small>` : ""}</div>`;
}

function itemCard(index, title, inner) {
  return `<article class="card item-card span-6"><span class="item-index">${index + 1}</span><h3>${esc(title)}</h3>${inner}</article>`;
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
}

function renderOverview() {
  const panel = document.getElementById("panel-overview");
  panel.innerHTML = `<div class="grid">
    <article class="card stat-card span-4"><span>Рейтинг</span><b>${esc(content.hero.rating)}</b><span>по данным сайта</span></article>
    <article class="card stat-card span-4"><span>Оценки</span><b>${esc(content.hero.ratingsCount)}</b><span>на Яндекс Картах</span></article>
    <article class="card stat-card span-4"><span>Материалы</span><b>${content.gallery.length}</b><span>фотографий в галерее</span></article>
    <article class="card preview-card span-8"><img src="${esc(content.hero.imageUrl)}" alt=""><div class="eyebrow">Первый экран</div><h2>${esc(content.hero.titleBefore)} ${esc(content.hero.titleAccent)} ${esc(content.hero.titleAfter)}</h2></article>
    <article class="card span-4" id="tipCard"><div class="eyebrow">Редакторская подсказка</div><h2 style="margin-top:18px" id="tipTitle">Короткие заголовки</h2><p class="card-intro" id="tipText">Заголовки в две–три строки читаются лучше и сохраняют премиальный ритм страницы.</p><div style="display:flex;gap:8px"><button class="btn btn-ghost" type="button" id="tipPrev">Назад</button><button class="btn btn-ghost" type="button" id="tipNext">Далее</button></div></article>
  </div>`;
  setupTips();
}

function renderGeneral() {
  document.getElementById("panel-general").innerHTML = `<div class="grid">
    <article class="card span-6"><h2>Метаданные</h2><p class="card-intro">Название страницы и описание для поисковых систем.</p>${field("general.siteTitle", "Заголовок вкладки")}${field("general.siteDescription", "Описание сайта", { type: "textarea", rows: 4 })}${field("general.studioName", "Название студии")}${field("general.ownerName", "Подпись владельца")}</article>
    <article class="card span-6"><h2>Hero</h2><p class="card-intro">Главное обещание сайта. Акцентная часть выделяется золотым.</p>${field("hero.eyebrow", "Надзаголовок")}${field("hero.titleBefore", "Заголовок: начало")}${field("hero.titleAccent", "Заголовок: золотой акцент")}${field("hero.titleAfter", "Заголовок: окончание")}${field("hero.lead", "Описание", { type: "textarea", rows: 5 })}</article>
    <article class="card span-4">${field("hero.rating", "Рейтинг")}</article><article class="card span-4">${field("hero.ratingsCount", "Количество оценок")}</article><article class="card span-4">${field("hero.mastersCount", "Количество мастеров")}</article>
    <article class="card span-12"><h2>Изображение первого экрана</h2><p class="card-intro">Можно указать путь из папки assets или прямую HTTPS-ссылку.</p><div class="pair">${field("hero.imageUrl", "Адрес изображения")}${field("hero.imageAlt", "Описание изображения")}</div></article>
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
  const cards = content.gallery.map((item, index) => `<article class="card gallery-admin-card span-4"><div class="gallery-thumb"><img src="${esc(item.src)}" alt="" data-preview-for="gallery.${index}.src"></div><div class="gallery-fields"><span class="item-index">${index + 1}</span><h3>${esc(item.category)}</h3>${field(`gallery.${index}.src`, "Путь или URL изображения")}${field(`gallery.${index}.caption`, "Короткая подпись")}${field(`gallery.${index}.alt`, "Описание для поиска", { type: "textarea", rows: 3 })}</div></article>`).join("");
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
  return `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" minlength="10" required autocomplete="new-password"></div>`;
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

function switchPanel(name) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.panel === name));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${name}`));
  const [eyebrow, title, lead] = panelMeta[name];
  document.getElementById("panelEyebrow").textContent = eyebrow;
  document.getElementById("panelTitle").textContent = title;
  document.getElementById("panelLead").textContent = lead;
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (window.gsap) gsap.from(`#panel-${name} > *`, { opacity: 0, y: 24, duration: .5, ease: "power2.out" });
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
    content = snapshot.exists() ? deepMerge(cloneDefaults(), snapshot.data()) : cloneDefaults();
    publishedContent = JSON.parse(JSON.stringify(content));
    dirty = false;
    renderAll();
    updateSaveState();
    connectionState.textContent = snapshot.exists() ? "Данные синхронизированы" : "Готово к первой публикации";
    connectionState.classList.add("online");
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
  saveButton.textContent = "Публикация...";
  try {
    await setDoc(contentRef, { ...content, updatedAt: serverTimestamp() });
    publishedContent = JSON.parse(JSON.stringify(content));
    dirty = false;
    updateSaveState();
    connectionState.textContent = "Данные синхронизированы";
    connectionState.classList.add("online");
    showToast("Изменения опубликованы на сайте.");
  } catch (error) {
    showToast("Публикация не удалась. Проверьте соединение и войдите заново.", "error");
    console.error(error);
  } finally {
    saveButton.disabled = false;
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
  loginButton.textContent = "Проверка...";
  try {
    await signInWithEmailAndPassword(auth, loginForm.email.value.trim(), loginForm.password.value);
  } catch (error) {
    loginError.textContent = authMessage(error.code);
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Войти в кабинет";
  }
});

document.getElementById("tabs").addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (tab) switchPanel(tab.dataset.panel);
});

saveButton.addEventListener("click", saveContent);
resetButton.addEventListener("click", () => {
  content = JSON.parse(JSON.stringify(publishedContent));
  dirty = false;
  renderAll();
  updateSaveState();
  showToast("Неопубликованные правки отменены.");
});
logoutButton.addEventListener("click", () => signOut(auth));

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
    if (window.gsap) gsap.from(".topbar, .sidebar, .content", { opacity: 0, y: 14, duration: .65, stagger: .08, ease: "power2.out" });
  } else {
    appView.classList.add("hidden");
    loginView.classList.remove("hidden");
    loginForm.reset();
    document.getElementById("email").value = "karazanow@gmail.com";
    if (window.gsap) gsap.from(".login-copy > *, .login-form > *", { opacity: 0, y: 22, duration: .7, stagger: .06, ease: "power3.out" });
  }
});
