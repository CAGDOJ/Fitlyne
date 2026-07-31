const SHEETS = {
  CONFIG: ["CHAVE", "VALOR"],
  PRODUTOS: ["ID", "SKU", "NICHO", "CATEGORIA", "MARCA", "NOME", "DESCRICAO", "COR_TOM", "TIPO_TAMANHO", "TAMANHO_EXIBICAO", "PRECO_COMPRA", "PRECO_VENDA", "ESTOQUE_ATUAL", "ESTOQUE_MINIMO", "STATUS_CATALOGO", "ATIVO", "CRIADO_EM", "ATUALIZADO_EM"],
  FOTOS: ["ID", "ID_PRODUTO", "ORDEM", "PRINCIPAL", "PUBLIC_ID", "URL_ORIGINAL", "URL_CATALOGO", "URL_FEED", "URL_STORY", "URL_WHATSAPP", "URL_FACEBOOK", "URL_SHOPEE", "URL_MERCADO_LIVRE", "CRIADO_EM"],
  VARIACOES: ["ID", "ID_PRODUTO", "TAMANHO", "ESTOQUE", "CRIADO_EM"],
  MOVIMENTACOES: ["ID", "DATA", "ID_PRODUTO", "PRODUTO", "TIPO", "QUANTIDADE", "MOTIVO"],
  VENDAS: ["ID", "DATA", "ID_PRODUTO", "PRODUTO", "QUANTIDADE", "VALOR_UNITARIO", "DESCONTO", "TOTAL", "CLIENTE", "TELEFONE", "PAGAMENTO"],
  CLIENTES: ["ID", "NOME", "TELEFONE", "COMPRAS", "TOTAL_GASTO", "ULTIMA_COMPRA"],
  DESPESAS: ["ID", "DATA", "DESCRICAO", "CATEGORIA", "VALOR"],
  SOLICITACOES: ["ID", "DATA", "TIPO", "ID_PRODUTO", "PRODUTO", "NOME", "TELEFONE", "DETALHES", "CONSENTIMENTO_WHATSAPP", "STATUS", "NOTIFICADO_EM", "META_MESSAGE_ID", "ULTIMO_ERRO", "ATUALIZADO_EM"]
};

const PUBLIC_CACHE_KEY = "FITLYNE_PUBLIC_CATALOG_PROFISSIONAL";
const VALID_CATALOG_STATUS = ["AUTOMATICO", "DISPONIVEL", "ESGOTADO", "REPOSICAO"];

function setupSystem() {
  ensureSystem_();
  setDefaultConfig_("ADMIN_PIN", "1234");
  setDefaultConfig_("WHATSAPP", "5591999999999");
  setDefaultConfig_("NOME_LOJA", "FITLYNE");
  setDefaultConfig_("SUBTITULO", "Moda Fitness & Makeup");
  setDefaultConfig_("TOKEN_TTL_HORAS", "6");
  setDefaultConfig_("CATALOG_URL", "https://cagdoj.github.io/Fitlyne/catalog.html");
  clearPublicCache_();
  migrateLegacyProducts_();
  return "Sistema FITLYNE profissional atualizado com sucesso.";
}

function ensureSystem_() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function(name) {
    const expected = SHEETS[name];
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0 || sh.getLastColumn() === 0) {
      sh.getRange(1, 1, 1, expected.length).setValues([expected]);
    } else {
      const current = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
      const missing = expected.filter(function(header) { return current.indexOf(header) < 0; });
      if (missing.length) sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight("bold").setBackground("#111111").setFontColor("#ffffff");
  });
}

function ensureProductStatusColumn_() {
  const sh = SpreadsheetApp.getActive().getSheetByName("PRODUTOS");
  if (!sh || sh.getLastColumn() < 1) return;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  if (headers.indexOf("STATUS_CATALOGO") < 0) {
    sh.getRange(1, headers.length + 1).setValue("STATUS_CATALOGO");
  }
}

function doGet() {
  return json_({ ok: true, data: { name: "FITLYNE API", version: "login-rapido" } });
}

function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = request.action || "";
    const payload = request.payload || {};
    if (action === "login") return json_({ ok: true, data: login_(payload.pin) });
    if (action === "publicCatalog") return json_({ ok: true, data: publicCatalog_() });
    if (action === "requestProduct") return json_({ ok: true, data: requestProduct_(payload) });
    if (!validateToken_(request.token)) throw new Error("Sessão inválida. Entre novamente.");
    const handlers = {
      bootstrap: bootstrap_,
      uploadImage: uploadImage_,
      saveProduct: saveProduct_,
      deleteProduct: deleteProduct_,
      setProductStatus: setProductStatus_,
      stockMovement: stockMovement_,
      saveSale: saveSale_,
      saveExpense: saveExpense_,
      saveSettings: saveSettings_,
      updateRequestStatus: updateRequestStatus_,
      notifyRequest: notifyRequest_,
      notifyAllReady: notifyAllReady_,
      saveWhatsappApiSettings: saveWhatsappApiSettings_,
      testWhatsappApi: testWhatsappApi_
    };
    if (!handlers[action]) throw new Error("Ação inválida: " + action);
    return json_({ ok: true, data: handlers[action](payload) });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function json_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}

function config_() {
  const result = {};
  readSheet_("CONFIG").forEach(function(row) { result[row.CHAVE] = row.VALOR; });
  return result;
}

function setDefaultConfig_(key, value) {
  if (!findRow_("CONFIG", "CHAVE", key)) appendObject_("CONFIG", { CHAVE: key, VALOR: value });
}

function setConfig_(key, value) {
  upsert_("CONFIG", "CHAVE", { CHAVE: key, VALOR: value });
}

function login_(pin) {
  const config = config_();
  if (String(pin) !== String(config.ADMIN_PIN)) throw new Error("PIN incorreto");
  const token = Utilities.getUuid();
  const requested = Number(config.TOKEN_TTL_HORAS || 6) * 3600;
  const ttl = Math.max(60, Math.min(requested, 21600));
  CacheService.getScriptCache().put("TOKEN_" + token, "1", ttl);

  // Token e dados iniciais seguem na mesma resposta, reduzindo uma chamada de rede.
  return { token: token, bootstrap: bootstrap_(config) };
}

function validateToken_(token) {
  return Boolean(token && CacheService.getScriptCache().get("TOKEN_" + token));
}

function bootstrap_(knownConfig) {
  if (!SpreadsheetApp.getActive().getSheetByName("SOLICITACOES")) ensureSystem_();
  return {
    products: readSheet_("PRODUTOS"),
    photos: readSheet_("FOTOS"),
    variants: readSheet_("VARIACOES"),
    movements: readSheet_("MOVIMENTACOES").reverse(),
    sales: readSheet_("VENDAS").reverse(),
    clients: readSheet_("CLIENTES"),
    expenses: readSheet_("DESPESAS").reverse(),
    requests: readSheet_("SOLICITACOES").reverse(),
    whatsappApi: whatsappApiStatus_(),
    config: knownConfig || config_()
  };
}

function number_(value) {
  if (typeof value === "number") return isFinite(value) ? value : 0;
  const normalized = String(value == null ? "" : value).trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return isFinite(parsed) ? parsed : 0;
}

function sameId_(left, right) {
  return String(left == null ? "" : left).trim() === String(right == null ? "" : right).trim();
}

function isProductActive_(product) {
  const value = String(product && product.ATIVO != null ? product.ATIVO : "").trim().toUpperCase();
  // Compatibilidade com produtos cadastrados em versões antigas: vazio significa publicado.
  return ["NAO", "NÃO", "FALSE", "0", "INATIVO", "OCULTO"].indexOf(value) < 0;
}

function migrateLegacyProducts_() {
  readSheet_("PRODUTOS").forEach(function(product) {
    let changed = false;
    if (!String(product.ATIVO == null ? "" : product.ATIVO).trim()) {
      product.ATIVO = "SIM";
      changed = true;
    }
    if (!String(product.STATUS_CATALOGO == null ? "" : product.STATUS_CATALOGO).trim()) {
      product.STATUS_CATALOGO = "AUTOMATICO";
      changed = true;
    }
    if (changed && product.ID) upsert_("PRODUTOS", "ID", product);
  });
  clearPublicCache_();
}

function catalogStatus_(product) {
  let status = String(product.STATUS_CATALOGO || "AUTOMATICO").toUpperCase();
  if (VALID_CATALOG_STATUS.indexOf(status) < 0) status = "AUTOMATICO";
  if (status === "AUTOMATICO") status = number_(product.ESTOQUE_ATUAL) > 0 ? "DISPONIVEL" : "ESGOTADO";
  if (status === "DISPONIVEL" && number_(product.ESTOQUE_ATUAL) <= 0) status = "ESGOTADO";
  return status;
}

function publicProduct_(product) {
  const status = catalogStatus_(product);
  return {
    ID: product.ID,
    SKU: product.SKU,
    NICHO: product.NICHO,
    CATEGORIA: product.CATEGORIA,
    MARCA: product.MARCA,
    NOME: product.NOME,
    DESCRICAO: product.DESCRICAO,
    COR_TOM: product.COR_TOM,
    TIPO_TAMANHO: product.TIPO_TAMANHO,
    TAMANHO_EXIBICAO: product.TAMANHO_EXIBICAO,
    PRECO_VENDA: product.PRECO_VENDA,
    STATUS_CATALOGO: status,
    DISPONIVEL: status === "DISPONIVEL",
    ATIVO: isProductActive_(product) ? "SIM" : "NAO"
  };
}

function publicCatalog_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(PUBLIC_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (error) {}
  }
  const allConfig = config_();
  const publicProducts = readSheet_("PRODUTOS").filter(function(product) {
    return isProductActive_(product);
  }).map(publicProduct_);
  const publicIds = {};
  publicProducts.forEach(function(product) { publicIds[String(product.ID == null ? "" : product.ID).trim()] = true; });
  const data = {
    products: publicProducts,
    photos: readSheet_("FOTOS").filter(function(photo) { return publicIds[String(photo.ID_PRODUTO == null ? "" : photo.ID_PRODUTO).trim()]; }),
    config: {
      WHATSAPP: allConfig.WHATSAPP || "",
      NOME_LOJA: allConfig.NOME_LOJA || "FITLYNE",
      SUBTITULO: allConfig.SUBTITULO || "Moda Fitness & Makeup",
      CATALOG_URL: allConfig.CATALOG_URL || "https://cagdoj.github.io/Fitlyne/catalog.html"
    }
  };
  try { cache.put(PUBLIC_CACHE_KEY, JSON.stringify(data), 60); } catch (error) {}
  return data;
}

function clearPublicCache_() {
  CacheService.getScriptCache().remove(PUBLIC_CACHE_KEY);
}

function cloudinaryUrl_(cloudName, publicId, format, version, transformation) {
  const versionPart = version ? "v" + version + "/" : "";
  return "https://res.cloudinary.com/" + encodeURIComponent(cloudName) + "/image/upload/" + transformation + "/" + versionPart + publicId + "." + format;
}

function uploadImage_(payload) {
  const CLOUD_NAME = "v9gfcyqm";
  const UPLOAD_PRESET = "fitlyne_upload";
  const mime = String(payload.mimeType || "image/jpeg");
  const fileName = String(payload.fileName || "foto.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
  const base64 = String(payload.base64 || "");
  const productId = String(payload.productId || "").trim();
  const order = Math.max(1, number_(payload.order || 1));
  const principal = String(payload.principal || (order === 1 ? "SIM" : "NAO")).toUpperCase() === "SIM" ? "SIM" : "NAO";
  if (!base64) throw new Error("A foto não chegou à API.");
  if (!/^image\//i.test(mime)) throw new Error("O arquivo recebido não é uma imagem.");
  let bytes;
  try { bytes = Utilities.base64Decode(base64); }
  catch (error) { throw new Error("A foto chegou corrompida à API."); }
  if (!bytes || !bytes.length) throw new Error("A foto recebida está vazia.");
  if (bytes.length > 6 * 1024 * 1024) throw new Error("A foto processada ultrapassou 6 MB.");
  const blob = Utilities.newBlob(bytes, mime, fileName);
  const endpoint = "https://api.cloudinary.com/v1_1/" + CLOUD_NAME + "/image/upload";
  const response = UrlFetchApp.fetch(endpoint, {
    method: "post",
    payload: { file: blob, upload_preset: UPLOAD_PRESET },
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const raw = response.getContentText();
  let data = {};
  try { data = JSON.parse(raw || "{}"); } catch (error) {}
  if (status < 200 || status >= 300 || !data.secure_url || !data.public_id) {
    const detail = data && data.error && data.error.message ? data.error.message : raw.slice(0, 400);
    throw new Error("Cloudinary recusou a foto (HTTP " + status + "): " + (detail || "sem detalhes"));
  }
  const format = String(data.format || "jpg");
  const photo = {
    ID: "FOTO_" + Utilities.getUuid(),
    ID_PRODUTO: productId,
    ORDEM: order,
    PRINCIPAL: principal,
    PUBLIC_ID: String(data.public_id),
    URL_ORIGINAL: String(data.secure_url),
    URL_CATALOGO: String(data.secure_url),
    URL_FEED: cloudinaryUrl_(CLOUD_NAME, data.public_id, format, data.version, "f_auto,q_auto:good,c_fill,w_1080,h_1350"),
    URL_STORY: cloudinaryUrl_(CLOUD_NAME, data.public_id, format, data.version, "f_auto,q_auto:good,c_fill,w_1080,h_1920"),
    URL_WHATSAPP: String(data.secure_url),
    URL_FACEBOOK: String(data.secure_url),
    URL_SHOPEE: String(data.secure_url),
    URL_MERCADO_LIVRE: String(data.secure_url),
    CRIADO_EM: new Date()
  };
  if (productId) {
    upsert_("FOTOS", "ID", photo);
    clearPublicCache_();
  }
  return { cloud_name: CLOUD_NAME, secure_url: data.secure_url, public_id: data.public_id, format: format, version: data.version || "", photo: photo };
}

function saveProduct_(payload) {
  const product = payload.product || {};
  if (!product.ID || !product.NOME) throw new Error("Dados do produto incompletos.");
  let status = String(product.STATUS_CATALOGO || "AUTOMATICO").toUpperCase();
  if (VALID_CATALOG_STATUS.indexOf(status) < 0) status = "AUTOMATICO";
  product.STATUS_CATALOGO = status;
  product.ATIVO = isProductActive_(product) ? "SIM" : "NAO";
  const now = new Date();
  const row = findRow_("PRODUTOS", "ID", product.ID);
  const current = row ? rowObject_("PRODUTOS", row) : null;
  const object = Object.assign({}, product, { CRIADO_EM: current ? current.CRIADO_EM : now, ATUALIZADO_EM: now });
  upsert_("PRODUTOS", "ID", object);
  replaceByProduct_("VARIACOES", product.ID, payload.variants || []);
  const photos = Array.isArray(payload.photos) ? payload.photos : [];
  if (photos.length) {
    readSheet_("FOTOS").filter(function(photo) { return sameId_(photo.ID_PRODUTO, product.ID); }).forEach(function(photo) {
      photo.PRINCIPAL = "NAO";
      upsert_("FOTOS", "ID", photo);
    });
    photos.forEach(function(photo, index) {
      const normalized = Object.assign({}, photo, {
        ID: String(photo.ID || ("FOTO_" + Utilities.getUuid())),
        ID_PRODUTO: String(product.ID),
        ORDEM: number_(photo.ORDEM || index + 1),
        PRINCIPAL: index === 0 ? "SIM" : "NAO",
        URL_ORIGINAL: String(photo.URL_ORIGINAL || photo.URL_CATALOGO || ""),
        URL_CATALOGO: String(photo.URL_CATALOGO || photo.URL_ORIGINAL || ""),
        CRIADO_EM: photo.CRIADO_EM || now
      });
      upsert_("FOTOS", "ID", normalized);
    });
  }
  if (!current && number_(product.ESTOQUE_ATUAL) > 0) {
    appendObject_("MOVIMENTACOES", { ID: Utilities.getUuid(), DATA: now, ID_PRODUTO: product.ID, PRODUTO: product.NOME, TIPO: "ENTRADA", QUANTIDADE: product.ESTOQUE_ATUAL, MOTIVO: "ESTOQUE INICIAL" });
  }
  const oldStock = current ? number_(current.ESTOQUE_ATUAL) : 0;
  const newStock = number_(product.ESTOQUE_ATUAL);
  let notifications = { ready: 0, sent: 0, failed: 0 };
  if (oldStock <= 0 && newStock > 0) notifications = markReadyAndMaybeNotify_(object);
  clearPublicCache_();
  return { id: product.ID, notifications: notifications };
}

function setProductStatus_(payload) {
  const row = findRow_("PRODUTOS", "ID", payload.id);
  if (!row) throw new Error("Produto não encontrado.");
  const status = String(payload.status || "AUTOMATICO").toUpperCase();
  if (VALID_CATALOG_STATUS.indexOf(status) < 0) throw new Error("Status de catálogo inválido.");
  const product = rowObject_("PRODUTOS", row);
  product.STATUS_CATALOGO = status;
  product.ATUALIZADO_EM = new Date();
  upsert_("PRODUTOS", "ID", product);
  let notifications = { ready: 0, sent: 0, failed: 0 };
  if (status === "DISPONIVEL" && number_(product.ESTOQUE_ATUAL) > 0) notifications = markReadyAndMaybeNotify_(product);
  clearPublicCache_();
  return { status: status, notifications: notifications };
}

function deleteProduct_(payload) {
  deleteWhere_("FOTOS", "ID_PRODUTO", payload.id);
  deleteWhere_("VARIACOES", "ID_PRODUTO", payload.id);
  deleteWhere_("PRODUTOS", "ID", payload.id);
  clearPublicCache_();
  return true;
}

function stockMovement_(payload) {
  const row = findRow_("PRODUTOS", "ID", payload.productId);
  if (!row) throw new Error("Produto não encontrado");
  const product = rowObject_("PRODUTOS", row);
  const quantity = number_(payload.qty);
  const oldStock = number_(product.ESTOQUE_ATUAL);
  const type = payload.type;
  let next = oldStock;
  if (type === "ENTRADA" || type === "DEVOLUCAO") next = oldStock + quantity;
  else if (type === "SAIDA" || type === "PERDA") next = oldStock - quantity;
  else if (type === "AJUSTE") next = quantity;
  if (next < 0) throw new Error("Estoque insuficiente");
  product.ESTOQUE_ATUAL = next;
  product.ATUALIZADO_EM = new Date();
  upsert_("PRODUTOS", "ID", product);
  appendObject_("MOVIMENTACOES", { ID: Utilities.getUuid(), DATA: new Date(), ID_PRODUTO: product.ID, PRODUTO: product.NOME, TIPO: type, QUANTIDADE: quantity, MOTIVO: payload.reason || "" });
  let notifications = { ready: 0, sent: 0, failed: 0 };
  if (oldStock <= 0 && next > 0) notifications = markReadyAndMaybeNotify_(product);
  clearPublicCache_();
  return { stock: next, notifications: notifications };
}

function saveSale_(payload) {
  const row = findRow_("PRODUTOS", "ID", payload.productId);
  if (!row) throw new Error("Produto não encontrado");
  const product = rowObject_("PRODUTOS", row);
  const quantity = number_(payload.qty || 1);
  if (number_(product.ESTOQUE_ATUAL) < quantity) throw new Error("Estoque insuficiente");
  const unit = number_(product.PRECO_VENDA);
  const discount = number_(payload.discount);
  const total = Math.max(0, unit * quantity - discount);
  const now = new Date();
  appendObject_("VENDAS", { ID: Utilities.getUuid(), DATA: now, ID_PRODUTO: product.ID, PRODUTO: product.NOME, QUANTIDADE: quantity, VALOR_UNITARIO: unit, DESCONTO: discount, TOTAL: total, CLIENTE: payload.client || "", TELEFONE: payload.phone || "", PAGAMENTO: payload.payment || "PIX" });
  product.ESTOQUE_ATUAL = number_(product.ESTOQUE_ATUAL) - quantity;
  product.ATUALIZADO_EM = now;
  upsert_("PRODUTOS", "ID", product);
  appendObject_("MOVIMENTACOES", { ID: Utilities.getUuid(), DATA: now, ID_PRODUTO: product.ID, PRODUTO: product.NOME, TIPO: "VENDA", QUANTIDADE: quantity, MOTIVO: "VENDA" });
  if (payload.client || payload.phone) upsertClient_(payload.client || "CLIENTE", payload.phone || "", total, now);
  clearPublicCache_();
  return { total: total };
}

function upsertClient_(name, phone, total, date) {
  const found = readSheet_("CLIENTES").find(function(client) { return phone && String(client.TELEFONE) === String(phone); });
  if (found) {
    found.NOME = name || found.NOME;
    found.COMPRAS = Number(found.COMPRAS || 0) + 1;
    found.TOTAL_GASTO = Number(found.TOTAL_GASTO || 0) + number_(total);
    found.ULTIMA_COMPRA = date;
    upsert_("CLIENTES", "ID", found);
  } else {
    appendObject_("CLIENTES", { ID: Utilities.getUuid(), NOME: name, TELEFONE: phone, COMPRAS: 1, TOTAL_GASTO: total, ULTIMA_COMPRA: date });
  }
}

function saveExpense_(payload) {
  appendObject_("DESPESAS", { ID: Utilities.getUuid(), DATA: new Date(), DESCRICAO: payload.description, CATEGORIA: payload.category || "", VALOR: number_(payload.value) });
  return true;
}

function saveSettings_(payload) {
  const phone = String(payload.WHATSAPP || "").replace(/\D/g, "");
  if (phone.length < 12 || phone.length > 15) throw new Error("WhatsApp inválido. Use DDI + DDD + número.");
  setConfig_("WHATSAPP", phone);
  setConfig_("NOME_LOJA", String(payload.NOME_LOJA || "FITLYNE").trim());
  setConfig_("SUBTITULO", String(payload.SUBTITULO || "Moda Fitness & Makeup").trim());
  if (payload.CATALOG_URL) setConfig_("CATALOG_URL", String(payload.CATALOG_URL).trim());
  clearPublicCache_();
  return true;
}


function normalizePhone_(value) {
  let digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return digits;
}

function validPhone_(value) {
  const digits = normalizePhone_(value);
  return /^55\d{10,11}$/.test(digits) || /^\d{12,15}$/.test(digits);
}

function requestProduct_(payload) {
  if (!SpreadsheetApp.getActive().getSheetByName("SOLICITACOES")) ensureSystem_();
  const name = String(payload.name || "").trim().slice(0, 80);
  const phone = normalizePhone_(payload.phone);
  const type = String(payload.type || "PRODUTO_NAO_CADASTRADO").toUpperCase() === "REPOSICAO" ? "REPOSICAO" : "PRODUTO_NAO_CADASTRADO";
  const productId = String(payload.productId || "").trim();
  let productName = String(payload.productName || "").trim().slice(0, 180);
  const details = String(payload.details || "").trim().slice(0, 500);
  if (!name) throw new Error("Informe seu nome.");
  if (!validPhone_(phone)) throw new Error("Informe um WhatsApp válido com DDI + DDD + número.");
  if (payload.consent !== true) throw new Error("É necessário autorizar o aviso pelo WhatsApp.");
  if (productId) {
    const row = findRow_("PRODUTOS", "ID", productId);
    if (row) productName = String(rowObject_("PRODUTOS", row).NOME || productName).trim();
  }
  if (!productName && !details) throw new Error("Informe o produto que procura.");
  const existing = readSheet_("SOLICITACOES").find(function(request) {
    const active = ["AGUARDANDO", "PRONTO_PARA_AVISAR"].indexOf(String(request.STATUS || "AGUARDANDO").toUpperCase()) >= 0;
    return active && normalizePhone_(request.TELEFONE) === phone && sameId_(request.ID_PRODUTO, productId) && String(request.PRODUTO || "").trim().toUpperCase() === productName.toUpperCase();
  });
  const now = new Date();
  const object = {
    ID: existing ? existing.ID : "SOL_" + Utilities.getUuid(),
    DATA: existing ? existing.DATA : now,
    TIPO: type,
    ID_PRODUTO: productId,
    PRODUTO: productName || details,
    NOME: name,
    TELEFONE: phone,
    DETALHES: details,
    CONSENTIMENTO_WHATSAPP: "SIM",
    STATUS: existing ? (existing.STATUS || "AGUARDANDO") : "AGUARDANDO",
    NOTIFICADO_EM: existing ? existing.NOTIFICADO_EM : "",
    META_MESSAGE_ID: existing ? existing.META_MESSAGE_ID : "",
    ULTIMO_ERRO: "",
    ATUALIZADO_EM: now
  };
  upsert_("SOLICITACOES", "ID", object);
  return { id: object.ID, status: object.STATUS, duplicated: Boolean(existing) };
}

function updateRequestStatus_(payload) {
  const row = findRow_("SOLICITACOES", "ID", payload.id);
  if (!row) throw new Error("Solicitação não encontrada.");
  const allowed = ["AGUARDANDO", "PRONTO_PARA_AVISAR", "NOTIFICADO", "ATENDIDO", "CANCELADO"];
  const status = String(payload.status || "").toUpperCase();
  if (allowed.indexOf(status) < 0) throw new Error("Status inválido.");
  const request = rowObject_("SOLICITACOES", row);
  request.STATUS = status;
  request.ATUALIZADO_EM = new Date();
  upsert_("SOLICITACOES", "ID", request);
  return { status: status };
}

function whatsappApiStatus_() {
  const properties = PropertiesService.getScriptProperties();
  const phoneNumberId = properties.getProperty("WA_PHONE_NUMBER_ID") || "";
  const token = properties.getProperty("WA_ACCESS_TOKEN") || "";
  return {
    configured: Boolean(phoneNumberId && token),
    enabled: properties.getProperty("WA_AUTO_ENABLED") === "SIM",
    phoneNumberId: phoneNumberId,
    graphVersion: properties.getProperty("WA_GRAPH_VERSION") || "v23.0",
    templateName: properties.getProperty("WA_TEMPLATE_NAME") || "produto_disponivel",
    templateLanguage: properties.getProperty("WA_TEMPLATE_LANGUAGE") || "pt_BR",
    hasToken: Boolean(token)
  };
}

function saveWhatsappApiSettings_(payload) {
  const properties = PropertiesService.getScriptProperties();
  const phoneNumberId = String(payload.phoneNumberId || "").replace(/\D/g, "");
  const graphVersion = String(payload.graphVersion || "v23.0").trim();
  const templateName = String(payload.templateName || "produto_disponivel").trim();
  const templateLanguage = String(payload.templateLanguage || "pt_BR").trim();
  const accessToken = String(payload.accessToken || "").trim();
  if (phoneNumberId && !/^\d+$/.test(phoneNumberId)) throw new Error("Phone Number ID inválido.");
  if (!/^v\d+\.\d+$/.test(graphVersion)) throw new Error("Versão da Graph API inválida. Exemplo: v23.0");
  if (!/^[a-z0-9_]+$/.test(templateName)) throw new Error("Nome do template inválido.");
  properties.setProperty("WA_PHONE_NUMBER_ID", phoneNumberId);
  properties.setProperty("WA_GRAPH_VERSION", graphVersion);
  properties.setProperty("WA_TEMPLATE_NAME", templateName);
  properties.setProperty("WA_TEMPLATE_LANGUAGE", templateLanguage || "pt_BR");
  properties.setProperty("WA_AUTO_ENABLED", payload.enabled === true ? "SIM" : "NAO");
  if (accessToken) properties.setProperty("WA_ACCESS_TOKEN", accessToken);
  return whatsappApiStatus_();
}

function sendWhatsappTemplate_(phone, customerName, productName) {
  const settings = whatsappApiStatus_();
  if (!settings.configured) throw new Error("A API oficial do WhatsApp ainda não foi configurada.");
  const token = PropertiesService.getScriptProperties().getProperty("WA_ACCESS_TOKEN") || "";
  const catalogUrl = config_().CATALOG_URL || "https://cagdoj.github.io/Fitlyne/catalog.html";
  const endpoint = "https://graph.facebook.com/" + settings.graphVersion + "/" + settings.phoneNumberId + "/messages";
  const body = {
    messaging_product: "whatsapp",
    to: normalizePhone_(phone),
    type: "template",
    template: {
      name: settings.templateName,
      language: { code: settings.templateLanguage },
      components: [{
        type: "body",
        parameters: [
          { type: "text", text: String(customerName || "Cliente") },
          { type: "text", text: String(productName || "produto solicitado") },
          { type: "text", text: String(catalogUrl) }
        ]
      }]
    }
  };
  const response = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const raw = response.getContentText();
  let data = {};
  try { data = JSON.parse(raw || "{}"); } catch (error) {}
  if (status < 200 || status >= 300) {
    const message = data && data.error && data.error.message ? data.error.message : raw.slice(0, 400);
    throw new Error("WhatsApp recusou a mensagem (HTTP " + status + "): " + (message || "sem detalhes"));
  }
  return { id: data && data.messages && data.messages[0] ? data.messages[0].id : "" };
}

function notifyRequestByObject_(request) {
  if (String(request.CONSENTIMENTO_WHATSAPP || "").toUpperCase() !== "SIM") throw new Error("A cliente não autorizou o aviso pelo WhatsApp.");
  const result = sendWhatsappTemplate_(request.TELEFONE, request.NOME, request.PRODUTO);
  request.STATUS = "NOTIFICADO";
  request.NOTIFICADO_EM = new Date();
  request.META_MESSAGE_ID = result.id || "";
  request.ULTIMO_ERRO = "";
  request.ATUALIZADO_EM = new Date();
  upsert_("SOLICITACOES", "ID", request);
  return result;
}

function notifyRequest_(payload) {
  const row = findRow_("SOLICITACOES", "ID", payload.id);
  if (!row) throw new Error("Solicitação não encontrada.");
  const request = rowObject_("SOLICITACOES", row);
  const result = notifyRequestByObject_(request);
  return { message: "Aviso enviado para " + request.NOME + ".", messageId: result.id || "" };
}

function notifyAllReady_() {
  const settings = whatsappApiStatus_();
  if (!settings.configured) throw new Error("Configure a API oficial do WhatsApp antes de enviar todos automaticamente.");
  const ready = readSheet_("SOLICITACOES").filter(function(request) {
    return String(request.STATUS || "").toUpperCase() === "PRONTO_PARA_AVISAR";
  }).slice(0, 100);
  let sent = 0;
  let failed = 0;
  ready.forEach(function(request) {
    try { notifyRequestByObject_(request); sent += 1; }
    catch (error) {
      failed += 1;
      request.ULTIMO_ERRO = String(error && error.message ? error.message : error).slice(0, 500);
      request.ATUALIZADO_EM = new Date();
      upsert_("SOLICITACOES", "ID", request);
    }
  });
  return { sent: sent, failed: failed, total: ready.length };
}

function markReadyAndMaybeNotify_(product) {
  const pending = readSheet_("SOLICITACOES").filter(function(request) {
    return sameId_(request.ID_PRODUTO, product.ID) && ["AGUARDANDO", "PRONTO_PARA_AVISAR"].indexOf(String(request.STATUS || "AGUARDANDO").toUpperCase()) >= 0;
  });
  const settings = whatsappApiStatus_();
  let sent = 0;
  let failed = 0;
  pending.forEach(function(request) {
    request.PRODUTO = request.PRODUTO || product.NOME;
    request.STATUS = "PRONTO_PARA_AVISAR";
    request.ULTIMO_ERRO = "";
    request.ATUALIZADO_EM = new Date();
    upsert_("SOLICITACOES", "ID", request);
    if (settings.configured && settings.enabled) {
      try { notifyRequestByObject_(request); sent += 1; }
      catch (error) {
        failed += 1;
        request.ULTIMO_ERRO = String(error && error.message ? error.message : error).slice(0, 500);
        request.ATUALIZADO_EM = new Date();
        upsert_("SOLICITACOES", "ID", request);
      }
    }
  });
  return { ready: pending.length, sent: sent, failed: failed };
}

function testWhatsappApi_(payload) {
  const phone = normalizePhone_(payload.phone);
  if (!validPhone_(phone)) throw new Error("Número de teste inválido.");
  const result = sendWhatsappTemplate_(phone, "Teste FITLYNE", "produto de teste");
  return { messageId: result.id || "" };
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error("Aba ausente: " + name);
  return sh;
}

function readSheet_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(function(row) { return row.some(function(value) { return value !== ""; }); }).map(function(row) {
    const object = {};
    headers.forEach(function(header, index) { object[header] = row[index]; });
    return object;
  });
}

function rowObject_(name, row) {
  const sh = sheet_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const values = sh.getRange(row, 1, 1, headers.length).getValues()[0];
  const object = {};
  headers.forEach(function(header, index) { object[header] = values[index]; });
  return object;
}

function findRow_(name, key, value) {
  const sh = sheet_(name);
  if (sh.getLastRow() < 2 || sh.getLastColumn() < 1) return 0;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const column = headers.indexOf(key) + 1;
  if (!column) return 0;
  const values = sh.getRange(2, column, sh.getLastRow() - 1, 1).getValues().flat();
  const index = values.findIndex(function(entry) { return String(entry) === String(value); });
  return index < 0 ? 0 : index + 2;
}

function appendObject_(name, object) {
  const sh = sheet_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(headers.map(function(header) { return object[header] == null ? "" : object[header]; }));
}

function upsert_(name, key, object) {
  const sh = sheet_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = findRow_(name, key, object[key]);
  const values = headers.map(function(header) { return object[header] == null ? "" : object[header]; });
  if (row) sh.getRange(row, 1, 1, headers.length).setValues([values]);
  else sh.appendRow(values);
}

function deleteWhere_(name, key, value) {
  const sh = sheet_(name);
  if (sh.getLastRow() < 2) return;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const column = headers.indexOf(key) + 1;
  if (!column) return;
  const values = sh.getRange(2, column, sh.getLastRow() - 1, 1).getValues().flat();
  for (let index = values.length - 1; index >= 0; index--) {
    if (String(values[index]) === String(value)) sh.deleteRow(index + 2);
  }
}

function replaceByProduct_(name, productId, rows) {
  deleteWhere_(name, "ID_PRODUTO", productId);
  rows.forEach(function(row) { appendObject_(name, Object.assign({}, row, { ID_PRODUTO: productId, CRIADO_EM: new Date() })); });
}

