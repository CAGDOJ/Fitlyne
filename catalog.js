"use strict";

const C = window.FITLYNE_CONFIG || {};
const state = {
  products: [],
  photos: [],
  config: {},
  filter: "",
  cart: JSON.parse(localStorage.getItem("fitlyneCart") || "[]")
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.style.display = "block";
  clearTimeout(window.__fitlyneToast);
  window.__fitlyneToast = setTimeout(() => {
    element.style.display = "none";
  }, 2400);
}

function placeholder() {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750">' +
    '<rect width="100%" height="100%" fill="#eee"/>' +
    '<text x="50%" y="50%" text-anchor="middle" font-family="Arial" font-size="30" fill="#999">SEM FOTO</text>' +
    '</svg>'
  );
}

function productPhoto(productId) {
  const photos = state.photos.filter((photo) => photo.ID_PRODUTO === productId);
  const main = photos.find((photo) =>
    String(photo.PRINCIPAL).toUpperCase() === "SIM"
  ) || photos[0];

  return main?.URL_CATALOGO || placeholder();
}

async function load() {
  if (!C.API_URL || C.API_URL.includes("COLE_AQUI")) {
    throw new Error("Configure a URL da API no arquivo config.js.");
  }

  const response = await fetch(C.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "publicCatalog",
      payload: {}
    })
  });

  const output = await response.json();

  if (!output.ok) {
    throw new Error(output.error || "Erro ao carregar o catálogo.");
  }

  Object.assign(state, output.data);

  $("#storeName").textContent =
    state.config.NOME_LOJA || C.STORE_NAME || "FITLYNE";

  $("#storeSubtitle").textContent =
    state.config.SUBTITULO || C.STORE_SUBTITLE || "Moda Fitness & Makeup";

  sanitizeCart();
  renderCatalog();
  renderCart();
}

function sanitizeCart() {
  state.cart = state.cart.filter((item) => {
    const product = state.products.find((entry) => entry.ID === item.productId);
    return product && product.ATIVO === "SIM" && Number(product.ESTOQUE_ATUAL) > 0;
  });

  state.cart.forEach((item) => {
    const product = state.products.find((entry) => entry.ID === item.productId);
    item.quantity = Math.min(
      Math.max(1, Number(item.quantity || 1)),
      Number(product.ESTOQUE_ATUAL || 1)
    );
  });

  saveCart();
}

function saveCart() {
  localStorage.setItem("fitlyneCart", JSON.stringify(state.cart));
}

function renderCatalog() {
  const query = $("#searchInput").value.toLowerCase();

  const products = state.products.filter((product) =>
    product.ATIVO === "SIM" &&
    Number(product.ESTOQUE_ATUAL) > 0 &&
    (!state.filter || product.NICHO === state.filter) &&
    (`${product.NOME} ${product.CATEGORIA} ${product.COR_TOM}`)
      .toLowerCase()
      .includes(query)
  );

  $("#catalogGrid").innerHTML = products.map((product) => `
    <article class="card">
      <img src="${productPhoto(product.ID)}" alt="${esc(product.NOME)}">
      <div class="body">
        <span class="badge">${esc(product.NICHO)}</span>
        <h3>${esc(product.NOME)}</h3>
        <p class="muted">${esc(product.TAMANHO_EXIBICAO || "")}</p>
        <p class="price">${money(product.PRECO_VENDA)}</p>
        <p class="stock-text">${Number(product.ESTOQUE_ATUAL)} disponível(is)</p>
        <div class="product-actions">
          <button onclick="openProduct('${product.ID}')">Ver produto</button>
          <button class="add-cart" onclick="addToCart('${product.ID}')">Adicionar ao carrinho</button>
        </div>
      </div>
    </article>
  `).join("") || '<p class="muted">Nenhum produto disponível.</p>';
}

window.openProduct = function openProduct(productId) {
  const product = state.products.find((entry) => entry.ID === productId);
  const photos = state.photos.filter((photo) => photo.ID_PRODUTO === productId);

  const gallery = (
    photos.length ? photos : [{ URL_CATALOGO: productPhoto(productId) }]
  ).map((photo) => `<img src="${photo.URL_CATALOGO}" alt="">`).join("");

  $("#dialogContent").innerHTML = `
    <div class="gallery">${gallery}</div>
    <div class="dialog-body">
      <span class="badge">${esc(product.NICHO)}</span>
      <h2>${esc(product.NOME)}</h2>
      <p>${esc(product.DESCRICAO || "")}</p>
      <p>
        <b>${esc(product.TAMANHO_EXIBICAO || "")}</b>
        ${product.COR_TOM ? " · " + esc(product.COR_TOM) : ""}
      </p>
      <p class="stock-text">${Number(product.ESTOQUE_ATUAL)} disponível(is)</p>
      <h2>${money(product.PRECO_VENDA)}</h2>
      <button class="dialog-add-cart" onclick="addToCart('${product.ID}', true)">
        Adicionar ao carrinho
      </button>
    </div>
  `;

  $("#productDialog").showModal();
};

window.addToCart = function addToCart(productId, closeDialog = false) {
  const product = state.products.find((entry) => entry.ID === productId);

  if (!product || Number(product.ESTOQUE_ATUAL) <= 0) {
    toast("Produto sem estoque.");
    return;
  }

  const item = state.cart.find((entry) => entry.productId === productId);

  if (item) {
    if (item.quantity >= Number(product.ESTOQUE_ATUAL)) {
      toast("Quantidade máxima disponível atingida.");
      return;
    }
    item.quantity += 1;
  } else {
    state.cart.push({ productId, quantity: 1 });
  }

  saveCart();
  renderCart();
  toast("Produto adicionado ao carrinho.");

  if (closeDialog && $("#productDialog").open) {
    $("#productDialog").close();
  }
};

window.changeCartQuantity = function changeCartQuantity(productId, delta) {
  const item = state.cart.find((entry) => entry.productId === productId);
  const product = state.products.find((entry) => entry.ID === productId);

  if (!item || !product) return;

  const next = item.quantity + delta;

  if (next <= 0) {
    removeCartItem(productId);
    return;
  }

  if (next > Number(product.ESTOQUE_ATUAL)) {
    toast("Não há mais unidades disponíveis.");
    return;
  }

  item.quantity = next;
  saveCart();
  renderCart();
};

window.removeCartItem = function removeCartItem(productId) {
  state.cart = state.cart.filter((entry) => entry.productId !== productId);
  saveCart();
  renderCart();
};

function renderCart() {
  const count = state.cart.reduce(
    (total, item) => total + Number(item.quantity || 0),
    0
  );

  $("#cartCount").textContent = count;

  const cartProducts = state.cart
    .map((item) => ({
      ...item,
      product: state.products.find((entry) => entry.ID === item.productId)
    }))
    .filter((item) => item.product);

  $("#cartItems").innerHTML = cartProducts.length
    ? cartProducts.map(({ product, quantity }) => `
      <article class="cart-item">
        <img src="${productPhoto(product.ID)}" alt="${esc(product.NOME)}">
        <div>
          <h3>${esc(product.NOME)}</h3>
          <p>${esc(product.COR_TOM || "")}</p>
          <p>${esc(product.TAMANHO_EXIBICAO || "")}</p>
          <strong>${money(Number(product.PRECO_VENDA) * quantity)}</strong>
          <div class="cart-line">
            <div class="qty-control">
              <button onclick="changeCartQuantity('${product.ID}', -1)" aria-label="Diminuir">−</button>
              <span>${quantity}</span>
              <button onclick="changeCartQuantity('${product.ID}', 1)" aria-label="Aumentar">+</button>
            </div>
            <button class="remove-item" onclick="removeCartItem('${product.ID}')">Remover</button>
          </div>
        </div>
      </article>
    `).join("")
    : '<div class="cart-empty">Seu carrinho está vazio.</div>';

  const total = cartProducts.reduce(
    (sum, item) =>
      sum + Number(item.product.PRECO_VENDA || 0) * Number(item.quantity || 0),
    0
  );

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
  if (!state.cart.length) {
    toast("Adicione produtos ao carrinho.");
    return;
  }

  const phone = String(state.config.WHATSAPP || "").replace(/\D/g, "");

  if (!phone) {
    toast("O WhatsApp da loja ainda não foi configurado.");
    return;
  }

  const items = state.cart
    .map((item, index) => {
      const product = state.products.find(
        (entry) => entry.ID === item.productId
      );

      if (!product) return "";

      const subtotal =
        Number(product.PRECO_VENDA || 0) * Number(item.quantity || 0);

      return [
        `${index + 1}. ${product.NOME}`,
        `   Quantidade: ${item.quantity}`,
        product.COR_TOM ? `   Cor/Tom: ${product.COR_TOM}` : "",
        product.TAMANHO_EXIBICAO
          ? `   Tamanho: ${product.TAMANHO_EXIBICAO}`
          : "",
        `   Subtotal: ${money(subtotal)}`
      ].filter(Boolean).join("\n");
    })
    .filter(Boolean);

  const total = state.cart.reduce((sum, item) => {
    const product = state.products.find(
      (entry) => entry.ID === item.productId
    );

    return sum + (
      product
        ? Number(product.PRECO_VENDA || 0) * Number(item.quantity || 0)
        : 0
    );
  }, 0);

  const note = $("#cartNote").value.trim();

  const message = [
    `Olá! Gostaria de solicitar estes produtos da ${state.config.NOME_LOJA || "FITLYNE"}:`,
    "",
    ...items,
    "",
    `Total estimado: ${money(total)}`,
    note ? `Observação: ${note}` : "",
    "",
    "Pode confirmar a disponibilidade e as formas de pagamento?"
  ].filter(Boolean).join("\n");

  window.open(
    `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
    "_blank",
    "noopener"
  );
}

$("#searchInput").oninput = renderCatalog;

$$("[data-filter]").forEach((button) => {
  button.onclick = () => {
    $$("[data-filter]").forEach((entry) =>
      entry.classList.remove("active")
    );

    button.classList.add("active");
    state.filter = button.dataset.filter;
    renderCatalog();
  };
});

$("#closeDialog").onclick = () => $("#productDialog").close();
$("#openCart").onclick = openCart;
$("#closeCart").onclick = closeCart;
$("#cartBackdrop").onclick = closeCart;
$("#checkoutWhatsApp").onclick = checkoutWhatsApp;

load().catch((error) => {
  $("#catalogGrid").innerHTML =
    `<p class="muted">${esc(error.message)}</p>`;
  renderCart();
});
