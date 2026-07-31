"use strict";

// Configuração pública do site. Não coloque API Secret do Cloudinary aqui.
window.FITLYNE_CONFIG = Object.freeze({
  BUILD: "2026-07-30-2305-v4",
  API_URL: "https://script.google.com/macros/s/AKfycbwXwsrLMquUFRef2rM865wKidEn7EXbiNS-kymsI9sCdb8ghhBgOPldGK7uXSN_YLA_JQ/exec",
  CLOUDINARY_CLOUD_NAME: "v9gfcyqm",
  CLOUDINARY_UPLOAD_PRESET: "fitlyne_upload",
  CLOUDINARY_WATERMARK_PUBLIC_ID: "",
  STORE_NAME: "FITLYNE",
  STORE_SUBTITLE: "Moda Fitness & Makeup"
});

console.info("FITLYNE carregada:", window.FITLYNE_CONFIG.BUILD);
