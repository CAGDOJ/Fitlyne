const SHEETS = {
  CONFIG: ["CHAVE", "VALOR"],
  PRODUTOS: ["ID", "SKU", "NICHO", "CATEGORIA", "MARCA", "NOME", "DESCRICAO", "COR_TOM", "GRUPO_CATALOGO", "TIPO_TAMANHO", "TAMANHO_EXIBICAO", "PRECO_COMPRA", "PRECO_VENDA", "ESTOQUE_ATUAL", "ESTOQUE_MINIMO", "STATUS_CATALOGO", "ATIVO", "CRIADO_EM", "ATUALIZADO_EM"],
  FOTOS: ["ID", "ID_PRODUTO", "ORDEM", "PRINCIPAL", "PUBLIC_ID", "URL_ORIGINAL", "URL_CATALOGO", "URL_FEED", "URL_STORY", "URL_WHATSAPP", "URL_FACEBOOK", "URL_SHOPEE", "URL_MERCADO_LIVRE", "CRIADO_EM"],
  VARIACOES: ["ID", "ID_PRODUTO", "TAMANHO", "ESTOQUE", "CRIADO_EM", "ATUALIZADO_EM"],
  MOVIMENTACOES: ["ID", "DATA", "ID_PRODUTO", "PRODUTO", "ID_VARIACAO", "VARIACAO", "TIPO", "QUANTIDADE", "MOTIVO"],
  VENDAS: ["ID", "DATA", "ID_PRODUTO", "PRODUTO", "ID_VARIACAO", "VARIACAO", "QUANTIDADE", "VALOR_UNITARIO", "DESCONTO", "TOTAL", "CLIENTE", "TELEFONE", "PAGAMENTO", "STATUS", "ATUALIZADO_EM"],
  CLIENTES: ["ID", "NOME", "TELEFONE", "COMPRAS", "TOTAL_GASTO", "ULTIMA_COMPRA"],
  DESPESAS: ["ID", "DATA", "DESCRICAO", "CATEGORIA", "VALOR"],
  SOLICITACOES: ["ID", "DATA", "TIPO", "ID_PRODUTO", "PRODUTO", "NOME", "TELEFONE", "DETALHES", "CONSENTIMENTO_WHATSAPP", "STATUS", "NOTIFICADO_EM", "META_MESSAGE_ID", "ULTIMO_ERRO", "ATUALIZADO_EM"],
  METRICAS: ["ID_PRODUTO", "CLIQUES", "PEDIDOS", "ATUALIZADO_EM"]
};

const PUBLIC_CACHE_KEY = "FITLYNE_PUBLIC_CATALOG_PRO_V6";
const CONFIG_CACHE_KEY = "FITLYNE_CONFIG_CLIQUE_PRONTO";
const VALID_CATALOG_STATUS = ["AUTOMATICO", "DISPONIVEL", "ESGOTADO", "REPOSICAO"];
const API_VERSION = "2026-08-07-loja-pro-v6-arquivo-estoque";
let AUTH_SECRET_MEMORY = "";

function setupSystem() {
  ensureSystem_();
  setDefaultConfig_("ADMIN_PIN", "1234");
  setDefaultConfig_("WHATSAPP", "5591999999999");
  setDefaultConfig_("NOME_LOJA", "FITLYNE");
  setDefaultConfig_("SUBTITULO", "Moda Fitness & Makeup");
  setDefaultConfig_("TOKEN_TTL_HORAS", "6");
  setDefaultConfig_("CATALOG_URL", "https://fitlyne.shop/catalog.html");
  setDefaultConfig_("FRETE_ATIVO", "SIM");
  setDefaultConfig_("FRETE_BELEM", "10");
  setDefaultConfig_("FRETE_ANANINDEUA", "15");
  setDefaultConfig_("FRETE_MARITUBA", "15");
  setDefaultConfig_("FRETE_FIXO", "0"); // legado, não usado pelo catálogo novo
  setDefaultConfig_("FRETE_GRATIS_ACIMA", "0");
  setDefaultConfig_("PRAZO_ENTREGA_DIAS", "3");
  setDefaultConfig_("INSTAGRAM", "");
  authSecret_();
  clearPublicCache_();
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  migrateLegacyProducts_();
  migrateConfig_();
  rebuildClients_();
  return "Sistema FITLYNE Loja Pro V6 atualizado: arquivar/restaurar produtos, estoque filtrável, vendas compatíveis e catálogo preservado.";
}

function migrateConfig_() {
  const cfg = config_();
  const subtitle = String(cfg.SUBTITULO || "").trim();
  if (!subtitle || subtitle === "Moda Fitness, Makeup & Skincare" || subtitle === "Moda Fitness & Makeup") setConfig_("SUBTITULO", "Moda Fitness & Makeup");
  if (!cfg.CATALOG_URL || String(cfg.CATALOG_URL).indexOf("cagdoj.github.io/Fitlyne") >= 0) setConfig_("CATALOG_URL", "https://fitlyne.shop/catalog.html");
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

function doGet(e) {
  return json_({
    ok: true,
    data: {
      name: "FITLYNE API",
      version: API_VERSION,
      capabilities: ["cancelSale", "deleteSale", "updateSale", "salesByVariant", "archiveProduct", "restoreProduct"],
      time: new Date().toISOString()
    }
  });
}

function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const rawAction = String(request.action || "").trim();
    const actionAliases = {
      cancelsale: "cancelSale",
      deletesale: "cancelSale",
      excluirvenda: "cancelSale",
      cancelavenda: "cancelSale",
      cancelvenda: "cancelSale",
      updatesale: "updateSale",
      editsale: "updateSale",
      editarvenda: "updateSale"
    };
    const action = actionAliases[rawAction.toLowerCase()] || rawAction;
    const payload = request.payload || {};

    // Ações públicas: nunca dependem de login ou da configuração da API do WhatsApp.
    if (action === "ping") return json_({ ok: true, data: { version: API_VERSION, capabilities: ["cancelSale", "deleteSale", "updateSale", "salesByVariant", "archiveProduct", "restoreProduct"], time: new Date().toISOString() } });
    if (action === "login") return json_({ ok: true, data: login_(payload.pin) });
    if (action === "publicCatalog") return json_({ ok: true, data: publicCatalog_() });
    if (action === "trackClick") return json_({ ok: true, data: trackMetric_(payload.productId, "CLIQUES", 1) });
    if (action === "trackOrderIntent") return json_({ ok: true, data: trackOrderIntent_(payload.items || []) });
    if (action === "requestProduct" || action === "publicRequestProduct" || action === "createRestockRequest") {
      return json_({ ok: true, data: requestProduct_(payload) });
    }

    if (!validateToken_(request.token)) throw new Error("Sessão inválida. Entre novamente.");

    const handlers = {
      bootstrap: bootstrap_,
      uploadImage: uploadImage_,
      saveProduct: saveProduct_,
      deleteProduct: deleteProduct_,
      archiveProduct: archiveProduct_,
      restoreProduct: restoreProduct_,
      setProductStatus: setProductStatus_,
      stockMovement: stockMovement_,
      saveSale: saveSale_,
      updateSale: updateSale_,
      cancelSale: cancelSale_,
      deleteSale: cancelSale_,
      saveExpense: saveExpense_,
      saveSettings: saveSettings_,
      updateRequestStatus: updateRequestStatus_,
      notifyRequest: notifyRequest_,
      notifyAllReady: notifyAllReady_,
      saveWhatsappApiSettings: saveWhatsappApiSettings_,
      testWhatsappApi: testWhatsappApi_
    };
    if (!handlers[action]) throw new Error("Ação inválida: " + action);
    const lockedActions = ["saveProduct", "deleteProduct", "archiveProduct", "restoreProduct", "setProductStatus", "stockMovement", "saveSale", "updateSale", "cancelSale", "deleteSale", "saveExpense", "saveSettings", "updateRequestStatus", "saveWhatsappApiSettings"];
    if (lockedActions.indexOf(action) >= 0) {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(15000)) throw new Error("O sistema está concluindo outra alteração. Tente novamente em alguns segundos.");
      try { return json_({ ok: true, data: handlers[action](payload) }); }
      finally { lock.releaseLock(); }
    }
    return json_({ ok: true, data: handlers[action](payload) });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function json_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}

function config_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONFIG_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (error) {}
  }
  const result = {};
  readSheet_("CONFIG").forEach(function(row) { result[row.CHAVE] = row.VALOR; });
  try { cache.put(CONFIG_CACHE_KEY, JSON.stringify(result), 300); } catch (error) {}
  return result;
}

function setDefaultConfig_(key, value) {
  if (!findRow_("CONFIG", "CHAVE", key)) {
    appendObject_("CONFIG", { CHAVE: key, VALOR: value });
    CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  }
}

function setConfig_(key, value) {
  upsert_("CONFIG", "CHAVE", { CHAVE: key, VALOR: value });
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
}

function authSecret_() {
  if (AUTH_SECRET_MEMORY) return AUTH_SECRET_MEMORY;
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty("FITLYNE_AUTH_SECRET");
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    properties.setProperty("FITLYNE_AUTH_SECRET", secret);
  }
  AUTH_SECRET_MEMORY = secret;
  return secret;
}

function base64UrlText_(text) {
  return Utilities.base64EncodeWebSafe(String(text), Utilities.Charset.UTF_8).replace(/=+$/g, "");
}

function signTokenPart_(encodedPayload) {
  const bytes = Utilities.computeHmacSha256Signature(String(encodedPayload), authSecret_(), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "");
}

function createToken_(hours) {
  const ttlHours = Math.max(1, Math.min(Number(hours || 6), 24));
  const payload = {
    exp: Date.now() + ttlHours * 3600000,
    nonce: Utilities.getUuid()
  };
  const encoded = base64UrlText_(JSON.stringify(payload));
  return encoded + "." + signTokenPart_(encoded);
}

function login_(pin) {
  const config = config_();
  if (String(pin) !== String(config.ADMIN_PIN)) throw new Error("PIN incorreto");
  return {
    token: createToken_(config.TOKEN_TTL_HORAS || 6),
    config: {
      NOME_LOJA: config.NOME_LOJA || "FITLYNE",
      SUBTITULO: config.SUBTITULO || "Moda Fitness & Makeup"
    },
    version: API_VERSION
  };
}

function validateToken_(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) return false;
    if (signTokenPart_(parts[0]) !== parts[1]) return false;
    const bytes = Utilities.base64DecodeWebSafe(parts[0]);
    const payload = JSON.parse(Utilities.newBlob(bytes).getDataAsString("UTF-8"));
    return Number(payload.exp || 0) > Date.now();
  } catch (error) {
    return false;
  }
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
    metrics: readSheet_("METRICAS"),
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

function normalizeText_(value) {
  return String(value == null ? "" : value).trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}


function productVariants_(productId) {
  return readSheet_("VARIACOES").filter(function(variant) { return sameId_(variant.ID_PRODUTO, productId); });
}

function variantLabel_(variant) {
  const value = String((variant && (variant.MODELO || variant.VALOR || variant.TAMANHO)) || "").trim();
  if (!value || ["NA", "N/A", "PADRAO", "PADRÃO"].indexOf(normalizeText_(value)) >= 0) return "Padrão";
  return value;
}

function resolveVariant_(productId, requestedId) {
  const variants = productVariants_(productId);
  if (!variants.length) return { variant: null, variants: variants };
  let variant = null;
  if (requestedId) variant = variants.find(function(entry) { return sameId_(entry.ID, requestedId); }) || null;
  if (!variant && variants.length === 1) variant = variants[0];
  if (!variant && variants.length > 1) throw new Error("Selecione o modelo / variação vendido.");
  return { variant: variant, variants: variants };
}

function clientIdentityKey_(name, phone) {
  const normalizedName = normalizeText_(name);
  if (normalizedName) return "NOME:" + normalizedName;
  const normalizedPhone = normalizePhone_(phone);
  return normalizedPhone ? "TEL:" + normalizedPhone : "";
}

function normalizeNiche_(value) {
  const text = normalizeText_(value);
  if (text.indexOf("FIT") >= 0) return "FITNESS";
  if (text.indexOf("SKIN") >= 0 || text.indexOf("PELE") >= 0) return "SKINCARE";
  if (text.indexOf("MAKE") >= 0 || text.indexOf("MAQUI") >= 0) return "MAKEUP";
  return text || "MAKEUP";
}

function duplicateKey_(product) {
  return [normalizeNiche_(product.NICHO), normalizeText_(product.NOME), normalizeText_(product.MARCA), normalizeText_(product.COR_TOM), normalizeText_(product.TAMANHO_EXIBICAO)].join("|");
}

function nextSku_() {
  let max = 0;
  readSheet_("PRODUTOS").forEach(function(product) {
    const match = String(product.SKU || "").trim().match(/^FIT-(\d{6})$/);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  });
  return "FIT-" + String(max + 1).padStart(6, "0");
}

function isProductArchived_(product) {
  return String(product && product.ATIVO != null ? product.ATIVO : "").trim().toUpperCase() === "ARQUIVADO";
}

function isProductActive_(product) {
  const value = String(product && product.ATIVO != null ? product.ATIVO : "").trim().toUpperCase();
  // Compatibilidade com produtos antigos: vazio significa publicado. Arquivado nunca é público.
  return ["NAO", "NÃO", "FALSE", "0", "INATIVO", "OCULTO", "ARQUIVADO"].indexOf(value) < 0;
}

function migrateLegacyProducts_() {
  let skuCounter = 0;
  const rows = readSheet_("PRODUTOS");
  rows.forEach(function(product) {
    const match = String(product.SKU || "").trim().match(/^FIT-(\d{6})$/);
    if (match) skuCounter = Math.max(skuCounter, Number(match[1]) || 0);
  });
  rows.forEach(function(product) {
    let changed = false;
    const niche = normalizeNiche_(product.NICHO);
    if (String(product.NICHO || "") !== niche) { product.NICHO = niche; changed = true; }
    if (!String(product.ATIVO == null ? "" : product.ATIVO).trim()) { product.ATIVO = "SIM"; changed = true; }
    if (!String(product.STATUS_CATALOGO == null ? "" : product.STATUS_CATALOGO).trim()) { product.STATUS_CATALOGO = "AUTOMATICO"; changed = true; }
    if (!/^FIT-\d{6}$/.test(String(product.SKU || "").trim())) { skuCounter += 1; product.SKU = "FIT-" + String(skuCounter).padStart(6, "0"); changed = true; }
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
    NICHO: normalizeNiche_(product.NICHO),
    CATEGORIA: product.CATEGORIA,
    MARCA: product.MARCA,
    NOME: product.NOME,
    DESCRICAO: product.DESCRICAO,
    COR_TOM: product.COR_TOM,
    GRUPO_CATALOGO: product.GRUPO_CATALOGO || "",
    TIPO_TAMANHO: product.TIPO_TAMANHO,
    TAMANHO_EXIBICAO: product.TAMANHO_EXIBICAO,
    PRECO_VENDA: product.PRECO_VENDA,
    STATUS_CATALOGO: status,
    DISPONIVEL: status === "DISPONIVEL",
    ATIVO: isProductActive_(product) ? "SIM" : "NAO"
  };
}

function publicCatalog_() {
  if (!SpreadsheetApp.getActive().getSheetByName("METRICAS")) ensureSystem_();
  const cache = CacheService.getScriptCache();
  const cached = cache.get(PUBLIC_CACHE_KEY);
  if (cached) { try { return JSON.parse(cached); } catch (error) {} }
  const allConfig = config_();
  const metrics = {};
  readSheet_("METRICAS").forEach(function(row) { metrics[String(row.ID_PRODUTO || "").trim()] = row; });
  const publicProducts = readSheet_("PRODUTOS").filter(isProductActive_).map(function(product) {
    const output = publicProduct_(product);
    const metric = metrics[String(product.ID || "").trim()] || {};
    output.CLIQUES = number_(metric.CLIQUES);
    output.PEDIDOS = number_(metric.PEDIDOS);
    return output;
  });
  const publicIds = {};
  publicProducts.forEach(function(product) { publicIds[String(product.ID || "").trim()] = true; });
  const data = {
    products: publicProducts,
    photos: readSheet_("FOTOS").filter(function(photo) { return publicIds[String(photo.ID_PRODUTO || "").trim()]; }),
    config: {
      WHATSAPP: allConfig.WHATSAPP || "",
      NOME_LOJA: allConfig.NOME_LOJA || "FITLYNE",
      SUBTITULO: allConfig.SUBTITULO || "Moda Fitness & Makeup",
      CATALOG_URL: allConfig.CATALOG_URL || "https://fitlyne.shop/catalog.html",
      FRETE_ATIVO: String(allConfig.FRETE_ATIVO || "NAO"),
      FRETE_BELEM: number_(allConfig.FRETE_BELEM),
      FRETE_ANANINDEUA: number_(allConfig.FRETE_ANANINDEUA),
      FRETE_MARITUBA: number_(allConfig.FRETE_MARITUBA),
      FRETE_GRATIS_ACIMA: number_(allConfig.FRETE_GRATIS_ACIMA),
      PRAZO_ENTREGA_DIAS: Math.max(0, number_(allConfig.PRAZO_ENTREGA_DIAS || 3)),
      INSTAGRAM: allConfig.INSTAGRAM || ""
    }
  };
  try { cache.put(PUBLIC_CACHE_KEY, JSON.stringify(data), 60); } catch (error) {}
  return data;
}

function trackMetric_(productId, field, amount) {
  if (!SpreadsheetApp.getActive().getSheetByName("METRICAS")) ensureSystem_();
  const id = String(productId || "").trim();
  if (!id || ["CLIQUES", "PEDIDOS"].indexOf(field) < 0) return false;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return false;
  try {
    const row = findRow_("METRICAS", "ID_PRODUTO", id);
    const current = row ? rowObject_("METRICAS", row) : { ID_PRODUTO: id, CLIQUES: 0, PEDIDOS: 0 };
    current[field] = number_(current[field]) + Math.max(1, number_(amount || 1));
    current.ATUALIZADO_EM = new Date();
    upsert_("METRICAS", "ID_PRODUTO", current);
    clearPublicCache_();
    return true;
  } finally { lock.releaseLock(); }
}

function trackOrderIntent_(items) {
  (Array.isArray(items) ? items : []).forEach(function(item) {
    trackMetric_(item.productId, "PEDIDOS", Math.max(1, number_(item.quantity || 1)));
  });
  return true;
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
    const photoLock = LockService.getScriptLock();
    photoLock.waitLock(30000);
    try {
      if (principal === "SIM") {
        readSheet_("FOTOS").filter(function(existing) {
          return sameId_(existing.ID_PRODUTO, productId) && String(existing.PRINCIPAL || "").toUpperCase() === "SIM";
        }).forEach(function(existing) {
          existing.PRINCIPAL = "NAO";
          upsert_("FOTOS", "ID", existing);
        });
      }
      upsert_("FOTOS", "ID", photo);
      clearPublicCache_();
    } finally {
      photoLock.releaseLock();
    }
  }
  return { cloud_name: CLOUD_NAME, secure_url: data.secure_url, public_id: data.public_id, format: format, version: data.version || "", photo: photo };
}

function saveProduct_(payload) {
  const product = payload.product || {};
  if (!product.ID || !product.NOME) throw new Error("Dados do produto incompletos.");
  product.NICHO = normalizeNiche_(product.NICHO);
  let status = String(product.STATUS_CATALOGO || "AUTOMATICO").toUpperCase();
  if (VALID_CATALOG_STATUS.indexOf(status) < 0) status = "AUTOMATICO";
  product.STATUS_CATALOGO = status;
  product.ATIVO = isProductActive_(product) ? "SIM" : "NAO";
  const now = new Date();
  const row = findRow_("PRODUTOS", "ID", product.ID);
  const current = row ? rowObject_("PRODUTOS", row) : null;
  if (!current) {
    // Nomes iguais são permitidos. Cada cadastro recebe um SKU sequencial próprio,
    // evitando que dois gloss/cores/modelos diferentes sejam tratados como o mesmo item.
    product.SKU = nextSku_();
  } else {
    product.SKU = current.SKU || product.SKU || nextSku_();
  }
  const object = Object.assign({}, product, {
    CRIADO_EM: current ? current.CRIADO_EM : now,
    ATUALIZADO_EM: now
  });
  upsert_("PRODUTOS", "ID", object);

  const normalizedVariants = (payload.variants || []).map(function(variant) {
    return Object.assign({}, variant, {
      ID: String(variant.ID || ("VAR_" + Utilities.getUuid())),
      ID_PRODUTO: String(product.ID),
      CRIADO_EM: variant.CRIADO_EM || now
    });
  });
  replaceByProduct_("VARIACOES", product.ID, normalizedVariants);

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

  let movement = null;
  if (!current && number_(product.ESTOQUE_ATUAL) > 0) {
    movement = { ID: Utilities.getUuid(), DATA: now, ID_PRODUTO: product.ID, PRODUTO: product.NOME, TIPO: "ENTRADA", QUANTIDADE: product.ESTOQUE_ATUAL, MOTIVO: "ESTOQUE INICIAL" };
    appendObject_("MOVIMENTACOES", movement);
  }

  const oldStock = current ? number_(current.ESTOQUE_ATUAL) : 0;
  const newStock = number_(product.ESTOQUE_ATUAL);
  let notifications = { ready: 0, sent: 0, failed: 0 };
  if (oldStock <= 0 && newStock > 0) notifications = markReadyAndMaybeNotify_(object);
  clearPublicCache_();

  return {
    id: product.ID,
    product: object,
    variants: normalizedVariants,
    photos: readSheet_("FOTOS").filter(function(photo) { return sameId_(photo.ID_PRODUTO, product.ID); }),
    movement: movement,
    notifications: notifications
  };
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

function archiveProduct_(payload) {
  const row = findRow_("PRODUTOS", "ID", payload.id);
  if (!row) throw new Error("Produto não encontrado.");
  const product = rowObject_("PRODUTOS", row);
  product.ATIVO = "ARQUIVADO";
  product.ATUALIZADO_EM = new Date();
  upsert_("PRODUTOS", "ID", product);
  clearPublicCache_();
  return { product: product };
}

function restoreProduct_(payload) {
  const row = findRow_("PRODUTOS", "ID", payload.id);
  if (!row) throw new Error("Produto não encontrado.");
  const product = rowObject_("PRODUTOS", row);
  product.ATIVO = "SIM";
  product.ATUALIZADO_EM = new Date();
  upsert_("PRODUTOS", "ID", product);
  clearPublicCache_();
  return { product: product };
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
  if (quantity < 0) throw new Error("Informe uma quantidade válida.");

  const resolved = resolveVariant_(product.ID, payload.variantId || "");
  const variant = resolved.variant;
  const oldStock = number_(product.ESTOQUE_ATUAL);
  const type = String(payload.type || "").toUpperCase();
  let next = oldStock;
  let variantNext = variant ? number_(variant.ESTOQUE) : null;

  if (variant) {
    const oldVariant = number_(variant.ESTOQUE);
    if (type === "ENTRADA" || type === "DEVOLUCAO") {
      variantNext = oldVariant + quantity;
      next = oldStock + quantity;
    } else if (type === "SAIDA" || type === "PERDA") {
      variantNext = oldVariant - quantity;
      next = oldStock - quantity;
    } else if (type === "AJUSTE") {
      const difference = quantity - oldVariant;
      variantNext = quantity;
      next = oldStock + difference;
    } else throw new Error("Tipo de movimentação inválido.");
    if (variantNext < 0 || next < 0) throw new Error("Estoque insuficiente");
  } else {
    if (type === "ENTRADA" || type === "DEVOLUCAO") next = oldStock + quantity;
    else if (type === "SAIDA" || type === "PERDA") next = oldStock - quantity;
    else if (type === "AJUSTE") next = quantity;
    else throw new Error("Tipo de movimentação inválido.");
    if (next < 0) throw new Error("Estoque insuficiente");
  }

  const now = new Date();
  product.ESTOQUE_ATUAL = next;
  product.ATUALIZADO_EM = now;
  upsert_("PRODUTOS", "ID", product);
  if (variant) {
    variant.ESTOQUE = variantNext;
    variant.ATUALIZADO_EM = now;
    upsert_("VARIACOES", "ID", variant);
  }
  const movement = {
    ID: Utilities.getUuid(), DATA: now, ID_PRODUTO: product.ID, PRODUTO: product.NOME,
    ID_VARIACAO: variant ? variant.ID : "", VARIACAO: variant ? variantLabel_(variant) : "",
    TIPO: type, QUANTIDADE: quantity, MOTIVO: payload.reason || ""
  };
  appendObject_("MOVIMENTACOES", movement);

  let notifications = { ready: 0, sent: 0, failed: 0 };
  if (oldStock <= 0 && next > 0) notifications = markReadyAndMaybeNotify_(product);
  clearPublicCache_();
  return { stock: next, product: product, variant: variant, movement: movement, notifications: notifications };
}

function saveSale_(payload) {
  const row = findRow_("PRODUTOS", "ID", payload.productId);
  if (!row) throw new Error("Produto não encontrado");
  const product = rowObject_("PRODUTOS", row);
  const quantity = number_(payload.qty || 1);
  if (quantity <= 0) throw new Error("Informe uma quantidade válida.");
  if (number_(product.ESTOQUE_ATUAL) < quantity) throw new Error("Estoque insuficiente");

  const resolved = resolveVariant_(product.ID, payload.variantId || "");
  const variant = resolved.variant;
  if (variant && number_(variant.ESTOQUE) < quantity) throw new Error("Estoque insuficiente para " + variantLabel_(variant) + ".");

  const unit = number_(product.PRECO_VENDA);
  const discount = number_(payload.discount);
  const total = Math.max(0, unit * quantity - discount);
  const now = new Date();
  const sale = {
    ID: Utilities.getUuid(), DATA: now, ID_PRODUTO: product.ID, PRODUTO: product.NOME,
    ID_VARIACAO: variant ? variant.ID : "", VARIACAO: variant ? variantLabel_(variant) : "",
    QUANTIDADE: quantity, VALOR_UNITARIO: unit, DESCONTO: discount, TOTAL: total,
    CLIENTE: String(payload.client || "").trim(), TELEFONE: String(payload.phone || "").trim(),
    PAGAMENTO: payload.payment || "PIX", STATUS: "ATIVA", ATUALIZADO_EM: now
  };
  appendObject_("VENDAS", sale);

  product.ESTOQUE_ATUAL = number_(product.ESTOQUE_ATUAL) - quantity;
  product.ATUALIZADO_EM = now;
  upsert_("PRODUTOS", "ID", product);
  if (variant) {
    variant.ESTOQUE = number_(variant.ESTOQUE) - quantity;
    variant.ATUALIZADO_EM = now;
    upsert_("VARIACOES", "ID", variant);
  }

  const movement = {
    ID: Utilities.getUuid(), DATA: now, ID_PRODUTO: product.ID, PRODUTO: product.NOME,
    ID_VARIACAO: variant ? variant.ID : "", VARIACAO: variant ? variantLabel_(variant) : "",
    TIPO: "VENDA", QUANTIDADE: quantity, MOTIVO: "VENDA"
  };
  appendObject_("MOVIMENTACOES", movement);
  rebuildClients_();
  clearPublicCache_();
  return { total: total, sale: sale, product: product, variant: variant, movement: movement, clients: readSheet_("CLIENTES") };
}

function saleIsActive_(sale) {
  return ["CANCELADA", "CANCELADO", "EXCLUIDA", "EXCLUÍDA"].indexOf(normalizeText_(sale.STATUS)) < 0;
}

function updateSale_(payload) {
  const saleRow = findRow_("VENDAS", "ID", payload.id);
  if (!saleRow) throw new Error("Venda não encontrada.");
  const sale = rowObject_("VENDAS", saleRow);
  if (!saleIsActive_(sale)) throw new Error("Venda cancelada não pode ser editada.");

  const oldProductRow = findRow_("PRODUTOS", "ID", sale.ID_PRODUTO);
  const newProductRow = findRow_("PRODUTOS", "ID", payload.productId);
  if (!oldProductRow || !newProductRow) throw new Error("Produto da venda não encontrado.");

  const oldProduct = rowObject_("PRODUTOS", oldProductRow);
  const newProduct = sameId_(sale.ID_PRODUTO, payload.productId) ? oldProduct : rowObject_("PRODUTOS", newProductRow);
  const oldQty = number_(sale.QUANTIDADE);
  const newQty = number_(payload.qty || 1);
  if (newQty <= 0) throw new Error("Quantidade inválida.");
  const now = new Date();

  // Primeiro estorna a venda anterior em memória.
  oldProduct.ESTOQUE_ATUAL = number_(oldProduct.ESTOQUE_ATUAL) + oldQty;
  let oldVariant = null;
  if (sale.ID_VARIACAO) {
    const oldVariantRow = findRow_("VARIACOES", "ID", sale.ID_VARIACAO);
    if (oldVariantRow) {
      oldVariant = rowObject_("VARIACOES", oldVariantRow);
      oldVariant.ESTOQUE = number_(oldVariant.ESTOQUE) + oldQty;
    }
  }

  const targetProduct = sameId_(oldProduct.ID, newProduct.ID) ? oldProduct : newProduct;
  if (number_(targetProduct.ESTOQUE_ATUAL) < newQty) throw new Error("Estoque insuficiente para editar a venda.");

  const resolved = resolveVariant_(targetProduct.ID, payload.variantId || "");
  let newVariant = resolved.variant;
  if (newVariant) {
    // Se a nova variação é a mesma da anterior, considere o estorno feito acima.
    if (oldVariant && sameId_(oldVariant.ID, newVariant.ID)) newVariant = oldVariant;
    if (number_(newVariant.ESTOQUE) < newQty) throw new Error("Estoque insuficiente para " + variantLabel_(newVariant) + ".");
  }

  targetProduct.ESTOQUE_ATUAL = number_(targetProduct.ESTOQUE_ATUAL) - newQty;
  targetProduct.ATUALIZADO_EM = now;
  if (!sameId_(oldProduct.ID, targetProduct.ID)) oldProduct.ATUALIZADO_EM = now;

  // Grava produtos apenas depois de todas as validações.
  upsert_("PRODUTOS", "ID", oldProduct);
  if (!sameId_(oldProduct.ID, targetProduct.ID)) upsert_("PRODUTOS", "ID", targetProduct);

  if (oldVariant && (!newVariant || !sameId_(oldVariant.ID, newVariant.ID))) {
    oldVariant.ATUALIZADO_EM = now;
    upsert_("VARIACOES", "ID", oldVariant);
  }
  if (newVariant) {
    newVariant.ESTOQUE = number_(newVariant.ESTOQUE) - newQty;
    newVariant.ATUALIZADO_EM = now;
    upsert_("VARIACOES", "ID", newVariant);
  }

  const unit = number_(targetProduct.PRECO_VENDA);
  const discount = number_(payload.discount);
  sale.ID_PRODUTO = targetProduct.ID;
  sale.PRODUTO = targetProduct.NOME;
  sale.ID_VARIACAO = newVariant ? newVariant.ID : "";
  sale.VARIACAO = newVariant ? variantLabel_(newVariant) : "";
  sale.QUANTIDADE = newQty;
  sale.VALOR_UNITARIO = unit;
  sale.DESCONTO = discount;
  sale.TOTAL = Math.max(0, unit * newQty - discount);
  sale.CLIENTE = String(payload.client || "").trim();
  sale.TELEFONE = String(payload.phone || "").trim();
  sale.PAGAMENTO = payload.payment || "PIX";
  sale.STATUS = "ATIVA";
  sale.ATUALIZADO_EM = now;
  upsert_("VENDAS", "ID", sale);

  appendObject_("MOVIMENTACOES", {
    ID: Utilities.getUuid(), DATA: now, ID_PRODUTO: targetProduct.ID, PRODUTO: targetProduct.NOME,
    ID_VARIACAO: newVariant ? newVariant.ID : "", VARIACAO: newVariant ? variantLabel_(newVariant) : "",
    TIPO: "AJUSTE_VENDA", QUANTIDADE: newQty, MOTIVO: "VENDA EDITADA " + sale.ID
  });
  rebuildClients_();
  clearPublicCache_();
  return {
    sale: sale,
    products: sameId_(oldProduct.ID, targetProduct.ID) ? [oldProduct] : [oldProduct, targetProduct],
    variants: [oldVariant, newVariant].filter(function(item, index, arr) { return item && arr.findIndex(function(x) { return x && sameId_(x.ID, item.ID); }) === index; }),
    clients: readSheet_("CLIENTES")
  };
}

function cancelSale_(payload) {
  const row = findRow_("VENDAS", "ID", payload.id);
  if (!row) throw new Error("Venda não encontrada.");
  const sale = rowObject_("VENDAS", row);
  if (!saleIsActive_(sale)) return { sale: sale, clients: readSheet_("CLIENTES") };
  const now = new Date();
  const productRow = findRow_("PRODUTOS", "ID", sale.ID_PRODUTO);
  let product = null;
  let variant = null;
  if (productRow) {
    product = rowObject_("PRODUTOS", productRow);
    product.ESTOQUE_ATUAL = number_(product.ESTOQUE_ATUAL) + number_(sale.QUANTIDADE);
    product.ATUALIZADO_EM = now;
    upsert_("PRODUTOS", "ID", product);
  }
  if (sale.ID_VARIACAO) {
    const variantRow = findRow_("VARIACOES", "ID", sale.ID_VARIACAO);
    if (variantRow) {
      variant = rowObject_("VARIACOES", variantRow);
      variant.ESTOQUE = number_(variant.ESTOQUE) + number_(sale.QUANTIDADE);
      variant.ATUALIZADO_EM = now;
      upsert_("VARIACOES", "ID", variant);
    }
  }
  if (product) appendObject_("MOVIMENTACOES", {
    ID: Utilities.getUuid(), DATA: now, ID_PRODUTO: product.ID, PRODUTO: product.NOME,
    ID_VARIACAO: variant ? variant.ID : (sale.ID_VARIACAO || ""), VARIACAO: variant ? variantLabel_(variant) : (sale.VARIACAO || ""),
    TIPO: "ESTORNO_VENDA", QUANTIDADE: number_(sale.QUANTIDADE), MOTIVO: "VENDA CANCELADA " + sale.ID
  });
  sale.STATUS = "CANCELADA";
  sale.ATUALIZADO_EM = now;
  upsert_("VENDAS", "ID", sale);
  rebuildClients_();
  clearPublicCache_();
  return { sale: sale, product: product, variant: variant, clients: readSheet_("CLIENTES") };
}

function rebuildClients_() {
  const sh = sheet_("CLIENTES");
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  const map = {};
  readSheet_("VENDAS").filter(saleIsActive_).forEach(function(sale) {
    if (!sale.CLIENTE && !sale.TELEFONE) return;
    const key = clientIdentityKey_(sale.CLIENTE, sale.TELEFONE);
    if (!key) return;
    if (!map[key]) {
      map[key] = {
        ID: Utilities.getUuid(), NOME: String(sale.CLIENTE || "CLIENTE").trim(), TELEFONE: String(sale.TELEFONE || "").trim(),
        COMPRAS: 0, TOTAL_GASTO: 0, ULTIMA_COMPRA: sale.DATA
      };
    }
    map[key].COMPRAS += 1;
    map[key].TOTAL_GASTO += number_(sale.TOTAL);
    const saleTime = new Date(sale.DATA).getTime();
    const currentTime = new Date(map[key].ULTIMA_COMPRA).getTime();
    if (saleTime >= currentTime) {
      map[key].ULTIMA_COMPRA = sale.DATA;
      if (sale.TELEFONE) map[key].TELEFONE = String(sale.TELEFONE).trim();
      if (sale.CLIENTE) map[key].NOME = String(sale.CLIENTE).trim();
    }
  });
  Object.keys(map).sort().forEach(function(key) { appendObject_("CLIENTES", map[key]); });
}

function upsertClient_(name, phone, total, date) {
  const normalizedName = normalizeText_(name);
  const normalizedPhone = normalizePhone_(phone);
  const found = readSheet_("CLIENTES").find(function(client) {
    if (normalizedName && normalizeText_(client.NOME) === normalizedName) return true;
    return !normalizedName && normalizedPhone && normalizePhone_(client.TELEFONE) === normalizedPhone;
  });
  if (found) {
    found.NOME = String(name || found.NOME || "CLIENTE").trim();
    if (phone) found.TELEFONE = String(phone).trim();
    found.COMPRAS = Number(found.COMPRAS || 0) + 1;
    found.TOTAL_GASTO = Number(found.TOTAL_GASTO || 0) + number_(total);
    found.ULTIMA_COMPRA = date;
    upsert_("CLIENTES", "ID", found);
  } else {
    appendObject_("CLIENTES", { ID: Utilities.getUuid(), NOME: String(name || "CLIENTE").trim(), TELEFONE: String(phone || "").trim(), COMPRAS: 1, TOTAL_GASTO: total, ULTIMA_COMPRA: date });
  }
}

function saveExpense_(payload) {
  const expense = {
    ID: Utilities.getUuid(),
    DATA: new Date(),
    DESCRICAO: String(payload.description || "").trim(),
    CATEGORIA: payload.category || "",
    VALOR: number_(payload.value)
  };
  if (!expense.DESCRICAO) throw new Error("Informe a descrição da despesa.");
  appendObject_("DESPESAS", expense);
  return { expense: expense };
}

function saveSettings_(payload) {
  const phone = String(payload.WHATSAPP || "").replace(/\D/g, "");
  if (phone.length < 12 || phone.length > 15) throw new Error("WhatsApp inválido. Use DDI + DDD + número.");
  setConfig_("WHATSAPP", phone);
  setConfig_("NOME_LOJA", String(payload.NOME_LOJA || "FITLYNE").trim());
  setConfig_("SUBTITULO", String(payload.SUBTITULO || "Moda Fitness & Makeup").trim());
  if (payload.CATALOG_URL) setConfig_("CATALOG_URL", String(payload.CATALOG_URL).trim());
  setConfig_("FRETE_ATIVO", String(payload.FRETE_ATIVO || "NAO").toUpperCase() === "SIM" ? "SIM" : "NAO");
  setConfig_("FRETE_BELEM", String(Math.max(0, number_(payload.FRETE_BELEM))));
  setConfig_("FRETE_ANANINDEUA", String(Math.max(0, number_(payload.FRETE_ANANINDEUA))));
  setConfig_("FRETE_MARITUBA", String(Math.max(0, number_(payload.FRETE_MARITUBA))));
  setConfig_("FRETE_GRATIS_ACIMA", String(Math.max(0, number_(payload.FRETE_GRATIS_ACIMA))));
  setConfig_("PRAZO_ENTREGA_DIAS", String(Math.max(0, number_(payload.PRAZO_ENTREGA_DIAS || 3))));
  setConfig_("INSTAGRAM", String(payload.INSTAGRAM || "").trim());
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
    if (row) {
      const product = rowObject_("PRODUTOS", row);
      productName = [product.NOME, product.COR_TOM, product.TAMANHO_EXIBICAO].filter(function(value) { return String(value || "").trim(); }).join(" — ").trim() || productName;
    }
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
  return { id: object.ID, status: object.STATUS, duplicated: Boolean(existing), request: object, whatsappConfigured: whatsappApiStatus_().configured };
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
  return { status: status, request: request };
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
  return { message: "Aviso enviado para " + request.NOME + ".", messageId: result.id || "", request: request };
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

