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
  cart: JSON.parse(localStorage.getItem("fitlyneCart") || "[]")
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
})[char]);
const sameId = (left, right) => String(left ?? "").trim() === String(right ?? "").trim();

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.style.display = "block";
  clearTimeout(window.__fitlyneToast);
  window.__fitlyneToast = setTimeout(() => { element.style.display = "none"; }, 2800);
}

async function publicApi(action, payload = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(FITLYNE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload }),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
    const raw = await response.text();
    let output;
    try { output = JSON.parse(raw); }
    catch (error) { throw new Error(`A API retornou uma resposta inválida (HTTP ${response.status}).`); }
    if (!response.ok || !output.ok) throw new Error(output.error || "Não foi possível concluir a solicitação.");
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
  state.products = data.products.map((product) => ({ ...product, ID: String(product.ID ?? "").trim() }));
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
  const products = state.products.filter((product) =>
    (!state.filter || product.NICHO === state.filter) &&
    (`${product.NOME} ${product.CATEGORIA} ${product.COR_TOM}`).toLowerCase().includes(query)
  );
  $("#catalogGrid").innerHTML = products.map((product) => {
    const status = statusInfo(product);
    const available = isAvailable(product);
    const photo = productPhotoData(product.ID);
    return `<article class="card ${available ? "" : "unavailable-card"}">
      <div class="image-wrap">
        <img loading="lazy" decoding="async" src="${esc(photo.src)}" data-fallback-src="${esc(photo.fallback)}" alt="${esc(product.NOME)}">
        <span class="availability-badge ${status.className}">${status.label}</span>
      </div>
      <div class="body">
        <span class="badge">${esc(product.NICHO)}</span>
        <h3>${esc(product.NOME)}</h3>
        <p class="muted">${esc(product.TAMANHO_EXIBICAO || "")}</p>
        <p class="price">${money(product.PRECO_VENDA)}</p>
        <div class="product-actions">
          <button onclick="openProduct('${product.ID}')">Ver produto</button>
          <button class="add-cart ${available ? "" : "request-stock"}" ${available ? `onclick="addToCart('${product.ID}')"` : `onclick="openRestockRequest('${product.ID}')"`}>${available ? "Adicionar ao carrinho" : "Avise-me quando chegar"}</button>
        </div>
      </div>
    </article>`;
  }).join("") || '<p class="muted">Nenhum produto encontrado.</p>';
}

window.openProduct = function openProduct(productId) {
  const product = state.products.find((entry) => sameId(entry.ID, productId));
  if (!product) return;
  const photos = productPhotos(productId);
  const status = statusInfo(product);
  const available = isAvailable(product);
  const gallery = (photos.length ? photos : [{ URL_CATALOGO: productPhoto(productId), URL_ORIGINAL: productPhoto(productId) }]).map((photo) => {
    const original = String(photo.URL_ORIGINAL || "").trim() || placeholder();
    const src = String(photo.URL_FEED || photo.URL_CATALOGO || "").trim() || original;
    return `<img loading="lazy" decoding="async" src="${esc(src)}" data-fallback-src="${esc(original)}" alt="${esc(product.NOME)}">`;
  }).join("");
  $("#dialogContent").innerHTML = `
    <div class="gallery">${gallery}</div>
    <div class="dialog-body">
      <div class="dialog-badges"><span class="badge">${esc(product.NICHO)}</span><span class="availability-badge ${status.className}">${status.label}</span></div>
      <h2>${esc(product.NOME)}</h2>
      <p>${esc(product.DESCRICAO || "")}</p>
      <p><b>${esc(product.TAMANHO_EXIBICAO || "")}</b>${product.COR_TOM ? " · " + esc(product.COR_TOM) : ""}</p>
      <h2>${money(product.PRECO_VENDA)}</h2>
      <button class="dialog-add-cart ${available ? "" : "request-stock"}" ${available ? `onclick="addToCart('${product.ID}', true)"` : `onclick="openRestockRequest('${product.ID}', true)"`}>${available ? "Adicionar ao carrinho" : "Avise-me quando chegar"}</button>
    </div>`;
  $("#productDialog").showModal();
};


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
    await publicApi("requestProduct", {
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
    toast(product ? "Pronto! Avisaremos pelo WhatsApp quando chegar." : "Solicitação registrada. A FITLYNE recebeu seu pedido.");
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
  const total = cartProducts.reduce((sum, item) => sum + Number(item.product.PRECO_VENDA || 0) * Number(item.quantity || 0), 0);
  $("#cartTotal").textContent = money(total);
  $("#checkoutWhatsApp").disabled = !cartProducts.length;
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
  const total = cartProducts.reduce((sum, item) => sum + Number(item.product.PRECO_VENDA || 0) * Number(item.quantity || 0), 0);
  const note = $("#cartNote").value.trim();
  const message = [
    `Olá! Gostaria de solicitar estes produtos da ${state.config.NOME_LOJA || C.STORE_NAME}:`,
    "", ...lines, "", `Total estimado: ${money(total)}`,
    note ? `Observação: ${note}` : "", "",
    "Pode confirmar a disponibilidade e as formas de pagamento?"
  ].filter(Boolean).join("\n");
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
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
$("#closeDialog").onclick = () => $("#productDialog").close();
$("#openGeneralRequest").onclick = () => openRequestDialog();
$("#closeRequestDialog").onclick = () => $("#requestDialog").close();
$("#requestForm").onsubmit = submitRequest;
$("#openCart").onclick = openCart;
$("#closeCart").onclick = closeCart;
$("#cartBackdrop").onclick = closeCart;
$("#checkoutWhatsApp").onclick = checkoutWhatsApp;

load().catch((error) => {
  $("#catalogGrid").innerHTML = `<p class="muted">${esc(error.message)}</p>`;
  renderCart();
});
