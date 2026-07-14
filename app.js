"use strict";
const C = Object.freeze({
  API_URL: "https://script.google.com/macros/s/AKfycbwm3lrLcChgQXWk0B3Hdx9ri1MXEWnYavX2V3L9_fgFOXpJ4eCOUjRYYTNbg9ydmKCcOQ/exec",
  CLOUDINARY_CLOUD_NAME: "v9gfcyqm",
  CLOUDINARY_UPLOAD_PRESET: "fitlyne_upload",
  CLOUDINARY_WATERMARK_PUBLIC_ID: "",
  STORE_NAME: "FITLYNE",
  STORE_SUBTITLE: "Moda Fitness & Makeup"
});

async function api(action, payload={}, auth=true){
  if(!C.API_URL || C.API_URL.includes("COLE_AQUI")) throw new Error("Configure API_URL em config.js");
  const body = {action,payload,token: auth ? state.token : ""};
  const res = await fetch(C.API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(body)});
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || "Erro na API");
  return data.data;
}
function showView(name){
  state.view=name;
  $$(".view").forEach(v=>v.classList.remove("active"));
  const el=$(`#${name}View`);
  if(el) el.classList.add("active");
  closeDrawer();
  if(name==="products") renderProducts();
  if(name==="dashboard") renderDashboard();
  window.scrollTo({top:0,behavior:"smooth"});
}
function openDrawer(){ $("#drawer").classList.add("open"); $("#backdrop").classList.add("open"); }
function closeDrawer(){ $("#drawer").classList.remove("open"); $("#backdrop").classList.remove("open"); }

async function login(){
  const pin=$("#pinInput").value.trim();
  if(!pin) return toast("Digite o PIN");
  try{
    const data=await api("login",{pin},false);
    state.token=data.token; sessionStorage.setItem("fitlyneToken",data.token);
    await loadAll(); showView("dashboard"); toast("Bem-vindo!");
  }catch(e){ toast(e.message); }
}
async function loadAll(){
  const data=await api("bootstrap");
  Object.assign(state,data);
  $("#brandName").textContent=state.config.NOME_LOJA || C.STORE_NAME || "FITLYNE";
  $("#brandSubtitle").textContent=state.config.SUBTITULO || C.STORE_SUBTITLE || "Moda Fitness & Makeup";
  populateProductSelects();
}
function logout(){ sessionStorage.removeItem("fitlyneToken"); state.token=""; showView("login"); }

function renderDashboard(){
  const active=state.products.filter(p=>String(p.ATIVO).toUpperCase()==="SIM");
  const stock=active.reduce((a,p)=>a+Number(p.ESTOQUE_ATUAL||0),0);
  const low=active.filter(p=>Number(p.ESTOQUE_ATUAL||0)<=Number(p.ESTOQUE_MINIMO||0));
  const revenue=state.sales.reduce((a,s)=>a+Number(s.TOTAL||0),0);
  $("#stats").innerHTML=[
    ["Produtos",active.length],["Estoque",stock],["Estoque baixo",low.length],["Faturamento",money(revenue)]
  ].map(([l,v])=>`<div class="stat"><strong>${v}</strong><span>${l}</span></div>`).join("");
  $("#lowStockList").innerHTML=low.length?low.slice(0,8).map(p=>`<div class="list-item"><div><b>${escapeHtml(p.NOME)}</b><small>${escapeHtml(p.TAMANHO_EXIBICAO||"")} · ${escapeHtml(p.COR_TOM||"")}</small></div><span class="badge">${p.ESTOQUE_ATUAL}</span></div>`).join(""):`<p class="muted">Nenhum produto com estoque baixo.</p>`;
}
function productPhoto(id){
  const list=state.photos.filter(f=>f.ID_PRODUTO===id);
  const main=list.find(f=>String(f.PRINCIPAL).toUpperCase()==="SIM")||list[0];
  return main?.URL_CATALOGO || "data:image/svg+xml;charset=utf-8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"><rect width="100%" height="100%" fill="#eee"/><text x="50%" y="50%" text-anchor="middle" font-family="Arial" font-size="30" fill="#999">SEM FOTO</text></svg>');
}
function renderProducts(){
  const q=$("#productSearch").value.toLowerCase(), niche=$("#productNicheFilter").value;
  const list=state.products.filter(p=>(!niche||p.NICHO===niche)&&(`${p.NOME} ${p.CATEGORIA} ${p.COR_TOM}`.toLowerCase().includes(q)));
  $("#productList").innerHTML=list.map(p=>`
    <article class="product-card">
      <img src="${productPhoto(p.ID)}" alt="${escapeHtml(p.NOME)}">
      <div class="product-card-body">
        <span class="badge">${escapeHtml(p.NICHO)}</span>
        <h3>${escapeHtml(p.NOME)}</h3>
        <p>${escapeHtml(p.TAMANHO_EXIBICAO||"")} ${p.COR_TOM?"· "+escapeHtml(p.COR_TOM):""}</p>
        <p class="price">${money(p.PRECO_VENDA)}</p>
        <p>Estoque: <b>${p.ESTOQUE_ATUAL}</b></p>
        <div class="card-actions">
          <button onclick="editProduct('${p.ID}')">Editar</button>
          <button class="danger" onclick="deleteProduct('${p.ID}')">Excluir</button>
        </div>
      </div>
    </article>`).join("") || `<p class="muted">Nenhum produto encontrado.</p>`;
}
function sizeDisplay(){
  const mode=$('input[name="sizeMode"]:checked').value;
  if(mode==="UNICO") return `Tamanho único — veste do ${$("#sizeFrom").value} ao ${$("#sizeTo").value}`;
  if(mode==="SEPARADOS") return [...document.querySelectorAll(".size-chip input[type=checkbox]:checked")].map(ch=>ch.dataset.size).join(", ");
  return "Não se aplica";
}
function getVariants(){
  const mode=$('input[name="sizeMode"]:checked').value;
  if(mode==="UNICO") return [{ID:uid("VAR"),TAMANHO:`${$("#sizeFrom").value}-${$("#sizeTo").value}`,ESTOQUE:Number($("#initialStock").value||0)}];
  if(mode==="SEPARADOS") return [...document.querySelectorAll(".size-chip input[type=checkbox]:checked")].map(ch=>{
    const qty=ch.closest(".size-chip").querySelector('input[type="number"]').value;
    return {ID:uid("VAR"),TAMANHO:ch.dataset.size,ESTOQUE:Number(qty||0)};
  });
  return [{ID:uid("VAR"),TAMANHO:"NA",ESTOQUE:Number($("#initialStock").value||0)}];
}
function addSizeChip(size, qty=0, checked=false){
  const el=document.createElement("label"); el.className="size-chip";
  el.innerHTML=`<input type="checkbox" data-size="${escapeHtml(size)}" ${checked?"checked":""}> <b>${escapeHtml(size)}</b> <input type="number" min="0" value="${qty}" aria-label="Estoque ${escapeHtml(size)}">`;
  $("#sizeChips").appendChild(el);
}
function resetProductForm(){
  $("#productForm").reset(); $("#productId").value=""; state.editingId=null; state.pendingFiles=[];
  $("#brand").value="FITLYNE"; $("#initialStock").value=1; $("#minStock").value=1; $("#sizeFrom").value=36; $("#sizeTo").value=40; $("#activeProduct").checked=true;
  $("#photoPreview").innerHTML=""; $("#sizeChips").innerHTML=""; ["P","M","G","GG"].forEach(s=>addSizeChip(s));
  $('input[name="sizeMode"][value="UNICO"]').checked=true; toggleSizeMode(); $("#productFormTitle").textContent="Novo produto";
}
function toggleSizeMode(){
  const m=$('input[name="sizeMode"]:checked').value;
  $("#uniqueSizeBox").classList.toggle("hidden",m!=="UNICO");
  $("#separateSizesBox").classList.toggle("hidden",m!=="SEPARADOS");
}
function previewFiles(files){
  state.pendingFiles=[...files];
  $("#photoPreview").innerHTML="";
  state.pendingFiles.forEach((file,i)=>{
    const url=URL.createObjectURL(file);
    const div=document.createElement("div"); div.className="photo-preview";
    div.innerHTML=`<img src="${url}"><button type="button" title="Remover">×</button>`;
    div.querySelector("button").onclick=()=>{state.pendingFiles.splice(i,1);previewFiles(state.pendingFiles)};
    $("#photoPreview").appendChild(div);
  });
}
async function uploadImage(file, productId, index){
  if(!C.CLOUDINARY_CLOUD_NAME||!C.CLOUDINARY_UPLOAD_PRESET) throw new Error("Configure o Cloudinary em config.js");
  const fd=new FormData(); fd.append("file",file); fd.append("upload_preset",C.CLOUDINARY_UPLOAD_PRESET); fd.append("folder",`fitlyne/produtos/${productId}`);
  const res=await fetch(`https://api.cloudinary.com/v1_1/${C.CLOUDINARY_CLOUD_NAME}/image/upload`,{method:"POST",body:fd});
  if(!res.ok) throw new Error("Falha ao enviar foto");
  const d=await res.json();
  const base=`https://res.cloudinary.com/${C.CLOUDINARY_CLOUD_NAME}/image/upload/`;
  const overlay=C.CLOUDINARY_WATERMARK_PUBLIC_ID?`l_${C.CLOUDINARY_WATERMARK_PUBLIC_ID.replaceAll("/","%3A")},o_35,g_south_east,w_0.28,fl_relative/`:"";
  const make=(w,h,crop="fill")=>`${base}f_auto,q_auto:good,c_${crop},w_${w},h_${h}/${overlay}${d.public_id}.${d.format}`;
  return {
    ID:uid("FOTO"),ID_PRODUTO:productId,ORDEM:index+1,PRINCIPAL:index===0?"SIM":"NAO",
    PUBLIC_ID:d.public_id,URL_ORIGINAL:d.secure_url,
    URL_CATALOGO:make(1600,2000),URL_FEED:make(1080,1350),URL_STORY:make(1080,1920),
    URL_WHATSAPP:make(1080,1350),URL_FACEBOOK:make(1200,1500),URL_SHOPEE:make(1200,1200,"pad"),
    URL_MERCADO_LIVRE:make(1200,1200,"pad")
  };
}
async function saveProduct(e){
  e.preventDefault();
  const btn=$("#saveProductBtn"); btn.disabled=true; btn.textContent="Salvando...";
  try{
    const id=state.editingId||uid("PROD");
    const variants=getVariants();
    const total=variants.reduce((a,v)=>a+Number(v.ESTOQUE),0);
    const product={
      ID:id,SKU:id.replace("PROD_","FIT"),NICHO:$("#niche").value,CATEGORIA:$("#category").value.trim(),MARCA:$("#brand").value.trim(),
      NOME:$("#productName").value.trim(),DESCRICAO:$("#description").value.trim(),COR_TOM:$("#colorTone").value.trim(),
      TIPO_TAMANHO:$('input[name="sizeMode"]:checked').value,TAMANHO_EXIBICAO:sizeDisplay(),PRECO_COMPRA:Number($("#purchasePrice").value||0),
      PRECO_VENDA:Number($("#salePrice").value||0),ESTOQUE_ATUAL:total,ESTOQUE_MINIMO:Number($("#minStock").value||0),
      ATIVO:$("#activeProduct").checked?"SIM":"NAO"
    };
    const uploaded=[];
    for(let i=0;i<state.pendingFiles.length;i++){ btn.textContent=`Enviando foto ${i+1}/${state.pendingFiles.length}`; uploaded.push(await uploadImage(state.pendingFiles[i],id,i)); }
    await api("saveProduct",{product,variants,photos:uploaded});
    await loadAll(); resetProductForm(); showView("products"); toast("Produto salvo e publicado!");
  }catch(err){toast(err.message)} finally{btn.disabled=false;btn.textContent="Salvar e publicar"}
}
window.editProduct=function(id){
  const p=state.products.find(x=>x.ID===id); if(!p)return;
  resetProductForm(); state.editingId=id; $("#productId").value=id; $("#productFormTitle").textContent="Editar produto";
  $("#niche").value=p.NICHO; $("#category").value=p.CATEGORIA; $("#brand").value=p.MARCA; $("#productName").value=p.NOME; $("#description").value=p.DESCRICAO||"";
  $("#colorTone").value=p.COR_TOM||""; $("#purchasePrice").value=p.PRECO_COMPRA||0; $("#salePrice").value=p.PRECO_VENDA||0; $("#initialStock").value=p.ESTOQUE_ATUAL||0; $("#minStock").value=p.ESTOQUE_MINIMO||0; $("#activeProduct").checked=p.ATIVO==="SIM";
  const mode=p.TIPO_TAMANHO||"UNICO"; $(`input[name="sizeMode"][value="${mode}"]`).checked=true;
  if(mode==="UNICO"){const m=(p.TAMANHO_EXIBICAO||"").match(/(\d+).*(\d+)/);if(m){$("#sizeFrom").value=m[1];$("#sizeTo").value=m[2]}}
  toggleSizeMode(); showView("productForm");
}
window.deleteProduct=async function(id){ if(!confirm("Excluir este produto?"))return; try{await api("deleteProduct",{id});await loadAll();renderProducts();toast("Produto excluído")}catch(e){toast(e.message)} }

function populateProductSelects(){
  const opts=`<option value="">Selecione</option>`+state.products.filter(p=>p.ATIVO==="SIM").map(p=>`<option value="${p.ID}">${escapeHtml(p.NOME)} — estoque ${p.ESTOQUE_ATUAL}</option>`).join("");
  $("#stockProduct").innerHTML=opts; $("#saleProduct").innerHTML=opts;
}
async function saveStock(e){e.preventDefault();try{await api("stockMovement",{productId:$("#stockProduct").value,type:$("#stockType").value,qty:Number($("#stockQty").value),reason:$("#stockReason").value});await loadAll();renderMovements();renderDashboard();e.target.reset();toast("Estoque atualizado")}catch(err){toast(err.message)}}
function renderMovements(){ $("#movementList").innerHTML=state.movements.slice(0,30).map(m=>`<div class="list-item"><div><b>${escapeHtml(m.PRODUTO)}</b><small>${escapeHtml(m.TIPO)} · ${escapeHtml(m.MOTIVO||"")}</small></div><span class="amount">${m.QUANTIDADE}</span></div>`).join("")||`<p class="muted">Sem movimentações.</p>`}
async function saveSale(e){e.preventDefault();try{await api("saveSale",{productId:$("#saleProduct").value,qty:Number($("#saleQty").value),client:$("#saleClient").value,phone:$("#salePhone").value,discount:Number($("#saleDiscount").value||0),payment:$("#paymentMethod").value});await loadAll();renderSales();e.target.reset();$("#saleQty").value=1;$("#saleDiscount").value=0;toast("Venda registrada!")}catch(err){toast(err.message)}}
function renderSales(){ $("#salesList").innerHTML=state.sales.slice(0,30).map(s=>`<div class="list-item"><div><b>${escapeHtml(s.PRODUTO)}</b><small>${escapeHtml(s.CLIENTE||"Sem cliente")} · ${escapeHtml(s.PAGAMENTO)}</small></div><span class="amount positive">${money(s.TOTAL)}</span></div>`).join("")||`<p class="muted">Sem vendas.</p>`}
function renderClients(){ $("#clientsList").innerHTML=state.clients.map(c=>`<div class="list-item"><div><b>${escapeHtml(c.NOME)}</b><small>${escapeHtml(c.TELEFONE||"")} · ${c.COMPRAS||0} compras</small></div><span>${money(c.TOTAL_GASTO)}</span></div>`).join("")||`<p class="muted">Sem clientes.</p>`}
async function saveExpense(e){e.preventDefault();try{await api("saveExpense",{description:$("#expenseDescription").value,category:$("#expenseCategory").value,value:Number($("#expenseValue").value)});await loadAll();renderFinance();e.target.reset();toast("Despesa registrada")}catch(err){toast(err.message)}}
function renderFinance(){
  const rev=state.sales.reduce((a,s)=>a+Number(s.TOTAL||0),0), exp=state.expenses.reduce((a,x)=>a+Number(x.VALOR||0),0);
  $("#financeStats").innerHTML=[["Faturamento",money(rev)],["Despesas",money(exp)],["Resultado",money(rev-exp)],["Vendas",state.sales.length]].map(([l,v])=>`<div class="stat"><strong>${v}</strong><span>${l}</span></div>`).join("");
  $("#expensesList").innerHTML=state.expenses.slice(0,30).map(x=>`<div class="list-item"><div><b>${escapeHtml(x.DESCRICAO)}</b><small>${escapeHtml(x.CATEGORIA||"")}</small></div><span class="amount negative">${money(x.VALOR)}</span></div>`).join("")||`<p class="muted">Sem despesas.</p>`;
}

function bind(){
  $("#menuBtn").onclick=openDrawer; $("#closeDrawer").onclick=closeDrawer; $("#backdrop").onclick=closeDrawer; $("#loginBtn").onclick=login; $("#logoutBtn").onclick=logout;
  $$("[data-view]").forEach(b=>b.onclick=()=>{if(b.dataset.view==="productForm")resetProductForm();showView(b.dataset.view); if(b.dataset.view==="stock")renderMovements(); if(b.dataset.view==="sales")renderSales(); if(b.dataset.view==="clients")renderClients(); if(b.dataset.view==="finance")renderFinance();});
  $$('input[name="sizeMode"]').forEach(r=>r.onchange=toggleSizeMode);
  $("#addCustomSize").onclick=()=>{const s=prompt("Digite o tamanho, por exemplo 38-44");if(s)addSizeChip(s)};
  $("#photoInput").onchange=e=>previewFiles(e.target.files); $("#productForm").onsubmit=saveProduct; $("#cancelProduct").onclick=()=>{resetProductForm();showView("products")};
  $("#productSearch").oninput=renderProducts; $("#productNicheFilter").onchange=renderProducts; $("#stockForm").onsubmit=saveStock; $("#saleForm").onsubmit=saveSale; $("#expenseForm").onsubmit=saveExpense;
}
async function init() {
  bind();
  resetProductForm();

  if ("serviceWorker" in navigator) {
    try {
      const registrations =
        await navigator.serviceWorker.getRegistrations();

      await Promise.all(
        registrations.map((registration) =>
          registration.unregister()
        )
      );

      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames.map((name) => caches.delete(name))
      );
    } catch (error) {
      console.warn(
        "Não foi possível limpar o cache antigo:",
        error
      );
    }
  }

  if (state.token) {
    try {
      await loadAll();
      showView("dashboard");
    } catch (error) {
      logout();
    }
  }
}
  if(state.token){try{await loadAll();showView("dashboard")}catch(e){logout()}}
document.addEventListener("DOMContentLoaded",init);
