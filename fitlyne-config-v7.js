"use strict";

// Configuração pública do site. Não coloque API Secret do Cloudinary aqui.
window.FITLYNE_CONFIG = Object.freeze({
  BUILD: "2026-07-30-2355-v7",
  API_URL: "https://script.google.com/macros/s/AKfycbzt2uOHVX45xliautKbyBgBAhgFu-ruNj9CjUa2zJbEPtaOfA7Uy55oc6g_-bKGuh-gRg/exec",
  CLOUDINARY_CLOUD_NAME: "v9gfcyqm",
  CLOUDINARY_UPLOAD_PRESET: "fitlyne_upload",
  CLOUDINARY_WATERMARK_PUBLIC_ID: "",
  STORE_NAME: "FITLYNE",
  STORE_SUBTITLE: "Moda Fitness & Makeup"
});

console.info("FITLYNE carregada:", window.FITLYNE_CONFIG.BUILD);
