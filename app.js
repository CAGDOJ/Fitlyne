"use strict";

const C = window.FITLYNE_CONFIG;

if (!C || !String(C.API_URL || "").startsWith("https://script.google.com/macros/s/")) {
  throw new Error("Configuração inválida. Edite somente o arquivo fitlyne-config.js.");
}

const FITLYNE_API_URL = C.API_URL;
const ADMIN_SNAPSHOT_KEY = `fitlyneAdminSnapshot:${C.BUILD || "atual"}`;
console.info("FITLYNE painel ativo", { build: C.BUILD, api: FITLYNE_API_URL });
window.FITLYNE_DIAGNOSTICO = () => ({
  build: C.BUILD,
  api: C.API_URL,
  cloudinary: C.CLOUDINARY_CLOUD_NAME,
  preset: C.CLOUDINARY_UPLOAD_PRESET,
  app: "painel"
});

const ADMIN_TOKEN_KEY = "fitlyneAdminToken";
const ADMIN_TOKEN_TIME_KEY = "fitlyneAdminTokenSavedAt";
const ADMIN_TOKEN_MAX_AGE = 5.5 * 60 * 60 * 1000;

function readStoredToken() {
  try {
    const savedAt = Number(localStorage.getItem(ADMIN_TOKEN_TIME_KEY) || 0);
    const token = localStorage.getItem(ADMIN_TOKEN_KEY) || sessionStorage.getItem("fitlyneToken") || "";
    if (token && savedAt && Date.now() - savedAt < ADMIN_TOKEN_MAX_AGE) return token;
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_TOKEN_TIME_KEY);
    sessionStorage.removeItem("fitlyneToken");
  } catch (error) {
    return sessionStorage.getItem("fitlyneToken") || "";
  }
  return "";
}

function storeToken(token) {
  state.token = token || "";
  sessionStorage.setItem("fitlyneToken", state.token);
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, state.token);
    localStorage.setItem(ADMIN_TOKEN_TIME_KEY, String(Date.now()));
  } catch (error) {}
}

function clearStoredToken() {
  sessionStorage.removeItem("fitlyneToken");
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_TOKEN_TIME_KEY);
  } catch (error) {}
  state.token = "";
}

const state = {
  token: readStoredToken(),
  products: [],
  photos: [],
  variants: [],
  movements: [],
  sales: [],
  clients: [],
  expenses: [],
  requests: [],
  metrics: [],
  whatsappApi: {},
  config: {},
  pendingFiles: [],
  editingId: null,
  view: "login"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const uid = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
})[char]);

const sameId = (left, right) => String(left ?? "").trim() === String(right ?? "").trim();
const numberValue = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

function isProductActive(product) {
  const value = String(product?.ATIVO ?? "").trim().toUpperCase();
  // Produtos antigos sem valor em ATIVO continuam publicados. Só ocultamos quando houver marcação explícita.
  return !["NAO", "NÃO", "FALSE", "0", "INATIVO", "OCULTO"].includes(value);
}

function normalizedNiche(value) {
  const text = String(value ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (text.includes("FIT")) return "FITNESS";
  if (text.includes("SKIN") || text.includes("PELE")) return "SKINCARE";
  if (text.includes("MAKE") || text.includes("MAQUI")) return "MAKEUP";
  return text;
}

function saleIsActive(sale) {
  return !["CANCELADA", "CANCELADO", "EXCLUIDA", "EXCLUÍDA"].includes(String(sale?.STATUS || "ATIVA").trim().toUpperCase());
}


function normalizeClientName(value) {
  return String(value || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function consolidatedClients() {
  const map = new Map();
  (state.clients || []).forEach((client) => {
    const nameKey = normalizeClientName(client.NOME);
    const phoneKey = String(client.TELEFONE || "").replace(/\D/g, "");
    const key = nameKey ? `N:${nameKey}` : `P:${phoneKey}`;
    if (!key || key === "P:") return;
    if (!map.has(key)) map.set(key, { ...client, COMPRAS: 0, TOTAL_GASTO: 0 });
    const target = map.get(key);
    target.COMPRAS += numberValue(client.COMPRAS);
    target.TOTAL_GASTO += numberValue(client.TOTAL_GASTO);
    if (client.TELEFONE) target.TELEFONE = client.TELEFONE;
    if (client.NOME) target.NOME = client.NOME;
  });
  return [...map.values()].sort((a, b) => String(a.NOME || "").localeCompare(String(b.NOME || ""), "pt-BR"));
}

function productVariants(productId) {
  return state.variants.filter((variant) => sameId(variant.ID_PRODUTO, productId));
}

function catalogGroupRoot(product) {
  return String(product?.GRUPO_CATALOGO || product?.ID || "").trim();
}

function populateCatalogGroupSelect(currentProductId = "", selectedGroup = "") {
  const select = $("#catalogGroup");
  if (!select) return;
  const groups = new Map();
  state.products.filter(isProductActive).forEach((product) => {
    if (sameId(product.ID, currentProductId)) return;
    const root = catalogGroupRoot(product);
    if (!root || sameId(root, currentProductId)) return;
    if (!groups.has(root)) groups.set(root, product);
  });
  const current = String(selectedGroup || "").trim();
  select.innerHTML = '<option value="">Não agrupar — produto independente</option>' + [...groups.entries()].map(([root, product]) => {
    const label = [product.NOME, product.MARCA, product.COR_TOM].filter(Boolean).join(" · ");
    return `<option value="${escapeHtml(root)}">Agrupar com ${escapeHtml(label || product.SKU || root)}</option>`;
  }).join("");
  if (current && [...select.options].some((option) => sameId(option.value, current))) select.value = current;
  else select.value = "";
}

function variantLabel(variant) {
  const raw = String(variant?.MODELO || variant?.VALOR || variant?.TAMANHO || "").trim();
  const normalized = normalizeClientName(raw);
  return !raw || ["NA", "N/A", "PADRAO"].includes(normalized) ? "Padrão" : raw;
}

function fillVariantSelect(select, productId, selectedId = "") {
  if (!select) return null;
  const variants = productVariants(productId);
  if (!productId) {
    select.innerHTML = '<option value="">Selecione o produto primeiro</option>';
    select.disabled = true;
    return null;
  }
  if (!variants.length) {
    select.innerHTML = '<option value="">Sem variação</option>';
    select.disabled = true;
    return null;
  }
  if (variants.length === 1) {
    const variant = variants[0];
    select.innerHTML = `<option value="${escapeHtml(variant.ID)}">${escapeHtml(variantLabel(variant))} — estoque ${numberValue(variant.ESTOQUE)}</option>`;
    select.value = String(variant.ID);
    select.disabled = true;
    return variant;
  }
  select.disabled = false;
  select.innerHTML = '<option value="">Selecione o modelo / variação</option>' + variants.map((variant) => `<option value="${escapeHtml(variant.ID)}">${escapeHtml(variantLabel(variant))} — estoque ${numberValue(variant.ESTOQUE)}</option>`).join("");
  if (selectedId && variants.some((variant) => sameId(variant.ID, selectedId))) select.value = String(selectedId);
  return variants.find((variant) => sameId(variant.ID, select.value)) || null;
}

function populateSaleVariantSelect(selectedId = "") {
  return fillVariantSelect($("#saleVariant"), $("#saleProduct")?.value || "", selectedId);
}

function populateStockVariantSelect(selectedId = "") {
  return fillVariantSelect($("#stockVariant"), $("#stockProduct")?.value || "", selectedId);
}

function populateClientSuggestions() {
  const clients = consolidatedClients();
  const datalist = $("#saleClientOptions");
  if (datalist) datalist.innerHTML = clients.map((client) => `<option value="${escapeHtml(client.NOME || "")}">${escapeHtml(client.TELEFONE || "")} · ${client.COMPRAS || 0} compras · ${money(client.TOTAL_GASTO)}</option>`).join("");
  const select = $("#saleKnownClient");
  if (select) {
    const current = select.value;
    select.innerHTML = '<option value="">Nova cliente / digitar nome</option>' + clients.map((client) => `<option value="${escapeHtml(client.ID || client.NOME || "")}">${escapeHtml(client.NOME || "Cliente")} · ${client.COMPRAS || 0} compras · ${money(client.TOTAL_GASTO)}</option>`).join("");
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }
}

function applyKnownClient(client) {
  if (!client) return;
  $("#saleClient").value = client.NOME || "";
  $("#salePhone").value = client.TELEFONE || "";
}

function findClientByTypedName(name) {
  const key = normalizeClientName(name);
  return consolidatedClients().find((client) => normalizeClientName(client.NOME) === key) || null;
}

function normalizeLoadedData(data) {
  state.products = Array.isArray(data.products) ? data.products.map((product) => ({ ...product, ID: String(product.ID ?? "").trim(), NICHO: normalizedNiche(product.NICHO) })) : [];
  state.photos = Array.isArray(data.photos) ? data.photos.map((photo) => ({
    ...photo,
    ID: String(photo.ID ?? "").trim(),
    ID_PRODUTO: String(photo.ID_PRODUTO ?? "").trim(),
    URL_ORIGINAL: String(photo.URL_ORIGINAL || "").trim(),
    URL_CATALOGO: String(photo.URL_CATALOGO || "").trim(),
    URL_FEED: String(photo.URL_FEED || "").trim()
  })) : [];
  state.variants = Array.isArray(data.variants) ? data.variants.map((variant) => ({ ...variant, ID_PRODUTO: String(variant.ID_PRODUTO ?? "").trim() })) : [];
  state.movements = Array.isArray(data.movements) ? data.movements : [];
  state.sales = Array.isArray(data.sales) ? data.sales : [];
  state.clients = Array.isArray(data.clients) ? data.clients : [];
  state.expenses = Array.isArray(data.expenses) ? data.expenses : [];
  state.requests = Array.isArray(data.requests) ? data.requests : [];
  state.metrics = Array.isArray(data.metrics) ? data.metrics : [];
  state.whatsappApi = data.whatsappApi || {};
  state.config = data.config || {};
}

const STATUS_OPTIONS = [
  ["AUTOMATICO", "Automático pelo estoque"],
  ["DISPONIVEL", "Disponível"],
  ["ESGOTADO", "Esgotado"],
  ["REPOSICAO", "Reposição em breve"]
];

function toast(message) {
  const element = $("#toast");
  if (!element) return console.log(message);
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(window.__fitlyneToast);
  window.__fitlyneToast = setTimeout(() => element.classList.remove("show"), 4200);
}

function setLoginMessage(message = "", type = "") {
  const element = $("#loginMessage");
  if (!element) return;
  element.textContent = message;
  element.className = `login-message ${type}`.trim();
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits;
}

function validWhatsapp(value) {
  const digits = normalizePhone(value);
  return /^55\d{10,11}$/.test(digits) || /^\d{12,15}$/.test(digits);
}

function openWhatsapp(phone, message) {
  const digits = normalizePhone(phone);
  if (!validWhatsapp(digits)) {
    toast("Configure um WhatsApp válido com DDI + DDD + número.");
    return false;
  }
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    window.location.href = url;
  } else {
    const popup = window.open(url, "_blank");
    if (!popup) window.location.href = url;
  }
  return true;
}

function saveAdminSnapshot() {
  try {
    const data = {
      products: state.products, photos: state.photos, variants: state.variants, movements: state.movements,
      sales: state.sales, clients: state.clients, expenses: state.expenses, requests: state.requests,
      whatsappApi: state.whatsappApi, config: state.config
    };
    localStorage.setItem(ADMIN_SNAPSHOT_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    console.warn("Não foi possível salvar o acesso rápido:", error);
  }
}

function loadAdminSnapshot() {
  try {
    Object.keys(localStorage).filter((key) => key.startsWith("fitlyneAdminSnapshot:") && key !== ADMIN_SNAPSHOT_KEY).forEach((key) => localStorage.removeItem(key));
    const snapshot = JSON.parse(localStorage.getItem(ADMIN_SNAPSHOT_KEY) || "null");
    if (!snapshot?.data) return false;
    applyLoadedData(snapshot.data, false);
    return true;
  } catch (error) {
    localStorage.removeItem(ADMIN_SNAPSHOT_KEY);
    return false;
  }
}

function setButtonBusy(button, label) {
  if (!button) return () => {};
  const original = button.innerHTML;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
  return () => {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = original;
  };
}

let pendingSyncOperations = 0;
let syncHideTimer = null;

function setSyncState(mode, message) {
  const box = $("#syncStatus");
  const label = $("#syncStatusText");
  if (!box || !label) return;
  clearTimeout(syncHideTimer);
  box.hidden = false;
  box.className = `sync-status ${mode || ""}`.trim();
  label.textContent = message || "Tudo salvo";
  if (mode === "saved") {
    syncHideTimer = setTimeout(() => { if (pendingSyncOperations === 0) box.hidden = true; }, 1500);
  }
}

function beginSync(message = "Salvando...") {
  pendingSyncOperations += 1;
  setSyncState("saving", message);
  let finished = false;
  return {
    success(message = "Tudo salvo") {
      if (finished) return;
      finished = true;
      pendingSyncOperations = Math.max(0, pendingSyncOperations - 1);
      if (pendingSyncOperations > 0) setSyncState("saving", "Salvando alterações...");
      else setSyncState("saved", message);
    },
    error(message = "Não foi possível salvar") {
      if (finished) return;
      finished = true;
      pendingSyncOperations = Math.max(0, pendingSyncOperations - 1);
      setSyncState("error", message);
      syncHideTimer = setTimeout(() => { if (pendingSyncOperations === 0) $("#syncStatus").hidden = true; }, 4000);
    }
  };
}

function prewarmApi() {
  fetch(`${FITLYNE_API_URL}?warm=${Date.now()}`, { cache: "no-store", redirect: "follow" }).catch(() => {});
}

async function api(action, payload = {}, auth = true, timeoutMs = 30000) {
  if (!FITLYNE_API_URL) throw new Error("API da Fitlyne não configurada.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(FITLYNE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload, token: auth ? state.token : "" }),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
    const raw = await response.text();
    let output;
    try {
      output = JSON.parse(raw);
    } catch (error) {
      throw new Error(`A API não retornou JSON (HTTP ${response.status}). Confirme se a implantação está como “Qualquer pessoa” e se a URL termina em /exec.`);
    }
    if (!response.ok || !output.ok) throw new Error(output.error || `Erro na API (HTTP ${response.status})`);
    return output.data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("A operação demorou demais. Verifique a internet e tente novamente.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isAuthenticated() {
  return Boolean(state.token);
}

function setAuthenticatedUI(authenticated) {
  document.body.classList.toggle("authenticated", authenticated);
  document.body.classList.toggle("guest", !authenticated);
  const menu = $("#menuBtn");
  const drawer = $("#drawer");
  menu.hidden = !authenticated;
  menu.disabled = !authenticated;
  drawer.hidden = !authenticated;
  closeDrawer();
}

function openDrawer() {
  if (!isAuthenticated()) return showView("login");
  const drawer = $("#drawer");
  const backdrop = $("#backdrop");
  drawer.hidden = false;
  backdrop.hidden = false;
  drawer.classList.add("open");
  backdrop.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  $("#menuBtn").setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  const drawer = $("#drawer");
  const backdrop = $("#backdrop");
  if (!drawer || !backdrop) return;
  drawer.classList.remove("open");
  backdrop.classList.remove("open");
  backdrop.hidden = true;
  drawer.setAttribute("aria-hidden", "true");
  $("#menuBtn")?.setAttribute("aria-expanded", "false");
  if (!isAuthenticated()) drawer.hidden = true;
}

function showView(name) {
  if (name !== "login" && !isAuthenticated()) name = "login";
  state.view = name;
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${name}View`)?.classList.add("active");
  closeDrawer();
  if (name === "dashboard") renderDashboard();
  if (name === "products") renderProducts();
  if (name === "stock") { renderCurrentStock(); renderMovements(); }
  if (name === "sales") renderSales();
  if (name === "requests") renderRequests();
  if (name === "clients") renderClients();
  if (name === "finance") renderFinance();
  if (name === "settings") renderSettings();
  window.scrollTo(0, 0);
}

function applyLoadedData(data, persist = true) {
  normalizeLoadedData(data || {});
  $("#brandName").textContent = state.config.NOME_LOJA || C.STORE_NAME;
  $("#brandSubtitle").textContent = state.config.SUBTITULO || C.STORE_SUBTITLE;
  populateProductSelects();
  renderWhatsappWarning();
  updateRequestIndicators();
  if (persist) saveAdminSnapshot();
}

async function login(event) {
  event?.preventDefault?.();
  const pinInput = $("#pinInput");
  const pin = pinInput.value.trim();
  if (!pin) {
    setLoginMessage("Digite o PIN administrativo.", "error");
    pinInput.focus();
    return;
  }

  const button = $("#loginBtn");
  const restoreButton = setButtonBusy(button, "Entrando...");
  pinInput.disabled = true;
  setLoginMessage("Verificando o acesso...", "loading");

  try {
    // O login devolve apenas o token. A tela abre imediatamente e os dados atualizam em segundo plano.
    const result = await api("login", { pin }, false, 20000);
    if (!result?.token) throw new Error("A API não devolveu uma sessão válida.");

    storeToken(result.token);
    if (result.config) state.config = { ...state.config, ...result.config };
    $("#brandName").textContent = state.config.NOME_LOJA || C.STORE_NAME;
    $("#brandSubtitle").textContent = state.config.SUBTITULO || C.STORE_SUBTITLE;

    const hadSnapshot = loadAdminSnapshot();
    setAuthenticatedUI(true);
    showView("dashboard");
    setLoginMessage("");
    toast(hadSnapshot ? "Acesso liberado. Atualizando os dados..." : "Acesso liberado. Carregando os dados...");

    // Atualiza online sem segurar a entrada no painel.
    loadAll().then(() => {
      if (state.view === "dashboard") renderDashboard();
      toast("Dados atualizados.");
    }).catch((error) => {
      console.error(error);
      toast(hadSnapshot ? "Você está usando os últimos dados salvos. A atualização online falhou." : error.message);
    });
  } catch (error) {
    clearStoredToken();
    const message = error?.message || "Não foi possível entrar.";
    setLoginMessage(message, "error");
    toast(message);
    pinInput.select();
  } finally {
    restoreButton();
    pinInput.disabled = false;
    if (!isAuthenticated()) pinInput.focus();
  }
}

async function loadAll() {
  const data = await api("bootstrap", {}, true, 25000);
  applyLoadedData(data);
}

function logout() {
  clearStoredToken();
  setAuthenticatedUI(false);
  showView("login");
  setTimeout(() => $("#pinInput")?.focus(), 0);
}

function productStatus(product) {
  let value = String(product.STATUS_CATALOGO || "AUTOMATICO").trim().toUpperCase();
  if (!STATUS_OPTIONS.some(([key]) => key === value)) value = "AUTOMATICO";
  const stock = numberValue(product.ESTOQUE_ATUAL);
  if (value === "AUTOMATICO") value = stock > 0 ? "DISPONIVEL" : "ESGOTADO";
  if (value === "DISPONIVEL" && stock <= 0) value = "ESGOTADO";
  return value;
}

function statusLabel(value) {
  return ({ DISPONIVEL: "Disponível", ESGOTADO: "Esgotado", REPOSICAO: "Reposição em breve", AUTOMATICO: "Automático" })[value] || "Automático";
}

function statusClass(value) {
  return ({ DISPONIVEL: "available", ESGOTADO: "sold-out", REPOSICAO: "restock", AUTOMATICO: "automatic" })[value] || "automatic";
}

function renderWhatsappWarning() {
  const warning = $("#whatsappWarning");
  if (!warning) return;
  warning.classList.toggle("hidden", validWhatsapp(state.config.WHATSAPP));
}

function renderDashboard() {
  const active = state.products.filter(isProductActive);
  const stock = active.reduce((total, product) => total + numberValue(product.ESTOQUE_ATUAL), 0);
  const low = active.filter((product) => {
    const current = numberValue(product.ESTOQUE_ATUAL);
    const minimum = numberValue(product.ESTOQUE_MINIMO);
    return current > 0 && minimum > 0 && current < minimum;
  });
  const revenue = state.sales.filter(saleIsActive).reduce((total, sale) => total + Number(sale.TOTAL || 0), 0);
  $("#stats").innerHTML = [
    ["Produtos", active.length], ["Estoque", stock], ["Estoque baixo", low.length], ["Faturamento", money(revenue)]
  ].map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  $("#lowStockList").innerHTML = low.length
    ? low.slice(0, 8).map((product) => `<div class="list-item"><div><b>${escapeHtml(product.NOME)}</b><small>${escapeHtml(product.TAMANHO_EXIBICAO || "")} · ${escapeHtml(product.COR_TOM || "")}</small></div><span class="badge">${product.ESTOQUE_ATUAL}</span></div>`).join("")
    : '<p class="muted">Nenhum produto com estoque baixo.</p>';
  const pending = state.requests.filter((request) => !["ATENDIDO", "CANCELADO"].includes(String(request.STATUS || "AGUARDANDO")));
  const dashboardList = $("#dashboardRequestList");
  if (dashboardList) dashboardList.innerHTML = pending.length
    ? pending.slice(0, 5).map((request) => `<div class="list-item"><div><b>${escapeHtml(request.PRODUTO || request.DETALHES || "Produto solicitado")}</b><small>${escapeHtml(request.NOME || "Cliente")} · ${requestStatusLabel(request.STATUS)}</small></div><span class="badge">${escapeHtml(request.TIPO === "PRODUTO_NAO_CADASTRADO" ? "Pedido" : "Reposição")}</span></div>`).join("")
    : '<p class="muted">Nenhuma solicitação pendente.</p>';
  updateRequestIndicators();
  renderWhatsappWarning();
}

function placeholder() {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"><rect width="100%" height="100%" fill="#eee"/><text x="50%" y="50%" text-anchor="middle" font-family="Arial" font-size="30" fill="#999">SEM FOTO</text></svg>');
}

function productPhotos(id) {
  return state.photos.filter((photo) => sameId(photo.ID_PRODUTO, id));
}

function productPhotoData(id) {
  const photos = productPhotos(id);
  const main = photos.find((photo) => String(photo.PRINCIPAL).trim().toUpperCase() === "SIM") || photos[0];
  const original = String(main?.URL_ORIGINAL || "").trim();
  const optimized = String(main?.URL_CATALOGO || main?.URL_FEED || "").trim();
  return { src: optimized || original || placeholder(), fallback: original || placeholder() };
}

function productPhoto(id) {
  return productPhotoData(id).src;
}

function imageTag(urlData, alt, className = "") {
  return `<img ${className ? `class="${className}"` : ""} loading="lazy" decoding="async" src="${escapeHtml(urlData.src)}" data-fallback-src="${escapeHtml(urlData.fallback)}" alt="${escapeHtml(alt)}">`;
}

function quickStatusOptions(selected) {
  return STATUS_OPTIONS.map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function renderProducts() {
  const query = $("#productSearch").value.toLowerCase();
  const niche = $("#productNicheFilter").value;
  const products = state.products.filter((product) =>
    (!niche || normalizedNiche(product.NICHO) === niche) &&
    (`${product.NOME} ${product.CATEGORIA} ${product.COR_TOM}`).toLowerCase().includes(query)
  );
  $("#productList").innerHTML = products.map((product) => {
    const effective = productStatus(product);
    const rawSelected = String(product.STATUS_CATALOGO || "AUTOMATICO").trim().toUpperCase();
    const selected = STATUS_OPTIONS.some(([value]) => value === rawSelected) ? rawSelected : "AUTOMATICO";
    const photo = productPhotoData(product.ID);
    const groupParent = product.GRUPO_CATALOGO ? state.products.find((entry) => sameId(entry.ID, product.GRUPO_CATALOGO)) : null;
    const groupedChildren = state.products.filter((entry) => sameId(entry.GRUPO_CATALOGO, product.ID));
    const groupText = product.GRUPO_CATALOGO
      ? `Agrupado com ${groupParent?.NOME || product.GRUPO_CATALOGO}`
      : groupedChildren.length
        ? `Produto principal de ${groupedChildren.length + 1} opções`
        : "Produto independente";
    return `<article class="product-card${product.__LOCAL_PENDING ? " local-pending" : ""}" data-product-id="${escapeHtml(product.ID)}">
      ${imageTag(photo, product.NOME, "product-image")}
      <div class="product-card-body">
        <div class="admin-card-badges"><span class="badge">${escapeHtml(product.NICHO)}</span>${product.__LOCAL_PENDING ? '<span class="publication-badge saving-product">Salvando...</span>' : ""}<span class="availability-badge ${statusClass(effective)}">${statusLabel(effective)}</span><span class="publication-badge ${isProductActive(product) ? "published" : "hidden-product"}">${isProductActive(product) ? "Publicado" : "Oculto"}</span></div>
        <h3>${escapeHtml(product.NOME)}</h3>
        <p class="product-code">${escapeHtml(product.SKU || "Código pendente")}</p>
        <p>${product.COR_TOM ? `<b>Variação:</b> ${escapeHtml(product.COR_TOM)}` : "Sem variação de cor/tom"}${product.TAMANHO_EXIBICAO ? ` · ${escapeHtml(product.TAMANHO_EXIBICAO)}` : ""}</p>
        <p class="muted"><b>Exibição:</b> ${escapeHtml(groupText)}</p>
        <p class="price">${money(product.PRECO_VENDA)}</p>
        <p>Estoque interno: <b>${numberValue(product.ESTOQUE_ATUAL)}</b></p>
        <label class="quick-status-label">Status no catálogo
          <select class="quick-status" data-action="status" data-id="${escapeHtml(product.ID)}">${quickStatusOptions(selected)}</select>
        </label>
        <div class="card-actions">
          <button type="button" data-action="edit" data-id="${escapeHtml(product.ID)}">Editar</button>
          <button type="button" class="danger" data-action="delete" data-id="${escapeHtml(product.ID)}">Excluir</button>
        </div>
      </div>
    </article>`;
  }).join("") || '<p class="muted">Nenhum produto encontrado.</p>';
}

window.updateProductStatus = function updateProductStatus(id, status, select) {
  const product = state.products.find((entry) => sameId(entry.ID, id));
  if (!product) return toast("Produto não encontrado.");
  const oldValue = product.STATUS_CATALOGO || "AUTOMATICO";
  product.STATUS_CATALOGO = status;
  renderProducts();
  renderDashboard();
  saveAdminSnapshot();
  toast(`Status alterado para “${statusLabel(status)}”.`);
  const sync = beginSync("Salvando status...");
  api("setProductStatus", { id, status }).then((result) => {
    if (result?.product) Object.assign(product, result.product);
    sync.success("Status salvo");
  }).catch((error) => {
    product.STATUS_CATALOGO = oldValue;
    if (select) select.value = oldValue;
    renderProducts();
    renderDashboard();
    saveAdminSnapshot();
    sync.error("Falha ao salvar status");
    toast(`Não foi possível salvar: ${error.message}`);
  });
};

function sizeDisplay() {
  const mode = $('input[name="sizeMode"]:checked').value;
  if (mode === "UNICO") return `Tamanho único — veste do ${$("#sizeFrom").value} ao ${$("#sizeTo").value}`;
  if (mode === "SEPARADOS") return $$('.size-chip input[type="checkbox"]:checked').map((checkbox) => checkbox.dataset.size).join(", ");
  return "Não se aplica";
}

function getVariants() {
  const mode = $('input[name="sizeMode"]:checked').value;
  if (mode === "UNICO") return [{ ID: uid("VAR"), TAMANHO: `${$("#sizeFrom").value}-${$("#sizeTo").value}`, ESTOQUE: Number($("#initialStock").value || 0) }];
  if (mode === "SEPARADOS") {
    return $$('.size-chip input[type="checkbox"]:checked').map((checkbox) => ({
      ID: uid("VAR"),
      TAMANHO: checkbox.dataset.size,
      ESTOQUE: Number(checkbox.closest(".size-chip").querySelector('input[type="number"]').value || 0)
    }));
  }
  return [{ ID: uid("VAR"), TAMANHO: "NA", ESTOQUE: Number($("#initialStock").value || 0) }];
}

function addSizeChip(size, quantity = 0, checked = false) {
  const element = document.createElement("label");
  element.className = "size-chip";
  element.innerHTML = `<input type="checkbox" data-size="${escapeHtml(size)}" ${checked ? "checked" : ""}> <b>${escapeHtml(size)}</b> <input type="number" min="0" value="${quantity}" aria-label="Estoque ${escapeHtml(size)}">`;
  $("#sizeChips").appendChild(element);
}

function resetProductForm() {
  $("#productForm").reset();
  $("#productId").value = "";
  state.editingId = null;
  state.pendingFiles = [];
  $("#brand").value = "FITLYNE";
  $("#niche").value = "MAKEUP";
  $("#initialStock").value = 1;
  $("#minStock").value = 1;
  $("#sizeFrom").value = 36;
  $("#sizeTo").value = 40;
  $("#catalogStatus").value = "AUTOMATICO";
  populateCatalogGroupSelect();
  $("#activeProduct").checked = true;
  $("#photoPreview").innerHTML = "";
  $("#sizeChips").innerHTML = "";
  ["P", "M", "G", "GG"].forEach((size) => addSizeChip(size));
  $('input[name="sizeMode"][value="UNICO"]').checked = true;
  toggleSizeMode();
  $("#productFormTitle").textContent = "Novo produto";
}

function toggleSizeMode() {
  const mode = $('input[name="sizeMode"]:checked').value;
  $("#uniqueSizeBox").classList.toggle("hidden", mode !== "UNICO");
  $("#separateSizesBox").classList.toggle("hidden", mode !== "SEPARADOS");
}

function renderPendingFiles() {
  const preview = $("#photoPreview");
  preview.innerHTML = "";
  state.pendingFiles.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    const item = document.createElement("div");
    item.className = "photo-preview";
    item.innerHTML = `<img src="${url}" alt="Prévia da foto ${index + 1}"><button type="button" aria-label="Remover foto ${index + 1}">×</button>`;
    item.querySelector("img").addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
    item.querySelector("button").onclick = () => {
      state.pendingFiles.splice(index, 1);
      renderPendingFiles();
    };
    preview.appendChild(item);
  });
}

function addPendingFiles(fileList) {
  const incoming = [...(fileList || [])].filter((file) => String(file.type || "").startsWith("image/"));
  if (!incoming.length) return toast("Escolha uma foto válida.");
  const existing = new Set(state.pendingFiles.map((file) => `${file.name}|${file.size}|${file.lastModified}`));
  incoming.forEach((file) => {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (!existing.has(key)) {
      state.pendingFiles.push(file);
      existing.add(key);
    }
  });
  if (state.pendingFiles.length > 10) {
    state.pendingFiles = state.pendingFiles.slice(0, 10);
    toast("Você pode enviar no máximo 10 fotos por produto.");
  }
  renderPendingFiles();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler a foto selecionada."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A foto não pôde ser aberta pelo navegador."));
    image.src = source;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível preparar a foto.")), type, quality));
}

async function prepareImageForUpload(file) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Selecione um arquivo de imagem válido.");
  if (Number(file.size || 0) > 20 * 1024 * 1024) throw new Error("A foto original deve ter no máximo 20 MB.");

  let image;
  let cleanup = () => {};
  try {
    if ("createImageBitmap" in window) {
      image = await createImageBitmap(file, { imageOrientation: "from-image" });
      cleanup = () => image.close?.();
    } else {
      const source = await readFileAsDataUrl(file);
      image = await loadImageElement(source);
    }
    const sourceWidth = image.width || image.naturalWidth;
    const sourceHeight = image.height || image.naturalHeight;
    const scale = Math.min(1, 1200 / sourceWidth, 1500 / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) throw new Error("O navegador não conseguiu processar a foto.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.76);
    const dataUrl = await readFileAsDataUrl(blob);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (!base64) throw new Error("A foto ficou vazia durante a preparação.");
    return { base64, mimeType: "image/jpeg", fileName: String(file.name || "foto.jpg").replace(/\.[^.]+$/, "") + ".jpg" };
  } finally {
    cleanup();
  }
}

async function uploadImage(file, productId, index) {
  const prepared = await prepareImageForUpload(file);
  const result = await api("uploadImage", {
    ...prepared,
    productId: String(productId),
    order: index + 1,
    principal: index === 0 ? "SIM" : "NAO"
  }, true, 60000);
  if (result?.photo?.URL_ORIGINAL) return result.photo;
  if (!result?.secure_url || !result?.public_id) throw new Error("A API não devolveu os dados da foto.");
  return {
    ID: uid("FOTO"),
    ID_PRODUTO: String(productId),
    ORDEM: index + 1,
    PRINCIPAL: index === 0 ? "SIM" : "NAO",
    PUBLIC_ID: String(result.public_id),
    URL_ORIGINAL: String(result.secure_url),
    URL_CATALOGO: String(result.secure_url),
    URL_FEED: String(result.secure_url),
    URL_STORY: String(result.secure_url),
    URL_WHATSAPP: String(result.secure_url),
    URL_FACEBOOK: String(result.secure_url),
    URL_SHOPEE: String(result.secure_url),
    URL_MERCADO_LIVRE: String(result.secure_url)
  };
}

async function uploadPendingPhotos(productId, files, onProgress) {
  const results = new Array(files.length);
  let cursor = 0;
  let finished = 0;
  async function worker() {
    while (cursor < files.length) {
      const index = cursor++;
      results[index] = await uploadImage(files[index], productId, index);
      finished += 1;
      onProgress?.(finished, files.length, results[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
  return results;
}

function saveProduct(event) {
  event.preventDefault();
  const button = $("#saveProductBtn");
  const id = state.editingId || uid("PROD");
  const variants = getVariants();
  const total = variants.reduce((sum, variant) => sum + Number(variant.ESTOQUE || 0), 0);
  const product = {
    ID: id,
    SKU: state.editingId ? (state.products.find((entry) => sameId(entry.ID, id))?.SKU || "") : "Gerando...",
    NICHO: normalizedNiche($("#niche").value),
    CATEGORIA: $("#category").value.trim(),
    MARCA: $("#brand").value.trim(),
    NOME: $("#productName").value.trim(),
    DESCRICAO: $("#description").value.trim(),
    COR_TOM: $("#colorTone").value.trim(),
    GRUPO_CATALOGO: $("#catalogGroup")?.value || "",
    TIPO_TAMANHO: $('input[name="sizeMode"]:checked').value,
    TAMANHO_EXIBICAO: sizeDisplay(),
    PRECO_COMPRA: Number($("#purchasePrice").value || 0),
    PRECO_VENDA: Number($("#salePrice").value || 0),
    ESTOQUE_ATUAL: total,
    ESTOQUE_MINIMO: Number($("#minStock").value || 0),
    STATUS_CATALOGO: $("#catalogStatus").value,
    ATIVO: $("#activeProduct").checked ? "SIM" : "NAO",
    __LOCAL_PENDING: true
  };
  if (!product.NOME) return toast("Informe o nome do produto.");

  const files = [...state.pendingFiles];
  const previousProduct = state.products.find((entry) => sameId(entry.ID, id));
  const previousProductCopy = previousProduct ? { ...previousProduct } : null;
  const previousVariants = state.variants.filter((entry) => sameId(entry.ID_PRODUTO, id)).map((entry) => ({ ...entry }));
  const restoreButton = setButtonBusy(button, "Na fila...");

  state.products = state.products.filter((entry) => !sameId(entry.ID, id));
  state.products.unshift(product);
  state.variants = state.variants.filter((entry) => !sameId(entry.ID_PRODUTO, id));
  state.variants.push(...variants.map((entry) => ({ ...entry, ID_PRODUTO: id })));
  saveAdminSnapshot();
  populateProductSelects();
  resetProductForm();
  showView("products");
  restoreButton();
  toast(files.length ? "Produto adicionado. Enviando fotos em segundo plano..." : "Produto adicionado. Salvando em segundo plano...");

  const sync = beginSync(files.length ? "Publicando produto e fotos..." : "Publicando produto...");
  let productSavedRemotely = false;
  (async () => {
    try {
      const result = await api("saveProduct", { product: { ...product, __LOCAL_PENDING: undefined }, variants, photos: [] });
      productSavedRemotely = true;
      const local = state.products.find((entry) => sameId(entry.ID, id));
      if (local) Object.assign(local, result?.product || product, { __LOCAL_PENDING: files.length > 0 });
      state.variants = state.variants.filter((entry) => !sameId(entry.ID_PRODUTO, id));
      state.variants.push(...(result?.variants || variants).map((entry) => ({ ...entry, ID_PRODUTO: id })));
      if (result?.movement && !state.movements.some((entry) => sameId(entry.ID, result.movement.ID))) state.movements.unshift(result.movement);

      if (files.length) {
        await uploadPendingPhotos(id, files, (done, count, photo, index) => {
          if (index === 0) state.photos.filter((entry) => sameId(entry.ID_PRODUTO, id)).forEach((entry) => { entry.PRINCIPAL = "NAO"; });
          if (photo && !state.photos.some((entry) => sameId(entry.ID, photo.ID))) state.photos.push(photo);
          setSyncState("saving", `Enviando fotos ${done}/${count}...`);
          renderProducts();
          saveAdminSnapshot();
        });
      }
      const finalProduct = state.products.find((entry) => sameId(entry.ID, id));
      if (finalProduct) delete finalProduct.__LOCAL_PENDING;
      saveAdminSnapshot();
      renderProducts();
      renderDashboard();
      sync.success("Produto publicado");
      toast("Produto publicado com sucesso.");
    } catch (error) {
      if (!productSavedRemotely) {
        state.products = state.products.filter((entry) => !sameId(entry.ID, id));
        state.variants = state.variants.filter((entry) => !sameId(entry.ID_PRODUTO, id));
        if (previousProductCopy) state.products.unshift(previousProductCopy);
        state.variants.push(...previousVariants);
      } else {
        const local = state.products.find((entry) => sameId(entry.ID, id));
        if (local) delete local.__LOCAL_PENDING;
      }
      saveAdminSnapshot();
      populateProductSelects();
      renderProducts();
      renderDashboard();
      sync.error(productSavedRemotely ? "Produto salvo; foto pendente" : "Falha na publicação");
      toast(productSavedRemotely ? `O produto foi salvo, mas uma foto não foi enviada: ${error.message}` : `Não foi possível publicar: ${error.message}`);
    }
  })();
}

function populateProductSelects() {
  const options = '<option value="">Selecione</option>' + state.products.filter(isProductActive).map((product) => `<option value="${product.ID}">${escapeHtml(product.SKU || "")} · ${escapeHtml(product.NOME)}${product.COR_TOM ? ` · ${escapeHtml(product.COR_TOM)}` : ""} — estoque ${numberValue(product.ESTOQUE_ATUAL)}</option>`).join("");
  const stockCurrent = $("#stockProduct")?.value || "";
  const saleCurrent = $("#saleProduct")?.value || "";
  $("#stockProduct").innerHTML = options;
  $("#saleProduct").innerHTML = options;
  if ([...$("#stockProduct").options].some((option) => option.value === stockCurrent)) $("#stockProduct").value = stockCurrent;
  if ([...$("#saleProduct").options].some((option) => option.value === saleCurrent)) $("#saleProduct").value = saleCurrent;
  populateStockVariantSelect();
  populateSaleVariantSelect();
  populateClientSuggestions();
  populateCatalogGroupSelect(state.editingId || "", $("#catalogGroup")?.value || "");
}

function saveStock(event) {
  event.preventDefault();
  const productId = $("#stockProduct").value;
  const type = $("#stockType").value;
  const qty = Number($("#stockQty").value);
  const reason = $("#stockReason").value;
  const product = state.products.find((entry) => sameId(entry.ID, productId));
  if (!product) return toast("Selecione um produto.");
  if (!Number.isFinite(qty) || qty < 0 || (type !== "AJUSTE" && qty === 0)) return toast("Informe uma quantidade válida.");

  const variants = productVariants(productId);
  const variantId = $("#stockVariant").value || (variants.length === 1 ? variants[0].ID : "");
  if (variants.length > 1 && !variantId) return toast("Selecione o modelo / variação do estoque.");
  const variant = variants.find((entry) => sameId(entry.ID, variantId)) || null;
  const oldStock = numberValue(product.ESTOQUE_ATUAL);
  const oldVariantStock = variant ? numberValue(variant.ESTOQUE) : null;
  let next = oldStock;
  let variantNext = oldVariantStock;

  if (variant) {
    if (type === "ENTRADA" || type === "DEVOLUCAO") { next += qty; variantNext += qty; }
    else if (type === "SAIDA" || type === "PERDA") { next -= qty; variantNext -= qty; }
    else if (type === "AJUSTE") { next += qty - oldVariantStock; variantNext = qty; }
  } else {
    if (type === "ENTRADA" || type === "DEVOLUCAO") next += qty;
    else if (type === "SAIDA" || type === "PERDA") next -= qty;
    else if (type === "AJUSTE") next = qty;
  }
  if (next < 0 || (variant && variantNext < 0)) return toast("Estoque insuficiente.");

  const tempId = uid("LOCAL_MOV");
  const tempMovement = { ID: tempId, DATA: new Date().toISOString(), ID_PRODUTO: product.ID, PRODUTO: product.NOME, ID_VARIACAO: variant?.ID || "", VARIACAO: variant ? variantLabel(variant) : "", TIPO: type, QUANTIDADE: qty, MOTIVO: reason, __LOCAL_PENDING: true };
  product.ESTOQUE_ATUAL = next;
  if (variant) variant.ESTOQUE = variantNext;
  state.movements.unshift(tempMovement);
  saveAdminSnapshot(); populateProductSelects(); renderCurrentStock(); renderMovements(); renderDashboard();
  $("#stockQty").value = ""; $("#stockReason").value = "";
  toast("Estoque atualizado.");

  const sync = beginSync("Salvando estoque...");
  api("stockMovement", { productId, variantId, type, qty, reason }).then((result) => {
    if (result?.product) Object.assign(product, result.product);
    if (result?.variant) { const localVariant = state.variants.find((entry) => sameId(entry.ID, result.variant.ID)); if (localVariant) Object.assign(localVariant, result.variant); }
    state.movements = state.movements.filter((entry) => !sameId(entry.ID, tempId));
    if (result?.movement) state.movements.unshift(result.movement);
    saveAdminSnapshot(); populateProductSelects(); renderCurrentStock(); renderMovements(); renderDashboard(); sync.success("Estoque salvo");
    if (result?.notifications?.ready) toast(`${result.notifications.ready} cliente(s) aguardando este produto.`);
  }).catch((error) => {
    product.ESTOQUE_ATUAL = oldStock;
    if (variant && oldVariantStock !== null) variant.ESTOQUE = oldVariantStock;
    state.movements = state.movements.filter((entry) => !sameId(entry.ID, tempId));
    saveAdminSnapshot(); populateProductSelects(); renderCurrentStock(); renderMovements(); renderDashboard(); sync.error("Falha ao salvar estoque"); toast(`Alteração desfeita: ${error.message}`);
  });
}

function renderCurrentStock() {
  const target = $("#currentStockList");
  if (!target) return;
  const products = [...state.products].filter(isProductActive).sort((a, b) => String(a.NOME || "").localeCompare(String(b.NOME || ""), "pt-BR"));
  target.innerHTML = products.length ? products.map((product) => {
    const stock = numberValue(product.ESTOQUE_ATUAL);
    const minimum = numberValue(product.ESTOQUE_MINIMO);
    const low = stock > 0 && minimum > 0 && stock < minimum;
    return `<article class="stock-card"><div><span class="badge">${escapeHtml(normalizedNiche(product.NICHO))}</span><h3>${escapeHtml(product.NOME)}</h3><small>${escapeHtml(product.SKU || "")} ${product.COR_TOM ? `· ${escapeHtml(product.COR_TOM)}` : ""} ${product.TAMANHO_EXIBICAO ? `· ${escapeHtml(product.TAMANHO_EXIBICAO)}` : ""}</small></div><div class="stock-number ${stock <= 0 ? "zero" : low ? "low" : "ok"}"><strong>${stock}</strong><span>${stock <= 0 ? "Esgotado" : low ? "Baixo" : "Em estoque"}</span></div></article>`;
  }).join("") : '<p class="muted">Nenhum produto cadastrado.</p>';
}

function renderMovements() {
  $("#movementList").innerHTML = state.movements.slice(0, 30).map((movement) => `<div class="list-item"><div><b>${escapeHtml(movement.PRODUTO)}</b><small>${movement.VARIACAO ? `${escapeHtml(movement.VARIACAO)} · ` : ""}${escapeHtml(movement.TIPO)} · ${escapeHtml(movement.MOTIVO || "")}</small></div><span class="amount">${movement.QUANTIDADE}${movement.__LOCAL_PENDING ? ' <small class="saving-inline">salvando</small>' : ""}</span></div>`).join("") || '<p class="muted">Sem movimentações.</p>';
}

function resetSaleForm() {
  $("#saleForm").reset();
  $("#saleQty").value = 1;
  $("#saleDiscount").value = 0;
  $("#saleEditId").value = "";
  if ($("#saleKnownClient")) $("#saleKnownClient").value = "";
  $("#saveSaleBtn").textContent = "Finalizar venda";
  $("#cancelSaleEdit").hidden = true;
  populateSaleVariantSelect();
}

function editSale(id) {
  const sale = state.sales.find((entry) => sameId(entry.ID, id));
  if (!sale || !saleIsActive(sale)) return toast("Venda não disponível para edição.");
  $("#saleEditId").value = sale.ID;
  $("#saleProduct").value = sale.ID_PRODUTO;
  populateSaleVariantSelect(sale.ID_VARIACAO || "");
  $("#saleQty").value = numberValue(sale.QUANTIDADE);
  $("#saleClient").value = sale.CLIENTE || "";
  $("#salePhone").value = sale.TELEFONE || "";
  const known = consolidatedClients().find((client) => normalizeClientName(client.NOME) === normalizeClientName(sale.CLIENTE));
  if ($("#saleKnownClient")) $("#saleKnownClient").value = known?.ID || known?.NOME || "";
  $("#saleDiscount").value = numberValue(sale.DESCONTO);
  $("#paymentMethod").value = sale.PAGAMENTO || "PIX";
  $("#saveSaleBtn").textContent = "Salvar alteração";
  $("#cancelSaleEdit").hidden = false;
  $("#saleForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function cancelSale(id) {
  const sale = state.sales.find((entry) => sameId(entry.ID, id));
  if (!sale || !saleIsActive(sale)) return toast("Venda já excluída ou cancelada.");
  if (!window.confirm(`Excluir a venda de ${sale.PRODUTO}${sale.VARIACAO ? ` · ${sale.VARIACAO}` : ""}? O estoque será devolvido automaticamente.`)) return;

  const oldSale = { ...sale };
  const product = state.products.find((entry) => sameId(entry.ID, sale.ID_PRODUTO));
  const variant = sale.ID_VARIACAO ? state.variants.find((entry) => sameId(entry.ID, sale.ID_VARIACAO)) : null;
  const oldStock = product ? numberValue(product.ESTOQUE_ATUAL) : null;
  const oldVariantStock = variant ? numberValue(variant.ESTOQUE) : null;

  sale.STATUS = "CANCELADA";
  sale.__LOCAL_PENDING = true;
  if (product) product.ESTOQUE_ATUAL = oldStock + numberValue(sale.QUANTIDADE);
  if (variant) variant.ESTOQUE = oldVariantStock + numberValue(sale.QUANTIDADE);
  saveAdminSnapshot(); populateProductSelects(); renderSales(); renderCurrentStock(); renderDashboard(); renderFinance(); renderClients();
  toast("Venda excluída. Confirmando no banco...");

  const sync = beginSync("Estornando venda...");
  try {
    const result = await api("cancelSale", { id });
    Object.assign(sale, result?.sale || { STATUS: "CANCELADA" }); delete sale.__LOCAL_PENDING;
    if (result?.product) { const localProduct = state.products.find((entry) => sameId(entry.ID, result.product.ID)); if (localProduct) Object.assign(localProduct, result.product); }
    if (result?.variant) { const localVariant = state.variants.find((entry) => sameId(entry.ID, result.variant.ID)); if (localVariant) Object.assign(localVariant, result.variant); }
    if (Array.isArray(result?.clients)) state.clients = result.clients;
    saveAdminSnapshot(); populateProductSelects(); renderSales(); renderCurrentStock(); renderDashboard(); renderFinance(); renderClients();
    sync.success("Venda excluída"); toast("Venda excluída e estoque estornado.");
  } catch (error) {
    Object.assign(sale, oldSale); delete sale.__LOCAL_PENDING;
    if (product && oldStock !== null) product.ESTOQUE_ATUAL = oldStock;
    if (variant && oldVariantStock !== null) variant.ESTOQUE = oldVariantStock;
    saveAdminSnapshot(); populateProductSelects(); renderSales(); renderCurrentStock(); renderDashboard(); renderFinance(); renderClients();
    sync.error("Falha ao excluir venda"); toast(`Não foi possível excluir: ${error.message}`); window.alert(`A venda NÃO foi excluída.\n\n${error.message}`);
  }
}

window.cancelSale = cancelSale;
window.editSale = editSale;

async function saveSale(event) {
  event.preventDefault();
  const editId = $("#saleEditId").value.trim();
  const productId = $("#saleProduct").value;
  const product = state.products.find((entry) => sameId(entry.ID, productId));
  const variants = productVariants(productId);
  const variantId = $("#saleVariant").value || (variants.length === 1 ? variants[0].ID : "");
  const variant = variants.find((entry) => sameId(entry.ID, variantId)) || null;
  const qty = Number($("#saleQty").value || 1);
  const client = $("#saleClient").value.trim();
  const phone = $("#salePhone").value.trim();
  const discount = Number($("#saleDiscount").value || 0);
  const payment = $("#paymentMethod").value;
  if (!product) return toast("Selecione um produto.");
  if (variants.length > 1 && !variantId) return toast("Selecione qual modelo / variação saiu.");
  if (!Number.isFinite(qty) || qty <= 0) return toast("Informe uma quantidade válida.");

  if (editId) {
    const sync = beginSync("Salvando alteração...");
    try {
      const result = await api("updateSale", { id: editId, productId, variantId, qty, client, phone, discount, payment });
      const index = state.sales.findIndex((entry) => sameId(entry.ID, editId));
      if (index >= 0 && result?.sale) state.sales[index] = result.sale;
      (result?.products || []).forEach((changed) => { const local = state.products.find((entry) => sameId(entry.ID, changed.ID)); if (local) Object.assign(local, changed); });
      (result?.variants || []).forEach((changed) => { const local = state.variants.find((entry) => sameId(entry.ID, changed.ID)); if (local) Object.assign(local, changed); });
      if (Array.isArray(result?.clients)) state.clients = result.clients;
      resetSaleForm(); saveAdminSnapshot(); populateProductSelects(); renderSales(); renderCurrentStock(); renderDashboard(); renderFinance(); renderClients();
      sync.success("Venda atualizada"); toast("Venda atualizada e estoque recalculado.");
    } catch (error) { sync.error("Falha ao editar venda"); toast(error.message); }
    return;
  }

  const oldStock = numberValue(product.ESTOQUE_ATUAL);
  const oldVariantStock = variant ? numberValue(variant.ESTOQUE) : null;
  if (oldStock < qty) return toast("Estoque insuficiente.");
  if (variant && oldVariantStock < qty) return toast(`Estoque insuficiente para ${variantLabel(variant)}.`);
  const total = Math.max(0, numberValue(product.PRECO_VENDA) * qty - discount);
  const tempSaleId = uid("LOCAL_VENDA");
  const tempMovementId = uid("LOCAL_MOV");
  const tempSale = { ID: tempSaleId, DATA: new Date().toISOString(), ID_PRODUTO: product.ID, PRODUTO: product.NOME, ID_VARIACAO: variant?.ID || "", VARIACAO: variant ? variantLabel(variant) : "", QUANTIDADE: qty, VALOR_UNITARIO: product.PRECO_VENDA, DESCONTO: discount, TOTAL: total, CLIENTE: client, TELEFONE: phone, PAGAMENTO: payment, STATUS: "ATIVA", __LOCAL_PENDING: true };
  const tempMovement = { ID: tempMovementId, DATA: new Date().toISOString(), ID_PRODUTO: product.ID, PRODUTO: product.NOME, ID_VARIACAO: variant?.ID || "", VARIACAO: variant ? variantLabel(variant) : "", TIPO: "VENDA", QUANTIDADE: qty, MOTIVO: "VENDA", __LOCAL_PENDING: true };
  product.ESTOQUE_ATUAL = oldStock - qty;
  if (variant) variant.ESTOQUE = oldVariantStock - qty;
  state.sales.unshift(tempSale); state.movements.unshift(tempMovement);
  saveAdminSnapshot(); populateProductSelects(); renderSales(); renderCurrentStock(); renderDashboard(); resetSaleForm(); toast(`Venda registrada: ${money(total)}.`);
  const sync = beginSync("Salvando venda...");
  api("saveSale", { productId, variantId, qty, client, phone, discount, payment }).then((result) => {
    state.sales = state.sales.filter((entry) => !sameId(entry.ID, tempSaleId)); state.movements = state.movements.filter((entry) => !sameId(entry.ID, tempMovementId));
    if (result?.sale) state.sales.unshift(result.sale); if (result?.movement) state.movements.unshift(result.movement); if (result?.product) Object.assign(product, result.product);
    if (result?.variant) { const localVariant = state.variants.find((entry) => sameId(entry.ID, result.variant.ID)); if (localVariant) Object.assign(localVariant, result.variant); }
    if (Array.isArray(result?.clients)) state.clients = result.clients;
    saveAdminSnapshot(); populateProductSelects(); renderSales(); renderCurrentStock(); renderDashboard(); renderClients(); sync.success("Venda salva");
  }).catch((error) => {
    product.ESTOQUE_ATUAL = oldStock; if (variant && oldVariantStock !== null) variant.ESTOQUE = oldVariantStock;
    state.sales = state.sales.filter((entry) => !sameId(entry.ID, tempSaleId)); state.movements = state.movements.filter((entry) => !sameId(entry.ID, tempMovementId));
    saveAdminSnapshot(); populateProductSelects(); renderSales(); renderCurrentStock(); renderDashboard(); renderClients(); sync.error("Falha ao salvar venda"); toast(`Venda desfeita: ${error.message}`);
  });
}

function renderSales() {
  const activeSales = state.sales.filter(saleIsActive).slice(0, 50);
  const cancelledCount = state.sales.filter((sale) => !saleIsActive(sale)).length;
  $("#salesList").innerHTML = activeSales.map((sale) => `
    <div class="list-item sale-row">
      <div>
        <b>${escapeHtml(sale.PRODUTO)}${sale.VARIACAO ? `<span class="variant-chip-inline">${escapeHtml(sale.VARIACAO)}</span>` : ""}</b>
        <small>${escapeHtml(sale.CLIENTE || "Sem cliente")} · ${escapeHtml(sale.PAGAMENTO)} · ${numberValue(sale.QUANTIDADE)} un.</small>
      </div>
      <div class="sale-actions">
        <span class="amount positive">${money(sale.TOTAL)}${sale.__LOCAL_PENDING ? ' <small class="saving-inline">salvando</small>' : ""}</span>
        ${sale.__LOCAL_PENDING ? "" : `<div class="sale-action-buttons"><span class="action-label">Ações</span><button type="button" class="ghost compact" onclick="editSale('${escapeHtml(sale.ID)}')">Editar</button><button type="button" class="danger compact" onclick="cancelSale('${escapeHtml(sale.ID)}')">Excluir</button></div>`}
      </div>
    </div>`).join("") || '<p class="muted">Sem vendas.</p>';
  if (cancelledCount) $("#salesList").insertAdjacentHTML("beforeend", `<p class="muted cancelled-history-note">${cancelledCount} venda${cancelledCount === 1 ? "" : "s"} cancelada${cancelledCount === 1 ? "" : "s"} preservada${cancelledCount === 1 ? "" : "s"} no histórico interno.</p>`);
}


function requestStatusLabel(status) {
  return ({
    AGUARDANDO: "Aguardando",
    PRONTO_PARA_AVISAR: "Produto disponível",
    NOTIFICADO: "Notificado",
    ATENDIDO: "Atendido",
    CANCELADO: "Cancelado"
  })[String(status || "AGUARDANDO").toUpperCase()] || "Aguardando";
}

function requestStatusClass(status) {
  return ({
    AGUARDANDO: "automatic",
    PRONTO_PARA_AVISAR: "restock",
    NOTIFICADO: "available",
    ATENDIDO: "published",
    CANCELADO: "hidden-product"
  })[String(status || "AGUARDANDO").toUpperCase()] || "automatic";
}

function updateRequestIndicators() {
  const pending = state.requests.filter((request) => !["ATENDIDO", "CANCELADO", "NOTIFICADO"].includes(String(request.STATUS || "AGUARDANDO").toUpperCase())).length;
  const badge = $("#requestMenuCount");
  if (badge) {
    badge.textContent = pending > 99 ? "99+" : String(pending);
    badge.hidden = pending === 0;
  }
  const notice = $("#whatsappApiNotice");
  if (notice) notice.classList.toggle("hidden", Boolean(state.whatsappApi?.configured));
}

function requestMessage(request) {
  const store = state.config.NOME_LOJA || C.STORE_NAME;
  const product = request.PRODUTO || request.DETALHES || "o produto solicitado";
  const catalogUrl = state.config.CATALOG_URL || "https://cagdoj.github.io/Fitlyne/catalog.html";
  return `Olá, ${request.NOME || "tudo bem"}! O produto ${product} que você solicitou já está disponível na ${store}. Veja no catálogo: ${catalogUrl}`;
}

function renderRequests() {
  const search = String($("#requestSearch")?.value || "").toLowerCase();
  const filter = String($("#requestStatusFilter")?.value || "").toUpperCase();
  const rows = state.requests.filter((request) => {
    const status = String(request.STATUS || "AGUARDANDO").toUpperCase();
    const text = `${request.NOME} ${request.TELEFONE} ${request.PRODUTO} ${request.DETALHES}`.toLowerCase();
    return (!filter || status === filter) && (!search || text.includes(search));
  });
  const counts = {
    waiting: state.requests.filter((request) => String(request.STATUS || "AGUARDANDO").toUpperCase() === "AGUARDANDO").length,
    ready: state.requests.filter((request) => String(request.STATUS || "").toUpperCase() === "PRONTO_PARA_AVISAR").length,
    notified: state.requests.filter((request) => String(request.STATUS || "").toUpperCase() === "NOTIFICADO").length,
    total: state.requests.length
  };
  const stats = $("#requestStats");
  if (stats) stats.innerHTML = [["Aguardando", counts.waiting], ["Prontos para avisar", counts.ready], ["Notificados", counts.notified], ["Total", counts.total]].map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  const list = $("#requestList");
  if (!list) return;
  list.innerHTML = rows.length ? rows.map((request) => {
    const status = String(request.STATUS || "AGUARDANDO").toUpperCase();
    const canNotify = status === "PRONTO_PARA_AVISAR" || status === "AGUARDANDO";
    return `<article class="card request-card" data-request-id="${escapeHtml(request.ID)}">
      <div class="request-card-head"><div><span class="availability-badge ${requestStatusClass(status)}">${requestStatusLabel(status)}</span><h3>${escapeHtml(request.PRODUTO || "Produto não cadastrado")}</h3></div><small>${escapeHtml(String(request.DATA || ""))}</small></div>
      <p><b>${escapeHtml(request.NOME || "Cliente")}</b> · ${escapeHtml(request.TELEFONE || "Sem telefone")}</p>
      ${request.DETALHES ? `<p class="muted">${escapeHtml(request.DETALHES)}</p>` : ""}
      ${request.ULTIMO_ERRO ? `<p class="request-error">${escapeHtml(request.ULTIMO_ERRO)}</p>` : ""}
      <div class="request-actions">
        <button type="button" data-request-action="manual" data-id="${escapeHtml(request.ID)}">Abrir WhatsApp</button>
        <button type="button" class="primary" data-request-action="notify" data-id="${escapeHtml(request.ID)}" ${canNotify ? "" : "disabled"}>Enviar aviso automático</button>
        <button type="button" data-request-action="attended" data-id="${escapeHtml(request.ID)}">Marcar atendido</button>
        <button type="button" class="danger" data-request-action="cancel" data-id="${escapeHtml(request.ID)}">Cancelar</button>
      </div>
    </article>`;
  }).join("") : '<div class="card"><p class="muted">Nenhuma solicitação encontrada.</p></div>';
  updateRequestIndicators();
}

function updateRequestStatus(id, status) {
  const request = state.requests.find((entry) => sameId(entry.ID, id));
  if (!request) return toast("Solicitação não encontrada.");
  const oldStatus = request.STATUS || "AGUARDANDO";
  request.STATUS = status;
  renderRequests();
  renderDashboard();
  saveAdminSnapshot();
  toast("Solicitação atualizada.");
  const sync = beginSync("Salvando solicitação...");
  api("updateRequestStatus", { id, status }).then((result) => {
    if (result?.request) Object.assign(request, result.request);
    saveAdminSnapshot();
    sync.success("Solicitação salva");
  }).catch((error) => {
    request.STATUS = oldStatus;
    renderRequests();
    renderDashboard();
    saveAdminSnapshot();
    sync.error("Falha ao salvar solicitação");
    toast(`Alteração desfeita: ${error.message}`);
  });
}

async function notifyRequest(id) {
  const request = state.requests.find((entry) => sameId(entry.ID, id));
  if (!request) return toast("Solicitação não encontrada.");
  const sync = beginSync("Enviando WhatsApp...");
  try {
    const result = await api("notifyRequest", { id });
    Object.assign(request, result?.request || { STATUS: "NOTIFICADO", NOTIFICADO_EM: new Date().toISOString() });
    saveAdminSnapshot();
    renderRequests();
    renderDashboard();
    sync.success("WhatsApp enviado");
    toast(result?.message || "Aviso enviado pelo WhatsApp.");
  } catch (error) {
    sync.error("Falha no WhatsApp");
    toast(error.message);
  }
}

async function notifyAllReady() {
  const button = $("#notifyAllReadyBtn");
  const restoreButton = setButtonBusy(button, "Enviando...");
  const sync = beginSync("Avisando clientes...");
  try {
    const result = await api("notifyAllReady", {});
    let remaining = Number(result?.sent || 0);
    state.requests.forEach((request) => {
      if (remaining > 0 && String(request.STATUS || "").toUpperCase() === "PRONTO_PARA_AVISAR") {
        request.STATUS = "NOTIFICADO";
        request.NOTIFICADO_EM = new Date().toISOString();
        remaining -= 1;
      }
    });
    saveAdminSnapshot();
    renderRequests();
    renderDashboard();
    sync.success("Avisos enviados");
    toast(`${result.sent || 0} aviso(s) enviado(s).${result.failed ? ` ${result.failed} falharam.` : ""}`);
  } catch (error) {
    sync.error("Falha ao enviar avisos");
    toast(error.message);
  } finally {
    restoreButton();
  }
}

function openRequestWhatsapp(id) {
  const request = state.requests.find((entry) => sameId(entry.ID, id));
  if (!request) return toast("Solicitação não encontrada.");
  openWhatsapp(request.TELEFONE, requestMessage(request));
}

async function saveWhatsappApiSettings(event) {
  event.preventDefault();
  const button = $("#saveWhatsappApiBtn");
  button.disabled = true;
  button.textContent = "Salvando...";
  try {
    const payload = {
      enabled: $("#whatsappAutoEnabled").checked,
      phoneNumberId: $("#whatsappPhoneNumberId").value.trim(),
      graphVersion: $("#whatsappGraphVersion").value.trim(),
      templateName: $("#whatsappTemplateName").value.trim(),
      templateLanguage: $("#whatsappTemplateLanguage").value.trim(),
      accessToken: $("#whatsappAccessToken").value.trim()
    };
    state.whatsappApi = await api("saveWhatsappApiSettings", payload);
    $("#whatsappAccessToken").value = "";
    renderWhatsappApiSettings();
    updateRequestIndicators();
    toast("Integração do WhatsApp salva.");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "Salvar integração"; }
}

function renderWhatsappApiSettings() {
  const status = state.whatsappApi || {};
  $("#whatsappAutoEnabled").checked = Boolean(status.enabled);
  $("#whatsappPhoneNumberId").value = status.phoneNumberId || "";
  $("#whatsappGraphVersion").value = status.graphVersion || "v23.0";
  $("#whatsappTemplateName").value = status.templateName || "produto_disponivel";
  $("#whatsappTemplateLanguage").value = status.templateLanguage || "pt_BR";
  const badge = $("#whatsappApiBadge");
  if (badge) {
    badge.textContent = status.configured ? (status.enabled ? "Automático ativo" : "Configurado") : "Não configurado";
    badge.className = `publication-badge ${status.configured ? "published" : "hidden-product"}`;
  }
}

async function testWhatsappApi() {
  const phone = prompt("Digite um WhatsApp de teste com DDI + DDD + número:");
  if (!phone) return;
  try {
    await api("testWhatsappApi", { phone });
    toast("Mensagem de teste solicitada à API oficial.");
  } catch (error) { toast(error.message); }
}

function renderClients() {
  const clients = consolidatedClients();
  $("#clientsList").innerHTML = clients.map((client) => `<div class="list-item"><div class="client-summary"><div><span class="client-name">${escapeHtml(client.NOME || "Cliente")}</span><small class="client-phone">${escapeHtml(client.TELEFONE || "Sem WhatsApp")} · ${client.COMPRAS || 0} compra${Number(client.COMPRAS || 0) === 1 ? "" : "s"}</small></div></div><span>${money(client.TOTAL_GASTO)}</span></div>`).join("") || '<p class="muted">Sem clientes.</p>';
  populateClientSuggestions();
}

function saveExpense(event) {
  event.preventDefault();
  const description = $("#expenseDescription").value.trim();
  const category = $("#expenseCategory").value;
  const value = Number($("#expenseValue").value);
  if (!description) return toast("Informe a descrição da despesa.");
  if (!Number.isFinite(value) || value < 0) return toast("Informe um valor válido.");
  const tempId = uid("LOCAL_DESP");
  const tempExpense = { ID: tempId, DATA: new Date().toISOString(), DESCRICAO: description, CATEGORIA: category, VALOR: value, __LOCAL_PENDING: true };
  state.expenses.unshift(tempExpense);
  saveAdminSnapshot();
  renderFinance();
  event.target.reset();
  toast("Despesa registrada.");
  const sync = beginSync("Salvando despesa...");
  api("saveExpense", { description, category, value }).then((result) => {
    state.expenses = state.expenses.filter((entry) => !sameId(entry.ID, tempId));
    if (result?.expense) state.expenses.unshift(result.expense);
    saveAdminSnapshot();
    renderFinance();
    sync.success("Despesa salva");
  }).catch((error) => {
    state.expenses = state.expenses.filter((entry) => !sameId(entry.ID, tempId));
    saveAdminSnapshot();
    renderFinance();
    sync.error("Falha ao salvar despesa");
    toast(`Registro desfeito: ${error.message}`);
  });
}

function renderFinance() {
  const revenue = state.sales.filter(saleIsActive).reduce((sum, sale) => sum + Number(sale.TOTAL || 0), 0);
  const expenses = state.expenses.reduce((sum, expense) => sum + Number(expense.VALOR || 0), 0);
  $("#financeStats").innerHTML = [["Faturamento", money(revenue)], ["Despesas", money(expenses)], ["Resultado", money(revenue - expenses)], ["Vendas", state.sales.filter(saleIsActive).length]].map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  $("#expensesList").innerHTML = state.expenses.slice(0, 30).map((expense) => `<div class="list-item"><div><b>${escapeHtml(expense.DESCRICAO)}</b><small>${escapeHtml(expense.CATEGORIA || "")}</small></div><span class="amount negative">${money(expense.VALOR)}${expense.__LOCAL_PENDING ? ' <small class="saving-inline">salvando</small>' : ""}</span></div>`).join("") || '<p class="muted">Sem despesas.</p>';
}

function toggleShippingSettings() {
  const enabled = Boolean($("#shippingEnabled")?.checked);
  const box = $("#shippingSettingsBox");
  if (box) box.classList.toggle("shipping-disabled", !enabled);
  ["#shippingBelem", "#shippingAnanindeua", "#shippingMarituba", "#freeShippingAbove", "#deliveryDays"].forEach((selector) => {
    const input = $(selector);
    if (input) input.disabled = !enabled;
  });
}

function renderSettings() {
  $("#storeWhatsapp").value = state.config.WHATSAPP || "";
  $("#storeNameInput").value = state.config.NOME_LOJA || C.STORE_NAME;
  $("#storeSubtitleInput").value = state.config.SUBTITULO || C.STORE_SUBTITLE;
  $("#shippingEnabled").checked = String(state.config.FRETE_ATIVO || "NAO").trim().toUpperCase() === "SIM";
  $("#shippingBelem").value = numberValue(state.config.FRETE_BELEM || 10);
  $("#shippingAnanindeua").value = numberValue(state.config.FRETE_ANANINDEUA || 15);
  $("#shippingMarituba").value = numberValue(state.config.FRETE_MARITUBA || 15);
  $("#freeShippingAbove").value = numberValue(state.config.FRETE_GRATIS_ACIMA);
  $("#deliveryDays").value = numberValue(state.config.PRAZO_ENTREGA_DIAS || 3);
  toggleShippingSettings();
  $("#storeInstagram").value = state.config.INSTAGRAM || "";
  renderWhatsappApiSettings();
}

function saveSettings(event) {
  event.preventDefault();
  const whatsapp = normalizePhone($("#storeWhatsapp").value);
  if (!validWhatsapp(whatsapp)) return toast("WhatsApp inválido. Use DDI + DDD + número, por exemplo 5591...");
  const oldSettings = { ...state.config };
  const settings = {
    WHATSAPP: whatsapp,
    NOME_LOJA: $("#storeNameInput").value.trim() || "FITLYNE",
    SUBTITULO: $("#storeSubtitleInput").value.trim() || "Moda Fitness, Makeup & Skincare",
    FRETE_ATIVO: $("#shippingEnabled").checked ? "SIM" : "NAO",
    FRETE_BELEM: numberValue($("#shippingBelem").value),
    FRETE_ANANINDEUA: numberValue($("#shippingAnanindeua").value),
    FRETE_MARITUBA: numberValue($("#shippingMarituba").value),
    FRETE_GRATIS_ACIMA: numberValue($("#freeShippingAbove").value),
    PRAZO_ENTREGA_DIAS: numberValue($("#deliveryDays").value || 3),
    INSTAGRAM: $("#storeInstagram").value.trim()
  };
  Object.assign(state.config, settings);
  $("#storeWhatsapp").value = whatsapp;
  $("#brandName").textContent = settings.NOME_LOJA;
  $("#brandSubtitle").textContent = settings.SUBTITULO;
  renderWhatsappWarning();
  saveAdminSnapshot();
  toast("Configurações atualizadas.");
  const sync = beginSync("Salvando configurações...");
  api("saveSettings", settings).then(() => {
    sync.success("Configurações salvas");
  }).catch((error) => {
    state.config = oldSettings;
    renderSettings();
    $("#brandName").textContent = oldSettings.NOME_LOJA || C.STORE_NAME;
    $("#brandSubtitle").textContent = oldSettings.SUBTITULO || C.STORE_SUBTITLE;
    renderWhatsappWarning();
    saveAdminSnapshot();
    sync.error("Falha ao salvar configurações");
    toast(`Alteração desfeita: ${error.message}`);
  });
}

function testWhatsapp() {
  const phone = $("#storeWhatsapp").value || state.config.WHATSAPP;
  openWhatsapp(phone, "Olá! Este é um teste do WhatsApp da FITLYNE.");
}


window.editProduct = function editProduct(id) {
  const product = state.products.find((entry) => sameId(entry.ID, id));
  if (!product) return toast("Produto não encontrado.");
  resetProductForm();
  state.editingId = id;
  $("#productId").value = id;
  $("#productFormTitle").textContent = "Editar produto";
  $("#niche").value = normalizedNiche(product.NICHO) || "MAKEUP";
  $("#category").value = product.CATEGORIA || "";
  $("#brand").value = product.MARCA || "FITLYNE";
  $("#productName").value = product.NOME || "";
  $("#description").value = product.DESCRICAO || "";
  $("#colorTone").value = product.COR_TOM || "";
  populateCatalogGroupSelect(id, product.GRUPO_CATALOGO || "");
  $("#purchasePrice").value = numberValue(product.PRECO_COMPRA);
  $("#salePrice").value = numberValue(product.PRECO_VENDA);
  $("#initialStock").value = numberValue(product.ESTOQUE_ATUAL);
  $("#minStock").value = numberValue(product.ESTOQUE_MINIMO);
  $("#catalogStatus").value = String(product.STATUS_CATALOGO || "AUTOMATICO").toUpperCase();
  $("#activeProduct").checked = isProductActive(product);

  const mode = ["UNICO", "SEPARADOS", "NA"].includes(String(product.TIPO_TAMANHO || "").toUpperCase()) ? String(product.TIPO_TAMANHO).toUpperCase() : "NA";
  const radio = $(`input[name="sizeMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  const variants = state.variants.filter((entry) => sameId(entry.ID_PRODUTO, id));
  if (mode === "UNICO") {
    const match = String(variants[0]?.TAMANHO || product.TAMANHO_EXIBICAO || "").match(/(\d+)\D+(\d+)/);
    if (match) { $("#sizeFrom").value = match[1]; $("#sizeTo").value = match[2]; }
  } else if (mode === "SEPARADOS") {
    $("#sizeChips").innerHTML = "";
    const rows = variants.length ? variants : String(product.TAMANHO_EXIBICAO || "").split(",").filter(Boolean).map((size) => ({ TAMANHO: size.trim(), ESTOQUE: 0 }));
    rows.forEach((variant) => addSizeChip(String(variant.TAMANHO || "").trim(), numberValue(variant.ESTOQUE), true));
  }
  toggleSizeMode();

  const preview = $("#photoPreview");
  preview.innerHTML = productPhotos(id).map((photo, index) => {
    const source = String(photo.URL_CATALOGO || photo.URL_ORIGINAL || placeholder());
    const fallback = String(photo.URL_ORIGINAL || placeholder());
    return `<div class="photo-preview existing-photo">${imageTag({ src: source, fallback }, `Foto ${index + 1}`)}<span>${index === 0 ? "Capa atual" : "Foto atual"}</span></div>`;
  }).join("");
  showView("productForm");
};

window.deleteProduct = function deleteProduct(id) {
  const product = state.products.find((entry) => sameId(entry.ID, id));
  if (!product) return toast("Produto não encontrado.");
  if (!window.confirm(`Excluir “${product.NOME}”?`)) return;
  const productIndex = state.products.findIndex((entry) => sameId(entry.ID, id));
  const oldProduct = { ...product };
  const oldPhotos = state.photos.filter((entry) => sameId(entry.ID_PRODUTO, id)).map((entry) => ({ ...entry }));
  const oldVariants = state.variants.filter((entry) => sameId(entry.ID_PRODUTO, id)).map((entry) => ({ ...entry }));
  state.products = state.products.filter((entry) => !sameId(entry.ID, id));
  state.photos = state.photos.filter((entry) => !sameId(entry.ID_PRODUTO, id));
  state.variants = state.variants.filter((entry) => !sameId(entry.ID_PRODUTO, id));
  saveAdminSnapshot();
  populateProductSelects();
  renderProducts();
  renderDashboard();
  toast("Produto excluído.");
  const sync = beginSync("Excluindo produto...");
  api("deleteProduct", { id }).then(() => {
    sync.success("Produto excluído");
  }).catch((error) => {
    state.products.splice(Math.max(0, productIndex), 0, oldProduct);
    state.photos.push(...oldPhotos);
    state.variants.push(...oldVariants);
    saveAdminSnapshot();
    populateProductSelects();
    renderProducts();
    renderDashboard();
    sync.error("Falha ao excluir");
    toast(`Exclusão desfeita: ${error.message}`);
  });
};

function bind() {
  $("#menuBtn").onclick = openDrawer;
  $("#closeDrawer").onclick = closeDrawer;
  $("#backdrop").onclick = closeDrawer;
  $("#loginForm").onsubmit = login;
  $("#logoutBtn").onclick = logout;
  $$("[data-view]").forEach((button) => button.onclick = () => {
    if (!isAuthenticated()) return showView("login");
    if (button.dataset.view === "productForm") resetProductForm();
    showView(button.dataset.view);
  });
  $$('input[name="sizeMode"]').forEach((radio) => radio.onchange = toggleSizeMode);
  $("#addCustomSize").onclick = () => { const size = prompt("Digite o tamanho, por exemplo 38-44"); if (size) addSizeChip(size); };
  $("#galleryInput").onchange = (event) => { addPendingFiles(event.target.files); event.target.value = ""; };
  $("#cameraInput").onchange = (event) => { addPendingFiles(event.target.files); event.target.value = ""; };
  $("#productForm").onsubmit = saveProduct;
  $("#cancelProduct").onclick = () => { resetProductForm(); showView("products"); };
  $("#productSearch").oninput = renderProducts;
  $("#productNicheFilter").onchange = renderProducts;
  $("#productList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = button.dataset.id || "";
    if (button.dataset.action === "edit") window.editProduct(id);
    if (button.dataset.action === "delete") window.deleteProduct(id);
  });
  $("#productList").addEventListener("change", (event) => {
    const select = event.target.closest('select[data-action="status"]');
    if (select) window.updateProductStatus(select.dataset.id || "", select.value, select);
  });
  $("#stockForm").onsubmit = saveStock;
  $("#stockProduct").onchange = () => populateStockVariantSelect();
  $("#saleForm").onsubmit = saveSale;
  $("#saleProduct").onchange = () => populateSaleVariantSelect();
  if ($("#saleKnownClient")) $("#saleKnownClient").onchange = (event) => {
    const selected = consolidatedClients().find((client) => String(client.ID || client.NOME || "") === event.target.value);
    if (selected) applyKnownClient(selected);
    else if (!event.target.value) { $("#saleClient").value = ""; $("#salePhone").value = ""; }
  };
  $("#saleClient").onchange = () => { const selected = findClientByTypedName($("#saleClient").value); if (selected && !$("#salePhone").value.trim()) $("#salePhone").value = selected.TELEFONE || ""; };
  $("#cancelSaleEdit").onclick = resetSaleForm;
  $("#salesList").addEventListener("click", (event) => { const button = event.target.closest("button[data-sale-action]"); if (!button) return; if (button.dataset.saleAction === "edit") editSale(button.dataset.id); if (button.dataset.saleAction === "delete") cancelSale(button.dataset.id); });
  $("#expenseForm").onsubmit = saveExpense;
  $("#settingsForm").onsubmit = saveSettings;
  $("#shippingEnabled").onchange = toggleShippingSettings;
  $("#testWhatsappBtn").onclick = testWhatsapp;
  $("#requestSearch").oninput = renderRequests;
  $("#requestStatusFilter").onchange = renderRequests;
  $("#notifyAllReadyBtn").onclick = notifyAllReady;
  $("#requestList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-request-action]");
    if (!button) return;
    const id = button.dataset.id || "";
    if (button.dataset.requestAction === "manual") openRequestWhatsapp(id);
    if (button.dataset.requestAction === "notify") notifyRequest(id);
    if (button.dataset.requestAction === "attended") updateRequestStatus(id, "ATENDIDO");
    if (button.dataset.requestAction === "cancel") updateRequestStatus(id, "CANCELADO");
  });
  $("#whatsappApiForm").onsubmit = saveWhatsappApiSettings;
  $("#testWhatsappApiBtn").onclick = testWhatsappApi;
}

async function cleanOldCacheOnce() {
  const key = "fitlyneCacheCleanBuild";
  if (localStorage.getItem(key) === C.BUILD) return;
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
    localStorage.setItem(key, C.BUILD);
  } catch (error) {
    console.warn("Não foi possível limpar o cache antigo:", error);
  }
}

function installImageFallback() {
  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const fallback = String(image.dataset.fallbackSrc || "").trim();
    if (fallback && image.src !== fallback && !image.dataset.fallbackUsed) {
      image.dataset.fallbackUsed = "1";
      image.src = fallback;
      return;
    }
    if (!image.dataset.placeholderUsed) {
      image.dataset.placeholderUsed = "1";
      image.src = placeholder();
    }
  }, true);
}

async function init() {
  window.addEventListener("unhandledrejection", (event) => {
    const message = event.reason?.message || "Ocorreu um erro inesperado.";
    console.error("FITLYNE:", event.reason);
    if (!isAuthenticated()) setLoginMessage(message, "error");
  });
  window.addEventListener("error", (event) => {
    if (!isAuthenticated() && event.message) setLoginMessage(`Erro ao carregar o sistema: ${event.message}`, "error");
  });
  installImageFallback();
  prewarmApi();
  bind();
  resetProductForm();
  setAuthenticatedUI(false);
  showView("login");
  setTimeout(() => $("#pinInput")?.focus(), 0);
  cleanOldCacheOnce();
  if (state.token) {
    const hadSnapshot = loadAdminSnapshot();
    if (hadSnapshot) {
      setAuthenticatedUI(true);
      showView("dashboard");
      loadAll().then(() => {
        if (state.view === "dashboard") renderDashboard();
      }).catch((error) => {
        console.warn("Sessão rápida não pôde ser atualizada:", error);
        if (/sessão|token|autoriz/i.test(error.message || "")) logout();
        else toast("Abrimos os últimos dados salvos. A internet está lenta.");
      });
    } else {
      loadAll().then(() => {
        setAuthenticatedUI(true);
        showView("dashboard");
      }).catch(() => logout());
    }
  }
}

let initStarted = false;
function startFitlyne() {
  if (initStarted) return;
  initStarted = true;
  init().catch((error) => {
    console.error("Falha ao iniciar a FITLYNE:", error);
    setLoginMessage(error?.message || "Não foi possível iniciar o sistema.", "error");
  });
}

// app.js é carregado dinamicamente depois de fitlyne-config.js. Em conexões rápidas,
// o DOMContentLoaded pode já ter acontecido; por isso iniciamos imediatamente nesse caso.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startFitlyne, { once: true });
} else {
  startFitlyne();
}
