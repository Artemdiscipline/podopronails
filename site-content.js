import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const text = (selector, value) => {
  const node = document.querySelector(selector);
  if (node && value !== undefined && value !== null) node.textContent = value;
};

const hrefAll = (selector, value) => {
  if (!value) return;
  document.querySelectorAll(selector).forEach((node) => node.setAttribute("href", value));
};

function applyContent(data) {
  if (!data || typeof data !== "object") return;

  const { general = {}, hero = {}, podology = {}, process = {}, team = {}, training = {}, gallery = [], reviews = {}, faq = [], contact = {} } = data;

  if (general.siteTitle) document.title = general.siteTitle;
  const description = document.querySelector('meta[name="description"]');
  if (description && general.siteDescription) description.content = general.siteDescription;
  document.querySelectorAll(".logo-text .l1").forEach((el) => { if (general.studioName) el.textContent = general.studioName; });
  document.querySelectorAll(".logo-text .l2").forEach((el) => { if (general.ownerName) el.textContent = general.ownerName; });

  text(".hero-copy .eyebrow", hero.eyebrow);
  const title = document.querySelector("[data-hero-title]");
  if (title && (hero.titleBefore || hero.titleAccent || hero.titleAfter)) {
    title.innerHTML = `${escapeHtml(hero.titleBefore)} <span class="gold-run">${escapeHtml(hero.titleAccent)}</span> ${escapeHtml(hero.titleAfter)}`;
  }
  text(".hero-copy .lead", hero.lead);
  const heroStats = document.querySelectorAll(".hero-stats .stat b");
  [hero.rating, hero.ratingsCount, hero.mastersCount].forEach((value, index) => {
    if (heroStats[index] && value !== undefined) {
      const normalized = String(value).replace(",", ".");
      heroStats[index].textContent = value;
      heroStats[index].dataset.count = normalized;
    }
  });
  const heroImage = document.querySelector(".hero-media img");
  if (heroImage && hero.imageUrl) heroImage.src = hero.imageUrl;
  if (heroImage && hero.imageAlt) heroImage.alt = hero.imageAlt;

  text("#podologiya .section-head h2", podology.heading);
  text("#podologiya .section-head .support", podology.support);
  document.querySelectorAll("#podologiya .bento-card").forEach((card, index) => {
    const item = podology.services?.[index];
    if (!item) return;
    textIn(card, "h3", item.title);
    textIn(card, "p", item.text);
  });

  text("#process .section-head h2", process.heading);
  text("#process .section-head .support", process.support);
  document.querySelectorAll("#process .step").forEach((card, index) => {
    const item = process.steps?.[index];
    if (!item) return;
    textIn(card, "h3", item.title);
    textIn(card, "p", item.text);
    textIn(card, ".step-time", item.note);
  });

  text("#team .section-head h2", team.heading);
  text("#team .section-head .support", team.support);
  text("#team .team-lead", team.lead);
  document.querySelectorAll("#team .team-card").forEach((card, index) => {
    const item = team.cards?.[index];
    if (!item) return;
    textIn(card, "h3", item.title);
    textIn(card, "p", item.text);
  });

  text("#obuchenie .edu-copy h2", training.heading);
  const trainingParagraphs = document.querySelectorAll("#obuchenie .edu-copy p");
  if (trainingParagraphs[0] && training.paragraphOne) trainingParagraphs[0].textContent = training.paragraphOne;
  if (trainingParagraphs[1] && training.paragraphTwo) trainingParagraphs[1].textContent = training.paragraphTwo;
  const trainingRows = document.querySelectorAll("#obuchenie .edu-side li");
  const trainingValues = [training.direction, training.teacher, training.schedule];
  trainingRows.forEach((row, index) => {
    const label = row.querySelector("b")?.textContent || "";
    if (trainingValues[index]) row.innerHTML = `<b>${escapeHtml(label)}</b>${escapeHtml(trainingValues[index])}`;
  });

  document.querySelectorAll("#gallery .gallery-item").forEach((card, index) => {
    const item = gallery[index];
    if (!item) return;
    const image = card.querySelector("img");
    const caption = card.querySelector(".cap");
    if (image && item.src) image.src = item.src;
    if (image && item.alt) image.alt = item.alt;
    if (caption && item.caption) caption.textContent = item.caption;
  });

  const reviewNumbers = document.querySelectorAll("#reviews .reviews-cta b");
  [reviews.rating, reviews.ratingsCount, reviews.reviewsCount].forEach((value, index) => {
    if (reviewNumbers[index] && value !== undefined) reviewNumbers[index].textContent = value;
  });
  text("#reviews .reviews-cta .support", reviews.support);

  document.querySelectorAll("#faq .faq-item").forEach((item, index) => {
    const entry = faq[index];
    if (!entry) return;
    textIn(item, ".faq-q", entry.question);
    textIn(item, ".faq-a p", entry.answer);
  });

  const contactRows = document.querySelectorAll("#contacts .action-info .row");
  setContactRow(contactRows[0], "Адрес", contact.address);
  setContactRow(contactRows[1], "Метро", contact.metro);
  setContactRow(contactRows[2], "Часы работы", contact.hours);
  setContactRow(contactRows[3], "В студии", contact.amenities);
  if (contactRows[4] && contact.phoneDisplay) {
    const box = contactRows[4].querySelector("div");
    if (box) {
      box.innerHTML = `<b>Телефон</b>${escapeHtml(contact.phoneDisplay)}<div class="action-links"><a href="${escapeHtml(contact.telegramUrl)}" target="_blank" rel="noopener">Telegram</a><a href="${escapeHtml(contact.whatsappUrl)}" target="_blank" rel="noopener">WhatsApp</a><span class="no-link">MAX — по номеру</span></div>`;
    }
  }

  hrefAll('a[href*="yandex.ru/maps/org/podopronails"]:not([href*="/reviews/"])', contact.yandexUrl);
  hrefAll('a[href*="yandex.ru/maps/org/podopronails"][href*="/reviews/"]', contact.reviewsUrl);
  hrefAll('a[href^="tel:"]', contact.phoneE164 ? `tel:${contact.phoneE164}` : "");
  hrefAll('a[href*="t.me/"]', contact.telegramUrl);
  hrefAll('a[href*="wa.me/"]', contact.whatsappUrl);
  const map = document.querySelector(".map-wrap iframe");
  if (map && contact.mapQuery) map.src = `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(contact.mapQuery)}&z=16`;

  document.documentElement.dataset.cmsReady = "true";
  window.dispatchEvent(new CustomEvent("cms:updated", { detail: data }));
}

function textIn(root, selector, value) {
  const node = root?.querySelector(selector);
  if (node && value !== undefined && value !== null) node.textContent = value;
}

function setContactRow(row, label, value) {
  if (!row || !value) return;
  const box = row.querySelector("div");
  if (box) box.innerHTML = `<b>${escapeHtml(label)}</b>${escapeHtml(value)}`;
}

try {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  onSnapshot(doc(db, "site", "content"), (snapshot) => {
    if (snapshot.exists()) applyContent(snapshot.data());
  }, (error) => {
    console.warn("CMS is unavailable; static content remains active.", error.code || error.message);
  });
} catch (error) {
  console.warn("CMS initialization skipped; static content remains active.", error.message);
}
