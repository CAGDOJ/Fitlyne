"use strict";
const C = window.FITLYNE_CONFIG;
const API = C.API_URL;
const $ = (s) => document.querySelector(s);
function normalizePhone(v){let d=String(v||"").replace(/\D/g,"").replace(/^0+/,"");if(d.length===10||d.length===11)d="55"+d;return d}
function instagramUrl(value){const raw=String(value||"").trim();if(!raw)return"";if(/^https?:\/\//i.test(raw))return raw;return `https://instagram.com/${raw.replace(/^@/,"")}`}
async function load(){
  try{
    const r=await fetch(API,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"publicCatalog",payload:{}}),redirect:"follow",cache:"no-store"});
    const o=await r.json(); if(!o.ok)throw new Error(o.error||"Falha ao carregar"); const cfg=o.data?.config||{};
    $("#linksStoreName").textContent=cfg.NOME_LOJA||C.STORE_NAME; $("#linksSubtitle").textContent=cfg.SUBTITULO||C.STORE_SUBTITLE;
    const phone=normalizePhone(cfg.WHATSAPP); const wa=$("#linksWhatsapp"); wa.href=phone?`https://wa.me/${phone}?text=${encodeURIComponent("Olá! Vim pelo site da FITLYNE e gostaria de atendimento.")}`:"#";
    if(!phone)wa.onclick=(e)=>{e.preventDefault();alert("WhatsApp ainda não configurado.")};
    const ig=instagramUrl(cfg.INSTAGRAM); if(ig){$("#linksInstagram").href=ig;$("#linksInstagram").hidden=false}
  }catch(e){console.error(e)}
}
load();
