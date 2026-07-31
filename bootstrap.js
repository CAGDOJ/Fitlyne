"use strict";

(function bootstrapFitlyne() {
  const loader = document.currentScript;
  const entry = loader?.dataset?.entry;

  function fail(message, error) {
    console.error(message, error || "");
    const target = document.getElementById("toast");
    if (target) {
      target.textContent = message;
      target.classList.add("show");
      target.style.display = "block";
    }
  }

  if (!entry) {
    fail("Arquivo de inicialização da Fitlyne não informado.");
    return;
  }

  const configScript = document.createElement("script");
  configScript.src = `./fitlyne-config.js?nocache=${Date.now()}`;
  configScript.async = false;

  configScript.onload = () => {
    if (!window.FITLYNE_CONFIG?.API_URL) {
      fail("A API da Fitlyne não foi configurada em fitlyne-config.js.");
      return;
    }

    const entryScript = document.createElement("script");
    entryScript.src = entry;
    entryScript.async = false;
    entryScript.onerror = (error) => fail(`Não foi possível carregar ${entry}.`, error);
    document.body.appendChild(entryScript);
  };

  configScript.onerror = (error) =>
    fail("Não foi possível carregar fitlyne-config.js.", error);

  document.head.appendChild(configScript);
})();
