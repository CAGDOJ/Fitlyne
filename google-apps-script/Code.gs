const SHEETS = {
  CONFIG:["CHAVE","VALOR"],
  PRODUTOS:["ID","SKU","NICHO","CATEGORIA","MARCA","NOME","DESCRICAO","COR_TOM","TIPO_TAMANHO","TAMANHO_EXIBICAO","PRECO_COMPRA","PRECO_VENDA","ESTOQUE_ATUAL","ESTOQUE_MINIMO","ATIVO","CRIADO_EM","ATUALIZADO_EM"],
  FOTOS:["ID","ID_PRODUTO","ORDEM","PRINCIPAL","PUBLIC_ID","URL_ORIGINAL","URL_CATALOGO","URL_FEED","URL_STORY","URL_WHATSAPP","URL_FACEBOOK","URL_SHOPEE","URL_MERCADO_LIVRE","CRIADO_EM"],
  VARIACOES:["ID","ID_PRODUTO","TAMANHO","ESTOQUE","CRIADO_EM"],
  MOVIMENTACOES:["ID","DATA","ID_PRODUTO","PRODUTO","TIPO","QUANTIDADE","MOTIVO"],
  VENDAS:["ID","DATA","ID_PRODUTO","PRODUTO","QUANTIDADE","VALOR_UNITARIO","DESCONTO","TOTAL","CLIENTE","TELEFONE","PAGAMENTO"],
  CLIENTES:["ID","NOME","TELEFONE","COMPRAS","TOTAL_GASTO","ULTIMA_COMPRA"],
  DESPESAS:["ID","DATA","DESCRICAO","CATEGORIA","VALOR"]
};

function setupSystem(){
  const ss=SpreadsheetApp.getActive();
  Object.entries(SHEETS).forEach(([name,headers])=>{
    let sh=ss.getSheetByName(name);
    if(!sh) sh=ss.insertSheet(name);
    if(sh.getLastRow()===0){sh.getRange(1,1,1,headers.length).setValues([headers]);sh.setFrozenRows(1);sh.getRange(1,1,1,headers.length).setFontWeight("bold").setBackground("#111111").setFontColor("#ffffff");}
  });
  const cfg=ss.getSheetByName("CONFIG");
  if(cfg.getLastRow()===1) cfg.getRange(2,1,5,2).setValues([
    ["ADMIN_PIN","1234"],["WHATSAPP","5591999999999"],["NOME_LOJA","FITLYNE"],["SUBTITULO","Moda Fitness & Makeup"],["TOKEN_TTL_HORAS","24"]
  ]);
}

function doGet(){return json({ok:true,data:{name:"FITLYNE API"}})}
function doPost(e){
  try{
    const req=JSON.parse(e.postData.contents||"{}");
    const action=req.action||"", payload=req.payload||{};
    if(action==="login") return json({ok:true,data:login(payload.pin)});
    if(action==="publicCatalog") return json({ok:true,data:publicCatalog()});
    if(!validateToken(req.token)) throw new Error("Sessão inválida. Entre novamente.");
    const handlers={bootstrap,saveProduct,deleteProduct,stockMovement,saveSale,saveExpense};
    if(!handlers[action]) throw new Error("Ação inválida");
    return json({ok:true,data:handlers[action](payload)});
  }catch(err){return json({ok:false,error:String(err.message||err)})}
}
function json(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
function cfg(){
  const rows=readSheet("CONFIG"), o={}; rows.forEach(r=>o[r.CHAVE]=r.VALOR); return o;
}
function login(pin){
  const c=cfg(); if(String(pin)!==String(c.ADMIN_PIN)) throw new Error("PIN incorreto");
  const token=Utilities.getUuid(); const ttl=Number(c.TOKEN_TTL_HORAS||24)*3600;
  CacheService.getScriptCache().put("TOKEN_"+token,"1",ttl);
  return {token};
}
function validateToken(t){return !!(t&&CacheService.getScriptCache().get("TOKEN_"+t))}
function bootstrap(){
  return {products:readSheet("PRODUTOS"),photos:readSheet("FOTOS"),movements:readSheet("MOVIMENTACOES").reverse(),sales:readSheet("VENDAS").reverse(),clients:readSheet("CLIENTES"),expenses:readSheet("DESPESAS").reverse(),config:cfg()};
}
function publicCatalog(){return {products:readSheet("PRODUTOS").filter(p=>p.ATIVO==="SIM"),photos:readSheet("FOTOS"),config:cfg()}}
function saveProduct(payload){
  const p=payload.product, now=new Date();
  const sh=sheet("PRODUTOS"), idx=findRow("PRODUTOS","ID",p.ID);
  const current=idx?rowObject("PRODUTOS",idx):null;
  const obj={...p,CRIADO_EM:current?current.CRIADO_EM:now,ATUALIZADO_EM:now};
  upsert("PRODUTOS","ID",obj);
  replaceByProduct("VARIACOES",p.ID,payload.variants||[]);
  (payload.photos||[]).forEach(f=>upsert("FOTOS","ID",{...f,CRIADO_EM:now}));
  if(!current && Number(p.ESTOQUE_ATUAL)>0) appendObject("MOVIMENTACOES",{ID:Utilities.getUuid(),DATA:now,ID_PRODUTO:p.ID,PRODUTO:p.NOME,TIPO:"ENTRADA",QUANTIDADE:p.ESTOQUE_ATUAL,MOTIVO:"ESTOQUE INICIAL"});
  return {id:p.ID};
}
function deleteProduct(payload){
  ["PRODUTOS","FOTOS","VARIACOES"].forEach(name=>deleteWhere(name,"ID_PRODUTO",payload.id));
  deleteWhere("PRODUTOS","ID",payload.id);
  return true;
}
function stockMovement(payload){
  const row=findRow("PRODUTOS","ID",payload.productId); if(!row) throw new Error("Produto não encontrado");
  const p=rowObject("PRODUTOS",row), qty=Number(payload.qty||0), old=Number(p.ESTOQUE_ATUAL||0), type=payload.type;
  let next=old;
  if(type==="ENTRADA"||type==="DEVOLUCAO") next=old+qty;
  else if(type==="SAIDA"||type==="PERDA") next=old-qty;
  else if(type==="AJUSTE") next=qty;
  if(next<0) throw new Error("Estoque insuficiente");
  p.ESTOQUE_ATUAL=next;p.ATUALIZADO_EM=new Date();upsert("PRODUTOS","ID",p);
  appendObject("MOVIMENTACOES",{ID:Utilities.getUuid(),DATA:new Date(),ID_PRODUTO:p.ID,PRODUTO:p.NOME,TIPO:type,QUANTIDADE:qty,MOTIVO:payload.reason||""});
  return {stock:next};
}
function saveSale(payload){
  const row=findRow("PRODUTOS","ID",payload.productId); if(!row) throw new Error("Produto não encontrado");
  const p=rowObject("PRODUTOS",row), qty=Number(payload.qty||1);
  if(Number(p.ESTOQUE_ATUAL)<qty) throw new Error("Estoque insuficiente");
  const unit=Number(p.PRECO_VENDA||0), discount=Number(payload.discount||0), total=Math.max(0,unit*qty-discount), now=new Date();
  appendObject("VENDAS",{ID:Utilities.getUuid(),DATA:now,ID_PRODUTO:p.ID,PRODUTO:p.NOME,QUANTIDADE:qty,VALOR_UNITARIO:unit,DESCONTO:discount,TOTAL:total,CLIENTE:payload.client||"",TELEFONE:payload.phone||"",PAGAMENTO:payload.payment||"PIX"});
  p.ESTOQUE_ATUAL=Number(p.ESTOQUE_ATUAL)-qty;p.ATUALIZADO_EM=now;upsert("PRODUTOS","ID",p);
  appendObject("MOVIMENTACOES",{ID:Utilities.getUuid(),DATA:now,ID_PRODUTO:p.ID,PRODUTO:p.NOME,TIPO:"VENDA",QUANTIDADE:qty,MOTIVO:"VENDA"});
  if(payload.client||payload.phone) upsertClient(payload.client||"CLIENTE",payload.phone||"",total,now);
  return {total};
}
function upsertClient(name,phone,total,date){
  const rows=readSheet("CLIENTES"); const found=rows.find(c=>phone&&String(c.TELEFONE)===String(phone));
  if(found){found.NOME=name||found.NOME;found.COMPRAS=Number(found.COMPRAS||0)+1;found.TOTAL_GASTO=Number(found.TOTAL_GASTO||0)+Number(total);found.ULTIMA_COMPRA=date;upsert("CLIENTES","ID",found)}
  else appendObject("CLIENTES",{ID:Utilities.getUuid(),NOME:name,TELEFONE:phone,COMPRAS:1,TOTAL_GASTO:total,ULTIMA_COMPRA:date});
}
function saveExpense(payload){appendObject("DESPESAS",{ID:Utilities.getUuid(),DATA:new Date(),DESCRICAO:payload.description,CATEGORIA:payload.category||"",VALOR:Number(payload.value||0)});return true}

function sheet(name){const sh=SpreadsheetApp.getActive().getSheetByName(name);if(!sh)throw new Error("Aba ausente: "+name);return sh}
function readSheet(name){
  const sh=sheet(name), values=sh.getDataRange().getValues(); if(values.length<2)return[];
  const h=values[0]; return values.slice(1).filter(r=>r.some(v=>v!=="")).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])));
}
function rowObject(name,row){
  const sh=sheet(name), h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0], v=sh.getRange(row,1,1,h.length).getValues()[0];
  return Object.fromEntries(h.map((k,i)=>[k,v[i]]));
}
function findRow(name,key,value){
  const sh=sheet(name), h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0], col=h.indexOf(key)+1;if(!col)return 0;
  const vals=sh.getRange(2,col,Math.max(0,sh.getLastRow()-1),1).getValues().flat();const i=vals.findIndex(v=>String(v)===String(value));return i<0?0:i+2;
}
function appendObject(name,obj){
  const sh=sheet(name), h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];sh.appendRow(h.map(k=>obj[k]??""));
}
function upsert(name,key,obj){
  const sh=sheet(name), h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0], row=findRow(name,key,obj[key]), vals=h.map(k=>obj[k]??"");
  if(row) sh.getRange(row,1,1,h.length).setValues([vals]); else sh.appendRow(vals);
}
function deleteWhere(name,key,value){
  const sh=sheet(name), h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0], col=h.indexOf(key)+1;if(!col||sh.getLastRow()<2)return;
  const vals=sh.getRange(2,col,sh.getLastRow()-1,1).getValues().flat();
  for(let i=vals.length-1;i>=0;i--)if(String(vals[i])===String(value))sh.deleteRow(i+2);
}
function replaceByProduct(name,productId,rows){
  deleteWhere(name,"ID_PRODUTO",productId); rows.forEach(r=>appendObject(name,{...r,ID_PRODUTO:productId,CRIADO_EM:new Date()}));
}
