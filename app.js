"use strict";

const C = Object.freeze({
  API_URL: "https://script.google.com/macros/s/AKfycbzt2uOHVX45xliautKbyBgBAhgFu-ruNj9CjUa2zJbEPtaOfA7Uy55oc6g_-bKGuh-gRg/exec",
  CLOUDINARY_CLOUD_NAME: "v9gfcyqm",
  CLOUDINARY_UPLOAD_PRESET: "fitlyne_upload",
  CLOUDINARY_WATERMARK_PUBLIC_ID: "",
  STORE_NAME: "FITLYNE",
  STORE_SUBTITLE: "Moda Fitness & Makeup",
  BUILD: "2026-07-31-0115-v13",
  ...(window.FITLYNE_CONFIG || {})
});

const FITLYNE_API_URL = C.API_URL;
console.info("FITLYNE app-v13 ativo", { build: C.BUILD, api: FITLYNE_API_URL });

const state = {
  token: sessionStorage.getItem("fitlyneToken") || "",
  products: [],
  photos: [],
  variants: [],
  movements: [],
  sales: [],
  clients: [],
  expenses: [],
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

function normalizeLoadedData(data) {
  state.products = Array.isArray(data.products) ? data.products.map((product) => ({ ...product, ID: String(product.ID ?? "").trim() })) : [];
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
  window.__fitlyneToast = setTimeout(() => element.classList.remove("show"), 3200);
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

async function api(action, payload = {}, auth = true) {
  if (!FITLYNE_API_URL) throw new Error("API da Fitlyne não configurada.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
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
      throw new Error(`A API não retornou JSON (HTTP ${response.status}). Verifique a implantação do Apps Script.`);
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
  if (name === "stock") renderMovements();
  if (name === "sales") renderSales();
  if (name === "clients") renderClients();
  if (name === "finance") renderFinance();
  if (name === "settings") renderSettings();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function login() {
  const pin = $("#pinInput").value.trim();
  if (!pin) return toast("Digite o PIN.");
  const button = $("#loginBtn");
  button.disabled = true;
  button.textContent = "Entrando...";
  try {
    const result = await api("login", { pin }, false);
    state.token = result.token;
    sessionStorage.setItem("fitlyneToken", result.token);
    await loadAll();
    setAuthenticatedUI(true);
    showView("dashboard");
    toast("Bem-vindo!");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Entrar";
  }
}

async function loadAll() {
  const data = await api("bootstrap");
  normalizeLoadedData(data || {});
  $("#brandName").textContent = state.config.NOME_LOJA || C.STORE_NAME;
  $("#brandSubtitle").textContent = state.config.SUBTITULO || C.STORE_SUBTITLE;
  populateProductSelects();
  renderWhatsappWarning();
}

function logout() {
  sessionStorage.removeItem("fitlyneToken");
  state.token = "";
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
  const active = state.products.filter((product) => String(product.ATIVO).toUpperCase() === "SIM");
  const stock = active.reduce((total, product) => total + numberValue(product.ESTOQUE_ATUAL), 0);
  const low = active.filter((product) => {
    const current = numberValue(product.ESTOQUE_ATUAL);
    const minimum = numberValue(product.ESTOQUE_MINIMO);
    return current > 0 && minimum > 0 && current < minimum;
  });
  const revenue = state.sales.reduce((total, sale) => total + Number(sale.TOTAL || 0), 0);
  $("#stats").innerHTML = [
    ["Produtos", active.length], ["Estoque", stock], ["Estoque baixo", low.length], ["Faturamento", money(revenue)]
  ].map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  $("#lowStockList").innerHTML = low.length
    ? low.slice(0, 8).map((product) => `<div class="list-item"><div><b>${escapeHtml(product.NOME)}</b><small>${escapeHtml(product.TAMANHO_EXIBICAO || "")} · ${escapeHtml(product.COR_TOM || "")}</small></div><span class="badge">${product.ESTOQUE_ATUAL}</span></div>`).join("")
    : '<p class="muted">Nenhum produto com estoque baixo.</p>';
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
    (!niche || product.NICHO === niche) &&
    (`${product.NOME} ${product.CATEGORIA} ${product.COR_TOM}`).toLowerCase().includes(query)
  );
  $("#productList").innerHTML = products.map((product) => {
    const effective = productStatus(product);
    const rawSelected = String(product.STATUS_CATALOGO || "AUTOMATICO").trim().toUpperCase();
    const selected = STATUS_OPTIONS.some(([value]) => value === rawSelected) ? rawSelected : "AUTOMATICO";
    const photo = productPhotoData(product.ID);
    return `<article class="product-card" data-product-id="${escapeHtml(product.ID)}">
      ${imageTag(photo, product.NOME, "product-image")}
      <div class="product-card-body">
        <div class="admin-card-badges"><span class="badge">${escapeHtml(product.NICHO)}</span><span class="availability-badge ${statusClass(effective)}">${statusLabel(effective)}</span></div>
        <h3>${escapeHtml(product.NOME)}</h3>
        <p>${escapeHtml(product.TAMANHO_EXIBICAO || "")} ${product.COR_TOM ? "· " + escapeHtml(product.COR_TOM) : ""}</p>
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

window.updateProductStatus = async function updateProductStatus(id, status, select) {
  const oldValue = state.products.find((product) => sameId(product.ID, id))?.STATUS_CATALOGO || "AUTOMATICO";
  if (select) select.disabled = true;
  try {
    await api("setProductStatus", { id, status });
    const product = state.products.find((entry) => sameId(entry.ID, id));
    if (product) product.STATUS_CATALOGO = status;
    renderProducts();
    renderDashboard();
    toast(`Status alterado para “${statusLabel(status)}”.`);
  } catch (error) {
    if (select) select.value = oldValue;
    toast(error.message);
  } finally {
    if (select) select.disabled = false;
  }
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
  $("#initialStock").value = 1;
  $("#minStock").value = 1;
  $("#sizeFrom").value = 36;
  $("#sizeTo").value = 40;
  $("#catalogStatus").value = "AUTOMATICO";
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
  const source = await readFileAsDataUrl(file);
  const image = await loadImageElement(source);
  const scale = Math.min(1, 1400 / image.naturalWidth, 1750 / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("O navegador não conseguiu processar a foto.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.8);
  const dataUrl = await readFileAsDataUrl(blob);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (!base64) throw new Error("A foto ficou vazia durante a preparação.");
  return { base64, mimeType: "image/jpeg", fileName: String(file.name || "foto.jpg").replace(/\.[^.]+$/, "") + ".jpg" };
}

async function uploadImage(file, productId, index) {
  const prepared = await prepareImageForUpload(file);
  const result = await api("uploadImage", {
    ...prepared,
    productId: String(productId),
    order: index + 1,
    principal: index === 0 ? "SIM" : "NAO"
  });
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

async function uploadPendingPhotos(productId, button) {
  const results = new Array(state.pendingFiles.length);
  let cursor = 0;
  let finished = 0;
  async function worker() {
    while (cursor < state.pendingFiles.length) {
      const index = cursor++;
      results[index] = await uploadImage(state.pendingFiles[index], productId, index);
      finished += 1;
      button.textContent = `Enviando fotos ${finished}/${state.pendingFiles.length}`;
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, state.pendingFiles.length) }, worker));
  return results;
}

async function saveProduct(event) {
  event.preventDefault();
  const button = $("#saveProductBtn");
  button.disabled = true;
  button.textContent = "Salvando...";
  try {
    const id = state.editingId || uid("PROD");
    const variants = getVariants();
    const total = variants.reduce((sum, variant) => sum + Number(variant.ESTOQUE || 0), 0);
    const product = {
      ID: id,
      SKU: id.replace("PROD_", "FIT"),
      NICHO: $("#niche").value,
      CATEGORIA: $("#category").value.trim(),
      MARCA: $("#brand").value.trim(),
      NOME: $("#productName").value.trim(),
      DESCRICAO: $("#description").value.trim(),
      COR_TOM: $("#colorTone").value.trim(),
      TIPO_TAMANHO: $('input[name="sizeMode"]:checked').value,
      TAMANHO_EXIBICAO: sizeDisplay(),
      PRECO_COMPRA: Number($("#purchasePrice").value || 0),
      PRECO_VENDA: Number($("#salePrice").value || 0),
      ESTOQUE_ATUAL: total,
      ESTOQUE_MINIMO: Number($("#minStock").value || 0),
      STATUS_CATALOGO: $("#catalogStatus").value,
      ATIVO: $("#activeProduct").checked ? "SIM" : "NAO"
    };
    const photos = state.pendingFiles.length ? await uploadPendingPhotos(id, button) : [];
    button.textContent = "Gravando produto...";
    await api("saveProduct", { product, variants, photos });
    await loadAll();
    resetProductForm();
    showView("products");
    toast("Produto salvo com sucesso!");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Salvar e publicar";
  }
}

window.editProduct = function editProduct(id) {
  const product = state.products.find((entry) => sameId(entry.ID, id));
  if (!product) return;
  resetProductForm();
  state.editingId = id;
  $("#productId").value = id;
  $("#productFormTitle").textContent = "Editar produto";
  $("#niche").value = product.NICHO;
  $("#category").value = product.CATEGORIA;
  $("#brand").value = product.MARCA;
  $("#productName").value = product.NOME;
  $("#description").value = product.DESCRICAO || "";
  $("#colorTone").value = product.COR_TOM || "";
  $("#purchasePrice").value = product.PRECO_COMPRA || 0;
  $("#salePrice").value = product.PRECO_VENDA || 0;
  $("#initialStock").value = product.ESTOQUE_ATUAL || 0;
  $("#minStock").value = product.ESTOQUE_MINIMO || 0;
  $("#catalogStatus").value = product.STATUS_CATALOGO || "AUTOMATICO";
  $("#activeProduct").checked = product.ATIVO === "SIM";
  const mode = product.TIPO_TAMANHO || "UNICO";
  $(`input[name="sizeMode"][value="${mode}"]`).checked = true;
  if (mode === "UNICO") {
    const match = String(product.TAMANHO_EXIBICAO || "").match(/(\d+).*?(\d+)/);
    if (match) { $("#sizeFrom").value = match[1]; $("#sizeTo").value = match[2]; }
  } else if (mode === "SEPARADOS") {
    const variants = state.variants.filter((variant) => String(variant.ID_PRODUTO) === String(id));
    $("#sizeChips").innerHTML = "";
    const used = new Set();
    variants.forEach((variant) => {
      used.add(String(variant.TAMANHO));
      addSizeChip(String(variant.TAMANHO), Number(variant.ESTOQUE || 0), true);
    });
    ["P", "M", "G", "GG"].filter((size) => !used.has(size)).forEach((size) => addSizeChip(size));
  }
  const oldPhotos = productPhotos(id);
  if (oldPhotos.length) {
    $("#photoPreview").innerHTML = oldPhotos.map((photo) => {
      const original = String(photo.URL_ORIGINAL || "").trim() || placeholder();
      const src = String(photo.URL_CATALOGO || "").trim() || original;
      return `<div class="photo-preview existing-photo"><img loading="lazy" decoding="async" src="${escapeHtml(src)}" data-fallback-src="${escapeHtml(original)}" alt="Foto publicada"><span>Publicada</span></div>`;
    }).join("");
  }
  toggleSizeMode();
  showView("productForm");
};

window.deleteProduct = async function deleteProduct(id) {
  if (!confirm("Excluir este produto?")) return;
  try {
    await api("deleteProduct", { id });
    state.products = state.products.filter((product) => !sameId(product.ID, id));
    state.photos = state.photos.filter((photo) => !sameId(photo.ID_PRODUTO, id));
    renderProducts();
    renderDashboard();
    toast("Produto excluído.");
  } catch (error) {
    toast(error.message);
  }
};

function populateProductSelects() {
  const options = '<option value="">Selecione</option>' + state.products.filter((product) => product.ATIVO === "SIM").map((product) => `<option value="${product.ID}">${escapeHtml(product.NOME)} — estoque ${product.ESTOQUE_ATUAL}</option>`).join("");
  $("#stockProduct").innerHTML = options;
  $("#saleProduct").innerHTML = options;
}

async function saveStock(event) {
  event.preventDefault();
  try {
    const result = await api("stockMovement", { productId: $("#stockProduct").value, type: $("#stockType").value, qty: Number($("#stockQty").value), reason: $("#stockReason").value });
    const product = state.products.find((entry) => sameId(entry.ID, $("#stockProduct").value));
    if (product) product.ESTOQUE_ATUAL = result.stock;
    await loadAll();
    renderMovements();
    renderDashboard();
    event.target.reset();
    toast("Estoque atualizado.");
  } catch (error) {
    toast(error.message);
  }
}

function renderMovements() {
  $("#movementList").innerHTML = state.movements.slice(0, 30).map((movement) => `<div class="list-item"><div><b>${escapeHtml(movement.PRODUTO)}</b><small>${escapeHtml(movement.TIPO)} · ${escapeHtml(movement.MOTIVO || "")}</small></div><span class="amount">${movement.QUANTIDADE}</span></div>`).join("") || '<p class="muted">Sem movimentações.</p>';
}

async function saveSale(event) {
  event.preventDefault();
  try {
    await api("saveSale", { productId: $("#saleProduct").value, qty: Number($("#saleQty").value), client: $("#saleClient").value, phone: $("#salePhone").value, discount: Number($("#saleDiscount").value || 0), payment: $("#paymentMethod").value });
    await loadAll();
    renderSales();
    event.target.reset();
    $("#saleQty").value = 1;
    $("#saleDiscount").value = 0;
    toast("Venda registrada!");
  } catch (error) {
    toast(error.message);
  }
}

function renderSales() {
  $("#salesList").innerHTML = state.sales.slice(0, 30).map((sale) => `<div class="list-item"><div><b>${escapeHtml(sale.PRODUTO)}</b><small>${escapeHtml(sale.CLIENTE || "Sem cliente")} · ${escapeHtml(sale.PAGAMENTO)}</small></div><span class="amount positive">${money(sale.TOTAL)}</span></div>`).join("") || '<p class="muted">Sem vendas.</p>';
}

function renderClients() {
  $("#clientsList").innerHTML = state.clients.map((client) => `<div class="list-item"><div><b>${escapeHtml(client.NOME)}</b><small>${escapeHtml(client.TELEFONE || "")} · ${client.COMPRAS || 0} compras</small></div><span>${money(client.TOTAL_GASTO)}</span></div>`).join("") || '<p class="muted">Sem clientes.</p>';
}

async function saveExpense(event) {
  event.preventDefault();
  try {
    await api("saveExpense", { description: $("#expenseDescription").value, category: $("#expenseCategory").value, value: Number($("#expenseValue").value) });
    await loadAll();
    renderFinance();
    event.target.reset();
    toast("Despesa registrada.");
  } catch (error) {
    toast(error.message);
  }
}

function renderFinance() {
  const revenue = state.sales.reduce((sum, sale) => sum + Number(sale.TOTAL || 0), 0);
  const expenses = state.expenses.reduce((sum, expense) => sum + Number(expense.VALOR || 0), 0);
  $("#financeStats").innerHTML = [["Faturamento", money(revenue)], ["Despesas", money(expenses)], ["Resultado", money(revenue - expenses)], ["Vendas", state.sales.length]].map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  $("#expensesList").innerHTML = state.expenses.slice(0, 30).map((expense) => `<div class="list-item"><div><b>${escapeHtml(expense.DESCRICAO)}</b><small>${escapeHtml(expense.CATEGORIA || "")}</small></div><span class="amount negative">${money(expense.VALOR)}</span></div>`).join("") || '<p class="muted">Sem despesas.</p>';
}

function renderSettings() {
  $("#storeWhatsapp").value = state.config.WHATSAPP || "";
  $("#storeNameInput").value = state.config.NOME_LOJA || C.STORE_NAME;
  $("#storeSubtitleInput").value = state.config.SUBTITULO || C.STORE_SUBTITLE;
}

async function saveSettings(event) {
  event.preventDefault();
  const button = $("#saveSettingsBtn");
  const whatsapp = normalizePhone($("#storeWhatsapp").value);
  if (!validWhatsapp(whatsapp)) return toast("WhatsApp inválido. Use DDI + DDD + número, por exemplo 5591...");
  button.disabled = true;
  button.textContent = "Salvando...";
  try {
    const settings = {
      WHATSAPP: whatsapp,
      NOME_LOJA: $("#storeNameInput").value.trim() || "FITLYNE",
      SUBTITULO: $("#storeSubtitleInput").value.trim() || "Moda Fitness & Makeup"
    };
    await api("saveSettings", settings);
    Object.assign(state.config, settings);
    $("#storeWhatsapp").value = whatsapp;
    $("#brandName").textContent = settings.NOME_LOJA;
    $("#brandSubtitle").textContent = settings.SUBTITULO;
    renderWhatsappWarning();
    toast("Configurações salvas.");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Salvar configurações";
  }
}

function testWhatsapp() {
  const phone = $("#storeWhatsapp").value || state.config.WHATSAPP;
  openWhatsapp(phone, "Olá! Este é um teste do WhatsApp da FITLYNE.");
}

function bind() {
  $("#menuBtn").onclick = openDrawer;
  $("#closeDrawer").onclick = closeDrawer;
  $("#backdrop").onclick = closeDrawer;
  $("#loginBtn").onclick = login;
  $("#pinInput").addEventListener("keydown", (event) => { if (event.key === "Enter") login(); });
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
  $("#saleForm").onsubmit = saveSale;
  $("#expenseForm").onsubmit = saveExpense;
  $("#settingsForm").onsubmit = saveSettings;
  $("#testWhatsappBtn").onclick = testWhatsapp;
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
  installImageFallback();
  bind();
  resetProductForm();
  setAuthenticatedUI(false);
  showView("login");
  setTimeout(() => $("#pinInput")?.focus(), 0);
  cleanOldCacheOnce();
  if (state.token) {
    try {
      await loadAll();
      setAuthenticatedUI(true);
      showView("dashboard");
    } catch (error) {
      logout();
    }
  }
}

document.addEventListener("DOMContentLoaded", init);
