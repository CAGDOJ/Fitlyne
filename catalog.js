"use strict";

const C = window.FITLYNE_CONFIG;

if (!C || !String(C.API_URL || "").startsWith("https://script.google.com/macros/s/")) {
  throw new Error("Configuração inválida. Edite somente o arquivo fitlyne-config.js.");
}

const FITLYNE_API_URL = C.API_URL;
const CACHE_KEY = `fitlynePublicCatalog:${C.BUILD || "atual"}`;
console.info("FITLYNE catálogo ativo", { build: C.BUILD, api: FITLYNE_API_URL });
window.FITLYNE_DIAGNOSTICO = () => ({
  build: C.BUILD,
  api: C.API_URL,
  cloudinary: C.CLOUDINARY_CLOUD_NAME,
  preset: C.CLOUDINARY_UPLOAD_PRESET,
  app: "catalogo"
});

const state = {
  products: [],
  photos: [],
  config: {},
  filter: "",
  sort: "CLICKS",
  currentGroupIds: [],
  shippingRegion: localStorage.getItem("fitlyneShippingRegion") || "",
  cart: JSON.parse(localStorage.getItem("fitlyneCart") || "[]")
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
})[char]);
const sameId = (left, right) => String(left ?? "").trim() === String(right ?? "").trim();

function normalizedNiche(value) {
  const text = String(value ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (text.includes("FIT")) return "FITNESS";
  if (text.includes("SKIN") || text.includes("PELE")) return "SKINCARE";
  if (text.includes("MAKE") || text.includes("MAQUI")) return "MAKEUP";
  return text;
}

function groupKey(product) {
  const id = String(product?.ID || "").trim();
  const explicit = String(product?.GRUPO_CATALOGO || "").trim();
  // Produtos são independentes por padrão. O produto principal entra no mesmo
  // grupo quando outra variação aponta para o ID dele.
  if (explicit) return `GROUP:${explicit}`;
  const isGroupRoot = state.products.some((entry) => sameId(entry.GRUPO_CATALOGO, id));
  return isGroupRoot ? `GROUP:${id}` : `PRODUCT:${id}`;
}

function variantsFor(product) {
  const key = groupKey(product);
  return state.products.filter((entry) => groupKey(entry) === key);
}

function fireAndForget(action, payload) {
  fetch(FITLYNE_API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, payload, public: true }), redirect: "follow", keepalive: true }).catch(() => {});
}

function shippingEnabled() {
  return String(state.config.FRETE_ATIVO || "NAO").trim().toUpperCase() === "SIM";
}

function shippingRegions() {
  return [
    { id: "BELEM", label: "Belém", amount: Number(state.config.FRETE_BELEM || 0) },
    { id: "ANANINDEUA", label: "Ananindeua", amount: Number(state.config.FRETE_ANANINDEUA || 0) },
    { id: "MARITUBA", label: "Marituba", amount: Number(state.config.FRETE_MARITUBA || 0) }
  ].filter((region) => region.amount > 0);
}

function selectedShippingRegion() {
  return shippingRegions().find((region) => region.id === state.shippingRegion) || null;
}

function shippingFor(subtotal) {
  if (!shippingEnabled()) return { enabled: false, amount: 0, label: "Desativado", region: null };
  const region = selectedShippingRegion();
  if (!region) return { enabled: true, amount: null, label: "Selecione a região", region: null };
  const freeAbove = Number(state.config.FRETE_GRATIS_ACIMA || 0);
  if (freeAbove > 0 && subtotal >= freeAbove) return { enabled: true, amount: 0, label: "Grátis", region };
  return { enabled: true, amount: region.amount, label: money(region.amount), region };
}

function renderShippingRegions() {
  const box = $("#shippingRegionBox");
  const select = $("#shippingRegion");
  const row = $("#cartShippingRow");
  if (!box || !select || !row) return;
  const enabled = shippingEnabled();
  box.hidden = !enabled;
  row.hidden = !enabled;
  if (!enabled) { state.shippingRegion = ""; localStorage.removeItem("fitlyneShippingRegion"); return; }
  const regions = shippingRegions();
  select.innerHTML = '<option value="">Selecione sua região</option>' + regions.map((region) => `<option value="${region.id}">${esc(region.label)} — ${money(region.amount)}</option>`).join("");
  if (!regions.some((region) => region.id === state.shippingRegion)) state.shippingRegion = "";
  select.value = state.shippingRegion;
}

function deliveryText() {
  const days = Math.max(0, Number(state.config.PRAZO_ENTREGA_DIAS || 0));
  if (!days) return "Prazo de entrega a combinar";
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `Entrega estimada em ${days} dia${days === 1 ? "" : "s"} · até ${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.style.display = "block";
  clearTimeout(window.__fitlyneToast);
  window.__fitlyneToast = setTimeout(() => { element.style.display = "none"; }, 2800);
}

async function publicApi(action, payload = {}, allowFallback = true) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(FITLYNE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload, public: true }),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
    const raw = await response.text();
    let output;
    try { output = JSON.parse(raw); }
    catch (error) { throw new Error(`A API retornou uma resposta inválida (HTTP ${response.status}).`); }
    if (!response.ok || !output.ok) {
      const message = output.error || "Não foi possível concluir a solicitação.";
      if (allowFallback && action === "requestProduct" && /sess[aã]o inv[aá]lida/i.test(message)) {
        return publicApi("publicRequestProduct", payload, false);
      }
      throw new Error(message);
    }
    return output.data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("A operação demorou demais. Tente novamente.");
    throw error;
  } finally { clearTimeout(timer); }
}

function placeholder() {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"><rect width="100%" height="100%" fill="#eee"/><text x="50%" y="50%" text-anchor="middle" font-family="Arial" font-size="30" fill="#999">SEM FOTO</text></svg>');
}

function productPhotos(productId) {
  return state.photos.filter((photo) => sameId(photo.ID_PRODUTO, productId));
}

function productPhotoData(productId) {
  const photos = productPhotos(productId);
  const main = photos.find((photo) => String(photo.PRINCIPAL).trim().toUpperCase() === "SIM") || photos[0];
  const original = String(main?.URL_ORIGINAL || "").trim();
  const optimized = String(main?.URL_CATALOGO || main?.URL_FEED || "").trim();
  return { src: optimized || original || placeholder(), fallback: original || placeholder() };
}

function productPhoto(productId) {
  return productPhotoData(productId).src;
}

function effectiveStatus(product) {
  const apiStatus = String(product.STATUS_CATALOGO || "").toUpperCase();
  if (["DISPONIVEL", "ESGOTADO", "REPOSICAO"].includes(apiStatus)) return apiStatus;
  if (product.DISPONIVEL === true || String(product.DISPONIVEL).toUpperCase() === "SIM") return "DISPONIVEL";
  if (product.DISPONIVEL === false || String(product.DISPONIVEL).toUpperCase() === "NAO") return "ESGOTADO";
  return Number(product.ESTOQUE_ATUAL || 0) > 0 ? "DISPONIVEL" : "ESGOTADO";
}

function isAvailable(product) {
  return effectiveStatus(product) === "DISPONIVEL";
}

function statusInfo(product) {
  const status = effectiveStatus(product);
  return ({
    DISPONIVEL: { label: "Disponível", className: "available" },
    ESGOTADO: { label: "Esgotado", className: "sold-out" },
    REPOSICAO: { label: "Reposição em breve", className: "restock" }
  })[status] || { label: "Esgotado", className: "sold-out" };
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits;
}

function validPhone(value) {
  const digits = normalizePhone(value);
  return /^55\d{10,11}$/.test(digits) || /^\d{12,15}$/.test(digits);
}

function applyData(data) {
  if (!data || !Array.isArray(data.products) || !Array.isArray(data.photos)) return;
  state.products = data.products.map((product) => ({ ...product, ID: String(product.ID ?? "").trim(), NICHO: normalizedNiche(product.NICHO), CLIQUES: Number(product.CLIQUES || 0), PEDIDOS: Number(product.PEDIDOS || 0) }));
  state.photos = data.photos.map((photo) => ({ ...photo, ID_PRODUTO: String(photo.ID_PRODUTO ?? "").trim() }));
  state.config = data.config || {};
  $("#storeName").textContent = state.config.NOME_LOJA || C.STORE_NAME;
  $("#storeSubtitle").textContent = state.config.SUBTITULO || C.STORE_SUBTITLE;
  sanitizeCart();
  renderCatalog();
  renderCart();
}

function readCachedCatalog() {
  try {
    // Limpa caches antigos que poderiam manter o catálogo vazio após uma atualização.
    Object.keys(localStorage).filter((key) => key.startsWith("fitlynePublicCatalog:") && key !== CACHE_KEY).forEach((key) => localStorage.removeItem(key));
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached?.data) applyData(cached.data);
    return Boolean(cached?.data);
  } catch (error) {
    localStorage.removeItem(CACHE_KEY);
    return false;
  }
}

async function fetchCatalog() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(FITLYNE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "publicCatalog", payload: {} }),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
    const raw = await response.text();
    let output;
    try { output = JSON.parse(raw); }
    catch (error) { throw new Error(`O catálogo recebeu uma resposta inválida (HTTP ${response.status}).`); }
    if (!response.ok || !output.ok) throw new Error(output.error || "Erro ao carregar o catálogo.");
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: output.data }));
    applyData(output.data);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("O catálogo demorou demais para atualizar.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function load() {
  const hadCache = readCachedCatalog();
  if (!hadCache) $("#catalogGrid").innerHTML = '<p class="muted catalog-loading">Carregando catálogo...</p>';
  try {
    await fetchCatalog();
  } catch (error) {
    if (hadCache) toast("Mostrando o catálogo salvo. A atualização online falhou.");
    else throw error;
  }
}

function sanitizeCart() {
  state.cart = state.cart.filter((item) => {
    const product = state.products.find((entry) => sameId(entry.ID, item.productId));
    return product && isAvailable(product);
  }).map((item) => ({ productId: item.productId, quantity: Math.min(99, Math.max(1, Number(item.quantity || 1))) }));
  saveCart();
}

function saveCart() {
  localStorage.setItem("fitlyneCart", JSON.stringify(state.cart));
}

function renderCatalog() {
  const query = $("#searchInput").value.toLowerCase();
  const filtered = state.products.filter((product) =>
    (!state.filter || normalizedNiche(product.NICHO) === state.filter) &&
    (`${product.NOME} ${product.CATEGORIA} ${product.COR_TOM} ${product.SKU || ""}`).toLowerCase().includes(query)
  );
  const groups = new Map();
  filtered.forEach((product) => { const key = groupKey(product); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(product); });
  let entries = [...groups.values()].map((variants) => {
    const available = variants.find(isAvailable) || variants[0];
    return { variants, product: available, clicks: variants.reduce((sum, p) => sum + Number(p.CLIQUES || 0), 0), orders: variants.reduce((sum, p) => sum + Number(p.PEDIDOS || 0), 0), minPrice: Math.min(...variants.map((p) => Number(p.PRECO_VENDA || 0))) };
  });
  const sort = state.sort || "CLICKS";
  entries.sort((a, b) => sort === "ORDERS" ? b.orders - a.orders : sort === "PRICE_ASC" ? a.minPrice - b.minPrice : sort === "PRICE_DESC" ? b.minPrice - a.minPrice : b.clicks - a.clicks);
  $("#catalogGrid").innerHTML = entries.map(({ product, variants, minPrice }) => {
    const status = variants.some(isAvailable) ? { label: "Disponível", className: "available" } : statusInfo(product);
    const available = variants.some(isAvailable);
    const photo = productPhotoData(product.ID);
    const variationNames = [...new Set(variants.map((item) => String(item.COR_TOM || item.TAMANHO_EXIBICAO || "Opção").trim()).filter(Boolean))];
    const variation = variants.length > 1 ? `<span class="variation-pill">${variants.length} opções</span>` : (product.COR_TOM ? `<span class="variation-pill">${esc(product.COR_TOM)}</span>` : "");
    const priceLabel = variants.length > 1 && variants.some((item) => Number(item.PRECO_VENDA || 0) !== minPrice) ? `A partir de ${money(minPrice)}` : money(product.PRECO_VENDA);
    return `<article class="card ${available ? "" : "unavailable-card"}">
      <div class="image-wrap">
        <img loading="lazy" decoding="async" src="${esc(photo.src)}" data-fallback-src="${esc(photo.fallback)}" alt="${esc(product.NOME)}">
        <span class="availability-badge ${status.className}">${status.label}</span>
      </div>
      <div class="body">
        <div class="card-meta"><span class="badge">${esc(normalizedNiche(product.NICHO))}</span>${variation}</div>
        <h3>${esc(product.NOME)}</h3>
        ${variationNames.length > 1 ? `<p class="muted variation-list">${esc(variationNames.slice(0,4).join(" · "))}${variationNames.length > 4 ? " …" : ""}</p>` : `<p class="product-sku">${esc(product.SKU || "")}</p>`}
        <p class="price">${priceLabel}</p>
        <div class="product-actions">
          <button onclick="openProduct('${product.ID}')">${variants.length > 1 ? "Escolher opção" : "Ver produto"}</button>
          ${variants.length > 1 ? `<button class="add-cart" onclick="openProduct('${product.ID}')">Ver variações</button>` : `<button class="add-cart ${available ? "" : "request-stock"}" ${available ? `onclick="addToCart('${product.ID}')"` : `onclick="openRestockRequest('${product.ID}')"`}>${available ? "Adicionar ao carrinho" : "Avise-me quando chegar"}</button>`}
        </div>
      </div>
    </article>`;
  }).join("") || '<p class="muted">Nenhum produto encontrado.</p>';
}

window.openProduct = function openProduct(productId) {
  const product = state.products.find((entry) => sameId(entry.ID, productId));
  if (!product) return;
  const group = variantsFor(product);
  state.currentGroupIds = group.map((entry) => entry.ID);
  renderProductDialog(product.ID, group);
  $("#productDialog").showModal();
};

window.selectProductVariant = function selectProductVariant(productId) {
  const group = state.currentGroupIds.map((id) => state.products.find((entry) => sameId(entry.ID, id))).filter(Boolean);
  renderProductDialog(productId, group.length ? group : variantsFor(state.products.find((entry) => sameId(entry.ID, productId)) || {}));
};

function renderProductDialog(productId, group) {
  const product = state.products.find((entry) => sameId(entry.ID, productId));
  if (!product) return;
  product.CLIQUES = Number(product.CLIQUES || 0) + 1;
  fireAndForget("trackClick", { productId });
  const photos = productPhotos(productId);
  const status = statusInfo(product);
  const available = isAvailable(product);
  const gallery = (photos.length ? photos : [{ URL_CATALOGO: productPhoto(productId), URL_ORIGINAL: productPhoto(productId) }]).map((photo) => {
    const original = String(photo.URL_ORIGINAL || "").trim() || placeholder();
    const src = String(photo.URL_FEED || photo.URL_CATALOGO || "").trim() || original;
    return `<img loading="lazy" decoding="async" src="${esc(src)}" data-fallback-src="${esc(original)}" alt="${esc(product.NOME)}">`;
  }).join("");
  const options = group.length > 1 ? `<div class="variant-picker"><span>Escolha a opção</span><div>${group.map((variant) => { const label = variant.COR_TOM || variant.TAMANHO_EXIBICAO || variant.SKU; return `<button type="button" class="variant-choice ${sameId(variant.ID, product.ID) ? "active" : ""}" onclick="selectProductVariant('${variant.ID}')">${esc(label)}${isAvailable(variant) ? "" : " · esgotado"}</button>`; }).join("")}</div></div>` : "";
  $("#dialogContent").innerHTML = `
    <div class="gallery">${gallery}</div>
    <div class="dialog-body">
      <div class="dialog-badges"><span class="badge">${esc(normalizedNiche(product.NICHO))}</span><span class="availability-badge ${status.className}">${status.label}</span></div>
      <h2>${esc(product.NOME)}</h2>
      ${options}
      <p>${esc(product.DESCRICAO || "")}</p>
      <p class="product-sku">${esc(product.SKU || "")}</p>
      <p>${product.COR_TOM ? `<b>Variação:</b> ${esc(product.COR_TOM)}` : ""}${product.TAMANHO_EXIBICAO ? ` · ${esc(product.TAMANHO_EXIBICAO)}` : ""}</p>
      <h2>${money(product.PRECO_VENDA)}</h2>
      <button class="dialog-add-cart ${available ? "" : "request-stock"}" ${available ? `onclick="addToCart('${product.ID}', true)"` : `onclick="openRestockRequest('${product.ID}', true)"`}>${available ? "Adicionar ao carrinho" : "Avise-me quando chegar"}</button>
    </div>`;
}


function rememberCustomer(name, phone) {
  localStorage.setItem("fitlyneCustomer", JSON.stringify({ name, phone }));
}

function rememberedCustomer() {
  try { return JSON.parse(localStorage.getItem("fitlyneCustomer") || "{}"); }
  catch (error) { return {}; }
}

function openRequestDialog(product = null) {
  const remembered = rememberedCustomer();
  $("#requestProductId").value = product?.ID || "";
  $("#requestCustomerName").value = remembered.name || "";
  $("#requestCustomerPhone").value = remembered.phone || "";
  $("#requestDetails").value = "";
  $("#requestConsent").checked = false;
  if (product) {
    $("#requestDialogTitle").textContent = `Avise-me sobre ${product.NOME}`;
    $("#requestDialogText").textContent = "Quando o produto ficar disponível, seu pedido aparecerá na gestão da FITLYNE e você poderá receber o aviso pelo WhatsApp.";
    $("#requestDescription").value = product.NOME;
    $("#requestDescription").readOnly = true;
    $("#requestDescriptionLabel").querySelector("#requestDescription").required = false;
  } else {
    $("#requestDialogTitle").textContent = "Solicitar um produto";
    $("#requestDialogText").textContent = "Não encontrou o que procura? Deixe o pedido registrado para a FITLYNE verificar.";
    $("#requestDescription").value = "";
    $("#requestDescription").readOnly = false;
    $("#requestDescription").required = true;
  }
  $("#requestDialog").showModal();
  setTimeout(() => $("#requestCustomerName").focus(), 50);
}

window.openRestockRequest = function openRestockRequest(productId, closeProduct = false) {
  const product = state.products.find((entry) => sameId(entry.ID, productId));
  if (!product) return toast("Produto não encontrado.");
  if (closeProduct && $("#productDialog").open) $("#productDialog").close();
  openRequestDialog(product);
};

async function submitRequest(event) {
  event.preventDefault();
  const button = $("#submitRequestBtn");
  const productId = $("#requestProductId").value.trim();
  const product = state.products.find((entry) => sameId(entry.ID, productId));
  const name = $("#requestCustomerName").value.trim();
  const phone = normalizePhone($("#requestCustomerPhone").value);
  const description = $("#requestDescription").value.trim();
  const details = $("#requestDetails").value.trim();
  if (!name) return toast("Digite seu nome.");
  if (!validPhone(phone)) return toast("Digite um WhatsApp válido com DDI + DDD + número.");
  if (!product && !description) return toast("Informe o produto que procura.");
  if (!$("#requestConsent").checked) return toast("Autorize o aviso pelo WhatsApp para continuar.");
  button.disabled = true;
  button.textContent = "Registrando...";
  try {
    const result = await publicApi("requestProduct", {
      type: product ? "REPOSICAO" : "PRODUTO_NAO_CADASTRADO",
      productId: product?.ID || "",
      productName: product?.NOME || description,
      name,
      phone,
      details: details || (!product ? description : ""),
      consent: true
    });
    rememberCustomer(name, phone);
    $("#requestDialog").close();
    const auto = Boolean(result?.whatsappConfigured);
    toast(product
      ? (auto ? "Solicitação registrada. O aviso poderá ser enviado automaticamente quando chegar." : "Solicitação registrada. Ela já aparece na gestão da FITLYNE.")
      : "Solicitação registrada. A FITLYNE recebeu seu pedido.");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = "Registrar solicitação"; }
}

window.addToCart = function addToCart(productId, closeDialog = false) {
  const product = state.products.find((entry) => sameId(entry.ID, productId));
  if (!product || !isAvailable(product)) {
    toast(statusInfo(product || {}).label || "Produto indisponível.");
    return;
  }
  const item = state.cart.find((entry) => sameId(entry.productId, productId));
  if (item) {
    if (item.quantity >= 99) return toast("Limite de itens atingido.");
    item.quantity += 1;
  } else {
    state.cart.push({ productId, quantity: 1 });
  }
  saveCart();
  renderCart();
  toast("Produto adicionado ao carrinho.");
  if (closeDialog && $("#productDialog").open) $("#productDialog").close();
};

window.changeCartQuantity = function changeCartQuantity(productId, delta) {
  const item = state.cart.find((entry) => sameId(entry.productId, productId));
  if (!item) return;
  const next = Number(item.quantity || 1) + delta;
  if (next <= 0) return removeCartItem(productId);
  if (next > 99) return toast("Limite de itens atingido.");
  item.quantity = next;
  saveCart();
  renderCart();
};

window.removeCartItem = function removeCartItem(productId) {
  state.cart = state.cart.filter((entry) => !sameId(entry.productId, productId));
  saveCart();
  renderCart();
};

function renderCart() {
  const count = state.cart.reduce((total, item) => total + Number(item.quantity || 0), 0);
  $("#cartCount").textContent = count;
  const cartProducts = state.cart.map((item) => ({ ...item, product: state.products.find((entry) => sameId(entry.ID, item.productId)) })).filter((item) => item.product && isAvailable(item.product));
  $("#cartItems").innerHTML = cartProducts.length
    ? cartProducts.map(({ product, quantity }) => `<article class="cart-item">
        <img loading="lazy" decoding="async" src="${esc(productPhotoData(product.ID).src)}" data-fallback-src="${esc(productPhotoData(product.ID).fallback)}" alt="${esc(product.NOME)}">
        <div><h3>${esc(product.NOME)}</h3><p>${esc(product.COR_TOM || "")}</p><p>${esc(product.TAMANHO_EXIBICAO || "")}</p>
          <strong>${money(Number(product.PRECO_VENDA) * quantity)}</strong>
          <div class="cart-line"><div class="qty-control"><button onclick="changeCartQuantity('${product.ID}', -1)" aria-label="Diminuir">−</button><span>${quantity}</span><button onclick="changeCartQuantity('${product.ID}', 1)" aria-label="Aumentar">+</button></div><button class="remove-item" onclick="removeCartItem('${product.ID}')">Remover</button></div>
        </div></article>`).join("")
    : '<div class="cart-empty">Seu carrinho está vazio.</div>';
  const subtotal = cartProducts.reduce((sum, item) => sum + Number(item.product.PRECO_VENDA || 0) * Number(item.quantity || 0), 0);
  renderShippingRegions();
  const shipping = shippingFor(subtotal);
  const total = subtotal + (shipping.amount || 0);
  $("#cartSubtotal").textContent = money(subtotal);
  $("#cartShipping").textContent = shipping.label;
  $("#cartTotal").textContent = shipping.enabled && shipping.amount === null ? `${money(subtotal)} + frete` : money(total);
  $("#cartDelivery").textContent = cartProducts.length ? (shipping.enabled && !shipping.region ? "Selecione a região para calcular o frete e a entrega." : deliveryText()) : "";
  $("#checkoutWhatsApp").disabled = !cartProducts.length || (shipping.enabled && !shipping.region);
}

function openCart() {
  $("#cartDrawer").classList.add("open");
  $("#cartBackdrop").classList.add("open");
  $("#cartDrawer").setAttribute("aria-hidden", "false");
}

function closeCart() {
  $("#cartDrawer").classList.remove("open");
  $("#cartBackdrop").classList.remove("open");
  $("#cartDrawer").setAttribute("aria-hidden", "true");
}

function checkoutWhatsApp() {
  const cartProducts = state.cart.map((item) => ({ ...item, product: state.products.find((entry) => sameId(entry.ID, item.productId)) })).filter((item) => item.product && isAvailable(item.product));
  if (!cartProducts.length) return toast("Adicione produtos ao carrinho.");
  const phone = normalizePhone(state.config.WHATSAPP || "");
  if (!validPhone(phone)) return toast("O WhatsApp da loja ainda não foi configurado corretamente.");
  const lines = cartProducts.map(({ product, quantity }, index) => {
    const subtotal = Number(product.PRECO_VENDA || 0) * Number(quantity || 0);
    return [
      `${index + 1}. ${product.NOME}`,
      `   Quantidade desejada: ${quantity}`,
      product.COR_TOM ? `   Cor/Tom: ${product.COR_TOM}` : "",
      product.TAMANHO_EXIBICAO ? `   Tamanho: ${product.TAMANHO_EXIBICAO}` : "",
      `   Subtotal: ${money(subtotal)}`
    ].filter(Boolean).join("\n");
  });
  const subtotal = cartProducts.reduce((sum, item) => sum + Number(item.product.PRECO_VENDA || 0) * Number(item.quantity || 0), 0);
  const shipping = shippingFor(subtotal);
  if (shipping.enabled && !shipping.region) return toast("Selecione Belém, Ananindeua ou Marituba para calcular o frete.");
  const total = subtotal + (shipping.amount || 0);
  const note = $("#cartNote").value.trim();
  const shippingLines = shipping.enabled ? [
    `Entrega: ${shipping.region.label}`,
    `Frete: ${shipping.label}`
  ] : [];
  const message = [
    `Olá! Gostaria de solicitar estes produtos da ${state.config.NOME_LOJA || C.STORE_NAME}:`,
    "", ...lines, "", `Subtotal: ${money(subtotal)}`, ...shippingLines, `Total estimado: ${money(total)}`, shipping.enabled ? `Prazo: ${deliveryText()}` : "",
    note ? `Observação: ${note}` : "", "",
    "Pode confirmar a disponibilidade e as formas de pagamento?"
  ].filter(Boolean).join("\n");
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  cartProducts.forEach(({ product, quantity }) => { product.PEDIDOS = Number(product.PEDIDOS || 0) + Number(quantity || 1); });
  fireAndForget("trackOrderIntent", { items: cartProducts.map(({ product, quantity }) => ({ productId: product.ID, quantity })) });
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    window.location.href = url;
  } else {
    const popup = window.open(url, "_blank");
    if (!popup) window.location.href = url;
  }
}

$("#searchInput").oninput = renderCatalog;
$$('[data-filter]').forEach((button) => button.onclick = () => {
  $$('[data-filter]').forEach((entry) => entry.classList.remove("active"));
  button.classList.add("active");
  state.filter = button.dataset.filter;
  renderCatalog();
});
$("#sortSelect").onchange = (event) => { state.sort = event.target.value; renderCatalog(); };
$("#closeDialog").onclick = () => $("#productDialog").close();
$("#openGeneralRequest").onclick = () => openRequestDialog();
$("#closeRequestDialog").onclick = () => $("#requestDialog").close();
$("#requestForm").onsubmit = submitRequest;
$("#openCart").onclick = openCart;
$("#closeCart").onclick = closeCart;
$("#cartBackdrop").onclick = closeCart;
$("#shippingRegion").onchange = (event) => {
  state.shippingRegion = event.target.value;
  if (state.shippingRegion) localStorage.setItem("fitlyneShippingRegion", state.shippingRegion);
  else localStorage.removeItem("fitlyneShippingRegion");
  renderCart();
};
$("#checkoutWhatsApp").onclick = checkoutWhatsApp;

load().catch((error) => {
  $("#catalogGrid").innerHTML = `<p class="muted">${esc(error.message)}</p>`;
  renderCart();
});
