import{initializeApp}from"https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";

import{getAuth,sendPasswordResetEmail}from"https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import{
getFirestore,
Timestamp,
doc,
getDoc,
getDocs,
setDoc,
addDoc,
deleteDoc,
collection,
query,
orderBy,
limit,
where,
serverTimestamp,
runTransaction,
increment,
updateDoc,
writeBatch,
arrayRemove
}from"https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

/* FIREBASE DO SITE PRINCIPAL */

const app=initializeApp({
apiKey:"AIzaSyCuF38ke5IytK2K6hZO3Xq4HmBeMo9lEEQ",
authDomain:"yshippcommercedasorte.firebaseapp.com",
projectId:"yshippcommercedasorte",
storageBucket:"yshippcommercedasorte.firebasestorage.app",
messagingSenderId:"301928857844",
appId:"1:301928857844:web:44a0da1455a1e0b1fadea1",
measurementId:"G-664T7YTXPZ"
});

const db=getFirestore(app);

const auth=getAuth(app);

const $=id=>document.getElementById(id);

const C={
draws:[],
events:[],
tasks:[],
links:[],
claims:[],
users:[],
resvs:[],
auctions:[],
bids:[],
notes:[],
covers:[],
collabs:[],
cofreTickets:[],
cofreDraws:[],
cofre:{},
disputes:[],
settings:{},
admin:null
};

let loaded=false;
C.loading=false;
C.loadErrors={};
let faq=[];
let tickerRows=[];
let supportCode="";
let ticketTypes={};
let currentPage="dashboard";

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({
"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

const validUrl=v=>/^https?:\/\/\S+$/i.test(String(v||""));

/* PERSONAGENS DO PERFIL (mesma lista do site v9): photoMode "ch:raposa" => monograma com cor própria */
const CHARACTERS={raposa:"#f59e0b",tigre:"#f97316",leao:"#eab308",panda:"#22c55e",urso:"#a16207",lobo:"#64748b",gato:"#8b5cf6",coelho:"#f472b6",polvo:"#06b6d4",robo:"#3b82f6",fantasma:"#71717a",unicornio:"#ec4899",dragao:"#10b981",alien:"#84cc16",palhaco:"#ef4444",macaco:"#d97706"};
const charOf=m=>CHARACTERS[String(m||"").replace(/^ch:/,"")]||null;
const charName=m=>String(m||"").replace(/^ch:/,"");
/* participantes: monograma profissional com a cor do personagem (ou a inicial) */
const uava=(u,ini)=>{const col=charOf(u?.photoMode);const l=esc(String(ini||"U").charAt(0).toUpperCase());return `<span class="uava" title="Personagem do perfil"${col?` style="color:${col}"`:''}>${l}</span>`};
/* provas da oferta v9: o participante pode enviar os 4 campos no menu expansível */
const proofCount=c=>[c.proofText,c.proofCode,c.proofImage,c.proofVideo,c.proofWhen,c.proof].filter(x=>x&&String(x).trim()).length;

function toast(m){
const el=$("toast");
el.innerHTML=String(m).replace(/<(?!i class=yi)[^>]*>/g,"");
el.classList.add("show");
clearTimeout(window.toastTimer);
window.toastTimer=setTimeout(()=>el.classList.remove("show"),3500);
}

function error(e){
console.error(e);
const messages={
"permission-denied":"Permissão negada pelo Firestore. Verifique as regras.",
"unavailable":"Firebase indisponível.",
"auth/invalid-credential":"E-mail ou senha incorretos.",
"auth/too-many-requests":"Muitas tentativas. Aguarde.",
"auth/network-request-failed":"Falha de conexão."
};
toast(messages[e.code]||e.message||"Erro inesperado.");
}

function date(v){
if(!v)return"—";
const d=v.toDate?v.toDate():new Date(v);
return isNaN(d)?"—":d.toLocaleString("pt-BR");
}

function stamp(v){
if(!v)return null;
if(v instanceof Date)return v;
if(v.toDate)return v.toDate();
const d=new Date(v);
return isNaN(d)?null:d;
}

function dateInput(v){
const d=stamp(v);
if(!d)return"";
const z=n=>String(n).padStart(2,"0");
return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())+"T"+z(d.getHours())+":"+z(d.getMinutes());
}

function toTimestamp(v){
return v?new Date(v):null;
}

/* MESMA LÓGICA DO SITE: como o evento aparece no Yshippcommerce */
const tmsA=v=>{const d=stamp(v);return d?d.getTime():0};
const tmeA=v=>{const d=stamp(v);return d?d.getTime():Infinity};
function evState(o){
const n=Date.now(),e=o.endAt?tmeA(o.endAt):Infinity;
if(n>=e)return"ended";
if(o.active===false)return"off";
/* Início futuro = "Em breve", MESMO com Ativo = true — igual ao texto desta
   tela (antes, Ativo=true com data futura já aparecia como ativo no site) */
if(n<tmsA(o.startAt))return"future";
return"active";
}
function evStateBadge(e){
const st=evState(e);
if(st==="active")return'<span class="status green">Ativo agora no site</span>';
if(st==="future")return'<span class="status yellow">Em breve no site · abre '+date(e.startAt)+'</span>';
if(st==="ended")return'<span class="status red">Encerrado no site'+(e.endAt?" · "+date(e.endAt):"")+'</span>';
return'<span class="status">Inativo (oculto do site)</span>';
}

/* ACESSO DIRETO: sem login, o painel abre imediatamente */

C.admin={uid:"painel",email:"painel administrativo"};

$("refreshBtn").onclick=async()=>{
try{
await loadAll();
toast("Dados atualizados.");
}catch(e){error(e)}
};

(async()=>{

try{
await loadAll();
}catch(e){error(e)}

})();

/* LEITURA DO FIRESTORE */

async function readCol(name,limitCount=500){
try{
const s=await getDocs(query(collection(db,name),limit(limitCount)));
delete C.loadErrors[name];
return s.docs.map(d=>({id:d.id,...d.data()}));
}catch(e){
/* Falhas parciais são mostradas no estado agregado; não as mascarar como conexão total. */
C.loadErrors[name]=e.code||"read-failed";
console.warn("Leitura de '"+name+"' falhou:",e);
return[];
}
}
/* documento com leitura protegida (mesma razão de readCol) */
async function readDoc(name,id){
try{
const snap=await getDoc(doc(db,name,id));
delete C.loadErrors[name+"/"+id];
return snap;
}catch(e){
C.loadErrors[name+"/"+id]=e.code||"read-failed";
console.warn("Leitura de "+name+"/"+id+" falhou:",e);
return{exists:()=>false,data:()=>({})};
}
}

function updateLoadStatus(){
const el=$("firestoreStatus"),label=$("firestoreStatusText");
if(!el||!label)return;
const errors=Object.keys(C.loadErrors||{});
el.classList.toggle("loading",!!C.loading);
el.classList.toggle("warning",!C.loading&&errors.length>0);
if(C.loading){label.textContent="Sincronizando dados…";el.title="Leitura inicial/atualização em andamento."}
else if(errors.length){label.textContent="Acesso parcial · "+errors.length+" fonte(s)";el.title="Falhas de leitura: "+errors.join(", ")}
else{label.textContent="Dados sincronizados";el.title="Leitura das fontes administrativas concluída."}
}

async function loadAll(){
C.loading=true;
updateLoadStatus();
try{

const [draws,events,tasks,links,claims,users,resvs,aucts,bids,notes,covers,cofireTk,cofireDr,cofireDoc,collabs,taskClaimsR,disputes,settings,catDoc,taskLimitsDoc,gigCatalogDoc,proGigsR,adcAdsR,adcCenterDoc,pesqs,storeR,ordersR,appsR,appInstallsR,appActivityClaimsR,wdR,fbR,econDoc,challengesR,challengeClaimsR,checkinsR,roomsR,userStatsR,communityDoc,checkinDoc,rankingDoc,affGroupsR,affProofsR,affiliateDoc,vipMembersR,vipPoolDoc]=await Promise.all([

readCol("draws"),
readCol("events"),
readCol("tasks"),
readCol("eventTasks"),
readCol("taskClaims",1000),
readCol("users",1000),
readCol("reservations",2000),
readCol("auctions"),
readCol("bids",2000),
readCol("notifications",100),
readCol("covers"),
readCol("cofreTickets",3000),
readCol("cofireDraws",200),
readDoc("settings","cofre"),
readCol("collabTasks",1000),
readCol("taskClaims",1000),
readCol("disputes",500),
readDoc("settings","platform"),
readDoc("settings","taskCatalog"),
readDoc("settings","taskLimits"),
readDoc("settings","gigCatalog"),
readCol("proGigs",500),
readCol("marketAds",500),
readDoc("settings","adsCenter"),
readCol("surveys",500),
readCol("storeItems",300),
readCol("orders",500),
readCol("apps",300),
readCol("appInstalls",1000),
readCol("appActivityClaims",1000),
readCol("withdrawals",300),
readCol("feedback",300),
readDoc("settings","economy"),
readCol("challenges",300),
readCol("challengeClaims",1000),
readCol("checkins",300),
readCol("rooms",200),
readCol("userStats",300),
readDoc("settings","community"),
readDoc("settings","checkin"),
readDoc("settings","ranking"),
readCol("affGroups",300),
readCol("affProofs",300),
readDoc("settings","affiliate"),
readCol("vipMembers",500),
readDoc("settings","vip")

]);

C.draws=draws;
C.events=events;
C.tasks=tasks;
C.links=links;
C.claims=claims;
C.users=users;
C.resvs=resvs;
C.auctions=aucts;
C.bids=bids;
C.notes=notes;
C.covers=covers;
C.collabs=collabs;
C.taskClaims=taskClaimsR;
C.disputes=disputes;
C.cofreTickets=cofireTk;
C.cofreDraws=cofireDr;
C.cofre=cofireDoc.exists()?cofireDoc.data():{};
C.settings=settings.exists()?settings.data():{};
C.taskLimits=taskLimitsDoc&&taskLimitsDoc.exists&&taskLimitsDoc.exists()?taskLimitsDoc.data():{};
C.gigCatalog=gigCatalogDoc&&gigCatalogDoc.exists&&gigCatalogDoc.exists()?gigCatalogDoc.data():{};
C.proGigs=Array.isArray(proGigsR)?proGigsR:[];

C.adcAds=adcAdsR;
C.adcCenter=adcCenterDoc.exists()?adcCenterDoc.data():{};
C.pesqs=pesqs;
C.storeItems=storeR;
C.orders=ordersR;
C.apps=appsR;
C.appInstalls=appInstallsR;
C.appActs=appActivityClaimsR;
C.withdrawals=wdR;
C.feedback=fbR;
C.econ=econDoc.exists()?econDoc.data():{};
C.challenges=challengesR;
C.challengeClaims=challengeClaimsR;
C.checkins=checkinsR;
C.rooms=roomsR;
C.userStats=userStatsR;
C.community=communityDoc.exists()?communityDoc.data():{};
C.checkinCfg=checkinDoc.exists()?checkinDoc.data():{};
C.rankingCfg=rankingDoc.exists()?rankingDoc.data():{};
C.affGroups=affGroupsR;
C.affProofs=affProofsR;
C.affiliateCfg=affiliateDoc.exists()?affiliateDoc.data():{};
C.vipMembers=vipMembersR;
C.vipPoolData=vipPoolDoc.exists()?vipPoolDoc.data():{};
/* rascunho das ferramentas: editado aqui, salvo junto com o resto */
C.adcTools=Array.isArray(C.adcCenter.tools)?C.adcCenter.tools.map(t=>({...t})):[];
C.adcPrices=C.adcCenter.prices&&typeof C.adcCenter.prices==="object"?C.adcCenter.prices:{};

/* catálogo de tarefas: usa o padrão se ainda não foi salvo no Firestore */
const catData=catDoc.exists()?catDoc.data():null;
catalog=(catData&&Array.isArray(catData.categories)&&catData.categories.length)?catData:DEFAULT_CATALOG;
catDraft=null;

loaded=true;
C.loading=false;
updateLoadStatus();

renderAll();

/* encerra automaticamente leilões abertos cujo prazo venceu — não depende
   de um visitante estar com o site aberto (transação idempotente) */
sweepExpiredAuctions();

/* retoma devoluções interrompidas de sorteios já publicados: reembolso
   por usuário é idempotente (histórico com ID fixo), sem risco de 2× */
C.draws.filter(x=>x.status==="ended"&&x.refundPending===true).forEach(x=>{refundDrawNonWinners(x).catch(()=>{})});

}catch(e){
C.loading=false;
updateLoadStatus();
error(e);
}

}

function renderAll(){
/* cada renderização é protegida: um erro em uma página nunca pode
   impedir as demais de aparecerem (ex.: itens do Market sumindo) */
[renderDashboard,renderDraws,renderEvents,renderTasks,renderCatalog,renderCollab,renderLinks,renderClaims,renderDisputes,renderUsers,renderAuctions,renderCovers,loadSettings,renderResults,renderCofre,renderPrizeEditor,renderAdc,renderPesquisas,renderMarket,renderApps,renderPros,renderEconomy,renderFeedback,renderHomeBlocks,renderEventsCenter,renderAffiliates].forEach(fn=>{
try{fn()}catch(e){console.warn("Falha ao renderizar "+(fn.name||"página")+":",e)}
});
}

/* ═══ CENTAL DE ANÚNCIOS · edição de tudo que o site exibe ═══ */

const ADC_TYPES={banner:"<i class=yi data-i=image></i> Banner",link:"<i class=yi data-i=link></i> Link",video:"<i class=yi data-i=video></i> Vídeo",
 youtube:"<i class=yi data-i=video></i> YouTube",adsterra:"<i class=yi data-i=megaphone></i> Adsterra",
 monetag:"<i class=yi data-i=bolt></i> Monetag",encurtanet:"<i class=yi data-i=link></i> EncurtaNet"};
const ADC_DURS={h12:"12h",h24:"24h",d7:"7d"};

function adcCfg(){
return{
everyMin:Math.min(240,Math.max(5,Math.floor(Number(C.adcCenter.everyMin)||20))),
viewSec:Math.min(120,Math.max(5,Math.floor(Number(C.adcCenter.viewSec)||10))),
prices:{
banner:{h12:Math.max(1,Math.floor(Number(C.adcPrices.banner?.h12)||30)),h24:Math.max(1,Math.floor(Number(C.adcPrices.banner?.h24)||50)),d7:Math.max(1,Math.floor(Number(C.adcPrices.banner?.d7)||200))},
link:{h12:Math.max(1,Math.floor(Number(C.adcPrices.link?.h12)||20)),h24:Math.max(1,Math.floor(Number(C.adcPrices.link?.h24)||35)),d7:Math.max(1,Math.floor(Number(C.adcPrices.link?.d7)||120))},
video:{h12:Math.max(1,Math.floor(Number(C.adcPrices.video?.h12)||40)),h24:Math.max(1,Math.floor(Number(C.adcPrices.video?.h24)||70)),d7:Math.max(1,Math.floor(Number(C.adcPrices.video?.d7)||280))},
youtube:{h12:Math.max(1,Math.floor(Number(C.adcPrices.youtube?.h12)||40)),h24:Math.max(1,Math.floor(Number(C.adcPrices.youtube?.h24)||70)),d7:Math.max(1,Math.floor(Number(C.adcPrices.youtube?.d7)||280))},
adsterra:{h12:Math.max(1,Math.floor(Number(C.adcPrices.adsterra?.h12)||35)),h24:Math.max(1,Math.floor(Number(C.adcPrices.adsterra?.h24)||60)),d7:Math.max(1,Math.floor(Number(C.adcPrices.adsterra?.d7)||240))},
monetag:{h12:Math.max(1,Math.floor(Number(C.adcPrices.monetag?.h12)||35)),h24:Math.max(1,Math.floor(Number(C.adcPrices.monetag?.h24)||60)),d7:Math.max(1,Math.floor(Number(C.adcPrices.monetag?.d7)||240))},
encurtanet:{h12:Math.max(1,Math.floor(Number(C.adcPrices.encurtanet?.h12)||25)),h24:Math.max(1,Math.floor(Number(C.adcPrices.encurtanet?.h24)||45)),d7:Math.max(1,Math.floor(Number(C.adcPrices.encurtanet?.d7)||180))}
}
};
}

function renderAdc(){
const cfg=adcCfg();
$("adcEveryMin").value=cfg.everyMin;
$("adcViewSec").value=cfg.viewSec;
Object.entries(cfg.prices).forEach(([t,durs])=>Object.entries(durs).forEach(([d,v])=>{
const el=$("prc-"+t+"-"+d);if(el)el.value=v;
}));
/* ferramentas */
$("adcToolList").innerHTML=C.adcTools.length?C.adcTools.map((t,i)=>`
<div class="item" style="display:grid;gap:8px">
<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
<b>${esc(t.icon||"<i class=yi data-i=toolbox></i>")} ${esc(t.name||"Ferramenta")}</b>
<span class="status ${t.active===false?"red":"green"}">${t.active===false?"Inativa":"Ativa no site"}</span>
<span class="status"><i class=yi data-i=pointer></i> ${Number(C.adcCenter?.toolClicks?.[t.id]||0)} cliques no botão</span>
<span class="status">${esc(t.cat||"outro")}</span>
${validUrl(t.ref)?'<span class="adflag"><i class=yi data-i=link></i> com link de indicação</span>':""}
</div>
<p style="margin:0">${esc(t.desc||"")}</p>
<div class="actions" style="margin:0">
<button class="btn secondary small" data-adctool-edit="${i}"><i class=yi data-i=edit></i> Editar</button>
<button class="btn secondary small" data-adctool-toggle="${i}">${t.active===false?"Ativar":"Desativar"}</button>
<button class="btn danger small" data-adctool-del="${i}">Excluir</button>
</div>
</div>`).join(""):'<div class="empty">Nenhuma ferramenta ainda. Clique em "+ Nova ferramenta".</div>';
/* campanhas pagas */
const live=C.adcAds.filter(a=>a.status==="active"&&(!a.expiresAt||(stamp(a.expiresAt)?.getTime()||0)>Date.now()));
const pend=C.adcAds.filter(a=>a.status==="pending").length;
const rev=C.adcAds.reduce((s,a)=>s+Math.max(0,Math.floor(Number(a.amount)||0)),0);
const views=C.adcAds.reduce((s,a)=>s+(Number(a.impressions)||0),0);
const clicks=C.adcAds.reduce((s,a)=>s+(Number(a.clicks)||0),0);
$("adcStatRevenue").textContent=String(rev);
$("adcStatViews").textContent=String(views);
$("adcStatClicks").textContent=String(clicks);
$("adcStatCtr").textContent=views?((clicks/views)*100).toFixed(1)+"%":"—";
$("adcStatActive").textContent=String(live.length);
$("adcStatPendingFoot").innerHTML=pend?("<i class=yi data-i=warn></i> "+pend+" aguardando aprovação"):"Aprovadas e em rotação";
$("adcAdsBadge").textContent=String(pend||live.length);
const tf=$("adcTypeFilter")?.value||"";
const adcListAll=[...C.adcAds].sort((a,b)=>(stamp(b.createdAt)?.getTime()||0)-(stamp(a.createdAt)?.getTime()||0)).filter(a=>!tf||a.type===tf);
$("adcAdsList").innerHTML=adcListAll.length?adcListAll.map(a=>{
const exp=a.expiresAt?date(a.expiresAt):"—";
const expMs=a.expiresAt?(stamp(a.expiresAt)?.getTime()||0):0;
const st=a.status==="pending"?'<span class="status yellow"><i class=yi data-i=hourglass></i> Aguardando aprovação</span>':a.status==="rejected"?'<span class="status red">Rejeitada</span>':a.status==="paused"?'<span class="status yellow">Pausada</span>':(expMs&&expMs<Date.now()?'<span class="status">Expirada</span>':'<span class="status green">No ar</span>');
const expWarn=a.status==="active"&&expMs&&expMs>Date.now()&&expMs-Date.now()<432e5?`<br><span class="status yellow"><i class=yi data-i=hourglass></i> expira em ${Math.max(1,Math.ceil((expMs-Date.now())/36e5))}h</span>`:"";
const acts=(a.status==="pending"||a.status==="rejected")
?`<button class="btn success small" data-adcad-approve="${a.id}">✓ Aprovar</button><br><button class="btn danger small" data-adcad-reject="${a.id}">✕ Rejeitar</button>`
:`<button class="btn secondary small" data-adcad-toggle="${a.id}">${a.status==="paused"?"Retomar":"Pausar"}</button>`;
return `<tr>
<td>${esc(a.title||"—")}<small>${esc(a.text||"").slice(0,60)}</small></td>
<td>${esc(a.advertiserName||"—")}<small class="mono">${esc((a.uid||"").slice(0,12))}…</small></td>
<td>${esc(ADC_TYPES[a.type]||a.type||"—")}<small>${esc(a.duration||"")} · peso ${Math.min(10,Math.max(1,Math.floor(Number(a.weight)||1)))}</small>${a.type==="encurtanet"?`<small>Reservado ${Number(a.budgetReserved)||0} · Pago ${Number(a.budgetPaid)||0} · Restante ${Math.max(0,(Number(a.budgetReserved)||0)-(Number(a.budgetPaid)||0)-(Number(a.budgetRefunded)||0))}</small>`:""}</td>
<td>${Number(a.impressions)||0}</td>
<td>${Number(a.clicks)||0}</td>
<td>${exp}</td>
<td>${st}${expWarn}</td>
<td>
${acts}
<button class="btn secondary small" data-adcad-prev="${a.id}" style="margin-top:5px"><i class=yi data-i=eye></i> Prévia</button>
${a.type==="encurtanet"&&a.status==="active"?`<button class="btn secondary small" data-adcad-close="${a.id}" style="margin-top:5px"><i class=yi data-i=lock></i> Encerrar + estorno</button>`:""}
</td>
</tr>`;
}).join(""):'<tr><td colspan="8" class="empty">Nenhuma campanha paga criada pelos membros ainda.</td></tr>';
adcExpiryNotify();
}

/* prévia do anúncio: como o membro vê na gaveta de rotação do site */
function adcPreview(id){
const a=C.adcAds.find(x=>x.id===id);
if(!a)return;
openModal("<i class=yi data-i=eye></i> Prévia: "+(a.title||"Anúncio"),`
<div id="adcPrevBox" style="border:1px solid var(--l);border-radius:10px;overflow:hidden;background:#fff;min-height:240px;display:grid"></div>
<div class="field" style="margin-top:12px">
<label>Anunciante · formato · prioridade</label>
<p style="margin:0;font-size:13px">${esc(a.advertiserName||"—")} · ${esc(ADC_TYPES[a.type]||a.type||"—")} · peso ${Math.min(10,Math.max(1,Math.floor(Number(a.weight)||1)))}</p>
</div>
<div class="field">
<label>Texto do anúncio</label>
<p style="margin:0;font-size:13px">${esc(a.text||"—")}</p>
</div>
<p class="hint">Prévia aproximada da gaveta de rotação do site. O botão "Abrir link" usa o destino: ${esc(a.linkUrl||"—")}</p>`);
const box=$("adcPrevBox");
if(a.type==="banner"&&validUrl(a.imageUrl)){
box.innerHTML=`<a href="${esc(a.linkUrl||"")}" target="_blank" rel="noopener sponsored" style="display:block;width:100%;height:100%"><img src="${esc(a.imageUrl)}" alt="${esc(a.title||"")}" style="width:100%;height:100%;min-height:240px;object-fit:cover"></a>`;
}else if(a.type==="youtube"&&a.videoId){
box.innerHTML=`<iframe width="100%" height="280" style="border:0" src="https://www.youtube-nocookie.com/embed/${esc(a.videoId)}?rel=0" title="Prévia" allow="accelerometer;encrypted-media;picture-in-picture" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>`;
}else if(a.type==="adsterra"||a.type==="monetag"){
const f=document.createElement("iframe");
f.setAttribute("sandbox","allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-same-origin");
f.style.cssText="width:100%;height:280px;border:0;background:#fff";
f.srcdoc=String(a.adCode||"");
box.innerHTML="";box.appendChild(f);
}else if(a.type==="encurtanet"){
box.innerHTML=`<div style="padding:24px;display:grid;gap:8px;justify-items:center;text-align:center;align-content:center;color:#1e2329"><span style="font:700 10px monospace;letter-spacing:1px;color:#946f00">ENCURTANET</span><b style="font-size:17px">${esc(a.title||"")}</b><p style="color:#707a8a;font-size:13.5px;max-width:48ch;margin:0">${esc(a.text||"Conclua o percurso do link e ganhe reais.")}</p><b style="font:600 20px monospace;color:#946f00">+${Number(a.rewardPerCompletion)||0} reais por participação</b><span style="color:#707a8a;font-size:12px">Reservado ${Number(a.budgetReserved)||0} · Pago ${Number(a.budgetPaid)||0} · Restante ${Math.max(0,(Number(a.budgetReserved)||0)-(Number(a.budgetPaid)||0)-(Number(a.budgetRefunded)||0))}</span><span style="color:#707a8a;font-size:12px;word-break:break-all">Destino oficial: ${esc(a.destUrl||"—")}</span><span style="color:#707a8a;font-size:12px;word-break:break-all">Link encurtado: ${esc(a.shortUrl||"— não cadastrado")}</span></div>`;
}else if(a.embed||a.code){
const f=document.createElement("iframe");
f.setAttribute("sandbox","allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-same-origin");
f.style.cssText="width:100%;height:300px;border:0;background:#fff";
f.srcdoc=String(a.embed||a.code);
box.innerHTML="";box.appendChild(f);
}else{
box.innerHTML=`<div style="padding:24px;display:grid;gap:8px;justify-items:center;text-align:center;align-content:center;color:#1e2329"><b style="font-size:17px">${esc(a.title||"")}</b><p style="color:#707a8a;font-size:13.5px;max-width:48ch;margin:0">${esc(a.text||"")}</p><a href="${esc(a.linkUrl||"#")}" target="_blank" rel="noopener" style="color:#946f00">Abrir link →</a></div>`;
}
}

/* notifica o membro 1x quando a campanha ativa está a menos de 12h de expirar */
async function adcExpiryNotify(){
for(const a of C.adcAds){
if(a.status!=="active"||a.expNotified||!a.uid||!a.expiresAt)continue;
const ms=(stamp(a.expiresAt)?.getTime()||0)-Date.now();
if(ms>0&&ms<432e5){
a.expNotified=true; /* marca antes para não duplicar em renders simultâneos */
try{
await addDoc(collection(db,"notifications"),{
target:a.uid,
title:"<i class=yi data-i=hourglass></i> Sua campanha expira em breve",
category:"ads",
link:"#adc",
code:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:sans-serif;background:#0b0e11;color:#eaecef"><div style="padding:28px 18px;max-width:560px;margin:auto"><h2 style="margin:0 0 10px"><i class=yi data-i=hourglass></i> Sua campanha expira em breve</h2><p style="color:#848e9c;line-height:1.7">O anúncio <b style="color:#fcd535">'+esc(a.title||"")+'</b> expira em menos de 12 horas. Se quiser continuar no ar, publique uma nova campanha na Central de Anúncios antes do prazo acabar.</p></div></body></html>',
createdAt:serverTimestamp()
});
await updateDoc(doc(db,"marketAds",a.id),{expNotified:true});
}catch(e){}
}
}
}

$("adcAddTool").onclick=()=>adcEditTool(-1);
function adcEditTool(i){
const t=i>=0?C.adcTools[i]:{icon:"<i class=yi data-i=toolbox></i>",name:"",cat:"encurtador",tag:"",desc:"",ref:"",course:"",active:true};
openModal(i>=0?"Editar ferramenta":"Nova ferramenta",`
<div class="form-grid">
<div class="field" style="margin:0">
<label>Ícone (emoji)</label>
<input id="adt-icon" maxlength="8" value="${esc(t.icon||"<i class=yi data-i=toolbox></i>")}">
</div>
<div class="field" style="margin:0">
<label>Nome da ferramenta</label>
<input id="adt-name" maxlength="60" value="${esc(t.name||"")}">
</div>
<div class="field" style="margin:0">
<label>Categoria</label>
<select id="adt-cat">
<option value="encurtador" ${t.cat==="encurtador"?"selected":""}>Encurtador de links</option>
<option value="monetizacao" ${t.cat==="monetizacao"?"selected":""}>Monetização de ads</option>
<option value="trafego" ${t.cat==="trafego"?"selected":""}>Compra de tráfego (crescimento)</option>
<option value="banner" ${t.cat==="banner"?"selected":""}>Banners</option>
<option value="video" ${t.cat==="video"?"selected":""}>Vídeos</option>
<option value="outro" ${t.cat==="outro"?"selected":""}>Outro</option>
</select>
</div>
<div class="field" style="margin:0">
<label>Tag curta (ex.: "PAGA POR VISITA")</label>
<input id="adt-tag" maxlength="40" value="${esc(t.tag||"")}">
</div>
</div>
<div class="field">
<label>Descrição curta (aparece no card do site)</label>
<textarea id="adt-desc" style="min-height:70px">${esc(t.desc||"")}</textarea>
</div>
<div class="field">
<label>Seu link de indicação (o botão "Abrir ferramenta" do site usa este link)</label>
<input id="adt-ref" placeholder="https://…/seu-link-de-afiliado" value="${esc(t.ref||"")}">
</div>
<div class="field">
<label>Mini-curso (HTML + CSS + JavaScript — abre em gaveta TELA CHEIA no site ao clicar na ferramenta)</label>
<textarea id="adt-course" style="font:12.5px var(--mono);min-height:260px" placeholder="<h1>Como usar a ferramenta</h1> <p>Passo 1…</p>">${esc(t.course||"")}</textarea>
</div>
<div class="field">
<label>Ativa no site</label>
<select id="adt-active">
<option value="true" ${t.active!==false?"selected":""}>Sim — visível</option>
<option value="false" ${t.active===false?"selected":""}>Não — oculta</option>
</select>
</div>
<div class="actions">
<button class="btn" id="adt-save">Salvar ferramenta</button>
</div>
`);
$("adt-save").onclick=()=>{
const tool={
id:(i>=0?C.adcTools[i]?.id:"")||("t"+Date.now().toString(36)+Math.floor(Math.random()*1e5).toString(36)),
icon:$("adt-icon").value.trim()||"<i class=yi data-i=toolbox></i>",
name:$("adt-name").value.trim(),
cat:$("adt-cat").value,
tag:$("adt-tag").value.trim(),
desc:$("adt-desc").value.trim(),
ref:$("adt-ref").value.trim(),
course:$("adt-course").value,
active:$("adt-active").value==="true"
};
if(tool.name.length<2)return toast("Dê um nome à ferramenta.");
if(tool.ref&&!validUrl(tool.ref))return toast("O link de indicação precisa começar com http:// ou https://");
if(i>=0)C.adcTools[i]=tool;
else C.adcTools.push(tool);
closeModal();
adcDirty=true;adcDirtyMark();
renderAdc();
toast(i>=0?"Ferramenta atualizada (lembre de Salvar tudo).":"Ferramenta criada (lembre de Salvar tudo).");
};
}

$("adcSaveAll").onclick=async()=>{
const cfg={
everyMin:Math.min(240,Math.max(5,Math.floor(Number($("adcEveryMin").value)||20))),
viewSec:Math.min(120,Math.max(5,Math.floor(Number($("adcViewSec").value)||10))),
prices:{
banner:{h12:Math.max(1,Math.floor(Number($("prc-banner-h12").value)||30)),h24:Math.max(1,Math.floor(Number($("prc-banner-h24").value)||50)),d7:Math.max(1,Math.floor(Number($("prc-banner-d7").value)||200))},
link:{h12:Math.max(1,Math.floor(Number($("prc-link-h12").value)||20)),h24:Math.max(1,Math.floor(Number($("prc-link-h24").value)||35)),d7:Math.max(1,Math.floor(Number($("prc-link-d7").value)||120))},
video:{h12:Math.max(1,Math.floor(Number($("prc-video-h12").value)||40)),h24:Math.max(1,Math.floor(Number($("prc-video-h24").value)||70)),d7:Math.max(1,Math.floor(Number($("prc-video-d7").value)||280))}
},
tools:C.adcTools
};
try{
await setDoc(doc(db,"settings","adsCenter"),cfg,{merge:true});
/* confirmação: RELÊ o documento do Firestore e mostra na tela o que foi gravado */
let n="?",prc=false;
try{
const chk=await getDoc(doc(db,"settings","adsCenter"));
const d=chk.data()||{};
n=Array.isArray(d.tools)?d.tools.filter(t=>t&&t.name&&t.active!==false).length:0;
prc=!!(d.prices&&d.prices.banner);
}catch(_){}
adcDirty=false;adcDirtyMark();
toast("✓ Salvo e CONFIRMADO no Firestore: "+n+" ferramenta(s) ativa(s)"+(prc?", preços e rotação ✓":"")+". O site atualiza na hora.");
}catch(e){error(e)}
};
$("adcSaveAll2").onclick=$("adcSaveAll").onclick;

/* aviso "alterações não salvas" na Central de Anúncios */
let adcDirty=false;
function adcDirtyMark(){const b=$("adcDirtyBadge");if(b)b.hidden=!adcDirty}

document.addEventListener("click",async e=>{
const ed=e.target.dataset.adctoolEdit;
if(ed!==undefined){adcEditTool(Number(ed));return}
const tg=e.target.dataset.adctoolToggle;
if(tg!==undefined){const t=C.adcTools[Number(tg)];if(t){t.active=t.active===false;adcDirty=true;adcDirtyMark();renderAdc()}return}
const dl=e.target.dataset.adctoolDel;
if(dl!==undefined){const t=C.adcTools[Number(dl)];if(t&&confirm('Excluir a ferramenta "'+(t.name||"")+'"?')){C.adcTools.splice(Number(dl),1);adcDirty=true;adcDirtyMark();renderAdc()}return}
const ad=e.target.dataset.adcadToggle;
if(ad){
const a=C.adcAds.find(x=>x.id===ad);
if(!a)return;
try{
await updateDoc(doc(db,"marketAds",ad),{status:a.status==="paused"?"active":"paused",updatedAt:serverTimestamp()});
a.status=a.status==="paused"?"active":"paused";
renderAdc();
toast(a.status==="paused"?"Campanha pausada.":"Campanha de volta ao ar.");
}catch(err){error(err)}
return;
}
const ap=e.target.dataset.adcadApprove;
if(ap){
const a=C.adcAds.find(x=>x.id===ap);
/* EncurtaNet: só entra no ar com link encurtado cadastrado pelo anunciante */
if(a&&a.type==="encurtanet"&&!a.shortUrl){toast("Peça ao anunciante para cadastrar o link encurtado antes de aprovar esta campanha.");return}
try{
await updateDoc(doc(db,"marketAds",ap),{status:"active",updatedAt:serverTimestamp()});
toast("✓ Campanha aprovada — entrou na rotação do site.");
await loadAll();
}catch(err){error(err)}
return;
}
const ar=e.target.dataset.adcadReject;
if(ar){
const a=C.adcAds.find(x=>x.id===ar);
if(a&&!confirm('Rejeitar a campanha "'+(a.title||"")+'"? Ela não aparecerá no site.'))return;
try{
/* EncurtaNet: devolve o orçamento reservado e não utilizado antes de rejeitar */
if(a&&(Number(a.budgetReserved)||0)-(Number(a.budgetPaid)||0)-(Number(a.budgetRefunded)||0)>0){
 const refund=(Number(a.budgetReserved)||0)-(Number(a.budgetPaid)||0)-(Number(a.budgetRefunded)||0);
 await runTransaction(db,async tx=>{
  const ws=await tx.get(doc(db,"wallets",a.uid));
  const wd=ws.exists()?ws.data():{};
  tx.set(doc(db,"wallets",a.uid),{common:Math.max(0,Math.floor(Number(wd.common)||0))+refund,updatedAt:serverTimestamp()},{merge:true});
  tx.set(doc(collection(db,"wallets",a.uid,"history")),{kind:"ad_refund",amount:refund,ticketType:"common",reason:"Estorno: campanha '"+String(a.title||"").slice(0,40)+"' rejeitada — orçamento não utilizado devolvido",createdAt:serverTimestamp()});
  tx.update(doc(db,"marketAds",a.id),{status:"rejected",budgetRefunded:(Number(a.budgetRefunded)||0)+refund,refundedAt:serverTimestamp(),updatedAt:serverTimestamp()});
 });
 toast("Campanha rejeitada · "+fmtBRL(refund)+" de orçamento estornados ao anunciante.");
}else{
 await updateDoc(doc(db,"marketAds",ar),{status:"rejected",updatedAt:serverTimestamp()});
 toast("Campanha rejeitada.");
}
await loadAll();
}catch(err){error(err)}
return;
}
const ac=e.target.dataset.adcadClose;
if(ac){
const a=C.adcAds.find(x=>x.id===ac);
const left=a?Math.max(0,(Number(a.budgetReserved)||0)-(Number(a.budgetPaid)||0)-(Number(a.budgetRefunded)||0)):0;
if(!a)return;
if(!confirm("Encerrar a campanha '"+(a.title||"")+"' agora"+(left>0?" e devolver "+fmtBRL(left)+" reservados ao anunciante?":"?")))return;
try{
await runTransaction(db,async tx=>{
 const c=await tx.get(doc(db,"marketAds",ac));
 if(!c.exists())return;
 const cd=c.data();
 const refund=Math.max(0,(Number(cd.budgetReserved)||0)-(Number(cd.budgetPaid)||0)-(Number(cd.budgetRefunded)||0));
 if(refund>0){
  const ws=await tx.get(doc(db,"wallets",cd.uid));
  const wd=ws.exists()?ws.data():{};
  tx.set(doc(db,"wallets",cd.uid),{common:Math.max(0,Math.floor(Number(wd.common)||0))+refund,updatedAt:serverTimestamp()},{merge:true});
  tx.set(doc(collection(db,"wallets",cd.uid,"history")),{kind:"ad_refund",amount:refund,ticketType:"common",reason:"Estorno: campanha '"+String(cd.title||"").slice(0,40)+"' encerrada pela administração — orçamento restante devolvido",createdAt:serverTimestamp()});
 }
 tx.update(doc(db,"marketAds",ac),{status:"closed",budgetRefunded:(Number(cd.budgetRefunded)||0)+refund,refundedAt:serverTimestamp(),updatedAt:serverTimestamp()});
});
toast("Campanha encerrada"+(left>0?" · "+fmtBRL(left)+" estornados ao anunciante":"."));
await loadAll();
}catch(err){error(err)}
return;
}
const pv=e.target.dataset.adcadPrev;
if(pv){adcPreview(pv);return}
});
/* filtro por modalidade na tabela de campanhas */
$("adcTypeFilter").addEventListener("change",()=>renderAdc());

/* NAVEGAÇÃO */

function go(page){

currentPage=page;

document.querySelectorAll(".page").forEach(p=>p.hidden=true);
$("page-"+page).hidden=false;

document.querySelectorAll(".navbtn[data-page]").forEach(b=>{
b.classList.toggle("active",b.dataset.page===page);
});

const titles={
dashboard:"Visão geral",
settings:"Plataforma",
draws:"Sorteios",
events:"Eventos",
tasks:"Tarefas oficiais",
collab:"Tarefas dos colaboradores",
links:"Vínculos",
support:"Suporte ao cliente",
covers:"Capas do site",
auctions:"Leilões",
adc:"Central de Anúncios",
claims:"Solicitações",
disputes:"Disputas",
users:"Participantes",
results:"Resultados",
cofre:"Cofre Real",
pesq:"Pesquisas",
market:"Yshipp Market",
apps:"AppHub · Aplicativos",
pros:"Contrate um profissional",
feedback:"Gerenciamento de Feedback",
eventscenter:"Central de Eventos",
affiliates:"Central de Afiliados",
economy:"Economia (Reais)",
};

$("pageTitle").textContent=titles[page]||"Administração";

$("sidebar").classList.remove("open");
}

document.querySelectorAll("[data-page]").forEach(b=>{
b.onclick=()=>go(b.dataset.page);
});

document.querySelectorAll("[data-goto]").forEach(b=>{
b.onclick=()=>go(b.dataset.goto);
});

const sidebarEl=$("sidebar"),mobileMenuEl=$("mobileMenu"),navSearchEl=$("navSearch");
const navGroups=[...sidebarEl.querySelectorAll(":scope > .group")];
navGroups.forEach((group,index)=>{
 const heading=group.querySelector(".group-title");
 if(!heading)return;
 heading.tabIndex=0;heading.setAttribute("role","button");
 heading.setAttribute("aria-expanded",String(index===0));
 if(index>0)group.classList.add("nav-group-collapsed");
 const toggle=()=>{const collapsed=group.classList.toggle("nav-group-collapsed");heading.setAttribute("aria-expanded",String(!collapsed))};
 heading.addEventListener("click",toggle);
 heading.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle()}});
});
navSearchEl?.addEventListener("input",()=>{
 const q=navSearchEl.value.trim().toLocaleLowerCase("pt-BR");
 navGroups.forEach(group=>{
  const heading=group.querySelector(".group-title");
  const buttons=[...group.querySelectorAll(".navbtn[data-page]")];
  let found=0;
  buttons.forEach(button=>{const match=!q||button.textContent.toLocaleLowerCase("pt-BR").includes(q);button.hidden=!match;if(match)found++});
  group.hidden=!!q&&!found;
  if(q&&found){group.classList.remove("nav-group-collapsed");heading?.setAttribute("aria-expanded","true")}
  else if(!q){group.classList.toggle("nav-group-collapsed",navGroups.indexOf(group)>0);heading?.setAttribute("aria-expanded",String(navGroups.indexOf(group)===0))}
 });
});
mobileMenuEl.onclick=()=>sidebarEl.classList.toggle("open");
new MutationObserver(()=>{
 const open=sidebarEl.classList.contains("open");
 mobileMenuEl.setAttribute("aria-expanded",String(open));
 mobileMenuEl.setAttribute("aria-label",open?"Fechar navegação":"Abrir navegação");
}).observe(sidebarEl,{attributes:true,attributeFilter:["class"]});
document.addEventListener("keydown",e=>{
 if(e.key==="Escape"&&sidebarEl.classList.contains("open")){sidebarEl.classList.remove("open");mobileMenuEl.focus()}
});

/* no celular, tocar fora do menu o fecha */
document.addEventListener("click",e=>{
const sb=$("sidebar");
if(!sb.classList.contains("open"))return;
if(sb.contains(e.target)||e.target.closest("#mobileMenu"))return;
sb.classList.remove("open");
});

/* DASHBOARD */

function renderDashboard(){

$("statUsers").textContent=C.users.length;
$("statDraws").textContent=C.draws.length;
$("statTasks").textContent=C.tasks.length;

const pending=C.claims.filter(x=>x.status==="pending").length;

$("statClaims").textContent=pending;
$("pendingBadge").textContent=pending;

const recent=[...C.claims]
.filter(x=>x.status==="pending")
.sort((a,b)=>(stamp(b.submittedAt)||0)-(stamp(a.submittedAt)||0))
.slice(0,7);

$("recentClaims").innerHTML=recent.length?recent.map(c=>`
<tr>
<td>${esc(c.participantName||c.uid)}</td>
<td>${esc(C.tasks.find(t=>t.id===c.taskId)?.name||c.taskId)}</td>
<td><span class="status yellow">Pendente</span></td>
<td>${date(c.submittedAt)}</td>
</tr>
`).join(""):`<tr><td colspan="4" class="empty">Nenhuma solicitação pendente.</td></tr>`;

$("dashboardDraws").innerHTML=C.draws.slice(0,4).map(d=>`
<div class="item">
<h3>${esc(d.name)}</h3>
<p>${Number(d.totalNumbers)||0} números cadastrados</p>
<p>Status: ${esc(d.status||"Não definido")}</p>
</div>
`).join("")||'<div class="empty">Nenhum sorteio cadastrado.</div>';

}

/* MODAL */

function openModal(title,html){
$("modalTitle").textContent=title;
$("modalBody").innerHTML=html;
$("modal").hidden=false;
}

function closeModal(){
$("modal").hidden=true;
$("modalBody").innerHTML="";
}

$("modalClose").onclick=closeModal;

/* fechar com Esc ou clicando fora da caixa (padrão de usabilidade) */
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("modal").hidden)closeModal()});
$("modal").addEventListener("click",e=>{if(e.target===$("modal"))closeModal()});

$("modal").onclick=e=>{
if(e.target===$("modal"))closeModal();
};

/* EDITOR GENÉRICO */

function editor(title,data,fields,save,extra){

const inputs=fields.map(f=>{

let value=data?.[f.key]??f.default??"";

if(f.type==="date"){
value=dateInput(value);
}

if(f.type==="select"){
return `
<div class="field">
<label>${f.label}</label>
<select id="edit_${f.key}">
${f.options.map(o=>{const val=o?.value??o;const lab=o?.label??o;return `<option value="${esc(val)}" ${String(value)===String(val)?"selected":""}>${esc(lab)}</option>`}).join("")}
</select>
</div>`;
}

if(f.type==="textarea"){
return `
<div class="field">
<label>${f.label}</label>
<textarea id="edit_${f.key}">${esc(value)}</textarea>
</div>`;
}

return `
<div class="field">
<label>${f.label}</label>
<input id="edit_${f.key}" type="${f.type==="date"?"datetime-local":(f.type||"text")}" value="${esc(value)}" ${f.step?`step="${f.step}"`:""}>
</div>`;

}).join("");

openModal(title,`
<div class="form-grid">${inputs}</div>
${extra&&extra.html?extra.html:""}
<div class="actions">
<button class="btn" id="editorSave">Salvar alterações</button>
<button class="btn secondary" id="editorCancel">Cancelar</button>
</div>
`);

if(extra&&extra.bind)extra.bind();

$("editorCancel").onclick=closeModal;

$("editorSave").onclick=async()=>{

const result={};

for(const f of fields){

const el=$("edit_"+f.key);
let v=el.value;

if(f.type==="number"){
v=Number(v);
if(!Number.isFinite(v))return toast("Número inválido: "+f.label);
}

if(f.type==="date"){
v=toTimestamp(v);
}

if(f.type==="checkbox"){
v=el.checked;
}

if(f.type==="url"&&v&&!validUrl(v)){
return toast("URL inválida: "+f.label);
}

result[f.key]=v;
}

if(extra&&extra.collect){
Object.assign(result,extra.collect());
}

try{
await save(result);
closeModal();
await loadAll();
toast("Alterações salvas.");
}catch(e){error(e)}

};

}

/* SORTEIOS */

const drawFields=[
{key:"name",label:"Nome do sorteio"},
{key:"description",label:"Descrição",type:"textarea"},
{key:"imageUrl",label:"Imagem (URL)",type:"url"},
{key:"totalNumbers",label:"Quantidade de números",type:"number",default:150},
{key:"ticketCost",label:"Custo por número (R$)",type:"number",default:1},
{key:"status",label:"Status",type:"select",options:["draft","open","paused","ended"]},
{key:"startAt",label:"Data de abertura",type:"date"},
{key:"endAt",label:"Data de encerramento",type:"date"},
{key:"drawDate",label:"Data da apuração",type:"date"},
{key:"rules",label:"Regulamento",type:"textarea"}
];

function renderDraws(){

$("drawList").innerHTML=C.draws.map(d=>{
const ev=C.events.find(x=>x.id===d.eventId);
return `
<div class="item">
<h3>${esc(d.name)}</h3>
<p>${esc(d.description||"")}</p>
<p>${Number(d.totalNumbers)||0} números · ${Number(d.ticketCost)||1} ponto(s) por número${ev?" · Evento: "+esc(ev.name):""}</p>
<p>Prêmios vinculados a este sorteio: <b>${(Array.isArray(d.prizes)?d.prizes.filter(x=>x&&x.name).length:0)}</b>${(Array.isArray(d.prizes)&&d.prizes.length)?" · "+d.prizes.filter(x=>x&&x.name).map(x=>esc(x.name)).join(", "):""}${(Array.isArray(d.prizes)?d.prizes.filter(x=>x&&x.name).length:0)?"":' · <span class="status red">sem prêmios — edite o sorteio e vincule os prêmios</span>'}</p>
<p>Status: <span class="status ${d.status==="open"?"green":"yellow"}">${esc(d.status)}</span></p>
<div class="actions">
<button class="btn small" data-edit-draw="${esc(d.id)}">Editar</button>
<button class="btn secondary small" data-copy-draw="${esc(d.id)}">Duplicar</button>
<button class="btn danger small" data-del-draw="${esc(d.id)}">Excluir</button>
</div>
</div>
`;}).join("")||'<div class="empty">Nenhum sorteio cadastrado.</div>';

}

function editDraw(d=null){

/* prêmios editados DENTRO do sorteio: ficam salvos no campo "prizes" do próprio sorteio */
const prizeArr=Array.isArray(d?.prizes)?d.prizes.filter(x=>x&&x.name).map(x=>({name:x.name||"",type:x.type||"money",value:x.value||""})):[];

const prizeRow=(x,i)=>`
<div class="item" style="margin-bottom:10px">
<div class="form-grid">
<div class="field">
<label>Nome do prêmio</label>
<input data-dpname="${i}" value="${esc(x.name)}" placeholder="Ex.: Samsung S27 Ultra + Fone Buds Pro">
</div>
<div class="field">
<label>Tipo do prêmio</label>
<select data-dptype="${i}">
${Object.entries(PRIZE_TYPES).map(([k,v])=>`<option value="${k}"${x.type===k?" selected":""}>${v}</option>`).join("")}
</select>
</div>
</div>
<div class="field">
<label>Valor / descrição</label>
<input data-dpvalue="${i}" value="${esc(x.value)}" placeholder="Ex.: R$ 6.499,00 · Black Friday">
</div>
<div class="actions">
<button class="btn danger small" data-dpdel="${i}">Remover este prêmio</button>
</div>
</div>`;

editor(d?"Editar sorteio":"Novo sorteio",d,[...drawFields,{
key:"eventId",
label:"Evento do sorteio (entrada do evento é exigida no site)",
type:"select",
options:[{value:"",label:"— sem evento —"},...C.events.map(e=>({value:e.id,label:e.name}))]
}],async v=>{

if(!v.name.trim())throw new Error("Informe o nome do sorteio.");
if(v.totalNumbers<1||v.totalNumbers>1000000)throw new Error("Quantidade de números inválida.");

v.ticketCost=Math.max(1,Math.floor(v.ticketCost)||1);
v.prizes=prizeArr.filter(x=>x.name.trim());

const id=d?.id||"draw_"+Date.now();

await setDoc(doc(db,"draws",id),{
...v,
updatedAt:serverTimestamp(),
...(d?{}:{createdAt:serverTimestamp()})
},{merge:true});

if(!v.prizes.length)toast("Sorteio salvo sem prêmios — cadastre os prêmios antes de abrir para os participantes.");

},{
html:`
<h3 style="margin:16px 0 4px"><i class=yi data-i=gift></i> Prêmios vinculados a este sorteio</h3>
<p class="hint" style="margin:0 0 10px">Cada prêmio pertence a este sorteio e aparece no site junto com ele: na seção "Prêmios", no card do sorteio e no comprovante oficial do participante. No sorteio automático, os prêmios são distribuídos aleatoriamente entre os números reservados.</p>
<div id="dPrizes"></div>
<button class="btn secondary small" id="dPrizeAdd">+ Adicionar prêmio neste sorteio</button>`,
bind(){
const render=()=>{
$("dPrizes").innerHTML=prizeArr.length?prizeArr.map(prizeRow).join(""):'<p class="hint">Nenhum prêmio vinculado ainda. Adicione os prêmios deste sorteio.</p>';
};
render();
$("dPrizeAdd").onclick=()=>{prizeArr.push({name:"",type:"money",value:""});render()};
$("dPrizes").addEventListener("input",e=>{
const t=e.target;
const i=Number(t.dataset.dpname??t.dataset.dptype??t.dataset.dpvalue);
if(t.dataset.dpname!==undefined)prizeArr[i].name=t.value;
if(t.dataset.dptype!==undefined)prizeArr[i].type=t.value;
if(t.dataset.dpvalue!==undefined)prizeArr[i].value=t.value;
});
$("dPrizes").addEventListener("click",e=>{
const del=e.target.dataset.dpdel;
if(del!==undefined){prizeArr.splice(Number(del),1);render()}
});
}
});

}

$("newDraw").onclick=()=>editDraw();

$("drawList").onclick=async e=>{

const edit=e.target.dataset.editDraw;
const del=e.target.dataset.delDraw;
const copy=e.target.dataset.copyDraw;

if(edit)return editDraw(C.draws.find(x=>x.id===edit));

if(copy){
const d=C.draws.find(x=>x.id===copy);
if(!d)return;
const {id,...data}=d;
await addDoc(collection(db,"draws"),{
...data,
name:data.name+" (cópia)",
status:"draft",
createdAt:serverTimestamp()
});
await loadAll();
return toast("Sorteio duplicado como rascunho.");
}

if(del){
if(!confirm("Excluir este sorteio? As reservas e entradas não serão apagadas automaticamente."))return;
try{
await deleteDoc(doc(db,"draws",del));
await loadAll();
toast("Sorteio excluído.");
}catch(e){error(e)}
}

};

/* EVENTOS */

const eventFields=[
{key:"name",label:"Nome do evento"},
{key:"description",label:"Descrição",type:"textarea"},
{key:"imageUrl",label:"Imagem",type:"url"},
{key:"link",label:"Link do evento",type:"url"},
{key:"coupon",label:"Cupom"},
{key:"ticketsOffered",label:"Valor anunciado (R$)",type:"number",default:0},
{key:"entryCost",label:"Custo de entrada (R$)",type:"number",default:0},
{key:"active",label:"Ativo",type:"select",options:["true","false"]},
{key:"startAt",label:"Início",type:"date"},
{key:"endAt",label:"Encerramento",type:"date"},
{key:"rules",label:"Regras",type:"textarea"}
];

function renderEvents(){

$("eventList").innerHTML=C.events.map(e=>{
const nd=C.draws.filter(d=>d.eventId===e.id).length;
const na=C.auctions.filter(a=>a.eventId===e.id).length;
const cost=Math.max(0,Math.floor(Number(e.entryCost)||0));
return `
<div class="item">
<h3>${esc(e.name)}</h3>
<p>${esc(e.description||"")}</p>
<p>Sorteios: ${nd} · Leilões: ${na} · Entrada: ${cost?cost+" ponto(s)":"gratuita"}</p>
<p><i class=yi data-i=calendar></i> Início: ${date(e.startAt)} · Encerramento: ${e.endAt?date(e.endAt):"sem prazo"}</p>
<p>Como aparece no site: ${evStateBadge(e)}</p>
<div class="actions">
<button class="btn small" data-event-edit="${esc(e.id)}">Editar</button>
<button class="btn danger small" data-event-del="${esc(e.id)}">Excluir</button>
</div>
</div>
`;}).join("")||'<div class="empty">Nenhum evento.</div>';

}

function editEvent(e=null){

editor(e?"Editar evento":"Novo evento",e,eventFields,async v=>{

if(!v.name.trim())throw new Error("Informe o nome.");

v.active=v.active==="true";
v.entryCost=Math.max(0,Math.floor(Number(v.entryCost)||0));

await setDoc(doc(db,"events",e?.id||"event_"+Date.now()),{
...v,
updatedAt:serverTimestamp(),
...(e?{}:{createdAt:serverTimestamp()})
},{merge:true});

});

}

$("newEvent").onclick=()=>editEvent();

$("eventList").onclick=async e=>{

if(e.target.dataset.eventEdit){
editEvent(C.events.find(x=>x.id===e.target.dataset.eventEdit));
}

if(e.target.dataset.eventDel){
const id=e.target.dataset.eventDel;
if(!confirm("Excluir este evento?"))return;
try{
await deleteDoc(doc(db,"events",id));
await loadAll();
toast("Evento excluído.");
}catch(e){error(e)}
}

};

/* TAREFAS · motor completo de tarefas e ofertas */


/* limites de vagas das tarefas — editáveis em Plataforma / Economia se existir; padrão 25–500 */
function stockBounds(){
  const s=C.taskLimits||{};
  const min=Math.max(1,Math.floor(Number(s.minStock)||25));
  const max=Math.max(min,Math.floor(Number(s.maxStock)||500));
  return {min,max};
}
function clampStock(n){
  const b=stockBounds();
  const v=Math.floor(Number(n));
  if(!Number.isFinite(v))return b.min;
  return Math.min(b.max,Math.max(b.min,v));
}

const TASK_CATS={
social:{label:"Rede social",icon:"<i class=yi data-i=mobile></i>"},
signup:{label:"Cadastro / criar conta",icon:"<i class=yi data-i=note></i>"},
survey:{label:"Pesquisa / enquete",icon:"<i class=yi data-i=chart></i>"},
video:{label:"Assistir vídeo",icon:"<i class=yi data-i=video></i>"},
app:{label:"Instalar app / jogo",icon:"<i class=yi data-i=mobile></i>"},
purchase:{label:"Compra / cashback",icon:"<i class=yi data-i=cart></i>"},
referral:{label:"Indicação de amigos",icon:"<i class=yi data-i=handshake></i>"},
content:{label:"Criar conteúdo",icon:"<i class=yi data-i=edit></i>"},
other:{label:"Outra",icon:"<i class=yi data-i=bolt></i>"}
};

const PROOF_TYPES={text:"Texto / descrição",link:"Link (URL)",code:"Código do comprovante",name:"Nome do participante",email:"E-mail usado na tarefa"};

/* ============================================================
   CATÁLOGO DE TAREFAS (categorias e serviços com recompensa-base
   e dificuldade). Editável no painel (seção "Catálogo de tarefas")
   e salvo no Firestore em settings/taskCatalog — o site lê o
   mesmo documento para exibir categoria e tarefa no card.
   ============================================================ */
const DIFFS={simple:{label:"Simples",dot:"<span class=sdotg></span>"},medium:{label:"Intermediário",dot:"<span class=sdoty></span>"},hard:{label:"Avançado",dot:"<span class=sdotr></span>"}};
const DIFF_MIN={simple:1,medium:2,hard:2}; /* mínimo de provas sugerido por dificuldade */
const PROOF_REQ_LABELS={text:"<i class=yi data-i=note></i> Texto",code:"<i class=yi data-i=key></i> Código / cupom",image:"<i class=yi data-i=image></i> Print (link da imagem)",video:"<i class=yi data-i=video></i> Gravação de tela (link)",datetime:"<i class=yi data-i=clock></i> Data e hora"};
const DEFAULT_CATALOG={categories:[
{id:"signup",label:"Inscrições e cadastros",icon:"<i class=yi data-i=note></i>",services:[
 {id:"email_only",label:"Somente envio de e-mail",reward:15,difficulty:"simple",ticketType:"common"},
 {id:"signup_simple",label:"Cadastro simples",reward:15,difficulty:"simple",ticketType:"common"},
 {id:"signup_complex",label:"Inscrição complexa",reward:30,difficulty:"medium",ticketType:"common"}]},
{id:"facebook",label:"Facebook",icon:"<i class=yi data-i=thumbsup></i>",services:[
 {id:"fb_like_post",label:"Dar curtida em uma publicação",reward:2,difficulty:"simple",ticketType:"common"},
 {id:"fb_like_10",label:"Curtir 10 postagens",reward:20,difficulty:"simple",ticketType:"common"},
 {id:"fb_like_page",label:"Curtir uma página",reward:5,difficulty:"simple",ticketType:"common"},
 {id:"fb_share_feed",label:"Compartilhar publicação no Feed",reward:20,difficulty:"simple",ticketType:"common"},
 {id:"fb_share_groups",label:"Compartilhar em grupos relacionados",reward:25,difficulty:"medium",ticketType:"common"},
 {id:"fb_add_friend",label:"Adicionar como amigo",reward:2,difficulty:"simple",ticketType:"common"},
 {id:"fb_join_group",label:"Entrar em um grupo",reward:1,difficulty:"simple",ticketType:"common"},
 {id:"fb_react_emoji",label:"Reagir com emoji específico",reward:1,difficulty:"simple",ticketType:"common"},
 {id:"fb_wall_post",label:"Publicar no Mural",reward:250,difficulty:"medium",ticketType:"common"},
 {id:"fb_like_comment_wall",label:"Curtir + comentar + publicar no Mural",reward:30,difficulty:"medium",ticketType:"common"},
 {id:"fb_invite_friends",label:"Convidar amigos para curtir uma página",reward:50,difficulty:"simple",ticketType:"common"}]},
{id:"instagram",label:"Instagram",icon:"<i class=yi data-i=camera></i>",services:[
 {id:"ig_follow",label:"Seguir um perfil",reward:1,difficulty:"simple",ticketType:"common"},
 {id:"ig_like",label:"Curtir uma publicação",reward:1,difficulty:"simple",ticketType:"common"},
 {id:"ig_comment",label:"Fazer um comentário",reward:3,difficulty:"simple",ticketType:"common"},
 {id:"ig_pack",label:"Seguir + curtir + comentar",reward:35,difficulty:"medium",ticketType:"gold"}]},
{id:"apps",label:"Aplicativos Mobile",icon:"<i class=yi data-i=mobile></i>",services:[
 {id:"app_download",label:"Somente download",reward:20,difficulty:"simple",ticketType:"common"},
 {id:"app_full",label:"Baixar + instalar + testar + avaliação",reward:40,difficulty:"medium",ticketType:"common"}]},
{id:"telegram",label:"Telegram",icon:"<i class=yi data-i=send></i>",services:[
 {id:"tg_bot",label:"Entrar em um bot",reward:4,difficulty:"simple",ticketType:"common"},
 {id:"tg_airdrop",label:"Airdrop simples",reward:8,difficulty:"medium",ticketType:"common"}]},
{id:"tiktok",label:"TikTok",icon:"<i class=yi data-i=music></i>",services:[
 {id:"tt_pack",label:"Assistir + curtir + comentar + compartilhar",reward:10,difficulty:"medium",ticketType:"common"}]},
{id:"youtube",label:"YouTube",icon:"▶",services:[
 {id:"yt_watch6",label:"Assistir a um vídeo de 6 minutos",reward:5,difficulty:"simple",ticketType:"gold"},
 {id:"yt_subscribe",label:"Inscrever-se no canal",reward:5,difficulty:"simple",ticketType:"common"}]},
{id:"seo",label:"SEO e divulgação na internet",icon:"<i class=yi data-i=search></i>",services:[
 {id:"seo_once",label:"SEO + promover conteúdo + engajar uma vez",reward:2,difficulty:"simple",ticketType:"common"},
 {id:"seo_five",label:"SEO + promover conteúdo + 5 tarefas extensas",reward:10,difficulty:"medium",ticketType:"common"}]}
]};
let catalog=DEFAULT_CATALOG;
let catDraft=null; /* cópia de trabalho do editor de catálogo */
const catList=()=>Array.isArray(catalog?.categories)?catalog.categories:[];
const catOf=id=>catList().find(c=>c.id===id)||null;
const svcOf=(cid,sid)=>catOf(cid)?.services?.find(s=>s.id===sid)||null;
const catLabel=id=>{const c=catOf(id);if(c)return c.label;return TASK_CATS[id]?.label||id||"—"};
const catIcon=id=>{const c=catOf(id);if(c)return c.icon||"<i class=yi data-i=target></i>";return TASK_CATS[id]?.icon||"<i class=yi data-i=target></i>"};
const diffKey=v=>{const k=String(v||"").toLowerCase();if(k==="medium"||k==="intermediario"||k==="intermediário"||k.includes("méd")||k.includes("med"))return"medium";if(k==="hard"||k==="difícil"||k==="dificil"||k.includes("dif"))return"hard";return"simple"};
const diffOf=v=>DIFFS[diffKey(v)];

/* ---- editor do catálogo (categorias + serviços editáveis) ---- */
function renderCatalog(){
 if(!catDraft)catDraft=JSON.parse(JSON.stringify(catalog));
 if(!Array.isArray(catDraft.categories))catDraft.categories=[];
 const root=$("catalogEditor");if(!root)return;
 root.innerHTML=catDraft.categories.map((c,ci)=>`
 <div class="proof-block" style="margin-bottom:10px">
  <div class="form-grid">
   <div class="field" style="margin:0"><label>Categoria ${ci+1}</label><input data-catlabel="${ci}" value="${esc(c.label||"")}" placeholder="Ex.: Facebook"></div>
   <div class="field" style="margin:0"><label>Ícone</label><input data-caticon="${ci}" value="${esc(c.icon||"")}" placeholder="Ex.: ícone (SVG)"></div>
  </div>
  <div style="margin-top:10px">
  ${(c.services||[]).map((s,si)=>`
  <div class="proof-block" style="margin-bottom:8px">
   <div class="form-grid">
    <div class="field" style="margin:0"><label>Serviço / tarefa</label><input data-svclabel="${ci}_${si}" value="${esc(s.label||"")}" placeholder="Ex.: Curtir uma publicação"></div>
    <div class="field" style="margin:0"><label>Valor (R$)</label><input type="number" min="0.01" step="0.01" data-svcreward="${ci}_${si}" value="${(Math.max(0.01,Number(s.reward)||0.01)).toFixed(2)}"></div>
    <div class="field" style="margin:0"><label>Tipo de saldo</label><select data-svctype="${ci}_${si}">${["common","gold","vip"].map(k=>`<option value="${k}"${(s.ticketType||"common")===k?" selected":""}>${k}</option>`).join("")}</select></div>
    <div class="field" style="margin:0"><label>Dificuldade</label><select data-svcdiff="${ci}_${si}">${Object.entries(DIFFS).map(([k,v])=>`<option value="${k}"${diffKey(s.difficulty)===k?" selected":""}>${v.dot} ${v.label}</option>`).join("")}</select></div>
   </div>
   <button class="btn danger small" data-svcdel="${ci}_${si}" style="margin-top:6px">Remover serviço</button>
  </div>`).join("")||'<p class="hint" style="margin:0">Nenhum serviço nesta categoria ainda.</p>'}
  </div>
  <div class="actions">
   <button class="btn secondary small" data-svcadd="${ci}">+ Novo serviço nesta categoria</button>
   <button class="btn danger small" data-catdel="${ci}">Excluir categoria</button>
  </div>
 </div>`).join("")||'<div class="empty">Nenhuma categoria. Clique em "+ Nova categoria".</div>';
}
function collectCatalog(){
 const root=$("catalogEditor");
 const cats=[...root.querySelectorAll("[data-catlabel]")].map((el,ci)=>{
  const iconEl=root.querySelector(`[data-caticon="${ci}"]`);
  const services=[...root.querySelectorAll("[data-svclabel]")].filter(x=>String(x.dataset.svclabel).startsWith(ci+"_")).map(x=>{
   const si=String(x.dataset.svclabel).split("_")[1];
   return {
    label:x.value.trim(),
    reward:Math.max(0.01,Math.round((Number(root.querySelector(`[data-svcreward="${ci}_${si}"]`)?.value)||0.01)*100)/100),
    ticketType:root.querySelector(`[data-svctype="${ci}_${si}"]`)?.value||"common",
    difficulty:root.querySelector(`[data-svcdiff="${ci}_${si}"]`)?.value||"simple"
   };
  }).filter(s=>s.label);
  return {
   id:(catDraft.categories[ci]&&catDraft.categories[ci].id)||("cat_"+Date.now()+"_"+ci),
   label:el.value.trim(),
   icon:(iconEl&&iconEl.value.trim())||"<i class=yi data-i=target></i>",
   services
  };
 }).filter(c=>c.label);
 return {categories:cats,updatedAt:new Date().toISOString()};
}
if($("catalogEditor")){
 $("catalogEditor").addEventListener("click",e=>{
  const add=e.target.dataset.svcadd;
  const sd=e.target.dataset.svcdel;
  const cd=e.target.dataset.catdel;
  if(add!==undefined){const ci=Number(add);catDraft.categories[ci].services=catDraft.categories[ci].services||[];catDraft.categories[ci].services.push({id:"svc_"+Date.now(),label:"",reward:1,difficulty:"simple",ticketType:"common"});renderCatalog()}
  if(sd!==undefined){const parts=String(sd).split("_");catDraft.categories[Number(parts[0])].services.splice(Number(parts[1]),1);renderCatalog()}
  if(cd!==undefined){if(confirm("Excluir esta categoria e seus serviços?")){catDraft.categories.splice(Number(cd),1);renderCatalog()}}
 });
 $("newCat").onclick=()=>{catDraft.categories.push({id:"cat_"+Date.now(),label:"Nova categoria",icon:"<i class=yi data-i=target></i>",services:[{id:"svc_"+Date.now(),label:"Novo serviço",reward:1,difficulty:"simple",ticketType:"common"}]});renderCatalog()};
 $("catReset").onclick=()=>{if(confirm("Restaurar o catálogo padrão? As alterações não salvas serão perdidas.")){catDraft=JSON.parse(JSON.stringify(DEFAULT_CATALOG));renderCatalog()}};
 $("saveCatalog").onclick=async()=>{
  catDraft=collectCatalog();
  if(!catDraft.categories.length)return toast("Cadastre ao menos uma categoria.");
  try{
   await setDoc(doc(db,"settings","taskCatalog"),catDraft,{merge:true});
   catalog=catDraft;
   catDraft=JSON.parse(JSON.stringify(catalog));
   renderTasks();
   toast("Catálogo salvo — o formulário guiado e o site já usam a nova versão.");
  }catch(e){error(e)}
 };
}

function taskState(t){
const n=Date.now();
const s=stamp(t.startAt)?stamp(t.startAt).getTime():0;
const e=t.endAt&&stamp(t.endAt)?stamp(t.endAt).getTime():Infinity;
if(t.active===false)return"off";
if(t.stock>0&&Number.isFinite(Number(t.stockLeft))&&Math.floor(Number(t.stockLeft))<=0)return"stockout";
if(s>0&&n<s)return"future";
if(n>=e)return"ended";
return"on";
}

function taskStateBadge(t){
const st=taskState(t);
if(st==="on")return'<span class="status green">Ativa no site</span>';
if(st==="future")return'<span class="status yellow">Em breve · abre '+date(t.startAt)+'</span>';
if(st==="ended")return'<span class="status red">Encerrada'+(t.endAt?" · "+date(t.endAt):"")+'</span>';
if(st==="stockout")return'<span class="status red">Estoque esgotado</span>';
return'<span class="status">Pausada (oculta do site)</span>';
}

/* vagas restantes: nunca maior que o total (corrige exibições tipo "400 de 200") */
const stockLeft=t=>{
 if(!(Number(t?.stock)>0))return null;
 const total=Math.max(0,Math.floor(Number(t.stock)));
 const left=Number.isFinite(Number(t.stockLeft))?Math.floor(Number(t.stockLeft)):total;
 return Math.max(0,Math.min(total,left));
};

const taskFields=[
{key:"name",label:"Nome da tarefa"},
{key:"category",label:"Categoria",type:"select",options:Object.keys(TASK_CATS)},
{key:"description",label:"Descrição",type:"textarea"},
{key:"rules",label:"Regras / instruções",type:"textarea"},
{key:"imageUrl",label:"Imagem (URL)",type:"url"},
{key:"link",label:"Link da tarefa",type:"url"},
{key:"coupon",label:"Cupom"},
{key:"reward",label:"Recompensa em reais (R$) — use 0,40 etc.",type:"number",default:0.01},
{key:"ticketType",label:"Tipo de saldo",type:"select",options:["common","gold","vip"]},
{key:"difficulty",label:"Dificuldade",type:"select",options:["Fácil","Médio","Difícil"]},
{key:"requiresProof",label:"Exige comprovante",type:"select",options:["true","false"]},
{key:"proofType",label:"Tipo de comprovante",type:"select",options:Object.keys(PROOF_TYPES)},
{key:"proofDetails",label:"Detalhes da prova (explicação que o participante verá no site)",type:"textarea"},
{key:"autoApprove",label:"Aprovação automática (credita sem análise)",type:"select",options:["false","true"]},
{key:"stock",label:"Estoque / vagas (padrão 25–500 · editável em limites)",type:"number",default:1},
{key:"dailyLimit",label:"Limite diário de aprovações (0 = sem limite)",type:"number",default:0},
{key:"badge",label:"Selo curto no card (ex.: NOVA, QUENTE)"},
{key:"featured",label:"Destaque no topo das Ofertas",type:"select",options:["false","true"]},
{key:"priority",label:"Prioridade (maior aparece primeiro)",type:"number",default:0},
{key:"showInOffers",label:"Publicar na seção Ofertas do site",type:"select",options:["true","false"],default:"false"},
{key:"active",label:"Ativa",type:"select",options:["true","false"]},
{key:"eventId",label:"Evento da tarefa",type:"select",options:[{value:"",label:"— Oferta avulsa (aparece em Ofertas) —"},...C.events.map(e=>({value:e.id,label:e.name}))]},
{key:"startAt",label:"Início",type:"date"},
{key:"endAt",label:"Encerramento",type:"date"}
];

function taskStats(){
const pending=C.claims.filter(c=>c.status==="pending").length;
const st=[["Total de tarefas",C.tasks.length,""],["Ativas agora",C.tasks.filter(t=>taskState(t)==="on").length,"green"],["Publicadas nas Ofertas",C.tasks.filter(t=>t.showInOffers===true).length,"gold"],["Solicitações pendentes",pending,"red"]];
$("taskStats").innerHTML=st.map(([l,v,c])=>`<div class="card"><div class="stat-label">${l}</div><div class="stat-value ${c}">${v}</div></div>`).join("");
}

function taskFilters(){
const f=$("taskFilter").value||"all";
const q=($("taskSearch").value||"").toLowerCase().trim();
const ty=$("taskTypeFilter").value||"";
const cat=$("taskCatFilter").value||"";
return C.tasks.filter(t=>{
if(q&&!String(t.name||"").toLowerCase().includes(q)&&!String(t.description||"").toLowerCase().includes(q))return false;
if(ty&&t.ticketType!==ty)return false;
if(cat&&(t.category||"other")!==cat)return false;
const st=taskState(t);
if(f==="offers")return t.showInOffers===true;
if(f==="collab")return t.source==="collab";
if(f==="events")return!!t.eventId;
if(f==="pending")return C.claims.some(c=>c.taskId===t.id&&c.status==="pending");
if(f==="stockout")return st==="stockout";
if(f==="all")return true;
return st===f;
}).sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0)||((b.featured===true)-(a.featured===true))||String(a.name||"").localeCompare(String(b.name||"")));
}

function renderTasks(){

taskStats();
const catSel=$("taskCatFilter");
const cats=[...new Set([...catList().map(c=>c.id),...C.tasks.map(t=>t.category||"other")])];
if(catSel.options.length-1!==cats.length){
catSel.innerHTML='<option value="">Todas</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(catLabel(c))}</option>`).join("");
}

$("taskList").innerHTML=taskFilters().map(t=>{
const cl=C.claims.filter(c=>c.taskId===t.id);
const pen=cl.filter(c=>c.status==="pending").length;
const ok=cl.filter(c=>c.status==="approved").length;
const rej=cl.filter(c=>c.status==="rejected").length;
const left=stockLeft(t);
const ev=C.events.find(x=>x.id===t.eventId);
const cat={icon:catIcon(t.category),label:catLabel(t.category)};
const svc=t.serviceLabel||svcOf(t.category,t.serviceId)?.label||"";
const diff=diffOf(t.difficulty);
const pr=t.proofReq||null;
const prTypes=pr?Object.keys(pr).filter(k=>pr[k]).map(k=>PROOF_REQ_LABELS[k]||k):null;
const minP=prTypes&&prTypes.length?Math.max(1,Math.floor(Number(t.minProofs)||1)):0;
const steps=Array.isArray(t.steps)?t.steps.filter(x=>String(x||"").trim()).length:0;
return `
<div class="item">
<div style="display:flex;gap:10px;align-items:flex-start">
<input type="checkbox" data-task-check="${esc(t.id)}" style="width:18px;min-width:18px;height:18px;margin-top:3px">
<div style="min-width:0;flex:1">
<h3>${cat.icon} ${esc(t.name)} ${t.source==="collab"?`<span class="status yellow"><i class=yi data-i=handshake></i> Colaborador${t.ownerName?" · "+esc(t.ownerName):""}</span>`:""} ${t.source==="collab"&&t.collabStatus==="pending"?'<span class="status yellow">Aguardando aprovação de parceiro</span>':""} ${t.badge?`<span class="status yellow">${esc(t.badge)}</span>`:""} ${t.featured===true?'<span class="status yellow">★ Destaque</span>':""}</h3>
<p>${esc(t.description||"")}</p>
<p>Categoria: ${esc(cat.label)}${svc?" · Serviço: <b>"+esc(svc)+"</b>":""} · Recompensa: <b>${Number(t.reward)||1} ${esc(t.ticketType||"common")}</b> · Dificuldade: ${diff.dot} ${esc(diff.label)}${steps?" · Etapas: "+steps:""}</p>
<p>Comprovante: ${t.requiresProof===false?"não exige":prTypes?esc(prTypes.join(", "))+" · mínimo <b>"+minP+"</b> prova(s)":esc(PROOF_TYPES[t.proofType||"text"]||"texto")} · Aprovação: ${t.autoApprove===true?'<span class="status green">automática</span>':"manual"}</p>
${t.proofDetails?`<p style="border-left:3px solid var(--gold);padding-left:8px;color:var(--mu)"><b style="color:var(--ink)">Detalhes da prova no site:</b> ${esc(t.proofDetails)}</p>`:'<p><i style="color:var(--mu)">(sem detalhes da prova — o participante não verá instruções extras)</i></p>'}
<p>Publicação: ${t.showInOffers===true?'<span class="status green">Ofertas do site</span>':"—"} ${ev?" · Evento: "+esc(ev.name):" · Sem evento"} · Prioridade: ${Number(t.priority)||0}</p>
<p>Vagas: ${t.stock>0?`<b>${left}</b> de ${t.stock} restantes`:"ilimitadas"} ${t.dailyLimit>0?" · Limite diário: "+t.dailyLimit+" aprovação(ões)":""}</p>
<p><i class=yi data-i=calendar></i> ${date(t.startAt)} → ${t.endAt?date(t.endAt):"sem prazo"}</p>
<p>Solicitações: <b class="red">${pen} pendente(s)</b> · ${ok} aprovada(s) · ${rej} rejeitada(s) · Reais distribuídos: <b>${fmtBRL(ok*(Number(t.reward)||1))}</b></p>
<p>Como aparece no site: ${taskStateBadge(t)}</p>
</div>
</div>
<div class="actions">
${t.source==="collab"&&t.collabStatus==="pending"?`<button class="btn small" data-task-collab="${esc(t.id)}"><i class=yi data-i=handshake></i> Aprovar parceiro (publicar)</button>`:""}
<button class="btn small" data-task-edit="${esc(t.id)}">Editar</button>
<button class="btn secondary small" data-task-toggle="${esc(t.id)}">${t.active===false?"Ativar":"Pausar"}</button>
<button class="btn ${t.showInOffers===true?"secondary":"success"} small" data-task-offer="${esc(t.id)}">${t.showInOffers===true?"Retirar das Ofertas":"Publicar nas Ofertas"}</button>
<button class="btn secondary small" data-task-up="${esc(t.id)}">↑</button>
<button class="btn secondary small" data-task-down="${esc(t.id)}">↓</button>
<button class="btn secondary small" data-task-claims="${esc(t.id)}">Solicitações${pen?` (${pen})`:""}</button>
<button class="btn secondary small" data-task-preview="${esc(t.id)}">Pré-visualizar</button>
<button class="btn secondary small" data-task-copy="${esc(t.id)}">Duplicar</button>
${validUrl(t.link)?`<a class="btn secondary small" href="${esc(t.link)}" target="_blank" rel="noopener">Abrir link</a>`:""}
<button class="btn danger small" data-task-del="${esc(t.id)}">Excluir</button>
</div>
</div>`;
}).join("")||'<div class="empty">Nenhuma tarefa encontrada com os filtros atuais.</div>';

}

/* ============================================================
   FORMULÁRIO GUIADO DE 4 ETAPAS · criação/edição de tarefas
   1) Serviço (categoria + subcategoria do catálogo)
   2) Missão (descrição, membros, etapas)
   3) Prova de execução (tipos exigidos + mínimo por dificuldade)
   4) Resumo e publicação
   ============================================================ */
function taskWizard(t=null){

const isEdit=!!t;
const legacyCats=[...new Set(C.tasks.map(x=>x.category).filter(x=>x&&!catOf(x)))];
const catOpts=[...catList().map(c=>({value:c.id,label:c.label})),...legacyCats.map(c=>({value:c,label:catLabel(c)+" (antiga)"}))];
const tSteps=(Array.isArray(t?.steps)?t.steps.map(s=>String(s||"")):[]).filter(s=>s.trim());
const pr=t?.proofReq||{};
const tMin=Math.max(1,Math.floor(Number(t?.minProofs)||1));
const tDiff=diffKey(t?.difficulty);

openModal((isEdit?"Editar tarefa":"Nova tarefa")+" · formulário guiado",`
<div class="wiz">
 <div class="wiz-steps" id="wizSteps">
  <span class="on">1 · Serviço</span><span>2 · Missão</span><span>3 · Prova</span><span>4 · Resumo</span>
 </div>

 <div class="wiz-step" id="wiz1">
  <div class="form-grid">
   <div class="field" style="margin:0"><label>1) Categoria do serviço *</label>
    <select id="w1cat"><option value="">— escolha —</option>${catOpts.map(o=>`<option value="${esc(o.value)}"${t?.category===o.value?" selected":""}>${esc(o.label)}</option>`).join("")}</select></div>
   <div class="field" style="margin:0"><label>2) Serviço / tarefa *</label>
    <select id="w1svc"><option value="">— escolha a categoria primeiro —</option></select>
    <span class="hint">Vem do catálogo de tarefas (editável na seção “<i class=yi data-i=book></i> Catálogo de tarefas”).</span></div>
  </div>
  <div class="form-grid">
   <div class="field" style="margin:0"><label>Nome da tarefa no site *</label><input id="w1name" value="${esc(t?.name||"")}" placeholder="Ex.: Curtir nossa publicação no Facebook"></div>
   <div class="field" style="margin:0"><label>Recompensa por participante (R$) *</label><input type="number" min="0.01" step="0.01" id="w1reward" value="${(Math.max(0.01,Number(t?.reward)||0.01)).toFixed(2)}"></div>
   <div class="field" style="margin:0"><label>Tipo de saldo</label><select id="w1type">${["common","gold","vip"].map(k=>`<option value="${k}"${(t?.ticketType||"common")===k?" selected":""}>${k}</option>`).join("")}</select></div>
   <div class="field" style="margin:0"><label>Dificuldade</label><select id="w1diff">${Object.entries(DIFFS).map(([k,v])=>`<option value="${k}"${tDiff===k?" selected":""}>${v.dot} ${v.label}</option>`).join("")}</select></div>
  </div>
  <div class="wiz-auto" id="w1auto"></div>
 </div>

 <div class="wiz-step" id="wiz2" hidden>
  <div class="field" style="margin:0"><label>Descrição do serviço (o que o participante vai fazer) *</label><textarea id="w2desc">${esc(t?.description||"")}</textarea></div>
  <div class="form-grid">
   <div class="field" style="margin:0"><label>Quantidade de membros (mín./máx. configuráveis no painel · padrão 25–500)</label><input type="number" min="${stockBounds().min}" max="${stockBounds().max}" step="1" id="w2stock" value="${clampStock(t?.stock)}"></div>
   <div class="field" style="margin:0"><label>Onde a tarefa aparece</label>
    <select id="w2dest">
     <option value="offers"${t?.eventId?"":" selected"}>Ofertas do site (avulsa)</option>
     ${C.events.map(e=>`<option value="${esc(e.id)}"${t?.eventId===e.id?" selected":""}>Evento: ${esc(e.name)}</option>`).join("")}
    </select></div>
  </div>
  <div class="field" style="margin:0"><label>Regras da tarefa (uma por linha — numeradas automaticamente no site)</label><textarea id="w2rules" rows="4">${esc(Array.isArray(t?.rules)?t.rules.join("\n"):t?.rules||"")}</textarea></div>
  <div class="form-grid">
   <div class="field" style="margin:0"><label>Requisitos (opcional · separe com · ou linha nova)</label><input id="w2req" value="${esc((t?.requirements||[]).join(" · "))}" placeholder="Ex.: conta ativa · maior de 18 anos"></div>
   <div class="field" style="margin:0"><label>Prazo de avaliação dos comprovantes (dias)</label><input id="w2review" type="number" min="1" max="30" value="${Math.min(30,Math.max(1,Math.floor(Number(t?.reviewDays)||3)))}"></div>
  </div>
  <div class="field" style="margin:0"><label>Informações adicionais (opcional)</label><textarea id="w2extra" rows="2">${esc(t?.extra||"")}</textarea></div>
  <div>
   <h3 class="wiz-h">Etapas que o participante deverá seguir</h3>
   <p class="hint" style="margin:4px 0 10px">A 1ª etapa é obrigatória; adicione mais quantas quiser — elas aparecem numeradas na “área de trabalho” da tarefa no site.</p>
   <div id="w2steps"></div>
   <button class="btn secondary small" id="w2stepAdd" type="button">+ Adicionar etapa</button>
  </div>
  <div class="form-grid">
   <div class="field" style="margin:0"><label>Link da tarefa (aberto pelo participante)</label><input id="w2link" value="${esc(t?.link||"")}" placeholder="https://…"></div>
   <div class="field" style="margin:0"><label>Cupom (opcional)</label><input id="w2coupon" value="${esc(t?.coupon||"")}"></div>
  </div>
  <div class="wiz-auto" id="w2auto"></div>
 </div>

 <div class="wiz-step" id="wiz3" hidden>
  <p class="hint" style="margin:0">Marque o que o participante deverá enviar para comprovar a execução. A dificuldade define o mínimo: <b><span class="sdot g"></span> Simples = 1 prova</b> · <b><span class="sdot y"></span> Intermediário / <span class="sdot r"></span> Avançado = 2 ou mais</b>. Se nada for marcado, a tarefa não exige comprovante.</p>
  <div class="wiz-checks">
   ${[["text","<i class=yi data-i=note></i> Texto / descrição"],["code","<i class=yi data-i=key></i> Código / cupom"],["image","<i class=yi data-i=image></i> Print (link da imagem)"],["video","<i class=yi data-i=video></i> Gravação de tela (link)"],["datetime","<i class=yi data-i=clock></i> Data e hora da execução"]].map(([k,l])=>`<label class="wiz-check"><input type="checkbox" id="w3p_${k}"${pr[k]?" checked":""}> ${l}</label>`).join("")}
  </div>
  <div class="field" style="margin:0"><label>Quantidade mínima de provas</label><select id="w3min">${[1,2,3,4,5].map(n=>`<option value="${n}"${tMin===n?" selected":""}>${n} prova(s)</option>`).join("")}</select></div>
  <div class="field" style="margin:0"><label>Como o participante deve comprovar (instruções exibidas na área de trabalho) *</label><textarea id="w3details" placeholder="Ex.: curta a publicação e envie o print do curtir, com seu perfil visível.">${esc(t?.proofDetails||"")}</textarea></div>
  <div class="field" style="margin:0"><label>Aprovação automática (credita sem análise)</label><select id="w3auto"><option value="false"${t?.autoApprove!==true?" selected":""}>false — análise manual</option><option value="true"${t?.autoApprove===true?" selected":""}>true — automática</option></select></div>
  <div class="wiz-auto" id="w3info"></div>
 </div>

 <div class="wiz-step" id="wiz4" hidden>
  <div id="w4sum"></div>
  <div class="form-grid">
   <div class="field" style="margin:0"><label>Início (vazio = começa já)</label><input type="datetime-local" id="w4start" value="${dateInput(t?.startAt)}"></div>
   <div class="field" style="margin:0"><label>Encerramento (vazio = sem prazo)</label><input type="datetime-local" id="w4end" value="${dateInput(t?.endAt)}"></div>
   <div class="field" style="margin:0"><label>Ativa no site</label><select id="w4active"><option value="true"${t?.active!==false?" selected":""}>true — ativa</option><option value="false"${t?.active===false?" selected":""}>false — pausada</option></select></div>
   <div class="field" style="margin:0"><label>Selo curto no card (opcional)</label><input id="w4badge" value="${esc(t?.badge||"")}" placeholder="NOVA, QUENTE…"></div>
   <div class="field" style="margin:0"><label>Destaque no topo</label><select id="w4feat"><option value="false"${t?.featured!==true?" selected":""}>false</option><option value="true"${t?.featured===true?" selected":""}>true</option></select></div>
   <div class="field" style="margin:0"><label>Prioridade (maior aparece primeiro)</label><input type="number" id="w4prio" value="${Number(t?.priority)||0}"></div>
  </div>
 </div>

 <div class="actions">
  <button class="btn secondary" id="wizPrev" hidden>← Voltar</button>
  <button class="btn" id="wizNext">Continuar →</button>
  <button class="btn" id="wizPublish" hidden><i class=yi data-i=checkc></i> Conferir e publicar</button>
  <button class="btn secondary small" id="wizAdvanced" style="margin-left:auto">Editor avançado (todos os campos)</button>
 </div>
</div>`);

/* etapas da missão: começa com 1 obrigatória */
const stepArr=tSteps.length?tSteps.slice():[""];
const renderSteps=()=>{
 $("w2steps").innerHTML=stepArr.map((s,i)=>`<div class="wiz-steprow"><span class="wiz-stepn">${i+1}</span><input data-wstep="${i}" value="${esc(s)}" placeholder="Ex.: Acesse o link e curta a publicação"><button class="btn danger small" data-wstepdel="${i}" type="button">✕</button></div>`).join("");
};
renderSteps();
$("w2stepAdd").onclick=()=>{stepArr.push("");renderSteps()};
$("w2steps").addEventListener("input",e=>{const i=e.target.dataset.wstep;if(i!==undefined)stepArr[Number(i)]=e.target.value});
$("w2steps").addEventListener("click",e=>{const d=e.target.dataset.wstepdel;if(d!==undefined){stepArr.splice(Number(d),1);if(!stepArr.length)stepArr.push("");renderSteps()}});

/* etapa 1: categoria + serviço (dificuldade e recompensa-base automáticas) */
const proofChecks=()=>["text","code","image","video","datetime"].filter(k=>$("w3p_"+k)?.checked);
let lastSvcLabel=$("w1name").value.trim();
const auto1=()=>{
 const svc=svcOf($("w1cat").value,$("w1svc").value);
 $("w1auto").innerHTML=svc
  ?`<div class="wiz-detected">Detectado do catálogo: dificuldade <b>${diffOf(svc.difficulty).dot} ${diffOf(svc.difficulty).label}</b> · recompensa-base <b>${fmtBRL(Math.max(0.01,Number(svc.reward)||0.01))} ${esc(svc.ticketType||"common")}</b> · mínimo sugerido de provas: <b>${DIFF_MIN[diffKey(svc.difficulty)]}</b></div>`
  :"";
};
const fillServices=(sid)=>{
 const cat=catOf($("w1cat").value);
 $("w1svc").innerHTML='<option value="">— escolha —</option>'+(cat?.services||[]).map(s=>`<option value="${esc(s.id)}"${s.id===sid?" selected":""}>${esc(s.label)} · ${fmtBRL(Math.max(0.01,Number(s.reward)||0.01))}</option>`).join("")+`<option value="custom"${sid==="custom"?" selected":""}>— serviço personalizado (usar o nome digitado) —</option>`;
 auto1();
};
fillServices(t?.serviceId||(isEdit?"custom":""));
$("w1cat").onchange=()=>{fillServices("")};
$("w1svc").onchange=()=>{
 const svc=svcOf($("w1cat").value,$("w1svc").value);
 if(svc){
  const name=$("w1name").value.trim();
  if(!name||name===lastSvcLabel)$("w1name").value=svc.label;
  lastSvcLabel=svc.label;
  $("w1reward").value=(Math.max(0.01,Number(svc.reward)||0.01)).toFixed(2);
  $("w1type").value=svc.ticketType||"common";
  $("w1diff").value=diffKey(svc.difficulty);
  $("w3min").value=Math.max(1,DIFF_MIN[diffKey(svc.difficulty)]||1);
 }
 auto1();
};
["w3p_text","w3p_code","w3p_image","w3p_video","w3p_datetime"].forEach(id=>{
 const el=$(id);if(el)el.onchange=()=>{$("w3info").innerHTML=proofChecks().length?`<div class="wiz-detected">Provas exigidas: <b>${proofChecks().map(k=>PROOF_REQ_LABELS[k]).join(" · ")}</b></div>`:"<div class='hint'>Nenhum tipo marcado — a tarefa não exigirá comprovante.</div>"};
});

/* navegação entre as 4 etapas */
let step=1;
const reqProofCount=()=>proofChecks().length;
const show=n=>{
 step=n;
 [1,2,3,4].forEach(i=>$("wiz"+i).hidden=i!==n);
 [...$("wizSteps").children].forEach((el,i)=>el.classList.toggle("on",i===n-1));
 $("wizPrev").hidden=n===1;
 $("wizNext").hidden=n===4;
 $("wizPublish").hidden=n!==4;
 const rd=Math.max(0.01,Math.round((Number($("w1reward").value)||0.01)*100)/100);
 const stock=clampStock($("w2stock").value);
 if(n===2){
  $("w2auto").innerHTML=`<div class="wiz-detected">Recompensa estimada por participante: <b>+${fmtBRL(rd)}</b>${stock>0?` · valor final: <b>${fmtBRL(rd*stock)}</b> (${stock} membros × ${fmtBRL(rd)})`:" · membros ilimitados"}</div>`;
 }
 if(n===4){
  const prN=reqProofCount();
  const dk=$("w1diff").value;
  const minP=prN?((dk==="medium"||dk==="hard")?Math.max(2,Number($("w3min").value)||1):Math.max(1,Number($("w3min").value)||1)):0;
  const cat=catOf($("w1cat").value);
  const svc=svcOf($("w1cat").value,$("w1svc").value);
  const dest=$("w2dest").value;
  const stepsN=stepArr.filter(s=>s.trim()).length;
  $("w4sum").innerHTML=`
  <h3 class="wiz-h">Resumo antes de publicar</h3>
  <table class="wiz-sum"><tbody>
  <tr><td>Categoria</td><td>${cat?cat.icon+" "+esc(cat.label):esc(catLabel($("w1cat").value))}</td></tr>
  <tr><td>Serviço / tarefa</td><td><b>${esc(svc?.label||$("w1name").value)}</b></td></tr>
  <tr><td>Dificuldade</td><td>${DIFFS[dk].dot} ${esc(DIFFS[dk].label)}</td></tr>
  <tr><td>Recompensa por participante</td><td><b>+${rd} ${esc($("w1type").value)}</b></td></tr>
  <tr><td>Quantidade de usuários</td><td>${stock>0?stock+" membro(s)":"Ilimitada"}</td></tr>
  <tr><td>Valor final da tarefa</td><td><b>${stock>0?fmtBRL(rd*stock)+" ("+stock+" membros × "+fmtBRL(rd)+")":fmtBRL(rd)+" por participante"}</b></td></tr>
  <tr><td>Etapas da missão</td><td>${stepsN}</td></tr>
<tr><td>Regras da tarefa</td><td>${$("w2rules").value.split("\n").map(s=>s.trim()).filter(Boolean).length}</td></tr>
<tr><td>Prazo de avaliação</td><td>${Math.min(30,Math.max(1,Math.floor(Number($("w2review").value)||3)))} dia(s)</td></tr>
  <tr><td>Prova exigida</td><td>${prN?esc(proofChecks().map(k=>PROOF_REQ_LABELS[k]).join(" · ")):"não exige comprovante"}</td></tr>
  <tr><td>Mínimo de provas</td><td>${prN?minP:"—"}</td></tr>
  <tr><td>Aprovação</td><td>${$("w3auto").value==="true"?"automática (credita na hora)":"manual (fila de solicitações)"}</td></tr>
  <tr><td>Aparece em</td><td>${dest==="offers"?"Ofertas do site":"Evento: "+esc(C.events.find(e=>e.id===dest)?.name||dest)}</td></tr>
  </tbody></table>`;
 }
};
$("wizPrev").onclick=()=>show(Math.max(1,step-1));
$("wizNext").onclick=()=>{
 if(step===1){
  if(!$("w1cat").value)return toast("Escolha a categoria do serviço.");
  if(!$("w1svc").value)return toast("Escolha o serviço da categoria.");
  if(!$("w1name").value.trim())return toast("Informe o nome da tarefa.");
  const r=Number($("w1reward").value);
  if(!Number.isFinite(r)||r<0.01)return toast("Recompensa inválida. Use no mínimo R$ 0,01.");
 }
 if(step===2){
  if(!$("w2desc").value.trim())return toast("Descreva a missão do serviço.");
  if(!stepArr.some(s=>s.trim()))return toast("Cadastre pelo menos 1 etapa da missão.");
 }
 if(step===3){
  const prN=reqProofCount();
  if(prN){
   const dk=$("w1diff").value;
   const minP=(dk==="medium"||dk==="hard")?Math.max(2,Number($("w3min").value)||1):Math.max(1,Number($("w3min").value)||1);
   if(minP>prN)return toast("O mínimo de provas ("+minP+") não pode passar dos tipos exigidos ("+prN+").");
   if(!$("w3details").value.trim())return toast("Explique como o participante deve comprovar a tarefa.");
  }
 }
 show(Math.min(4,step+1));
};
$("wizAdvanced").onclick=()=>{closeModal();editTaskAdvanced(t)};

/* publicar */
$("wizPublish").onclick=async()=>{
 const rd=Math.max(0.01,Math.round((Number($("w1reward").value)||0.01)*100)/100);
 const stock=clampStock($("w2stock").value);
 const ty=$("w1type").value;
 const isNew=!t;
 /* a taxa de 30% do total (recompensa × vagas) alimenta o Cofre Real */
 if(isNew&&stock<1)return toast("Informe o número de vagas (mín. e máx. conforme configuração).");
 const _sb=stockBounds();if(stock<_sb.min||stock>_sb.max)return toast("Vagas devem ficar entre "+_sb.min+" e "+_sb.max+".");
 const reqs=proofChecks();
 const dk=$("w1diff").value;
 const minP=reqs.length?((dk==="medium"||dk==="hard")?Math.max(2,Number($("w3min").value)||1):Math.max(1,Number($("w3min").value)||1)):0;
 if(reqs.length&&minP>reqs.length)return toast("Mínimo de provas maior que os tipos exigidos.");
 const dest=$("w2dest").value;
 const svc=svcOf($("w1cat").value,$("w1svc").value);
 const prObj={text:reqs.includes("text"),code:reqs.includes("code"),image:reqs.includes("image"),video:reqs.includes("video"),datetime:reqs.includes("datetime")};
 const steps=stepArr.map(s=>s.trim()).filter(Boolean);
 const prevStock=Math.max(0,Math.floor(Number(t?.stock)||0));
 let stockLeft=null;
 if(stock>0){
  let left=Number(t?.stockLeft);
  left=Number.isFinite(left)&&left>=0?Math.floor(left):stock;
  /* nunca maior que o total de vagas (auto-repara dados antigos ao salvar) */
  stockLeft=Math.min(stock,Math.max(0,left+(stock-prevStock)));
 }
 const data={
  name:$("w1name").value.trim(),
  category:$("w1cat").value,
  serviceId:$("w1svc").value,
  serviceLabel:svc?.label||$("w1name").value.trim(),
  difficulty:dk,
  reward:rd,
  ticketType:ty,
  description:$("w2desc").value.trim(),
  rules:$("w2rules").value.split("\n").map(s=>s.trim()).filter(Boolean),
  requirements:$("w2req").value.trim()?$("w2req").value.split(/[·\n]/).map(s=>s.trim()).filter(Boolean):[],
  extra:$("w2extra").value.trim(),
  reviewDays:Math.min(30,Math.max(1,Math.floor(Number($("w2review").value)||3))),
  steps,
  link:$("w2link").value.trim(),
  coupon:$("w2coupon").value.trim(),
  stock:stock>0?stock:0,
  stockLeft,
  proofReq:prObj,
  minProofs:minP,
  requiresProof:reqs.length>0,
  proofType:reqs.includes("code")&&!reqs.includes("text")?"code":"text",
  proofDetails:$("w3details").value.trim(),
  autoApprove:$("w3auto").value==="true",
  showInOffers:dest==="offers",
  eventId:dest==="offers"?"":dest,
  active:$("w4active").value==="true",
  badge:$("w4badge").value.trim(),
  featured:$("w4feat").value==="true",
  priority:Math.max(0,Math.floor(Number($("w4prio").value)||0)),
  startAt:$("w4start").value?toTimestamp($("w4start").value):null,
  endAt:$("w4end").value?toTimestamp($("w4end").value):null
 };
 try{
  await setDoc(doc(db,"tasks",t?.id||"task_"+Date.now()),{
   ...data,
   updatedAt:serverTimestamp(),
   ...(t?{}:{createdAt:serverTimestamp()})
  },{merge:true});
  /* tarefa da própria equipe NÃO paga taxa: o Cofre Real é alimentado
     somente pelas taxas dos colaboradores (30%) — inflar o prêmio do
     sorteio mensal com dinheiro da própria plataforma distorce o cofre */
  closeModal();
  await loadAll();
  toast("Tarefa publicada! Ela já aparece no site com categoria, dificuldade e área de trabalho.");
 }catch(e){error(e)}
};

}

/* moeda única: reais (R$). Todas as categorias do saldo valem R$ 1,00 */
const AVAL={common:1,gold:1,vip:1};
const fmtBRL=v=>"R$ "+(Math.round((Number(v)||0)*100)/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
/* cotação das moedas de recompensa em reais — IGUAL ao site (cfCurBRL):
   bilhete = R$ 0,50 · moeda = R$ 0,001 · real = R$ 1,00. A taxa de 30% incide
   sobre o valor total CONVERTIDO em reais, como prometido no termo de uso */
const CUR_BRL={brl:1,ticket:0.5,coin:0.001};
const collabFee=(reward,ty,stock,cur)=>Math.max(1,Math.ceil((Number(reward)||0.01)*(CUR_BRL[String(cur||"brl")]||1)*(AVAL[ty]||1)*Math.max(1,stock)*0.30));

function editTask(t=null){return taskWizard(t)}

/* ============================================================
   TAREFAS DOS COLABORADORES
   Envios do formulário do site (coleção "collabTasks"): revisão,
   valores em reais definidos pela equipe, pedido de edição,
   negação com motivo e publicação com selo <i class=yi data-i=handshake></i> Parceiro.
   ============================================================ */
const COLLAB_STATUS={
 pending:{label:"<i class=yi data-i=hourglass></i> Em análise",cls:"yellow"},
 changes_requested:{label:"<i class=yi data-i=edit></i> Correção pedida",cls:"yellow"},
 rejected:{label:"<i class=yi data-i=ban></i> Negada",cls:"red"},
 approved:{label:"<i class=yi data-i=checkc></i> Publicada",cls:"green"}
};
const collabStatus=c=>COLLAB_STATUS[c?.status||"pending"]||COLLAB_STATUS.pending;
const collabUser=c=>C.users.find(u=>u.id===c?.uid);
const collabProofList=c=>{
 const p=c?.proofReq||{};
 return Object.keys(p).filter(k=>p[k]).map(k=>PROOF_REQ_LABELS[k]||k).join(" · ");
};
/* reembolso da taxa de publicação (30%): devolve para a carteira do colaborador
   com registro no histórico. Usado ao negar a tarefa ou excluir o envio. */
async function refundCollabFee(c){
 const fee=Math.floor(Number(c?.feePaid)||0);
 if(!fee||c.feeRefunded||!c.uid)return false;
 /* devolve na moeda em que a taxa foi paga: moedas Yshipp ou reais */
 if(c.feeCur==="coin"){
  await setDoc(doc(db,"wallets",c.uid),{coins:increment(fee*1000),updatedAt:serverTimestamp()},{merge:true});
  await setDoc(doc(collection(db,"wallets",c.uid,"history")),{kind:"xc_refund",amount:0,xcKind:"coin",xcQty:fee*1000,reason:"Devolução da taxa de publicação paga em moedas: tarefa negada/excluída pela equipe",collabId:c.id||"",createdAt:serverTimestamp()});
  return true;
 }
 await setDoc(doc(db,"wallets",c.uid),{change:increment(fee),updatedAt:serverTimestamp()},{merge:true});
 await setDoc(doc(collection(db,"wallets",c.uid,"history")),{kind:"collab_refund",amount:fee,reason:"Devolução da taxa de publicação: tarefa negada/excluída pela equipe",collabId:c.id||"",createdAt:serverTimestamp()});
 /* recibo negativo no Cofre: só para taxas em reais (moedas nunca entraram no cofre) */
 try{
  await setDoc(doc(collection(db,"settings","cofre","receitas")),{
   kind:"collab_refund",collabId:c.id||"",ownerUid:c.uid||"",ownerName:c.ownerName||"",
   amount:-fee,feeCur:c.feeCur||"brl",createdAt:serverTimestamp()
  });
 }catch(re){}
 return true;
}

/* ── provas escaladas / prazo vencido: o painel avalia no lugar do colaborador ── */
const claimOverdue=c=>{
 const st=c.status||"pending";
 if(st==="approved"||st==="rejected")return false;
 if(c.blockedOwner===true)return true;
 if(c.escalated===true)return true;
 const t=C.tasks.find(x=>x.id===c.taskId);
 if(!t||t.source!=="collab")return false;
 const sub=stamp(c.submittedAt)||0;
 if(!sub)return false;
 const rv=Math.max(1,Math.floor(Number(t.reviewDays)||3));
 return Date.now()>sub+rv*864e5;
};
function renderCollabOverdue(){
 if(!$("collabOverdueList"))return;
 const list=C.taskClaims.filter(claimOverdue).sort((a,b)=>(stamp(a.submittedAt)||0)-(stamp(b.submittedAt)||0));
 $("collabOverdueList").innerHTML=list.length?list.map(c=>{
  const t=C.tasks.find(x=>x.id===c.taskId)||{};
  const why=c.blockedOwner?"participante bloqueou o colaborador":c.escalated?"escalada pelo colaborador":"prazo de avaliação vencido";
  return `<tr>
  <td>${uava(c,esc(c.participantName||"P"))}${esc(c.participantName||"—")}<small>${esc(c.uid||"")}</small></td>
  <td>${esc(t.serviceLabel||t.name||c.taskId)}<small class="mono">ID ${esc(c.taskId)}</small></td>
  <td style="max-width:240px">${esc(c.proofText||c.proof||"—")}${c.proofImage?`<small><a href="${esc(c.proofImage)}" target="_blank" rel="noopener">ver print</a></small>`:""}</td>
  <td>${date(c.submittedAt)}<small>${esc(why)}</small></td>
  <td>
   <button class="btn success small" data-cok="${esc(c.id)}">Aprovar e pagar</button>
   <button class="btn secondary small" data-cret="${esc(c.id)}">Devolver ao colaborador</button>
  </td>
  </tr>`;
 }).join(""):'<tr><td colspan="5" class="empty">Nenhuma prova escalada nem com prazo vencido.</td></tr>';
}
async function adminApproveClaim(cid){
 const c=C.taskClaims.find(x=>x.id===cid);if(!c)return;
 const t=C.tasks.find(x=>x.id===c.taskId);
 if(!t)return toast("Tarefa não encontrada.");
 const rd=Math.max(0.01,Math.round((Number(t.reward)||0.01)*100)/100);
 const type=t.ticketType||"common";
 const cur=t.rewardCur||"brl";
 if(!confirm("Aprovar esta prova no lugar do colaborador?\n\nSerão creditados "+rd+" "+(cur==="ticket"?"bilhete(s)":cur==="coin"?"Moeda(s) Yshipp":"real(is)")+" na carteira do participante."))return;
 try{
  await runTransaction(db,async tx=>{
   const ref=doc(db,"taskClaims",cid);
   const cs=await tx.get(ref);
   if(!cs.exists())throw new Error("Prova não encontrada.");
   if(cs.data().status==="approved")throw new Error("Esta prova já foi aprovada.");
   if(cur==="ticket")tx.set(doc(db,"wallets",c.uid),{tickets:increment(rd),updatedAt:serverTimestamp()},{merge:true});
   else if(cur==="coin")tx.set(doc(db,"wallets",c.uid),{coins:increment(rd),updatedAt:serverTimestamp()},{merge:true});
   else tx.set(doc(db,"wallets",c.uid),{[type]:increment(rd),updatedAt:serverTimestamp()},{merge:true});
   tx.set(doc(collection(db,"wallets",c.uid,"history")),{kind:cur==="brl"?"reward":"xc_reward",amount:cur==="brl"?rd:0,brl:cur==="brl"?rd:0,xcKind:cur==="ticket"?"ticket":cur==="coin"?"coin":"",xcQty:cur==="brl"?0:rd,ticketType:type,taskId:t.id,taskName:t.serviceLabel||t.name||"",reason:"Prova avaliada pela equipe (Central do colaborador)",reviewedByOwner:false,createdAt:serverTimestamp()});
   tx.update(ref,{status:"approved",reviewedAt:serverTimestamp(),reviewedBy:C.admin.uid,reviewerName:"Equipe Yshippcommerce",escalated:false,blockedOwner:false});
  });
  await loadAll();
  toast("Prova aprovada pela equipe e recompensa creditada ao participante.");
 }catch(e){error(e)}
}
async function adminReturnClaim(cid){
 const c=C.taskClaims.find(x=>x.id===cid);if(!c)return;
 try{
  await setDoc(doc(db,"taskClaims",cid),{escalated:false,escalatedClearedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
  await loadAll();
  toast("Prova devolvida para a fila do colaborador.");
 }catch(e){error(e)}
}
$("collabOverdueList").onclick=async e=>{
 const ok=e.target.dataset.cok;
 const ret=e.target.dataset.cret;
 if(ok)return adminApproveClaim(ok);
 if(ret)return adminReturnClaim(ret);
};
function renderCollab(){
 if(!$("collabList"))return;
 try{renderCollabOverdue()}catch(e){console.warn("renderCollabOverdue:",e)}
 const pending=C.collabs.filter(c=>(c.status||"pending")==="pending").length;
 $("collabBadge").textContent=pending;
 const st=[
  ["Envios recebidos",C.collabs.length,""],
  ["Pendentes",pending,"red"],
  ["Correção pedida",C.collabs.filter(c=>c.status==="changes_requested").length,"yellow"],
  ["Negadas",C.collabs.filter(c=>c.status==="rejected").length,"red"],
  ["Publicadas",C.collabs.filter(c=>c.status==="approved").length,"green"]
 ];
 $("collabStats").innerHTML=st.map(([l,v,c])=>`<div class="card"><div class="stat-label">${l}</div><div class="stat-value ${c}">${v}</div></div>`).join("");
 /* KPI financeiro do Cofre: taxas cobradas × devolvidas (conta dinheiro, não status) */
 try{
  const brl=c=>(c.feeCur||"brl")!=="coin";
  const fl=r=>Math.floor(Number(r)||0);
  const cob=C.collabs.filter(c=>c.status==="approved"&&!c.feeRefunded&&brl(c)).reduce((s,c)=>s+fl(c.feePaid),0);
  const dev=C.collabs.filter(c=>c.feeRefunded&&brl(c)).reduce((s,c)=>s+fl(c.feePaid),0);
  const moedas=C.collabs.filter(c=>c.status==="approved"&&!c.feeRefunded&&c.feeCur==="coin").reduce((s,c)=>s+fl(c.feePaid),0);
  const mb=$("collabMoney");
  if(mb)mb.innerHTML="Receita de taxas no Cofre Real: <b class='gold'>"+fmtBRL(cob)+"</b> cobradas · <b>"+fmtBRL(dev)+"</b> devolvidas · <b class='green'>"+fmtBRL(cob-dev)+"</b> líquidas · "+(moedas*1000).toLocaleString("pt-BR")+" moedas consumidas (não entram no Cofre)";
 }catch(e){}
 const f=$("collabFilter").value||"pending";
 const list=[...C.collabs]
  .filter(c=>f==="all"||(f==="pending"?(c.status||"pending")==="pending":c.status===f||(f==="changes_requested"&&c.status==="changes")))
  .sort((a,b)=>(stamp(b.updatedAt)||stamp(b.createdAt)||0)-(stamp(a.updatedAt)||stamp(a.createdAt)||0));
 $("collabList").innerHTML=list.length?list.map(c=>{
  const u=collabUser(c),s=collabStatus(c);
  const ini=String(c.ownerName||c.email||"?").charAt(0).toUpperCase();
  return `<div class="item">
   <h3>${esc(c.name||"Tarefa sem título")} ${c.appealed?'<span class="status yellow"><i class=yi data-i=hands></i> Recurso enviado</span>':""}</h3>
   <p>${uava(u,ini)} <b>${esc(c.ownerName||"—")}</b> · ${esc(c.email||c.uid||"")} · ${date(c.updatedAt||c.createdAt)}</p>
   <p>${esc(c.description||"")}</p>
   ${c.link?`<p><i class=yi data-i=link></i> <a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.link)}</a></p>`:""}
   <p><b>Etapas:</b> ${(Array.isArray(c.steps)?c.steps:[]).map(esc).join(" · ")||"—"}</p>
   ${(Array.isArray(c.rules)?c.rules:String(c.rules||"").split("\n").filter(Boolean)).length?`<p><b>Regras (${(Array.isArray(c.rules)?c.rules:String(c.rules||"").split("\n").filter(Boolean)).length}):</b> ${(Array.isArray(c.rules)?c.rules:String(c.rules).split("\n").filter(Boolean)).map(esc).slice(0,6).join(" · ")}${(Array.isArray(c.rules)?c.rules:String(c.rules).split("\n").filter(Boolean)).length>6?" …":""}</p>`:""}
   ${(c.requirements||[]).length?`<p><b>Requisitos:</b> ${(c.requirements||[]).map(esc).join(" · ")}</p>`:""}
   ${c.reviewDays?`<p><b>Prazo de avaliação:</b> ${Number(c.reviewDays)} dia(s)</p>`:""}
   <p><b>Prova exigida:</b> ${esc(c.proofDetails||"—")}${collabProofList(c)?` <b>(${collabProofList(c)})</b>`:""}</p>
   <p><b>Valor definido/sugerido:</b> ${fmtBRL(Number(c.reward||c.suggestedReward)||0)} · <b>Categoria:</b> ${esc(catLabel(c.category))}${(catOf(c.category)||TASK_CATS[c.category])?"":" <span class=\"status red\">fora do catálogo atual — escolha outra na revisão</span>"}${c.serviceLabel&&c.serviceLabel!==c.name?" · <b>Serviço:</b> "+esc(c.serviceLabel):""} · <b>Dificuldade:</b> ${diffOf(c.difficulty).label}</p>
   ${Number(c.feePaid)>0?`<p><b><i class=yi data-i=safe></i> Taxa de publicação (30%):</b> ${c.feeCur==="coin"?(Math.floor(Number(c.feePaid))*1000).toLocaleString("pt-BR")+" Moedas Yshipp":fmtBRL(c.feePaid)}${c.feeRefunded?' <span class="status green">devolvida</span>':c.feeCur==="coin"?' <span class="status yellow">moedas consumidas ao publicar (não entram no Cofre Real)</span>':' — entra no <i class=yi data-i=trophy></i> Cofre Real ao publicar'}</p>`:'<p class="hint">Envio antigo (sem taxa cobrada): ao aprovar, a taxa de 30% dos valores finais será cobrada da carteira do colaborador e vai para o <i class=yi data-i=trophy></i> Cofre Real.</p>'}
   ${c.note?`<p><i class=yi data-i=note></i> Colaborador: ${esc(c.note)}</p>`:""}
   ${c.comment?`<p><i class=yi data-i=chat></i> Equipe: ${esc(c.comment)}</p>`:""}
   ${c.appealNote?`<p><i class=yi data-i=hands></i> Recurso: ${esc(c.appealNote)}</p>`:""}
   ${c.publishedTaskId?`<p><i class=yi data-i=checkc></i> Já publicada no site na seção <b>Ofertas dos colaboradores</b> com o carimbo <i class=yi data-i=handshake></i> (id ${esc(c.publishedTaskId)})</p>`:""}
   <p><span class="status ${s.cls}">${s.label}</span></p>
   <div class="actions">
    <button class="btn small" data-collab-review="${esc(c.id)}">${(c.status==="approved")?"Ver / editar valores":"Revisar tarefa"}</button>
    <button class="btn danger small" data-collab-del="${esc(c.id)}">Excluir envio</button>
   </div>
  </div>`;
 }).join(""):'<div class="empty">Nenhum envio nesta visão. Quando um membro publicar uma tarefa pelo site, ela aparece aqui para revisão.</div>';
}

/* modal de revisão: a equipe define os valores em reais e decide */
function openCollabReview(c){
 const cats=catList();
 const catOk=cats.find(x=>x.id===c.category)?.id||cats[0]?.id||"";
 const html=`
 <div class="form-grid">
  <div class="field"><label>${c.rewardCur&&c.rewardCur!=="brl"?"Recompensa por participante (na MOEDA escolhida abaixo do campo)":"Recompensa em reais (por participante)"}</label><input id="cv_reward" type="number" min="0.01" step="0.01" value="${(Math.max(0.01,Number(c.reward??c.suggestedReward)||0.01)).toFixed(2)}"></div>
  ${c.rewardCur&&c.rewardCur!=="brl"?`<div class="field" style="grid-column:1/-1"><label>Moeda escolhida pelo colaborador</label><div><span class="status yellow">${c.rewardCur==="ticket"?"Pagar em BILHETES (1 = R$ 0,50) — o colaborador credita na Central do colaborador do site":"Pagar em MOEDAS Yshipp (10 = R$ 0,01) — o colaborador credita na Central do colaborador do site"}</span></div></div>`:""}
  <div class="field"><label>Tipo de saldo</label><select id="cv_type">${["common","gold","vip"].map(k=>`<option value="${k}"${(c.ticketType||"common")===k?" selected":""}>${k}</option>`).join("")}</select></div>
  <div class="field"><label>Categoria (catálogo)</label><select id="cv_cat">${cats.map(x=>`<option value="${esc(x.id)}"${x.id===catOk?" selected":""}>${esc(x.label)}</option>`).join("")||'<option value="">— sem categorias —</option>'}</select></div>
  <div class="field"><label>Dificuldade</label><select id="cv_diff">${Object.entries(DIFFS).map(([k,v])=>`<option value="${k}"${diffKey(c.difficulty)==="simple"?(k==="simple"?" selected":""):(k===diffKey(c.difficulty)?" selected":"")}>${v.dot} ${v.label}</option>`).join("")}</select></div>
  <div class="field"><label>Vagas (padrão 25–500 · editável)</label><input id="cv_stock" type="number" min="${stockBounds().min}" max="${stockBounds().max}" step="1" value="${clampStock(c.stock)}"></div>
 </div>
 <div class="field"><label>Comentário da equipe (o colaborador lê no site)</label><textarea id="cv_comment" placeholder="Ex.: Aumente a descrição da prova ou explique por que negamos.">${esc(c.comment||"")}</textarea></div>
 <p class="hint">Aprovar publica a tarefa na seção <b>Ofertas dos colaboradores</b> do site com o carimbo <i class=yi data-i=handshake></i>, usando os valores definidos acima — e a <b>taxa de 30% entra no <i class=yi data-i=trophy></i> Cofre Real neste momento</b> (quando o colaborador pagou em Moedas Yshipp, as moedas são consumidas e o Cofre Real não recebe reais, pois fichas não viram reais). Em "Pedir edição" ou "Negar", o comentário é enviado ao colaborador — na negação a <b>taxa é devolvida</b> automaticamente (em moedas ou reais, conforme o pagamento) e ele ainda pode recorrer pelo site. Depois de publicada, <b>a inspeção das provas é do próprio colaborador</b>: ele aprova, pede correção ou nega cada comprovante na Central do colaborador do site (a recompensa é creditada na hora, na moeda escolhida). Se o participante desconfiar de má-fé, leva o caso ao suporte com o ID da tarefa e o caso aparece na aba <b><i class=yi data-i=shield></i> Disputas</b> para você auditar e reverter.</p>
 <div class="actions">
  <button class="btn" id="cv_approve"><i class=yi data-i=checkc></i> Aprovar e publicar</button>
  <button class="btn secondary" id="cv_changes"><i class=yi data-i=edit></i> Pedir edição</button>
  <button class="btn danger" id="cv_reject"><i class=yi data-i=ban></i> Negar</button>
 </div>`;
 openModal((c.status==="approved"?"Valores da tarefa publicada":"Revisão · "+(c.name||"tarefa")),html);
 const finish=async()=>{
  closeModal();
  await loadAll();
 };
 $("cv_approve").onclick=async()=>{
  const rd=Math.max(0.01,Math.round((Number($("cv_reward").value)||0.01)*100)/100);
  const ty=$("cv_type").value||"common";
  const cat=$("cv_cat").value||"";
  const dk=$("cv_diff").value||"simple";
  const stock=clampStock($("cv_stock").value);
  const comment=$("cv_comment").value.trim();
  /* a taxa de 30% entra no <i class=yi data-i=trophy></i> Cofre Real SOMENTE na primeira publicação
     (republicar/editar valores de uma tarefa já aprovada não cobra de novo) */
  const firstTime=(c.status||"pending")!=="approved";
  try{
   let fee=firstTime?Math.floor(Number(c.feePaid)||0):0;
   const feeWasCoin=(c.feeCur||"brl")==="coin";
   if(firstTime&&(!fee||c.feeRefunded)){
    /* envio antigo (ou taxa já devolvida em negação): cobra a taxa agora da
       carteira do colaborador — em MOEDAS quando o envio foi pago com moedas,
       em reais nos demais casos */
    fee=collabFee(rd,ty,stock,c.rewardCur);
    if(c.uid&&feeWasCoin){
     const need=fee*1000;
     const charged=await runTransaction(db,async tx=>{
      const wRef2=doc(db,"wallets",c.uid);
      const wd=await tx.get(wRef2);
      const w=wd.exists()?wd.data():{};
      const bal=Math.max(0,Math.floor(Number(w.coins)||0));
      if(bal<need)return false;
      await tx.set(wRef2,{coins:bal-need,updatedAt:serverTimestamp()},{merge:true});
      await tx.set(doc(collection(db,"wallets",c.uid,"history")),{kind:"xc_spend",amount:0,xcKind:"coin",xcQty:need,reason:"Taxa de publicação (30%) cobrada em Moedas Yshipp na aprovação da tarefa",collabId:c.id||"",createdAt:serverTimestamp()});
      return true;
     }).catch(()=>false);
     if(!charged)return toast("O colaborador não tem Moedas Yshipp suficientes para a taxa ("+need+" moedas). Peça edição, negue ou aguarde ele recarregar no Market.");
     /* fichas não viram reais: a taxa em moedas é consumida (queimada) e
        NÃO entra no Cofre Real — o real continua sendo o centro */
     fee=0;
    }else if(c.uid){
     const charged=await runTransaction(db,async tx=>{
      const wRef2=doc(db,"wallets",c.uid);
      const wd=await tx.get(wRef2);
      const w=wd.exists()?wd.data():{};
      const val={change:Math.max(0,Math.floor(Number(w.change)||0)),common:Math.max(0,Math.floor(Number(w.common)||0)),gold:Math.max(0,Math.floor(Number(w.gold)||0)),vip:Math.max(0,Math.floor(Number(w.vip)||0))};
      const bal=val.change+val.common*AVAL.common+val.gold*AVAL.gold+val.vip*AVAL.vip;
      if(bal<fee)return false;
      const o={change:Math.min(fee,val.change),common:0,gold:0,vip:0};
      let need=fee-o.change;
      for(const k of ["common","gold","vip"]){
       while(need>0&&val[k]-o[k]>0){o[k]++;need-=AVAL[k];}
      }
      const troco=need<0?-need:0;
      await tx.set(wRef2,{
       change:val.change-o.change+troco,
       common:val.common-o.common,
       gold:val.gold-o.gold,
       vip:val.vip-o.vip,
       updatedAt:serverTimestamp()
      },{merge:true});
      await tx.set(doc(collection(db,"wallets",c.uid,"history")),{kind:"collab_fee",amount:fee,reason:"Taxa de publicação (30%) cobrada na aprovação da tarefa",collabId:c.id||"",createdAt:serverTimestamp()});
      return true;
     }).catch(()=>false);
     if(!charged)return toast("O colaborador não tem saldo suficiente para a taxa ("+fmtBRL(fee)+"). Peça edição, negue ou aguarde ele recarregar a carteira.");
    }
   }
   if(firstTime&&fee>0){
    await setDoc(doc(db,"settings","cofre"),{pot:increment(fee),totalCollected:increment(fee),updatedAt:serverTimestamp()},{merge:true});
    /* rastreio financeiro: 1 recibo por entrada no Cofre, com collabId para conciliação */
    try{
     await setDoc(doc(collection(db,"settings","cofre","receitas")),{
      kind:"collab_fee",collabId:c.id||"",taskId:c.publishedTaskId||"",
      ownerUid:c.uid||"",ownerName:c.ownerName||"",
      amount:fee,feeCur:c.feeCur||"brl",createdAt:serverTimestamp()
     });
    }catch(re){}
   }
   const tid=c.publishedTaskId||"task_"+Date.now();
   /* provas: usa o que o colaborador configurou no formulário guiado (com padrão seguro) */
   const pr=c.proofReq&&typeof c.proofReq==="object"?c.proofReq:{text:true,image:true};
   const prOn=Object.keys(pr).filter(k=>pr[k]);
   const prObj=prOn.length?pr:{text:true,image:true};
   const minP=Math.max(1,Math.floor(Number(c.minProofs)||1));
   await setDoc(doc(db,"tasks",tid),{
    name:c.name||"Tarefa de colaborador",
    category:cat,
    serviceId:c.serviceId||"",
    serviceLabel:c.serviceLabel||catLabel(cat)||c.name||"",
    difficulty:dk,
    reward:rd,
    rewardCur:c.rewardCur||"brl",
    ticketType:ty,
    description:c.description||"",
    rules:Array.isArray(c.rules)?c.rules.filter(Boolean):(String(c.rules||"").split("\n").filter(Boolean)),
    requirements:Array.isArray(c.requirements)?c.requirements.filter(Boolean):[],
    extra:c.extra||"",
    reviewDays:Math.min(30,Math.max(1,Math.floor(Number(c.reviewDays)||3))),
    steps:Array.isArray(c.steps)?c.steps.filter(Boolean):[],
    link:c.link||"",
    coupon:"",
    stock,
    stockLeft:stock>0?stock:null,
    proofReq:prObj,
    minProofs:minP,
    requiresProof:prOn.length>0,
    proofType:prObj.code&&!prObj.text?"code":"text",
    proofDetails:c.proofDetails||"",
    autoApprove:false,
    showInOffers:true,
    eventId:"",
    active:true,
    badge:"<i class=yi data-i=handshake></i>",
    featured:false,
    priority:0,
    startAt:null,
    endAt:null,
    source:"collab",
    collabStatus:"approved",
    ownerName:c.ownerName||"",
    ownerUid:c.uid||"",
    collabId:c.id,
    updatedAt:serverTimestamp(),
    ...(c.publishedTaskId?{}:{createdAt:serverTimestamp()})
   },{merge:true});
   await setDoc(doc(db,"collabTasks",c.id),{
    status:"approved",
    comment,
    reward:rd,
    ticketType:ty,
    category:cat,
    difficulty:dk,
    stock,
    feePaid:fee||Math.floor(Number(c.feePaid)||0),
    feeRefunded:false,
    publishedTaskId:tid,
    reviewedAt:serverTimestamp(),
    updatedAt:serverTimestamp()
   },{merge:true});
   await finish();
   toast("Tarefa aprovada! Já está na seção Ofertas dos colaboradores com o carimbo <i class=yi data-i=handshake></i> e os valores definidos."+(firstTime&&fee>0?(" Taxa de "+fmtBRL(fee)+" somada ao <i class=yi data-i=trophy></i> Cofre Real."):""));
   notifyUser(c.uid,"collab","<i class=yi data-i=checkc></i> Sua tarefa foi aprovada!","A tarefa <b style='color:#fcd535'>"+esc(c.name||"")+"</b> foi aprovada e já está publicada na seção <b>Ofertas dos colaboradores</b>. A inspeção das provas agora é sua — acompanhe na Central do colaborador.","#colab");
  }catch(e){error(e)}
 };
 $("cv_changes").onclick=async()=>{
  const comment=$("cv_comment").value.trim();
  if(!comment)return toast("Escreva o que o colaborador deve corrigir.");
  try{
   await setDoc(doc(db,"collabTasks",c.id),{status:"changes_requested",comment,reviewedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
   await finish();
   toast("Pedido de edição enviado ao colaborador.");
   notifyUser(c.uid,"collab","<i class=yi data-i=edit></i> Correção pedida na sua tarefa","A equipe pediu correções na tarefa <b style='color:#fcd535'>"+esc(c.name||"")+"</b>. Veja o comentário no formulário de colaborador e reenvie.","#colab");
  }catch(e){error(e)}
 };
 $("cv_reject").onclick=async()=>{
  const comment=$("cv_comment").value.trim();
  if(!comment)return toast("Explique o motivo da negação — o colaborador pode recorrer.");
  try{
   /* taxa de 30% devolvida automaticamente ao negar — MAS só se a tarefa ainda
      não foi publicada: depois de aprovada, a taxa já entrou no Cofre Real */
   let refunded=false;
   if((c.status||"pending")!=="approved"){try{refunded=await refundCollabFee(c)}catch(e){console.error("Reembolso:",e)}}
   await setDoc(doc(db,"collabTasks",c.id),{status:"rejected",comment,feeRefunded:refunded||c.feeRefunded||false,reviewedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
   await finish();
   toast("Tarefa negada. "+(refunded?"Taxa de 30% devolvida para a carteira do colaborador. ":"")+"O colaborador foi avisado e pode recorrer.");
   notifyUser(c.uid,"collab","<i class=yi data-i=ban></i> Sua tarefa foi negada","A tarefa <b style='color:#fcd535'>"+esc(c.name||"")+"</b> foi negada pela equipe."+(refunded?" A taxa de publicação foi devolvida para a sua carteira.":"")+" Você pode recorrer pelo formulário de colaborador.","#colab");
  }catch(e){error(e)}
 };
}

$("collabFilter").onchange=renderCollab;
$("collabList").onclick=async e=>{
 const r=e.target.dataset.collabReview;
 const del=e.target.dataset.collabDel;
 if(r)return openCollabReview(C.collabs.find(x=>x.id===r));
 if(del){
  const c=C.collabs.find(x=>x.id===del);
  if(!c)return;
  if(!confirm("Excluir este envio do colaborador? "+(c.publishedTaskId?"A tarefa já publicada no site NÃO será apagada.":"A taxa de 30% será devolvida se ainda não foi.")))return;
  try{
   if(!c.publishedTaskId){try{await refundCollabFee(c)}catch(e){console.error("Reembolso:",e)}}
   await deleteDoc(doc(db,"collabTasks",del));
   await loadAll();
   toast("Envio excluído.");
  }catch(e){error(e)}
 }
};

/* ============================================================
   COFRE REAL · sorteio mensal das taxas de publicação
   O site soma as taxas em settings/cofire (pot). Aqui a equipe
   sorteia o mês: número de 1 a 1000; ganhadores dividem o cofre;
   se ninguém acertar, acumula para o mês seguinte.
   ============================================================ */
const cofreMonthKey=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")};
const cofreN=v=>fmtBRL(v);
const cofrePot=()=>Math.max(0,Math.floor(Number(C.cofre?.pot)||0));
/* helpers do Cofre Real (faltavam no painel — o site usa o mesmo formato):
   chave do mês "YYYY-MM", potência lida de settings/cofre e formatador */
const cofireMonthKey=(d=new Date())=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
const cofirePot=()=>Math.max(0,Math.floor(Number(C.cofre?.pot)||0));
const cofireN=v=>fmtBRL(Number(v)||0);

function renderCofre(){
 if(!$("cofireStats"))return;
 const mk=cofireMonthKey();
 const tk=C.cofreTickets.filter(t=>t.monthKey===mk);
 $("cofirePotBadge").textContent=cofreN(cofirePot());
 const st=[
  ["Cofre acumulado",cofreN(cofirePot()),"gold"],
  ["Total recolhido (histórico)",cofreN(C.cofre?.totalCollected),"green"],
  ["Total pago em prêmios",cofreN(C.cofre?.totalPaid),"gold"],
  ["Números escolhidos neste mês",tk.length,"red"]
 ];
 $("cofireStats").innerHTML=st.map(([l,v,c])=>`<div class="card"><div class="stat-label">${l}</div><div class="stat-value ${c}">${v}</div></div>`).join("");
 $("cofireTickets").innerHTML=tk.length?[...tk].sort((a,b)=>((a.number||0)-(b.number||0))).map(t=>`<div class="item"><p><b>${esc(t.displayName||"?")}</b> · Nº <span class="mono">${Math.floor(Number(t.number)||0)}</span></p></div>`).join(""):'<div class="empty">Ninguém escolheu número este mês ainda. Divulgue a seção Cofre Real no site!</div>';
 $("cofireDrawsList").innerHTML=C.cofreDraws.length?C.cofreDraws.map(d=>{
  const w=Array.isArray(d.winners)?d.winners:[];
  return `<div class="item"><h3>${esc(d.monthKey||"—")} · número <span class="mono">${Math.floor(Number(d.drawnNumber)||0)}</span></h3>
  <p>${d.rolledOver?'<span class="status yellow">Ninguém acertou · acumulou</span>':`<span class="status green">${w.length} ganhador(es)</span> · ${cofreN(d.pot)}`}</p>
  ${w.length?`<p>${w.map(x=>esc(x.displayName||"?")+" levou "+cofireN(x.payout)).join(" · ")}</p>`:""}</div>`;
 }).join(""):'<div class="empty">Nenhum sorteio realizado ainda.</div>';
 const already=C.cofreDraws.some(d=>d.monthKey===mk);
 /* lembrete: nos últimos 3 dias do mês o botão acende para não esquecer o sorteio */
 const nowD=new Date();
 const daysLeft=Math.max(0,new Date(nowD.getFullYear(),nowD.getMonth()+1,0).getDate()-nowD.getDate());
 $("cofireDrawBtn").innerHTML=already?"<i class=yi data-i=checkc></i> "+mk+" já foi sorteado":(daysLeft<=3?"<i class=yi data-i=warn></i> Fim do mês: sortear o "+mk+" agora":"<i class=yi data-i=dice></i> Sortear o mês agora");
 $("cofireDrawBtn").disabled=already;
}
$("cofireDrawBtn").onclick=async()=>{
 const mk=cofreMonthKey();
 if(C.cofreDraws.some(d=>d.monthKey===mk))return toast("Este mês já foi sorteado.");
 const tk=C.cofreTickets.filter(t=>t.monthKey===mk);
 const pot=cofirePot();
 /* trava de data: fora dos últimos 3 dias do mês, exige confirmação dupla —
    sortear no dia 5 liquidava o mês inteiro antes da hora */
 const nowD=new Date();
 const daysLeft=Math.max(0,new Date(nowD.getFullYear(),nowD.getMonth()+1,0).getDate()-nowD.getDate());
 if(daysLeft>3&&!confirm("ATENÇÃO: ainda faltam "+daysLeft+" dia(s) para o fim de "+mk+". Sortear agora encerra o mês antes da hora e os participantes param de poder escolher número. Sortear assim mesmo?"))return;
 if(!confirm("Sortear o "+mk+"? Cofre: "+fmtBRL(pot)+" · Participantes com número: "+tk.length+" · Sortearemos um número de 1 a 1000."))return;
 try{
  const drawn=Math.floor(Math.random()*1000)+1;
  const winners=tk.filter(t=>Math.floor(Number(t.number)||0)===drawn);
  const share=winners.length?Math.floor(pot/winners.length):0;
  const rem=pot-share*winners.length;
  const drawDoc={monthKey:mk,drawnNumber:drawn,pot,winners:winners.map(wn=>({uid:wn.uid,displayName:wn.displayName||"Participante",payout:share})),rolledOver:!winners.length,createdAt:serverTimestamp()};
  /* TUDO numa única transação, com releitura do cofre e ID fixo (= o mês):
     duplo clique ou duas abas do painel não podem mais sortear duas vezes
     nem pagar ganhadores em dobro — a 2ª tentativa vê o mês já sorteado
     e aborta sem escrever nada */
  await runTransaction(db,async tx=>{
   const cs=await tx.get(doc(db,"settings","cofre"));
   const cd=cs.exists()?cs.data():{};
   if((cd.lastDraw||{}).monthKey===mk)throw new Error("Este mês já foi sorteado.");
   tx.set(doc(db,"settings","cofre"),{pot:rem,totalPaid:increment(winners.length?pot-rem:0),lastDraw:drawDoc,updatedAt:serverTimestamp()},{merge:true});
   for(const wn of winners){
    tx.set(doc(db,"wallets",wn.uid),{change:increment(share),updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",wn.uid,"history")),{kind:"cofre_reward",amount:share,reason:"Prêmio do Cofre Real <i class=yi data-i=trophy></i> — número "+drawn+" sorteado em "+mk,createdAt:serverTimestamp()});
   }
   tx.set(doc(collection(db,"cofireDraws"),mk),drawDoc);
  });
  toast(winners.length?("Número "+drawn+" sorteado! "+winners.length+" ganhador(es) levaram "+fmtBRL(share)+" cada."):"Número "+drawn+" sorteado — ninguém acertou. O cofre de "+fmtBRL(pot)+" acumula para o próximo mês.");
  await loadAll();
 }catch(e){error(e)}
};

/* editor avançado: todos os campos da tarefa em uma tela só (legado) */
function editTaskAdvanced(t=null){

/* atualiza a lista de eventos no select toda vez que o editor abre */
const catIds=[...new Set([...catList().map(c=>c.id),...(t?.category?[t.category]:[]),...C.tasks.map(x=>x.category).filter(Boolean)])];
const fields=taskFields.map(f=>{
if(f.key==="eventId")return{...f,options:[{value:"",label:"— Oferta avulsa (aparece em Ofertas) —"},...C.events.map(e=>({value:e.id,label:e.name}))]};
if(f.key==="category")return{...f,options:catIds.map(c=>({value:c,label:catLabel(c)}))};
if(f.key==="difficulty")return{...f,options:["simple","medium","hard",...(t?.difficulty&&!["simple","medium","hard"].includes(t.difficulty)?[t.difficulty]:[])]};
if(f.key==="proofType")return{...f,options:Object.keys(PROOF_TYPES)};
return f;
});

editor(t?"Editar tarefa (avançado)":"Nova tarefa (avançado)",t,fields,async v=>{

if(!v.name.trim())throw new Error("Informe o nome da tarefa.");
if(v.reward<1)throw new Error("Recompensa inválida.");

v.active=v.active==="true";
v.requiresProof=v.requiresProof==="true";
v.autoApprove=v.autoApprove==="true";
v.featured=v.featured==="true";
v.showInOffers=v.showInOffers==="true";
v.priority=Math.max(0,Math.floor(Number(v.priority)||0));
v.dailyLimit=Math.max(0,Math.floor(Number(v.dailyLimit)||0));
v.stock=clampStock(v.stock);
if(v.reward!=null)v.reward=Math.max(0.01,Math.round((Number(v.reward)||0.01)*100)/100);

/* estoque: mantém o restante quando o total muda */
const prevStock=Math.max(0,Math.floor(Number(t?.stock)||0));
if(v.stock>0){
let left=Number(t?.stockLeft);
left=Number.isFinite(left)&&left>=0?Math.floor(left):v.stock;
/* nunca maior que o total de vagas (auto-repara dados antigos ao salvar) */
v.stockLeft=Math.min(v.stock,Math.max(0,left+(v.stock-prevStock)));
}else{v.stock=null;v.stockLeft=null}
if(v.dailyLimit===0)v.dailyLimit=null;

/* tarefa publicada nas Ofertas não pode pertencer a um evento */
if(v.showInOffers)v.eventId="";

await setDoc(doc(db,"tasks",t?.id||"task_"+Date.now()),{
...v,
updatedAt:serverTimestamp(),
...(t?{}:{createdAt:serverTimestamp()})
},{merge:true});

});

}

$("newTask").onclick=()=>editTask();
$("taskSearch").oninput=renderTasks;
$("taskFilter").onchange=renderTasks;
$("taskTypeFilter").onchange=renderTasks;
$("taskCatFilter").onchange=renderTasks;

/* ações em massa */
const checkedTasks=()=>[...document.querySelectorAll("[data-task-check]:checked")].map(i=>i.dataset.taskCheck);
async function bulkApply(patch,confirmMsg){
const ids=checkedTasks();
if(!ids.length)return toast("Marque pelo menos uma tarefa.");
if(confirmMsg&&!confirm(confirmMsg.replace("{n}",ids.length)))return;
try{
const b=writeBatch();
ids.forEach(id=>b.set(doc(db,"tasks",id),{...patch,updatedAt:serverTimestamp()},{merge:true}));
await b.commit();
/* ação em massa: avisa os donos de ofertas de colaboradores pausadas */
if(patch&&patch.active===false){
 C.tasks.filter(t=>ids.includes(t.id)&&t.source==="collab"&&t.ownerUid)
  .forEach(t=>notifyUser(t.ownerUid,"collab","Sua oferta foi pausada pela equipe","A oferta <b style='color:#fcd535'>"+esc(t.name||"")+"</b> foi pausada em ação em massa e saiu do ar no site."));
}
await loadAll();
toast("Tarefa(s) atualizada(s).");
}catch(e){error(e)}
}
$("bulkActivate").onclick=()=>bulkApply({active:true},"Ativar {n} tarefa(s)?");
$("bulkDeactivate").onclick=()=>bulkApply({active:false},"Pausar {n} tarefa(s)?");
$("bulkOffer").onclick=()=>bulkApply({showInOffers:true,eventId:""},"Publicar {n} tarefa(s) nas Ofertas?");
$("bulkUnoffer").onclick=()=>bulkApply({showInOffers:false},"Retirar {n} tarefa(s) das Ofertas?");
$("bulkDelete").onclick=async()=>{
const ids=checkedTasks();
if(!ids.length)return toast("Marque pelo menos uma tarefa.");
if(!confirm("Excluir "+ids.length+" tarefa(s)?"))return;
try{
const b=writeBatch();
ids.forEach(id=>b.delete(doc(db,"tasks",id)));
await b.commit();
await loadAll();
toast("Tarefa(s) excluída(s).");
}catch(e){error(e)}
};
$("bulkType").onclick=()=>{
const ids=checkedTasks();
if(!ids.length)return toast("Marque pelo menos uma tarefa.");
openModal("Alterar categoria do saldo",`
<div class="field"><label>Novo tipo para ${ids.length} tarefa(s)</label>
<select id="bulkTypeSel"><option value="common">Comum</option><option value="gold">Dourado</option><option value="vip">VIP</option></select></div>
<div class="actions"><button class="btn" id="bulkTypeGo">Aplicar</button></div>`);
$("bulkTypeGo").onclick=()=>{closeModal();bulkApply({ticketType:$("bulkTypeSel").value})};
};
$("bulkEvent").onclick=()=>{
const ids=checkedTasks();
if(!ids.length)return toast("Marque pelo menos uma tarefa.");
openModal("Mover tarefas para um evento",`
<div class="field"><label>Evento de destino</label>
<select id="bulkEventSel"><option value="">— Oferta avulsa (sem evento) —</option>${C.events.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("")}</select></div>
<div class="hint">Mover para um evento remove a tarefa das Ofertas avulsas (ela passa a aparecer dentro do card do evento no site).</div>
<div class="actions"><button class="btn" id="bulkEventGo">Aplicar</button></div>`);
$("bulkEventGo").onclick=()=>{
const ev=$("bulkEventSel").value;
closeModal();
bulkApply({eventId:ev,showInOffers:ev?"":false});
};
};
$("bulkSchedule").onclick=()=>{
const ids=checkedTasks();
if(!ids.length)return toast("Marque pelo menos uma tarefa.");
openModal("Agendar tarefas",`
<div class="form-grid">
<div class="field"><label>Início (vazio = começar já)</label><input type="datetime-local" id="bulkStart"></div>
<div class="field"><label>Encerramento</label><input type="datetime-local" id="bulkEnd"></div>
</div>
<div class="actions"><button class="btn" id="bulkSchedGo">Aplicar agenda</button></div>`);
$("bulkSchedGo").onclick=()=>{
const patch={};
if($("bulkStart").value)patch.startAt=toTimestamp($("bulkStart").value);
if($("bulkEnd").value)patch.endAt=toTimestamp($("bulkEnd").value);
if(!Object.keys(patch).length)return toast("Preencha ao menos uma data.");
closeModal();
bulkApply(patch);
};
};

/* ações por tarefa */
$("taskList").onclick=async e=>{

const edit=e.target.dataset.taskEdit;
const del=e.target.dataset.taskDel;
const copy=e.target.dataset.taskCopy;
const toggle=e.target.dataset.taskToggle;
const offer=e.target.dataset.taskOffer;
const up=e.target.dataset.taskUp;
const down=e.target.dataset.taskDown;
const claimsBtn=e.target.dataset.taskClaims;
const preview=e.target.dataset.taskPreview;
const collab=e.target.dataset.taskCollab;

if(collab){
const t=C.tasks.find(x=>x.id===collab);
if(!t)return;
/* confirmação com resumo antes de publicar: valor, vagas e taxa — o botão
   da lista não pula mais a conferência que o modal de revisão faz */
const rdP=Math.max(0.01,Math.round((Number(t.reward)||0.01)*100)/100);
const stP=Math.max(1,Math.floor(Number(t.stock)||0));
const curP=t.rewardCur||"brl";
const feeP=collabFee(rdP,t.ticketType||"common",stP,curP);
const curTxtP=curP==="ticket"?rdP+" bilhete(s) (≈ "+fmtBRL(rdP*CUR_BRL.ticket)+")":curP==="coin"?rdP+" Moeda(s) Yshipp (≈ "+fmtBRL(rdP*CUR_BRL.coin)+")":fmtBRL(rdP);
if(!confirm("Publicar a oferta do colaborador?\n\nTarefa: "+(t.name||"—")+"\nRecompensa por participante: "+curTxtP+"\nVagas: "+stP+"\nTaxa de publicação (30%): "+fmtBRL(feeP)+(Number(t.feePaid)>0?" (já retida no envio)":" (AINDA NÃO retida — confira o saldo do colaborador)")+"\n\nA oferta vai direto para o ar na seção Ofertas do site."))return;
await setDoc(doc(db,"tasks",collab),{active:true,collabStatus:"approved",updatedAt:serverTimestamp()},{merge:true});
/* sincroniza a Central do colaborador: o registro em collabTasks precisa
   acompanhar o mesmo estado (Pendente → Aprovada/Publicada), senão a
   tela do colaborador continua mostrando "Em análise" para sempre */
try{
 const cd=C.collabs.find(x=>x.id===t.collabId)||C.collabs.find(x=>(x.uid||x.ownerUid)===t.ownerUid&&x.name===t.name);
 if(cd){
  await setDoc(doc(db,"collabTasks",cd.id),{status:"approved",comment:cd.comment||"",publishedTaskId:t.id,reviewedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
 }else if(t.ownerUid){
  /* tarefa legada sem registro em collabTasks: cria o espelho para a
     Central do colaborador refletir o estado real */
  await setDoc(doc(collection(db,"collabTasks")),{uid:t.ownerUid,ownerName:t.ownerName||"",email:"",name:t.name||"Tarefa de colaborador",category:t.category||"",serviceId:t.serviceId||"",serviceLabel:t.serviceLabel||"",difficulty:t.difficulty||"simple",reward:Number(t.reward)||1,ticketType:t.ticketType||"common",stock:Number(t.stock)||0,description:t.description||"",steps:Array.isArray(t.steps)?t.steps:[],rules:Array.isArray(t.rules)?t.rules:[],requirements:Array.isArray(t.requirements)?t.requirements:[],extra:t.extra||"",reviewDays:Number(t.reviewDays)||3,link:t.link||"",proofReq:t.proofReq||{text:true},minProofs:1,proofDetails:"",status:"approved",publishedTaskId:t.id,feePaid:0,feeRefunded:false,createdAt:t.createdAt||serverTimestamp(),reviewedAt:serverTimestamp(),updatedAt:serverTimestamp()});
 }
}catch(e){console.warn("Sincronização collabTasks:",e)}
await loadAll();
return toast("Oferta do colaborador aprovada — já está no ar na seção Ofertas do site e aparece como <b>Publicada</b> na Central do colaborador.");
}

if(edit)return editTask(C.tasks.find(x=>x.id===edit));

if(copy){
const t=C.tasks.find(x=>x.id===copy);
if(!t)return;
const {id,...data}=t;
await setDoc(doc(db,"tasks","task_"+Date.now()),{
...data,
name:data.name+" (cópia)",
active:false,
createdAt:serverTimestamp(),
updatedAt:serverTimestamp()
},{merge:true});
await loadAll();
return toast("Tarefa duplicada como rascunho (inativa).");
}

if(toggle){
const t=C.tasks.find(x=>x.id===toggle);
if(!t)return;
await setDoc(doc(db,"tasks",toggle),{active:t.active===false,updatedAt:serverTimestamp()},{merge:true});
/* avisa o dono de oferta de colaborador quando ela entra/sai do ar */
if(t.source==="collab"&&t.ownerUid){
 const pausou=t.active!==false;
 notifyUser(t.ownerUid,"collab",pausou?"Sua oferta foi pausada pela equipe":"Sua oferta voltou ao ar",
  pausou
   ?"A oferta <b style='color:#fcd535'>"+esc(t.name||"")+"</b> foi pausada pela equipe e saiu do ar no site. Ela continua cadastrada — fale com o suporte para saber mais."
   :"A oferta <b style='color:#fcd535'>"+esc(t.name||"")+"</b> voltou ao ar na seção Ofertas dos colaboradores.");
}
await loadAll();
return toast(t.active===false?"Tarefa ativada.":"Tarefa pausada.");
}

if(offer){
const t=C.tasks.find(x=>x.id===offer);
if(!t)return;
const pub=t.showInOffers!==true;
await setDoc(doc(db,"tasks",offer),{showInOffers:pub,...(pub?{eventId:""}:{}),updatedAt:serverTimestamp()},{merge:true});
await loadAll();
return toast(pub?"Tarefa publicada nas Ofertas do site.":"Tarefa retirada das Ofertas.");
}

if(up||down){
const t=C.tasks.find(x=>x.id===(up||down));
if(!t)return;
const cur=Number(t.priority)||0;
await setDoc(doc(db,"tasks",t.id),{priority:Math.max(0,cur+(up?5:-5)),updatedAt:serverTimestamp()},{merge:true});
await loadAll();
return;
}

if(claimsBtn){
const t=C.tasks.find(x=>x.id===claimsBtn);
const list=C.claims.filter(c=>c.taskId===t.id);
openModal("Solicitações · "+(t?.name||""),list.length?list.map(c=>`
<div class="item" style="margin-bottom:8px">
<b>${esc(c.participantName||c.uid)}</b> <small>${esc(c.uid)}</small>
<p>${esc(c.proof||"—")}</p>
<p>${date(c.submittedAt)} · <span class="status ${c.status==="approved"?"green":c.status==="rejected"?"red":"yellow"}">${esc(c.status)}</span></p>
<div class="actions">
${c.status==="pending"?`<button class="btn success small" data-approve="${esc(c.id)}">Aprovar e creditar</button><button class="btn danger small" data-reject="${esc(c.id)}">Rejeitar</button>`:""}
${validUrl(c.proof)?`<a class="btn secondary small" href="${esc(c.proof)}" target="_blank" rel="noopener">Abrir comprovante</a>`:""}
</div>
</div>`).join(""):'<div class="empty">Nenhuma solicitação para esta tarefa.</div>');
return;
}

if(preview){
const t=C.tasks.find(x=>x.id===preview);
if(!t)return;
const cat={icon:catIcon(t.category),label:catLabel(t.category)};
const d=diffOf(t.difficulty);
const pr=t.proofReq||null;
const prN=pr?Object.keys(pr).filter(k=>pr[k]).length:0;
const steps=Array.isArray(t.steps)?t.steps.map(s=>String(s||"").trim()).filter(Boolean):[];
openModal("Pré-visualização (como no site)",`
<div style="border:1px solid var(--l);border-radius:10px;padding:16px;background:var(--p2)">
<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
<b>${cat.icon} ${esc(t.name)}</b>
<span>${d.dot} ${esc(d.label)}</span>
</div>
<p style="color:var(--mu);font-size:11px;margin-top:4px">Categoria: ${esc(cat.label)}${t.serviceLabel?" · Serviço: "+esc(t.serviceLabel):""} · clique no card abre a “área de trabalho”</p>
<p style="color:var(--mu);font-size:13px;margin-top:8px">${esc(t.description||"")}</p>
<p style="color:var(--mu);font-size:12px;margin-top:6px">${esc(t.rules||"")}</p>
${steps.length?`<div style="margin-top:8px">${steps.map((s,i)=>`<p style="font-size:12.5px;margin:4px 0"><b>${i+1}.</b> ${esc(s)}</p>`).join("")}</div>`:""}
${(Array.isArray(t.rules)?t.rules:String(t.rules||"").split("\n").filter(Boolean)).length?`<p style="margin:10px 0 2px"><b>Regras:</b></p>${(Array.isArray(t.rules)?t.rules:String(t.rules).split("\n").filter(Boolean)).map((s,i)=>`<p style="font-size:12.5px;margin:3px 0"><b>${i+1}.</b> ${esc(s)}</p>`).join("")}`:""}
${(t.requirements||[]).length?`<p style="margin:10px 0 0"><b>Requisitos:</b> ${(t.requirements||[]).map(esc).join(" · ")}</p>`:""}
${t.extra?`<p style="margin:10px 0 0"><b>Info adicional:</b> ${esc(t.extra)}</p>`:""}
${t.reviewDays?`<p style="margin:10px 0 0"><b>Prazo de avaliação:</b> ${Number(t.reviewDays)} dia(s)</p>`:""}
<div style="display:flex;justify-content:space-between;font-size:13px;margin-top:10px"><span style="color:var(--mu)">Recompensa</span><b>+${Number(t.reward)||1} ${esc(t.ticketType||"common")}</b></div>
${t.coupon?`<p style="margin-top:8px">Cupom: <b>${esc(t.coupon)}</b></p>`:""}
<div class="actions" style="margin-top:12px">
${validUrl(t.link)?`<a class="btn small" href="${esc(t.link)}" target="_blank" rel="noopener">Abrir tarefa</a>`:""}
<button class="btn secondary small">Solicitar conferência</button>
</div>
</div>
<p class="hint">No site, o participante clica no card para abrir a “área de trabalho”, envia o comprovante (${t.requiresProof===false?"esta tarefa não exige comprovante":prN?esc(Object.keys(pr).filter(k=>pr[k]).map(k=>PROOF_REQ_LABELS[k]).join(", "))+" — mínimo "+Math.max(1,Math.floor(Number(t.minProofs)||1))+" prova(s)":esc(PROOF_TYPES[t.proofType||"text"]||"texto")}) e ${t.autoApprove===true?"os reais são creditados na hora (aprovação automática)":"a solicitação entra na sua fila para aprovar ou rejeitar"}.</p>`);
return;
}

if(del){
if(!confirm("Excluir tarefa?"))return;
try{
const td=C.tasks.find(x=>x.id===del);
await deleteDoc(doc(db,"tasks",del));
/* avisa o dono quando a oferta dele é removida do site */
if(td&&td.source==="collab"&&td.ownerUid){
 notifyUser(td.ownerUid,"collab","Sua oferta foi removida pela equipe","A oferta <b style='color:#fcd535'>"+esc(td.name||"")+"</b> foi removida do site pela equipe. Se tiver dúvidas sobre o motivo, fale com o suporte.");
}
await loadAll();
toast("Tarefa excluída.");
}catch(e){error(e)}
}

};

/* VÍNCULOS */

function renderLinks(){

$("linkList").innerHTML=C.links.map(l=>`
<tr>
<td>${esc(C.events.find(x=>x.id===l.eventId)?.name||l.eventId)}</td>
<td>${esc(C.tasks.find(x=>x.id===l.taskId)?.name||l.taskId)}</td>
<td>${Number(l.order)||0}</td>
<td><button class="btn danger small" data-link-del="${esc(l.id)}">Remover</button></td>
</tr>
`).join("")||'<tr><td colspan="4" class="empty">Nenhum vínculo cadastrado.</td></tr>';

}

$("newLink").onclick=()=>{

openModal("Vincular tarefa a evento",`

<div class="field">
<label>Evento</label>
<select id="linkEvent">
${C.events.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("")}
</select>
</div>

<div class="field">
<label>Tarefa</label>
<select id="linkTask">
${C.tasks.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}
</select>
</div>

<div class="field">
<label>Ordem de exibição</label>
<input type="number" id="linkOrder" value="0">
</div>

<button class="btn" id="saveLink">Criar vínculo</button>

`);

$("saveLink").onclick=async()=>{

const eventId=$("linkEvent").value;
const taskId=$("linkTask").value;

if(!eventId||!taskId)return toast("Selecione evento e tarefa.");

if(C.links.some(l=>l.eventId===eventId&&l.taskId===taskId)){
return toast("Este vínculo já existe.");
}

try{
await addDoc(collection(db,"eventTasks"),{
eventId,
taskId,
order:Number($("linkOrder").value)||0,
createdAt:serverTimestamp()
});
closeModal();
await loadAll();
toast("Vínculo criado.");
}catch(e){error(e)}

};

};

$("linkList").onclick=async e=>{

const id=e.target.dataset.linkDel;
if(!id)return;
if(!confirm("Remover vínculo?"))return;

try{
await deleteDoc(doc(db,"eventTasks",id));
await loadAll();
toast("Vínculo removido.");
}catch(e){error(e)}

};

/* LEILÕES */

const AUCTION_FIELDS=[
{key:"name",label:"Nome do leilão"},
{key:"prize",label:"Prêmio oferecido"},
{key:"description",label:"Descrição do prêmio",type:"textarea"},
{key:"imageUrl",label:"Imagem (URL)",type:"url"},
{key:"minBid",label:"Lance mínimo (R$)",type:"number",default:1},
{key:"totalTickets",label:"Valor do prêmio · meta (R$)",type:"number",default:100},
{key:"status",label:"Status",type:"select",options:["draft","open","ended"]},
{key:"startAt",label:"Início",type:"date"},
{key:"endAt",label:"Fim do prazo",type:"date"}
];

function renderAuctions(){

$("auctionList").innerHTML=C.auctions.map(a=>{

const bids=C.bids.filter(b=>b.auctionId===a.id);
const tot=Math.max(0,Math.floor(Number(a.totalTickets)||0));
const raised=bids.reduce((s,b)=>s+Math.max(0,Math.floor(Number(b.amount)||0)),0);
const lead=[...bids].sort((x,y)=>(Number(y.amount)||0)-(Number(x.amount)||0))[0];
const res=a.result||{};
const ev=C.events.find(x=>x.id===a.eventId);
const claimable=a.status==="open"&&lead&&Math.max(0,Math.floor(Number(lead.amount)||0))>=tot;

return `
<div class="item">
<h3>${esc(a.name||"Leilão")}</h3>
<p>Prêmio: ${esc(a.prize||"—")}</p>
<p>${esc(a.description||"")}</p>
<p>Arrecadado: ${raised} / ${tot} ponto(s) · Lances: ${bids.length}${ev?" · Evento: "+esc(ev.name):""}</p>
<p>Líder: ${lead?esc(lead.displayName||lead.uid)+" ("+Math.max(0,Math.floor(Number(lead.amount)||0))+" pt)":"—"}</p>
<p>Status: <span class="status ${a.status==="open"?"green":"yellow"}">${esc(a.status)}</span>${res.winnerName?" · Ganhador: "+esc(res.winnerName):""}${claimable?' · <span class="status green">Pronto para reivindicação antecipada</span>':""}</p>
<div class="actions">
<button class="btn small" data-auc-edit="${esc(a.id)}">Editar</button>
${a.status!=="ended"?`<button class="btn success small" data-auc-end="${esc(a.id)}">Encerrar e apurar</button>`:""}
<button class="btn danger small" data-auc-del="${esc(a.id)}">Excluir</button>
</div>
</div>
`;

}).join("")||'<div class="empty">Nenhum leilão cadastrado.</div>';

}

function editAuction(a=null){

editor(a?"Editar leilão":"Novo leilão",a,[...AUCTION_FIELDS,{
key:"eventId",
label:"Evento do leilão (entrada do evento é exigida no site)",
type:"select",
options:[{value:"",label:"— sem evento —"},...C.events.map(e=>({value:e.id,label:e.name}))]
}],async v=>{

if(!v.name.trim())throw new Error("Informe o nome do leilão.");
if(v.minBid<1)throw new Error("Lance mínimo inválido.");
if(v.totalTickets<1)throw new Error("Meta em reais inválida.");

v.minBid=Math.max(1,Math.floor(v.minBid));
v.totalTickets=Math.max(1,Math.floor(v.totalTickets));

await setDoc(doc(db,"auctions",a?.id||"auction_"+Date.now()),{
...v,
updatedAt:serverTimestamp(),
...(a?{}:{createdAt:serverTimestamp()})
},{merge:true});

});

}

/* TUDO em uma única transação, com leitura FRESCA do leilão e dos lances:
   antes usava os lances carregados em C.bids (truncados em 2000) e gravava o
   resultado sem revalidar o status — duas apurações simultâneas podiam
   reembolsar em dobro e coroar dois ganhadores. */
async function settleAuctionTx(id){
return runTransaction(db,async tx=>{

const aRef=doc(db,"auctions",id);
const as=await tx.get(aRef);
if(!as.exists()||as.data().status!=="open")throw new Error("Este leilão já foi encerrado.");
const ad=as.data();

const bs=await tx.get(query(collection(db,"bids"),where("auctionId","==",id)));
const bids=bs.docs.map(d=>d.data());

const meta=Math.max(1,Math.floor(Number(ad.totalTickets)||1));
const total=bids.reduce((s,b)=>s+Math.max(0,Math.floor(Number(b.amount)||0)),0);

const refund=list=>{
for(const b of list){
const amt=Math.max(0,Math.floor(Number(b.amount)||0));
if(!b.uid||amt<1)continue;
tx.set(doc(db,"wallets",b.uid),{
change:increment(amt),
updatedAt:serverTimestamp()
},{merge:true});
tx.set(doc(collection(db,"wallets",b.uid,"history")),{
kind:"auction_refund",
amount:amt,
auctionId:id,
auctionName:ad.name||"",
createdAt:serverTimestamp()
});
}
};

if(!bids.length||total<meta){

refund(bids);

tx.set(aRef,{
status:"ended",
result:{
winnerUid:null,
winnerName:null,
winnerAmount:0,
totalRaised:total,
endedAt:serverTimestamp()
},
updatedAt:serverTimestamp()
},{merge:true});

return{ok:"Meta não atingida: "+fmtBRL(total)+"/"+fmtBRL(meta)+". Lances devolvidos."};

}

const sorted=[...bids].sort((x,y)=>(Number(y.amount)||0)-(Number(x.amount)||0));
const winner=sorted[0];

refund(sorted.slice(1));

tx.set(aRef,{
status:"ended",
result:{
winnerUid:winner.uid,
winnerName:winner.displayName||winner.uid||"—",
winnerAmount:Math.max(0,Math.floor(Number(winner.amount)||0)),
totalRaised:total,
endedAt:serverTimestamp()
},
updatedAt:serverTimestamp()
},{merge:true});

return{ok:"Leilão encerrado. Ganhador: "+(winner.displayName||winner.uid)+" com "+fmtBRL(Math.max(0,Math.floor(Number(winner.amount)||0)))+"."};

});
}

async function closeAuction(id){

const a=C.auctions.find(x=>x.id===id);
if(!a)return;
if(a.status==="ended")return toast("Este leilão já foi encerrado.");
if(!confirm("Encerrar e apurar este leilão? Os lances serão somados e o maior total vence."))return;
try{

const outcome=await settleAuctionTx(id);

await loadAll();
toast(outcome.ok);

}catch(e){error(e)}

}

/* varredura automática: apura leilões abertos cujo prazo já venceu,
   mesmo que nenhum visitante esteja com o site aberto no momento.
   A transação de apuração é idempotente (guarda status!=="open"), então
   painel e site podem varrer ao mesmo tempo sem risco de reembolso 2×. */
let lastAucSweep=0;
async function sweepExpiredAuctions(){
const now=Date.now();
if(now-lastAucSweep<60000)return;
lastAucSweep=now;
const exp=(C.auctions||[]).filter(a=>a.status==="open"&&a.endAt&&((stamp(a.endAt)?.getTime())||0)<=now);
for(const a of exp){
try{
const outcome=await settleAuctionTx(a.id);
await loadAll();
toast("Leilão “"+(a.name||"—")+"” encerrado automaticamente (prazo vencido). "+outcome.ok);
}catch(e){/* já encerrado por outro admin ou pelo site — ignora */}
}
}

$("newAuction").onclick=()=>editAuction();

$("auctionList").onclick=async e=>{

if(e.target.dataset.aucEdit){
editAuction(C.auctions.find(x=>x.id===e.target.dataset.aucEdit));
return;
}

if(e.target.dataset.aucEnd){
return closeAuction(e.target.dataset.aucEnd);
}

const del=e.target.dataset.aucDel;
if(del){
if(!confirm("Excluir este leilão? Os lances não serão devolvidos automaticamente."))return;
try{
await deleteDoc(doc(db,"auctions",del));
await loadAll();
toast("Leilão excluído.");
}catch(e){error(e)}
}

};

/* CAPAS DO SITE (carrossel de imagens exibido no site principal) */

const CV_POS_LABEL={

hero:"Topo (abaixo do carrossel principal)",

sorteios:"Acima da seção Sorteios",

premios:"Acima da seção Prêmios",

leiloes:"Acima da seção Leilões",

rodape:"Antes do rodapé"

};

let cvImages=[];

function cvCompress(file){

return new Promise((res,rej)=>{

try{

const r=new FileReader();

r.onerror=()=>rej(new Error("Não foi possível ler o arquivo."));

r.onload=()=>{

const img=new Image();

img.onerror=()=>rej(new Error("Arquivo de imagem inválido."));

img.onload=()=>{

const MAX=1280;

let w=img.width,h=img.height;

if(w>MAX){h=Math.round(h*MAX/w);w=MAX}

const c=document.createElement("canvas");

c.width=w;c.height=h;

c.getContext("2d").drawImage(img,0,0,w,h);

res(c.toDataURL("image/jpeg",.78));

};

img.src=r.result;

};

r.readAsDataURL(file);

}catch(e){rej(e)}

});

}

function cvRenderList(){

const box=$("cv_list");

if(!box)return;

if(!cvImages.length){box.innerHTML='<p class="empty">Nenhuma imagem ainda. Envie arquivos ou adicione por link.</p>';return}

box.innerHTML=cvImages.map((s,i)=>`

<div style="display:flex;gap:10px;align-items:center;border:1px solid var(--l);border-radius:8px;padding:6px">

<img src="${esc(s)}" alt="" style="width:76px;height:46px;object-fit:cover;border-radius:6px;flex:none">

<span class="hint" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Imagem ${i+1} · ${s.startsWith("data:")?"arquivo enviado":"link"} · ${Math.round(s.length/1024)} KB</span>

<button class="btn danger small" data-cvimg-del="${i}">Remover</button>

</div>`).join("");

}

function editCover(c=null){

cvImages=Array.isArray(c?.images)?c.images.filter(Boolean):[];

openModal(c?"Editar capa":"Nova capa",`

<div class="form-grid">

<div class="field"><label>Nome da capa (só para sua organização)</label><input id="cv_name" value="${esc(c?.name||"")}" placeholder="Ex.: Black Friday — topo do site"></div>

<div class="field"><label>Onde a capa aparece no site</label>

<select id="cv_position">

${Object.entries(CV_POS_LABEL).map(([v,l])=>`<option value="${v}" ${(c?.position||"hero")===v?"selected":""}>${l}</option>`).join("")}

</select>

</div>

<div class="field"><label>Capa ativa (aparece no site)</label><input id="cv_active" type="checkbox" ${c?.active!==false?"checked":""} style="width:18px;height:18px"></div>

</div>

<div class="field" style="margin-top:10px">

<label>Imagens do carrossel — cada uma desliza para o lado no site</label>

<input id="cv_file" type="file" accept="image/*" multiple>

<div style="display:flex;gap:8px;margin-top:8px">

<input id="cv_url" placeholder="…ou cole o link (URL) de uma imagem" style="flex:1">

<button class="btn secondary small" id="cv_addurl" type="button">Adicionar link</button>

</div>

</div>

<div id="cv_list" style="display:grid;gap:8px;margin:10px 0"></div>

<p class="hint">Imagens enviadas são reduzidas automaticamente (largura máx. 1280px). Limite total: 900 KB por capa — se precisar de muitas fotos, crie outra capa na mesma posição: elas se juntam no mesmo carrossel do site.</p>

<div class="actions">

<button class="btn" id="cv_save">Salvar capa</button>

<button class="btn secondary" id="cv_cancel">Cancelar</button>

</div>`);

cvRenderList();

$("cv_cancel").onclick=closeModal;

$("cv_file").onchange=async e=>{

const files=[...e.target.files];

e.target.value="";

for(const f of files){

try{

const data=await cvCompress(f);

cvImages.push(data);

cvRenderList();

toast("Imagem adicionada ("+Math.round(data.length/1024)+" KB).");

}catch(err){toast(err.message||"Erro ao processar a imagem.")}

}

};

$("cv_addurl").onclick=()=>{

const u=$("cv_url").value.trim();

if(!u)return toast("Cole o link da imagem primeiro.");

if(!validUrl(u))return toast("Link de imagem inválido.");

cvImages.push(u);

$("cv_url").value="";

cvRenderList();

};

$("cv_list").onclick=e=>{

const i=e.target.dataset.cvimgDel;

if(i!=null){cvImages.splice(Number(i),1);cvRenderList()}

};

$("cv_save").onclick=async()=>{

try{

const name=$("cv_name").value.trim();

if(!name)throw new Error("Informe um nome para a capa.");

const position=$("cv_position").value;

const active=$("cv_active").checked;

const total=cvImages.reduce((s,x)=>s+x.length,0);

if(total>900000)throw new Error("As imagens somam "+Math.round(total/1024)+" KB e passam de 900 KB. Remova algumas ou crie outra capa na mesma posição.");

if(!cvImages.length)toast("Salvando sem imagens: a capa só aparece no site depois de adicionar imagens.");

await setDoc(doc(db,"covers",c?.id||"cover_"+Date.now()),{

name,

position,

active,

images:cvImages,

updatedAt:serverTimestamp(),

...(c?{}:{createdAt:serverTimestamp()})

},{merge:true});

closeModal();

await loadAll();

toast("Capa salva! Aparece no site em: "+CV_POS_LABEL[position]+".");

}catch(e){error(e)}

};

}

function renderFeedback(){
 if(!$("fbList"))return;
 const FB_SECTIONS={geral:"Site em geral",sorteios:"Sorteios",leiloes:"Leilões",eventos:"Eventos",ofertas:"Tarefas / Ofertas","ofertas-colab":"Ofertas dos colaboradores",resultado:"Resultado oficial",anuncios:"Central de Anúncios","pesquisas-main":"Pesquisas","market-main":"Yshipp Market","carteira-main":"YshippWallet",cofre:"Cofre",comunidade:"Comunidade",suporte:"Suporte"};
 const FB_TYPES={avaliacao:"Avaliação",sugestao:"Sugestão",reclamacao:"Reclamação",problema:"Problema"};
 const fb=C.feedback||[];
 const news=fb.filter(f=>(f.status||"new")==="new");
 $("feedbackBadge").textContent=news.length;
 const rated=fb.filter(f=>Number(f.rating)>0);
 const avg=rated.length?(rated.reduce((s,f)=>s+Math.max(1,Math.min(5,Number(f.rating)||0)),0)/rated.length):0;
 /* tipos mais recorrentes */
 const byType=Object.entries(FB_TYPES).map(([k,l])=>[l,fb.filter(f=>f.type===k).length]);
 const bySec=Object.entries(FB_SECTIONS).map(([k,l])=>[l,fb.filter(f=>(f.section||"geral")===k).length]).sort((a,b)=>b[1]-a[1])[0];
 $("fbStats").innerHTML=[
  ["Recebidos",fb.length,""],
  ["Novos",news.length,"red"],
  ["Nota média",rated.length?avg.toFixed(1).replace(".",",")+" ★ ("+rated.length+")":"—","gold"],
  ["Mais relatado",bySec&&bySec[1]?bySec[0]:"—",""]
 ].map(([l,v,c])=>`<div class="card"><div class="stat-label">${esc(l)}</div><div class="stat-value ${c}">${esc(String(v))}</div></div>`).join("");
 /* filtros de seção */
 const sf=$("fbSecFilter");const cur=sf.value;
 sf.innerHTML='<option value="">Todas</option>'+Object.entries(FB_SECTIONS).map(([k,l])=>`<option value="${k}">${esc(l)}</option>`).join("");
 sf.value=(cur&&[...sf.options].some(o=>o.value===cur))?cur:"";
 const stf=$("fbStatusFilter").value||"all";
 const tyf=$("fbTypeFilter").value||"";
 const list=[...fb]
  .filter(f=>(!sf.value||(f.section||"geral")===sf.value)&&(stf==="all"||(f.status||"new")===stf)&&(!tyf||f.type===tyf))
  .sort((a,b)=>(stamp(b.createdAt)||0)-(stamp(a.createdAt)||0));
 $("fbList").innerHTML=list.length?list.map(f=>`
 <div class="item">
  <h3>${esc(FB_TYPES[f.type]||"Relato")} · ${esc(FB_SECTIONS[f.section||"geral"]||f.sectionLabel||"Seção")} ${Number(f.rating)>0?'<span class="status yellow">'+("★".repeat(Math.max(1,Math.min(5,Number(f.rating)))))+"</span>":""} ${(f.status||"new")==="new"?'<span class="status red">Novo</span>':'<span class="status green">Analisado</span>'}</h3>
  <p>${esc(f.message||"")}</p>
  <p class="hint">${esc(f.name||"Participante")} · ${esc(f.email||f.uid||"—")} · ${date(f.createdAt)}</p>
  <div class="actions">
  ${(f.status||"new")==="new"?`<button class="btn success small" data-fb-ok="${esc(f.id)}">Marcar como analisado</button>`:""}
  <button class="btn danger small" data-fb-del="${esc(f.id)}">Excluir</button>
  </div>
 </div>`).join(""):'<div class="empty">Nenhum feedback com esses filtros.</div>';
 /* editor de seções ativas (settings/platform.feedback) */
 const cfg=(C.settings?.feedback&&typeof C.settings.feedback==="object")?C.settings.feedback:{};
 $("fbSections").innerHTML=Object.entries(FB_SECTIONS).map(([k,l])=>`
  <label class="wiz-check"><input type="checkbox" data-fb-sec="${k}" ${(cfg.sections||{})[k]!==false?"checked":""}> ${esc(l)}</label>`).join("");
}
$("fbSecFilter").onchange=renderFeedback;
$("fbStatusFilter").onchange=renderFeedback;
$("fbTypeFilter").onchange=renderFeedback;
$("saveFbSections").onclick=async()=>{
 const sections={};
 document.querySelectorAll("[data-fb-sec]").forEach(x=>{sections[x.dataset.fbSec]=x.checked});
 try{
  await setDoc(doc(db,"settings","platform"),{feedback:{enabled:true,sections}},{merge:true});
  await loadAll();
  toast("Configuração de feedback salva — os botões do site já seguem essas escolhas.");
 }catch(e){error(e)}
};
document.addEventListener("click",async e=>{
 const ok=e.target.closest("[data-fb-ok]");
 if(ok){
  try{await updateDoc(doc(db,"feedback",ok.dataset.fbOk),{status:"reviewed",reviewedAt:serverTimestamp()});await loadAll();toast("Feedback marcado como analisado.")}catch(err){error(err)}
  return;
 }
 const del=e.target.closest("[data-fb-del]");
 if(del){
  if(!confirm("Excluir este feedback?"))return;
  try{await deleteDoc(doc(db,"feedback",del.dataset.fbDel));await loadAll();toast("Feedback excluído.")}catch(err){error(err)}
  return;
 }
});

/* ── Blocos da tela inicial do site (settings/platform.homeBlocks) ── */
const HOME_BLOCK_LABELS={eventos:"Eventos",ofertas:"Tarefas / Ofertas","ofertas-colab":"Ofertas dos colaboradores",sorteios:"Sorteios",leiloes:"Leilões",resultado:"Resultado oficial",anuncios:"Central de Anúncios","pesquisas-main":"Pesquisas","market-main":"Yshipp Market","carteira-main":"YshippWallet",cofire:"Cofre Real"};
function homeBlocksState(){
 const cfg=C.settings?.homeBlocks;
 const blocks=Array.isArray(cfg?.blocks)?cfg.blocks.filter(b=>b&&b.id):[];
 const ids=[...new Set([...blocks.map(b=>b.id),...Object.keys(HOME_BLOCK_LABELS)])];
 return {enabled:cfg?.enabled!==false,blocks:ids.map(id=>({...blocks.find(b=>b.id===id),id}))};
}
function renderHomeBlocks(){
 const ed=$("homeBlocksEditor");if(!ed)return;
 const st=homeBlocksState();
 ed.innerHTML=
  `<label class="wiz-check" style="margin-bottom:12px"><input type="checkbox" id="hb-enabled" ${st.enabled?"checked":""}> <b>Home personalizada ativa</b> — desmarcado, o site usa a ordem padrão.</label>`+
  st.blocks.map((b,i)=>`
  <div class="card" style="padding:12px;margin-bottom:10px">
   <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <label class="wiz-check" style="margin:0"><input type="checkbox" data-hb="show" data-hb-id="${esc(b.id)}" ${b.show!==false?"checked":""}> <b>${esc(HOME_BLOCK_LABELS[b.id]||b.id)}</b></label>
    <span style="margin-left:auto;display:flex;gap:4px">
     <button class="btn secondary small" data-hb-up="${i}" ${i===0?"disabled":""}>↑</button>
     <button class="btn secondary small" data-hb-down="${i}" ${i===st.blocks.length-1?"disabled":""}>↓</button>
    </span>
   </div>
   <div class="form-grid" style="margin-top:10px">
    <div class="field" style="margin:0"><label>Título próprio (opcional)</label><input data-hb="title" data-hb-id="${esc(b.id)}" value="${esc(b.title||"")}" placeholder="Padrão do site"></div>
    <div class="field" style="margin:0"><label>Formato</label>
     <select data-hb="format" data-hb-id="${esc(b.id)}">
      <option value="carousel" ${(b.format||"carousel")==="carousel"?"selected":""}>Carrossel horizontal</option>
      <option value="stack" ${b.format==="stack"?"selected":""}>Empilhado (um abaixo do outro)</option>
     </select></div>
    <div class="field" style="margin:0"><label>Itens por resumo (0 = todos)</label><input type="number" min="0" max="30" step="1" data-hb="count" data-hb-id="${esc(b.id)}" value="${Number(b.count)||0}"></div>
   </div>
   <div class="field" style="margin:10px 0 0"><label>Descrição própria (opcional · aceita HTML simples)</label><textarea data-hb="desc" data-hb-id="${esc(b.id)}" rows="2" placeholder="Padrão do site">${esc(b.desc||"")}</textarea></div>
  </div>`).join("");
}
function homeBlocksCollect(){
 const enabled=$("hb-enabled").checked;
 const order=[];
 const seen=new Set();
 $("homeBlocksEditor").querySelectorAll('[data-hb="title"]').forEach(x=>{
  const id=x.dataset.hbId;
  if(seen.has(id))return;seen.add(id);
  const q=k=>$("homeBlocksEditor").querySelector('[data-hb="'+k+'"][data-hb-id="'+id+'"]');
  order.push({
   id,
   show:q("show").checked,
   title:q("title").value.trim(),
   desc:q("desc").value.trim(),
   format:q("format").value,
   count:Math.max(0,Math.floor(Number(q("count").value)||0))
  });
 });
 return {enabled,blocks:order};
}
document.addEventListener("click",async e=>{
 const up=e.target.closest("[data-hb-up]"),down=e.target.closest("[data-hb-down]");
 if(up||down){
  const st=homeBlocksState();
  const cur=homeBlocksCollect().blocks;
  const cfgBlocks=st.blocks.map(b=>({...cur.find(x=>x.id===b.id)||{id:b.id,show:b.show!==false,title:"",desc:"",format:"carousel",count:0},id:b.id}));
  const idx=up?Number(up.dataset.hbUp):Number(down.dataset.hbDown);
  const j=up?idx-1:idx+1;
  if(j<0||j>=cfgBlocks.length)return;
  const tmp=cfgBlocks[idx];cfgBlocks[idx]=cfgBlocks[j];cfgBlocks[j]=tmp;
  await setDoc(doc(db,"settings","platform"),{homeBlocks:{enabled:$("hb-enabled").checked,blocks:cfgBlocks}},{merge:true});
  C.settings={...(C.settings||{}),homeBlocks:{enabled:$("hb-enabled").checked,blocks:cfgBlocks}};
  renderHomeBlocks();
  toast("Ordem atualizada. Continue ajustando ou salve.");
  return;
 }
 if(e.target.closest("#saveHomeBlocks")){
  const hb=homeBlocksCollect();
  try{
   await setDoc(doc(db,"settings","platform"),{homeBlocks:hb},{merge:true});
   C.settings={...(C.settings||{}),homeBlocks:hb};
   toast("Blocos da tela inicial salvos — o site já segue essa montagem.");
  }catch(err){error(err)}
  return;
 }
 if(e.target.closest("#resetHomeBlocks")){
  const hb={enabled:true,blocks:Object.keys(HOME_BLOCK_LABELS).map(id=>({id,show:true,title:"",desc:"",format:"carousel",count:0}))};
  try{
   await setDoc(doc(db,"settings","platform"),{homeBlocks:hb},{merge:true});
   C.settings={...(C.settings||{}),homeBlocks:hb};
   renderHomeBlocks();
   toast("Ordem padrão restaurada.");
  }catch(err){error(err)}
  return;
 }
});

function renderCovers(){

$("coverList").innerHTML=C.covers.map(c=>{

const imgs=Array.isArray(c.images)?c.images.filter(Boolean):[];

const kb=Math.round(imgs.reduce((s,x)=>s+(x||"").length,0)/1024);

return `

<div class="item">

<h3>${esc(c.name||"Capa")}</h3>

<p>Onde aparece: ${esc(CV_POS_LABEL[c.position]||c.position||"—")}</p>

<p>Imagens no carrossel: ${imgs.length}${imgs.length?" · "+kb+" KB":" (sem imagens — não aparece no site)"}</p>

<p>Status: <span class="status ${c.active!==false?"green":"yellow"}">${c.active!==false?"Ativa":"Inativa"}</span></p>

<div class="actions">

<button class="btn small" data-cover-edit="${esc(c.id)}">Editar</button>

<button class="btn danger small" data-cover-del="${esc(c.id)}">Excluir</button>

</div>

</div>`;

}).join("")||'<div class="empty">Nenhuma capa cadastrada. Clique em "+ Nova capa" para enviar imagens que deslizarão no site. Sem capa, o site segue normal, como se nada existisse ali.</div>';

}

$("newCover").onclick=()=>editCover(null);

$("coverList").onclick=async e=>{

const edit=e.target.dataset.coverEdit;

if(edit)return editCover(C.covers.find(c=>c.id===edit));

const del=e.target.dataset.coverDel;

if(del){

if(!confirm("Excluir esta capa? O carrossel sai do site."))return;

try{

await deleteDoc(doc(db,"covers",del));

await loadAll();

toast("Capa excluída.");

}catch(e){error(e)}

}

};

/* SOLICITAÇÕES E RECOMPENSAS */

function renderClaims(){

const filter=$("claimFilter").value;

const list=C.claims.filter(c=>filter==="all"||c.status===filter).sort((a,b)=>(stamp(b.submittedAt)||0)-(stamp(a.submittedAt)||0));

$("claimList").innerHTML=list.map(c=>{

const task=C.tasks.find(t=>t.id===c.taskId);

return `
<tr>
<td>
${uava(c,esc(c.participantName||"P"))}
${esc(c.participantName||"Participante")}
<small>${esc(c.uid)}</small>
</td>

<td>
${esc(task?.name||c.taskId)}
<small>${Number(task?.reward)||1} ${esc(task?.ticketType||"common")}</small>
${task?.source==="collab"?`<small><i class=yi data-i=handshake></i> colaborador${task.ownerName?" · "+esc(task.ownerName):""} — a inspeção das provas é dele no site</small>`:""}
</td>

<td>
${proofCount(c)?`<button class="btn secondary small" data-proof="${esc(c.id)}">Visualizar (${proofCount(c)})</button>`:"—"}
</td>

<td><span class="status ${c.status==="approved"?"green":c.status==="rejected"?"red":"yellow"}">${esc(c.status==="changes"?"correção pedida":c.status)}</span>
${String(c.reviewedBy||"").startsWith("collab:")?'<small>avaliada pelo colaborador <i class=yi data-i=handshake></i></small>':""}
${c.disputeResolved?'<small><i class=yi data-i=shield></i> revertida pelo suporte</small>':""}
</td>

<td>
${(c.status==="pending"||c.status==="changes")?`
<button class="btn success small" data-approve="${esc(c.id)}">Aprovar</button>
<button class="btn danger small" data-reject="${esc(c.id)}">Rejeitar</button>
${task?.source==="collab"?'<small>intervenção da equipe (sobrepondo o colaborador)</small>':""}
`:"—"}
</td>
</tr>
`;

}).join("")||'<tr><td colspan="5" class="empty">Nenhuma solicitação encontrada.</td></tr>';

}

$("claimFilter").onchange=renderClaims;

$("claimList").onclick=async e=>{

const proof=e.target.dataset.proof;
const approve=e.target.dataset.approve;
const reject=e.target.dataset.reject;

if(proof){

const c=C.claims.find(x=>x.id===proof);
if(!c)return;

openModal("Comprovante enviado",`
<div class="field">
<label>Participante</label>
<input readonly value="${esc(c.participantName||c.uid)}${charOf(c.photoMode)?" · personagem "+charName(c.photoMode):""}">
</div>
${(()=>{const u=C.users.find(x=>x.id===c.uid);return u?`
<div class="field">
<label>Personagem do perfil no site</label>
<input readonly value="${u.name?esc(u.name)+" · ":""}${charOf(u.photoMode)?charName(u.photoMode)+" ("+String(u.photoMode||"").replace(/^ch:/,"")+")":"inicial dourada (nenhum personagem escolhido)"}">
</div>`:""})()}
${c.proofText?`
<div class="proof-block">
<label><i class=yi data-i=note></i> Texto da prova</label>
<p>${esc(c.proofText)}</p>
</div>`:""}
${c.proofCode?`
<div class="proof-block">
<label><i class=yi data-i=key></i> Código / cupom usado</label>
<p><b style="font-family:var(--mono)">${esc(c.proofCode)}</b></p>
</div>`:""}
${c.proofImage?`
<div class="proof-block">
<label><i class=yi data-i=image></i> Print (link da imagem)</label>
<p>${esc(c.proofImage)}</p>
${validUrl(c.proofImage)?`<a class="btn secondary small" style="margin-top:8px" href="${esc(c.proofImage)}" target="_blank" rel="noopener">Abrir print</a>`:""}
</div>`:""}
${c.proofVideo?`
<div class="proof-block">
<label><i class=yi data-i=video></i> Gravação de tela (link)</label>
<p>${esc(c.proofVideo)}</p>
${validUrl(c.proofVideo)?`<a class="btn secondary small" style="margin-top:8px" href="${esc(c.proofVideo)}" target="_blank" rel="noopener">Abrir gravação</a>`:""}
</div>`:""}
${c.proofWhen?`
<div class="proof-block">
<label><i class=yi data-i=clock></i> Data e hora da execução</label>
<p><b style="font-family:var(--mono)">${esc(c.proofWhen)}</b></p>
</div>`:""}
${(!c.proofText&&!c.proofCode&&!c.proofImage&&!c.proofVideo&&c.proof)?`
<div class="proof-block">
<label>Comprovante (formato antigo)</label>
<p>${esc(c.proof)}</p>
${validUrl(c.proof)?`<a class="btn secondary small" style="margin-top:8px" href="${esc(c.proof)}" target="_blank" rel="noopener">Abrir comprovante</a>`:""}
</div>`:""}
${proofCount(c)?"":'<p class="hint">Nenhuma prova anexada nesta solicitação.</p>'}
`);
return;

}

if(approve)return approveClaim(approve);
if(reject)return rejectClaim(reject);

};

/* aprovar/rejeitar também de dentro dos modais (solicitações por tarefa) */
$("modalBody").addEventListener("click",e=>{
if(e.target.dataset.approve)return approveClaim(e.target.dataset.approve);
if(e.target.dataset.reject)return rejectClaim(e.target.dataset.reject);
});

async function approveClaim(id){

if(!confirm("Aprovar esta tarefa e creditar os reais automaticamente?"))return;

const claim=C.claims.find(x=>x.id===id);
if(!claim)return;

const task=C.tasks.find(x=>x.id===claim.taskId);

if(!task)return toast("Tarefa não encontrada.");

/* regras da tarefa: estoque de vagas e limite diário de aprovações */
const left=stockLeft(task);
if(left!==null&&left<=0)return toast("Estoque desta tarefa está esgotado ("+task.stock+" vagas).");

if(task.dailyLimit>0){
const today=new Date().toDateString();
const doneToday=C.claims.filter(x=>x.taskId===claim.taskId&&x.status==="approved"&&stamp(x.reviewedAt)&&stamp(x.reviewedAt).toDateString()===today).length;
if(doneToday>=task.dailyLimit)return toast("Limite diário desta tarefa atingido ("+task.dailyLimit+" aprovações/dia). Tente amanhã.");
}

const uid=claim.uid;
const type=task.ticketType||"common";
const reward=Math.max(0.01,Math.round((Number(task.reward)||0.01)*100)/100);

try{

await runTransaction(db,async tx=>{

const claimRef=doc(db,"taskClaims",id);
const walletRef=doc(db,"wallets",uid);
const userRef=doc(db,"users",uid);

const [cs,ws,us,ts]=await Promise.all([
tx.get(claimRef),
tx.get(walletRef),
tx.get(userRef),
task.stock>0?tx.get(doc(db,"tasks",claim.taskId)):Promise.resolve(null)
]);

if(!cs.exists())throw new Error("Solicitação não encontrada.");

/* só "pending": claim em "changes" ainda não foi reenviada pelo participante */
if(cs.data().status!=="pending"){
throw new Error("Esta solicitação já foi processada ou aguarda a correção do participante.");
}

if(!us.exists())throw new Error("Participante não encontrado.");
/* Turbo Tarefas: buff ativo do participante, lido fresco dentro da transação */
const wb=ws.exists?ws.data():{};
const nowB=Date.now();
const bp=Math.min(200,(Array.isArray(wb.buffs)?wb.buffs:[]).reduce((s,b)=>{if(!b||!b.effect||b.effect.type!=="taskBoost")return s;const st=typeof b.startsAt==="number"?b.startsAt:(b.startsAt&&b.startsAt.toDate?b.startsAt.toDate().getTime():((b.startsAt&&b.startsAt.seconds)||0)*1000);const end=b.endsAtMs?b.endsAtMs:st+(Number(b.durDays)||7)*864e5;return end>nowB?s+(Number(b.effect.pct)||0):s},0));
const rew=bp?reward+Math.ceil(reward*bp/100):reward;

tx.set(walletRef,{
[type]:increment(rew),
updatedAt:serverTimestamp()
},{merge:true});

tx.update(claimRef,{
status:"approved",
reviewedAt:serverTimestamp(),
reviewedBy:C.admin.uid,
reward:rew,
ticketType:type
});

/* baixa 1 vaga do estoque da tarefa — lida DENTRO da transação, com leitura
   fresca do documento: antes usava o valor carregado antes (left-1) e duas
   aprovações simultâneas gravavam o mesmo número, vendendo vagas além do total */
if(task.stock>0){
const td=ts&&ts.exists?ts.data():{};
const totT=Math.max(0,Math.floor(Number(td.stock)||0));
const leftT=Number.isFinite(Number(td.stockLeft))?Math.floor(Number(td.stockLeft)):totT;
if(leftT<=0)throw new Error("Estoque desta tarefa está esgotado ("+totT+" vagas).");
tx.set(doc(db,"tasks",claim.taskId),{
stockLeft:Math.max(0,leftT-1),
updatedAt:serverTimestamp()
},{merge:true});
}

tx.set(doc(collection(db,"wallets",uid,"history")),{
kind:"reward",
amount:rew,
ticketType:type,
taskId:claim.taskId,
taskName:task.name||"",
eventName:C.events.find(x=>x.id===claim.eventId)?.name||"",
createdAt:serverTimestamp()
});

});

await loadAll();
toast(fmtBRL(rew)+" creditado(s) com sucesso.");
notifyUser(uid,"tasks","<i class=yi data-i=checkc></i> Tarefa aprovada!","Sua participação em <b style='color:#fcd535'>"+esc(task.name||"tarefa")+"</b> foi aprovada e <b>"+fmtBRL(rew)+"</b> já estão na sua carteira. Acompanhe no histórico da carteira.","#wallet");

}catch(e){error(e)}

}

async function rejectClaim(id){

const reason=prompt("Informe o motivo da rejeição:");

if(reason===null)return;

try{

await runTransaction(db,async tx=>{

const ref=doc(db,"taskClaims",id);
const snap=await tx.get(ref);

if(!snap.exists())throw new Error("Solicitação não encontrada.");
if(snap.data().status!=="pending"&&snap.data().status!=="changes")throw new Error("Solicitação já processada.");

tx.update(ref,{
status:"rejected",
rejectionReason:reason.slice(0,500),
reviewedAt:serverTimestamp(),
reviewedBy:C.admin.uid
});

});

await loadAll();
toast("Solicitação rejeitada.");
const cl2=C.claims.find(x=>x.id===id);
notifyUser(cl2?.uid,"tasks","<i class=yi data-i=ban></i> Tarefa rejeitada","Sua participação em <b style='color:#fcd535'>"+esc(cl2?.taskId||"tarefa")+"</b> foi rejeitada pela equipe. Motivo: <i>"+esc(reason.slice(0,500))+"</i>. Você pode conferir os detalhes em Minhas tarefas.","#participar");

}catch(e){error(e)}

}

/* DISPUTAS · casos levados ao suporte pelos participantes (má-fé na avaliação) */

function renderDisputes(){

if(!$("disputeList"))return;

const f=$("disputeFilter").value||"open";

const open=C.disputes.filter(d=>(d.status||"open")==="open").length;

$("disputesBadge").textContent=open;

const list=[...C.disputes]
.filter(d=>f==="all"||(f==="open"?(d.status||"open")==="open":d.status===f))
.sort((a,b)=>(stamp(b.createdAt)||0)-(stamp(a.createdAt)||0));

$("disputeList").innerHTML=list.map(d=>{

const st=d.status||"open";

return `
<tr>
<td>
${uava(d,esc(d.participantName||"P"))}
${esc(d.participantName||"—")}
<small>${esc(d.uid||"")}</small>
</td>

<td>
${esc(d.taskName||d.taskId)}
<small class="mono">ID ${esc(d.taskId)}</small>
</td>

<td>
${esc(d.ownerName||"—")}
<small><i class=yi data-i=handshake></i> colaborador dono da tarefa</small>
</td>

<td style="max-width:260px">${esc(d.reason||"—")}</td>

<td><span class="status ${st==="open"?"red":st==="resolved"?"green":""}">${st==="open"?"aberta":st==="resolved"?"resolvida (pagou)":st}</span>
<small>${d.resolution?esc(d.resolution):""}</small>
<small>${date(d.createdAt)}</small>
</td>

<td>
${st==="open"?`
<button class="btn success small" data-dresolve="${esc(d.id)}">Dar razão e pagar</button>
<button class="btn secondary small" data-dview="${esc(d.id)}">Ver provas</button>
<button class="btn danger small" data-darchive="${esc(d.id)}">Arquivar</button>
`:`<button class="btn secondary small" data-dview="${esc(d.id)}">Ver provas</button>`}
</td>
</tr>
`;

}).join("")||'<tr><td colspan="6" class="empty">Nenhuma disputa nesta visão. Quando um participante levar um caso ao suporte pelo site (botão “Levar o caso ao suporte” na área de trabalho da tarefa), ele aparece aqui.</td></tr>';

}

$("disputeFilter").onchange=renderDisputes;

$("disputeList").onclick=async e=>{

const view=e.target.dataset.dview;

if(view){

const d=C.disputes.find(x=>x.id===view);

if(!d)return;

openModal("Disputa · "+(d.taskName||d.taskId),`
<p class="hint">Participante: <b>${esc(d.participantName||"—")}</b> (${esc(d.uid||"")}) · Tarefa: <b>${esc(d.taskName||"")}</b> · ID: <b class="mono">${esc(d.taskId)}</b><br>Colaborador: <b>${esc(d.ownerName||"—")}</b> (${esc(d.ownerUid||"")}) · ${date(d.createdAt)}</p>
<div class="proof-block">
<label><i class=yi data-i=warn></i> Motivo do participante</label>
<p>${esc(d.reason||"—")}</p>
</div>
${d.proofText?`
<div class="proof-block">
<label><i class=yi data-i=note></i> Texto da prova</label>
<p>${esc(d.proofText)}</p>
</div>`:""}
${d.proofCode?`
<div class="proof-block">
<label><i class=yi data-i=key></i> Código / cupom usado</label>
<p><b style="font-family:var(--mono)">${esc(d.proofCode)}</b></p>
</div>`:""}
${d.proofImage?`
<div class="proof-block">
<label><i class=yi data-i=image></i> Print (link da imagem)</label>
<p>${esc(d.proofImage)}</p>
${validUrl(d.proofImage)?`<a class="btn secondary small" style="margin-top:8px" href="${esc(d.proofImage)}" target="_blank" rel="noopener">Abrir print</a>`:""}
</div>`:""}
${d.proofVideo?`
<div class="proof-block">
<label><i class=yi data-i=video></i> Gravação de tela (link)</label>
<p>${esc(d.proofVideo)}</p>
${validUrl(d.proofVideo)?`<a class="btn secondary small" style="margin-top:8px" href="${esc(d.proofVideo)}" target="_blank" rel="noopener">Abrir gravação</a>`:""}
</div>`:""}
${d.proofWhen?`
<div class="proof-block">
<label><i class=yi data-i=clock></i> Data e hora da execução</label>
<p><b style="font-family:var(--mono)">${esc(d.proofWhen)}</b></p>
</div>`:""}
${(!d.proofText&&!d.proofCode&&!d.proofImage&&!d.proofVideo)?'<p class="hint">Nenhuma prova anexada a este caso.</p>':""}
<div class="actions">
${(d.status||"open")==="open"?`
<button class="btn success" data-dresolve="${esc(d.id)}"><i class=yi data-i=checkc></i> Dar razão ao participante (aprovar e pagar)</button>
<button class="btn danger" data-darchive="${esc(d.id)}">Arquivar (manter decisão do colaborador)</button>
`:'<p class="hint">Caso já encerrado.</p>'}
</div>
`);

return;

}

if(e.target.dataset.dresolve)return resolveDispute(e.target.dataset.dresolve);

if(e.target.dataset.darchive)return archiveDispute(e.target.dataset.darchive);

};

/* aprovar também de dentro do modal da disputa */
$("modalBody").addEventListener("click",e=>{
if(e.target.dataset.dresolve)return resolveDispute(e.target.dataset.dresolve);
if(e.target.dataset.darchive)return archiveDispute(e.target.dataset.darchive);
});

async function resolveDispute(id){

const d=C.disputes.find(x=>x.id===id);

if(!d)return;

if((d.status||"open")!=="open")return toast("Esta disputa já foi encerrada.");

const task=C.tasks.find(t=>t.id===d.taskId);

if(!task)return toast("Tarefa não encontrada — verifique o ID "+(d.taskId||"")+".");

const reward=Math.max(0.01,Math.round((Number(task.reward)||0.01)*100)/100);

const type=task.ticketType||"common";

if(!confirm("Dar razão ao participante?\n\nA prova será APROVADA e "+fmtBRL(reward)+" creditados na carteira dele agora. A decisão do colaborador "+(d.ownerName||"")+" é revertida."))return;

try{

await runTransaction(db,async tx=>{

const ref=doc(db,"taskClaims",d.claimId);

const cs=await tx.get(ref);

if(!cs.exists())throw new Error("Solicitação não encontrada (o participante pode ter reenviado a prova).");
/* Turbo Tarefas: buff ativo do participante, lido fresco dentro da transação */
const wsx=await tx.get(doc(db,"wallets",d.uid));
const wb=wsx.exists?wsx.data():{};
const nowB=Date.now();
const bp=Math.min(200,(Array.isArray(wb.buffs)?wb.buffs:[]).reduce((s,b)=>{if(!b||!b.effect||b.effect.type!=="taskBoost")return s;const st=typeof b.startsAt==="number"?b.startsAt:(b.startsAt&&b.startsAt.toDate?b.startsAt.toDate().getTime():((b.startsAt&&b.startsAt.seconds)||0)*1000);const end=b.endsAtMs?b.endsAtMs:st+(Number(b.durDays)||7)*864e5;return end>nowB?s+(Number(b.effect.pct)||0):s},0));
const rew=bp?reward+Math.ceil(reward*bp/100):reward;

if(cs.data().status!=="approved"){

tx.set(doc(db,"wallets",d.uid),{

[type]:increment(rew),

updatedAt:serverTimestamp()

},{merge:true});

tx.set(doc(collection(db,"wallets",d.uid,"history")),{

kind:"reward",

amount:rew,

ticketType:type,

taskId:d.taskId,

taskName:d.taskName||"",

reason:"Disputa resolvida a favor do participante pelo suporte <i class=yi data-i=shield></i>",

createdAt:serverTimestamp()

});

tx.update(ref,{

status:"approved",

reviewedAt:serverTimestamp(),

reviewedBy:C.admin.uid,

reviewerName:"Suporte",

disputeResolved:true

});

}

tx.set(doc(db,"disputes",id),{

status:"resolved",

resolution:"Aprovada pelo suporte — reais creditados ao participante",

resolvedAt:serverTimestamp()

},{merge:true});

});

await loadAll();

toast("Disputa resolvida: "+fmtBRL(reward)+" creditado(s) ao participante.");

}catch(e){error(e)}

}

async function archiveDispute(id){

const d=C.disputes.find(x=>x.id===id);

if(!d)return;

if((d.status||"open")!=="open")return toast("Esta disputa já foi encerrada.");

const note=prompt("Arquivar mantendo a decisão do colaborador?\n\nRegistro (opcional):");

if(note===null)return;

try{

await setDoc(doc(db,"disputes",id),{

status:"archived",

resolution:"Arquivada pelo suporte"+(note?" — "+note.slice(0,300):""),

resolvedAt:serverTimestamp()

},{merge:true});

await loadAll();

toast("Disputa arquivada.");

}catch(e){error(e)}

}

/* PARTICIPANTES */

function renderUsers(){

const term=$("userSearch").value.toLowerCase();

const list=C.users.filter(u=>
String(u.name||"").toLowerCase().includes(term)||
String(u.email||"").toLowerCase().includes(term)
);

$("userList").innerHTML=list.map(u=>`
<tr>
<td>${uava(u,esc(u.name||u.email||"?"))} ${esc(u.name||"Não informado")}</td>
<td>${esc(u.email||"—")}</td>
<td>${date(u.createdAt)}</td>
<td>${u.banned?'<span class="status red">Banido</span>':'<span class="status green">Ativo</span>'}</td>
<td>
<button class="btn secondary small" data-user="${esc(u.id)}">Detalhes</button>
${u.banned?`<button class="btn success small" data-unban="${esc(u.id)}">Desbanir</button>`:`<button class="btn danger small" data-ban="${esc(u.id)}">Banir</button>`}
</td>
</tr>
`).join("")||'<tr><td colspan="5" class="empty">Nenhum participante encontrado.</td></tr>';

renderNotifTargets();
renderNotifList();

}

$("userSearch").oninput=renderUsers;

$("userList").onclick=async e=>{

const ban=e.target.dataset.ban;
const unban=e.target.dataset.unban;
const id=e.target.dataset.user;

if(ban)return banUser(C.users.find(x=>x.id===ban));
if(unban)return unbanUser(C.users.find(x=>x.id===unban));
if(!id)return;

const u=C.users.find(x=>x.id===id);
if(!u)return;

let wallet={};

try{
const s=await getDoc(doc(db,"wallets",id));
if(s.exists())wallet=s.data();
}catch(e){error(e);return}

const addr=u.address||{};

openModal("Dados do participante",`

<div class="actions" style="margin:0 0 14px">
${u.banned?'<span class="status red">Conta banida</span>':'<span class="status green">Conta ativa</span>'}
${u.banned&&u.bannedReason?`<small class="hint">Motivo: ${esc(u.bannedReason)}</small>`:""}
</div>

<div class="field">
<label>Nome completo</label>
<input readonly value="${esc(u.name||"")}">
</div>

<div class="field">
<label>Personagem do perfil (foto exibida no site para todos)</label>
<input readonly value="${charOf(u.photoMode)?charOf(u.photoMode)+" · "+String(u.photoMode||"").replace(/^ch:/,""):"Inicial dourada (nenhum personagem escolhido)"}">
</div>

<div class="field">
<label>E-mail</label>
<input readonly value="${esc(u.email||"")}">
</div>

<div class="form-grid">
<div class="field">
<label>Nascimento</label>
<input readonly value="${esc(u.birthDate||"—")}">
</div>
<div class="field">
<label>Gênero</label>
<input readonly value="${esc(u.gender||"—")}">
</div>
</div>

<div class="field">
<label>WhatsApp</label>
<input readonly value="${esc(u.whatsapp||"—")}">
</div>

<div class="field">
<label>Endereço (rua, número, complemento)</label>
<input readonly value="${esc([addr.street,addr.housenum,addr.complement].filter(Boolean).join(", ")||"—")}">
</div>

<div class="form-grid">
<div class="field">
<label>Estado</label>
<input readonly value="${esc(addr.state||"—")}">
</div>
<div class="field">
<label>País</label>
<input readonly value="${esc(addr.country||"—")}">
</div>
</div>

<div class="field">
<label>Chave Pix</label>
<input readonly value="${esc(u.pixKey||"—")}">
</div>

<h3 style="margin:15px 0">Carteira</h3>

<div class="form-grid">
<div class="field"><label>Comum (R$)</label><input readonly value="${fmtBRL(Number(wallet.common)||0)}"></div>
<div class="field"><label>Dourado (R$)</label><input readonly value="${fmtBRL(Number(wallet.gold)||0)}"></div>
<div class="field"><label>VIP (R$)</label><input readonly value="${fmtBRL(Number(wallet.vip)||0)}"></div>
<div class="field"><label>Troco (R$)</label><input readonly value="${fmtBRL(Number(wallet.change)||0)}"></div>
</div>

<div class="actions">
<button class="btn" id="creditUser"><i class=yi data-i=ticket></i> Creditar saldo (R$)</button>
<button class="btn secondary" id="mailUser"><i class=yi data-i=mail></i> Enviar e-mail</button>
<button class="btn secondary" id="resetUser"><i class=yi data-i=key></i> Redefinir senha</button>
<button class="btn secondary" id="notifyUser"><i class=yi data-i=megaphone></i> Enviar notificação</button>
${u.banned?'<button class="btn success" id="unbanUserBtn"><i class=yi data-i=checkc></i> Desbanir</button>':'<button class="btn danger" id="banUserBtn"><i class=yi data-i=ban></i> Banir</button>'}
</div>

`);

$("creditUser").onclick=()=>creditUser(u);
$("mailUser").onclick=()=>mailUser(u);
$("resetUser").onclick=()=>resetUserPassword(u);
$("notifyUser").onclick=()=>{closeModal();openNotifComposer(u.id)};
const bb=$("banUserBtn");if(bb)bb.onclick=()=>banUser(u);
const ub=$("unbanUserBtn");if(ub)ub.onclick=()=>unbanUser(u);

};

/* BANIR / DESBANIR — o site desconecta o usuário banido imediatamente */

async function banUser(u){
if(!u)return;
const reason=prompt("Motivo do banimento (opcional, aparece no painel):")??"";
if(reason===null)return;
if(!confirm("Banir "+(u.name||u.email)+"? A conta será desconectada do site e bloqueada de participar."))return;
try{
await setDoc(doc(db,"users",u.id),{
banned:true,
bannedReason:String(reason).slice(0,300),
bannedAt:serverTimestamp(),
updatedAt:serverTimestamp()
},{merge:true});
await loadAll();
toast("Participante banido. No site ele será desconectado.");
}catch(e){error(e)}
}

async function unbanUser(u){
if(!u)return;
if(!confirm("Desbanir "+(u.name||u.email)+"?"))return;
try{
await setDoc(doc(db,"users",u.id),{
banned:false,
bannedReason:"",
unbannedAt:serverTimestamp(),
updatedAt:serverTimestamp()
},{merge:true});
await loadAll();
toast("Participante desbanido.");
}catch(e){error(e)}
}

/* ENVIAR E-MAIL — grava na coleção "mail" (padrão da extensão Trigger Email do Firebase) */

function mailUser(u){
if(!u.email)return toast("Este participante não tem e-mail.");
openModal("Enviar e-mail para "+(u.name||u.email),`
<div class="field">
<label>Assunto</label>
<input id="mailSubject" maxlength="150" placeholder="Ex.: Sobre o seu prêmio">
</div>
<div class="field">
<label>Mensagem (pode usar HTML simples)</label>
<textarea id="mailBody" style="min-height:160px" placeholder="Escreva a mensagem…"></textarea>
</div>
<p class="hint">O e-mail é gravado na coleção <b>mail</b> do Firestore. Para sair de verdade, ative a extensão <b>Trigger Email</b> do Firebase (ou uma Cloud Function que leia essa coleção). Também é possível combinar com uma notificação no app.</p>
<div class="actions">
<button class="btn" id="mailSend">Enviar e-mail</button>
<button class="btn secondary" id="mailAlsoNotif">Enviar e-mail + notificação no app</button>
</div>
`);
const send=async withNotif=>{
const subject=$("mailSubject").value.trim();
const message=$("mailBody").value.trim();
if(subject.length<3)return toast("Informe o assunto.");
if(message.length<5)return toast("Escreva a mensagem.");
try{
await addDoc(collection(db,"mail"),{
to:u.email,
subject,
message,
createdAt:serverTimestamp()
});
if(withNotif){
await addDoc(collection(db,"notifications"),{
target:u.id,
title:subject,
code:"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head><body><div><h2>"+subject.replace(/</g,"&lt;")+"</h2><p>"+message.replace(/</g,"&lt;")+"</p></div></body></html>",
createdAt:serverTimestamp()
});
}
closeModal();
toast(withNotif?"E-mail gravado e notificação enviada.":"E-mail gravado na fila de envio (coleção mail).");
}catch(e){error(e)}
};
$("mailSend").onclick=()=>send(false);
$("mailAlsoNotif").onclick=()=>send(true);
}

/* REDEFINIR SENHA — usa o próprio Firebase Auth do site */

async function resetUserPassword(u){
if(!u.email)return toast("Este participante não tem e-mail.");
if(!confirm("Enviar e-mail de redefinição de senha para "+u.email+"? Ele mesmo cria a nova senha pelo link."))return;
try{
await sendPasswordResetEmail(auth,u.email);
toast("Link de redefinição enviado para "+u.email+".");
}catch(e){error(e)}
}

/* NOTIFICAÇÕES NO APP — para um participante específico ou para todos */

const NOTIF_EXAMPLE=`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">

</head>
<body>
<div class="card">
<h2><i class=yi data-i=megaphone></i> Comunicado do Yshippcommerce</h2>
<p>Escreva aqui o conteúdo que o participante verá ao tocar na notificação.</p>
<p>Você pode usar HTML, CSS e JavaScript livremente.</p>
<a href="#" onclick="alert('Funciona!');return false">Testar interação</a>
</div>
</body>
</html>`;

function openNotifComposer(uid){
if($("page-users").hidden)go("users");
$("nTarget").value=uid||"all";
$("nCode").focus();
toast("Destinatário selecionado. Escreva o código da notificação.");
}

function renderNotifTargets(){
const sel=$("nTarget");
const cur=sel.value;
sel.innerHTML='<option value="all">Todos os participantes</option>'+
C.users.map(u=>`<option value="${esc(u.id)}">${esc(u.name||"Sem nome")} — ${esc(u.email||u.id)}</option>`).join("");
sel.value=(cur&&[...sel.options].some(o=>o.value===cur))?cur:"all";
}

function notifTargetLabel(n){
if(!n.target||n.target==="all")return"Todos";
const u=C.users.find(x=>x.id===n.target);
return u?(u.name||u.email||n.target):n.target;
}

const NOTE_CATS={finance:"Financeiro",tasks:"Tarefas oficiais",collab:"Colaboradores",draws:"Sorteios",auctions:"Leilões",events:"Eventos",challenges:"Desafios",community:"Comunidade",security:"Segurança",ads:"Anúncios",system:"Sistema"};

/* notificação automática para um participante (Central de Notificações do site) */
async function notifyUser(uid,category,title,text,link){
if(!uid)return;
try{
await addDoc(collection(db,"notifications"),{
target:uid,
title,
category:category||"system",
link:link||"",
code:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:sans-serif;background:#0b0e11;color:#eaecef"><div style="padding:28px 18px;max-width:560px;margin:auto"><h2 style="margin:0 0 10px">'+title+'</h2><p style="color:#848e9c;line-height:1.7">'+text+'</p></div></body></html>',
createdAt:serverTimestamp()
});
}catch(e){console.warn("notifyUser:",e)}
}

function renderNotifList(){
const list=[...C.notes].sort((a,b)=>(stamp(b.createdAt)||0)-(stamp(a.createdAt)||0)).slice(0,30);
$("notifList").innerHTML=list.map(n=>`
<tr>
<td>${esc(n.title||"Sem título")}<small>${esc(String(n.code||"").slice(0,80))}…</small></td>
<td>${esc(notifTargetLabel(n))}</td>
<td>${esc(NOTE_CATS[n.category]||"—")}</td>
<td>${date(n.createdAt)}</td>
<td><button class="btn danger small" data-notif-del="${esc(n.id)}">Excluir</button></td>
</tr>
`).join("")||'<tr><td colspan="5" class="empty">Nenhuma notificação enviada ainda.</td></tr>';
}

$("notifList").onclick=async e=>{
const id=e.target.dataset.notifDel;
if(!id)return;
if(!confirm("Excluir esta notificação? Ela sai do ar também para quem não leu."))return;
try{
await deleteDoc(doc(db,"notifications",id));
await loadAll();
toast("Notificação excluída.");
}catch(e){error(e)}
};

$("fillNotifExample").onclick=()=>{$("nCode").value=NOTIF_EXAMPLE};

$("sendNotif").onclick=async()=>{
const title=$("nTitle").value.trim();
const target=$("nTarget").value;
const code=$("nCode").value.trim();
const category=$("nCategory")?.value||"system";
const link=$("nLink")?.value.trim()||"";
if(title.length<3)return toast("Informe o título da notificação.");
if(code.length<20)return toast("Cole ou escreva o código da notificação (mínimo 20 caracteres).");
if(target!=="all"&&!C.users.some(u=>u.id===target))return toast("Selecione um destinatário válido.");
if(!confirm("Enviar a notificação \""+title+"\" para "+(target==="all"?"TODOS os participantes":notifTargetLabel({target}))+"?"))return;
try{
await addDoc(collection(db,"notifications"),{
target,
title,
code,
category,
link,
createdAt:serverTimestamp()
});
$("nTitle").value="";
$("nCode").value="";
if($("nLink"))$("nLink").value="";
await loadAll();
toast("Notificação enviada! Ela aparece no site como notificação de celular.");
}catch(e){error(e)}
};

/* CRÉDITO ADMINISTRATIVO */

async function creditUser(u){

openModal("Crédito administrativo",`

<div class="field">
<label>Categoria</label>
<select id="creditType">
<option value="common">Comum</option>
<option value="gold">Dourado</option>
<option value="vip">VIP</option>
<option value="brl">Dinheiro real (R$)</option>
</select>
</div>

<div class="field">
<label>Quantidade</label>
<input id="creditAmount" type="number" min="1" max="100000" value="1">
</div>

<div class="field">
<label>Motivo do crédito</label>
<input id="creditReason" maxlength="150" placeholder="Ex.: Bonificação administrativa">
</div>

<button class="btn" id="confirmCredit">Confirmar crédito</button>

`);

$("confirmCredit").onclick=async()=>{

const type=$("creditType").value;
const amount=Math.floor(Number($("creditAmount").value));
const reason=$("creditReason").value.trim();

if(!Number.isInteger(amount)||amount<1||amount>100000)return toast("Quantidade inválida.");
if(reason.length<3)return toast("Informe o motivo.");

if(!confirm("Confirmar crédito de "+fmtBRL(amount)+"?"))return;

try{

await runTransaction(db,async tx=>{

const w=doc(db,"wallets",u.id);

if(type==="brl"){
tx.set(w,{brl:increment(amount),updatedAt:serverTimestamp()},{merge:true});
tx.set(doc(collection(db,"wallets",u.id,"history")),{kind:"admin_credit",amount:0,brl:amount,reason,adminUid:C.admin.uid,createdAt:serverTimestamp()});
return;
}

tx.set(w,{
[type]:increment(amount),
updatedAt:serverTimestamp()
},{merge:true});

tx.set(doc(collection(db,"wallets",u.id,"history")),{
kind:"admin_credit",
amount,
ticketType:type,
reason,
adminUid:C.admin.uid,
createdAt:serverTimestamp()
});

});

closeModal();
toast("Crédito realizado.");

}catch(e){error(e)}

};

}

/* CONFIGURAÇÕES */

function loadSettings(){

const s=C.settings;

$("sName").value=s.platformName||"Yshippcommerce";
$("sLogo").value=s.logoUrl||"";
$("sSupport").value=s.supportLink||"";
$("sContact").value=s.contact||"";
$("sNotice").value=s.notice||"";
$("sHeroTitle").value=s.heroTitle||"";
$("sHeroText").value=s.heroText||"";
$("sInstitutional").value=s.institutionalText||"";

$("sSupportCode").value=s.supportCode||"";

/* ---- ANÚNCIO PATROCINADO (cam novos do site v9) ---- */
$("sAdActive").value=s.adActive===true?"true":"false";
$("sAdBrand").value=s.adBrand||"";
$("sAdSeconds").value=Number.isFinite(Number(s.adSeconds))?Math.max(3,Math.floor(Number(s.adSeconds))):10;
$("sAdReward").value=Math.max(0,Math.floor(Number(s.adReward)||0));
$("sAdCode").value=s.adCode||"";
adStatusBadge();

tickerRows=Array.isArray(s.ticker)?s.ticker.filter(r=>r&&typeof r==="object"):[];

renderTickerEditor();

ticketTypes=s.ticketTypes||{
common:{name:"Comum",color:"#ffffff"},
gold:{name:"Dourado",color:"#fcd535"},
vip:{name:"VIP",color:"#a855f7"}
};

faq=Array.isArray(s.faq)?s.faq:[];

renderTicketTypes();
renderFaq();

}

function renderTicketTypes(){

$("ticketTypes").innerHTML=Object.entries(ticketTypes).map(([k,v])=>`
<div class="form-grid" style="margin-bottom:10px">
<div class="field">
<label>Identificador: ${esc(k)}</label>
<input value="${esc(v.name)}" data-type-name="${esc(k)}">
</div>
<div class="field">
<label>Cor</label>
<input type="color" value="${esc(v.color||"#ffffff")}" data-type-color="${esc(k)}">
</div>
</div>
`).join("");

}

function renderFaq(){

$("faqEditor").innerHTML=faq.map((x,i)=>`
<div class="item" style="margin-bottom:10px">
<div class="field">
<label>Pergunta</label>
<input data-faq-q="${i}" value="${esc(x.q)}">
</div>
<div class="field">
<label>Resposta</label>
<textarea data-faq-a="${i}">${esc(x.a)}</textarea>
</div>
<button class="btn danger small" data-faq-del="${i}">Remover pergunta</button>
</div>
`).join("");

}

$("addTicketType").onclick=()=>{

/* as categorias de saldo são FIXAS no site (todas valem R$ 1,00):
   uma categoria nova só mudaria o rótulo, não teria
   valor e não apareceria para escolha em lugar nenhum. Renomeie e troque
   as cores das três existentes abaixo. */
return toast("As categorias de saldo são fixas: Comum, Dourado e VIP (todas valem R$ 1,00 por unidade). Você pode renomear e trocar as cores das três abaixo — o site só reconhece essas.");

};

$("addFaq").onclick=()=>{
faq.push({q:"",a:""});
renderFaq();
};

$("faqEditor").onclick=e=>{

const id=e.target.dataset.faqDel;
if(id===undefined)return;

faq.splice(Number(id),1);
renderFaq();

};

$("faqEditor").oninput=e=>{

if(e.target.dataset.faqQ!==undefined){
faq[Number(e.target.dataset.faqQ)].q=e.target.value;
}

if(e.target.dataset.faqA!==undefined){
faq[Number(e.target.dataset.faqA)].a=e.target.value;
}

};

$("ticketTypes").oninput=e=>{

const name=e.target.dataset.typeName;
const color=e.target.dataset.typeColor;

if(name!==undefined)ticketTypes[name].name=e.target.value;
if(color!==undefined)ticketTypes[color].color=e.target.value;

};

/* EDITOR DA FAIXA DO TOPO DO SITE */

function renderTickerEditor(){

$("tickerEditor").innerHTML=tickerRows.length?tickerRows.map((r,i)=>`
<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:8px">
<input value="${esc(r.label||"")}" data-tk-label="${i}" placeholder="Rótulo (ex.: Eventos ativos)">
<input value="${esc(r.value||"")}" data-tk-value="${i}" placeholder="Valor (ex.: 3)">
<button class="btn danger small" data-tk-del="${i}">Remover</button>
</div>
`).join(""):'<p class="hint">Nenhum campo personalizado — o site usará as informações ao vivo.</p>';

}

function tickerRowsData(){
return tickerRows.map((r,i)=>({
label:(document.querySelector(`[data-tk-label="${i}"]`)?.value||r.label||"").trim(),
value:(document.querySelector(`[data-tk-value="${i}"]`)?.value||r.value||"").trim()
}));
}

$("addTickerRow").onclick=()=>{
tickerRows.push({label:"",value:""});
renderTickerEditor();
};

$("tickerEditor").onclick=e=>{
const del=e.target.dataset?.tkDel;
if(del!==undefined&&del!==""){
tickerRows.splice(Number(del),1);
renderTickerEditor();
}
};

/* SALVAR CÓDIGO DE SUPORTE */

$("saveSupport").onclick=async()=>{

const code=$("sSupportCode").value;

try{
await setDoc(doc(db,"settings","platform"),{
supportCode:code,
updatedAt:serverTimestamp()
},{merge:true});
C.settings.supportCode=code;
toast("Código de suporte salvo. Ele já aparece no botão <i class=yi data-i=headset></i> do site.");
}catch(e){error(e)}

};

$("saveSettings").onclick=async()=>{

const data={

platformName:$("sName").value.trim(),
logoUrl:$("sLogo").value.trim(),
supportLink:$("sSupport").value.trim(),
contact:$("sContact").value.trim(),
notice:$("sNotice").value.trim(),
heroTitle:$("sHeroTitle").value.trim(),
heroText:$("sHeroText").value.trim(),
institutionalText:$("sInstitutional").value.trim(),
ticketTypes,
faq,
ticker:tickerRowsData().filter(x=>x.label),
supportCode:$("sSupportCode").value,
/* preserva campos gerenciados por outras telas (feedback, homeBlocks, etc.) */
...(C.settings?.feedback?{feedback:C.settings.feedback}:{}),
...(C.settings?.homeBlocks?{homeBlocks:C.settings.homeBlocks}:{}),
updatedAt:serverTimestamp(),
updatedBy:C.admin.uid

};

if(data.logoUrl&&!validUrl(data.logoUrl))return toast("URL do logotipo inválida.");
if(data.supportLink&&!validUrl(data.supportLink))return toast("URL de suporte inválida.");

if(Object.values(ticketTypes).some(x=>!x.name?.trim()||!/^#[0-9a-f]{6}$/i.test(x.color))){
return toast("Revise os nomes e as cores das categorias.");
}

try{

await setDoc(doc(db,"settings","platform"),data,{merge:true});
/* mescla em vez de substituir: preserva no cache local os campos gerenciados
   por outras telas (anúncio: adActive/adBrand/adSeconds/adReward/adCode, etc.) */
C.settings={...(C.settings||{}),...data};
toast("Configurações atualizadas.");
}catch(e){error(e)}

};

/* ---- ANÚNCIO PATROCINADO: salvar, status e prévia ---- */
function adStatusBadge(){
const on=C.settings.adActive===true&&String(C.settings.adCode||"").trim();
const el=$("adStatus");if(!el)return;
el.className="status "+(on?"green":"");
el.textContent=on
?`NO AR · +${fmtBRL(Math.max(0,Math.floor(Number(C.settings.adReward)||0)))} · ${Math.max(3,Math.floor(Number(C.settings.adSeconds)||10))}s`
:"PAUSADO (botão do site sem destaque)";
}
$("saveAd").onclick=async()=>{

const active=$("sAdActive").value==="true";
const code=$("sAdCode").value;
const secs=Math.floor(Number($("sAdSeconds").value));
const reward=Math.floor(Number($("sAdReward").value));

if(active&&!code.trim())return toast("Cole o código do anúncio antes de ativar.");
if(!(secs>=3&&secs<=600))return toast("O tempo de espera deve ficar entre 3 e 600 segundos.");
if(!(reward>=0&&Number.isFinite(reward)))return toast("Recompensa inválida.");

try{

await setDoc(doc(db,"settings","platform"),{
adActive:active,
adBrand:$("sAdBrand").value.trim(),
adSeconds:secs,
adReward:reward,
adCode:code,
adUpdatedAt:serverTimestamp(),/* novo id: libera a recompensa 1x para cada usuário */
updatedAt:serverTimestamp(),
updatedBy:C.admin.uid
},{merge:true});

C.settings={...C.settings,adActive:active,adBrand:$("sAdBrand").value.trim(),adSeconds:secs,adReward:reward,adCode:code};
adStatusBadge();

toast(active
?"Anúncio publicado! O botão <i class=yi data-i=megaphone></i> do site acendeu com +"+fmtBRL(reward)+" · "+secs+"s."
:"Anúncio pausado — o botão do site voltou ao normal.");

}catch(e){error(e)}

};

$("previewAd").onclick=()=>{
const code=$("sAdCode").value.trim();
if(!code)return toast("Cole o código do anúncio para visualizar.");
openModal("Prévia do anúncio (como aparece na gaveta do site)",`
<p class="hint" style="margin:0 0 10px">Contagem de <b>${Math.max(3,Math.floor(Number($("sAdSeconds").value)||10))}s</b> e recompensa de <b>+${fmtBRL(Math.max(0,Math.floor(Number($("sAdReward").value)||0)))}</b> aparecem acima desta área, no cabeçalho da gaveta.</p>
<iframe class="preview-frame" sandbox="allow-scripts allow-forms allow-popups allow-modals" srcdoc="${esc(code).replace(/"/g,"&quot;")}"></iframe>
`);
};

$("fillAdExample").onclick=()=>{
$("sAdCode").value=`<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
<div class="ad">
<h1>Seu anúncio aparece <b>exatamente aqui</b>.</h1>
<p>Exemplo pronto do campo adCode — apague e cole o anúncio real. HTML, CSS e JavaScript funcionam dentro da gaveta.</p>
<button class="cta" onclick="this.textContent='Obrigado pela atenção ✓'">Quero anunciar</button>
</div>
</body>
</html>`;
$("sAdBrand").value=$("sAdBrand").value||"Patrocinador";
toast("Exemplo carregado — ajuste e salve para publicar.");
};

/* RESULTADOS */

function renderResults(){

$("resultDraw").innerHTML=C.draws.map(d=>
`<option value="${esc(d.id)}">${esc(d.name)}</option>`
).join("");

renderWinners();

}

$("resultDraw").onchange=renderWinners;

function renderWinners(){

const d=C.draws.find(x=>x.id===$("resultDraw").value);
const w=d?.result?.winners||[];

$("winnerList").innerHTML=w.map((x,i)=>winnerHTML(x,i)).join("");

/* estado do botão: sorteio já publicado fica travado — a guarda real é a
   transação do publishResult, mas o botão desabilitado evita a tentativa */
const ended=d&&d.status==="ended";
$("publishResult").disabled=!!ended;
$("publishResult").innerHTML=ended?'<i class=yi data-i=checkc></i> Resultado já publicado':"Publicar resultado oficial";

}

function winnerHTML(x={},i=0){

return `
<div class="item" style="margin-bottom:12px">
<div class="form-grid">
<div class="field">
<label>Número vencedor</label>
<input type="number" min="1" data-win-number="${i}" value="${Number(x.number)||""}">
</div>
<div class="field">
<label>Prêmio</label>
<input data-win-prize="${i}" value="${esc(x.prize||"")}">
</div>
</div>
<div class="field">
<label>Nome público do ganhador</label>
<input data-win-name="${i}" value="${esc(x.displayName||"")}">
</div>
<button class="btn danger small" data-win-del="${i}">Remover</button>
</div>`;

}

$("addWinner").onclick=()=>{
const d=C.draws.find(x=>x.id===$("resultDraw").value);
if(!d)return toast("Selecione um sorteio.");
const w=Array.from($("winnerList").querySelectorAll("[data-win-number]")).map((el,i)=>({
number:Number(el.value),
prize:document.querySelector(`[data-win-prize="${i}"]`).value,
displayName:document.querySelector(`[data-win-name="${i}"]`).value
}));
w.push({number:"",prize:"",displayName:""});
$("winnerList").innerHTML=w.map((x,i)=>winnerHTML(x,i)).join("");
};

$("winnerList").onclick=e=>{

const id=e.target.dataset.winDel;
if(id===undefined)return;

const w=Array.from($("winnerList").querySelectorAll("[data-win-number]")).map((el,i)=>({
number:Number(el.value),
prize:document.querySelector(`[data-win-prize="${i}"]`).value,
displayName:document.querySelector(`[data-win-name="${i}"]`).value
}));

w.splice(Number(id),1);
$("winnerList").innerHTML=w.map((x,i)=>winnerHTML(x,i)).join("");

};

/* devolve os reais dos não ganhadores de um sorteio encerrado.
   Cada reembolso usa um documento de histórico com ID fixo
   ("refund_"+drawId): se a execução for refeita (falha de rede no meio ou
   nova tentativa do painel ao carregar), quem já recebeu é pulado —
   nunca devolve duas vezes. Retorna quantos reembolsos fez nesta execução. */
async function refundDrawNonWinners(d){
if(!d||!d.id)return 0;
const winNums=new Set((d.result?.winners||[]).map(w=>Number(w.number)));
const cost=Math.max(1,Math.floor(Number(d.ticketCost)||1));
const tkPer=Math.max(1,Math.round(cost/0.5)); /* bilhetes por número pago com bilhete */
const per={};
/* lê TODAS as reservas do sorteio direto do servidor (C.resvs pode estar
   truncado em 2000 e deixaria perdedores antigos sem reembolso) */
const rsnap=await getDocs(query(collection(db,"reservations"),where("drawId","==",d.id)));
rsnap.forEach(rdoc=>{
const r=rdoc.data();
const uid=r.uid;
if(!uid||winNums.has(Number(r.number)))return;
per[uid]=per[uid]||{brl:0,tickets:0,numbers:[]};
/* devolve na moeda do pagamento: quem pagou com BILHETES recebe bilhetes
   de volta — fichas nunca viram reais */
if(r.paidWith==="ticket")per[uid].tickets+=tkPer;
else per[uid].brl+=cost;
per[uid].numbers.push(Number(r.number));
});
let refunded=0;
for(const uid of Object.keys(per)){
const href=doc(db,"wallets",uid,"history","refund_"+d.id);
const hrefTk=doc(db,"wallets",uid,"history","refund_"+d.id+"_tk");
await runTransaction(db,async tx=>{
const h=await tx.get(href);
const ht=await tx.get(hrefTk);
if(h.exists()&&(!per[uid].tickets||ht.exists()))return; /* já reembolsado antes — pula */
if(per[uid].brl>0&&!h.exists()){
tx.set(doc(db,"wallets",uid),{
change:increment(per[uid].brl),
updatedAt:serverTimestamp()
},{merge:true});
tx.set(href,{
kind:"refund",
amount:per[uid].brl,
drawId:d.id,
drawName:d.name||"",
numbers:per[uid].numbers,
createdAt:serverTimestamp()
});
}
if(per[uid].tickets>0&&!ht.exists()){
tx.set(doc(db,"wallets",uid),{
tickets:increment(per[uid].tickets),
updatedAt:serverTimestamp()
},{merge:true});
tx.set(hrefTk,{
kind:"xc_refund",
amount:0,
xcKind:"ticket",
xcQty:per[uid].tickets,
drawId:d.id,
drawName:d.name||"",
reason:"Devolução de número não premiado pago com bilhetes ("+per[uid].tickets+" bilhete(s))",
numbers:per[uid].numbers,
createdAt:serverTimestamp()
});
}
/* remove os números reembolsados do perfil: sem isso, o limite antigo do
   site (numbers.length vs saldo) travava o participante para sempre */
tx.update(doc(db,"users",uid),{
numbers:arrayRemove(...per[uid].numbers)
});
});
refunded++;
}
await setDoc(doc(db,"draws",d.id),{refundPending:false,updatedAt:serverTimestamp()},{merge:true});
return refunded;
}

$("publishResult").onclick=async()=>{

const d=C.draws.find(x=>x.id===$("resultDraw").value);
if(!d)return toast("Selecione um sorteio.");

const winners=Array.from($("winnerList").querySelectorAll("[data-win-number]")).map((el,i)=>({
number:Number(el.value),
prize:document.querySelector(`[data-win-prize="${i}"]`).value.trim(),
displayName:document.querySelector(`[data-win-name="${i}"]`).value.trim()
}));

if(!winners.length)return toast("Adicione pelo menos um ganhador.");

const seen=new Set();

/* totalNumbers pode estar vazio: Number(vazio) = NaN e qualquer número passava */
const total=Math.max(1,Math.floor(Number(d.totalNumbers))||150);

for(const w of winners){
if(!Number.isInteger(w.number)||w.number<1||w.number>total)return toast("Número vencedor inválido.");
if(seen.has(w.number))return toast("Não repita números vencedores.");
if(!w.prize)return toast("Informe o prêmio de cada ganhador.");
seen.add(w.number);
}

if(!confirm("Publicar oficialmente este resultado?"))return;

try{

/* GUARDA TRANSACIONAL: o sorteio é relido ANTES de qualquer escrita.
   Publicar 2× (clique duplo ou outra aba do painel) nunca mais reembolsa
   em dobro: na 2ª tentativa o resultado já existe e a transação aborta
   sem escrever nada. */
await runTransaction(db,async tx=>{
const ds=await tx.get(doc(db,"draws",d.id));
if(!ds.exists())throw new Error("Sorteio não encontrado.");
const dd=ds.data();
if(dd.status==="ended"||dd.result)throw new Error("O resultado deste sorteio já foi publicado.");
tx.set(doc(db,"draws",d.id),{
result:{
winners,
publishedAt:serverTimestamp(),
publishedBy:C.admin.uid
},
status:"ended",
refundPending:true,
updatedAt:serverTimestamp()
},{merge:true});
});

let refunded=0;
try{
refunded=await refundDrawNonWinners({...d,result:{winners}});
}catch(err){
/* devoluções ficam marcadas como pendentes (refundPending) e o painel
   retoma sozinho ao carregar — sem risco de devolução em dobro */
console.warn("Devoluções pendentes do sorteio "+d.id+":",err);
}

await loadAll();
toast("Resultado publicado."+(refunded?" Reais devolvidos para "+refunded+" não ganhador(es).":""));

}catch(e){error(e)}

};

/* PRÊMIOS DO SORTEIO (por sorteio, com tipo e valor) */

const PRIZE_TYPES={
money:"Dinheiro",
object:"Objeto",
tickets:"Saldo (R$)",
shopee:"Shopee",
mercadolivre:"Mercado Livre",
amazon:"Amazon",
magalu:"Magazine Luiza",
giftcard:"Cartão presente",
recharge:"Recarga de operadora",
digital:"Prêmio digital"
};

function renderPrizeEditor(){
if(!$("prizeDraw"))return;
const cur=$("prizeDraw").value;
$("prizeDraw").innerHTML=C.draws.map(d=>
`<option value="${esc(d.id)}">${esc(d.name)}</option>`
).join("");
if(cur&&C.draws.some(d=>d.id===cur))$("prizeDraw").value=cur;
renderPrizeRows();
}

function prizeRowsData(){
return Array.from($("prizeList").querySelectorAll("[data-prize-name]")).map((el,i)=>({
name:document.querySelector(`[data-prize-name="${i}"]`).value.trim(),
type:document.querySelector(`[data-prize-type="${i}"]`).value,
value:document.querySelector(`[data-prize-value="${i}"]`).value.trim()
}));
}

function renderPrizeRows(){
const d=C.draws.find(x=>x.id===$("prizeDraw").value);
const p=Array.isArray(d?.prizes)?d.prizes.slice():[];
$("prizeList").innerHTML=p.length?p.map((x,i)=>`
<div class="item" style="margin-bottom:12px">
<div class="form-grid">
<div class="field">
<label>Nome do prêmio</label>
<input data-prize-name="${i}" value="${esc(x.name||"")}" placeholder="Ex.: Fone de ouvido">
</div>
<div class="field">
<label>Tipo</label>
<select data-prize-type="${i}">
${Object.entries(PRIZE_TYPES).map(([k,v])=>`<option value="${k}"${x.type===k?" selected":""}>${v}</option>`).join("")}
</select>
</div>
<div class="field">
<label>Valor / descrição</label>
<input data-prize-value="${i}" value="${esc(x.value||"")}" placeholder="Ex.: R$ 100 em créditos, link…">
</div>
</div>
<button class="btn danger small" data-prize-del="${i}">Remover</button>
</div>`).join(""):`<p style="color:var(--mu)">Nenhum prêmio cadastrado neste sorteio ainda.</p>`;
}

$("prizeDraw").onchange=renderPrizeRows;

$("addPrize").onclick=()=>{
const d=C.draws.find(x=>x.id===$("prizeDraw").value);
if(!d)return toast("Selecione um sorteio.");
const p=prizeRowsData();
p.push({name:"",type:"money",value:""});
$("prizeList").innerHTML=p.map((x,i)=>`
<div class="item" style="margin-bottom:12px">
<div class="form-grid">
<div class="field">
<label>Nome do prêmio</label>
<input data-prize-name="${i}" value="${esc(x.name||"")}">
</div>
<div class="field">
<label>Tipo</label>
<select data-prize-type="${i}">
${Object.entries(PRIZE_TYPES).map(([k,v])=>`<option value="${k}"${x.type===k?" selected":""}>${v}</option>`).join("")}
</select>
</div>
<div class="field">
<label>Valor / descrição</label>
<input data-prize-value="${i}" value="${esc(x.value||"")}">
</div>
</div>
<button class="btn danger small" data-prize-del="${i}">Remover</button>
</div>`).join("");
};

$("prizeList").onclick=e=>{
const id=e.target.dataset.prizeDel;
if(id===undefined)return;
const p=prizeRowsData();
p.splice(Number(id),1);
$("prizeList").innerHTML=p.map((x,i)=>`
<div class="item" style="margin-bottom:12px">
<div class="form-grid">
<div class="field">
<label>Nome do prêmio</label>
<input data-prize-name="${i}" value="${esc(x.name||"")}">
</div>
<div class="field">
<label>Tipo</label>
<select data-prize-type="${i}">
${Object.entries(PRIZE_TYPES).map(([k,v])=>`<option value="${k}"${x.type===k?" selected":""}>${v}</option>`).join("")}
</select>
</div>
<div class="field">
<label>Valor / descrição</label>
<input data-prize-value="${i}" value="${esc(x.value||"")}">
</div>
</div>
<button class="btn danger small" data-prize-del="${i}">Remover</button>
</div>`).join("");
};

$("savePrizes").onclick=async()=>{
const d=C.draws.find(x=>x.id===$("prizeDraw").value);
if(!d)return toast("Selecione um sorteio.");
const p=prizeRowsData().filter(x=>x.name);
if(!p.length)return toast("Adicione pelo menos um prêmio com nome.");
try{
await setDoc(doc(db,"draws",d.id),{
prizes:p,
updatedAt:serverTimestamp()
},{merge:true});
await loadAll();
toast("Prêmios salvos.");
}catch(e){error(e)}
};

/* SORTEIO AUTOMÁTICO: números reservados + prêmios distribuídos aleatoriamente */

function secureShuffle(arr){
const a=arr.slice();
for(let i=a.length-1;i>0;i--){
const x=new Uint32Array(1);
crypto.getRandomValues(x);
const j=x[0]%(i+1);
[a[i],a[j]]=[a[j],a[i]];
}
return a;
}

$("autoDraw").onclick=()=>{
const d=C.draws.find(x=>x.id===$("resultDraw").value);
if(!d)return toast("Selecione um sorteio.");
const resvs=C.resvs.filter(r=>r.drawId===d.id&&Number.isInteger(Number(r.number))&&Number(r.number)>=1);
if(!resvs.length)return toast("Nenhum número reservado neste sorteio.");
const prizes=Array.isArray(d.prizes)?d.prizes.filter(p=>p&&p.name):[];
const nWin=prizes.length||Math.min(3,resvs.length);
if(resvs.length<nWin)return toast("Só há "+resvs.length+" número(s) reservado(s) para "+nWin+" prêmio(s).");
/* embaralha números e prêmios com aleatoriedade criptográfica */
const nums=secureShuffle(resvs.map(r=>Number(r.number))).slice(0,nWin);
const shuffled=secureShuffle(prizes.map(p=>p.name+(p.value?" — "+p.value:"")));
const winners=nums.map((number,i)=>({
number,
prize:shuffled[i]||"Prêmio "+(i+1),
displayName:resvs.find(r=>Number(r.number)===number)?.displayName||""
}));
$("winnerList").innerHTML=winners.map((x,i)=>winnerHTML(x,i)).join("");
toast("Sorteio automático gerado! Revise e publique.");
};

/* ════════════════════════════════════════════════════════════════
   PESQUISAS PAGAS · moderação, roteiro (perguntas, escritas, banners,
   links diretos) e valor calculado pela economia
   ════════════════════════════════════════════════════════════════ */

const ECON_DEFAULTS={
ticketPoints:{common:1,gold:1,vip:1},
ticketsPerBrl:1,
withdrawMin:5,
withdrawFee:0,
withdrawDays:2,
survey:{base:4,perQuestion:2,perOption:0.5,perText:3,perBanner:3,perDirect:2,perTime:0.5,min:3,max:100},
miningOn:true,
buffsOn:true,
maxMiningBuffPct:100,
maxRewardBuffPct:50,
pix:{key:"",name:"",city:"SAO PAULO",desc:"YSHIPPMARKET"},
cryptos:["BTC","ETH","USDT","BNB","SOL","XRP","ADA","DOGE","LTC","MATIC"],
vip:{feePct:5,poolGoal:5000,streakDays:7,tasksPerDay:5},
ticketConv:{enabled:true,feePct:0,min:1,max:100000,pairs:{common:{gold:true,vip:false},gold:{common:true,vip:true},vip:{common:true,gold:true}}}
};

function econCfg(){
const e=C.econ||{};
const sv={...ECON_DEFAULTS.survey,...(e.survey||{})};
return{
ticketPoints:{...ECON_DEFAULTS.ticketPoints,...(e.ticketPoints||{})},
ticketsPerBrl:Math.max(1,Math.floor(Number(e.ticketsPerBrl)||ECON_DEFAULTS.ticketsPerBrl)),
withdrawMin:Math.max(0.01,Number(e.withdrawMin)||ECON_DEFAULTS.withdrawMin),
withdrawFee:Math.min(50,Math.max(0,Number(e.withdrawFee)||0)),
withdrawDays:Math.min(30,Math.max(0,Math.floor(Number(e.withdrawDays)||ECON_DEFAULTS.withdrawDays))),
survey:sv,
miningOn:e.miningOn!==false,
buffsOn:e.buffsOn!==false,
maxMiningBuffPct:Math.min(500,Math.max(0,Math.floor(Number(e.maxMiningBuffPct)||ECON_DEFAULTS.maxMiningBuffPct))),
maxRewardBuffPct:Math.min(500,Math.max(0,Math.floor(Number(e.maxRewardBuffPct)||ECON_DEFAULTS.maxRewardBuffPct))),
pix:{...ECON_DEFAULTS.pix,...(e.pix||{})},
cryptos:Array.isArray(e.cryptos)&&e.cryptos.length?e.cryptos:ECON_DEFAULTS.cryptos.slice(),
vip:(()=>{const v=e.vip||{};const d=ECON_DEFAULTS.vip;return{feePct:Math.min(50,Math.max(0,Number(v.feePct)||d.feePct)),poolGoal:Math.max(1000,Math.floor(Number(v.poolGoal)||d.poolGoal)),streakDays:Math.max(1,Math.floor(Number(v.streakDays)||d.streakDays)),tasksPerDay:Math.max(1,Math.floor(Number(v.tasksPerDay)||d.tasksPerDay))};})(),
ticketConv:(()=>{const t=e.ticketConv||{};const d=ECON_DEFAULTS.ticketConv;const pr=(t.pairs||{});const prd=d.pairs;const norm=k=>({common:!!(pr[k]?.common??prd[k].common),gold:!!(pr[k]?.gold??prd[k].gold),vip:!!(pr[k]?.vip??prd[k].vip)});return{enabled:t.enabled!==false,feePct:Math.min(50,Math.max(0,Number(t.feePct)||0)),min:Math.max(1,Math.floor(Number(t.min)||d.min)),max:Math.max(1,Math.floor(Number(t.max)||d.max)),pairs:{common:norm("common"),gold:norm("gold"),vip:norm("vip")}};})()
};
}

/* normaliza o roteiro de uma pesquisa (compatível com o modelo antigo de questions[]) */
function pesqSteps(s){
if(Array.isArray(s?.steps)&&s.steps.length)return s.steps;
return (s?.questions||[]).map(q=>({...q,kind:"question",type:"choice"}));
}
function pesqValueOf(steps,cfg){
const qs=steps.filter(s=>s&&s.kind==="question");
const nq=qs.length;
let opts=0;qs.forEach(q=>opts+=(q.opts||[]).length);
const nText=qs.filter(q=>q.type==="text").length;
const nBan=steps.filter(s=>s&&s.kind==="banner").length;
const nDir=steps.filter(s=>s&&s.kind==="direct").length;
let v=cfg.base+nq*cfg.perQuestion+(nq?(opts/nq)*cfg.perOption:0)+nText*cfg.perText+nBan*cfg.perBanner+nDir*cfg.perDirect+nq*cfg.perTime;
return Math.max(cfg.min,Math.min(cfg.max,Math.round(v)));
}
const PES_STATUS={pending:'<span class="status yellow">Aguardando aprovação</span>',approved:'<span class="status green">No ar</span>',paused:'<span class="status yellow">Pausada</span>',rejected:'<span class="status red">Recusada</span>'};

function renderPesquisas(){
if(!loaded)return;
const econ=econCfg();
const all=C.pesqs||[];
const f=$("pesqFilter").value;
const aud=$("pesqAud").value;
const list=all.filter(s=>(f==="all"||s.status===f)&&(!aud||(s.audience||"members")===aud))
.sort((a,b)=>(stamp(b.createdAt)||0)-(stamp(a.createdAt)||0));
const pend=all.filter(s=>s.status==="pending").length;
$("pesqBadge").textContent=String(pend);
$("pesqBadge").style.display=pend?"":"none";
const resp=all.reduce((s,x)=>s+(Number(x.responses)||0),0);
const paid=all.reduce((s,x)=>s+(Number(x.responses)||0)*pesqValueOf(pesqSteps(x),econ.survey),0);
$("pesqStats").innerHTML=`
<div class="card"><div class="stat-label">Pesquisas</div><div class="stat-value gold">${all.length}</div><div class="stat-foot">${all.filter(s=>s.status==="approved").length} no ar · ${pend} aguardando</div></div>
<div class="card"><div class="stat-label">Respostas totais</div><div class="stat-value">${resp}</div><div class="stat-foot">Somatório de todas as pesquisas</div></div>
<div class="card"><div class="stat-label">Reais distribuídos</div><div class="stat-value">${fmtBRL(paid)}</div><div class="stat-foot">Recompensas pagas (valor da economia)</div></div>
<div class="card"><div class="stat-label">Coeficiente atual</div><div class="stat-value">${econ.survey.base}<span style="font-size:13px"> base</span></div><div class="stat-foot">+${econ.survey.perQuestion}/pergunta · +${econ.survey.perText}/escrita · +${econ.survey.perBanner}/bloco</div></div>`;
$("pesqList").innerHTML=list.length?list.map(s=>{
const steps=pesqSteps(s);
const val=pesqValueOf(steps,econ.survey);
const nQ=steps.filter(x=>x.kind==="question").length;
const nT=steps.filter(x=>x.kind==="question"&&x.type==="text").length;
const nB=steps.filter(x=>x.kind==="banner").length;
const nD=steps.filter(x=>x.kind==="direct").length;
return `<tr>
<td><b>${esc(s.title||"Pesquisa")}</b><small>${esc((s.desc||"").slice(0,60))}${s.desc&&s.desc.length>60?"…":""}</small><small><b class="mono">${nQ}Q</b>${nT?` · ${nT} escrita(s)`:""}${nB?` · ${nB} banner(s)`:""}${nD?` · ${nD} link(s)`:""}</small></td>
<td>${esc(s.ownerName||"Equipe Yshipp")}<small class="mono">${esc((s.uid||"—").slice(0,12))}</small></td>
<td><b class="gold">${fmtBRL(val)}</b> <small>por resposta</small></td>
<td><b>${Number(s.responses)||0}</b><small>${Number(s.slots)||0} vagas</small></td>
<td>${PES_STATUS[s.status]||'<span class="status">—</span>'}</td>
<td style="white-space:nowrap">
${s.status==="pending"?`<button class="btn success small" data-pesq-ap="${esc(s.id)}">Aprovar</button> <button class="btn danger small" data-pesq-rj="${esc(s.id)}">Recusar</button> `:""}
${s.status==="approved"?`<button class="btn secondary small" data-pesq-pa="${esc(s.id)}">Pausar</button> `:""}
${s.status==="paused"?`<button class="btn success small" data-pesq-ap="${esc(s.id)}">Reativar</button> `:""}
<button class="btn secondary small" data-pesq-ed="${esc(s.id)}">Editar</button>
<button class="btn secondary small" data-pesq-pv="${esc(s.id)}">Ver roteiro</button>
<button class="btn danger small" data-pesq-dl="${esc(s.id)}">Excluir</button>
</td></tr>`;
}).join(""):`<tr><td colspan="6"><div class="empty">Nenhuma pesquisa neste filtro.</div></td></tr>`;
}

/* aprovar / recusar (com devolução) / pausar / excluir */
$("pesqList").onclick=async e=>{
const t=e.target;
const ap=t.dataset.pesqAp,rj=t.dataset.pesqRj,pa=t.dataset.pesqPa,dl=t.dataset.pesqDl,ed=t.dataset.pesqEd,pv=t.dataset.pesqPv;
if(ap){
try{
await setDoc(doc(db,"surveys",ap),{status:"approved",updatedAt:serverTimestamp()},{merge:true});
await loadAll();toast("Pesquisa aprovada — já está no ar no site.");
}catch(err){error(err)}
}
if(pa){
try{
await setDoc(doc(db,"surveys",pa),{status:"paused",updatedAt:serverTimestamp()},{merge:true});
await loadAll();toast("Pesquisa pausada.");
}catch(err){error(err)}
}
if(rj){
const s=C.pesqs.find(x=>x.id===rj);
const why=prompt("Motivo da recusa (o criador vê no site; o valor pago é devolvido para a carteira dele):");
if(why===null)return;
try{
await runTransaction(db,async tx=>{
let w2=null;
if(s&&s.uid){
const amount=Math.max(0,Math.floor(Number(s.amount)||0));
if(amount>0){
const ws=await tx.get(doc(db,"wallets",s.uid));
w2=ws.exists()?ws.data():{};
w2.common=(Number(w2.common)||0)+amount;
}
}
tx.set(doc(db,"surveys",rj),{status:"rejected",rejectReason:String(why).slice(0,200),updatedAt:serverTimestamp()},{merge:true});
if(w2&&s.uid){
tx.set(doc(db,"wallets",s.uid),{...w2,updatedAt:serverTimestamp()});
tx.set(doc(collection(db,"wallets",s.uid,"history")),{kind:"survey_refund",amount:Math.max(0,Math.floor(Number(s.amount)||0)),ticketType:"common",reason:"Pesquisa recusada: "+String(s.title||"").slice(0,50),createdAt:serverTimestamp()});
}
});
await loadAll();toast("Pesquisa recusada e valor devolvido ao criador.");
}catch(err){error(err)}
}
if(dl){
if(!confirm("Excluir esta pesquisa definitivamente? As respostas já registradas são mantidas."))return;
try{
await deleteDoc(doc(db,"surveys",dl));
await loadAll();toast("Pesquisa excluída.");
}catch(err){error(err)}
}
if(pv){pesqPreview(pv)}
if(ed){pesqEdit(ed)}
};

function pesqPreview(id){
const s=C.pesqs.find(x=>x.id===id);if(!s)return;
const steps=pesqSteps(s);
openModal("Roteiro · "+(s.title||"Pesquisa"),`
<div style="display:grid;gap:10px">
${steps.map((st,i)=>{
if(st.kind==="banner")return `<div class="card"><b>Bloco de anúncio ${i+1}</b><small>Plataforma: ${esc(st.platform||"banner")} · ${Number(st.w)||300}×${Number(st.h)||250}px</small><div class="hint" style="margin-top:6px">Código: <code>${esc(String(st.code||"").slice(0,120))}…</code></div></div>`;
if(st.kind==="direct")return `<div class="card"><b>Link direto ${i+1}</b><small>URL: ${esc(st.url||"")}</small></div>`;
const q=st;
if(q.type==="text")return `<div class="card"><b>Pergunta escrita ${i+1}</b><small>${esc(q.text)}</small><div class="hint" style="margin-top:6px">Mín. ${Number(q.minChars)||10} · máx. ${Number(q.maxChars)||300} caracteres</div></div>`;
return `<div class="card"><b>Pergunta ${i+1}${q.trap?' <span class="status yellow">isca</span>':""}</b><small>${esc(q.text)}</small><div class="hint" style="margin-top:6px">Opções: ${(q.opts||[]).map(esc).join(" · ")}</div></div>`;
}).join("")}
</div>
<div class="actions"><button class="btn secondary" id="pvClose">Fechar</button></div>`);
$("pvClose").onclick=closeModal;
}

/* EDITOR DE PESQUISA (roteiro completo · valor automático) */
let pesqDraft=null;

function pesqDraftNew(){
pesqDraft={id:null,title:"",desc:"",cat:"saude",audience:"members",slots:20,
steps:[{kind:"question",type:"choice",text:"",opts:["",""],trap:false,correct:0}]};
pesqEditRender();
}
function pesqEdit(id){
const s=C.pesqs.find(x=>x.id===id);if(!s)return;
pesqDraft={id:s.id,title:s.title||"",desc:s.desc||"",cat:s.cat||"saude",audience:s.audience||"members",slots:Number(s.slots)||20,
steps:pesqSteps(s).map(st=>({...st}))};
pesqEditRender();
}
function pesqDraftCollect(){
const d=pesqDraft;if(!d)return;
d.title=$("pd-title").value.trim();
d.desc=$("pd-desc").value.trim();
d.cat=$("pd-cat").value;
d.audience=$("pd-aud").value;
d.slots=Math.max(1,Math.min(500,Math.floor(Number($("pd-slots").value)||1)));
d.steps=d.steps.map((st,i)=>{
if(st.kind==="banner")return{...st,platform:$("pd-plat"+i)?.value||st.platform||"",code:$("pd-code"+i)?.value||st.code||"",w:Math.max(120,Math.min(800,Math.floor(Number($("pd-w"+i)?.value)||st.w||300))),h:Math.max(60,Math.min(800,Math.floor(Number($("pd-h"+i)?.value)||st.h||250)))};
if(st.kind==="direct")return{...st,url:$("pd-url"+i)?.value.trim()||st.url||"",label:$("pd-lbl"+i)?.value.trim()||st.label||""};
const q={...st};
q.text=$("pd-q"+i)?.value.trim()||q.text||"";
if(q.type==="text"){
q.minChars=Math.max(0,Math.min(1000,Math.floor(Number($("pd-mn"+i)?.value)||10)));
q.maxChars=Math.max(20,Math.min(2000,Math.floor(Number($("pd-mx"+i)?.value)||300)));
}else{
q.opts=(q.opts||[]).map((_,j)=>($("pd-qo"+i+"_"+j)?.value||"").trim()).filter(Boolean).slice(0,6);
q.trap=!!$("pd-qt"+i)?.checked;
q.correct=Math.max(0,Math.floor(Number($("pd-qc"+i)?.value)||0));
}
return q;
});
}
function pesqEditRender(){
const d=pesqDraft;if(!d)return;
const econ=econCfg();
const val=pesqValueOf(d.steps,econ.survey);
openModal((d.id?"Editar":"Nova")+" pesquisa · valor automático "+fmtBRL(val),`
<div style="display:grid;gap:12px">
<div class="form-grid">
<div class="field" style="margin:0"><label>Título *</label><input id="pd-title" maxlength="80" value="${esc(d.title)}"></div>
<div class="field" style="margin:0"><label>Categoria</label><select id="pd-cat">${["saude","casa","moda","eletronico","alimentos","beleza","transporte","viagem","educacao","financas","pets","esporte","jogos","musica","trabalho","infantil"].map(c=>`<option value="${c}" ${d.cat===c?"selected":""}>${c}</option>`).join("")}</select></div>
<div class="field" style="margin:0"><label>Público</label><select id="pd-aud"><option value="members" ${d.audience==="members"?"selected":""}>Membros (Central de Pesquisas)</option><option value="collab" ${d.audience==="collab"?"selected":""}>Colaboradores</option></select></div>
<div class="field" style="margin:0"><label>Vagas (respostas)</label><input id="pd-slots" type="number" min="1" max="500" value="${d.slots}"></div>
</div>
<div class="field" style="margin:0"><label>Descrição</label><textarea id="pd-desc" maxlength="300">${esc(d.desc)}</textarea></div>
<div class="hint">Valor por resposta calculado: <b class="gold">${fmtBRL(val)}</b> (base ${fmtBRL(econ.survey.base)} + perguntas, opções, escritas, blocos e links). Custo total: <b>${fmtBRL(val*d.slots)}</b>. Coeficientes editáveis em Economia.</div>
<div style="border-top:1px solid var(--l);padding-top:10px"><b>Roteiro</b></div>
<div style="display:grid;gap:10px">
${d.steps.map((st,i)=>{
if(st.kind==="banner")return `<div class="card" style="padding:12px">
<div style="display:flex;align-items:center;gap:8px"><span class="status yellow">Bloco de anúncio</span><button class="btn danger small" data-pd-del="${i}" style="margin-left:auto">Remover</button></div>
<div class="form-grid" style="margin-top:8px">
<div class="field" style="margin:0"><label>Plataforma</label><select id="pd-plat${i}">${["Adsterra","Monetag","Outra"].map(p=>`<option value="${p}" ${(st.platform||"Adsterra")===p?"selected":""}>${p}</option>`).join("")}</select></div>
<div class="field" style="margin:0"><label>Largura (px · 120–800)</label><input id="pd-w${i}" type="number" min="120" max="800" value="${Number(st.w)||300}"></div>
<div class="field" style="margin:0"><label>Altura (px · 60–800)</label><input id="pd-h${i}" type="number" min="60" max="800" value="${Number(st.h)||250}"></div>
</div>
<div class="field" style="margin:8px 0 0"><label>Código do banner (HTML/JS da plataforma)</label><textarea id="pd-code${i}" style="min-height:70px;font:12px var(--mono)">${esc(st.code||"")}</textarea></div>
</div>`;
if(st.kind==="direct")return `<div class="card" style="padding:12px">
<div style="display:flex;align-items:center;gap:8px"><span class="status yellow">Link direto</span><button class="btn danger small" data-pd-del="${i}" style="margin-left:auto">Remover</button></div>
<p class="hint" style="margin:6px 0">O participante é avisado antes de sair da pesquisa; o redirecionamento abre em nova aba e ele precisa voltar para terminar.</p>
<div class="field" style="margin:0"><label>URL (http/https)</label><input id="pd-url${i}" value="${esc(st.url||"")}" placeholder="https://…"></div>
<div class="field" style="margin:0"><label>Rótulo do botão</label><input id="pd-lbl${i}" value="${esc(st.label||"")}" placeholder="Ex.: Conhecer oferta"></div>
</div>`;
const q=st;
const isText=q.type==="text";
return `<div class="card" style="padding:12px">
<div style="display:flex;align-items:center;gap:8px"><span class="status">${isText?"Pergunta escrita":"Pergunta de opções"}</span>${q.trap?'<span class="status yellow">isca</span>':""}<button class="btn danger small" data-pd-del="${i}" style="margin-left:auto">Remover</button></div>
<div class="field" style="margin:8px 0 0"><label>Texto da pergunta *</label><textarea id="pd-q${i}" maxlength="160" style="min-height:50px">${esc(q.text||"")}</textarea></div>
${isText?`
<div class="form-grid">
<div class="field" style="margin:0"><label>Mínimo de caracteres</label><input id="pd-mn${i}" type="number" min="0" max="1000" value="${Number(q.minChars)||10}"></div>
<div class="field" style="margin:0"><label>Máximo de caracteres</label><input id="pd-mx${i}" type="number" min="20" max="2000" value="${Number(q.maxChars)||300}"></div>
</div>`:`
<div style="display:grid;gap:6px;margin-top:8px">
${(q.opts||[]).map((o,j)=>`<div style="display:flex;gap:6px;align-items:center"><input id="pd-qo${i}_${j}" value="${esc(o)}" placeholder="Opção ${j+1}" style="flex:1"><button class="btn secondary small" data-pd-odel="${i}:${j}">–</button></div>`).join("")}
<button class="btn secondary small" data-pd-oadd="${i}">+ opção</button>
</div>
<div style="display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap">
<label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--mu)"><input type="checkbox" id="pd-qt${i}" ${q.trap?"checked":""} style="width:auto"> Isca</label>
${q.trap?`<label style="font-size:12px;color:var(--mu)">Correta <select id="pd-qc${i}" style="width:auto">${(q.opts||[]).map((o,j)=>`<option value="${j}" ${j===Number(q.correct)?"selected":""}>${j+1}</option>`).join("")}</select></label>`:""}
</div>`}
</div>`;
}).join("")}
<div style="display:flex;gap:6px;flex-wrap:wrap">
<button class="btn secondary small" data-pd-addq>+ Pergunta de opções</button>
<button class="btn secondary small" data-pd-addt>+ Pergunta escrita</button>
<button class="btn secondary small" data-pd-addb>+ Bloco de anúncio</button>
<button class="btn secondary small" data-pd-addd>+ Link direto</button>
</div>
</div>
<div class="actions">
<button class="btn" id="pd-save">Salvar pesquisa</button>
<button class="btn secondary" id="pd-cancel">Cancelar</button>
</div>`);
$("pd-cancel").onclick=()=>{pesqDraft=null;closeModal()};
$("modalBody").onclick=e=>{
const t=e.target.closest("[data-pd-del],[data-pd-oadd],[data-pd-odel],[data-pd-addq],[data-pd-addt],[data-pd-addb],[data-pd-addd]");
if(!t)return;
const d=pesqDraft;if(!d)return;
if(t.dataset.pdDel!==undefined){pesqDraftCollect();d.steps.splice(Number(t.dataset.pdDel),1)}
if(t.dataset.pdOadd!==undefined){pesqDraftCollect();const q=d.steps[Number(t.dataset.pdOadd)];if(q&&(q.opts||[]).length<6)q.opts.push("")}
if(t.dataset.pdOdel!==undefined){pesqDraftCollect();const [qi,oi]=t.dataset.pdOdel.split(":").map(Number);const q=d.steps[qi];if(q){q.opts.splice(oi,1);if(q.correct>=q.opts.length)q.correct=0}}
if(t.dataset.pdAddq!==undefined){pesqDraftCollect();d.steps.push({kind:"question",type:"choice",text:"",opts:["",""],trap:false,correct:0})}
if(t.dataset.pdAddt!==undefined){pesqDraftCollect();d.steps.push({kind:"question",type:"text",text:"",minChars:10,maxChars:300})}
if(t.dataset.pdAddb!==undefined){pesqDraftCollect();d.steps.push({kind:"banner",platform:"Adsterra",code:"",w:300,h:250})}
if(t.dataset.pdAddd!==undefined){pesqDraftCollect();d.steps.push({kind:"direct",url:"",label:"Continuar"})}
pesqEditRender();
};
$("pd-save").onclick=async()=>{
pesqDraftCollect();
const d=pesqDraft;if(!d)return;
if(d.title.length<3)return toast("Título muito curto.");
const qs=d.steps.filter(s=>s.kind==="question");
if(!qs.length)return toast("Adicione pelo menos 1 pergunta.");
for(const q of qs){
if((q.text||"").length<3)return toast("Toda pergunta precisa de texto.");
if(q.type!=="text"){
if((q.opts||[]).length<2)return toast("Perguntas de opções precisam de 2+ opções.");
if(q.trap&&(Number(q.correct)>=q.opts.length))return toast("Defina a opção correta da isca.");
}
}
for(const b of d.steps.filter(s=>s.kind==="banner")){if(!(b.code||"").trim())return toast("Preencha o código de todos os blocos de anúncio.")}
for(const l of d.steps.filter(s=>s.kind==="direct")){if(!/^https?:\/\//i.test(l.url||""))return toast("Links diretos precisam de URL http(s).")}
const econ=econCfg();
const val=pesqValueOf(d.steps,econ.survey);
try{
const payload={title:d.title,desc:d.desc,cat:d.cat,audience:d.audience,slots:d.slots,
steps:d.steps,questions:d.steps.filter(s=>s.kind==="question").map(q=>({text:q.text,opts:q.opts||[],trap:q.trap===true,correct:Number(q.correct)||0,type:q.type||"choice",minChars:Number(q.minChars)||0,maxChars:Number(q.maxChars)||300})),
reward:val,amount:val*d.slots,updatedAt:serverTimestamp()};
if(d.id){await setDoc(doc(db,"surveys",d.id),payload,{merge:true});toast("Pesquisa atualizada.")}
else{await setDoc(doc(collection(db,"surveys")),{...payload,uid:null,ownerName:"Equipe Yshipp",status:"approved",responses:0,createdAt:serverTimestamp()});toast("Pesquisa criada e publicada.")}
pesqDraft=null;closeModal();await loadAll();
}catch(err){error(err)}
};
}
$("pesqNew").onclick=()=>pesqDraftNew();
$("pesqFilter").onchange=renderPesquisas;
$("pesqAud").onchange=renderPesquisas;

/* ════════════════════════════════════════════════════════════════
   YSHIPPCOMMERCE MARKET · itens da loja, pedidos PIX e saques
   ════════════════════════════════════════════════════════════════ */

const MKT_SECTIONS={packages:"Pacotes de reais",fichas:"Pacotes de fichas",mining:"Mineração de reais",buffs:"Buffs",recarga:"Recarga em reais",custom:"Itens avulsos"};
const MKT_KINDS={packages:"package",mining:"mining",buffs:"buff",recarga:"recarga",custom:"custom"};

const MKT_DEFAULTS=[
{section:"packages",name:"Pacote Iniciante",desc:"R$ 5,00 de saldo direto na carteira.",priceBrl:4.5,ticketType:"common",amount:5,badge:"",icon:"ticket",sortOrder:1},
{section:"packages",name:"Pacote Turbinada",desc:"R$ 13,00 de saldo com bônus de 30%.",priceBrl:9.9,ticketType:"common",amount:13,badge:"MAIS POPULAR",icon:"bolt",sortOrder:2},
{section:"packages",name:"Pacote Master",desc:"R$ 40,00 de saldo para eventos e leilões.",priceBrl:27.9,ticketType:"common",amount:40,badge:"",icon:"chart",sortOrder:3},
{section:"packages",name:"Pacote Mega",desc:"R$ 100,00 de saldo + R$ 10,00 de brinde.",priceBrl:59.9,ticketType:"common",amount:100,goldBonus:10,badge:"",icon:"coins",sortOrder:4},
{section:"packages",name:"Pacote Lenda",desc:"R$ 250,00 de saldo + R$ 50,00 de brinde.",priceBrl:129.9,ticketType:"common",amount:250,goldBonus:50,badge:"MELHOR CUSTO",icon:"trophy",sortOrder:5},
{section:"mining",name:"Minerador Beta",desc:"Mina até R$ 5,00 por mês.",priceBrl:5,yieldPerMonth:5,durationDays:30,badge:"BETA",icon:"hammer",sortOrder:1},
{section:"mining",name:"Minerador Starter",desc:"Mina até R$ 12,00 por mês.",priceBrl:11,yieldPerMonth:12,durationDays:30,badge:"",icon:"hammer",sortOrder:2},
{section:"mining",name:"Minerador Pro",desc:"Mina até R$ 30,00 por mês.",priceBrl:24,yieldPerMonth:30,durationDays:30,badge:"",icon:"rocket",sortOrder:3},
{section:"mining",name:"Minerador Ultra",desc:"Mina até R$ 75,00 por mês.",priceBrl:55,yieldPerMonth:75,durationDays:30,badge:"",icon:"rocket",sortOrder:4},
{section:"mining",name:"Minerador Titã",desc:"Mina até R$ 200,00 por mês.",priceBrl:129,yieldPerMonth:200,durationDays:30,badge:"MAIS PODER",icon:"safe",sortOrder:5},
{section:"buffs",name:"Recompensa Turbinada +25%",desc:"+25% nos reais das pesquisas por 7 dias.",priceBrl:4.99,effect:{type:"rewardBoost",pct:25},durationDays:7,badge:"",icon:"bolt",sortOrder:1},
{section:"buffs",name:"Recompensa Frenética +50%",desc:"+50% nos reais das pesquisas por 3 dias.",priceBrl:5.99,effect:{type:"rewardBoost",pct:50},durationDays:3,badge:"",icon:"bolt",sortOrder:2},
{section:"buffs",name:"Mineração Frenética +50%",desc:"+50% no rendimento da sua mineração por 7 dias.",priceBrl:6.99,effect:{type:"miningBoost",pct:50},durationDays:7,badge:"",icon:"hammer",sortOrder:3},
{section:"buffs",name:"Mineração Dupla +100%",desc:"Mineração 2× mais rápida por 3 dias.",priceBrl:9.99,effect:{type:"miningBoost",pct:100},durationDays:3,badge:"FORTE",icon:"rocket",sortOrder:4},
{section:"buffs",name:"Turbo Tarefas +30%",desc:"+30% nas recompensas de tarefas por 7 dias.",priceBrl:4.99,effect:{type:"taskBoost",pct:30},durationDays:7,badge:"NOVO",icon:"check",sortOrder:5},
{section:"buffs",name:"Turbo Anúncio +50%",desc:"+50% na recompensa dos anúncios patrocinados por 5 dias.",priceBrl:3.99,effect:{type:"adBoost",pct:50},durationDays:5,badge:"NOVO",icon:"megaphone",sortOrder:6},
{section:"recarga",name:"Recarga R$ 10",desc:"Adiciona R$ 10,00 de saldo em reais na carteira.",priceBrl:10,brlAmount:10,badge:"",icon:"coins",sortOrder:1},
{section:"recarga",name:"Recarga R$ 25",desc:"Adiciona R$ 25,00 de saldo em reais na carteira.",priceBrl:25,brlAmount:25,badge:"",icon:"coins",sortOrder:2},
{section:"recarga",name:"Recarga R$ 50",desc:"Adiciona R$ 50,00 de saldo em reais na carteira.",priceBrl:50,brlAmount:50,badge:"",icon:"coins",sortOrder:3},
{section:"recarga",name:"Recarga R$ 100",desc:"Adiciona R$ 100,00 de saldo em reais na carteira.",priceBrl:100,brlAmount:100,badge:"TOP",icon:"safe",sortOrder:4}
];

function renderMarket(){
if(!loaded)return;
const econ=econCfg();
const items=(C.storeItems||[]).slice().sort((a,b)=>(a.section>b.section?1:a.section<b.section?-1:(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)));
$("mktSectionFilter").innerHTML=`<option value="">Todos os setores</option>`+Object.entries(MKT_SECTIONS).map(([k,v])=>`<option value="${k}" ${$("mktSectionFilter").value===k?"selected":""}>${v}</option>`).join("");
const f=$("mktSectionFilter").value;
const list=items.filter(x=>(!f||x.section===f));
const pend=(C.orders||[]).filter(o=>o.status==="pending").length;
$("marketBadge").textContent=String(pend);
$("marketBadge").style.display=pend?"":"none";
const rev=(C.orders||[]).filter(o=>o.status==="paid").reduce((s,o)=>s+(Number(o.amountBrl)||0),0);
const wdPend=(C.withdrawals||[]).filter(w=>w.status==="pending").length;
$("marketStats").innerHTML=`
<div class="card"><div class="stat-label">Receita confirmada</div><div class="stat-value gold">${fmtBRL(rev)}</div><div class="stat-foot">Pedidos pagos no Market</div></div>
<div class="card"><div class="stat-label">Pedidos pendentes</div><div class="stat-value red">${pend}</div><div class="stat-foot">Aguardando PIX / confirmação</div></div>
<div class="card"><div class="stat-label">Saques pendentes</div><div class="stat-value ${wdPend?"red":""}">${wdPend}</div><div class="stat-foot">Via PIX · mín. ${fmtBRL(econ.withdrawMin)}</div></div>
<div class="card"><div class="stat-label">Itens ativos</div><div class="stat-value">${items.filter(x=>x.active!==false).length}</div><div class="stat-foot">${items.length} cadastrados · ${items.filter(x=>x.active===false).length} inativo(s)</div></div>`;
$("mktList").innerHTML=list.length?list.map(x=>{
const BUFF_META={miningBoost:"mineração",rewardBoost:"pesquisas pagas",taskBoost:"tarefas",adBoost:"anúncio patrocinado"};
const isMining=x.section==="mining",isBuff=x.section==="buffs",isRec=x.section==="recarga";
const sub=isMining?`Mina até ${fmtBRL(Number(x.yieldPerMonth)||0)}/mês`:
isBuff?`+${Number(x.effect?.pct)||0}% ${BUFF_META[x.effect?.type]||"recompensa"} · ${Number(x.durationDays)||0} dias`:
isRec?`Saldo em reais na carteira`:
`${fmtBRL(Number(x.amount)||0)}${x.goldBonus?` + ${fmtBRL(x.goldBonus)} de brinde`:""}`;
return `<div class="item${x.active===false?" inativo":""}">
<h3><i class=yi data-i=${esc(x.icon||"cart")}></i> ${esc(x.name)} ${x.badge?`<span class="status yellow">${esc(x.badge)}</span>`:""}${x.active===false?` <span class="status">INATIVO</span>`:""}${x.fromCentral?` <span class="status green">CENTRAL DE CRIAÇÃO</span>`:""}</h3>
<p>${esc(x.desc||"")}</p>
<p class="mono">${fmtBRL(Number(x.priceBrl)||0)} · ${sub}</p>
<div class="actions">
${x.active===false?`<button class="btn success small" data-mkt-on="${esc(x.id)}">Ativar</button>`:`<button class="btn secondary small" data-mkt-off="${esc(x.id)}">Pausar</button>`}
<button class="btn secondary small" data-mkt-ed="${esc(x.id)}">Editar</button>
<button class="btn danger small" data-mkt-dl="${esc(x.id)}">Excluir</button>
</div>
</div>`;
}).join(""):`<div class="empty">Nenhum item neste setor. Clique em “+ Novo item” ou restaure os padrões.</div>`;
renderOrders();
renderWithdrawals();
}

function mktEdit(id){
const isNew=!id;
const x=id?(C.storeItems||[]).find(i=>i.id===id):{section:"packages",active:true,sortOrder:((C.storeItems||[]).length+1),ticketType:"common"};
if(!x)return;
const sel=(key,opts,v)=>`<select id="mk_${key}">${opts.map(o=>{const val=o?.value??o,lab=o?.label??o;return `<option value="${esc(val)}" ${String(v)===String(val)?"selected":""}>${esc(lab)}</option>`}).join("")}</select>`;
const num=(key,v,mn)=>`<input id="mk_${key}" type="number" min="${mn}" step="0.01" value="${Number(v)||0}">`;
const fi=(lab,inner)=>`<div class="field" style="margin:0"><label>${lab}</label>${inner}</div>`;
openModal(isNew?"Novo item do Market":"Editar item",`
<div class="form-grid">
${fi("Setor",sel("section",Object.entries(MKT_SECTIONS).map(([k,v])=>({value:k,label:v})),x.section||"packages"))}
${fi("Nome",`<input id="mk_name" value="${esc(x.name||"")}">`)}
${fi("Preço (R$)",num("priceBrl",x.priceBrl,0.01))}
${fi("Selo/badge (opcional)",`<input id="mk_badge" value="${esc(x.badge||"")}">`)}
${fi("Ícone (nome do ícone Yi)",`<input id="mk_icon" value="${esc(x.icon||"cart")}" placeholder="Ex.: ticket, coins, rocket, hammer, bolt">`)}
${fi("Ordem",`<input id="mk_sortOrder" type="number" min="0" step="1" value="${Number(x.sortOrder)||0}">`)}
</div>
<div class="mk-sec-note" id="mk-note"></div>
<div class="form-grid" id="mk-specific">
<div class="mkb" data-sec="packages" style="display:none">
<b class="mkb-t">Campos do pacote de saldo</b>
${fi("Saldo que o pacote entrega (R$)",`<input id="mk_amount" type="number" min="0" step="1" value="${Number(x.amount)||0}">`)}
${fi("Tipo de saldo",sel("ticketType",["common","gold","vip"],x.ticketType||"common"))}
${fi("Dourados de brinde (opcional)",`<input id="mk_goldBonus" type="number" min="0" step="1" value="${Number(x.goldBonus)||0}">`)}
</div>
<div class="mkb" data-sec="mining" style="display:none">
<b class="mkb-t">Campos do plano de mineração</b>
${fi("Rendimento mensal (R$/mês)",`<input id="mk_yield" type="number" min="0" step="1" value="${Number(x.yieldPerMonth)||0}">`)}
</div>
<div class="mkb" data-sec="buffs" style="display:none">
<b class="mkb-t">Campos do buff</b>
${fi("Efeito",sel("effectType",[{value:"",label:"—"},{value:"rewardBoost",label:"+% pesquisas pagas"},{value:"miningBoost",label:"+% mineração"},{value:"taskBoost",label:"+% tarefas"},{value:"adBoost",label:"+% anúncio patrocinado"}],x.effect?.type||""))}
${fi("Força do efeito (%)",`<input id="mk_effectPct" type="number" min="0" step="1" value="${Number(x.effect?.pct)||0}">`)}
</div>
<div class="mkb" data-sec="mining buffs" style="display:none">
<b class="mkb-t">Duração (dias)</b>
${fi("Por quantos dias o plano/buff vale",`<input id="mk_durationDays" type="number" min="1" step="1" value="${Number(x.durationDays)||30}">`)}
</div>
<div class="mkb" data-sec="recarga" style="display:none">
<b class="mkb-t">Campos da recarga em reais</b>
${fi("Saldo em reais creditado (deve ser IGUAL ao preço)",num("brlAmount",x.brlAmount,0.01))}
</div>
<div class="mkb" data-sec="custom" style="display:none">
<b class="mkb-t">Item avulso</b>
<p class="hint" style="margin:0">Atenção: itens avulsos <b>não creditam automaticamente</b> — o pedido só é marcado como pago e a entrega é manual pela equipe.</p>
</div>
</div>
<div class="form-grid">
${fi("Ativo",sel("active",[{value:"true",label:"true — visível na loja"},{value:"false",label:"false — oculto"}],x.active===false?"false":"true"))}
</div>
<div class="field"><label>Descrição</label><textarea id="mk_desc">${esc(x.desc||"")}</textarea></div>
<div class="actions">
<button class="btn" id="mk-save">Salvar item</button>
<button class="btn secondary" id="mk-cancel">Cancelar</button>
<button class="btn secondary" id="mk-def">Restaurar padrões (todos os setores)</button>
</div>`);
/* mostra APENAS os campos do setor escolhido — troca em tempo real quando o setor muda */
const MK_NOTES={
packages:"Quantos reais o pacote entrega na carteira e o tipo (comum/dourado/VIP — todos valem R$ 1,00). Os demais campos não são usados neste setor.",
mining:"O plano rende reais por mês: informe o rendimento e a duração. Os campos de pacote não são usados aqui.",
buffs:"Escolha o efeito (+% recompensa ou +% mineração), a força e por quantos dias ele vale. O percentual é limitado pelo teto da aba Economia.",
recarga:"Informe o saldo em reais creditado na carteira — ele deve ser IGUAL ao preço, senão você entrega dinheiro de graça.",
custom:"Itens avulsos não creditam automaticamente — use apenas para entregas manuais da equipe."
};
const showSec=()=>{
const s=$("mk_section").value;
document.querySelectorAll("#modalBody .mkb").forEach(el=>{el.style.display=String(el.dataset.sec||"").split(" ").includes(s)?"":"none"});
$("mk-note").innerHTML="<i class=yi data-i=bulb></i> "+esc(MK_NOTES[s]||"");
};
$("mk_section").onchange=showSec;
showSec();
$("mk-cancel").onclick=closeModal;
$("mk-def").onclick=async()=>{
if(!confirm("Substituir/criar todos os itens padrão do Market? Itens existentes com o mesmo nome são atualizados."))return;
try{
for(const d of MKT_DEFAULTS){
const same=(C.storeItems||[]).find(i=>i.name===d.name);
if(same)await setDoc(doc(db,"storeItems",same.id),{...d,active:true,updatedAt:serverTimestamp()},{merge:true});
else await setDoc(doc(collection(db,"storeItems")),{...d,active:true,updatedAt:serverTimestamp(),createdAt:serverTimestamp()});
}
await loadAll();closeModal();toast("Itens padrão do Market restaurados.");
}catch(err){error(err)}
};
$("mk-save").onclick=async()=>{
const section=$("mk_section").value;
const data={
section,kind:MKT_KINDS[section]||"custom",
name:$("mk_name").value.trim(),
desc:$("mk_desc").value.trim(),
badge:$("mk_badge").value.trim(),
icon:$("mk_icon").value.trim()||"cart",
sortOrder:Math.max(0,Math.floor(Number($("mk_sortOrder").value)||0)),
priceBrl:Math.max(0.01,Number($("mk_priceBrl").value)||0.01),
amount:Math.max(0,Math.floor(Number($("mk_amount").value)||0)),
ticketType:$("mk_ticketType").value,
goldBonus:Math.max(0,Math.floor(Number($("mk_goldBonus").value)||0)),
yieldPerMonth:Math.max(0,Math.floor(Number($("mk_yield").value)||0)),
durationDays:Math.max(1,Math.floor(Number($("mk_durationDays").value)||30)),
brlAmount:Math.max(0,Number($("mk_brlAmount").value)||0),
active:$("mk_active").value==="true",
updatedAt:serverTimestamp()
};
const effT=$("mk_effectType").value;
data.effect=effT?{type:effT,pct:Math.max(0,Math.floor(Number($("mk_effectPct").value)||0))}:null;
if(!data.name)return toast("Dê um nome ao item.");
if(data.effect){
const cap=data.effect.type==="miningBoost"?econCfg().maxMiningBuffPct:econCfg().maxRewardBuffPct;
if(data.effect.pct>cap){data.effect.pct=cap;toast("Percentual limitado ao teto da economia: "+cap+"%.")}
}
try{
if(isNew)await setDoc(doc(collection(db,"storeItems")),{...data,createdAt:serverTimestamp()});
else await setDoc(doc(db,"storeItems",id),data,{merge:true});
closeModal();await loadAll();toast("Item salvo.");
}catch(err){error(err)}
};
}
$("mktNew").onclick=()=>mktEdit(null);
$("mktSectionFilter").onchange=renderMarket;
$("mktList").onclick=e=>{
const ed=e.target.dataset.mktEd,dl=e.target.dataset.mktDl,on=e.target.dataset.mktOn,off=e.target.dataset.mktOff;
if(ed)mktEdit(ed);
if(on)setDoc(doc(db,"storeItems",on),{active:true,updatedAt:serverTimestamp()},{merge:true}).then(()=>toast("Item ativado — já está visível na loja do site.")).then(loadAll).catch(error);
if(off){
if(!confirm("Pausar este item? Ele sai da loja do site, mas continua cadastrado."))return;
setDoc(doc(db,"storeItems",off),{active:false,updatedAt:serverTimestamp()},{merge:true}).then(()=>toast("Item pausado — saiu da loja do site.")).then(loadAll).catch(error);
}
if(dl){
if(!confirm("Excluir este item da loja?"))return;
deleteDoc(doc(db,"storeItems",dl)).then(()=>loadAll().then(()=>toast("Item excluído."))).catch(error);
}
};

/* PEDIDOS */
function renderOrders(){
const f=$("orderFilter").value;
const list=(C.orders||[]).filter(o=>f==="all"||o.status===f).sort((a,b)=>(stamp(b.createdAt)||0)-(stamp(a.createdAt)||0));
$("orderList").innerHTML=list.length?list.map(o=>`
<tr>
<td><b class="mono">${esc(o.id.slice(0,8))}</b><small>${date(o.createdAt)}</small></td>
<td>${esc(o.userName||"—")}<small class="mono">${esc((o.uid||"").slice(0,12))}</small></td>
<td><b>${esc(o.item?.name||o.itemSnapshot?.name||"Item")}</b><small>${esc(MKT_SECTIONS[o.section]||o.section||"")}</small></td>
<td><b class="gold">${fmtBRL(Number(o.amountBrl)||0)}</b></td>
<td>${o.status==="pending"?'<span class="status yellow">Aguardando PIX</span>':o.status==="paid"?'<span class="status green">Pago / creditado</span>':'<span class="status red">Cancelado</span>'}</td>
<td style="white-space:nowrap">
${o.status==="pending"?`<button class="btn success small" data-ord-ok="${esc(o.id)}">Confirmar pagamento</button> <button class="btn danger small" data-ord-no="${esc(o.id)}">Cancelar</button>`:"—"}
</td>
</tr>`).join(""):`<tr><td colspan="6"><div class="empty">Nenhum pedido neste filtro.</div></td></tr>`;
}
$("orderList").onclick=async e=>{
const ok=e.target.dataset.ordOk,no=e.target.dataset.ordNo;
if(ok){
const o=(C.orders||[]).find(x=>x.id===ok);if(!o)return;
if(!confirm("Confirmar o PIX de "+fmtBRL(Number(o.amountBrl)||0)+" e creditar “"+(o.item?.name||"o item")+"” na carteira do comprador?"))return;
try{
await runTransaction(db,async tx=>{
const [os,wss]=await Promise.all([
tx.get(doc(db,"orders",ok)),
o.uid?tx.get(doc(db,"wallets",o.uid)):Promise.resolve(null)
]);
if(os.exists()&&os.data().status==="paid")throw new Error("Pedido já creditado.");
if(os.exists()&&os.data().status==="canceled")throw new Error("Este pedido foi cancelado — não pode ser creditado.");
const it=o.item||{};
if(o.uid&&wss){
const w=wss.exists?wss.data():{};
if(o.section==="packages"){
const k=it.ticketType||"common";
w[k]=(Number(w[k])||0)+(Number(it.amount)||0);
if(it.goldBonus)w.gold=(Number(w.gold)||0)+(Number(it.goldBonus)||0);
}
if(o.section==="recarga"){w.brl=(Number(w.brl)||0)+(Number(it.brlAmount)||Number(o.amountBrl)||0)}
if(o.section==="fichas"){
/* pacotes de fichas: moedas, bilhetes e diamantes — creditados nos
   campos próprios da carteira (nunca viram reais) */
const k=it.xcKind||"coin";
w[k]=(Number(w[k])||0)+(Number(it.xcQty)||0);
}
if(o.section==="mining"){
w.miningPlans=Array.isArray(w.miningPlans)?w.miningPlans:[];
w.miningPlans.push({id:ok,itemId:o.itemId,name:it.name||"Minerador",yieldPerMonth:Number(it.yieldPerMonth)||0,startsAt:Date.now(),endsAt:null,durDays:Number(it.durationDays)||30,lastCollect:Date.now()});
}
if(o.section==="buffs"){
const cap=it.effect?.type==="miningBoost"?econCfg().maxMiningBuffPct:econCfg().maxRewardBuffPct;
w.buffs=Array.isArray(w.buffs)?w.buffs:[];
w.buffs.push({id:ok,name:it.name||"Buff",effect:{type:it.effect?.type||"rewardBoost",pct:Math.min(cap,Number(it.effect?.pct)||0)},startsAt:Date.now(),endsAt:null,durDays:Number(it.durationDays)||7});
}
tx.set(doc(db,"orders",ok),{status:"paid",paidAt:serverTimestamp()},{merge:true});
tx.set(doc(db,"wallets",o.uid),{...w,updatedAt:serverTimestamp()});
tx.set(doc(collection(db,"wallets",o.uid,"history")),{kind:o.section==="recarga"?"market_purchase":"market_buy",amount:0,ticketType:it.ticketType||"common",brl:Number(o.amountBrl)||0,reason:"Market: "+String(it.name||"item").slice(0,60),createdAt:serverTimestamp()});
}else{
tx.set(doc(db,"orders",ok),{status:"paid",paidAt:serverTimestamp()},{merge:true});
}
tx.set(doc(db,"settings","economy"),{marketRevenue:increment(Number(o.amountBrl)||0)},{merge:true});
});
await loadAll();toast("Pagamento confirmado e item creditado na carteira do comprador.");
}catch(err){error(err)}
}
if(no){
if(!confirm("Cancelar este pedido? Nada é debitado (o participante só perde a intenção de compra)."))return;
try{
await setDoc(doc(db,"orders",no),{status:"canceled",updatedAt:serverTimestamp()},{merge:true});
await loadAll();toast("Pedido cancelado.");
}catch(err){error(err)}
}
};
$("orderFilter").onchange=renderOrders;

/* SAQUES */
function renderWithdrawals(){
const f=$("wdFilter").value;
const list=(C.withdrawals||[]).filter(w=>f==="all"||w.status===f).sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0)||((stamp(b.createdAt)||0)-(stamp(a.createdAt)||0)));
$("wdList").innerHTML=list.length?list.map(w=>`
<tr>
<td>${esc(w.userName||"—")}${w.priority?' <span class="status yellow" style="margin-left:4px">★ VIP</span>':""}<small class="mono">${esc((w.uid||"").slice(0,12))}</small></td>
<td><b class="gold">${fmtBRL(Number(w.netBrl)||Number(w.amountBrl)||0)}</b>${Number(w.feeBrl)?`<small>taxa ${fmtBRL(Number(w.feeBrl))}</small>`:""}</td>
<td class="mono" style="max-width:220px;overflow-wrap:anywhere">${esc(w.pixKey||"—")}</td>
<td>${w.status==="pending"?'<span class="status yellow">Pendente</span>':w.status==="paid"?'<span class="status green">Pago</span>':'<span class="status red">Recusado (devolvido)</span>'}</td>
<td style="white-space:nowrap">
${w.status==="pending"?`<button class="btn success small" data-wd-ok="${esc(w.id)}">Aprovar / paguei</button> <button class="btn danger small" data-wd-no="${esc(w.id)}">Recusar</button>`:"—"}
</td>
</tr>`).join(""):`<tr><td colspan="5"><div class="empty">Nenhum saque neste filtro.</div></td></tr>`;
}
$("wdList").onclick=async e=>{
const ok=e.target.dataset.wdOk,no=e.target.dataset.wdNo;
if(ok){
if(!confirm("Marcar como PAGO após enviar o PIX manualmente? O valor já foi debitado da carteira do usuário no pedido."))return;
try{
/* releitura do saque: marcar como pago um saque já recusado (valor devolvido
   ao usuário) causaria pagamento em dobro — bloqueado aqui */
await runTransaction(db,async tx=>{
const wsnap=await tx.get(doc(db,"withdrawals",ok));
if(!wsnap.exists())throw new Error("Saque não encontrado.");
const st=wsnap.data().status;
if(st==="paid")throw new Error("Este saque já foi marcado como pago.");
if(st==="rejected")throw new Error("Este saque foi recusado e o valor devolvido — não marque como pago.");
tx.set(doc(db,"withdrawals",ok),{status:"paid",paidAt:serverTimestamp()},{merge:true});
});
await loadAll();toast("Saque marcado como pago.");
const wp=C.withdrawals.find(x=>x.id===ok);
notifyUser(wp?.uid,"finance","<i class=yi data-i=send></i> Saque pago via PIX","Seu saque de <b style='color:#fcd535'>"+fmtBRL(Number(wp?.amountBrl)||0)+"</b> foi enviado pela equipe. Confira o extrato na sua carteira.","#wallet");
}catch(err){error(err)}
}
if(no){
if(!confirm("Recusar este saque? O valor em reais volta para a carteira do usuário."))return;
try{
await runTransaction(db,async tx=>{
/* releitura FRESCA do saque: recusar 2× (ou recusar um saque já pago)
   não pode mais devolver o valor duas vezes */
const wsnap=await tx.get(doc(db,"withdrawals",no));
if(!wsnap.exists())throw new Error("Saque não encontrado.");
const st=wsnap.data().status;
if(st!=="pending")throw new Error(st==="paid"?"Este saque já foi pago — não pode ser recusado agora.":"Este saque já foi recusado.");
const wd=wsnap.data();
const amount=Math.round((Number(wd.amountBrl)||0)*100)/100;
tx.set(doc(db,"withdrawals",no),{status:"rejected",updatedAt:serverTimestamp()},{merge:true});
if(wd.uid&&amount>0){
tx.set(doc(db,"wallets",wd.uid),{brl:increment(amount),updatedAt:serverTimestamp()},{merge:true});
tx.set(doc(collection(db,"wallets",wd.uid,"history")),{kind:"withdraw_refund",amount:0,brl:amount,reason:"Saque recusado — valor devolvido",createdAt:serverTimestamp()});
}
});
await loadAll();toast("Saque recusado e valor devolvido.");
const wn=C.withdrawals.find(x=>x.id===no);
notifyUser(wn?.uid,"finance","<i class=yi data-i=warn></i> Saque recusado","Seu saque de <b style='color:#fcd535'>"+fmtBRL(Number(wn?.amountBrl)||0)+"</b> foi recusado e o valor já voltou para o saldo da sua carteira. Em caso de dúvida, fale com o suporte.","#wallet");
}catch(err){error(err)}
}
};
$("wdFilter").onchange=renderWithdrawals;

/* ════════════════════════════════════════════════════════════════
   ECONOMIA (REAIS) · settings/economy
   ════════════════════════════════════════════════════════════════ */

const CRYPTO_ALL=["BTC","ETH","USDT","BNB","SOL","XRP","ADA","DOGE","LTC","MATIC"];

function renderEconomy(){
if(!loaded)return;
const econ=econCfg();
$("ec-tp-common").value=econ.ticketPoints.common;
$("ec-tp-gold").value=econ.ticketPoints.gold;
$("ec-tp-vip").value=econ.ticketPoints.vip;
$("ec-ticketsperbrl").value=econ.ticketsPerBrl;
const tc=econ.ticketConv;
$("ec-tc-on").value=String(tc.enabled);
$("ec-tc-fee").value=tc.feePct;
$("ec-tc-min").value=tc.min;
$("ec-tc-max").value=tc.max;
const TC_PAIRS=[["common","gold"],["common","vip"],["gold","common"],["gold","vip"],["vip","common"],["vip","gold"]];
const TCK={"common":"Comum","gold":"Dourado","vip":"VIP"};
$("ec-tc-pairs").innerHTML=TC_PAIRS.map(([f,t])=>`<label style="display:flex;gap:8px;align-items:center;background:var(--p2);border:1px solid var(--l);border-radius:8px;padding:9px 11px;font-size:13px"><input type="checkbox" data-tc-pair="${f}:${t}" ${tc.pairs[f][t]?"checked":""} style="width:auto"> ${TCK[f]} → ${TCK[t]}</label>`).join("");
$("ec-minwithdraw").value=econ.withdrawMin;
$("ec-fee").value=econ.withdrawFee;
$("ec-wddays").value=econ.withdrawDays;
$("ec-sv-base").value=econ.survey.base;
$("ec-sv-q").value=econ.survey.perQuestion;
$("ec-sv-opt").value=econ.survey.perOption;
$("ec-sv-text").value=econ.survey.perText;
$("ec-sv-banner").value=econ.survey.perBanner;
$("ec-sv-direct").value=econ.survey.perDirect;
$("ec-sv-time").value=econ.survey.perTime;
$("ec-sv-min").value=econ.survey.min;
$("ec-sv-max").value=econ.survey.max;
$("ec-maxminebuff").value=econ.maxMiningBuffPct;
$("ec-maxrewbuff").value=econ.maxRewardBuffPct;
$("ec-mineon").value=String(econ.miningOn);
$("ec-buffon").value=String(econ.buffsOn);
$("ec-pixkey").value=econ.pix.key||"";
$("ec-pixname").value=econ.pix.name||"";
$("ec-pixcity").value=econ.pix.city||"";
$("ec-pixdesc").value=econ.pix.desc||"";
const evip=econ.vip;
$("ec-vip-fee").value=evip.feePct;
$("ec-vip-pool").value=evip.poolGoal;
$("ec-vip-streak").value=evip.streakDays;
$("ec-vip-tasks").value=evip.tasksPerDay;
renderVipStatus();
$("ecCryptoList").innerHTML=CRYPTO_ALL.map(c=>`<label style="display:flex;gap:8px;align-items:center;background:var(--p2);border:1px solid var(--l);border-radius:8px;padding:9px 11px;font-size:13px"><input type="checkbox" data-ec-crypto="${c}" ${econ.cryptos.includes(c)?"checked":""} style="width:auto"> <b class="mono">${c}</b></label>`).join("");
}

$("saveEcon").onclick=async()=>{
const cryptos=[...document.querySelectorAll("[data-ec-crypto]")].filter(c=>c.checked).map(c=>c.dataset.ecCrypto);
const tcPairs={};
document.querySelectorAll("[data-tc-pair]").forEach(cb=>{const [f,t]=cb.dataset.tcPair.split(":");(tcPairs[f]=tcPairs[f]||{})[t]=cb.checked;});
const tcd=ECON_DEFAULTS.ticketConv;
["common","gold","vip"].forEach(k=>{tcPairs[k]={gold:!!tcPairs[k]?.gold,vip:!!tcPairs[k]?.vip,common:!!tcPairs[k]?.common};});
const max=Math.max(1,Math.floor(Number($("ec-sv-max").value)||100));
const min=Math.min(max,Math.max(1,Math.floor(Number($("ec-sv-min").value)||1)));
const data={
ticketPoints:{common:Math.max(1,Math.floor(Number($("ec-tp-common").value)||ECON_DEFAULTS.ticketPoints.common)),gold:Math.max(1,Math.floor(Number($("ec-tp-gold").value)||ECON_DEFAULTS.ticketPoints.gold)),vip:Math.max(1,Math.floor(Number($("ec-tp-vip").value)||ECON_DEFAULTS.ticketPoints.vip))},
ticketsPerBrl:Math.max(1,Math.floor(Number($("ec-ticketsperbrl").value)||1000)),
withdrawMin:Math.max(0.01,Number($("ec-minwithdraw").value)||5),
withdrawFee:Math.min(50,Math.max(0,Number($("ec-fee").value)||0)),
withdrawDays:Math.min(30,Math.max(0,Math.floor(Number($("ec-wddays").value)||0))),
survey:{base:Math.max(0,Number($("ec-sv-base").value)||0),perQuestion:Math.max(0,Number($("ec-sv-q").value)||0),perOption:Math.max(0,Number($("ec-sv-opt").value)||0),perText:Math.max(0,Number($("ec-sv-text").value)||0),perBanner:Math.max(0,Number($("ec-sv-banner").value)||0),perDirect:Math.max(0,Number($("ec-sv-direct").value)||0),perTime:Math.max(0,Number($("ec-sv-time").value)||0),min,max},
miningOn:$("ec-mineon").value==="true",
buffsOn:$("ec-buffon").value==="true",
maxMiningBuffPct:Math.min(500,Math.max(0,Math.floor(Number($("ec-maxminebuff").value)||0))),
maxRewardBuffPct:Math.min(500,Math.max(0,Math.floor(Number($("ec-maxrewbuff").value)||0))),
pix:{key:$("ec-pixkey").value.trim(),name:$("ec-pixname").value.trim(),city:($("ec-pixcity").value.trim()||"SAO PAULO").toUpperCase(),desc:($("ec-pixdesc").value.trim()||"YSHIPPMARKET").toUpperCase().replace(/[^A-Z0-9 ]/g,"")},
cryptos:cryptos.length?cryptos:ECON_DEFAULTS.cryptos.slice(),
vip:{feePct:Math.min(50,Math.max(0,Number($("ec-vip-fee").value)||ECON_DEFAULTS.vip.feePct)),poolGoal:Math.max(1000,Math.floor(Number($("ec-vip-pool").value)||ECON_DEFAULTS.vip.poolGoal)),streakDays:Math.max(1,Math.floor(Number($("ec-vip-streak").value)||ECON_DEFAULTS.vip.streakDays)),tasksPerDay:Math.max(1,Math.floor(Number($("ec-vip-tasks").value)||ECON_DEFAULTS.vip.tasksPerDay))},
ticketConv:{enabled:$("ec-tc-on").value==="true",feePct:Math.min(50,Math.max(0,Number($("ec-tc-fee").value)||0)),min:Math.max(1,Math.floor(Number($("ec-tc-min").value)||tcd.min)),max:Math.max(1,Math.floor(Number($("ec-tc-max").value)||tcd.max)),pairs:tcPairs},
updatedAt:serverTimestamp()
};
try{
await setDoc(doc(db,"settings","economy"),data,{merge:true});
await loadAll();
toast("Economia salva — o site inteiro já usa os novos valores.");
}catch(err){error(err)}
};


/* ════════════════════════════════════════════════════════════════
   MEMBROS VIP · status do caixa e distribuição manual
   ════════════════════════════════════════════════════════════════ */

function renderVipStatus(){
if(!$("vipStatus"))return;
const econ=econCfg();
const pool=Math.max(0,Math.floor(Number(C.vipPoolData?.pool)||0));
const dists=Array.isArray(C.vipPoolData?.distributions)?C.vipPoolData.distributions:[];
const mems=(C.vipMembers||[]).filter(m=>m.vip===true&&m.id);
const share=mems.length?Math.floor(pool/mems.length):0;
const pct=Math.min(100,Math.round(pool/econ.vip.poolGoal*100));
const last=dists.length?dists[dists.length-1]:null;
$("vipStatus").innerHTML=`
<div class="form-grid">
<div class="field" style="margin:0"><label>Caixa VIP acumulado (R$)</label><input readonly value="${fmtBRL(pool)}"></div>
<div class="field" style="margin:0"><label>Progresso até a meta (${fmtBRL(econ.vip.poolGoal)})</label><input readonly value="${pct}%"></div>
<div class="field" style="margin:0"><label>Membros VIP ativos</label><input readonly value="${mems.length}"></div>
<div class="field" style="margin:0"><label>Parte por membro se distribuir</label><input readonly value="${fmtBRL(share)}"></div>
</div>
<p class="hint" style="margin:12px 0 0">Distribuições já feitas: <b>${dists.length}</b>${last?` · última: ${last.members||0} membro(s) receberam ${fmtBRL(Math.floor(Number(last.perMember)||0))} cada`:" · nenhuma ainda"}. O caixa cresce sozinho com a taxa de ${econ.vip.feePct}% das compras de criptomoeda feitas no site.</p>`;
}

$("vipRefresh").onclick=async()=>{
try{
const [m,v]=await Promise.all([
getDocs(query(collection(db,"vipMembers"),where("vip","==",true),limit(500))),
getDoc(doc(db,"settings","vip"))
]);
const fresh=m.docs.map(d=>({id:d.id,...d.data()}));
const known=new Set((C.vipMembers||[]).map(x=>x.id));
const merged=(C.vipMembers||[]).map(x=>{const f=fresh.find(n=>n.id===x.id);return f?{...x,...f}:x});
for(const f of fresh)if(!known.has(f.id))merged.push(f);
C.vipMembers=merged;
C.vipPoolData=v.exists()?v.data():{};
renderVipStatus();
toast("Status VIP atualizado.");
}catch(err){error(err)}
};

$("vipDistNow").onclick=async()=>{
const econ=econCfg();
try{
const rec=await runTransaction(db,async tx=>{
const vs=await tx.get(doc(db,"settings","vip"));
const p=Math.floor(Number(vs.data()?.pool)||0);
if(p<econ.vip.poolGoal)return null;
const mems=(C.vipMembers||[]).filter(m=>m.vip===true&&m.id);
if(!mems.length)return null;
const share=Math.floor(p/mems.length);
if(share<1)return null;
const dist=Array.isArray(vs.data()?.distributions)?vs.data().distributions.slice(-9):[];
for(const m of mems){
tx.set(doc(db,"wallets",m.id),{common:increment(share),updatedAt:serverTimestamp()},{merge:true});
tx.set(doc(collection(db,"wallets",m.id,"history")),{kind:"vip_dist",amount:share,ticketType:"common",reason:"Distribuição do caixa VIP ("+fmtBRL(share)+")",createdAt:serverTimestamp()});
}
const r={total:p,perMember:share,members:mems.length,at:Date.now()};
tx.set(doc(db,"settings","vip"),{pool:p-share*mems.length,distributions:[...dist,r],lastDistAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
return r;
});
if(rec){
toast("Caixa VIP distribuído: "+rec.members+" membro(s) receberam "+fmtBRL(rec.perMember)+" cada.");
$("vipRefresh").onclick();
}else{
toast("Nada a distribuir: o caixa ainda não atingiu a meta de "+fmtBRL(econ.vip.poolGoal)+" (ou não há membros VIP).");
}
}catch(err){error(err)}
};
/* ════════════════════════════════════════════════════════════
   CENTRAL DE AFILIADOS · grupos de divulgação em fila
   ════════════════════════════════════════════════════════════ */
const AFF_PLAT={amazon:"Amazon",shopee:"Shopee",mercadolivre:"Mercado Livre",aliexpress:"AliExpress",magalu:"Magalu",kabum:"Kabum",outro:"Outra"};
function renderAffiliates(){
 if(!$("affGroups"))return;
 const cfg={enabled:true,allowCreate:true,defaultMax:100,defaultShares:10,...(C.affiliateCfg||{})};
 const gs=C.affGroups||[];
 const ps=C.affProofs||[];
 $("affStats").innerHTML=[
  ["Grupos",gs.length,""],
  ["Membros na fila",gs.reduce((s,g)=>s+(Number(g.membersCount)||0),0),"green"],
  ["Rodadas concluídas",gs.reduce((s,g)=>s+(Number(g.cycles)||0),0),"gold"],
  ["Provas recentes",ps.filter(p=>p.status!=="removed").length,""],
  ["Central",cfg.enabled!==false?"Ativada":"Desativada",cfg.enabled!==false?"green":"red"]
 ].map(([l,v,c])=>`<div class="card"><div class="stat-label">${esc(String(l))}</div><div class="stat-value ${c}">${esc(String(v))}</div></div>`).join("");
 $("aff-on").value=String(cfg.enabled!==false);
 $("aff-allow").value=String(cfg.allowCreate!==false);
 $("aff-max").value=Math.max(2,Number(cfg.defaultMax)||100);
 $("aff-need").value=Math.max(1,Number(cfg.defaultShares)||10);
 $("affGroups").innerHTML=gs.length?[...gs].sort((a,b)=>(stamp(b.createdAt)||0)-(stamp(a.createdAt)||0)).map(g=>{
  const n=Number(g.membersCount)||0,need=Math.max(1,Number(g.sharesNeeded)||10),got=Number(g.sharesReceived)||0;
  return `<div class="item">
   <h3>${esc(g.name||"Grupo")} ${g.active===false?'<span class="status red">Desativado</span>':'<span class="status green">Ativo</span>'}</h3>
   ${g.desc?`<p>${esc(g.desc)}</p>`:""}
   <p class="hint">${(Array.isArray(g.platforms)?g.platforms:[]).map(p2=>esc(AFF_PLAT[p2]||p2)).join(", ")||"—"} · criado por ${esc(g.ownerName||"—")} · ${date(g.createdAt)}</p>
   <p class="hint">${n} membro(s) · recebendo agora: <b>${esc(g.frontName||"—")}</b> · ${got}/${need} provas desta rodada · ${Number(g.cycles)||0} rodada(s) concluída(s)${g.rules?" · regras: "+esc(String(g.rules).slice(0,120)):""}</p>
   <div class="actions">
   <button class="btn secondary small" data-affg-toggle="${esc(g.id)}">${g.active===false?"Reativar":"Desativar"}</button>
   <button class="btn secondary small" data-affg-reset="${esc(g.id)}">Reiniciar fila</button>
   <button class="btn danger small" data-affg-del="${esc(g.id)}">Excluir grupo</button>
   </div>
  </div>`;
 }).join(""):'<div class="empty">Nenhum grupo criado ainda. Os membros criam grupos direto no site.</div>';
 $("affProofs").innerHTML=ps.length?[...ps].sort((a,b)=>(stamp(b.createdAt)||0)-(stamp(a.createdAt)||0)).slice(0,40).map(p=>`
  <div class="item">
   <h3>${esc(AFF_PLAT[p.platform]||p.platform||"Prova")} ${p.status==="removed"?'<span class="status red">Removida</span>':'<span class="status green">Válida</span>'}</h3>
   <p>${esc(p.note||"—")}</p>
   ${p.link?`<p class="mono" style="overflow-wrap:anywhere">${esc(p.link)}</p>`:""}
   <p class="hint">${esc(p.name||"—")} compartilhou para <b>${esc(p.targetName||"—")}</b> · ${date(p.createdAt)}</p>
   ${p.status==="removed"?"":'<button class="btn danger small" data-affp-del="'+esc(p.id)+'">Remover prova (corrige a rodada)</button>'}
  </div>`).join(""):'<div class="empty">Nenhuma prova enviada ainda.</div>';
}
$("affSave").onclick=async()=>{
 try{
  await setDoc(doc(db,"settings","affiliate"),{
   enabled:$("aff-on").value==="true",
   allowCreate:$("aff-allow").value==="true",
   defaultMax:Math.min(500,Math.max(2,Math.floor(Number($("aff-max").value)||100))),
   defaultShares:Math.min(499,Math.max(1,Math.floor(Number($("aff-need").value)||10))),
   updatedAt:serverTimestamp()
  },{merge:true});
  await loadAll();toast("Central de Afiliados configurada.");
 }catch(e){error(e)}
};
document.addEventListener("click",async e=>{
 const tg=e.target.closest("[data-affg-toggle]");
 if(tg){
  const g=(C.affGroups||[]).find(x=>x.id===tg.dataset.affgToggle);
  if(!g)return;
  try{await updateDoc(doc(db,"affGroups",g.id),{active:g.active===false,updatedAt:serverTimestamp()});await loadAll();toast(g.active===false?"Grupo reativado.":"Grupo desativado — some do site.")}catch(err){error(err)}
  return;
 }
 const rs=e.target.closest("[data-affg-reset]");
 if(rs){
  const id=rs.dataset.affgReset;
  if(!confirm("Reiniciar a fila deste grupo? As posições voltam à ordem atual, a rodada zerada e as provas da rodada apagadas."))return;
  try{
   await runTransaction(db,async tx=>{
    const gs=await tx.get(doc(db,"affGroups",id));
    if(!gs.exists())throw new Error("Grupo não encontrado.");
    const mq=await tx.get(query(collection(db,"affGroups",id,"members"),orderBy("position","asc"),limit(500)));
    const mem=mq.docs.map(d=>({ref:d.ref,uid:d.data().uid,name:d.data().name}));
    if(!mem.length)throw new Error("Grupo sem membros.");
    mem.forEach((m,i)=>tx.set(m.ref,{position:i+1},{merge:true}));
    tx.set(doc(db,"affGroups",id),{frontUid:mem[0].uid,frontName:mem[0].name||"Membro",sharesReceived:0,updatedAt:serverTimestamp()},{merge:true});
   });
   const batch=writeBatch(db);
   (await getDocs(collection(db,"affGroups",id,"proofs"))).docs.forEach(d=>batch.delete(d.ref));
   await batch.commit().catch(()=>{});
   await loadAll();toast("Fila reiniciada.");
  }catch(err){error(err)}
  return;
 }
 const dl=e.target.closest("[data-affg-del]");
 if(dl){
  const id=dl.dataset.affgDel;
  if(!confirm("Excluir este grupo, a fila e todas as provas?"))return;
  try{
   const batch=writeBatch(db);
   (await getDocs(collection(db,"affGroups",id,"members"))).docs.forEach(d=>batch.delete(d.ref));
   (await getDocs(collection(db,"affGroups",id,"proofs"))).docs.forEach(d=>batch.delete(d.ref));
   (await getDocs(query(collection(db,"affProofs"),where("groupId","==",id)))).docs.forEach(d=>batch.delete(d.ref));
   batch.delete(doc(db,"affGroups",id));
   await batch.commit();
   await loadAll();toast("Grupo excluído.");
  }catch(err){error(err)}
  return;
 }
 const pr=e.target.closest("[data-affp-del]");
 if(pr){
  const p=(C.affProofs||[]).find(x=>x.id===pr.dataset.affpDel);
  if(!p||p.status==="removed")return;
  if(!confirm("Remover esta prova? O contador da rodada e as estatísticas do membro serão corrigidos."))return;
  try{
   await runTransaction(db,async tx=>{
    const ref=doc(db,"affProofs",p.id);
    const s=await tx.get(ref);
    if(!s.exists()||s.data().status==="removed")return;
    const pd=s.data();
    tx.set(ref,{status:"removed",removedAt:serverTimestamp()},{merge:true});
    const gid=pd.groupId;
    if(gid){
     const subId=(pd.cycleKey||"")+"_"+pd.uid;
     tx.delete(doc(db,"affGroups",gid,"proofs",subId));
     const gs=await tx.get(doc(db,"affGroups",gid));
     if(gs.exists()){
      const g=gs.data();
      if(g.frontUid===pd.targetUid&&(Number(g.sharesReceived)||0)>0){
       tx.set(doc(db,"affGroups",gid),{sharesReceived:increment(-1),updatedAt:serverTimestamp()},{merge:true});
      }
     }
     const mRef=doc(db,"affGroups",gid,"members",pd.uid);
     const ms=await tx.get(mRef);
     if(ms.exists()&&(Number(ms.data().sharesGiven)||0)>0){
      tx.set(mRef,{sharesGiven:increment(-1)},{merge:true});
     }
    }
   });
   await loadAll();toast("Prova removida e contadores corrigidos.");
  }catch(err){error(err)}
  return;
 }
});

/* INICIALIZAÇÃO */

/* ════════════════════════════════════════════════════════════
   CENTRAL DE EVENTOS · desafios, check-in, ranking, comunidade
   ════════════════════════════════════════════════════════════ */
const EC_METRICS={
 tasks_done:{l:"Tarefas concluídas",u:"tarefas"},
 tickets_earned:{l:"Reais conquistados",u:"R$"},
 surveys_done:{l:"Pesquisas respondidas",u:"pesquisas"},
 mining_collects:{l:"Coletas de mineração",u:"coletas"},
 events_joined:{l:"Entradas em eventos",u:"entradas"},
 draws_joined:{l:"Números reservados em sorteios",u:"reservas"},
 auction_bids:{l:"Lances em leilões",u:"lances"},
 ads_published:{l:"Anúncios publicados",u:"anúncios"},
 checkins:{l:"Check-ins diários",u:"check-ins"},
 challenges_done:{l:"Desafios concluídos",u:"desafios"}
};
const EC_W_DEF={tasks_done:10,tickets_earned:0.05,surveys_done:8,mining_collects:3,events_joined:12,draws_joined:6,auction_bids:4,ads_published:10,checkins:5,challenges_done:20};
function renderEventsCenter(){
 if(!$("echList"))return;
 /* seletor de métricas */
 $("ech-metric").innerHTML=Object.entries(EC_METRICS).map(([k,m])=>`<option value="${k}">${esc(m.l)}</option>`).join("");
 const chs=[...(C.challenges||[])].sort((a,b)=>(stamp(b.startAt)||0)-(stamp(a.startAt)||0));
 const cl=C.challengeClaims||[];
 const rooms=C.rooms||[];
 const cks=C.checkins||[];
 const now=Date.now();
 const ckOn=(C.checkinCfg||{}).enabled!==false;
 $("ecStats").innerHTML=[
  ["Desafios",chs.length,""],
  ["Resgates de desafios",cl.length,"green"],
  ["Check-ins registrados",cks.length,"gold"],
  ["Salas de conversa",rooms.filter(r=>r.active!==false).length,""],
  ["Check-in diário",ckOn?"Ativado":"Desativado",ckOn?"green":"red"]
 ].map(([l,v,c])=>`<div class="card"><div class="stat-label">${esc(String(l))}</div><div class="stat-value ${c}">${esc(String(v))}</div></div>`).join("");
 /* lista de desafios */
 $("echList").innerHTML=chs.length?chs.map(c=>{
  const parts=cl.filter(x=>x.challengeId===c.id);
  const live=(!stamp(c.startAt)||stamp(c.startAt)<=now)&&(!stamp(c.endAt)||stamp(c.endAt)>=now)&&c.visible!==false&&c.status!=="paused";
  return `<div class="item">
   <h3>${esc(c.name||"Desafio")} ${c.status==="paused"?'<span class="status yellow">Pausado</span>':live?'<span class="status green">Ativo</span>':'<span class="status red">Encerrado / oculto</span>'}</h3>
   ${c.description?`<p>${esc(c.description)}</p>`:""}
   <p class="hint">${esc((EC_METRICS[c.metric]||{l:c.metric||"—"}).l)} · meta ${Number(c.goal)||0} · recompensa ${fmtBRL(Number(c.reward)||0)} ${esc(c.ticketType||"common")} · ${parts.length} resgate(s)${c.maxParticipants?" de até "+c.maxParticipants:""} · ${c.startAt?date(c.startAt):"sem início"} → ${c.endAt?date(c.endAt):"sem prazo"}${c.visible===false?" · oculto no site":""}</p>
   <div class="actions">
   <button class="btn secondary small" data-ech-edit="${esc(c.id)}">Editar</button>
   <button class="btn secondary small" data-ech-toggle="${esc(c.id)}">${c.status==="paused"?"Reativar":"Pausar"}</button>
   <button class="btn danger small" data-ech-del="${esc(c.id)}">Excluir</button>
   </div>
  </div>`;
 }).join(""):'<div class="empty">Nenhum desafio ainda. Crie o primeiro acima.</div>';
 /* check-in */
 const ck=C.checkinCfg||{};
 $("eck-on").value=String(ck.enabled!==false);
 $("eck-reward").value=Math.max(0,Number(ck.reward)||10);
 $("eck-type").value=["common","gold","vip"].includes(ck.ticketType)?ck.ticketType:"common";
 const sb=(ck.streakBonus&&typeof ck.streakBonus==="object")?ck.streakBonus:{};
 ["3","7","14","30"].forEach(d=>{$("eck-b"+d).value=Math.max(0,Number(sb[d])||0)});
 /* ranking */
 const rk=C.rankingCfg||{};
 $("erk-on").value=String(rk.enabled!==false);
 $("erkWeights").innerHTML=Object.entries(EC_METRICS).map(([k,m])=>`<label style="display:flex;gap:8px;align-items:center;background:var(--p2);border:1px solid var(--l);border-radius:8px;padding:8px 11px;font-size:13px"><input type="number" min="0" step="0.5" data-erk-w="${k}" value="${((rk.weights||{})[k]!=null?rk.weights[k]:EC_W_DEF[k])}" style="width:80px"> <b>pontos por</b> ${esc(m.l)}</label>`).join("");
 const per=$("erkPeriod").value||"week";
 const us=[...(C.userStats||[])].map(u=>({...u,sc:Number(u[per+"Score"]||0)})).sort((a,b)=>b.sc-a.sc).slice(0,20);
 $("erkTop").innerHTML=us.length?us.map((u,i)=>{
  const nm=(C.users.find(x=>x.id===u.uid)?.name)||u.name||"—";
  return `<div class="item" style="display:flex;gap:10px;align-items:center;padding:10px 12px"><b>${i+1}º</b><span style="flex:1">${esc(nm)}</span><b>${String(Math.round(u.sc*100)/100).replace(".",",")} pts</b></div>`;
 }).join(""):'<div class="empty">O ranking se forma conforme os membros participam no site.</div>';
 /* comunidade */
 const cm=C.community||{};
 $("ecm-allow").value=String(cm.allowCreate!==false);
 $("ecm-max").value=Math.max(1,Number(cm.maxRoomsPerUser)||3);
 $("ecmRooms").innerHTML=rooms.length?[...rooms].sort((a,b)=>(stamp(b.createdAt)||0)-(stamp(a.createdAt)||0)).map(r=>`
  <div class="item">
   <h3>${esc(r.name||"Sala")} ${r.active===false?'<span class="status red">Desativada</span>':'<span class="status green">Ativa</span>'}</h3>
   ${r.desc?`<p>${esc(r.desc)}</p>`:""}
   <p class="hint">Criada por ${esc(r.ownerName||r.uid||"—")} · ${date(r.createdAt)}</p>
   <div class="actions">
   <button class="btn secondary small" data-ecm-toggle="${esc(r.id)}">${r.active===false?"Reativar":"Desativar"}</button>
   <button class="btn danger small" data-ecm-del="${esc(r.id)}">Apagar sala e mensagens</button>
   </div>
  </div>`).join(""):'<div class="empty">Nenhuma sala criada ainda.</div>';
 /* check-ins recentes */
 const uname=uid=>(C.users.find(x=>x.id===uid)?.name)||uid||"—";
 $("eckList").innerHTML=cks.length?[...cks].sort((a,b)=>((b.lastDate||"")+"").localeCompare((a.lastDate||"")+"")).slice(0,20).map(k=>`
  <div class="item" style="display:flex;gap:10px;align-items:center;padding:10px 12px;flex-wrap:wrap">
   <b style="flex:1 1 140px">${esc(uname(k.id))}</b>
   <span class="status">Último: ${esc(k.lastDate||"—")}</span>
   <span class="status gold">Sequência: ${Number(k.streak)||0}</span>
   <span class="status green">Total: ${Number(k.total)||0}</span>
  </div>`).join(""):'<div class="empty">Nenhum check-in ainda.</div>';
}
/* salvar desafio */
$("echSave").onclick=async()=>{
 const name=$("ech-name").value.trim();
 if(name.length<3){toast("Dê um nome com pelo menos 3 letras.");return}
 const data={
  name,description:$("ech-desc").value.trim(),
  metric:$("ech-metric").value,
  goal:Math.max(1,Math.floor(Number($("ech-goal").value)||1)),
  reward:Math.max(0,Math.floor(Number($("ech-reward").value)||0)),
  ticketType:$("ech-type").value,
  maxParticipants:Math.max(0,Math.floor(Number($("ech-max").value)||0)),
  startAt:$("ech-start").value?Timestamp.fromDate(toTimestamp($("ech-start").value)):null,
  endAt:$("ech-end").value?Timestamp.fromDate(toTimestamp($("ech-end").value)):null,
  visible:$("ech-visible").value==="true",
  rules:$("ech-rules").value.trim(),
  updatedAt:serverTimestamp()
 };
 try{
  const editId=$("ech-edit").value;
  if(editId){await updateDoc(doc(db,"challenges",editId),data);toast("Desafio atualizado.")}
  else{await addDoc(collection(db,"challenges"),{...data,status:"active",createdAt:serverTimestamp()});toast("Desafio criado — ele já aparece na Central de Eventos do site.")}
  echFormClear();
  await loadAll();
 }catch(e){error(e)}
};
function echFormClear(){
 ["ech-name","ech-desc","ech-goal","ech-reward","ech-max","ech-start","ech-end","ech-rules"].forEach(id=>{$(id).value=""});
 $("ech-metric").selectedIndex=0;$("ech-type").value="common";$("ech-visible").value="true";$("ech-goal").value="";
 $("ech-edit").value="";$("echClear").hidden=true;$("echSave").textContent="Salvar desafio";
}
$("echClear").onclick=echFormClear;
/* salvar check-in */
$("eckSave").onclick=async()=>{
 const data={
  enabled:$("eck-on").value==="true",
  reward:Math.max(0,Math.floor(Number($("eck-reward").value)||0)),
  ticketType:$("eck-type").value,
  streakBonus:{"3":Math.max(0,Math.floor(Number($("eck-b3").value)||0)),"7":Math.max(0,Math.floor(Number($("eck-b7").value)||0)),"14":Math.max(0,Math.floor(Number($("eck-b14").value)||0)),"30":Math.max(0,Math.floor(Number($("eck-b30").value)||0))},
  updatedAt:serverTimestamp()
 };
 try{await setDoc(doc(db,"settings","checkin"),data,{merge:true});await loadAll();toast("Check-in diário salvo — o site já usa a nova configuração.")}catch(e){error(e)}
};
/* salvar ranking */
$("erkSave").onclick=async()=>{
 const weights={};
 document.querySelectorAll("[data-erk-w]").forEach(i=>{weights[i.dataset.erkW]=Math.max(0,Number(i.value)||0)});
 try{await setDoc(doc(db,"settings","ranking"),{enabled:$("erk-on").value==="true",weights,updatedAt:serverTimestamp()},{merge:true});await loadAll();toast("Ranking salvo — a pontuação do site já segue os novos pesos.")}catch(e){error(e)}
};
$("erkPeriod").onchange=renderEventsCenter;
/* salvar comunidade */
$("ecmSave").onclick=async()=>{
 try{await setDoc(doc(db,"settings","community"),{allowCreate:$("ecm-allow").value==="true",maxRoomsPerUser:Math.max(1,Math.floor(Number($("ecm-max").value)||3)),updatedAt:serverTimestamp()},{merge:true});await loadAll();toast("Comunidade salva.")}catch(e){error(e)}
};
/* ações de desafios, salas e edição */
document.addEventListener("click",async e=>{
 const ed=e.target.closest("[data-ech-edit]");
 if(ed){
  const c=(C.challenges||[]).find(x=>x.id===ed.dataset.echEdit);
  if(!c)return;
  $("ech-name").value=c.name||"";$("ech-desc").value=c.description||"";
  $("ech-metric").value=c.metric||"tasks_done";$("ech-goal").value=c.goal||1;
  $("ech-reward").value=c.reward||0;$("ech-type").value=c.ticketType||"common";
  $("ech-max").value=c.maxParticipants||0;
  $("ech-start").value=dateInput(c.startAt);$("ech-end").value=dateInput(c.endAt);
  $("ech-visible").value=String(c.visible!==false);$("ech-rules").value=c.rules||"";
  $("ech-edit").value=c.id;$("echClear").hidden=false;$("echSave").textContent="Salvar alterações";
  document.getElementById("page-eventscenter").scrollIntoView({behavior:"smooth"});
  return;
 }
 const tg=e.target.closest("[data-ech-toggle]");
 if(tg){
  const c=(C.challenges||[]).find(x=>x.id===tg.dataset.echToggle);
  if(!c)return;
  try{await updateDoc(doc(db,"challenges",c.id),{status:c.status==="paused"?null:"paused",updatedAt:serverTimestamp()});await loadAll();toast(c.status==="paused"?"Desafio reativado.":"Desafio pausado.")}catch(err){error(err)}
  return;
 }
 const dl=e.target.closest("[data-ech-del]");
 if(dl){
  if(!confirm("Excluir este desafio? Os resgates já feitos continuam no histórico."))return;
  try{await deleteDoc(doc(db,"challenges",dl.dataset.echDel));await loadAll();toast("Desafio excluído.")}catch(err){error(err)}
  return;
 }
 const rt=e.target.closest("[data-ecm-toggle]");
 if(rt){
  const r=(C.rooms||[]).find(x=>x.id===rt.dataset.ecmToggle);
  if(!r)return;
  try{await updateDoc(doc(db,"rooms",r.id),{active:r.active===false,updatedAt:serverTimestamp()});await loadAll();toast(r.active===false?"Sala reativada.":"Sala desativada — ela para de aparecer no site.")}catch(err){error(err)}
  return;
 }
 const rd=e.target.closest("[data-ecm-del]");
 if(rd){
  const id=rd.dataset.ecmDel;
  if(!confirm("Apagar esta sala e TODAS as mensagens dela?"))return;
  try{
   const ms=await getDocs(collection(db,"rooms",id,"messages"));
   const batch=writeBatch(db);
   ms.docs.forEach(d=>batch.delete(d.ref));
   batch.delete(doc(db,"rooms",id));
   await batch.commit();
   await loadAll();toast("Sala apagada.");
  }catch(err){error(err)}
  return;
 }
});
$("claimFilter").value="pending";

/* ════════════════════════════════════════════════════════════
   APPHUB · CENTRAL DE APLICATIVOS
   Coleções: apps · appInstalls · appActivityClaims
   Recompensas: reais (troco da carteira), bilhetes, moedas e
   diamantes (campos próprios da carteira) + extras (pacotes,
   mineração e buffs) entregues via Yshipp Market.
   ════════════════════════════════════════════════════════════ */

const XC_RATE_ADM={coin:0.001,ticket:0.5,diamond:1};
const XC_NAME_ADM={coin:"moeda(s)",ticket:"bilhete(s)",diamond:"diamante(s)"};
const XC_LABEL_ADM={coin:"Moedas Yshipp",ticket:"Bilhetes",diamond:"Diamantes",brl:"Reais (R$)"};
const AVAL_CUR={brl:1,coin:XC_RATE_ADM.coin,ticket:XC_RATE_ADM.ticket,diamond:XC_RATE_ADM.diamond};
const xcTxtAdm=(cur,qty)=>{
qty=Math.max(0,Math.floor(Number(qty)||0));
if(cur==="brl")return fmtBRL(qty);
return qty+" "+XC_NAME_ADM[cur]+" (≈ "+fmtBRL(qty*AVAL_CUR[cur])+")";
};
let appActsDraft=[];


/* ════════════════════════════════════════════════════════════
   CONTRATE UM PROFISSIONAL · catálogo + serviços (Gigs)
   ════════════════════════════════════════════════════════════ */
const DEFAULT_GIG_CATALOG={categories:[
{id:"social",label:"Redes sociais",icon:"<i class=yi data-i=mobile></i>",subs:[
 {id:"ig_reels",label:"Edição de Reels / TikTok",minPrice:15},
 {id:"ig_manage",label:"Gestão de perfil Instagram",minPrice:40},
 {id:"ig_design",label:"Design de posts",minPrice:10}
]},
{id:"web",label:"Sites e programação",icon:"<i class=yi data-i=spark></i>",subs:[
 {id:"web_landing",label:"Landing page",minPrice:80},
 {id:"web_site",label:"Site completo",minPrice:200},
 {id:"web_fix",label:"Correção de bugs",minPrice:30}
]},
{id:"video",label:"Vídeo e áudio",icon:"<i class=yi data-i=video></i>",subs:[
 {id:"vid_edit",label:"Edição de vídeo",minPrice:25},
 {id:"vid_thumb",label:"Thumbnail / capa",minPrice:8}
]},
{id:"design",label:"Design gráfico",icon:"<i class=yi data-i=image></i>",subs:[
 {id:"des_logo",label:"Logo",minPrice:35},
 {id:"des_banner",label:"Banner / arte",minPrice:12}
]},
{id:"copy",label:"Texto e conteúdo",icon:"<i class=yi data-i=edit></i>",subs:[
 {id:"copy_post",label:"Textos para posts",minPrice:10},
 {id:"copy_article",label:"Artigo / blog",minPrice:25}
]}
]};

let gigCatDraft=null;

function gigCatalog(){
 const g=C.gigCatalog;
 if(g&&Array.isArray(g.categories)&&g.categories.length)return g;
 return JSON.parse(JSON.stringify(DEFAULT_GIG_CATALOG));
}

function renderGigCatalog(){
 if(!gigCatDraft)gigCatDraft=JSON.parse(JSON.stringify(gigCatalog()));
 const root=$("gigCatalogEditor");if(!root)return;
 root.innerHTML=(gigCatDraft.categories||[]).map((c,ci)=>`
 <div class="proof-block" style="margin-bottom:10px">
  <div class="form-grid">
   <div class="field" style="margin:0"><label>Categoria ${ci+1}</label><input data-gcat="${ci}" value="${esc(c.label||"")}" placeholder="Ex.: Instagram"></div>
   <div class="field" style="margin:0"><label>Ícone (HTML ou emoji)</label><input data-gicon="${ci}" value="${esc(c.icon||"")}"></div>
  </div>
  ${(c.subs||[]).map((s,si)=>`
  <div class="form-grid" style="margin-top:8px">
   <div class="field" style="margin:0"><label>Subcategoria</label><input data-gsub="${ci}_${si}" value="${esc(s.label||"")}" placeholder="Ex.: Curtir publicação"></div>
   <div class="field" style="margin:0"><label>Preço mín. (R$)</label><input type="number" min="0.01" step="0.01" data-gmin="${ci}_${si}" value="${(Math.max(0.01,Number(s.minPrice)||0.01)).toFixed(2)}"></div>
   <div class="field" style="margin:0;align-self:end"><button class="btn danger small" data-gsubdel="${ci}_${si}">Remover</button></div>
  </div>`).join("")||'<p class="hint">Nenhuma subcategoria.</p>'}
  <div class="actions" style="margin-top:8px">
   <button class="btn secondary small" data-gsubadd="${ci}">+ Subcategoria</button>
   <button class="btn danger small" data-gcatdel="${ci}">Excluir categoria</button>
  </div>
 </div>`).join("")||'<div class="empty">Nenhuma categoria. Clique em + Categoria.</div>';
}

function collectGigCatalog(){
 const root=$("gigCatalogEditor");if(!root)return gigCatDraft||DEFAULT_GIG_CATALOG;
 const cats=[];
 root.querySelectorAll("[data-gcat]").forEach(el=>{
  const ci=Number(el.dataset.gcat);
  const iconEl=root.querySelector(`[data-gicon="${ci}"]`);
  const subs=[];
  root.querySelectorAll(`[data-gsub]`).forEach(sEl=>{
   const parts=String(sEl.dataset.gsub).split("_");
   if(Number(parts[0])!==ci)return;
   const si=parts[1];
   const minEl=root.querySelector(`[data-gmin="${ci}_${si}"]`);
   const label=sEl.value.trim();
   if(!label)return;
   const prev=((gigCatDraft.categories||[])[ci]||{}).subs||[];
   const old=prev[Number(si)]||{};
   subs.push({id:old.id||("sub_"+Date.now()+"_"+si),label,minPrice:Math.max(0.01,Math.round((Number(minEl?.value)||0.01)*100)/100)});
  });
  const prev=(gigCatDraft.categories||[])[ci]||{};
  cats.push({id:prev.id||("cat_"+Date.now()+"_"+ci),label:el.value.trim()||"Categoria",icon:(iconEl&&iconEl.value.trim())||"<i class=yi data-i=target></i>",subs});
 });
 return {categories:cats.filter(c=>c.label),updatedAt:Date.now()};
}

async function renderProProfiles(){
 if(!$("proProfileList"))return;
 try{
  const qy=query(collection(db,"users"),where("proProfileStatus","==","pending"),limit(50));
  const snap=await getDocs(qy);
  $("proProfileList").innerHTML=snap.docs.length?snap.docs.map(d=>{
   const u={id:d.id,...d.data()};
   return `<div class="item"><h3>${esc(u.name||u.email||u.id)}</h3><p class="hint">Status: pendente · ${esc(u.email||"")}</p>
   <div class="actions">
    <button class="btn success small" data-pro-ok="${esc(u.id)}">Aprovar perfil</button>
    <button class="btn danger small" data-pro-no="${esc(u.id)}">Negar</button>
   </div></div>`;
  }).join(""):'<div class="empty">Nenhum perfil profissional pendente.</div>';
 }catch(e){$("proProfileList").innerHTML='<div class="empty">Não foi possível carregar (índice/regras). Aprove serviços em "Serviços publicados".</div>'}
}
document.addEventListener("click",async e=>{
 const ok=e.target.closest("[data-pro-ok]");
 if(ok){try{await setDoc(doc(db,"users",ok.dataset.proOk),{proProfileStatus:"approved",proApprovedAt:serverTimestamp()},{merge:true});toast("Perfil aprovado.");renderProProfiles()}catch(err){error(err)}return}
 const no=e.target.closest("[data-pro-no]");
 if(no){try{await setDoc(doc(db,"users",no.dataset.proNo),{proProfileStatus:"rejected",proApprovedAt:serverTimestamp()},{merge:true});toast("Perfil negado.");renderProProfiles()}catch(err){error(err)}return}
});
function renderPros(){try{renderProProfiles()}catch(e){}

 if(!$("proGigList"))return;
 const lim=C.taskLimits||{};
 if($("tl-min"))$("tl-min").value=Math.max(1,Math.floor(Number(lim.minStock)||25));
 if($("tl-max"))$("tl-max").value=Math.max(1,Math.floor(Number(lim.maxStock)||500));
 if($("tl-mcp"))$("tl-mcp").value=Math.max(1,Math.floor(Number(lim.maxCollabPending)||3));
 gigCatDraft=JSON.parse(JSON.stringify(gigCatalog()));
 renderGigCatalog();
 const list=(C.proGigs||[]).slice().sort((a,b)=>(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0));
 const pend=list.filter(g=>g.status==="pending").length;
 const active=list.filter(g=>g.active!==false&&g.status==="approved").length;
 if($("prosBadge"))$("prosBadge").textContent=String(pend);
 if($("prosKpis"))$("prosKpis").innerHTML=[
  ["Serviços",list.length,""],
  ["Ativos no site",active,"green"],
  ["Aguardando aprovação",pend,pend?"red":""],
  ["Categorias",(gigCatalog().categories||[]).length,"gold"]
 ].map(([l,v,c])=>`<div class="card"><div class="stat-label">${esc(l)}</div><div class="stat-value ${c}">${v}</div></div>`).join("");
 $("proGigList").innerHTML=list.length?list.map(g=>{
  const st=g.status==="approved"?(g.active!==false?'<span class="status green">No ar</span>':'<span class="status">Pausado</span>'):g.status==="pending"?'<span class="status yellow">Pendente</span>':'<span class="status red">'+esc(g.status||"—")+'</span>';
  return `<div class="item ${g.active===false?"inativo":""}">
   <h3>${esc(g.title||"Serviço")} ${st}</h3>
   <p>${esc(g.categoryLabel||g.category||"—")} · ${esc(g.subLabel||g.subcategory||"—")}</p>
   <p><b>${fmtBRL(Number(g.price)||0)}</b> · entrega em ${Number(g.deliveryDays)||1} dia(s) · por ${esc(g.sellerName||"—")}</p>
   <p class="hint">${esc((g.desc||"").slice(0,140))}</p>
   <div class="actions">
    <button class="btn secondary small" data-pg-edit="${esc(g.id)}">Editar</button>
    ${g.status!=="approved"?`<button class="btn success small" data-pg-ok="${esc(g.id)}">Aprovar</button>`:""}
    <button class="btn ${g.active===false?"success":"secondary"} small" data-pg-tg="${esc(g.id)}">${g.active===false?"Ativar":"Pausar"}</button>
    <button class="btn danger small" data-pg-del="${esc(g.id)}">Excluir</button>
   </div>
  </div>`;
 }).join(""):'<div class="empty">Nenhum serviço ainda. Clique em "+ Novo serviço" ou aguarde envios de profissionais.</div>';
}

function proGigModal(g){
 const isNew=!g;
 const cats=gigCatalog().categories||[];
 const catId=g?.category||cats[0]?.id||"";
 const subs=(cats.find(c=>c.id===catId)||{}).subs||[];
 openModal(isNew?"Novo serviço profissional":"Editar serviço",`
 <div class="form-grid">
  <div class="field"><label>Título do serviço *</label><input id="pg_title" value="${esc(g?.title||"")}" placeholder="Ex.: Edito 30 Reels para o seu Instagram"></div>
  <div class="field"><label>Preço (R$) *</label><input type="number" min="0.01" step="0.01" id="pg_price" value="${(Math.max(0.01,Number(g?.price)||0.01)).toFixed(2)}"></div>
  <div class="field"><label>Categoria</label><select id="pg_cat">${cats.map(c=>`<option value="${esc(c.id)}"${c.id===catId?" selected":""}>${esc(c.label)}</option>`).join("")}</select></div>
  <div class="field"><label>Subcategoria</label><select id="pg_sub">${subs.map(s=>`<option value="${esc(s.id)}"${s.id===g?.subcategory?" selected":""}>${esc(s.label)}</option>`).join("")||'<option value="">—</option>'}</select></div>
  <div class="field"><label>Prazo de entrega (dias)</label><input type="number" min="1" max="90" id="pg_days" value="${Number(g?.deliveryDays)||3}"></div>
  <div class="field"><label>Nome do profissional</label><input id="pg_seller" value="${esc(g?.sellerName||"")}" placeholder="Ex.: Ana Design"></div>
 </div>
 <div class="field"><label>Descrição *</label><textarea id="pg_desc">${esc(g?.desc||"")}</textarea></div>
 <div class="field"><label>O que está incluso (uma linha por item)</label><textarea id="pg_inc" rows="3">${esc(Array.isArray(g?.includes)?g.includes.join("\\n"):(g?.includes||""))}</textarea></div>
 <div class="actions">
  <button class="btn" id="pg_save">${isNew?"Publicar serviço":"Salvar"}</button>
  <button class="btn secondary" id="pg_cancel">Cancelar</button>
 </div>`);
 $("pg_cat").onchange=()=>{
  const c=cats.find(x=>x.id===$("pg_cat").value);
  $("pg_sub").innerHTML=((c&&c.subs)||[]).map(s=>`<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("")||'<option value="">—</option>';
 };
 $("pg_cancel").onclick=closeModal;
 $("pg_save").onclick=async()=>{
  const title=$("pg_title").value.trim();
  const price=Math.max(0.01,Math.round((Number($("pg_price").value)||0.01)*100)/100);
  const cat=cats.find(x=>x.id===$("pg_cat").value);
  const sub=(cat?.subs||[]).find(x=>x.id===$("pg_sub").value);
  if(title.length<3)return toast("Informe um título.");
  if(!$("pg_desc").value.trim())return toast("Descreva o serviço.");
  const data={
   title,price,desc:$("pg_desc").value.trim(),
   category:cat?.id||"",categoryLabel:cat?.label||"",
   subcategory:sub?.id||"",subLabel:sub?.label||"",
   deliveryDays:Math.max(1,Math.floor(Number($("pg_days").value)||3)),
   sellerName:$("pg_seller").value.trim()||"Profissional",
   includes:$("pg_inc").value.split("\\n").map(s=>s.trim()).filter(Boolean),
   active:g?g.active!==false:true,
   status:g?.status==="pending"?"approved":(g?.status||"approved"),
   updatedAt:serverTimestamp()
  };
  try{
   if(isNew)await setDoc(doc(collection(db,"proGigs")),{...data,createdAt:serverTimestamp()});
   else await setDoc(doc(db,"proGigs",g.id),data,{merge:true});
   closeModal();await loadAll();toast(isNew?"Serviço publicado no site.":"Serviço atualizado.");
  }catch(err){error(err)}
 };
}

if($("tlSave"))$("tlSave").onclick=async()=>{
 const min=Math.max(1,Math.floor(Number($("tl-min").value)||25));
 const max=Math.max(min,Math.floor(Number($("tl-max").value)||500));
 const mcp=Math.max(1,Math.floor(Number($("tl-mcp")?.value)||3));
 try{
  await setDoc(doc(db,"settings","taskLimits"),{minStock:min,maxStock:max,maxCollabPending:mcp,updatedAt:serverTimestamp()},{merge:true});
  C.taskLimits={minStock:min,maxStock:max,maxCollabPending:mcp};
  toast("Limites salvos: mínimo "+min+" · máximo "+max+" vagas · "+mcp+" tarefa(s) pendente(s) por colaborador.");
 }catch(e){error(e)}
};
if($("gigNewCat"))$("gigNewCat").onclick=()=>{
 if(!gigCatDraft)gigCatDraft=JSON.parse(JSON.stringify(gigCatalog()));
 gigCatDraft.categories=gigCatDraft.categories||[];
 gigCatDraft.categories.push({id:"cat_"+Date.now(),label:"Nova categoria",icon:"<i class=yi data-i=target></i>",subs:[{id:"sub_"+Date.now(),label:"Nova subcategoria",minPrice:10}]});
 renderGigCatalog();
};
if($("gigSaveCat"))$("gigSaveCat").onclick=async()=>{
 const data=collectGigCatalog();
 try{
  await setDoc(doc(db,"settings","gigCatalog"),data,{merge:true});
  C.gigCatalog=data;gigCatDraft=JSON.parse(JSON.stringify(data));
  toast("Catálogo de profissionais salvo — o site já usa as categorias.");
 }catch(e){error(e)}
};
document.addEventListener("click",e=>{
 const add=e.target.closest("[data-gsubadd]");
 if(add){const ci=Number(add.dataset.gsubadd);gigCatDraft=collectGigCatalog();gigCatDraft.categories[ci].subs=gigCatDraft.categories[ci].subs||[];gigCatDraft.categories[ci].subs.push({id:"sub_"+Date.now(),label:"",minPrice:10});renderGigCatalog();return}
 const sd=e.target.closest("[data-gsubdel]");
 if(sd){const [ci,si]=String(sd.dataset.gsubdel).split("_").map(Number);gigCatDraft=collectGigCatalog();(gigCatDraft.categories[ci].subs||[]).splice(si,1);renderGigCatalog();return}
 const cd=e.target.closest("[data-gcatdel]");
 if(cd){if(!confirm("Excluir esta categoria?"))return;gigCatDraft=collectGigCatalog();gigCatDraft.categories.splice(Number(cd.dataset.gcatdel),1);renderGigCatalog();return}
});
if($("newProGig"))$("newProGig").onclick=()=>proGigModal(null);
if($("proGigList"))$("proGigList").onclick=async e=>{
 const ed=e.target.closest("[data-pg-edit]");
 if(ed){const g=(C.proGigs||[]).find(x=>x.id===ed.dataset.pgEdit);if(g)proGigModal(g);return}
 const ok=e.target.closest("[data-pg-ok]");
 if(ok){try{await setDoc(doc(db,"proGigs",ok.dataset.pgOk),{status:"approved",active:true,updatedAt:serverTimestamp()},{merge:true});await loadAll();toast("Serviço aprovado — no ar no site.")}catch(err){error(err)}return}
 const tg=e.target.closest("[data-pg-tg]");
 if(tg){const g=(C.proGigs||[]).find(x=>x.id===tg.dataset.pgTg);if(!g)return;try{await setDoc(doc(db,"proGigs",g.id),{active:g.active===false,updatedAt:serverTimestamp()},{merge:true});await loadAll();toast(g.active===false?"Ativado.":"Pausado.")}catch(err){error(err)}return}
 const dl=e.target.closest("[data-pg-del]");
 if(dl){if(!confirm("Excluir este serviço?"))return;try{await deleteDoc(doc(db,"proGigs",dl.dataset.pgDel));await loadAll();toast("Excluído.")}catch(err){error(err)}}
};


function renderApps(){
$("appsBadge").textContent=String((C.appInstalls||[]).filter(i=>i.status==="pending").length+(C.appActs||[]).filter(a=>a.status==="pending").length);
const apps=C.apps||[];
const pendI=(C.appInstalls||[]).filter(i=>i.status==="pending");
const pendA=(C.appActs||[]).filter(a=>a.status==="pending");
$("appsBadge").textContent=String(pendI.length+pendA.length);
$("appsKpis").innerHTML=[
["users","Apps cadastrados",apps.length,""],
["mobile","Apps ativos",apps.filter(a=>a.active!==false).length,"green"],
["inbox","Instalações p/ analisar",pendI.length,pendI.length?"red":""],
["check","Atividades p/ analisar",pendA.length,pendA.length?"red":""]
].map(([ic,l,v,c])=>`
<div class="card">
<div class="stat-label">${ic==="users"?"<i class=yi data-i=grid></i>":ic==="mobile"?"<i class=yi data-i=mobile></i>":ic==="inbox"?"<i class=yi data-i=inbox></i>":"<i class=yi data-i=check></i>"} ${l}</div>
<div class="stat-value ${c}">${v}</div>
</div>`).join("");
$("appList").innerHTML=apps.length?apps.sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)).map(a=>{
const acts=Array.isArray(a.activities)?a.activities:[];
return `
<div class="item ${a.active===false?"inativo":""}">
<h3>${a.icon&&/^https?:\/\//i.test(a.icon)?`<img src="${esc(a.icon)}" alt="" style="width:22px;height:22px;border-radius:6px;object-fit:cover;vertical-align:-4px">`:(a.icon?esc(a.icon):'<i class=yi data-i=mobile></i>')} ${esc(a.name||"App")}</h3>
<p>${esc(a.category||"App parceiro")} · ${esc(a.desc||"")}</p>
<p><b>Instalação:</b> ${xcTxtAdm(a.install?.cur||"brl",a.install?.qty||0)}${a.install?.extra?" + "+esc(a.install.extra):""}</p>
<p><b>Atividades:</b> ${acts.length||0} · ${acts.map(x=>esc(x.title||"")).filter(Boolean).join(", ")||"—"}</p>
<p><b>Link:</b> ${a.link?`<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.link.slice(0,48))}…</a>`:"—"}</p>
<div class="actions">
<button class="btn secondary small" data-app-edit="${esc(a.id)}"><i class=yi data-i=edit></i> Editar</button>
<button class="btn ${a.active===false?"success":"secondary"} small" data-app-toggle="${esc(a.id)}">${a.active===false?"Ativar":"Pausar"}</button>
<button class="btn danger small" data-app-del="${esc(a.id)}"><i class=yi data-i=trash></i> Excluir</button>
</div>
</div>`;}).join(""):'<div class="empty">Nenhum app cadastrado. Clique em "+ Novo app" para publicar o primeiro no AppHub do site.</div>';

const instList=(C.appInstalls||[]).filter(i=>i.status==="pending").sort((a,b)=>(stamp(b.createdAt)||0)-(stamp(a.createdAt)||0));
$("appInstList").innerHTML=instList.length?instList.map(i=>`
<tr>
<td><b>${esc(i.participantName||"—")}</b><small class="mono">${esc((i.uid||"").slice(0,12))}</small></td>
<td><b>${esc(i.appName||"—")}</b></td>
<td>${esc(i.proofText||"—")}${i.proofImage?`<small><a href="${esc(i.proofImage)}" target="_blank" rel="noopener noreferrer">ver print</a></small>`:""}</td>
<td>${date(i.createdAt)}</td>
<td style="white-space:nowrap">
<button class="btn success small" data-ai-ok="${esc(i.id)}" data-uid="${esc(i.uid||"")}" data-app="${esc(i.appId||"")}" data-name="${esc(i.appName||"")}">Aprovar e pagar</button>
<button class="btn danger small" data-ai-no="${esc(i.id)}">Negar</button>
</td>
</tr>`).join(""):'<tr><td colspan="5"><div class="empty">Nenhuma prova de instalação pendente.</div></td></tr>';

const actList=(C.appActs||[]).filter(a=>a.status==="pending").sort((a,b)=>(stamp(b.createdAt)||0)-(stamp(a.createdAt)||0));
$("appActList").innerHTML=actList.length?actList.map(c=>`
<tr>
<td><b>${esc(c.participantName||"—")}</b><small class="mono">${esc((c.uid||"").slice(0,12))}</small></td>
<td><b>${esc(c.appName||"—")}</b><small>${esc(c.actTitle||"—")}</small></td>
<td>${esc(c.text||"—")}${c.code?`<small>código: ${esc(c.code)}</small>`:""}${c.image?`<small><a href="${esc(c.image)}" target="_blank" rel="noopener noreferrer">ver print</a></small>`:""}${c.video?`<small><a href="${esc(c.video)}" target="_blank" rel="noopener noreferrer">ver gravação</a></small>`:""}${c.datetime?`<small>quando: ${esc(c.datetime)}</small>`:""}</td>
<td><b class="gold">${c.reward?xcTxtAdm(c.reward.cur||"brl",c.reward.qty||0):"—"}${c.reward?.extra?`<small>extra: ${esc(c.reward.extra)}</small>`:""}</b></td>
<td>${date(c.createdAt)}</td>
<td style="white-space:nowrap">
<button class="btn success small" data-aa-ok="${esc(c.id)}" data-uid="${esc(c.uid||"")}" data-cur="${esc(c.reward?.cur||"brl")}" data-qty="${Number(c.reward?.qty)||0}">Aprovar e pagar</button>
<button class="btn danger small" data-aa-no="${esc(c.id)}">Negar</button>
</td>
</tr>`).join(""):'<tr><td colspan="6"><div class="empty">Nenhuma prova de atividade pendente.</div></td></tr>';
}

/* ── editor de app (modal) ── */
function appEditorModal(a){
const isNew=!a;
appActsDraft=Array.isArray(a?.activities)?a.activities.map(x=>({...x,proof:{...(x.proof||{})}})):[];
const cur=a?.install?.cur||"brl";
openModal(isNew?"Novo app do AppHub":"Editar app · "+(a?.name||""),`
<div class="form-grid">
<div class="field"><label>Nome do app *</label><input id="ap_name" value="${esc(a?.name||"")}"></div>
<div class="field"><label>Ícone (emoji ou URL de imagem)</label><input id="ap_icon" value="${esc(a?.icon||"")}" placeholder="emoji ou https://…"></div>
<div class="field"><label>Categoria</label><input id="ap_cat" value="${esc(a?.category||"")}" placeholder="Ex.: Jogos · Finanças · Utilitários"></div>
<div class="field"><label>Link da loja / site *</label><input id="ap_link" value="${esc(a?.link||"")}" placeholder="https://play.google.com/…"></div>
<div class="field"><label>ID do pacote (opcional)</label><input id="ap_pkg" value="${esc(a?.packageId||"")}" placeholder="com.exemplo.app"></div>
<div class="field"><label>Ordem de exibição</label><input id="ap_sort" type="number" step="1" value="${Number(a?.sortOrder)||0}"></div>
</div>
<div class="field"><label>Descrição exibida no AppHub *</label><textarea id="ap_desc">${esc(a?.desc||"")}</textarea></div>
<div class="field"><label>Instruções da prova de instalação (o participante lê no site)</label><textarea id="ap_proofhelp">${esc(a?.proofHelp||"")}</textarea></div>
<div class="mkb">
<span class="mkb-t">Recompensa pela instalação (após sua aprovação)</span>
<div class="field"><label>Moeda</label><select id="ap_icur">
${Object.entries(XC_LABEL_ADM).map(([k,v])=>`<option value="${k}" ${k===cur?"selected":""}>${v}</option>`).join("")}
</select></div>
<div class="field"><label>Quantidade *</label><input id="ap_iqty" type="number" min="0" step="1" value="${Number(a?.install?.qty)||0}"></div>
<div class="field" style="grid-column:1/-1"><label>Extra (pacote, mineração ou buff — entregue via Yshipp Market)</label><input id="ap_iextra" value="${esc(a?.install?.extra||"")}" placeholder="Ex.: Pacote Iniciante · Minerador 30 dias · Buff 20% por 7 dias"></div>
</div>
<div class="section">
<div class="section-title"><h3><i class=yi data-i=list></i> Atividades dentro do app (liberam após a instalação aprovada)</h3>
<button class="btn secondary small" id="ap_addact"><i class=yi data-i=gift></i> + Atividade</button></div>
<p class="hint" style="margin:0 0 10px">Cada atividade tem título, descrição, provas exigidas (texto, código, print, gravação, data/hora) e recompensa própria — em reais, bilhetes, moedas ou diamantes, com extra opcional.</p>
<div id="ap_acts" style="display:grid;gap:10px"></div>
</div>
<div class="actions">
<button class="btn" id="ap_save"><i class=yi data-i=save></i> ${isNew?"Publicar app":"Salvar alterações"}</button>
<button class="btn secondary" id="ap_cancel">Cancelar</button>
</div>`);
renderAppActsDraft();
$("ap_addact").onclick=()=>{appActsDraft.push({id:"act_"+Date.now().toString(36),title:"",desc:"",proof:{text:true,image:true},reward:{cur:"brl",qty:0,extra:""}});renderAppActsDraft()};
$("ap_cancel").onclick=closeModal;
$("ap_save").onclick=async()=>{
const name=$("ap_name").value.trim();
const link=$("ap_link").value.trim();
const qty=Math.max(0,Math.floor(Number($("ap_iqty").value)||0));
if(name.length<3)return toast("Dê um nome ao app.");
if(!validUrl(link))return toast("Informe o link da loja/site (https://…).");
if(qty<0)return toast("Quantidade da recompensa inválida.");
const acts=appActsDraft.filter(x=>(x.title||"").trim()).map(x=>({
id:x.id||"act_"+Date.now().toString(36),
title:x.title.trim(),desc:(x.desc||"").trim(),
proof:{text:!!x.proof.text,code:!!x.proof.code,image:!!x.proof.image,video:!!x.proof.video,datetime:!!x.proof.datetime},
reward:{cur:x.reward?.cur||"brl",qty:Math.max(0,Math.floor(Number(x.reward?.qty)||0)),extra:(x.reward?.extra||"").trim()}
}));
const data={
name,icon:$("ap_icon").value.trim(),category:$("ap_cat").value.trim(),link,
packageId:$("ap_pkg").value.trim(),sortOrder:Math.floor(Number($("ap_sort").value)||0),
desc:$("ap_desc").value.trim(),proofHelp:$("ap_proofhelp").value.trim(),
install:{cur:$("ap_icur").value,qty,extra:$("ap_iextra").value.trim()},
activities:acts,active:a?a.active!==false:true,
updatedAt:serverTimestamp()
};
try{
if(isNew)await setDoc(doc(collection(db,"apps")),{...data,createdAt:serverTimestamp()});
else await setDoc(doc(db,"apps",a.id),data,{merge:true});
closeModal();
await loadAll();
toast(isNew?"App publicado no AppHub do site!":"App atualizado.");
}catch(err){error(err)}
};
}
function renderAppActsDraft(){
const el=$("ap_acts");if(!el)return;
el.innerHTML=appActsDraft.length?appActsDraft.map((x,i)=>`
<div class="item" style="gap:10px">
<div class="form-grid">
<div class="field"><label>Título da atividade *</label><input data-i="t" value="${esc(x.title||"")}" placeholder="Ex.: Crie seu perfil no app"></div>
<div class="field"><label>Recompensa · moeda</label><select data-i="cur">${Object.entries(XC_LABEL_ADM).map(([k,v])=>`<option value="${k}" ${k===(x.reward?.cur||"brl")?"selected":""}>${v}</option>`).join("")}</select></div>
<div class="field"><label>Recompensa · quantidade</label><input data-i="q" type="number" min="0" step="1" value="${Number(x.reward?.qty)||0}"></div>
<div class="field"><label>Extra (pacote / mineração / buff)</label><input data-i="e" value="${esc(x.reward?.extra||"")}" placeholder="opcional"></div>
</div>
<div class="field"><label>Descrição / instruções</label><textarea data-i="d" style="min-height:60px">${esc(x.desc||"")}</textarea></div>
<div class="field"><label>Provas exigidas</label>
<div class="wiz-checks">
${[["text","Texto"],["code","Código"],["image","Print (link)"],["video","Gravação (link)"],["datetime","Data/hora"]].map(([k,l])=>`<label class="wiz-check"><input type="checkbox" data-i="p_${k}" ${x.proof?.[k]?"checked":""}> ${l}</label>`).join("")}
</div></div>
<div class="actions"><button class="btn danger small" data-act-del="${i}"><i class=yi data-i=trash></i> Remover atividade</button></div>
</div>`).join(""):'<div class="empty">Nenhuma atividade — o app paga só a instalação.</div>';
el.oninput=e=>{
const inp=e.target.closest("[data-i]");if(!inp)return;
const i=Number(inp.closest(".item").querySelector("[data-act-del]").dataset.actDel);
const k=inp.dataset.i;
if(k==="t")appActsDraft[i].title=inp.value;
if(k==="d")appActsDraft[i].desc=inp.value;
if(k==="cur")appActsDraft[i].reward.cur=inp.value;
if(k==="q")appActsDraft[i].reward.qty=inp.value;
if(k==="e")appActsDraft[i].reward.extra=inp.value;
if(k.startsWith("p_"))appActsDraft[i].proof[k.slice(2)]=inp.checked;
};
el.onclick=e=>{
const del=e.target.closest("[data-act-del]");if(!del)return;
appActsDraft.splice(Number(del.dataset.actDel),1);renderAppActsDraft();
};
}

/* ── aprovações (crédito automático na carteira do participante) ── */
async function appPayReward(uid,cur,qty,reason){
/* crédito: reais no troco (saldo em reais); fichas nos campos próprios.
   Fichas NUNCA são convertidas em reais. */
await runTransaction(db,async tx=>{
const wRef=doc(db,"wallets",uid);
const ws=await tx.get(wRef);
const w=ws.exists()?ws.data():{};
if(cur==="brl")w.change=(Number(w.change)||0)+qty;
else if(cur==="coin")w.coins=(Number(w.coins)||0)+qty;
else if(cur==="ticket")w.tickets=(Number(w.tickets)||0)+qty;
else if(cur==="diamond")w.diamonds=(Number(w.diamonds)||0)+qty;
tx.set(wRef,{...w,updatedAt:serverTimestamp()},{merge:true});
tx.set(doc(collection(db,"wallets",uid,"history")),{
kind:reason.kind,amount:cur==="brl"?qty:0,brl:cur==="brl"?qty:0,
xcKind:cur==="brl"?"":cur,xcQty:cur==="brl"?0:qty,ticketType:"common",
reason:reason.txt,createdAt:serverTimestamp()
});
});
}
$("appList").onclick=e=>{
const ed=e.target.closest("[data-app-edit]");
if(ed){const a=(C.apps||[]).find(x=>x.id===ed.dataset.appEdit);if(a)appEditorModal(a);return}
const tg=e.target.closest("[data-app-toggle]");
if(tg){const a=(C.apps||[]).find(x=>x.id===tg.dataset.appToggle);if(!a)return;
setDoc(doc(db,"apps",a.id),{active:a.active===false,updatedAt:serverTimestamp()},{merge:true}).then(loadAll).then(()=>toast(a.active===false?"App ativado — está no ar no AppHub.":"App pausado — saiu do AppHub do site.")).catch(error);return}
const dl=e.target.closest("[data-app-del]");
if(dl){if(!confirm("Excluir este app do AppHub? As instalações e provas já enviadas continuam no histórico."))return;
deleteDoc(doc(db,"apps",dl.dataset.appDel)).then(loadAll).then(()=>toast("App excluído.")).catch(error);return}
};
$("appInstList").onclick=async e=>{
const ok=e.target.closest("[data-ai-ok]"),no=e.target.closest("[data-ai-no]");
if(ok){
const i=(C.appInstalls||[]).find(x=>x.id===ok.dataset.aiOk);if(!i)return;
const app=(C.apps||[]).find(x=>x.id===i.appId);
const cur=app?.install?.cur||"brl",qty=Math.max(0,Math.floor(Number(app?.install?.qty)||0));
if(!confirm("Aprovar a instalação de \""+(i.appName||"app")+"\" de "+(i.participantName||"—")+" e creditar "+xcTxtAdm(cur,qty)+"?"))return;
try{
await appPayReward(i.uid,cur,qty,{kind:"app_install",txt:"AppHub: instalação aprovada — "+String(i.appName||"app").slice(0,60)+" ("+xcTxtAdm(cur,qty)+")"});
await setDoc(doc(db,"appInstalls",i.id),{status:"approved",reviewedAt:serverTimestamp(),paidCur:cur,paidQty:qty},{merge:true});
notifyUser(i.uid,"apphub","<i class=yi data-i=mobile></i> Instalação aprovada!","Sua instalação do app <b style='color:#fcd535'>"+esc(i.appName||"app")+"</b> foi aprovada e "+xcTxtAdm(cur,qty)+" caiu na sua carteira. As atividades do app liberaram no Yshipp AppHub.","#oportunidades");
await loadAll();
toast("Instalação aprovada e "+xcTxtAdm(cur,qty)+" creditado(s). Atividades liberadas para o participante."+(app?.install?.extra?" Lembrete: entregar extra ("+app.install.extra+") via Market.":""));
}catch(err){error(err)}
return;
}
if(no){
const i=(C.appInstalls||[]).find(x=>x.id===no.dataset.aiNo);if(!i)return;
const motivo=prompt("Motivo da negação (o participante lê no site):");
if(motivo===null)return;
await setDoc(doc(db,"appInstalls",i.id),{status:"rejected",reviewNote:String(motivo).slice(0,500),reviewedAt:serverTimestamp()},{merge:true});
await loadAll();toast("Prova de instalação negada.");
}
};
$("appActList").onclick=async e=>{
const ok=e.target.closest("[data-aa-ok]"),no=e.target.closest("[data-aa-no]");
if(ok){
const c=(C.appActs||[]).find(x=>x.id===ok.dataset.aaOk);if(!c)return;
const cur=ok.dataset.cur||"brl",qty=Math.max(0,Math.floor(Number(ok.dataset.qty)||0));
if(!confirm("Aprovar a atividade \""+(c.actTitle||"—")+"\" de "+(c.participantName||"—")+" e creditar "+xcTxtAdm(cur,qty)+"?"))return;
try{
await appPayReward(c.uid,cur,qty,{kind:"app_reward",txt:"AppHub: atividade aprovada — "+String(c.actTitle||"").slice(0,60)+" · "+String(c.appName||"").slice(0,40)+" ("+xcTxtAdm(cur,qty)+")"});
await setDoc(doc(db,"appActivityClaims",c.id),{status:"approved",reviewedAt:serverTimestamp(),paidCur:cur,paidQty:qty},{merge:true});
notifyUser(c.uid,"apphub","<i class=yi data-i=checkc></i> Atividade aprovada!","Sua atividade <b style='color:#fcd535'>"+esc(c.actTitle||"")+"</b> ("+esc(c.appName||"app")+") foi aprovada e "+xcTxtAdm(cur,qty)+" caiu na sua carteira.","#oportunidades");
await loadAll();
toast("Atividade aprovada e "+xcTxtAdm(cur,qty)+" creditado(s)."+(c.reward?.extra?" Lembrete: entregar extra ("+c.reward.extra+") via Market.":""));
}catch(err){error(err)}
return;
}
if(no){
const c=(C.appActs||[]).find(x=>x.id===no.dataset.aaNo);if(!c)return;
const motivo=prompt("Motivo da negação (o participante lê no site):");
if(motivo===null)return;
await setDoc(doc(db,"appActivityClaims",c.id),{status:"rejected",reviewNote:String(motivo).slice(0,500),reviewedAt:serverTimestamp()},{merge:true});
await loadAll();toast("Prova de atividade negada.");
}
};
$("newApp").onclick=()=>appEditorModal(null);
