import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, FacebookAuthProvider, EmailAuthProvider, reauthenticateWithCredential, signInWithPopup, linkWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut, onAuthStateChanged, reload, unlink } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, Timestamp, doc, getDoc, getDocs, getCountFromServer, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, orderBy, limit, onSnapshot, runTransaction, serverTimestamp, writeBatch, increment, arrayRemove, arrayUnion } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const firebaseConfig = {
 apiKey:"AIzaSyCuF38ke5IytK2K6hZO3Xq4HmBeMo9lEEQ",
 authDomain:"yshippcommercedasorte.firebaseapp.com",
 projectId:"yshippcommercedasorte",
 storageBucket:"yshippcommercedasorte.firebasestorage.app",
 messagingSenderId:"301928857844",
 appId:"1:301928857844:web:44a0da1455a1e0b1fadea1",
 measurementId:"G-664T7YTXPZ"
};
const MIN_PW=8;
const CATS=["common","gold","vip"];
const CAT_DEFAULT={common:{name:"Comum",color:"#eaecef"},gold:{name:"Dourado",color:"#fcd535"},vip:{name:"VIP",color:"#a855f7"}};

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
/* banco com CACHE PERSISTENTE no navegador: na segunda visita os dados
   vêm do disco e o Firestore baixa apenas o que mudou — página muito
   mais rápida e bem menos consumo de dados móveis */
let db;
try{
 db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()}),ignoreUndefinedProperties:true});
}catch(e){db=getFirestore(app)}

/* ---- CACHE LOCAL (memória do navegador) ----
   Guarda os últimos dados recebidos em localStorage: a página já abre
   pintada na segunda visita, enquanto o Firestore só confirma as
   novidades. Isso poupa dados móveis e elimina a "tela em branco". */
const YCK="ycache_v2";
function ckGet(){try{const s=localStorage.getItem(YCK);if(!s)return null;const c=JSON.parse(s);return(!c.__t||Date.now()-c.__t<12*864e5)?c:null}catch(e){return null}}
function ckRev(o){
 if(Array.isArray(o))return o.map(ckRev);
 if(o&&typeof o==="object"){
  if(typeof o.seconds==="number"&&typeof o.nanoseconds==="number"){
   try{return new Timestamp(o.seconds,o.nanoseconds)}catch(e){return new Date(o.seconds*1000+Math.round(o.nanoseconds/1e6))}
  }
  const r={};for(const k in o)r[k]=ckRev(o[k]);return r;
 }
 return o;
}
function ckSave(patch){try{const c=ckGet()||{};Object.assign(c,patch,{__t:Date.now()});localStorage.setItem(YCK,JSON.stringify(c))}catch(e){}}
function ckHydrate(){
 const c=ckGet();if(!c)return false;
 try{
  let any=false;
  if(Array.isArray(c.resv)){resvAll=ckRev(c.resv);applyResv();mapPhotos(resvAll);feedReady=true;any=true}
  if(c.settings){settings=ckRev(c.settings)||{};types=settings.ticketTypes&&Object.keys(settings.ticketTypes).length?settings.ticketTypes:CAT_DEFAULT;cfgReady=true;any=true;try{renderFbButtons()}catch(e){};try{applyHomeBlocks()}catch(e){}}
  if(c.catalog&&Array.isArray(c.catalog.categories)&&c.catalog.categories.length){catalog=ckRev(c.catalog)||catalog;any=true}
  if(Array.isArray(c.draws)){draws=ckRev(c.draws);applyDraw();renderPrizes();any=true}
  if(Array.isArray(c.events)){events=ckRev(c.events);renderEvents();any=true}
  if(Array.isArray(c.tasks)){tasks=ckRev(c.tasks);watchClaims();any=true}
  if(Array.isArray(c.links)){links=ckRev(c.links);any=true}
  if(Array.isArray(c.auctions)){auctions=ckRev(c.auctions);renderAuctions();any=true}
  if(Array.isArray(c.bids)){bidsArr=ckRev(c.bids);mapPhotos(bidsArr);any=true}
  if(Array.isArray(c.covers)){covers=ckRev(c.covers);renderCovers();any=true}
  return any;
 }catch(e){return false}
}

/* ============================================================
   ARQUITETURA DO SITE (complemento do painel administrativo)
   ------------------------------------------------------------
   Coleções do Firestore usadas aqui:
   · settings/platform ....... textos, categorias e FAQ (editados no painel)
   · draws .................... sorteios; o ativo é o 1º com status "open"
   · events / tasks / eventTasks  eventos, tarefas e vínculos entre eles
   · taskClaims/{uid}_{taskId}  comprovantes enviados pelo participante
   · wallets/{uid} ........... saldo em reais por categoria (comum/dourado/VIP)
   · users/{uid} ............. perfil do participante (nome, nascimento, Pix)
   · reservations ............ números reservados (feed ao vivo e resultado)

   Fluxo do participante (cada etapa em uma seção numerada abaixo):
   criar conta → verificar e-mail → completar perfil → concluir tarefas
   → acumular reais na carteira → reservar número → acompanhar resultado
   ============================================================ */

const $=id=>document.getElementById(id);
const pad=(n,w)=>String(n).padStart(w||3,"0");
let currentUser=null,profile=null,wallet=null,busy=false,editProfile=false,nameDirty=false;
let draw=null,drawId="",TOTAL=150,START=new Date(0),END=new Date(864e13),COST=1;
let draws=[],events=[],tasks=[],links=[],settings={},types=CAT_DEFAULT;

/* TELA DE CARREGAMENTO: libera conteúdo do cache imediatamente; sem cache,
   aguarda dados essenciais e nunca mantém o bloqueio por mais de 7 segundos. */
let bskHid=false;
const bskFlags={auth:false,catalog:false,platform:false,draws:false,events:false,tasks:false,links:false,auctions:false,bids:false,covers:false,feed:false};
const bskReady=()=>Object.values(bskFlags).every(Boolean);
function hideSkeleton(){
 if(bskHid)return;bskHid=true;
 const el=document.getElementById("bskel");
 if(el){el.classList.add("gone");setTimeout(()=>el.remove(),600)}
}
function bskMark(k){if(bskHid)return;bskFlags[k]=true;if(bskReady())hideSkeleton()}
setTimeout(hideSkeleton,7000);
let auctions=[],bidsArr=[],aucView="active",myJoins=new Set(),history=[],covers=[];
let myTickets=[],tkFilter="active",selDrawId="";
let taken=new Set(),feedItems=[],claims={},unC={},unW=null,unU=null,unH=null,unJ=null,unN=null;let unAuc={},aucBidsMap={};const settlingAuctions=new Set();let lastSettleCheck=0;
let sugg=[],armed=0,session=0,stageOpen=false,sheetOpen="";
let unT=null;
let authMode="login",anote="";
let evView="active",heroData=[],heroSig="",hi=0,hlast=Date.now(),hpause=false,heroVis=true;
let cfgReady=false,feedReady=false;
const ready=()=>cfgReady&&feedReady;
const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
const inApp=/FBAN|FBAV|FB_IAB|Instagram/i.test(navigator.userAgent);

/* ============================================================
   01 · TEMA (claro/escuro)
   ============================================================ */
const root=document.documentElement;
function setTheme(t){
 root.dataset.theme=t;
 try{localStorage.setItem("th",t)}catch(e){}
 try{document.querySelector('meta[name="theme-color"]').content=t==="dark"?"#0b0e11":"#fafafa"}catch(e){}
}
$("pf-theme").onclick=()=>{setTheme(root.dataset.theme==="dark"?"light":"dark");buildProfileHead()};
setTheme(root.dataset.theme==="light"?"light":"dark");

/* ============================================================
   02 · UTILITÁRIOS (toast, erros, datas, máscaras, cópia)
   ============================================================ */
let toastSeq=0;
/* cada aviso tem um tipo (impacto visual) e fica na tela o tempo de leitura do texto */
const NT={success:{t:"Tudo certo",i:"✓"},error:{t:"Atenção",i:"!"},warn:{t:"Aviso",i:"!"},info:{t:"Informação",i:"i"},win:{t:"Parabéns!",i:"<i class=yi data-i=trophy></i>"}};
function guessType(m){
 if(/parabéns|ganhou|reivindicado|bônus/i.test(m))return"win";
 if(/erro|não foi possível|negad|inválid|incorret|insuficiente|suspens|desativad|bloquead|esgotad|não está|não encontrad|falh|acabou de ser reservado/i.test(m))return"error";
 if(/sem conexão|ainda não|antes de|primeiro|informe|digite|selecione|aceite|aguarde|confira|já solicitou|já confirmou|não começou|encerrad|prazo/i.test(m))return"warn";
 if(/sucesso|confirmad|reservad|salv|enviad|registrad|copiad|aceitos|verificado|restabelecida|creditad|excluído|criada|atualizado/i.test(m))return"success";
 return"info";
}
function toast(m,type){
 m=String(m).replace(/<i class=yi[^>]*><\/i>/g,"").replace(/\s{2,}/g," ").trim();type=NT[type]?type:guessType(m);
 const cfg=NT[type],box=$("notes");
 const live=[...box.querySelectorAll(".tnote:not(.gone)")];
 /* clique repetido no mesmo botão: NÃO empilha avisos iguais —
    o aviso antigo é substituído por um novo (reinicia a contagem) */
 const dup=live.find(c=>c.__msg===m&&c.__type===type);
 if(dup&&dup.__kill)dup.__kill();
 if(live.length>=3&&live[0].__kill)live[0].__kill();
 const dur=Math.min(13000,Math.max(type==="error"?6500:4800,2600+m.length*62))+(type==="win"?3000:0);
 const id="t"+(++toastSeq)+"_"+Date.now();
 const wrap=document.createElement("div");
 wrap.innerHTML=`<div class="pnote tnote nt-${type}" data-note="${id}" role="${type==="error"?"alert":"status"}" style="--d:${dur}ms"><span class="nico">${cfg.i}</span><span class="nbody"><span class="nkind">${cfg.t}</span><b>${esc(m)}</b></span><button class="nclose" data-noteclose="${id}" aria-label="Fechar">✕</button><i class="nprog"></i></div>`;
 const card=wrap.firstElementChild;
 card.__msg=m;card.__type=type;
 box.appendChild(card);
 const kill=()=>{if(!card.isConnected)return;clearTimeout(tm);card.classList.add("gone");setTimeout(()=>card.remove(),260)};
 card.__kill=kill;
 let left=dur,t0=Date.now(),tm=setTimeout(kill,dur);
 const pause=()=>{if(card.classList.contains("paused"))return;clearTimeout(tm);left-=Date.now()-t0;card.classList.add("paused")};
 const resume=()=>{if(!card.classList.contains("paused"))return;t0=Date.now();tm=setTimeout(kill,Math.max(900,left));card.classList.remove("paused")};
 card.addEventListener("mouseenter",pause);card.addEventListener("mouseleave",resume);
 card.addEventListener("touchstart",pause,{passive:true});card.addEventListener("touchend",resume,{passive:true});
 if(type==="win"&&!reduceMotion){
  const cols=["#fcd535","#0ecb81","#f6465d","#3d8bfd","#a855f7","#ffe56b"];
  for(let k=0;k<16;k++){const c=document.createElement("i");c.className="cf";c.style.background=cols[k%cols.length];c.style.setProperty("--x",(Math.random()*320-40)+"px");c.style.setProperty("--y",(Math.random()*-90-10)+"px");c.style.setProperty("--r",(Math.random()*540)+"deg");c.style.animationDelay=(Math.random()*.15)+"s";card.appendChild(c);setTimeout(()=>c.remove(),1800)}
 }
 try{if(navigator.vibrate&&(type==="error"||type==="win"))navigator.vibrate(type==="win"?[30,50,30]:45)}catch(e){}
}
function showError(e){
 console.error(e);
 if(e&&e.code==="auth/cancelled-popup-request")return;
 const m={
  "auth/email-already-in-use":"Este e-mail já possui uma conta. Use Entrar ou Esqueci minha senha.",
  "auth/invalid-email":"O e-mail informado é inválido.",
  "auth/missing-password":"Digite sua senha.",
  "auth/weak-password":"A senha precisa ter pelo menos "+MIN_PW+" caracteres.",
  "auth/invalid-credential":"E-mail ou senha incorretos. Se você criou a conta com o Google, use Continuar com Google.",
  "auth/user-disabled":"Esta conta foi desativada. Fale com o organizador.",
  "auth/too-many-requests":"Muitas tentativas. Aguarde alguns minutos ou redefina sua senha.",
  "auth/popup-closed-by-user":"A janela de login foi fechada.",
  "auth/popup-blocked":"O navegador bloqueou a janela de login. Libere pop-ups ou abra a página no Chrome/Safari.",
  "auth/network-request-failed":"Sem conexão. Verifique sua internet e tente de novo.",
  "permission-denied":"Acesso negado pelas regras do Firebase.",
  "unavailable":"Firebase indisponível no momento. Tente de novo em instantes."
 };
 toast(m[e.code]||e.message||"Ocorreu um erro.");
}
const esc=v=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* remove marcação de ícone (ex.: <i class=yi data-i=…></i>) e qualquer outra
   tag que venha gravada dentro de textos — evita código cru aparecendo no card */
const plainTxt=s=>String(s??"").replace(/<i[^>]*>[\s\S]*?<\/i>/gi,"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim();
const fmt=d=>{const x=d?.toDate?d.toDate():new Date(d);return Number.isNaN(x.getTime())?"—":x.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"})};
const fmtS=d=>{const x=d?.toDate?d.toDate():new Date(d);return Number.isNaN(x.getTime())?"—":x.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"})};
const safeUrl=u=>/^https?:\/\//i.test(u||"")?u:"";
const validUrl=v=>/^https?:\/\/\S+$/i.test(String(v||""));
const validDate=v=>{if(!v)return null;const d=v.toDate?v.toDate():new Date(v);return Number.isNaN(d.getTime())?null:d};
function maskName(n){const p=String(n||"Participante").trim().split(/\s+/);return p[0]+(p[1]?" "+p[1][0].toUpperCase()+".":"")}
function copyText(t){
 if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(()=>toast("Copiado.")).catch(()=>toast("Não foi possível copiar."));return}
 const i=document.createElement("textarea");i.value=t;document.body.appendChild(i);i.select();
 try{document.execCommand("copy");toast("Copiado.")}catch(e){toast("Não foi possível copiar.")}
 i.remove();
}
const typeName=k=>types[k]?.name||(CAT_DEFAULT[k]?.name||k);
const typeColor=k=>types[k]?.color||(CAT_DEFAULT[k]?.color||"#eaecef");
const catLabel=k=>typeName(k);

/* ============================================================
   03 · ESTADO DO SORTEIO, EVENTOS E TAREFAS
   ============================================================ */
function drawState(){
 if(!draw)return"none";
 if(draw.status!=="open")return draw.status;
 const n=Date.now();
 if(START.getTime()&&n<START.getTime())return"waiting";
 if(END.getTime()<864e13&&n>=END.getTime())return"ended";
 if(taken.size>=TOTAL)return"ended";
 return"open";
}
const tms=v=>{const d=validDate(v);return d?d.getTime():0};
const tme=v=>{const d=validDate(v);return d?d.getTime():Infinity};
function evState(o){
 const n=Date.now(),e=o.endAt?tme(o.endAt):Infinity;
 if(n>=e)return"ended";           /* prazo encerrado: sempre "encerrado" */
 if(o.active===false)return"off"; /* desativado pelo organizador: oculto */
 /* Início futuro = "Em breve", MESMO com Ativo = true — igual à documentação
    do painel (antes, Ativo=true com data futura aparecia como ativo agora) */
 const s=tms(o.startAt);
 if(n<s)return"future";
 return"active";
}
function taskState(t){
 if(t.active===false)return"off";
 const now=Date.now(),s=tms(t.startAt),e=t.endAt?tme(t.endAt):Infinity;
 if(now<s||now>=e)return"off";
 if(t.eventId){const ev=events.find(x=>x.id===t.eventId);if(!ev||evState(ev)!=="active")return"off"}
 return"on";
}

/* ============================================================
   04 · MENU MOBILE E NAVEGAÇÃO
   ============================================================ */
$("menu").onclick=()=>openSheet(sheetOpen==="menu"?"":"menu");
$("nav").addEventListener("click",e=>{if(e.target.tagName==="A"){$("nav").classList.remove("open");$("menu").setAttribute("aria-expanded","false")}});
{
 const links=[...document.querySelectorAll("#nav a")];
 const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)links.forEach(a=>a.classList.toggle("on",a.getAttribute("href")==="#"+e.target.id))}),{rootMargin:"-30% 0px -60% 0%"});
 links.forEach(a=>{const h=a.getAttribute("href")||"";if(h.length<2)return;const s=document.querySelector(h);if(s)io.observe(s)});
}

/* ============================================================
   05 · PRÊMIOS (coluna "prizes" do sorteio: {name, type, value})
   ============================================================ */
const PRIZE_TYPES={
 money:{label:"Dinheiro",icon:"R$"},object:{label:"Objeto",icon:"OBJ"},tickets:{label:"Saldo (R$)",icon:"R$"},
 shopee:{label:"Shopee",icon:"SHP"},mercadolivre:{label:"Mercado Livre",icon:"ML"},amazon:{label:"Amazon",icon:"AMZ"},
 magalu:{label:"Magazine Luiza",icon:"MGL"},giftcard:{label:"Cartão presente",icon:"GC"},recharge:{label:"Recarga de operadora",icon:"REC"},digital:{label:"Prêmio digital",icon:"DIG"}
};
const prizeType=x=>PRIZE_TYPES[x?.type]||{label:"Prêmio",icon:"PR"};
function prizesOf(){
 const p=Array.isArray(draw?.prizes)?draw.prizes.filter(x=>x&&x.name):null;
 if(p&&p.length)return p.map(x=>{const ty=prizeType(x);return{icon:ty.icon,name:String(x.name),type:ty.label,value:String(x.value||"").trim()}});
 const w=draw?.result?.winners;
 if(Array.isArray(w)&&w.length)return w.map((x,i)=>({icon:String(i+1),name:x.prize||"Prêmio "+(i+1),type:"Prêmio",value:""}));
 return null;
}
/* converte "R$ 1.500,00", "1.500", "1500" etc. em número para somar o valor dos prêmios */
function parseMoney(v){
 if(v==null)return 0;
 if(typeof v==="number")return isFinite(v)?v:0;
 const m=String(v).replace(/[^\d.,]/g,"");
 if(!m)return 0;
 if(m.includes(",")&&m.includes("."))return m.lastIndexOf(",")>m.lastIndexOf(".")
  ?parseFloat(m.replace(/\./g,"").replace(",","."))
  :parseFloat(m.replace(/,/g,""));
 if(m.includes(","))return parseFloat(m.replace(/\./g,"").replace(",","."))||0;
 /* só bilhetes: em pt-BR geralmente é separador de milhar (1.500) */
 return parseFloat(m.replace(/\./g,""))||parseFloat(m);
}
const fmtBRL=v=>"R$ "+(Math.round(v*100)/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
let pzIdx=0,pzN=0,pzLast=Date.now(),pzPause=false,pzSig="",pzVis=true;
function pzShow(i){
 const tr=$("pz-track");if(!tr||!pzN)return;
 pzIdx=((i%pzN)+pzN)%pzN;pzLast=Date.now();
 tr.style.transform="translateX(-"+(pzIdx*100)+"%)";
 [...tr.children].forEach((el,k)=>{el.setAttribute("aria-hidden",String(k!==pzIdx));el.inert=k!==pzIdx});
 $("pzc").querySelectorAll("[data-pzi]").forEach((d,k)=>d.classList.toggle("on",k===pzIdx));
 const c=$("pz-count");if(c)c.textContent=(pzIdx+1)+"/"+pzN;
 const bar=$("pz-bar");if(bar){bar.classList.remove("run");void bar.offsetWidth;if(pzN>1&&!pzPause)bar.classList.add("run")}
}
function renderPrizes(){
 /* um card por prêmio, de TODOS os sorteios visíveis; desliza sozinho a cada 10 s */
 const groups=draws
  .filter(d=>d&&d.id&&d.status!=="draft"&&Array.isArray(d.prizes)&&d.prizes.some(x=>x&&x.name))
  .map(d=>({d,pz:d.prizes.filter(x=>x&&x.name).map(x=>{const ty=prizeType(x);return{icon:ty.icon,name:String(x.name),type:ty.label,value:String(x.value||"").trim()}})}));
 /* abertos primeiro, depois os em breve e por último os encerrados */
 const ORD={open:0,waiting:1,paused:2,ended:3};
 groups.sort((a,b)=>(ORD[drawStateOf(a.d)]??4)-(ORD[drawStateOf(b.d)]??4));
 if(!groups.length&&draw){const pz=prizesOf();if(pz)groups.push({d:draw,pz})}
 const el=$("pzc"),tb=$("pz-total");
 if(!groups.length){
  pzN=0;pzSig="";
  el.innerHTML='<div class="pz-empty">'+(draw?"Os prêmios deste sorteio serão divulgados pelo organizador.":"Nenhum sorteio aberto neste momento.")+'</div>';
  tb.hidden=true;
  $("pz-sub").textContent=draw?"Confira o regulamento e as tarefas para participar.":"";
  return;
 }
 let total=0,count=0,noVal=0;
 const slides=[];
 groups.forEach(g=>{
  const sub=g.pz.reduce((s,p)=>s+parseMoney(p.value),0);
  total+=sub;count+=g.pz.length;
  const ev=g.d.eventId?events.find(x=>x.id===g.d.eventId):null;
  const st=drawStateOf(g.d);
  const stTag=st==="open"?'<span class="tag g">Sorteio aberto</span>':st==="ended"?'<span class="tag">Sorteio encerrado</span>':st==="paused"?'<span class="tag r">Pausado</span>':'<span class="tag y">Em breve</span>';
  g.pz.forEach((p,i)=>{
   if(!parseMoney(p.value))noVal++;
   const last=i===g.pz.length-1;
   slides.push(`<article class="pz-slide" aria-roledescription="slide">
    <div class="pz-card" data-n="${i+1}">
     <div class="pz-top">${stTag}${i===0?'<span class="tag y">Prêmio principal</span>':`<span class="tag">${i+1}º prêmio</span>`}</div>
     <div class="pz-main"><span class="pz-ico">${p.icon||""}</span><div style="min-width:0"><h3>${esc(p.name)}</h3><p class="pz-type">${esc(p.type)}</p></div></div>
     <div class="pz-val">${p.value?esc(p.value):"Valor a definir"}</div>
     <div class="pz-meta"><span><i class=yi data-i=ticket></i> ${esc(g.d.name||"Sorteio")}</span>${ev?`<span><i class=yi data-i=calendar></i> ${esc(ev.name)}</span>`:""}<span>${i+1} de ${g.pz.length} neste sorteio</span>${g.d.drawDate?`<span><i class=yi data-i=calendar></i> Apuração ${fmt(g.d.drawDate)}</span>`:""}</div>
     ${last&&g.pz.length>1&&sub>0?`<p class="pz-subt">Subtotal deste sorteio (${g.pz.length} prêmios): <b class="mono">${fmtBRL(sub)}</b></p>`:""}
    </div></article>`);
  });
 });
 window.__pzMoney=total;
 const n=slides.length;
 const html=`<div class="pz-track" id="pz-track">${slides.join("")}</div>`+(n>1?`<button class="cv-b p" data-pzstep="-1" aria-label="Prêmio anterior">‹</button><button class="cv-b n" data-pzstep="1" aria-label="Próximo prêmio">›</button><div class="pz-ctl">${n<=12?`<div class="dots">${slides.map((_,k)=>`<button data-pzi="${k}" aria-label="Prêmio ${k+1}"></button>`).join("")}</div>`:""}<span class="mono" id="pz-count">1/${n}</span></div><div class="pz-bar" id="pz-bar"></div>`:"");
 tb.hidden=false;
 tb.innerHTML=`<div><span class="label"><span class="icn" aria-hidden="true" style="width:13px;height:13px;vertical-align:-2px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5h4a2.5 2.5 0 0 1 0 5H9.5z"/><circle cx="12" cy="17" r=".4" fill="currentColor" stroke="none"/></svg></span> Valor total em prêmios</span><small>${count} prêmio(s) em ${groups.length} sorteio(s)${noVal&&total>0?" · "+noVal+" sem valor informado":""}</small></div><b>${total>0?fmtBRL(total):"A definir"}</b>`;
 $("pz-sub").textContent=n>1?"Um prêmio por vez, trocando sozinho a cada 10 segundos. Use as setas ou deslize para ver os outros.":"Prêmio em disputa.";
 if(html===pzSig)return;
 pzSig=html;pzN=n;
 el.innerHTML=html;
 if(pzIdx>=pzN)pzIdx=0;
 pzShow(pzIdx);
}
{
 const c=$("pzc");let x0=null;
 c.addEventListener("click",e=>{
  const b=e.target.closest("[data-pzstep]");if(b)return pzShow(pzIdx+Number(b.dataset.pzstep));
  const d=e.target.closest("[data-pzi]");if(d)pzShow(Number(d.dataset.pzi));
 });
 c.addEventListener("mouseenter",()=>{pzPause=true;$("pz-bar")?.classList.remove("run")});
 c.addEventListener("mouseleave",()=>{pzPause=false;pzShow(pzIdx)});
 c.addEventListener("touchstart",e=>{x0=e.touches[0].clientX},{passive:true});
 c.addEventListener("touchend",e=>{if(x0==null)return;const dx=e.changedTouches[0].clientX-x0;x0=null;if(Math.abs(dx)>40)pzShow(pzIdx+(dx<0?1:-1))},{passive:true});
}

/* ============================================================
   05b · SORTEIOS (lista explícita de todos os sorteios para participar)
   ============================================================ */
let sdView="active";
function drawStateOf(d){
 if(!d)return"none";
 if(d.status!=="open")return d.status;
 const s=tms(d.startAt),e=d.endAt?tme(d.endAt):Infinity,n=Date.now();
 if(n<s)return"waiting";
 if(n>=e)return"ended";
 /* esgotado = mesmo estado que o sorteio selecionado (drawState), agora com contagem real */
 if(resvCount(d.id)>=totOfDraw(d))return"ended";
 return"open";
}
const totOfDraw=d=>Math.max(1,Math.floor(Number(d?.totalNumbers))||150);
/* ── CONTAGEM REAL DE RESERVAS POR SORTEIO ──────────────────────────────
   O feed global só guarda as últimas 200 reservas (é um feed de exibição).
   Para NÃO mentir na contagem ("livres de N", sorteio esgotado etc.):
   · sorteio selecionado .... listener completo (where drawId) → taken
   · demais sorteios ........ contagem no servidor (getCountFromServer),
                             em cache por 2 minutos */
let resvCounts={}; /* drawId -> {n: contagem, at: timestamp} */
const RESV_TTL=120000;
const resvCount=id=>id===drawId?taken.size:(resvCounts[id]!=null?resvCounts[id].n:new Set(resvAll.filter(x=>x.drawId===id).map(x=>Number(x.number))).size);
async function refreshResvCount(id){
 if(id===drawId)return;
 const c=resvCounts[id];
 if(c&&Date.now()-c.at<RESV_TTL)return;
 try{
  const s=await getCountFromServer(query(collection(db,"reservations"),where("drawId","==",id)));
  const n=s.data().count;
  if(c&&c.n===n){c.at=Date.now();return}
  resvCounts[id]={n,at:Date.now()};
  render();
 }catch(e){console.error("Contagem de reservas:",e)}
}
function renderSorteios(){
 const el=$("sdraws");if(!el)return;
 [...$("sdtabs").children].forEach(b=>b.classList.toggle("on",b.dataset.v===sdView));
 const all=draws.filter(d=>d.status!=="draft");
 const list=all.filter(d=>{const st=drawStateOf(d);return sdView==="active"?st==="open":sdView==="future"?(st==="waiting"||st==="paused"):st==="ended"});
 if(!list.length){el.innerHTML=`<div class="card evc" style="flex:1 1 100%"><p class="hint">${sdView==="active"?"Nenhum sorteio aberto agora. Veja os futuros ou volte mais tarde.":sdView==="future"?"Nenhum sorteio futuro por enquanto.":"Nenhum sorteio encerrado ainda."}</p></div>`;return}
 /* TODOS os sorteios da aba aparecem, cada um com seu próprio card e botão */
 el.innerHTML=list.map(d=>{
 const ev=d.eventId?events.find(x=>x.id===d.eventId):null;
 const evOk=!ev||(evState(ev)==="active"&&myJoins.has(ev.id));
 const evSt=ev?evState(ev):null;
 const st=drawStateOf(d);
 const stTag=st==="open"?'<span class="tag g">Aberto</span>':st==="ended"?'<span class="tag">Encerrado</span>':st==="paused"?'<span class="tag r">Pausado</span>':'<span class="tag y">Em breve</span>';
 const pz=Array.isArray(d.prizes)?d.prizes.filter(x=>x&&x.name):[];
 const res=d.result&&Array.isArray(d.result.winners)?d.result.winners:[];
 const isSel=d.id===drawId&&st==="open";
 const canPick=st==="open"&&currentUser?.emailVerified&&evOk;
 let cta="";
 if(st==="open"&&!canPick){
  if(!currentUser)cta=`<a class="btn wide ghost" href="#participar" data-goreserve="${esc(d.id)}">Entrar ou criar conta para escolher número</a>`;
  else if(!currentUser.emailVerified)cta=`<a class="btn wide ghost" href="#participar" data-goreserve="${esc(d.id)}">Confirmar seu e-mail para escolher número</a>`;
  else if(ev&&evSt!=="active")cta=`<p class="hint"><b>${evSt==="future"?"Este evento ainda não começou":"Este evento já foi encerrado"}.</b> ${evSt==="future"?"Abre em "+(fmt(ev.startAt)!=="—"?fmt(ev.startAt):"data a definir")+".":"Os números deste sorteio ficam bloqueados até lá."}</p>`;
  else if(ev&&!myJoins.has(ev.id))cta=`<p class="hint"><b>Pague a entrada do evento (botão acima) para liberar a escolha de números.</b></p>`;
  else cta=`<a class="btn wide ghost" href="#participar" data-goreserve="${esc(d.id)}">Completar perfil para escolher número</a>`;
 }
 return `<div class="card evc" id="sdcard-${esc(d.id)}">
  <div class="ev-row"><h3><i class=yi data-i=ticket></i> ${esc(d.name||"Sorteio")}</h3>${stTag}${isSel?'<span class="tag g">Você está participando deste</span>':""}</div>
  ${d.description?`<p>${esc(d.description)}</p>`:""}
  ${ev?`<div class="lrow"><span class="tn">Evento</span><b class="lval">${esc(ev.name)}</b></div>`:""}
  <p class="mono"><i class=yi data-i=calendar></i> Início: ${fmt(d.startAt)} · Encerra: ${fmt(d.endAt)}${d.drawDate?" · Apuração: "+fmt(d.drawDate):""}</p>
  <div class="trow"><span class="tn">Números</span><span class="tag">${st==="open"?Math.max(0,(Math.floor(Number(d.totalNumbers))||150)-resvCount(d.id))+" livre(s) de "+(Math.floor(Number(d.totalNumbers))||150):"Total de "+(Math.floor(Number(d.totalNumbers))||150)}</span></div>
  <div class="trow"><span class="tn">Custo por número</span><span class="tag y">${fmtBRL(Math.max(1,Math.floor(Number(d.ticketCost))||1))}</span></div>
  ${pz.length?`<div class="ev-row" style="margin-top:8px"><span class="label">Prêmios deste sorteio</span><span class="tag y">${pz.length}</span></div>`+pz.map(p=>`<div class="lrow"><span class="tn"><i class=yi data-i=gift></i> ${esc(p.name)}</span><b class="lval">${esc(PRIZE_TYPES[p.type]?.label||"Prêmio")}${p.value?" · "+esc(p.value):""}</b></div>`).join(""):`<p class="hint">Os prêmios deste sorteio serão divulgados pelo organizador.</p>`}
  ${res.length?`<div class="ev-row"><span class="label">Resultado</span><span class="tag g">Publicado</span></div>`+res.map(w=>`<div class="trow"><span class="tn"><i class=yi data-i=trophy></i> Nº ${w.number}</span><span class="tag g">${esc(w.prize||"")} · ${whoHTML(w,(w.displayName||"—").trim().charAt(0))}${esc(maskName(w.displayName||"—"))}</span></div>`).join(""):""}
  ${st==="open"?'<div class="tk-cut" aria-hidden="true"></div>':""}
  ${ev&&evSt==="active"&&!myJoins.has(ev.id)&&st==="open"?`<button class="btn wide" data-evjoin="${esc(ev.id)}">1º passo · Pagar entrada do evento (${fmtBRL(Math.max(0,Math.floor(Number(ev.entryCost)||0)))})</button>`:""}
  ${st==="open"?(canPick?`<button class="btn wide" data-pick="${esc(d.id)}"><i class=yi data-i=ticket></i> Escolher meu número neste sorteio</button>`:cta):""}
 </div>`;
 }).join("");
 /* contagem real no servidor para os sorteios listados (cache de 2 min) */
 list.forEach(d=>refreshResvCount(d.id));
}
$("sdtabs").onclick=e=>{const v=e.target.dataset.v;if(v){sdView=v;renderSorteios()}};
/* carrossel de sorteios: setas deslizam, no celular é só arrastar */
$("sdprev").onclick=()=>{const el=$("sdraws");if(el)slide(el,-1)};
$("sdnext").onclick=()=>{const el=$("sdraws");if(el)slide(el,1)};
$("sdraws").addEventListener("click",e=>{
 /* a entrada do evento é tratada pelo ouvinte global (evita cobrar duas vezes o mesmo clique) */
 const pick=e.target.closest("[data-pick]");
 if(pick){selDrawId=pick.dataset.pick;armed=0;applyDraw();render();goStage(false);return}
 const g=e.target.closest("[data-goreserve]");
 if(g){selDrawId=g.dataset.goreserve;applyDraw();render()}
});

/* ============================================================
   05b2 · ÁREA DE PARTICIPAÇÃO DENTRO DE "SORTEIOS"
   O botão "Escolher meu número" troca o carrossel pela área de
   participação no mesmo lugar (conta → perfil → evento → tarefas
   → número), sem rolar a página até lá embaixo.
   ============================================================ */
function renderStage(){
 const st=$("participar");if(!st)return;
 st.hidden=!stageOpen;
 ["sdraws","sdtabs","sdprev","sdnext"].forEach(id=>{const el=$(id);if(el)el.hidden=stageOpen});
 if(!stageOpen)return;
 $("sd-stage-name").textContent=draw?.name||"Cadastro e tarefas";
 const opens=draws.filter(d=>drawStateOf(d)==="open");
 $("sd-switch").innerHTML=opens.length>1?'<span class="label">Trocar de sorteio</span>'+opens.map(d=>`<button type="button" class="sw-d ${d.id===drawId?"on":""}" data-sw="${esc(d.id)}"><span>${esc(d.name||"Sorteio")}</span><small>${Math.max(1,Math.floor(Number(d.ticketCost))||1)} /nº</small></button>`).join(""):"";
}
function goStage(fromOutside){
 /* sem usuário logado, TODA entrada de participação abre a gaveta de login em tela cheia */
 if(!currentUser&&typeof openLoginGaveta==="function")openLoginGaveta("login");
 /* o palco de participação vive dentro da gaveta de sorteios — garante que ela esteja aberta */
 if(typeof openSg==="function")openSg();
 stageOpen=true;renderStage();
 /* alinhamento preciso: depois do deslize, o botão "‹ Voltar aos sorteios"
    fica a 12px da parte de baixo do cabeçalho fixo (como na referência) */
 requestAnimationFrame(()=>{
  const hb=$("top")?.getBoundingClientRect().bottom||0;
  const r=$("participar")?.getBoundingClientRect();
  if(!r||!r.height)return;
  window.scrollTo({top:Math.max(0,Math.round(scrollY+r.top-hb-12)),behavior:reduceMotion?"auto":"smooth"});
 });
}
$("sd-back").onclick=()=>{stageOpen=false;armed=0;render()};
$("participar").addEventListener("click",e=>{const b=e.target.closest("[data-sw]");if(b){selDrawId=b.dataset.sw;armed=0;$("numin").value="";applyDraw();render()}});
/* todo link "#participar" (cabeçalho, menu, hero, carteira) abre a área dentro de Sorteios */
document.addEventListener("click",e=>{
 const a=e.target.closest('a[href="#participar"]');
 if(!a)return;
 e.preventDefault();
 goStage(!a.closest("#sorteios"));
});

/* ============================================================
   05c · BARRA DO TOPO AO VIVO (ticker) — editável no painel ou automática
   ============================================================ */
function renderTicker(){
 const el=$("ticker");if(!el)return;
 if(Array.isArray(settings.ticker)&&settings.ticker.some(x=>x&&x.label)){
  el.innerHTML=settings.ticker.filter(x=>x&&x.label).map(x=>`<div><span>${esc(x.label)}</span><b>${esc(x.value??"—")}</b></div>`).join("");
  return;
 }
 const openDraws=draws.filter(d=>d.status==="open").length;
 const actEv=events.filter(e=>e.active!==false&&evState(e)==="active").length;
 const openAuc=auctions.filter(a=>a.status==="open").length;
 const live=resvAll.length+bidsArr.length;
 const money=draws.filter(d=>d.status!=="draft").flatMap(d=>Array.isArray(d.prizes)?d.prizes:[]).filter(p=>p&&p.name).reduce((s,p)=>s+parseMoney(p.value),0);
 el.innerHTML=[
  ["Eventos ativos",actEv],["Sorteios abertos",openDraws],["Leilões abertos",openAuc],["Participações ao vivo",live],["Em prêmios",money>0?fmtBRL(money):"—"]
 ].map(([a,b])=>`<div><span>${esc(a)}</span><b>${b}</b></div>`).join("");
}

/* ============================================================
   05d · ESTATÍSTICAS-CHAVE NO HERO (prova social junto da promessa)
   ============================================================ */
function renderHeroStats(){
 const el=$("hero-stats");if(!el)return;
 const openDraws=draws.filter(d=>d.status==="open").length;
 const live=resvAll.length+bidsArr.length;
 const money=draws.filter(d=>d.status!=="draft").flatMap(d=>Array.isArray(d.prizes)?d.prizes:[]).filter(p=>p&&p.name).reduce((s,p)=>s+parseMoney(p.value),0);
 el.innerHTML=[
  ["Sorteios abertos",openDraws],
  ["Participações ao vivo",live],
  ["Em prêmios",money>0?fmtBRL(money):"—"]
 ].map(([a,b])=>`<div><span>${esc(a)}</span><b>${b}</b></div>`).join("");
}

/* ============================================================
   05e · CTA FINAL (efeito de recência) — urgência real antes do FAQ
   ============================================================ */
function updateCtaFinal(){
 const el=$("cta-final");if(!el)return;
 const rd=ready(),st=drawState();
 if(!rd||st==="ended"){el.hidden=true;return}
 el.hidden=false;
 const t=$("cta-tag");
 if(st==="open"){t.textContent="Sorteio aberto";t.className="tag g";
  $("cta-cd-l").textContent="O sorteio encerra em";$("cta-end").textContent=END?fmt(END):"—";
  $("cta-p").textContent="Participação gratuita. Reserve seu número antes do encerramento — cada número tem o valor exibido.";
 }else if(st==="waiting"){t.textContent="Em breve";t.className="tag y";
  $("cta-cd-l").textContent="O sorteio abre em";$("cta-end").textContent=START&&START.getTime()>0?fmt(START):"—";
  $("cta-p").textContent="Crie sua conta e acumule reais agora para não perder o próximo sorteio.";
 }else{t.textContent="Aguardando";t.className="tag y";
  $("cta-cd-l").textContent="Situação";$("cta-end").textContent=st==="paused"?"Sorteio pausado":"Aguardando o organizador";
  $("cta-p").textContent="Enquanto o organizador libera o sorteio, acumule reais fazendo tarefas e ofertas.";
 }
}

/* ============================================================
   06 · HERO EM CARROSSEL (sorteio ativo + eventos)
   ============================================================ */
function heroSlides(){
 const rd=ready(),cs=drawState(),name=draw?.name||"";
 const L=[{kind:"main",
  tag:!rd?"Carregando":cs==="open"?"Sorteio aberto":cs==="waiting"?"Em breve":cs==="paused"?"Pausado":"Sorteio encerrado",tc:rd&&cs==="open"?"g":"",
  title:settings.heroTitle||name||"Participe do sorteio",
  text:settings.heroText||draw?.description||"Participação gratuita. Conclua tarefas, ganhe reais e reserve seu número.",
  tk:0,start:START,end:END,link:"",state:cs}];
 const HERORD={active:0,future:1,ended:2};
 events.filter(e=>e.active!==false).map(e=>({e,s:evState(e)}))
  .filter(x=>HERORD[x.s]!==undefined)
  .sort((x,y)=>HERORD[x.s]-HERORD[y.s])
  .forEach(({e,s})=>L.push({kind:"offer",id:e.id,state:s,tag:s==="active"?"Evento ativo":s==="future"?"Evento em breve":"Evento encerrado",tc:s==="active"?"g":s==="future"?"y":"",
   title:e.name||"Evento",text:e.description||"",tk:Number(e.ticketsOffered)||0,
   start:validDate(e.startAt),end:validDate(e.endAt),link:safeUrl(e.link)}));
 return L;
}
function tl(s){
 const now=Date.now(),st=s.start?s.start.getTime():null,en=s.end?s.end.getTime():null;
 const span=st!=null&&en!=null?en-st:0;
 const pctOf=span>0?Math.min(100,Math.max(0,(now-st)/span*100)):null;
 const range=(st!=null?"Início "+fmt(s.start):"")+(st!=null&&en!=null?" · ":"")+(en!=null?"Fim "+fmt(s.end):"");
 if(s.kind==="main"){
  if(!ready())return{label:"Carregando…",target:null,pct:null,note:""};
  const cs=drawState();
  if(cs==="ended")return{label:"Encerrado",target:null,pct:100,note:"O período de participação terminou."};
  if(cs==="waiting")return{label:"O sorteio abre em",target:st,pct:0,note:range};
  if(cs!=="open")return{label:cs==="paused"?"Sorteio pausado":"Indisponível",target:null,pct:null,note:"Aguardando o organizador."};
  return{label:"O sorteio encerra em",target:en,pct:pctOf,note:range};
 }
 if(s.state==="ended")return{label:"Encerrado",target:null,pct:100,note:"Este evento terminou"+(s.end?" em "+fmt(s.end):"")+"."};
 if(st!=null&&now<st)return{label:"Começa em",target:st,pct:0,note:range};
 if(en==null)return{label:"Sem data para acabar",target:null,pct:null,note:st!=null?"Início "+fmt(s.start):"Disponível agora."};
 return{label:"Termina em",target:en,pct:pctOf,note:range};
}
function slideHTML(s,i,n){
 const H=s.kind==="main"?"h1":"h2",cls=s.kind==="main"?"":' class="hl"';
 const guest=!currentUser;
 const ctas=s.kind==="main"
  ?'<a class="btn lg" href="#sorteios">Participar do sorteio</a>'+(guest?'<a class="btn lg ghost" href="#como">Como funciona</a>':"")
  :`<button class="btn lg" type="button" data-evtopen="1">Ver evento</button>${s.link?`<a class="btn lg ghost" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">Abrir oferta</a>`:""}`;
 return `<article class="slide" aria-roledescription="slide" aria-label="${i+1} de ${n}">
  <div class="s-top"><span class="tag ${s.tc}">${esc(s.tag)}</span>${s.tk?`<span class="tag y">+${fmtBRL(s.tk)}</span>`:""}</div>
  <${H}${cls}>${esc(s.title)}</${H}>
  ${s.text?`<p class="lead">${esc(s.text)}</p>`:""}
  <div class="tm"><span class="label cd-l"></span>
   <div class="count"><div class="cu"><b data-u="d">00</b><span>dias</span></div><div class="cu"><b data-u="h">00</b><span>horas</span></div><div class="cu"><b data-u="m">00</b><span>min</span></div><div class="cu"><b data-u="s">00</b><span>seg</span></div></div>
   <div class="track pg"><div class="fill"></div></div>
   <p class="hint cd-n"></p></div>
  <div class="cta-row">${ctas}</div></article>`;
}
function showSlide(i,manual){
 const els=[...$("slides").children];if(!els.length)return;
 hi=(i+els.length)%els.length;if(manual)hlast=Date.now();
 els.forEach((e,k)=>{const on=k===hi;e.classList.toggle("on",on);e.setAttribute("aria-hidden",String(!on));e.inert=!on});
 [...$("dots").children].forEach((d,k)=>{d.classList.toggle("on",k===hi);d.setAttribute("aria-current",String(k===hi))});
}
function tickHero(){
 const els=$("slides").children;
 heroData.forEach((s,i)=>{
  const el=els[i];if(!el)return;
  const t=tl(s);
  el.querySelector(".cd-l").textContent=t.label;
  const c=el.querySelector(".count");c.hidden=t.target==null;
  if(t.target!=null){
   const x=Math.max(0,Math.floor((t.target-Date.now())/1000));
   const v={d:Math.floor(x/86400),h:Math.floor(x%86400/3600),m:Math.floor(x%3600/60),s:x%60};
   c.querySelectorAll("[data-u]").forEach(b=>b.textContent=String(v[b.dataset.u]).padStart(2,"0"));
  }
  const pg=el.querySelector(".pg");pg.hidden=t.pct==null;
  if(t.pct!=null)pg.firstElementChild.style.width=t.pct.toFixed(1)+"%";
  el.querySelector(".cd-n").textContent=t.note;
 });
}
function renderHero(){
 const L=heroSlides();
 /* assinatura inclui o estado de sessão: logou/deslogou, o hero é reconstruído
    (o botão "Como funciona" só existe sem sessão) */
 const sig=JSON.stringify(L.map(s=>[s.kind,s.id,s.state,s.tag,s.title,s.text,s.tk,s.start&&+s.start,s.end&&+s.end,s.link])).replace(/$/,currentUser?"·in":"·out");
 /* ⓘ e a seção "Como funciona" só aparecem sem sessão conectada */
 try{
  document.querySelectorAll('[data-info="info-como"]').forEach(b=>b.hidden=!!currentUser);
  const comoSec=document.querySelector('section#como');
  if(comoSec)comoSec.hidden=!!currentUser;
 }catch(e){}
 if(sig!==heroSig){
  heroSig=sig;heroData=L.slice(0,1);
  /* carrossel do hero removido: apenas o primeiro item, fixo, sem fade */
  $("slides").innerHTML=L.length?slideHTML(L[0],0,1):"";
  $("dots").innerHTML="";
  $("hctl").hidden=true;
  hi=0;showSlide(0,false);
 }
 tickHero();
}
$("hprev").onclick=()=>showSlide(hi-1,true);
$("hnext").onclick=()=>showSlide(hi+1,true);
$("dots").addEventListener("click",e=>{const b=e.target.closest("button");if(b)showSlide([...$("dots").children].indexOf(b),true)});
$("slides").addEventListener("click",e=>{const a=e.target.closest("[data-ev]");if(a){evView=a.dataset.ev;renderEvents();evtOpen()}});
{
 const h=$("hero-l");let x0=null;
 h.addEventListener("mouseenter",()=>hpause=true);h.addEventListener("mouseleave",()=>hpause=false);
 h.addEventListener("focusin",()=>hpause=true);h.addEventListener("focusout",()=>hpause=false);
 h.addEventListener("touchstart",e=>{x0=e.touches[0].clientX},{passive:true});
 h.addEventListener("touchend",e=>{if(x0==null)return;const d=e.changedTouches[0].clientX-x0;x0=null;if(Math.abs(d)>50)showSlide(hi+(d<0?1:-1),true)},{passive:true});
}

/* ============================================================
   07 · CONTAGEM REGRESSIVA E AVISOS
   ============================================================ */
function countdown(){
 const now=Date.now(),rd=ready(),st=drawState();
 const off=!navigator.onLine;
 const lv=$("live");
 if(lv){
  $("live-t").textContent=off?"Sem conexão":!rd?"Carregando":st==="open"?"Aberto":st==="waiting"?"Em breve":st==="ended"?"Encerrado":"Indisponível";
  lv.className="live"+(off?" bad":rd&&st==="open"?"":" off");
 }
 const notice=(settings.notice||"").trim();
 $("promo").hidden=!notice||!cfgReady;
 if(notice)$("promo-t").textContent=notice;
 renderHero();
 /* rotação automática do hero removida — hero estático */
 if(pzN>1){if(pzPause||!pzVis||document.hidden)pzLast=now;else if(now-pzLast>=10000)pzShow(pzIdx+1)}
 /* a cada 30s: apura leilões cujo prazo expirou (fechamento automático) */
 if(now-lastSettleCheck>=30000){lastSettleCheck=now;try{settleExpiredAuctions()}catch(e){}}
}
/* performance: carrosséis só giram quando estão visíveis na tela */
try{
 const io=new IntersectionObserver(es=>{for(const en of es){if(en.target.id==="slides")heroVis=en.isIntersecting;if(en.target.id==="pzc")pzVis=en.isIntersecting}},{rootMargin:"120px"});
 if($("slides"))io.observe($("slides"));
 if($("pzc"))io.observe($("pzc"));
}catch(e){}
countdown();setInterval(()=>{if(!document.hidden)countdown()},1000);
/* botão de copiar cupom removido da faixa do topo */
addEventListener("offline",()=>{toast("Sem conexão. Reconecte para continuar.");countdown()});
addEventListener("online",()=>{toast("Conexão restabelecida.");countdown()});

/* ============================================================
   08 · CADASTRO E LOGIN (entrar, criar conta, redefinir senha, Google)
   ============================================================ */
function renderAuth(){
 const r=authMode==="reset",reg=authMode==="register";
 $("tabs").hidden=r;$("pw-f").hidden=r;$("or").hidden=r;$("auth-soc").hidden=r;
 $("inapp").hidden=!inApp;
 [...$("tabs").children].forEach(b=>b.classList.toggle("on",b.dataset.m===authMode));
 $("go").textContent=r?"Enviar link de redefinição":reg?"Criar conta":"Entrar";
 $("forgot").textContent=r?"Voltar para o login":"Esqueci minha senha";
 $("forgot").hidden=reg;
 $("password").autocomplete=reg?"new-password":"current-password";
 $("amsg").textContent=anote||(reg?"Use pelo menos "+MIN_PW+" caracteres. Enviaremos um link para verificar seu e-mail.":"");
}
$("tabs").onclick=e=>{const m=e.target.dataset.m;if(m){authMode=m;anote="";render()}};
$("forgot").onclick=()=>{authMode=authMode==="reset"?"login":"reset";anote="";render()};
$("showpw").onclick=()=>{const p=$("password"),s=p.type==="password";p.type=s?"text":"password";$("showpw").textContent=s?"Ocultar":"Mostrar"};
$("go").onclick=async()=>{
 const email=$("email").value.trim(),pw=$("password").value;
 if(authMode!=="reset"&&!termsOk())return askTerms();
 const goBtn=$("go");
 if(goBtn.disabled)return;
 try{
  if(authMode==="reset"){
   if(!email)return toast("Digite seu e-mail para receber o link.");
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return toast("Informe um e-mail válido, ex.: seuemail@exemplo.com.");
   goBtn.disabled=true;goBtn.textContent="Enviando…";
   await sendPasswordResetEmail(auth,email,{url:location.href,handleCodeInApp:false});
   anote="✓ Se existir uma conta para "+email+", enviamos o link de redefinição. Confira a caixa de entrada e o spam. O link vale por 1 hora.";
   toast("Link de redefinição enviado para "+email+".");
   render();
  }else if(authMode==="register"){
   if(!email||pw.length<MIN_PW)return toast("Informe e-mail e senha com pelo menos "+MIN_PW+" caracteres.");
   goBtn.disabled=true;goBtn.textContent="Criando…";
   const c=await createUserWithEmailAndPassword(auth,email,pw);
   await sendEmailVerification(c.user);
   toast("Conta criada. Enviamos o link de verificação.");
  }else{
   if(!email)return toast("Digite seu e-mail.");
   goBtn.disabled=true;goBtn.textContent="Entrando…";
   await signInWithEmailAndPassword(auth,email,pw);
  }
 }catch(e){showError(e)}
 finally{goBtn.disabled=false;renderAuth()}
};
["email","password"].forEach(id=>$(id).addEventListener("keydown",e=>{if(e.key==="Enter")$("go").click()}));
$("google").onclick=async()=>{if(!termsOk())return askTerms();try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(e){showError(e)}};
/* menu da conta (usuário logado) */
const closeAcct=()=>{const m=$("acct-menu");if(m)m.hidden=true;const b=$("acct-btn");if(b)b.setAttribute("aria-expanded","false")};
if($("acct-btn"))$("acct-btn").onclick=e=>{e.stopPropagation();const m=$("acct-menu");m.hidden=!m.hidden;$("acct-btn").setAttribute("aria-expanded",String(!m.hidden))};
document.addEventListener("click",e=>{if(!e.target.closest(".acct")){closeAcct();closeNC()}});
/* menu "Centrais" do cabeçalho (desktop) + grupo do menu completo (celular) */
const closeNC=()=>{$("nc-menu").hidden=true;$("nc-btn").setAttribute("aria-expanded","false")};
$("nc-btn").onclick=e=>{e.stopPropagation();closeAcct();const m=$("nc-menu");m.hidden=!m.hidden;$("nc-btn").setAttribute("aria-expanded",String(!m.hidden))};
$("nc-adc").onclick=()=>{closeNC();adcOpen()};
$("nc-mn").onclick=()=>{closeNC();mnOpen()};
$("nc-fj").onclick=()=>{closeNC();fjOpen()};
$("nc-evt").onclick=()=>{closeNC();evtOpen()};$("nc-vip").onclick=()=>{closeNC();vipOpen()};
$("nc-clv").onclick=()=>{closeNC();openClv()};
$("nc-sup").onclick=()=>{closeNC();openSupport()};
$("mnc-adc").onclick=()=>{closeSheet();adcOpen()};
$("mnc-mn").onclick=()=>{closeSheet();mnOpen()};
$("mnc-fj").onclick=()=>{closeSheet();fjOpen()};
$("mnc-evt").onclick=()=>{closeSheet();evtOpen()};
$("mnc-clv").onclick=()=>{closeSheet();openClv()};$("mnc-wal").onclick=()=>{closeSheet();walOpen()};$("mnc-vip").onclick=()=>{closeSheet();vipOpen()};
$("mnc-sup").onclick=()=>{closeSheet();openSupport()};
$("am-logout").onclick=()=>{closeAcct();signOut(auth).catch(showError)};
$("am-edit").onclick=()=>{closeAcct();openSheet("profile")};
$("am-wallet").onclick=()=>{closeAcct();walOpen()};
$("am-ticket").onclick=()=>{closeAcct();document.querySelector("#bilhete").scrollIntoView({behavior:"smooth"})};
/* itens da conta dentro do menu mobile */
$("m-acct").addEventListener("click",e=>{
 const a=e.target.closest("[data-ma]")?.dataset.ma;
 if(!a)return;
 if(a==="logout"){closeSheet();return signOut(auth).catch(showError)}
 if(a==="edit")openSheet("profile");
 if(a==="wallet")openSheet("wallet");
});
$("resend").onclick=async()=>{
 try{
  if(!currentUser)return;
  if(currentUser.emailVerified)return toast("Seu e-mail já está verificado.");
  await sendEmailVerification(currentUser);toast("Novo e-mail de verificação enviado.");
 }catch(e){showError(e)}
};
async function recheck(silent){
 const u=auth.currentUser;
 if(!u||u.emailVerified)return;
 try{
  await reload(u);
  if(auth.currentUser.emailVerified){toast("E-mail verificado!");boot(auth.currentUser)}
  else if(!silent)toast("Ainda não identificamos a verificação. Confira a caixa de entrada e o spam.");
 }catch(e){if(!silent)showError(e)}
}
$("check-verification").onclick=()=>recheck(false);
setInterval(()=>{if(!document.hidden)recheck(true)},12000);
addEventListener("focus",()=>recheck(true));

/* ============================================================
   09 · PERFIL DO PARTICIPANTE (nome, nascimento, gênero, Pix)
   ============================================================ */
$("fbname").addEventListener("input",()=>{nameDirty=true;$("pstat").textContent=$("fbname").value.trim()===(profile?.name||"")?"Nome salvo.":"Alterações não salvas."});

const profileOk=()=>!!(profile?.name&&profile.name.trim().length>=3);
async function saveProfileFrom(pre,isEdit){
 const g=k=>$(pre+k);
 try{
  if(!currentUser?.emailVerified)return toast("Verifique seu e-mail primeiro.");
  if(!termsOk())return askTerms();
  const name=g("fbname").value.trim().replace(/\s+/g," ");
  const birth=g("birth").value,pix=g("pix").value.trim().slice(0,120),gender=g("gender").value;
  const street=g("street").value.trim().slice(0,120),housenum=g("housenum").value.trim().slice(0,12),compl=g("compl").value.trim().slice(0,60);
  const uf=g("uf").value,country=g("country").value,whatsapp=g("whatsapp").value.trim().slice(0,20);
  if(name.length<3||name.length>60)return toast("Informe um nome entre 3 e 60 caracteres.");
  if(street.length<3)return toast("Informe a rua do seu endereço.");
  if(!housenum)return toast("Informe o número da sua casa.");
  if(!uf)return toast("Selecione o seu estado.");
  if(!country)return toast("Selecione o seu país.");
  const waDigits=whatsapp.replace(/\D/g,"");
  if(waDigits.length<10||waDigits.length>13)return toast("Informe um WhatsApp válido com DDD (ex.: (11) 98765-4321).");
  /* mudança de dados exige confirmação de senha (contas com senha própria) */
  if(isEdit){
   const hasPw=currentUser.providerData?.some(p=>p.providerId==="password");
   if(hasPw){
    const pw=g("reauth").value;
    if(!pw)return toast("Digite sua senha para confirmar as alterações.");
    try{await reauthenticateWithCredential(currentUser,EmailAuthProvider.credential(currentUser.email,pw))}
    catch(e){return showError(e)}
   }
  }
  await updateDoc(doc(db,"users",currentUser.uid),{name,birthDate:birth||"",pixKey:pix,gender,
   whatsapp,address:{street,housenum,complement:compl,state:uf,country},
   updatedAt:serverTimestamp()});
  g("reauth").value="";
  return true;
 }catch(e){showError(e)}
 return false;
}
$("save-profile").onclick=async()=>{if(await saveProfileFrom("",editProfile)){editProfile=false;nameDirty=false;$("pstat").textContent="";toast("Dados salvos.")}};
$("showreauth").onclick=()=>{const p=$("reauth"),s=p.type==="password";p.type=s?"text":"password";$("showreauth").textContent=s?"Ocultar":"Mostrar"};
$("forgot-in-profile").onclick=()=>{
 try{
  if(!currentUser?.email)return toast("Entre na sua conta primeiro.");
  askConfirm("Enviar link de redefinição de senha para "+currentUser.email+"?","Redefinir senha",async()=>{
   try{
    await sendPasswordResetEmail(auth,currentUser.email);
    toast("Link enviado para "+currentUser.email+". Confira também o spam.");
   }catch(e){showError(e)}
  },"Enviar link");
 }catch(e){showError(e)}
};

/* ============================================================
   10 · CARTEIRA · MOEDA ÚNICA: REAL (R$)
   ============================================================ */
const walletTotal=w=>CATS.reduce((s,k)=>s+Math.max(0,Math.floor(Number(w?.[k])||0)),0);
/* ============================================================
   MOEDA ÚNICA: REAL (R$). Todos os saldos, recompensas, custos,
   lances e entradas da plataforma são reais. Os campos antigos
   (comuns/dourados/VIP/troco) continuam existindo no banco por
   compatibilidade com contas já criadas, mas cada unidade de
   qualquer um deles vale R$ 1,00 — a carteira é uma só.
   O campo brl (recargas/saques) entra no mesmo saldo total.
   ============================================================ */
const VAL={common:1,gold:1,vip:1};
const pointsOf=w=>Math.max(0,Math.floor(Number(w?.change)||0))+CATS.reduce((s,k)=>s+Math.max(0,Math.floor(Number(w?.[k])||0))*VAL[k],0)+Math.max(0,Number(w?.brl)||0);
function spendValue(w,pts){
 pts=Math.max(0,Math.floor(pts));
 let need=pts,troco=0;
 const d={change:0,common:0,gold:0,vip:0,brl:0};
 const ch=Math.min(need,Math.max(0,Math.floor(Number(w?.change)||0)));
 d.change=ch;need-=ch;
 for(const k of CATS){
  while(need>0){
   const have=Math.max(0,Math.floor(Number(w?.[k])||0))-d[k];
   if(have<=0)break;
   d[k]++;need-=VAL[k];
   if(need<0){troco=-need;need=0}
  }
 }
 /* o saldo em reais (brl) faz parte do mesmo saldo único */
 if(need>0){const b=Math.min(need,Math.max(0,Math.floor(Number(w?.brl)||0)));d.brl=b;need-=b}
 return need>0?null:{d,troco};
}
const applySpend=(w,r)=>{const o={};CATS.forEach(k=>o[k]=Math.max(0,Math.floor(Number(w?.[k])||0))-r.d[k]);o.change=Math.max(0,Math.floor(Number(w?.change)||0))-r.d.change+r.troco;o.brl=Math.max(0,Number(w?.brl)||0)-(r.d.brl||0);return o};
const mine=()=>Array.isArray(profile?.numbers)?profile.numbers.filter(n=>Number.isInteger(n)):[];
const canReserveCount=()=>Math.floor(pointsOf(wallet)/COST);

/* ============================================================
   11 · SESSÃO DO USUÁRIO (perfil + carteira em tempo real)
   ============================================================ */
function stop(){try{clvStop()}catch(e){}try{ahStop()}catch(e){}try{ecStop()}catch(e){}try{affStop()}catch(e){}try{vipStop()}catch(e){}if(unU)unU();if(unW)unW();if(unH)unH();if(unJ)unJ();if(unT)unT();if(unN)unN();if(unCof)unCof();if(unD)unD();Object.values(unAuc).forEach(f=>{try{f()}catch(e){}});unU=unW=unH=unJ=unT=unN=unCof=unD=null;unAuc={};aucBidsMap={};Object.values(unC).forEach(f=>f());unC={};claims={};history=[];myJoins=new Set();myTickets=[]}
async function boot(user){
 bskMark("auth");
 const s=++session;
 stop();
 currentUser=user;profile=null;wallet=null;armed=0;editProfile=false;nameDirty=false;
 watchNotes();
 watchCollab(user?.uid);
 watchCofreMy(user?.uid);
 try{watchCollabReview()}catch(e){console.error("Central do colaborador:",e)}
 try{ahWatch()}catch(e){}
 if(!user||!user.emailVerified){render();return}
 const uRef=doc(db,"users",user.uid);
 /* ═══ 1º DE TUDO: dados do perfil — o ouvinte em tempo real começa
    imediatamente, antes de qualquer outra etapa; tudo que vem depois
    é protegido, então nada quebra a sessão ═══ */
 try{
  unU=onSnapshot(uRef,x=>{if(s!==session)return;const d=x.exists()?x.data():{};profile={...d,numbers:Array.isArray(d.numbers)?d.numbers:[]};
   /* participante banido no painel: a sessão é encerrada imediatamente */
   if(d.banned&&!window.__bannedOut){window.__bannedOut=true;toast("Sua conta foi suspensa pelo organizador.");signOut(auth).catch(()=>{})}
   else if(!d.banned)window.__bannedOut=false;
   if(window.__pm!==d.photoMode){window.__pm=d.photoMode;paintAvatars()}
   render()},e=>console.error("Perfil:",e));
 }catch(e){console.error("Perfil (início da sessão):",e)}
 try{
  const uExisted=(await getDoc(uRef)).exists();
  if(!uExisted)await setDoc(uRef,{name:"",email:user.email||"",createdAt:serverTimestamp()});
  /* AFILIADO YSHIPPCOMMERCE: conta criada com ?ref= marca quem indicou;
     afiliado ganha +R$ 5,00 (1x por indicação) e o novo membro +R$ 5,00 extra */
  if(!uExisted){
   try{
    let ref=String(new URLSearchParams(location.search).get("ref")||"").trim();
    if(!ref){try{ref=localStorage.getItem("yref")||""}catch(e){}}
    if(ref&&ref!==user.uid&&(await getDoc(doc(db,"users",ref))).exists()){
     await runTransaction(db,async tx=>{
      const us=await tx.get(uRef);
      if(us.exists()&&us.data().referredBy)return;
      tx.set(uRef,{referredBy:ref,updatedAt:serverTimestamp()},{merge:true});
      tx.set(doc(db,"wallets",ref),{common:increment(5),updatedAt:serverTimestamp()},{merge:true});
      tx.set(doc(collection(db,"wallets",ref,"history")),{kind:"affiliate",amount:5,ticketType:"common",reason:"Indicação: nova conta criada com seu link <i class=yi data-i=handshake></i>",createdAt:serverTimestamp()});
      tx.set(doc(db,"wallets",user.uid),{common:increment(5),updatedAt:serverTimestamp()},{merge:true});
      tx.set(doc(collection(db,"wallets",user.uid,"history")),{kind:"welcome_ref",amount:5,ticketType:"common",reason:"Bônus extra: você entrou pelo link de um afiliado <i class=yi data-i=spark></i>",createdAt:serverTimestamp()});
     });
    }
   }catch(e){console.error("Afiliado:",e)}
  }
  /* BÔNUS DE BOAS-VINDAS: R$ 10,00 creditados uma única vez, logo após o cadastro */
  try{
   const wRef=doc(db,"wallets",user.uid);
   const credited=await runTransaction(db,async tx=>{
    const ws=await tx.get(wRef);
    if(ws.exists()&&ws.data().welcomeBonus)return false;
    tx.set(wRef,{common:increment(10),welcomeBonus:10,updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",user.uid,"history")),{kind:"welcome",amount:10,ticketType:"common",reason:"Bônus de boas-vindas por criar sua conta <i class=yi data-i=spark></i>",createdAt:serverTimestamp()});
    return true;
   });
   if(credited)toast("<i class=yi data-i=spark></i> Bônus de boas-vindas: R$ 10,00 creditados na sua carteira!");
  }catch(e){console.error("Bônus de boas-vindas:",e)}
  if(s!==session)return;
  unW=onSnapshot(doc(db,"wallets",user.uid),x=>{if(s!==session)return;wallet=x.exists()?x.data():null;render();try{walMainSync()}catch(e){}mnFjSync()},e=>console.error("Carteira:",e));
  try{vipStart();vipSync()}catch(e){console.warn("VIP:",e)}
  unH=onSnapshot(query(collection(db,"wallets",user.uid,"history"),orderBy("createdAt","desc"),limit(60)),x=>{if(s!==session)return;history=x.docs.map(d=>({id:d.id,...d.data()}));render();try{vipSync(true)}catch(e){}},e=>console.error("Histórico:",e));
  unJ=onSnapshot(query(collection(db,"eventJoins"),where("uid","==",user.uid)),x=>{if(s!==session)return;myJoins=new Set(x.docs.map(d=>d.data().eventId).filter(Boolean));render()},e=>console.error("Eventos confirmados:",e));
  /* reais do usuário (todas as reservas, de todos os sorteios) */
  /* sem orderBy: where+orderBy exigiria índice composto no Firestore (gerava
     failed-precondition) — ordena no cliente, mesmo resultado, sem índice */
  /* sem limit: o participante vê TODOS os seus números (o limit(200) cortava os antigos) */
  unT=onSnapshot(query(collection(db,"reservations"),where("uid","==",user.uid)),x=>{if(s!==session)return;myTickets=x.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(stampMs(b.createdAt)||0)-(stampMs(a.createdAt)||0));render()},e=>console.error("Bilhetes:",e));
  watchClaims();
 }catch(e){if(s===session)showError(e)}
 render();
}
onAuthStateChanged(auth,boot);

function watchClaims(){
 if(!currentUser?.emailVerified)return;
 const uid=currentUser.uid,s=session;
 const wanted=new Set(tasks.map(t=>t&&t.id).filter(Boolean));
 Object.keys(unC).forEach(id=>{if(wanted.has(id))return;try{unC[id]()}catch(e){}delete unC[id];delete claims[id]});
 tasks.forEach(t=>{
  if(!t?.id||unC[t.id])return;
  unC[t.id]=onSnapshot(doc(db,"taskClaims",uid+"_"+t.id),x=>{if(s!==session)return;claims[t.id]=x.exists()?x.data():null;render()},e=>console.error("Solicitação:",e));
 });
}

/* ============================================================
   12 · FEED AO VIVO DE RESERVAS
   ============================================================ */
onSnapshot(query(collection(db,"reservations"),orderBy("createdAt","desc"),limit(200)),snap=>{
 bskMark("feed");
 resvAll=snap.docs.map(d=>({id:d.id,...d.data()}));
 applyResv();
 mapPhotos(resvAll);
 ckSave({resv:resvAll});
 feedReady=true;render();
},e=>{console.error("Feed:",e);bskMark("feed");const m='<p class="foot">Não foi possível carregar as participações.</p>';if($("feed-draw"))$("feed-draw").innerHTML=m;if($("feed-auc"))$("feed-auc").innerHTML=m});

let feedView="all";
/* feed dividido: números reservados vivem na gaveta de Sorteios,
   lances vivem na gaveta de Leilões — nada na interface principal */
function renderFeed(){
 const elD=$("feed-draw"),elA=$("feed-auc");
 if(!elD&&!elA)return;
 const ft=$("ftabs");
 if(ft)[...ft.children].forEach(b=>b.classList.toggle("on",b.dataset.v===feedView));
 if(!feedReady){
  const m='<p class="foot">Carregando participações…</p>';
  if(elD)elD.innerHTML=m;if(elA)elA.innerHTML=m;return;
 }
 const evName=id=>id?(events.find(e=>e.id===id)?.name||""):"";
 const rowsD=[],rowsA=[];
 resvAll.forEach(x=>{
  const n=Number(x.number);if(!Number.isInteger(n))return;
  const d=draws.find(y=>y.id===x.drawId);
  const tot=Math.floor(Number(d?.totalNumbers))||150;
  const st=d?drawStateOf(d):"";
  rowsD.push({at:stampMs(x.createdAt),who:maskName(x.displayName),ph:whoHTML(x,(x.displayName||"P").trim().charAt(0)),k:"draw",title:d?.name||"Sorteio",ev:evName(d?.eventId),extra:!d?"sorteio removido":st==="open"?"sorteio aberto":st==="ended"?"sorteio encerrado":"sorteio em espera",val:"Nº "+pad(n,String(tot).length)});
 });
 bidsArr.forEach(b=>{
  const amt=Math.max(0,Math.floor(Number(b.amount)||0));if(!amt)return;
  const a=auctions.find(y=>y.id===b.auctionId);
  const tot=Math.max(1,Math.floor(Number(a?.totalTickets)||100));
  rowsA.push({at:stampMs(b.updatedAt||b.createdAt),who:maskName(b.displayName||"Participante"),ph:whoHTML(b,(b.displayName||"P").trim().charAt(0)),k:"auc",title:a?.name||"Leilão",ev:evName(a?.eventId),extra:(a?.prize?"prêmio: "+a.prize+" · ":"")+"lance acumulado · "+Math.min(100,Math.round(amt/tot*100))+"% da meta",val:fmtBRL(amt)});
 });
 rowsD.sort((x,y)=>y.at-x.at);
 rowsA.sort((x,y)=>y.at-x.at);
 const tbl=(l,empty)=>'<div class="fr2 h"><span>Horário</span><span>Participante e modalidade</span><span>Nº / lance</span></div>'+
  (l.length?l.map(r=>`<div class="fr2"><span class="t">${r.at?fmtS(new Date(r.at)):"—"}</span><div class="fm"><b>${r.ph}<span style="overflow:hidden;text-overflow:ellipsis">${esc(r.who)}</span></b><small><span class="tag ${r.k==="draw"?"g":"y"}">${r.k==="draw"?"Sorteio":"Leilão"}</span>${r.k==="draw"?"<i class=yi data-i=ticket></i>":"<i class=yi data-i=scale></i>"} ${esc(r.title)}${r.ev?" · <i class=yi data-i=calendar></i> "+esc(r.ev):""} · ${esc(r.extra)}</small></div><b class="fv ${r.k==="auc"?"a":""}">${esc(r.val)}</b></div>`).join("")
  :`<p class="foot">${empty}</p>`);
 if(elD)elD.innerHTML=tbl(rowsD.slice(0,10),"Nenhum número reservado ainda. Reserve o seu!");
 if(elA)elA.innerHTML=tbl(rowsA.slice(0,10),"Nenhum lance em leilão ainda. Dê o primeiro lance!");
}
if($("ftabs"))$("ftabs").onclick=e=>{const v=e.target.dataset.v;if(v){feedView=v;renderFeed()}};

/* ============================================================
   13 · DADOS DA PLATAFORMA (settings, draws, events, tasks, links)
   ============================================================ */
let resvAll=[];
function applyResv(){
 taken=new Set();feedItems=[];
 const add=x=>{const n=Number(x.number);
  if(x.drawId===drawId&&Number.isInteger(n)&&n>=1&&n<=TOTAL&&!taken.has(n)){taken.add(n);feedItems.push({...x,number:n})}};
 resvAll.forEach(add);
 /* listener completo do sorteio selecionado: taken nunca sai de uma amostra */
 if(unD)drawResvFeed.forEach(add);
}
function applyDraw(){
 draws=draws.filter(d=>d&&d.id);
 /* ordem determinística: o sorteio principal é o aberto que encerra primeiro
    (a ordem bruta do Firestore é lexicográfica por ID, não por data) */
 const opens=draws.filter(d=>d.status==="open").sort((a,b)=>(tme(a.endAt)||Infinity)-(tme(b.endAt)||Infinity)||(tms(a.startAt)||0)-(tms(b.startAt)||0));
 draw=(selDrawId&&opens.find(d=>d.id===selDrawId))||opens[0]||draws.find(d=>d.status!=="draft"&&d.result)||null;
 drawId=draw?.id||"";
 TOTAL=Math.max(1,Math.floor(Number(draw?.totalNumbers))||150);
 START=validDate(draw?.startAt)||new Date(0);
 END=validDate(draw?.endAt)||new Date(864e13);
 COST=Math.max(1,Math.floor(Number(draw?.ticketCost))||1);
 applyResv();
 watchDrawResv();
}
/* ── LISTENER COMPLETO DAS RESERVAS DO SORTEIO SELECIONADO ──
   Todas as reservas do sorteio atual (sem limit): taken passa a ser exato,
   em vez de vir do feed global truncado em 200. */
let unD=null,drawResvFeed=[],drawResvDrawId="";
function watchDrawResv(){
 if(drawResvDrawId===drawId&&unD)return;
 if(unD){try{unD()}catch(e){}unD=null}
 drawResvDrawId=drawId||"";
 drawResvFeed=[];
 if(!drawId)return;
 try{
  unD=onSnapshot(query(collection(db,"reservations"),where("drawId","==",drawId)),s=>{
   drawResvFeed=s.docs.map(d=>({id:d.id,...d.data()}));
   applyResv();
   render();
  },e=>console.error("Reservas do sorteio:",e));
 }catch(e){console.error("Reservas do sorteio:",e)}
}
/* ============================================================
   CATÁLOGO DE TAREFAS (categorias e serviços definidos no painel
   administrativo · settings/taskCatalog). O mesmo documento alimenta
   o formulário guiado do painel e os cards do site.
   ============================================================ */
const TASK_CATS_LEGACY={social:"Rede social",signup:"Cadastro",survey:"Pesquisa / enquete",video:"Vídeo",app:"App / jogo",purchase:"Compra / cashback",referral:"Indicação",content:"Criar conteúdo",other:"Oferta"};
/* catálogo padrão do site = MESMO catálogo do painel (categories + services).
   Se a equipe editar o catálogo no painel, o site usa a versão salva em
   settings/taskCatalog automaticamente (ouvido em tempo real abaixo). */
const SITE_CATALOG_DEFAULT={categories:[
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
 {id:"ig_like",label:"Curtir publicação",reward:1,difficulty:"simple",ticketType:"common"},
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
let catalog=SITE_CATALOG_DEFAULT;
const catOfS=id=>(catalog.categories||[]).find(c=>c.id===id);
const catLabelS=id=>{const c=catOfS(id);return c?c.label:(TASK_CATS_LEGACY[id]||"Oferta")};
const catIcoS=id=>(catOfS(id)?.icon)||"<i class=yi data-i=target></i>";
const DIFFS_SITE={simple:{dot:"<span class=sdotg></span>",label:"Simples"},medium:{dot:"<span class=sdoty></span>",label:"Intermediário"},hard:{dot:"<span class=sdotr></span>",label:"Avançado"}};
const diffOfS=t=>{const k=String(t?.difficulty||"").toLowerCase();if(DIFFS_SITE[k])return DIFFS_SITE[k];if(k.includes("méd")||k.includes("med")||k.includes("inter"))return DIFFS_SITE.medium;if(k.includes("dif"))return DIFFS_SITE.hard;return null};
const PROOF_REQ_SITE={text:"<i class=yi data-i=note></i> Texto",code:"<i class=yi data-i=key></i> Código / cupom",image:"<i class=yi data-i=image></i> Print (link da imagem)",video:"<i class=yi data-i=video></i> Gravação de tela (link)",datetime:"<i class=yi data-i=clock></i> Data e hora"};
/* vagas restantes: nunca maior que o total cadastrado (corrige exibições tipo "400 de 200") */
const stockOf=t=>{
 if(!(Number(t?.stock)>0))return null;
 const total=Math.max(0,Math.floor(Number(t.stock)));
 const left=Number.isFinite(Number(t.stockLeft))?Math.floor(Number(t.stockLeft)):total;
 return Math.max(0,Math.min(total,left));
};

/* pinta a página com o cache salvo no navegador antes de ouvir o Firestore:
   a 2ª visita abre instantânea, mesmo com internet lenta */
if(ckHydrate()){try{render()}catch(e){};hideSkeleton()}

onSnapshot(doc(db,"settings","taskLimits"),s=>{try{window.__taskLimits=s.exists()?s.data():{minStock:25,maxStock:500}}catch(e){window.__taskLimits={minStock:25,maxStock:500}}},()=>{window.__taskLimits={minStock:25,maxStock:500}});
onSnapshot(doc(db,"settings","gigCatalog"),s=>{try{window.__gigCatalog=s.exists()?s.data():null;if(typeof renderProsSite==="function")renderProsSite()}catch(e){}},()=>{});
onSnapshot(query(collection(db,"proGigs"),where("status","==","approved"),limit(200)),s=>{try{window.__proGigs=s.docs.map(d=>({id:d.id,...d.data()})).filter(g=>g.active!==false);if(typeof renderProsSite==="function")renderProsSite()}catch(e){}},()=>{});
onSnapshot(doc(db,"settings","taskCatalog"),s=>{bskMark("catalog");
 const d=s.exists()?s.data():null;
 if(d&&Array.isArray(d.categories)&&d.categories.length){catalog=d;ckSave({catalog:d})}
 render();
},e=>{console.error("Catálogo:",e);bskMark("catalog")});
function applyPlatformIdentity(){
 const name=String(settings.platformName||"Yshippcommerce").trim()||"Yshippcommerce";
 document.title=name;
 document.querySelectorAll(".brand .brand-t").forEach(el=>{const text=[...el.childNodes].find(n=>n.nodeType===3);if(text)text.nodeValue=name});
 const footerBrand=document.querySelector("footer .brand");
 if(footerBrand){const text=[...footerBrand.childNodes].find(n=>n.nodeType===3);if(text)text.nodeValue=name}
 const logo=String(settings.logoUrl||"").trim();
 const safeLogo=/^https?:\/\/\S+$/i.test(logo);
 document.querySelectorAll(".brand .mark").forEach(el=>{
  if(!el.dataset.brandFallback)el.dataset.brandFallback=el.textContent||"Y";
  if(safeLogo){
   if(el.querySelector("img[data-platform-logo]")){const img=el.querySelector("img[data-platform-logo]");if(img.src!==logo)img.src=logo;return}
   const img=document.createElement("img");img.dataset.platformLogo="1";img.src=logo;img.alt="";img.loading="eager";img.referrerPolicy="no-referrer";img.style.cssText="width:100%;height:100%;object-fit:contain;border-radius:inherit";
   img.onerror=()=>{el.replaceChildren(document.createTextNode(el.dataset.brandFallback||"Y"))};el.replaceChildren(img);
  }else{el.replaceChildren(document.createTextNode(el.dataset.brandFallback||"Y"))}
 });
 const contact=String(settings.contact||"").trim(),support=String(settings.supportLink||"").trim();
 const wrap=$("platform-meta"),contactEl=$("platform-contact"),supportEl=$("platform-support");
 if(contactEl){contactEl.textContent=contact?"Contato: "+contact:"";contactEl.hidden=!contact}
 const validSupport=/^https?:\/\/\S+$/i.test(support);
 if(supportEl){supportEl.href=validSupport?support:"#";supportEl.hidden=!validSupport}
 if(wrap)wrap.hidden=!(contact||validSupport);
}
onSnapshot(doc(db,"settings","platform"),s=>{bskMark("platform");
 settings=s.exists()?s.data():{};
 ckSave({settings});
 types=settings.ticketTypes&&Object.keys(settings.ticketTypes).length?settings.ticketTypes:CAT_DEFAULT;
 applyPlatformIdentity();
 try{renderFbButtons()}catch(e){}
 try{applyHomeBlocks()}catch(e){}
 if(Array.isArray(settings.faq)&&settings.faq.some(x=>x.q)){
  $("faq-dyn").hidden=false;$("faq-static").hidden=true;
  $("faq-dyn").innerHTML=settings.faq.map(x=>`<details><summary>${esc(x.q)}</summary><div>${esc(x.a)}</div></details>`).join("");
 }else{$("faq-dyn").hidden=true;$("faq-static").hidden=false}
 if(settings.institutionalText)document.querySelector("footer p").textContent=settings.institutionalText;
 render();
},e=>{console.error("Configurações:",e);bskMark("platform")});
onSnapshot(collection(db,"draws"),s=>{bskMark("draws");draws=s.docs.map(d=>({id:d.id,...d.data()}));ckSave({draws});applyDraw();renderPrizes();render();updateTabBadges()},e=>{console.error("Sorteios:",e);bskMark("draws")});
onSnapshot(collection(db,"events"),s=>{bskMark("events");events=s.docs.map(d=>({id:d.id,...d.data()}));ckSave({events});renderEvents();renderPrizes();render()},e=>{console.error("Eventos:",e);bskMark("events")});
onSnapshot(collection(db,"tasks"),s=>{bskMark("tasks");tasks=s.docs.map(d=>({id:d.id,...d.data()}));ckSave({tasks});watchClaims();try{watchCollabReview()}catch(e){}renderEvents();render()},e=>{console.error("Tarefas:",e);bskMark("tasks")});
onSnapshot(collection(db,"eventTasks"),s=>{bskMark("links");links=s.docs.map(d=>({id:d.id,...d.data()}));ckSave({links});renderEvents()},e=>{console.error("Vínculos:",e);bskMark("links")});
onSnapshot(collection(db,"auctions"),s=>{bskMark("auctions");auctions=s.docs.map(d=>({id:d.id,...d.data()}));ckSave({auctions});watchAuctionBids();renderAuctions();renderFeed();renderResult();updateTabBadges();settleExpiredAuctions()},e=>{console.error("Leilões:",e);bskMark("auctions")});
onSnapshot(query(collection(db,"bids"),orderBy("updatedAt","desc"),limit(200)),s=>{bskMark("bids");bidsArr=s.docs.map(d=>({id:d.id,...d.data()}));mapPhotos(bidsArr);ckSave({bids:bidsArr});renderAuctions();renderFeed();renderResult();renderTicker()},e=>{console.error("Lances:",e);bskMark("bids")});
/* ── LANCES POR LEILÃO (exatos) ──────────────────────────────────────────
   O listener global acima é só o FEED de últimas participações. Totais,
   ranking, % da meta e o botão de reivindicar usam um listener COMPLETO por
   leilão (where auctionId), nunca a amostra global. */
function aucBidsOf(id){return aucBidsMap[id]||bidsArr.filter(b=>b.auctionId===id)}
function watchAuctionBids(){
 const wanted=new Set(auctions.filter(a=>a.status==="open"||(a.status==="ended"&&aucView==="ended")).map(a=>a.id));
 Object.keys(unAuc).forEach(id=>{if(!wanted.has(id)){try{unAuc[id]()}catch(e){}delete unAuc[id];delete aucBidsMap[id]}});
 wanted.forEach(id=>{
  if(unAuc[id])return;
  try{
   unAuc[id]=onSnapshot(query(collection(db,"bids"),where("auctionId","==",id),limit(1000)),s=>{
    aucBidsMap[id]=s.docs.map(d=>({id:d.id,...d.data()}));
    mapPhotos(aucBidsMap[id]);
    renderAuctions();renderResult();renderFeed();
   },e=>console.error("Lances do leilão:",e));
  }catch(e){}
 });
}
onSnapshot(collection(db,"covers"),s=>{bskMark("covers");covers=s.docs.map(d=>({id:d.id,...d.data()})).filter(c=>c&&Array.isArray(c.images)&&c.images.some(Boolean));ckSave({covers});renderCovers()},e=>{console.error("Capas:",e);bskMark("covers")});
getDoc(doc(db,"settings","platform")).then(()=>{cfgReady=true;render()}).catch(()=>{cfgReady=true;render()});

/* ============================================================
   14 · EVENTOS E TAREFAS (renderização e envio de comprovantes)
   ============================================================ */
const tasksOfEvent=eid=>{
 const byLink=links.filter(l=>l.eventId===eid).map(l=>l.taskId);
 return tasks.filter(t=>(t.eventId===eid||byLink.includes(t.id))&&!isBlockedForMe(t));
};
/* categorias das ofertas: agora vêm do catálogo do painel (settings/taskCatalog) */
const offerSort=(a,b)=>((b.featured===true)-(a.featured===true))||((Number(b.priority)||0)-(Number(a.priority)||0));
/* bloqueio de colaboradores: o usuário escolhe não ver as tarefas de quem
   bloqueou (users/{uid}.blockedUids). Ferramenta de proteção pessoal —
   não afeta outros participantes nem notifica ninguém. */
const myBlocked=()=>Array.isArray(profile?.blockedUids)?profile.blockedUids.filter(Boolean):[];
const isBlockedForMe=t=>t?.source==="collab"&&t?.ownerUid&&myBlocked().includes(t.ownerUid);
/* tarefa vira Oferta quando: marcada no painel (showInOffers) OU sem evento e sem vínculo */
const generalTasks=()=>tasks.filter(t=>(t.showInOffers===true||(!t.eventId&&!links.some(l=>l.taskId===t.id)&&t.showInOffers!==false))&&!isBlockedForMe(t)).sort(offerSort);
$("evt-x").onclick=evtClose;
/* setas dos carrosséis (no celular, deslizar com o dedo) */
$("evprev").onclick=()=>slide($("evs"),-1);
$("evnext").onclick=()=>slide($("evs"),1);
$("cprev").onclick=()=>slide($("how"),-1);
$("cnext").onclick=()=>slide($("how"),1);
$("ofprev").onclick=()=>slide($("offs"),-1);
$("ofnext").onclick=()=>slide($("offs"),1);
function taskCard(t){
 /* card modesto: categoria + tarefa, dificuldade, prova exigida e valor em
    bilhetes. Ao clicar, abre a "área de trabalho" com todas as informações */
 const c=claims[t.id],st=c?.status,rd=Math.max(0.01,Math.round((Number(t.reward)||0.01)*100)/100),ty=t.ticketType||"common";
 const left=stockOf(t);
 const soldOut=left!==null&&left<=0;
 const d=diffOfS(t);
 const pr=t.proofReq||null;
 const prN=pr?Object.keys(pr).filter(k=>pr[k]).length:0;
 const minP=prN?Math.max(1,Math.floor(Number(t.minProofs)||1)):0;
 const rev=Math.max(0,Math.floor(Number(t.reviewDays)||0));
 return `<div class="task openable" style="margin-top:10px" data-ws-open="${esc(t.id)}" role="button" tabindex="0">
  <div class="task-head" style="align-items:flex-start"><h4 style="min-width:0">${catIcoS(t.category)} ${esc(plainTxt(t.serviceLabel||t.name))}</h4><button class="tid" type="button" data-copy="${esc(t.id)}" title="Toque para copiar o ID da tarefa" aria-label="Copiar o ID da tarefa">${esc(t.id)}</button></div>
  <div class="actions" style="margin:0 0 4px;gap:6px">
   <span class="tag g">${esc(plainTxt(catLabelS(t.category)))}</span>
   ${d?`<span class="tag y">${esc(plainTxt(d.label))}</span>`:""}
   <span class="tk-stamp ${t.source==="collab"?"y":"g"}" style="align-self:center">${t.source==="collab"?"<i class=yi data-i=handshake></i> Colaborador":"Yshippcommerce"}</span>
   ${t.featured===true?'<span class="tag y">★ Destaque</span>':""}
   ${t.badge?`<span class="tag y">${esc(plainTxt(t.badge))}</span>`:""}
  </div>
  ${t.description?`<p class="task-desc">${esc(plainTxt(t.description))}</p>`:""}
  <div class="kv"><span>Valor</span><b>+${xcShort(t.rewardCur,rd)}</b></div>
  ${prN?`<div class="kv"><span>Comprovação</span><b><i class=yi data-i=paperclip></i> ${minP>1?minP+" provas mínimas":"comprovante"}</b></div>`:""}
  ${rev?`<div class="kv"><span>Avaliação em até</span><b>${rev} dia${rev>1?"s":""}</b></div>`:""}
  ${left!==null?`<div class="kv"><span>Vagas restantes</span><b>${soldOut?'<span class="tag r">Esgotadas</span>':left+" de "+t.stock}</b></div>`:""}
  <div class="actions" style="margin:0">
   ${soldOut?'<span class="tag r">Oferta esgotada</span>':st==="approved"?'<span class="tag g">✓ Aprovada e paga</span>':st==="pending"?'<span class="tag y"><i class=yi data-i=hourglass></i> Em análise</span>':st==="changes"?'<span class="tag y"><i class=yi data-i=edit></i> Correção pedida</span>':st==="rejected"?'<span class="tag r">Negada</span>':"Enviada"}
   <button class="btn sm wide" type="button">Abrir área de trabalho →</button>
  </div>
 </div>`;
}

/* ============================================================
   ÁREA DE TRABALHO DA TAREFA · tela aberta ao clicar no card:
   todas as informações (categoria, tarefa, etapas, prova, valor)
   e o envio do comprovante acontecem aqui dentro
   ============================================================ */
let wsTaskId=null;
function closeWorkspace(){
 $("ws").hidden=true;
 wsTaskId=null;
 document.documentElement.classList.remove("ws-lock");
 $("ws-body").innerHTML="";
}
function openWorkspace(id){
 const t=tasks.find(x=>x.id===id);
 if(!t)return;
 wsTaskId=id;
 const c=claims[t.id],st=c?.status;
 const rd=Math.max(0.01,Math.round((Number(t.reward)||0.01)*100)/100),ty=t.ticketType||"common",pt=t.proofType||"text";
 const d=diffOfS(t);
 const left=stockOf(t);
 const soldOut=left!==null&&left<=0;
 const pr=t.proofReq||null;
 const prOn=pr?Object.keys(pr).filter(k=>pr[k]):[];
 const minP=prOn.length?Math.max(1,Math.floor(Number(t.minProofs)||1)):0;
 const steps=Array.isArray(t.steps)?t.steps.map(s=>String(s||"").trim()).filter(Boolean):[];
 /* regras: aceita lista nova (array) ou texto antigo de uma linha só */
 const rules=(Array.isArray(t.rules)?t.rules.map(s=>String(s||"").trim()):String(t.rules||"").split("\n")).filter(Boolean);
 const reqs=Array.isArray(t.requirements)?t.requirements.map(s=>String(s||"").trim()).filter(Boolean):[];
 const extra=String(t.extra||"").trim();
 const revDays=Math.max(0,Math.floor(Number(t.reviewDays)||0));
 const pdDefault=pt==="name"?"Seu nome completo do perfil é enviado automaticamente como comprovante — mantenha-o igual ao nome usado no cadastro da oferta."
  :pt==="email"?"Use o mesmo e-mail no cadastro da oferta; o organizador confere se ele bate com o comprovante."
  :pt==="code"?"Conclua a oferta, copie o código/cupom exibido e cole no campo “Código” da prova."
  :"Descreva o que você fez ou anexe o print (link da imagem) e a gravação de tela com o link direto.";
 /* formulário de prova: novo (proofReq do painel) ou legado */
 let proofForm="";
 if(prOn.length){
  proofForm=`<div class="proof-menu">
  <button type="button" class="pm-head" data-proof-toggle="${esc(t.id)}" aria-expanded="false"><span><i class=yi data-i=paperclip></i> Anexar prova — ${minP>1?"envie pelo menos "+minP+" provas":"preencha os campos exigidos"}</span><span class="pm-caret" aria-hidden="true">▾</span></button>
  <div class="pm-body" hidden>
   <p class="pm-sub">Tipos exigidos por esta tarefa: ${prOn.map(k=>esc(PROOF_REQ_SITE[k]||k)).join(" · ")}.</p>
   ${pr.text?`<div class="field"><label class="label">Texto da prova</label><input data-proof-text="${esc(t.id)}" placeholder="Descreva o que você fez"></div>`:""}
   ${pr.code?`<div class="field"><label class="label">Código / cupom usado</label><input data-proof-code="${esc(t.id)}" placeholder="Ex.: ABC123"></div>`:""}
   ${pr.image?`<div class="field"><label class="label">Print (link da imagem)</label><input data-proof-image="${esc(t.id)}" placeholder="https://… link direto do print"></div>`:""}
   ${pr.video?`<div class="field"><label class="label">Gravação de tela (link)</label><input data-proof-video="${esc(t.id)}" placeholder="https://… link do vídeo da tela"></div>`:""}
   ${pr.datetime?`<div class="field"><label class="label">Data e hora em que executou a tarefa</label><input type="datetime-local" data-proof-when="${esc(t.id)}"></div>`:""}
  </div>
 </div>`;
 }else if(t.requiresProof!==false){
  proofForm=`<div class="proof-menu">
  <button type="button" class="pm-head" data-proof-toggle="${esc(t.id)}" aria-expanded="false"><span><i class=yi data-i=paperclip></i> Prova da oferta — anexar comprovante</span><span class="pm-caret" aria-hidden="true">▾</span></button>
  <div class="pm-body" hidden>
   ${pt==="name"
    ?`<p class="pm-sub">Seu nome completo será enviado automaticamente — não é preciso preencher nada.</p>`
    :`<p class="pm-sub">Preencha os campos que a prova pedir — pelo menos um é obrigatório. Texto, código, print (link da imagem) ou link da gravação de tela.</p>
    <div class="field"><label class="label">${pt==="email"?"E-mail usado na oferta":pt==="code"?"Código do comprovante":"Texto da prova"}</label><input data-proof-text="${esc(t.id)}" placeholder="${pt==="email"?"seuemail@exemplo.com":pt==="code"?"Ex.: ABC123":"Descreva o que você fez"}"></div>
    <div class="field"><label class="label">Código / cupom usado ${pt==="code"?"":"(se houver)"}</label><input data-proof-code="${esc(t.id)}" placeholder="Ex.: ABC123"></div>
    <div class="field"><label class="label">Print (link da imagem)</label><input data-proof-image="${esc(t.id)}" placeholder="https://… link direto do print"></div>
    <div class="field"><label class="label">Gravação de tela (link)</label><input data-proof-video="${esc(t.id)}" placeholder="https://… link do vídeo da tela"></div>`}
  </div>
 </div>`;
 }
 $("ws-ico").innerHTML=catIcoS(t.category);
 $("ws-title").textContent=plainTxt(t.serviceLabel||t.name||"Tarefa");
 try{$("ws-sub").textContent=(catLabelS(t.category)||"Tarefa")+(d?" · "+d.label:"")+" · recompensa +"+xcShort(t.rewardCur,rd)+" · execução e comprovante"}catch(e){}
 $("ws-body").innerHTML=`
 <div class="ws-chips">
  <span class="tag g">${catIcoS(t.category)} ${esc(catLabelS(t.category))}</span>
  ${d?`<span class="tag y">${d.dot} ${esc(d.label)}</span>`:""}
  <span class="tag y">+${xcShort(t.rewardCur,rd)}</span>
  <span class="tk-stamp ${t.source==="collab"?"y":"g"}" style="align-self:center">${t.source==="collab"?"<i class=yi data-i=handshake></i> Colaborador"+(t.ownerName?` · <span data-up="${esc(t.ownerUid||"")}" style="cursor:pointer;text-decoration:underline dotted" title="Ver perfil público">${esc(t.ownerName)}</span>`:""):"Yshippcommerce"}</span>
  ${t.featured===true?'<span class="tag y">★ Destaque</span>':""}
  ${t.badge?`<span class="tag y">${esc(t.badge)}</span>`:""}
  ${minP?`<span class="tag"><i class=yi data-i=paperclip></i> ${minP} prova${minP>1?"s":""} mínima${minP>1?"s":""}</span>`:""}
 </div>
 <div class="ws-kv">
  <div><span>Categoria</span><b>${esc(catLabelS(t.category))}</b></div>
  <div><span>Tarefa</span><b>${esc(plainTxt(t.serviceLabel||t.name))}</b></div>
  <div><span>Valor da recompensa</span><b>+${xcShort(t.rewardCur,rd)}</b></div>
  <div><span>ID da tarefa</span><b class="mono" style="display:inline-flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;align-items:center;min-width:0">${esc(t.id)}<button class="btn sm ghost" type="button" data-copy="${esc(t.id)}">Copiar</button></b></div>
  <div><span>Dificuldade</span><b>${d?d.dot+" "+esc(d.label):"—"}</b></div>
  ${t.endAt?`<div><span>Termina em</span><b>${fmt(t.endAt)}</b></div>`:""}
  ${left!==null?`<div><span>Vagas restantes</span><b>${soldOut?"Esgotadas":left+" de "+t.stock}</b></div>`:""}
 </div>
 ${t.description?`<div class="ws-sec"><div class="ws-h"><i class=yi data-i=note></i> Descrição</div><p class="ws-desc">${esc(t.description)}</p></div>`:""}
 ${steps.length?`<div class="ws-sec"><div class="ws-h"><i class=yi data-i=checkc></i> Passo a passo</div><ol class="ws-list">${steps.map(s=>`<li>${esc(s)}</li>`).join("")}</ol></div>`:""}
 ${rules.length?`<div class="ws-sec"><div class="ws-h"><i class=yi data-i=shield></i> Regras da tarefa</div><ol class="ws-list rules">${rules.map(s=>`<li>${esc(s)}</li>`).join("")}</ol></div>`:""}
 ${reqs.length?`<div class="ws-sec"><div class="ws-h"><i class=yi data-i=target></i> Requisitos</div><ul class="ws-list req">${reqs.map(s=>`<li>${esc(s)}</li>`).join("")}</ul></div>`:""}
 ${extra?`<div class="ws-sec"><div class="ws-h"><i class=yi data-i=bulb></i> Informações adicionais</div><p class="ws-desc">${esc(extra)}</p></div>`:""}
 ${revDays?`<div class="ws-sec"><div class="ws-h"><i class=yi data-i=clock></i> Prazo de avaliação</div><p class="ws-desc">Seu comprovante é analisado em até <b>${revDays} dia${revDays>1?"s":""}</b> após o envio.</p></div>`:""}
 ${t.coupon?`<div class="coupon"><span class="tag y">Cupom</span><code>${esc(t.coupon)}</code><button class="btn sm ghost" data-copy="${esc(t.coupon)}">Copiar</button></div>`:""}
 ${t.requiresProof===false?"":`<div><div class="ws-h">Prova de execução</div><div class="proof-detail" style="margin-top:8px"><span class="pd-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z"/></svg></span><div><span class="pd-t">Detalhes da prova exigida</span><small>${esc(t.proofDetails||pdDefault)}</small></div></div></div>`}
 ${st==="changes"&&c.reviewNote?`<p class="hint"><i class=yi data-i=edit></i> Correção pedida pelo colaborador: ${esc(c.reviewNote)}</p>`:""}
 ${st==="rejected"&&c.rejectionReason?`<p class="hint">Motivo da rejeição: ${esc(c.rejectionReason)}</p>`:""}
 <div class="task" style="margin:0;background:var(--p2);border:1px dashed var(--l);border-radius:12px;padding:14px">
  ${proofForm}
  <div class="actions" style="margin:0">
   ${safeUrl(t.link)&&!soldOut?`<a class="btn sm" href="${esc(safeUrl(t.link))}" target="_blank" rel="noopener noreferrer">Abrir tarefa <i class=yi data-i=external></i></a>`:""}
   ${soldOut?'<span class="tag r">Oferta esgotada</span>':st==="approved"?'<span class="tag g">✓ Aprovada/paga — recompensa na carteira</span>':st==="pending"?'<span class="tag y"><i class=yi data-i=hourglass></i> Em análise</span>':st==="changes"?'<span class="tag y"><i class=yi data-i=edit></i> Correção pedida — reenvie a prova</span>':`<button class="btn sm" data-req="${esc(t.id)}">${t.autoApprove===true?"Concluir e receber "+xcShort(t.rewardCur,0)+" <i class=yi data-i=spark></i>":st==="rejected"?"Solicitar de novo":st==="changes"?"Reenviar prova corrigida":"Solicitar conferência"}</button>`}
  </div>
  <p class="hint">${t.autoApprove===true?"Aprovação automática: ao enviar, a recompensa ("+xcShort(t.rewardCur,1)+") cai na sua carteira na hora.":t.source==="collab"?"A inspeção desta prova é feita pelo colaborador dono da oferta <i class=yi data-i=handshake></i> — a recompensa cai na sua carteira assim que ele aprovar. Não envie senhas ou dados bancários.":"O organizador analisa o comprovante. Não envie senhas ou dados bancários."}</p>
  ${t.source==="collab"&&c&&c.status!=="approved"?`<div style="border-top:1px dashed var(--l);margin-top:10px;padding-top:10px"><p class="hint" style="margin:0 0 8px">Desconfia de <b>má-fé na avaliação</b> (prova ignorada, correção impossível, negação injusta)? Leve o caso ao suporte com o <b>ID da tarefa</b> — a equipe audita e pode reverter a decisão.</p><button class="btn sm ghost" type="button" data-dispute="${esc(t.id)}"><i class=yi data-i=shield></i> Levar o caso ao suporte (ID ${esc(t.id)})</button></div>`:""}
 </div>`;
 $("ws").hidden=false;
 document.documentElement.classList.add("ws-lock");
}
/* clicar no card modesto abre a área de trabalho (mouse, toque ou teclado) */
document.addEventListener("click",e=>{
 const card=e.target.closest(".task[data-ws-open]");
 if(!card)return;
 if(e.target.closest("a,[data-copy]"))return;
 openWorkspace(card.dataset.wsOpen);
});
document.addEventListener("keydown",e=>{
 if(e.key!=="Enter"&&e.key!==" ")return;
 const card=e.target.closest?.(".task[data-ws-open]");
 if(!card)return;
 e.preventDefault();
 openWorkspace(card.dataset.wsOpen);
});
/* fechar a área de trabalho: botão ✕, fundo escuro ou tecla Esc */
document.addEventListener("click",e=>{
 if(!$("ws")||$("ws").hidden)return;
 if(e.target===$("ws")||e.target.closest("#ws-close"))closeWorkspace();
});
document.addEventListener("keydown",e=>{
 if(e.key==="Escape"&&$("ws")&&!$("ws").hidden)closeWorkspace();
});
function renderEvents(){
 const evTabs=EC_TABS;
 $("evt-tabs").innerHTML=evTabs.map(([k,ic2,l])=>`<button class="${(ecView==="eventos"?k==="eventos":ecView===k)?"on":""}" data-evttab="${k}"><i class=yi data-i=${ic2}></i><span>${l}</span></button>`).join("");
 if(ecView!=="eventos"){renderEcTab();try{renderOffers()}catch(e){}return}
 const nA=events.filter(e=>e.active!==false&&evState(e)==="active").length;
 const nF=events.filter(e=>e.active!==false&&evState(e)==="future").length;
 const nE=events.filter(e=>e.active!==false&&evState(e)==="ended").length;
 $("evt-stats").hidden=false;
 $("evt-stats").innerHTML=`<div class="ap-kpi"><span class="kl"><i class=yi data-i=checkc></i>Ativos agora</span><b class="green">${nA}</b></div><div class="ap-kpi"><span class="kl"><i class=yi data-i=clock></i>Em breve</span><b class="gold">${nF}</b></div><div class="ap-kpi"><span class="kl"><i class=yi data-i=check></i>Encerrados</span><b>${nE}</b></div><div class="ap-kpi"><span class="kl"><i class=yi data-i=calendar></i>Meus eventos</span><b>${myJoins.size}</b></div>`;
 const evs=events.filter(e=>e.active!==false&&evState(e)===evView);
 let html="";
 html+=`<div class="tabs" style="max-width:420px;margin:0 0 14px">${[["active","Ativos"],["future","Em breve"],["ended","Encerrados"]].map(([v,l])=>`<button data-evttab="${v}" class="${evView===v?"on":""}">${l}</button>`).join("")}</div>`;
 /* linha compacta de tarefa: nome, recompensa e status; a prova é enviada no assistente */
 const taskRow=t=>{
  const c=claims[t.id],st=c?.status,rd=Math.max(0.01,Math.round((Number(t.reward)||0.01)*100)/100),ty=t.ticketType||"common";
  return `<div class="trow"><span class="tn">${esc(t.name)}</span>${st==="approved"?'<span class="tag g">Aprovada</span>':st==="pending"?'<span class="tag y">Em análise</span>':st==="changes"?'<span class="tag y"><i class=yi data-i=edit></i> Correção</span>':st==="rejected"?'<span class="tag r">Rejeitada</span>':`<span class="tag y">+${xcShort(t.rewardCur,rd)}</span>`}</div>`;
 };
 html+=evs.length?evs.map(e=>{
  const tk=Number(e.ticketsOffered)||0;
  const cost=Math.max(0,Math.floor(Number(e.entryCost)||0));
  const dvs=draws.filter(x=>x.eventId===e.id&&x.status!=="draft");
  const aus=auctions.filter(x=>x.eventId===e.id&&x.status!=="draft");
  const ets=evView==="active"?tasksOfEvent(e.id):evView==="future"?tasksOfEvent(e.id).filter(t=>taskState(t)!=="on"):[];
  return `<div class="card evc"><div class="ev-row"><h3>${esc(e.name)}</h3>${tk?`<span class="tag y">+${fmtBRL(tk)}</span>`:""}</div>
  ${e.description?`<p>${esc(e.description)}</p>`:""}
  <p class="mono"><i class=yi data-i=calendar></i> Início: ${fmt(e.startAt)}${e.endAt?" · Termina: "+fmt(e.endAt):""}</p>
  ${e.coupon?`<div class="coupon"><code>${esc(e.coupon)}</code><button class="btn sm ghost" data-copy="${esc(e.coupon)}">Copiar</button></div>`:""}
  <div class="trow"><span class="tn">Sorteios do evento</span>${dvs.length?dvs.map(d=>`<span class="tag y">${esc(d.name)}</span>`).join(" "):'<span class="tag">—</span>'}</div>
  <div class="trow"><span class="tn">Leilões do evento</span>${aus.length?aus.map(a=>`<span class="tag y">${esc(a.name)}</span>`).join(" "):'<span class="tag">—</span>'}</div>
  <div class="trow"><span class="tn">Entrada do evento</span><span class="tag">${cost?fmtBRL(cost):"Gratuita"}</span></div>
  ${evView!=="active"?"":(safeUrl(e.link)?`<div class="actions" style="margin:0"><a class="btn sm" href="${esc(safeUrl(e.link))}" target="_blank" rel="noopener noreferrer">Abrir evento</a></div>`:"")}
  ${evView==="ended"?'<span class="tag">Evento encerrado</span>':evView==="active"?(myJoins.has(e.id)?'<span class="tag g">Entrada confirmada ✓</span>':`<button class="btn sm wide" data-evjoin="${esc(e.id)}">Pagar entrada e participar</button>`):""}
  ${evView!=="active"?"":ets.map(taskRow).join("")+(ets.length?`<button class="more-tasks" data-goassist="1">Fazer tarefas e participar →</button>`:"")}
  </div>`;
 }).join(""):"";
 $("evs").innerHTML=html||`<div class="card evc"><p class="hint">${evView==="active"?"Nenhum evento ativo agora. Volte mais tarde.":evView==="future"?"Nenhum evento futuro por enquanto.":"Nenhum evento encerrado ainda."}</p></div>`;
 renderOffers();
}
$("evs").addEventListener("click",e=>{
 if(e.target.dataset.goassist)goStage(true);
});
/* ═══ CENTRAL DE EVENTOS · gaveta tela cheia ═══ */
function evtOpen(){if(!currentUser||!currentUser.emailVerified){toast("Entre na sua conta para usar a Central de Eventos.");return}$("evtgaveta").classList.add("open");$("evtv").classList.add("open");syncGavLock();ecStartUser();ecStatsSync();renderEvents()}
function evtClose(){$("evtgaveta").classList.remove("open");$("evtv").classList.remove("open");syncGavLock()}
/* ════════════════════════════════════════════════════════════
   CENTRAL DE EVENTOS · desafios, comunidade, ranking, check-in
   Coleções: challenges, challengeClaims, checkins/{uid},
   userStats/{uid}, rooms (+ messages/members), settings/community,
   settings/checkin, settings/ranking
   ════════════════════════════════════════════════════════════ */
let ecView="eventos",ecRkPeriod="week",ecChal=[],ecClaims=new Set(),ecRooms=[],ecRk=[],ecCfgC={},ecCfgK={},ecCfgR={},ecRoom=null,ecMsgs=[],ecRoomUn=null,ecRkUn=null,ecMyCk=null,ecCkUn=null,ecClUn=null,ecHistCache=null,ecHistAt=0,ecLastMsg=0,ecUserOn=false,ecRoomMembers=0;
const EC_TABS=[["eventos","calendar","Eventos"],["sorteios","ticket","Sorteios"],["leiloes","gavel","Leilões"],["desafios","star","Desafios"],["comunidade","users","Comunidade"],["ranking","trophy","Ranking"],["checkin","gift","Check-in"],["historico","clock","Histórico"]];
const EC_METRICS={
 tasks_done:{l:"Tarefas concluídas",k:"reward",u:"tarefas"},
 tickets_earned:{l:"Reais conquistados",k:"$sum",u:"R$"},
 surveys_done:{l:"Pesquisas respondidas",k:"survey_reward",u:"pesquisas"},
 mining_collects:{l:"Coletas de mineração",k:"mining_collect",u:"coletas"},
 events_joined:{l:"Entradas em eventos",k:"event_join",u:"entradas"},
 draws_joined:{l:"Números reservados em sorteios",k:"reserve",u:"reservas"},
 auction_bids:{l:"Lances em leilões",k:"auction_bid",u:"lances"},
 ads_published:{l:"Anúncios publicados",k:"ad_purchase",u:"anúncios"},
 checkins:{l:"Check-ins diários",k:"checkin",u:"check-ins"},
 challenges_done:{l:"Desafios concluídos",k:"challenge_reward",u:"desafios"}
};
const EC_W_DEF={tasks_done:10,tickets_earned:0.05,surveys_done:8,mining_collects:3,events_joined:12,draws_joined:6,auction_bids:4,ads_published:10,checkins:5,challenges_done:20};
const ecW=()=>({...EC_W_DEF,...((ecCfgR.weights&&typeof ecCfgR.weights==="object")?ecCfgR.weights:{})});
const ec2=n=>String(n).padStart(2,"0");
const ecDayK=d=>{const x=new Date(d);return x.getFullYear()+"-"+ec2(x.getMonth()+1)+"-"+ec2(x.getDate())};
const ecWeekK=d=>{const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return ecDayK(x)};
const ecMonthK=d=>{const x=new Date(d);return x.getFullYear()+"-"+ec2(x.getMonth()+1)};
function ecMs(v){return v?.toMillis? v.toMillis():(v?.seconds? v.seconds*1000:0)}
async function ecHist(force){
 if(!currentUser)return[];
 if(!force&&ecHistCache&&Date.now()-ecHistAt<45000)return ecHistCache;
 const s=await getDocs(query(collection(db,"wallets",currentUser.uid,"history"),orderBy("createdAt","desc"),limit(500)));
 ecHistCache=s.docs.map(d=>d.data()).filter(h=>ecMs(h.createdAt));
 ecHistAt=Date.now();
 return ecHistCache;
}
const EC_SKIP_SUM=k=>/^(convert_|market_buy|market_purchase|survey_purchase|collab_fee|ad_purchase|withdraw_request)/.test(k);
function ecCount(list,m){
 if(!m||!m.k)return 0;
 let n=0;
 for(const h of list){
  if(m.k==="$sum"){if(Number(h.amount)>0&&!EC_SKIP_SUM(h.kind))n+=Math.max(0,Math.floor(Number(h.amount)||0))*VAL[h.ticketType||"common"]}
  else if(h.kind===m.k)n++;
 }
 return n;
}
function ecScore(list,w){
 const c={};let s=0;
 for(const [k,m] of Object.entries(EC_METRICS)){c[k]=ecCount(list,m);s+=c[k]*(Number(w[k])||0)}
 return {score:Math.round(s*100)/100,c};
}
async function ecStatsSync(){
 if(!currentUser||!currentUser.emailVerified)return;
 try{
  const list=await ecHist(true);
  const w=ecW();
  const now=Date.now();
  const startDay=new Date();startDay.setHours(0,0,0,0);
  const week=ecWeekK(now),month=ecMonthK(now);
  const dayList=list.filter(h=>ecMs(h.createdAt)>=startDay.getTime());
  const weekList=list.filter(h=>ecWeekK(ecMs(h.createdAt)||now)===week);
  const monthList=list.filter(h=>ecMonthK(ecMs(h.createdAt)||now)===month);
  const a={day:ecScore(dayList,w),week:ecScore(weekList,w),month:ecScore(monthList,w),all:ecScore(list,w)};
  await setDoc(doc(db,"userStats",currentUser.uid),{
   uid:currentUser.uid,name:profile?.name||"",photoMode:profile?.photoMode||"",
   updatedAt:serverTimestamp(),
   dayScore:a.day.score,dayKey:ecDayK(now),dayC:a.day.c,
   weekScore:a.week.score,weekKey:week,weekC:a.week.c,
   monthScore:a.month.score,monthKey:month,monthC:a.month.c,
   allScore:a.all.score,allC:a.all.c
  },{merge:true});
 }catch(e){console.warn("Ranking sync:",e)}
}
/* watchers públicos (uma única vez) */
onSnapshot(collection(db,"challenges"),s=>{ecChal=s.docs.map(d=>({id:d.id,...d.data()}));if($("evtgaveta").classList.contains("open"))renderEvents()},e=>console.warn("Desafios:",e));
onSnapshot(query(collection(db,"rooms"),orderBy("createdAt","desc"),limit(60)),s=>{ecRooms=s.docs.map(d=>({id:d.id,...d.data()}));if($("evtgaveta").classList.contains("open")&&ecView==="comunidade")renderEvents()},e=>console.warn("Salas:",e));
onSnapshot(doc(db,"settings","community"),d=>{ecCfgC=d.exists()?d.data():{}},e=>console.warn("Comunidade:",e));
onSnapshot(doc(db,"settings","checkin"),d=>{ecCfgK=d.exists()?d.data():{};if($("evtgaveta").classList.contains("open")&&ecView==="checkin")renderEvents()},e=>console.warn("Check-in:",e));
onSnapshot(doc(db,"settings","ranking"),d=>{ecCfgR=d.exists()?d.data():{}},e=>console.warn("Ranking:",e));
/* watchers por usuário (abrem junto com a Central) */
function ecStartUser(){
 if(ecUserOn||!currentUser||!currentUser.emailVerified)return;
 ecUserOn=true;
 ecCkUn=onSnapshot(doc(db,"checkins",currentUser.uid),d=>{ecMyCk=d.exists()?d.data():null;if($("evtgaveta").classList.contains("open")&&ecView==="checkin")renderEvents()},e=>console.warn("Check-in doc:",e));
 ecClUn=onSnapshot(query(collection(db,"challengeClaims"),where("uid","==",currentUser.uid),limit(200)),s=>{ecClaims=new Set(s.docs.map(d=>d.data().challengeId));if($("evtgaveta").classList.contains("open")&&ecView==="desafios")renderEvents()},e=>console.warn("Desafios meus:",e));
 ecRkSubscribe();
}
function ecRkSubscribe(){
 if(ecRkUn)try{ecRkUn()}catch(e){}
 ecRkUn=onSnapshot(query(collection(db,"userStats"),orderBy(ecRkPeriod+"Score","desc"),limit(100)),s=>{ecRk=s.docs.map(d=>({id:d.id,...d.data()}));if($("evtgaveta").classList.contains("open")&&ecView==="ranking")renderEvents()},e=>console.warn("Ranking:",e));
}
function ecStop(){
 ecUserOn=false;
 [ecCkUn,ecClUn,ecRkUn,ecRoomUn].forEach(f=>{try{f&&f()}catch(e){}});
 ecCkUn=ecClUn=ecRkUn=ecRoomUn=null;
 ecRoom=null;ecMsgs=[];ecMyCk=null;ecClaims=new Set();ecRk=[];ecHistCache=null;
}
/* ── check-in diário ── */
async function ecCheckinGo(){
 if(!currentUser||!currentUser.emailVerified){toast("Entre na sua conta para fazer o check-in.");return}
 const cfg=ecCfgK||{};
 if(cfg.enabled===false){toast("O check-in diário está desativado agora.");return}
 const today=ecDayK(Date.now());
 if(ecMyCk?.lastDate===today){toast("O check-in de hoje já foi feito ✓");return}
 const type=["common","gold","vip"].includes(cfg.ticketType)?cfg.ticketType:"common";
 const base=Math.max(0,Number(cfg.reward)||10);
 try{await vipSync(true)}catch(e){}   /* status VIP fresco antes de dobrar a recompensa */
 try{
  const r=await runTransaction(db,async tx=>{
   const ref=doc(db,"checkins",currentUser.uid);
   const s=await tx.get(ref);
   const d=s.exists()?s.data():{};
   if(d.lastDate===today)return null;
   const yk=ecDayK(Date.now()-864e5);
   const streak=d.lastDate===yk?(d.streak||0)+1:1;
   const sb=(cfg.streakBonus&&typeof cfg.streakBonus==="object")?cfg.streakBonus:{};
   const bonus=Math.max(0,Math.floor(Number(sb[String(streak)])||0));
   let tot=base+bonus;
   const vip=vipMe?.vip===true;
   if(vip)tot=tot*2;   /* benefício VIP: recompensa do check-in em dobro */
   const hist=Array.isArray(d.history)?d.history.slice(-29):[];hist.push(today);
   tx.set(ref,{lastDate:today,streak,best:Math.max(streak,d.best||0),total:(d.total||0)+1,history:hist,updatedAt:serverTimestamp()},{merge:true});
   if(tot>0){
    tx.set(doc(db,"wallets",currentUser.uid),{[type]:increment(tot),updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"checkin",amount:tot,ticketType:type,reason:"Check-in diário da Central de Eventos"+(bonus?" · bônus de sequência incluído":"")+(vip?" · VIP: recompensa em dobro <i class=yi data-i=star></i>":"")+" <i class=yi data-i=calendar></i>",createdAt:serverTimestamp()});
   }
   return {tot,streak,bonus,vip};
  });
  if(!r){toast("O check-in de hoje já foi feito ✓");return}
  ecHistCache=null;
  toast("Check-in feito! +"+fmtBRL(r.tot)+" creditados."+(r.bonus?" Bônus de sequência: +"+r.bonus+".":"")+(r.vip?" Membro VIP: recompensa dobrada":""));
  ecStatsSync();renderEvents();
 }catch(e){console.error(e);toast("Não foi possível fazer o check-in agora.")}
}
/* ── desafios: progresso + resgate ── */
async function ecFillProg(){
 const el=document.querySelector("[data-ecprog]");
 if(!el)return;
 const list=await ecHist();
 document.querySelectorAll("[data-ecprog]").forEach(el=>{
  const ch=ecChal.find(c=>c.id===el.dataset.ecprog);
  if(!ch)return;
  const n=ecCount(list,EC_METRICS[ch.metric]||{k:ch.kind});
  const goal=Math.max(1,Number(ch.goal)||1);
  const p=Math.min(100,Math.round(n/goal*100));
  el.innerHTML=`<div class="ec-prog"><i style="width:${p}%"></i></div><small class="hint">${n} / ${goal} ${esc((EC_METRICS[ch.metric]||{}).u||"")} · ${p}%</small>`;
  const btn=document.querySelector('[data-ecclaim="'+ch.id+'"]');
  if(btn)btn.hidden=n<goal;
 });
}
async function ecClaimGo(cid){
 const ch=ecChal.find(c=>c.id===cid);
 if(!ch)return;
 if(ecClaims.has(cid)){toast("Você já resgatou a recompensa deste desafio.");return}
 const now=Date.now();
 if(ch.startAt&&ecMs(ch.startAt)>now){toast("Este desafio ainda não começou.");return}
 if(ch.endAt&&ecMs(ch.endAt)<now){toast("Este desafio já foi encerrado.");return}
 const goal=Math.max(1,Number(ch.goal)||1);
 const list=await ecHist(true);
 const n=ecCount(list,EC_METRICS[ch.metric]||{});
 if(n<goal){toast("Você ainda não atingiu o objetivo ("+n+"/"+goal+").");return}
 if(ch.maxParticipants&&Number(ch.maxParticipants)>0){
  try{const cs=await getDocs(query(collection(db,"challengeClaims"),where("challengeId","==",cid)));
   if(cs.size>=Number(ch.maxParticipants)){toast("O limite de participantes deste desafio foi atingido.");return}}catch(e){}
 }
 const id=cid+"_"+currentUser.uid;
 const rw=Math.max(0,Number(ch.reward)||0),ty=["common","gold","vip"].includes(ch.ticketType)?ch.ticketType:"common";
 try{
  await runTransaction(db,async tx=>{
   const ref=doc(db,"challengeClaims",id);
   const s=await tx.get(ref);
   if(s.exists())return;
   tx.set(ref,{challengeId:cid,uid:currentUser.uid,name:profile?.name||"",metric:ch.metric,goal,progress:n,reward:rw,ticketType:ty,createdAt:serverTimestamp()});
   if(rw>0){
    tx.set(doc(db,"wallets",currentUser.uid),{[ty]:increment(rw),updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"challenge_reward",amount:rw,ticketType:ty,reason:"Desafio concluído: "+(ch.name||"")+" <i class=yi data-i=trophy></i>",createdAt:serverTimestamp()});
   }
  });
  ecClaims.add(cid);ecHistCache=null;
  toast("Desafio concluído! +"+fmtBRL(rw)+" creditados.");
  ecStatsSync();renderEvents();
 }catch(e){console.error(e);toast("Não foi possível resgatar agora.")}
}
/* ── comunidade: salas de conversa em tempo real ── */
async function ecRoomCreate(){
 if(!currentUser)return;
 if(ecCfgC.allowCreate===false){toast("A criação de salas está desativada pelo organizador.");return}
 const name=($("ec-room-name")?.value||"").trim();
 if(name.length<3){toast("Dê um nome com pelo menos 3 letras.");return}
 const mine=ecRooms.filter(r=>r.uid===currentUser.uid).length;
 const mx=Math.max(1,Number(ecCfgC.maxRoomsPerUser)||3);
 if(mine>=mx){toast("Você já criou o limite de "+mx+" sala(s).");return}
 try{
  await addDoc(collection(db,"rooms"),{name:name.slice(0,40),desc:($("ec-room-desc")?.value||"").trim().slice(0,140),uid:currentUser.uid,ownerName:profile?.name||"Membro",active:true,createdAt:serverTimestamp()});
  $("ec-room-name").value="";$("ec-room-desc").value="";
  toast("Sala criada! Ela já aparece na lista.");
 }catch(e){console.error(e);toast("Não foi possível criar a sala agora.")}
}
function ecRoomOpen(id){
 const r=ecRooms.find(x=>x.id===id);
 if(!r)return;
 if(r.active===false){toast("Esta sala foi desativada pelo organizador.");return}
 ecRoom=r;ecRoomMembers=0;
 getCountFromServer(collection(db,"rooms",id,"members")).then(c=>{if(ecRoom?.id===id){ecRoomMembers=c.data().count;if($("evtgaveta").classList.contains("open")&&ecView==="comunidade")renderEvents()}}).catch(()=>{});
 try{setDoc(doc(db,"rooms",id,"members",currentUser.uid),{name:profile?.name||"Membro",joinedAt:serverTimestamp()},{merge:true})}catch(e){}
 if(ecRoomUn)try{ecRoomUn()}catch(e){}
 ecRoomUn=onSnapshot(query(collection(db,"rooms",id,"messages"),orderBy("createdAt","asc"),limit(120)),s=>{ecMsgs=s.docs.map(d=>({id:d.id,...d.data()}));if($("evtgaveta").classList.contains("open")&&ecView==="comunidade")renderEvents()},e=>console.warn("Mensagens:",e));
 renderEvents();
}
function ecRoomBack(){if(ecRoomUn)try{ecRoomUn()}catch(e){}ecRoomUn=null;ecRoom=null;ecMsgs=[];ecRoomMembers=0;renderEvents()}
async function ecRoomDelete(id){
 const r=ecRooms.find(x=>x.id===id);
 if(!r)return;
 if(r.uid!==currentUser.uid){toast("Só quem criou a sala pode apagá-la.");return}
 if(!confirm('Apagar a sala "'+(r.name||"")+'" e todo o histórico de mensagens?'))return;
 try{
  const ms=await getDocs(collection(db,"rooms",id,"messages"));
  const batch=writeBatch(db);
  ms.docs.forEach(d=>batch.delete(d.ref));
  batch.delete(doc(db,"rooms",id));
  await batch.commit();
  if(ecRoom?.id===id)ecRoomBack();
  toast("Sala apagada.");
 }catch(e){toast("Não foi possível apagar a sala agora.")}
}
async function ecMsgSend(){
 if(!ecRoom||!currentUser)return;
 const inp=$("ec-msg-in");
 const text=(inp?.value||"").trim();
 if(!text)return;
 const now=Date.now();
 if(now-ecLastMsg<1500){toast("Aguarde um instante entre mensagens.");return}
 if(text.length>500){toast("Mensagem muito longa (máx. 500 caracteres).");return}
 ecLastMsg=now;
 if(inp)inp.value="";
 try{
  const msgRef=await addDoc(collection(db,"rooms",ecRoom.id,"messages"),{uid:currentUser.uid,name:profile?.name||"Membro",text,createdAt:serverTimestamp()});
  /* espelho da última mensagem na sala: a lista mostra a prévia sem ler as mensagens */
  await updateDoc(doc(db,"rooms",ecRoom.id),{lastMsg:text.slice(0,80),lastAt:serverTimestamp(),lastBy:profile?.name||"Membro",updatedAt:serverTimestamp()}).catch(()=>{});
  const chat=$("ec-chat");if(chat)chat.scrollTop=chat.scrollHeight;
 }catch(e){toast("Não foi possível enviar agora.")}
}
/* ── badges do ranking ── */
function ecBadges(sc){
 const b=[];
 if(sc>=1000)b.push("Lenda");
 if(sc>=400)b.push("Veterano");
 if(sc>=100)b.push("Dedicado");
 if(sc>=20)b.push("Ativo");
 return b;
}
/* ── render das abas da Central (não-eventos) ── */
function renderEcTab(){
 const body=$("evs"),stats=$("evt-stats");
 const st=arr=>arr.map(([l,v,c])=>`<div class="ap-kpi"><span class="kl">${l}</span><b class="${c||""}">${v}</b></div>`).join("");
 /* sorteios */
 if(ecView==="sorteios"){
  const ds=draws.filter(d=>d.status!=="draft");
  const myRes=currentUser?resvAll.filter(x=>x.uid===currentUser.uid).length:0;
  stats.innerHTML=st([["<i class=yi data-i=ticket></i> Sorteios abertos",ds.filter(d=>d.status==="open").length,"green"],["<i class=yi data-i=ticket></i> Meus números",myRes,"gold"],["<i class=yi data-i=ticket></i> Total",ds.length,""]]);
  body.innerHTML=`<div class="ec-quick">${ds.filter(d=>d.status==="open").slice(0,8).map(d=>`
   <div class="ec-chal"><b>${esc(d.name||"Sorteio")}</b>
   <small class="hint">${esc(d.description||"").slice(0,90)}</small>
   <span class="tag ${d.status==="open"?"g":""}">${d.status==="open"?"Aberto":d.status==="ended"?"Encerrado":esc(d.status)}</span>
   <small class="hint">Meus números: ${currentUser?resvAll.filter(x=>x.drawId===d.id&&x.uid===currentUser.uid).length:0}</small>
   <button class="btn sm wide" data-ecgo="sorteios">Ver na página de sorteios →</button></div>`).join("")||'<p class="hint">Nenhum sorteio aberto agora.</p>'}</div>`;
  return;
 }
 /* leilões */
 if(ecView==="leiloes"){
  const as=auctions.filter(a=>a.status!=="draft");
  const myBids=currentUser?bidsArr.filter(b=>b.uid===currentUser.uid).length:0;
  stats.innerHTML=st([["<i class=yi data-i=gavel></i> Leilões abertos",as.filter(a=>a.status==="active").length,"green"],["<i class=yi data-i=gavel></i> Meus lances",myBids,"gold"],["<i class=yi data-i=gavel></i> Total",as.length,""]]);
  body.innerHTML=`<div class="ec-quick">${as.slice(0,8).map(a=>`
   <div class="ec-chal"><b>${esc(a.name||"Leilão")}</b>
   <small class="hint">${esc(a.description||"").slice(0,90)}</small>
   <span class="tag ${a.status==="active"?"g":""}">${a.status==="active"?"Aberto":a.status==="ended"?"Encerrado":esc(a.status)}</span>
   <button class="btn sm wide" data-ecgo="leiloes">Ver leilões →</button></div>`).join("")||'<p class="hint">Nenhum leilão por aqui.</p>'}</div>`;
  return;
 }
 /* desafios */
 if(ecView==="desafios"){
  const now=Date.now();
  const vis=ecChal.filter(c=>c.visible!==false);
  const act=vis.filter(c=>(!c.startAt||ecMs(c.startAt)<=now)&&(!c.endAt||ecMs(c.endAt)>=now));
  stats.innerHTML=st([["<i class=yi data-i=star></i> Desafios ativos",act.length,"green"],["<i class=yi data-i=star></i> Concluídos por você",ecClaims.size,"gold"],["<i class=yi data-i=star></i> Total",vis.length,""]]);
  body.innerHTML=vis.length?vis.map(c=>{
   const s=(!c.startAt||ecMs(c.startAt)<=now)&&(!c.endAt||ecMs(c.endAt)>=now);
   const done=ecClaims.has(c.id);
   const m=EC_METRICS[c.metric]||{l:c.metric,u:""};
   return `<div class="ec-chal">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(c.name||"Desafio")}</b><span class="tag ${done?"g":s?"y":""}">${done?"Concluído ✓":s?"Ativo":"Encerrado"}</span></div>
    ${c.description?`<small class="hint">${esc(c.description)}</small>`:""}
    <small><b>Objetivo:</b> ${esc(m.l)} — ${Math.max(1,Number(c.goal)||1)} ${esc(m.u)}</small>
    <small class="hint"><i class=yi data-i=calendar></i> ${c.startAt?fmt(c.startAt):"—"} até ${c.endAt?fmt(c.endAt):"—"}${c.maxParticipants?" · limite: "+c.maxParticipants+" participantes":""}</small>
    <small><b>Recompensa:</b> +${fmtBRL(Math.max(0,Number(c.reward)||0))}</small>
    ${c.rules?`<small class="hint">${esc(c.rules)}</small>`:""}
    ${done?'<span class="tag g">Recompensa já creditada ✓</span>':`<div data-ecprog="${esc(c.id)}"><div class="ec-prog"><i style="width:0%"></i></div><small class="hint">Calculando…</small></div>
    <button class="btn sm" data-ecclaim="${esc(c.id)}" hidden>Resgatar recompensa →</button>`}
   </div>`;
  }).join(""):'<p class="hint">Nenhum desafio no momento. O organizador cria os desafios no painel.</p>';
  ecFillProg();
  return;
 }
 /* comunidade */
 if(ecView==="comunidade"){
  if(ecRoom){
   const mine=uid=>uid===currentUser.uid;
   const isOwner=ecRoom.uid===currentUser.uid;
   const canDel=m=>mine(m.uid)||isOwner;
   /* separadores de dia: marca quando a conversa pula de um dia para outro */
   let lastDay="";
   const chatHtml=ecMsgs.map(m=>{
    const d=stampMs(m.createdAt)?ecDayK(stampMs(m.createdAt)):"";
    const sep=d&&d!==lastDay?`<div class="ec-day"><span>${d.split("-").reverse().join("/")}</span></div>`:"";
    if(d)lastDay=d;
    return sep+`<div class="ec-msg ${mine(m.uid)?"me":""}"><b>${esc(m.name||"Membro")}${m.uid===ecRoom.uid?' <i class=yi data-i=star title="Dono da sala"></i>':""}</b><span>${esc(m.text||"")}</span><small>${fmt(m.createdAt)}</small>${canDel(m)?`<button class="del" data-ecmsgdel="${esc(m.id)}">apagar</button>`:""}</div>`;
   }).join("");
   stats.innerHTML=st([["<i class=yi data-i=users></i> Membros",ecRoomMembers||"—","green"],["<i class=yi data-i=chat></i> Mensagens",ecMsgs.length,"gold"]]);
   body.innerHTML=`<div class="ec-chal">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
     <div><b>${esc(ecRoom.name||"Sala")}</b><small class="hint" style="display:block">Criada por ${esc(ecRoom.ownerName||"—")} · ${ecRoomMembers||"—"} membro(s) · conversa em tempo real</small></div>
     <button class="btn sm ghost" data-ecroomback="1">‹ Voltar às salas</button>
    </div>
    ${isOwner?'<small class="hint"><i class=yi data-i=shield></i> Você é o dono da sala: pode apagar qualquer mensagem (moderação).</small>':""}
    <div class="ec-chat" id="ec-chat">${chatHtml||'<p class="hint">Nenhuma mensagem ainda — seja o primeiro a puxar assunto!</p>'}</div>
    <div style="display:flex;gap:8px"><input id="ec-msg-in" maxlength="500" placeholder="Escreva uma mensagem…"><button class="btn" data-ecsend="1">Enviar</button></div>
   </div>`;
   const chat=$("ec-chat");if(chat)chat.scrollTop=chat.scrollHeight;
   return;
  }
  const allow=ecCfgC.allowCreate!==false;
  const mine=currentUser?ecRooms.filter(r=>r.uid===currentUser.uid).length:0;
  const mx=Math.max(1,Number(ecCfgC.maxRoomsPerUser)||3);
  stats.innerHTML=st([["<i class=yi data-i=users></i> Salas ativas",ecRooms.filter(r=>r.active!==false).length,"green"],["<i class=yi data-i=chat></i> Minhas salas",mine+"/"+mx,"gold"]]);
  body.innerHTML=(allow?`<div class="ec-chal"><b><i class=yi data-i=chat></i> Criar uma sala de conversa</b>
   <input id="ec-room-name" maxlength="40" placeholder="Nome da sala (ex.: Fãs de sorteios)">
   <input id="ec-room-desc" maxlength="140" placeholder="Descrição (opcional)">
   <button class="btn sm" data-ecnewroom="1">Criar sala</button></div>`:'<p class="hint">A criação de salas está desativada pelo organizador. Você ainda pode entrar nas salas existentes.</p>')+
  (ecRooms.filter(r=>r.active!==false).sort((a,b)=>(stampMs(b.lastAt)||0)-(stampMs(a.lastAt)||0)).map(r=>`<div class="ec-hrow">
   <div style="flex:1 1 180px;min-width:0"><b>${esc(r.name||"Sala")}${r.uid===currentUser?.uid?' <i class=yi data-i=star title="Sua sala"></i>':""}</b>${r.desc?`<small class="hint" style="display:block">${esc(r.desc)}</small>`:""}
   ${r.lastMsg?`<small class="hint" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><i class=yi data-i=chat></i> ${esc(r.lastBy||"")}: ${esc(r.lastMsg)}</small>`:""}</div>
   <small class="hint">${r.lastAt?fmt(r.lastAt):"criada "+fmt(r.createdAt)}</small>
   <button class="btn sm" data-ecroom="${esc(r.id)}">Entrar e conversar →</button>
   ${r.uid===currentUser?.uid?`<button class="btn sm danger" data-ecroomdel="${esc(r.id)}">Apagar</button>`:""}
  </div>`).join("")||'<p class="hint">Nenhuma sala ainda. Crie a primeira e chame os amigos!</p>');
  return;
 }
 /* ranking */
 if(ecView==="ranking"){
  if(ecCfgR.enabled===false){
   stats.innerHTML="";body.innerHTML='<p class="hint">O ranking está desativado pelo organizador agora.</p>';return;
  }
  const P={day:"Diário",week:"Semanal",month:"Mensal",all:"Geral"};
  stats.innerHTML=st([["<i class=yi data-i=trophy></i> Período",P[ecRkPeriod]||"—","gold"],["<i class=yi data-i=trophy></i> Membros no ranking",ecRk.length,"green"]]);
  body.innerHTML=`<div class="tabs" style="max-width:420px;margin:0 0 14px">${Object.entries(P).map(([k,l])=>`<button data-ecrkp="${k}" class="${ecRkPeriod===k?"on":""}">${l}</button>`).join("")}</div>`+
  (ecRk.map((u,i)=>{
   const sc=Number(u[(ecRkPeriod!=="all"?ecRkPeriod:"all")+"Score"]||u.allScore||0);
   const c=(u[(ecRkPeriod!=="all"?ecRkPeriod:"all")+"C"]||u.allC||{});
   const top=Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${v} ${(EC_METRICS[k]||{l:k}).l}`).join(" · ");
   const me=currentUser&&u.uid===currentUser.uid;
   return `<div class="ec-rk ${me?"me":""}"><span class="pos">${i+1}º</span>
    <span class="nm"><b>${me?"Você":esc(maskName(u.name||"Membro"))}</b><small class="hint" style="display:block">${esc(top||"—")}</small></span>
    <span class="sc">${String(Math.round(sc*100)/100).replace(".",",")} pts</span>
    <span class="bd">${ecBadges(sc).map(b=>`<em>${b}</em>`).join("")}</span>
   </div>`;
  }).join("")||'<p class="hint">O ranking ainda está se formando — participe de eventos, desafios e check-ins para pontuar.</p>');
  return;
 }
 /* check-in */
 if(ecView==="checkin"){
  const cfg=ecCfgK||{};
  const off=cfg.enabled===false;
  const type=["common","gold","vip"].includes(cfg.ticketType)?cfg.ticketType:"common";
  const base=Math.max(0,Number(cfg.reward)||10);
  const today=ecDayK(Date.now());
  const doneToday=ecMyCk?.lastDate===today;
  const hist=Array.isArray(ecMyCk?.history)?ecMyCk.history:[];
  const last7=[];for(let i=6;i>=0;i--)last7.push(ecDayK(Date.now()-i*864e5));
  stats.innerHTML=st([["<i class=yi data-i=gift></i> Sequência atual",ecMyCk?.streak||0,"gold"],["<i class=yi data-i=gift></i> Melhor sequência",ecMyCk?.best||0,"green"],["<i class=yi data-i=gift></i> Check-ins totais",ecMyCk?.total||0,""]]);
  body.innerHTML=off?'<p class="hint">O check-in diário está desativado pelo organizador agora.</p>':`
  <div class="ec-chal">
   <b><i class=yi data-i=gift></i> Check-in diário</b>
   <small>Ganhe <b>${fmtBRL(base)}</b> por dia de check-in. Conquistando sequências você ganha bônus extras configurados pelo organizador.</small>
   <div class="ec-streak">${last7.map(d=>`<b class="${hist.includes(d)?"hit":""}" title="${d}">${d.slice(-2)}</b>`).join("")}</div>
   ${doneToday?'<span class="tag g">Check-in de hoje feito ✓ — volte amanhã!</span>':'<button class="btn" data-ecck="1">Fazer check-in de hoje →</button>'}
   <small class="hint">Só é possível fazer um check-in por dia. A sequência cresce quando você volta dia após dia, sem pular.</small>
  </div>`;
  return;
 }
 /* histórico de participações */
 if(ecView==="historico"){
  const uid=currentUser?.uid;
  const myRes=uid?resvAll.filter(x=>x.uid===uid):[];
  const myBid=uid?bidsArr.filter(x=>x.uid===uid):[];
  const myEv=uid?[...myJoins].map(id=>events.find(e=>e.id===id)).filter(Boolean):[];
  const myHist=uid?history.filter(h=>["event_join","reserve","auction_bid","checkin","challenge_reward"].includes(h.kind)).slice(0,30):[];
  stats.innerHTML=st([["<i class=yi data-i=ticket></i> Sorteios",myRes.length,"gold"],["<i class=yi data-i=gavel></i> Lances",myBid.length,"green"],["<i class=yi data-i=calendar></i> Eventos",myEv.length,""]]);
  body.innerHTML=
  `<div class="ec-chal"><b><i class=yi data-i=calendar></i> Eventos que eu entrei</b>${myEv.map(e=>`<div class="ec-hrow"><span>${esc(e.name||"—")}</span><small class="hint">${fmt(e.startAt)}</small></div>`).join("")||'<small class="hint">Nenhuma entrada em evento ainda.</small>'}</div>
  <div class="ec-chal"><b><i class=yi data-i=ticket></i> Meus números de sorteio</b>${myRes.slice(0,30).map(x=>`<div class="ec-hrow"><span>Nº ${Number(x.number)+1} · ${esc(x.drawName||x.drawId||"")}</span><small class="hint">${fmt(x.createdAt)}</small></div>`).join("")||'<small class="hint">Nenhum número reservado ainda.</small>'}</div>
  <div class="ec-chal"><b><i class=yi data-i=gavel></i> Meus lances em leilões</b>${myBid.slice(0,30).map(x=>`<div class="ec-hrow"><span>${esc(x.auctionName||x.auctionId||"Leilão")}</span><small class="hint">${fmt(x.createdAt)}</small></div>`).join("")||'<small class="hint">Nenhum lance ainda.</small>'}</div>
  <div class="ec-chal"><b><i class=yi data-i=clock></i> Atividades recentes da Central</b>${myHist.map(h=>`<div class="ec-hrow"><span>${esc((HKIND[h.kind]||[h.kind])[0])}</span><small class="hint">${fmt(h.createdAt)}</small></div>`).join("")||'<small class="hint">Sua atividade na Central aparece aqui.</small>'}</div>`;
  return;
 }
 body.innerHTML='<p class="hint">Seção indisponível.</p>';
}
/* delegação de cliques da Central */
document.addEventListener("click",e=>{
 const rkp=e.target.closest("[data-ecrkp]");
 if(rkp){ecRkPeriod=rkp.dataset.ecrkp;ecRkSubscribe();renderEvents();return}
 if(e.target.closest("[data-ecck]")){ecCheckinGo();return}
 const cl=e.target.closest("[data-ecclaim]");
 if(cl){ecClaimGo(cl.dataset.ecclaim);return}
 const go=e.target.closest("[data-ecgo]");
 if(go){evtClose();const el=document.getElementById(go.dataset.ecgo);if(el)el.scrollIntoView({behavior:"smooth"});return}
 if(e.target.closest("[data-ecnewroom]")){ecRoomCreate();return}
 const ent=e.target.closest("[data-ecroom]");
 if(ent){ecRoomOpen(ent.dataset.ecroom);return}
 if(e.target.closest("[data-ecroomback]")){ecRoomBack();return}
 if(e.target.closest("[data-ecsend]")){ecMsgSend();return}
 const del=e.target.closest("[data-ecmsgdel]");
 if(del&&ecRoom){deleteDoc(doc(db,"rooms",ecRoom.id,"messages",del.dataset.ecmsgdel)).catch(()=>toast("Não foi possível apagar."));return}
 const rd=e.target.closest("[data-ecroomdel]");
 if(rd){ecRoomDelete(rd.dataset.ecroomdel);return}
});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target&&e.target.id==="ec-msg-in"){e.preventDefault();ecMsgSend()}});
/* ════════════════════════════════════════════════════════════
   CENTRAL DE ENGAJAMENTO COLETIVO · grupos colaborativos em fila
   Coleções (compatíveis com a Central de Engajamento Coletivo antiga):
   affGroups, affGroups/{id}/members/{uid},
   affGroups/{id}/proofs/{cycleKey}_{uid}, affProofs (espelho),
   settings/affiliate
   Modelo:
   · Cada grupo tem categoria + subcategoria, limite de membros,
     horário de funcionamento e modelo de tempo (automático ou
     personalizado: tempo de oportunidade + tempo de colaboração).
   · A fila é reorganizada 1x por ciclo (dia) com aleatoriedade
     EQUILIBRADA: quem fez a última rodada há mais tempo sobe.
   · Rodada = participante da vez publica o link (tempo de
     oportunidade) e os demais colaboram e enviam prova (tempo de
     colaboração). Atraso desce para o fim da fila; ausência marca
     o estado. Pausa justificada não é penalizada.
   · O ciclo é calculado de forma preguiçosa (lazy) na primeira
     leitura do dia — ninguém perde a posição ao atualizar a página.
   ════════════════════════════════════════════════════════════ */
let affTab="como",affGroups=[],affCfg={},affActive=null,affMembers=[],affMemUn=null,affMyProofs=[],affProofUn=null,affHist=[],affHistUn=null;
const AFF_PLAT={facebook:"Facebook",instagram:"Instagram",tiktok:"TikTok",whatsapp:"WhatsApp/Telegram",youtube:"YouTube",outro:"Outro lugar"};
const ENG_CATS={
 facebook:{label:"Facebook",subs:{share:"Compartilhamento de publicações",page:"Divulgação de páginas",video:"Divulgação de vídeos"}},
 instagram:{label:"Instagram",subs:{share:"Compartilhamento de publicações",reels:"Divulgação de Reels"}},
 tiktok:{label:"TikTok",subs:{share:"Compartilhamento de vídeos"}},
 youtube:{label:"YouTube",subs:{video:"Divulgação de vídeos",channel:"Divulgação de canais"}},
 sites:{label:"Sites",subs:{page:"Divulgação de páginas",article:"Divulgação de artigos"}},
 outro:{label:"Outra",subs:{geral:"Engajamento geral"}}
};
const engCatLabel=c=>ENG_CATS[c]?.label||"Geral";
const engSubLabel=(c,s)=>ENG_CATS[c]?.subs?.[s]||"";
const ENG_TABS=[["como","help","Como funciona"],["explorar","search","Explorar grupos"],["meus","users","Meus grupos"],["criar","star","Criar grupo"],["fila","list","Minha fila"],["rodadas","refresh","Rodadas"],["hist","clock","Histórico"],["ferramentas","toolbox","Ferramentas"]];
const engDef=()=>({enabled:true,allowCreate:true,defaultMax:100,defaultShares:10,defaultOpp:2,defaultCollab:30,defaultTol:10});
const pad2=n=>String(n).padStart(2,"0");
const engToday=()=>{const d=new Date();return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate())};
const engHHMM=d=>pad2(d.getHours())+":"+pad2(d.getMinutes());
/* grupo aberto agora? (horário de funcionamento) */
function engOpenNow(g){
 const sh=Number(g.startHour),eh=Number(g.endHour);
 if(!Number.isFinite(sh)||!Number.isFinite(eh))return true;
 const h=new Date().getHours();
 return sh<=eh?(h>=sh&&h<eh):(h>=sh||h<eh);
}
const engStates={ativo:["Ativo","g"],disponivel:["Disponível","g"],ocupado:["Em rodada","y"],pausado:["Pausado","y"],pendente:["Pendente","y"],ausente:["Ausente","r"],suspenso:["Suspenso","r"]};
const engStateTag=s=>{const e=engStates[s||"ativo"]||engStates.ativo;return `<span class="tag ${e[1]}">${e[0]}</span>`};
function engScheduleTxt(g){
 const sh=Number(g.startHour),eh=Number(g.endHour);
 if(!Number.isFinite(sh)||!Number.isFinite(eh))return"24 horas";
 return pad2(sh)+":00 às "+pad2(eh)+":00";
}
function engTimeModeTxt(g){
 const opp=Math.max(1,Number(g.oppMin)||2),col=Math.max(1,Number(g.collabMin)||30);
 return (g.timeMode==="custom"?"Personalizado":"Automático")+" · "+opp+" min de oportunidade + "+col+" min de colaboração";
}
/* relógio da rodada (contagem regressiva) */
function engCountdown(ms){
 if(!ms||ms<=Date.now())return"encerrado";
 const s=Math.max(0,Math.floor((ms-Date.now())/1000)),m=Math.floor(s/60);
 return m>=60?Math.floor(m/60)+"h "+(m%60)+"min":(m?m+"min ":"")+s%60+"s";
}
onSnapshot(collection(db,"affGroups"),s=>{affGroups=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(stampMs(b.createdAt)||0)-(stampMs(a.createdAt)||0));if($("affgaveta").classList.contains("open"))affRender()},e=>console.warn("Engajamento:",e));
onSnapshot(doc(db,"settings","affiliate"),d=>{affCfg=d.exists()?d.data():{}},e=>console.warn("Engajamento cfg:",e));
function affOpen(){
 if(affCfg.enabled===false){toast("A Central de Engajamento Coletivo está desativada agora.");return}
 if(!currentUser||!currentUser.emailVerified){toast("Entre na sua conta para usar a Central de Engajamento Coletivo.");return}
 $("affgaveta").classList.add("open");$("affv").classList.add("open");syncGavLock();affRender();
}
function affClose(){$("affgaveta").classList.remove("open");$("affv").classList.remove("open");syncGavLock();if(affHistUn){try{affHistUn()}catch(e){}affHistUn=null}}
function affStop(){if(affMemUn)try{affMemUn()}catch(e){}if(affProofUn)try{affProofUn()}catch(e){}if(affHistUn)try{affHistUn()}catch(e){}affMemUn=affProofUn=affHistUn=null;affActive=null;affMembers=[];affMyProofs=[];affHist=[]}
$("aff-x").onclick=affClose;
const affMyIds=()=>Array.isArray(profile?.affGroups)?profile.affGroups:[];
function affRender(){
 const b=$("aff-body"),st=$("aff-stats");
 $("aff-tabs").innerHTML=ENG_TABS.map(([k,ic,l])=>`<button class="${affTab===k?"on":""}" data-afftab="${k}">${ico(ic,17)}<span>${l}</span></button>`).join("");
 const st2=arr=>arr.map(([l,v,c])=>`<div class="ap-kpi"><span class="kl">${l}</span><b class="${c||""}">${v}</b></div>`).join("");
 const cfg={...engDef(),...affCfg};
 const act=affGroups.filter(g=>g.active!==false);
 const totM=act.reduce((s,g)=>s+(Number(g.membersCount)||0),0);
 const totC=act.reduce((s,g)=>s+(Number(g.cycles)||0),0);
 st.hidden=false;
 /* ── COMO FUNCIONA ── */
 if(affTab==="como"){
  st.innerHTML=st2([["<i class=yi data-i=users></i> Grupos ativos",act.length,"green"],["<i class=yi data-i=users></i> Participantes",totM,"gold"],["<i class=yi data-i=refresh></i> Rodadas concluídas",totC,""]]);
  b.innerHTML=`
  <div class="ec-chal"><b><i class=yi data-i=info></i> A ideia</b>
   <small><b>Em 3 passos:</b> 1) Entre num grupo (ex.: Instagram · curtidas) · 2) Quando for sua vez, publique seu link · 3) Nos outros dias, ajude quem está na frente e envie a prova. A fila anda sozinha — todo mundo recebe divulgação.</small>
   <div class="aff-easy" style="margin-top:10px"><b>Fila inteligente:</b> quem espera há mais tempo sobe. Meta de provas batida → próximo da fila. Grupos por categoria (Facebook, Instagram, TikTok…).</div></div>
  <div class="ec-chal"><b>1.</b> <b>Explore os grupos</b> por categoria e entre nos que combinam com você (ou crie o seu).<br><b>2.</b> Acompanhe sua <b>posição na fila</b> — ela é reorganizada uma vez por ciclo, nunca quando você atualiza a página.<br><b>3.</b> Na sua vez, <b>publique seu link</b> dentro do tempo de oportunidade; depois, os demais têm o tempo de colaboração para apoiar.<br><b>4.</b> Cada colaborador envia <b>1 prova por rodada</b>. Atraso desce a fila; ausência marca seu estado; <b>pausa justificada</b> não é penalizada.</div>
  <div class="ec-chal"><b>Tempos do grupo</b><small class="hint"><b>Tempo de oportunidade:</b> o período em que o participante da vez tem prioridade para publicar o link.<br><b>Tempo de colaboração:</b> o período em que os demais visualizam e colaboram com a publicação.<br>Os dois não precisam ser iguais — grupos com muitos membros usam tempos curtos calculados automaticamente pelo sistema.</small></div>
  <div class="ec-chal"><b>Boas práticas</b><small class="hint">Colabore de verdade e em lugares reais. Provas falsas derrubam a confiança do grupo — o criador e a administração podem remover provas inválidas e suspender quem insiste. O sistema respeita as regras de cada rede: divulgação voluntária e transparente, sem engajamento artificial.</small></div>`;
  return;
 }
 /* ── EXPLORAR GRUPOS ── */
 if(affTab==="explorar"){
  const mine=affMyIds();
  st.innerHTML=st2([["<i class=yi data-i=users></i> Grupos ativos",act.length,"green"],["<i class=yi data-i=users></i> Participantes",totM,"gold"],["<i class=yi data-i=list></i> Meus grupos",mine.length,"gold"]]);
  const cats=[...new Set(act.map(g=>g.cat||"outro"))];
  let html="";
  if(cats.length>1)html+=`<div class="eng-filter">${cats.map(c=>`<button class="chip" data-engcat="${esc(c)}">${esc(engCatLabel(c))}</button>`).join("")}</div>`;
  html+=act.map(g=>{
   const n=Number(g.membersCount)||0,max=Math.max(2,Number(g.maxMembers)||100),need=Math.max(1,Number(g.sharesNeeded)||10),got=Number(g.proofsReceived)??Number(g.sharesReceived)??0;
   const isMem=mine.includes(g.id),full=n>=max,open=engOpenNow(g);
   return `<div class="ec-chal">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(g.name||"Grupo")}</b><span class="tag ${isMem?"g":full?"":"y"}">${isMem?"Você participa":full?"Cheio":n+" de "+max+" vagas"}</span></div>
    ${g.desc?`<small class="hint">${esc(g.desc)}</small>`:""}
    <small><span class="aff-plat">${esc(engCatLabel(g.cat))}${g.sub?" · "+esc(engSubLabel(g.cat,g.sub)):""}</span> <span class="aff-plat"><i class=yi data-i=clock></i> ${engScheduleTxt(g)}</span> <span class="aff-plat">${open?"<span class='sdotg'></span> aberto agora":"fechado neste horário"}</span></small>
    <div data-ecprog="eng-${esc(g.id)}"><div class="ec-prog"><i style="width:${Math.min(100,Math.round(got/need*100))}%"></i></div><small class="hint">Na vez: <b>${esc(g.currentName||g.frontName||"—")}</b> · ${got}/${need} provas desta rodada · ${engTimeModeTxt(g)}</small></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
    ${isMem?`<button class="btn sm" data-affgroup="${esc(g.id)}">Abrir rodadas →</button>`:full?"":`<button class="btn sm" data-affjoin="${esc(g.id)}">Entrar na fila →</button>`}
    ${g.createdBy===currentUser?.uid?`<button class="btn sm danger" data-affdel="${esc(g.id)}">Apagar grupo</button>`:""}
    </div>
   </div>`;
  }).join("")||'<p class="hint">Nenhum grupo ativo ainda — crie o primeiro na aba <b>Criar grupo</b>!</p>';
  b.innerHTML=html;
  return;
 }
 /* ── MEUS GRUPOS ── */
 if(affTab==="meus"){
  const mine=affMyIds().map(id=>affGroups.find(g=>g.id===id)).filter(Boolean);
  st.innerHTML=st2([["<i class=yi data-i=users></i> Meus grupos",mine.length,"gold"]]);
  b.innerHTML=mine.length?mine.map(g=>`<div class="ec-hrow"><div style="flex:1 1 160px;min-width:0"><b>${esc(g.name||"Grupo")}</b><small class="hint" style="display:block">${esc(engCatLabel(g.cat))} · na vez: ${esc(g.currentName||g.frontName||"—")} · ${Number(g.membersCount)||0} membro(s)</small></div><button class="btn sm" data-affgroup="${esc(g.id)}">Abrir →</button></div>`).join(""):'<p class="hint">Você ainda não participa de nenhum grupo. Veja a aba <b>Explorar grupos</b> e entre na fila!</p>';
  return;
 }
 /* ── CRIAR GRUPO ── */
 if(affTab==="criar"){
  if(cfg.allowCreate===false){st.innerHTML="";b.innerHTML='<p class="hint">A criação de grupos está desativada pelo organizador — entre nos grupos existentes na aba <b>Explorar grupos</b>.</p>';return}
  st.innerHTML=st2([["<i class=yi data-i=star></i> Padrões",cfg.defaultMax+" vagas","gold"],["<i class=yi data-i=refresh></i> Provas p/ andar",cfg.defaultShares,""]]);
  b.innerHTML=`<div class="ec-chal"><b><i class=yi data-i=star></i> Criar um grupo de engajamento</b>
   <input id="eng-name" maxlength="40" placeholder="Nome do grupo (ex.: Divulgação Facebook 01)">
   <input id="eng-desc" maxlength="140" placeholder="Descrição curta (opcional)">
   <div style="display:flex;gap:8px;flex-wrap:wrap">
    <select id="eng-cat" style="flex:1 1 150px">${Object.entries(ENG_CATS).map(([k,c])=>`<option value="${k}">${esc(c.label)}</option>`).join("")}</select>
    <select id="eng-sub" style="flex:1 1 150px"></select>
   </div>
   <textarea id="eng-rules" rows="2" maxlength="500" placeholder="Regras do grupo (onde compartilhar, tipo de prova exigida…)"></textarea>
   <div style="display:flex;gap:8px;flex-wrap:wrap">
    <input id="eng-max" type="number" min="2" max="1000" value="${cfg.defaultMax}" placeholder="Máx. participantes" style="flex:1 1 110px">
    <input id="eng-need" type="number" min="1" max="999" value="${cfg.defaultShares}" placeholder="Provas p/ andar a fila" style="flex:1 1 110px">
   </div>
   <div class="eng-box"><b class="eng-box-t">Funcionamento diário</b>
   <div style="display:flex;gap:8px;flex-wrap:wrap">
    <label class="hint" style="flex:1 1 120px">Início<select id="eng-sh">${Array.from({length:24},(_,h)=>`<option value="${h}" ${h===6?"selected":""}>${pad2(h)}:00</option>`).join("")}</select></label>
    <label class="hint" style="flex:1 1 120px">Encerramento<select id="eng-eh">${Array.from({length:24},(_,h)=>`<option value="${h}" ${h===0?"selected":""}>${pad2(h)}:00</option>`).join("")}</select></label>
   </div></div>
   <div class="eng-box"><b class="eng-box-t">Tempos das rodadas</b>
   <div style="display:flex;gap:8px;flex-wrap:wrap">
    <select id="eng-tmode" style="flex:1 1 150px"><option value="auto">Automático (o sistema calcula)</option><option value="custom">Personalizado</option></select>
   </div>
   <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
    <label class="hint" style="flex:1 1 110px">Oportunidade (min)<input id="eng-opp" type="number" min="1" max="240" value="${cfg.defaultOpp}"></label>
    <label class="hint" style="flex:1 1 110px">Colaboração (min)<input id="eng-collab" type="number" min="1" max="720" value="${cfg.defaultCollab}"></label>
    <label class="hint" style="flex:1 1 110px">Tolerância (min)<input id="eng-tol" type="number" min="0" max="120" value="${cfg.defaultTol??10}"></label>
   </div>
   <small class="hint">Tempo de oportunidade = prazo do participante da vez para publicar o link. Tempo de colaboração = prazo dos demais para apoiar. Aviso: participantes × (oportunidade + colaboração) precisa caber no horário de funcionamento — o sistema avisa se não couber.</small></div>
   <button class="btn sm" data-engnew="1">Criar grupo</button></div>`;
  const catSel=$("eng-cat"),subSel=$("eng-sub");
  const fillSub=()=>{const c=ENG_CATS[catSel.value];subSel.innerHTML=Object.entries(c.subs).map(([k,l])=>`<option value="${k}">${esc(l)}</option>`).join("")};
  fillSub();catSel.onchange=fillSub;
  return;
 }
 /* ── MINHA FILA ── */
 if(affTab==="fila"){
  const mine=affMyIds().map(id=>({g:affGroups.find(x=>x.id===id)})).filter(x=>x.g);
  st.innerHTML=st2([["<i class=yi data-i=list></i> Filas",mine.length,"gold"]]);
  b.innerHTML=mine.length?mine.map(({g})=>{
   const qi=(Array.isArray(g.queue)?g.queue:[]).indexOf(currentUser?.uid);
   const pos=qi>=0?qi+1:0;
   return `<div class="ec-hrow"><div style="flex:1 1 160px;min-width:0"><b>${esc(g.name||"Grupo")}</b><small class="hint" style="display:block">posição aproximada: ${pos?pos+"º":"—"} · na vez: ${esc(g.currentName||g.frontName||"—")}</small></div><button class="btn sm" data-affgroup="${esc(g.id)}">Ver fila →</button></div>`;
  }).join(""):'<p class="hint">Entre em um grupo para acompanhar sua posição na fila.</p>';
  return;
 }
 /* ── RODADAS (grupo aberto) ── */
 if(affTab==="rodadas"){
  if(!affActive){
   const mine=affMyIds().map(id=>affGroups.find(g=>g.id===id)).filter(Boolean);
   st.innerHTML=st2([["<i class=yi data-i=users></i> Meus grupos",mine.length,"gold"]]);
   b.innerHTML=mine.length?mine.map(g=>`<div class="ec-hrow"><div style="flex:1 1 160px;min-width:0"><b>${esc(g.name||"Grupo")}</b><small class="hint" style="display:block">na vez: ${esc(g.currentName||g.frontName||"—")}</small></div><button class="btn sm" data-affgroup="${esc(g.id)}">Abrir →</button></div>`).join(""):'<p class="hint">Você ainda não participa de nenhum grupo.</p>';
   return;
  }
  const g=affActive;
  const me=affMembers.find(m=>m.uid===currentUser?.uid);
  const isMe=g.currentUid===currentUser?.uid;
  const need=Math.max(1,Number(g.sharesNeeded)||10),got=Number(g.proofsReceived)??Number(g.sharesReceived)??0;
  const p=Math.min(100,Math.round(got/need*100));
  const openNow=engOpenNow(g);
  st.innerHTML=st2([["<i class=yi data-i=users></i> Membros",affMembers.length||Number(g.membersCount)||0,"green"],["<i class=yi data-i=list></i> Minha posição",me?(me.position+"º"):"—","gold"],["<i class=yi data-i=refresh></i> Ciclo",esc(g.cycleDate||"—"),""]]);
  let html=`<div class="ec-chal">
   <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
    <div><b>${esc(g.name||"Grupo")}</b><small class="hint" style="display:block">${esc(engCatLabel(g.cat))}${g.sub?" · "+esc(engSubLabel(g.cat,g.sub)):""} · ${engScheduleTxt(g)} · ${engTimeModeTxt(g)}</small></div>
    <button class="btn sm ghost" data-affback="1">‹ Voltar</button>
   </div>
   ${g.rules?`<small class="hint"><b>Regras do criador:</b> ${esc(g.rules)}</small>`:""}
   ${openNow?"":`<small class="hint" style="color:var(--rd)"><b>Grupo fechado agora</b> — funciona de ${engScheduleTxt(g)}.</small>`}
   <div style="border:1px solid var(--ac);border-radius:12px;padding:10px 12px;display:grid;gap:6px">
    <b>${isMe?"🎯 É a sua vez! Publique seu link":"Participante da vez: "+esc(g.currentName||g.frontName||"—")}</b>
    ${g.postedLink?`<div class="eng-post"><small class="hint">Publicação da vez:</small><a href="${esc(g.postedLink)}" target="_blank" rel="noopener">${esc(g.postedLink)}</a>${g.postedNote?`<small class="hint">${esc(g.postedNote)}</small>`:""}</div>`:(isMe?`<div style="display:grid;gap:6px"><input id="eng-post-link" maxlength="300" placeholder="Cole o link da sua publicação"><input id="eng-post-note" maxlength="140" placeholder="Legenda curta (opcional)"><button class="btn sm" data-engpost="1">Publicar meu link →</button></div>`:`<small class="hint">Aguardando ${esc(g.currentName||"o participante da vez")} publicar o link…</small>`)}
    <div class="ec-prog"><i style="width:${p}%"></i></div>
    <small class="hint">${got}/${need} provas desta rodada · ${g.postedLink?`colaboração até ${engCountdown(g.roundCollabEnds)}`:`oportunidade até ${engCountdown(g.roundOppEnds)}`}</small>
   </div>`;
  if(me&&!isMe&&g.postedLink){
   html+=`<div style="border-top:1px dashed var(--l);padding-top:10px;display:grid;gap:8px">
    <b><i class=yi data-i=handshake></i> Enviar minha prova de colaboração</b>
    <small class="hint">Colabore com a publicação de ${esc(g.currentName||"quem está na vez")} e prove abaixo. Cada membro envia <b>1 prova por rodada</b>.</small>
    <select id="engp-plat">${Object.entries(AFF_PLAT).map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select>
    <input id="engp-link" maxlength="300" placeholder="Link do post/compartilhamento (opcional)">
    <textarea id="engp-note" rows="2" maxlength="400" placeholder="Onde e como você colaborou (ex.: stories, grupo do WhatsApp, bio…)"></textarea>
    <button class="btn sm" data-engproof="1">Enviar prova →</button>
   </div>`;
  }else if(isMe){
   html+='<small class="hint"><b>Você é o participante da vez</b> — publique seu link dentro do tempo de oportunidade. Depois de publicar, aguarde as provas dos colaboradores.</small>';
  }
  /* painel do proprietário */
  if(g.createdBy===currentUser?.uid){
   html+=`<div style="border-top:1px dashed var(--l);padding-top:10px;display:grid;gap:8px">
   <b><i class=yi data-i=gear></i> Painel do proprietário</b>
   <small class="hint">Aprove, suspenda ou remova participantes. Estados: ativo participa normalmente; pausado pediu pausa justificada (não é penalizado); ausente não respondeu no prazo; suspenso não participa até você liberar.</small>
   <div class="eng-owner">${affMembers.filter(m=>m.uid!==currentUser.uid).map(m=>`<div class="eng-orow"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(maskName(m.name||"Membro"))}</span>${engStateTag(m.state)}<button class="btn sm ghost" data-engstate="${esc(m.uid)}|suspenso">${m.state==="suspenso"?"Liberar":"Suspender"}</button><button class="btn sm danger" data-engrm="${esc(m.uid)}">Remover</button></div>`).join("")||'<small class="hint">Nenhum outro membro ainda.</small>'}</div>
   <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm ghost" data-engcycle="1">Reorganizar fila agora</button></div>
   </div>`;
  }
  /* controles do próprio estado */
  if(me){
   html+=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
   ${me.state==="pausado"?`<button class="btn sm ghost" data-engme="ativo">Voltar da pausa</button>`:`<button class="btn sm ghost" data-engme="pausado">Pedir pausa justificada</button>`}
   <small class="hint">Seu estado: ${engStateTag(me.state)}</small></div>`;
  }
  html+=`</div>
  <div class="ec-chal"><b><i class=yi data-i=list></i> Fila do ciclo (${esc(g.cycleDate||"—")})</b>
  ${affMembers.length?[...affMembers].sort((a,b2)=>(a.position||99)-(b2.position||99)).map(m=>`<div class="aff-qrow ${m.uid===g.currentUid?"front":""} ${m.uid===currentUser?.uid?"me":""}"><span class="pos">${m.position||"—"}</span><span style="flex:1;min-width:0">${esc(maskName(m.name||"Membro"))}${m.uid===currentUser?.uid?" (você)":""}${m.uid===g.currentUid?" · vez atual":""}</span>${engStateTag(m.state)}<small class="hint">${Number(m.proofsGiven)??Number(m.sharesGiven)??0} provas · ${Number(m.cyclesDone)||0} vez(es) na frente${Number(m.lateCount)?` · ${m.lateCount} atraso(s)`:""}</small></div>`).join(""):'<small class="hint">Carregando fila…</small>'}
  </div>`;
  b.innerHTML=html;
  return;
 }
 /* ── HISTÓRICO ── */
 if(affTab==="hist"){
  st.innerHTML=st2([["<i class=yi data-i=clock></i> Colaborações registradas",affHist.filter(h=>h.status!=="removed").length,"gold"]]);
  b.innerHTML=affHist.length?affHist.slice().reverse().map(pr=>`<div class="ec-hrow"><div style="flex:1;min-width:0"><b>${esc(AFF_PLAT[pr.platform]||pr.platform||"Colaboração")}</b><small class="hint" style="display:block">grupo: ${esc(pr.groupName||pr.groupId||"—")} · para ${esc(pr.targetName||"—")}${pr.status==="removed"?" · prova removida pela moderação":""}</small></div><small class="hint">${fmt(pr.createdAt)}</small></div>`).join(""):'<p class="hint">Nenhuma participação registrada ainda. Suas colaborações aparecem aqui.</p>';
  return;
 }
 /* ── FERRAMENTAS ── */
 if(affTab==="ferramentas"){
  st.innerHTML=st2([["<i class=yi data-i=toolbox></i> Ferramentas",5,"gold"]]);
  b.innerHTML=`
  <div class="aff-tool"><b>1 · Montador de link com rastreio</b>
   <small class="hint">Cole seu link e adicione tags UTM para saber de onde vieram os cliques.</small>
   <input id="aff-t1-url" placeholder="https://seu-link-aqui">
   <input id="aff-t1-camp" maxlength="40" placeholder="Nome da campanha (ex.: grupo-facebook)">
   <button class="btn sm" data-aff-t1="1">Montar link</button>
   <output id="aff-t1-out" class="hint mono" style="word-break:break-all"></output>
  </div>
  <div class="aff-tool"><b>2 · Gerador de texto pronto (copy)</b>
   <small class="hint">Um post pronto para colar no stories, status ou grupo.</small>
   <select id="aff-t2-plat">${Object.values(ENG_CATS).map(c=>`<option>${esc(c.label)}</option>`).join("")}</select>
   <input id="aff-t2-prod" maxlength="80" placeholder="O que você está divulgando">
   <input id="aff-t2-link" placeholder="Seu link">
   <button class="btn sm" data-aff-t2="1">Gerar texto</button>
   <output id="aff-t2-out" class="hint" style="white-space:pre-wrap"></output>
  </div>
  <div class="aff-tool"><b>3 · Calculadora de rodadas</b>
   <small class="hint">Quantas rodadas o grupo completa no período de funcionamento?</small>
   <input id="aff-t3-p" type="number" min="2" max="1000" placeholder="Participantes">
   <input id="aff-t3-c" type="number" min="1" max="720" placeholder="Minutos por rodada (oportunidade + colaboração)">
   <input id="aff-t3-h" type="number" min="1" max="24" placeholder="Horas de funcionamento por dia">
   <button class="btn sm" data-aff-t3="1">Calcular</button>
   <output id="aff-t3-out" class="hint"></output>
  </div>
  <div class="aff-tool"><b>4 · Checklist de colaboração</b>
   <small class="hint">✅ Stories/Status com a publicação da vez<br>✅ Grupos de WhatsApp/Telegram (sem spam, com contexto)<br>✅ Bio com o link fixo<br>✅ Print da prova mostrando seu perfil (@) e a hora</small>
  </div>
  <div class="aff-tool"><b>5 · Modelo de regras para o seu grupo</b>
   <small class="hint">"1. Publique seu link dentro do tempo de oportunidade.<br>2. Colabore com a publicação da vez em pelo menos 1 lugar real.<br>3. Prova obrigatória: print com seu @ visível. 1 prova por rodada.<br>4. Prova falsa = remoção. Atraso = fim da fila.<br>5. Pausa justificada deve ser pedida antes do prazo."</small>
  </div>`;
  return;
 }
}
/* abrir grupo (assinaturas ao vivo de membros e provas) */
function affOpenGroup(id){
 const g=affGroups.find(x=>x.id===id);
 if(!g)return;
 affActive=g;affTab="rodadas";
 if(affMemUn)try{affMemUn()}catch(e){}
 if(affProofUn)try{affProofUn()}catch(e){}
 affMemUn=onSnapshot(query(collection(db,"affGroups",id,"members"),orderBy("position","asc"),limit(500)),s=>{affMembers=s.docs.map(d=>({id:d.id,...d.data()}));if($("affgaveta").classList.contains("open"))affRender()},e=>console.warn("Fila:",e));
 affProofUn=onSnapshot(query(collection(db,"affGroups",id,"proofs"),where("uid","==",currentUser.uid),limit(50)),s=>{affMyProofs=s.docs.map(d=>d.data());if($("affgaveta").classList.contains("open")&&affTab==="rodadas")affRender()},e=>console.warn("Provas:",e));
 engEnsure(id);
 affRender();
}
function affBack(){affActive=null;affMembers=[];affMyProofs=[];if(affMemUn)try{affMemUn()}catch(e){}if(affProofUn)try{affProofUn()}catch(e){}affMemUn=affProofUn=null;affTab="explorar";affRender()}
/* histórico global do usuário (espelho affProofs) */
function affWatchHist(){
 if(affHistUn)try{affHistUn()}catch(e){}
 affHistUn=onSnapshot(query(collection(db,"affProofs"),where("uid","==",currentUser.uid),limit(120)),s=>{affHist=s.docs.map(d=>({id:d.id,...d.data()}));if($("affgaveta").classList.contains("open")&&affTab==="hist")affRender()},e=>console.warn("Histórico:",e));
}
/* distribuição equilibrada: ordena por quem fez a última rodada há mais
   tempo e embaralha apenas dentro de cada grupo de igualdade */
function engShuffleFair(list){
 const buckets=new Map();
 list.forEach(m=>{const k=Number(m.lastTurnAt)||0;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(m)});
 return [...buckets.keys()].sort((a,b)=>a-b).flatMap(k=>{
  const arr=buckets.get(k);
  for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]}
  return arr;
 });
}
/* ciclo/rodada lazy: roda 1x por dia (novo ciclo) e avança rodadas
   vencidas (atraso ou fim da colaboração) — dentro de transação */
async function engEnsure(id){
 if(!currentUser)return;
 try{
  await runTransaction(db,async tx=>{
   const gRef=doc(db,"affGroups",id);
   const gs=await tx.get(gRef);
   if(!gs.exists())throw new Error("_gone");
   const g=gs.data();
   if(g.active===false)throw new Error("_off");
   const mq=await tx.get(query(collection(db,"affGroups",id,"members"),orderBy("position","asc"),limit(500)));
   const mem=mq.docs.map(d=>({ref:d.ref,uid:d.data().uid,position:Number(d.data().position)||0,name:d.data().name,state:d.data().state||"ativo",lastTurnAt:Number(d.data().lastTurnAt)||0,cyclesDone:Number(d.data().cyclesDone)||0,lateCount:Number(d.data().lateCount)||0})).sort((a,b)=>a.position-b.position);
   const opp=Math.max(1,Number(g.oppMin)||2)*60000,col=Math.max(1,Number(g.collabMin)||30)*60000,tol=(Number.isFinite(Number(g.tolMin))?Number(g.tolMin):10)*60000;
   const now=Date.now(),today=engToday();
   const setRound=(tx2,queue,cur,extra)=>tx2.set(gRef,{cycleDate:today,queue,currentUid:cur?cur.uid:"",currentName:cur?(cur.name||"Membro"):"",roundOppEnds:now+opp,roundCollabEnds:now+opp+col+tol,proofsReceived:0,postedLink:"",postedNote:"",postedAt:null,updatedAt:serverTimestamp(),...extra},{merge:true});
   const advance=(tx2,queue,cur,done)=>{
    const rest=queue.filter(u=>u!==cur?.uid);
    if(done&&cur){
     const cm=mem.find(m=>m.uid===cur.uid);
     if(cm)tx2.set(cm.ref,{position:rest.length+1,cyclesDone:increment(1),lastTurnAt:Date.now(),state:"disponivel"},{merge:true});
    }
    rest.forEach((u,i)=>{const m=mem.find(x=>x.uid===u);if(m)tx2.set(m.ref,{position:i+1},{merge:true})});
    const next=rest.length?mem.find(m=>m.uid===rest[0]):null;
    setRound(tx2,rest,next,done?{cycles:increment(1)}:{});
   };
   const q=Array.isArray(g.queue)?g.queue:[];
   if(g.cycleDate!==today||!q.length){
    const elig=engShuffleFair(mem.filter(m=>m.state!=="pausado"&&m.state!=="suspenso"));
    if(!elig.length)return;
    elig.forEach((m,i)=>tx.set(m.ref,{position:i+1,state:"disponivel"},{merge:true}));
    setRound(tx,elig.map(m=>m.uid),elig[0]);
    return;
   }
   const cur=mem.find(m=>m.uid===g.currentUid);
   /* atraso: passou oportunidade + tolerância sem publicar */
   if(cur&&!g.postedLink&&now>Number(g.roundOppEnds)+tol){
    tx.set(cur.ref,{lateCount:increment(1),state:"pendente"},{merge:true});
    advance(tx,q,cur,false);
    return;
   }
   /* fim da colaboração: registra resultado e passa a vez */
   if(cur&&g.postedLink&&now>Number(g.roundCollabEnds)){
    advance(tx,q,cur,(Number(g.proofsReceived)||0)>0);
    return;
   }
  });
 }catch(e){/* silencioso: só sincronização de ciclo */}
}
/* entrar na fila */
async function affJoin(id){
 if(!currentUser){toast("Entre na sua conta.");return}
 try{
  await runTransaction(db,async tx=>{
   const gRef=doc(db,"affGroups",id);
   const gs=await tx.get(gRef);
   if(!gs.exists())throw new Error("_gone");
   const g=gs.data();
   if(g.active===false)throw new Error("_off");
   const mRef=doc(db,"affGroups",id,"members",currentUser.uid);
   if((await tx.get(mRef)).exists())throw new Error("_already");
   const cnt=Number(g.membersCount)||0,max=Math.max(2,Number(g.maxMembers)||100);
   if(cnt>=max)throw new Error("_full");
   const pos=cnt+1;
   tx.set(mRef,{uid:currentUser.uid,name:profile?.name||"Membro",position:pos,state:"disponivel",proofsGiven:0,cyclesDone:0,lateCount:0,joinedAt:serverTimestamp()});
   const q=Array.isArray(g.queue)?g.queue:[];
   if(!g.currentUid){tx.set(gRef,{membersCount:cnt+1,queue:[...q,currentUser.uid],currentUid:currentUser.uid,currentName:profile?.name||"Membro",roundOppEnds:Date.now()+Math.max(1,Number(g.oppMin)||2)*60000,roundCollabEnds:Date.now()+(Math.max(1,Number(g.oppMin)||2)+Math.max(1,Number(g.collabMin)||30))*60000,proofsReceived:0,postedLink:"",updatedAt:serverTimestamp()},{merge:true})}
   else tx.set(gRef,{membersCount:cnt+1,queue:[...q,currentUser.uid],updatedAt:serverTimestamp()},{merge:true});
  });
  await updateDoc(doc(db,"users",currentUser.uid),{affGroups:arrayUnion(id)}).catch(()=>{});
  toast("Você entrou na fila! O ciclo se reorganiza a cada dia com equilíbrio.");
  affOpenGroup(id);
 }catch(e){
  const m={"_gone":"Este grupo não existe mais.","_off":"O grupo está desativado.","_already":"Você já participa deste grupo.","_full":"O grupo está cheio."};
  toast(m[e?.message]||"Não foi possível entrar agora.");
 }
}
/* criar grupo (e entrar como 1º da fila) */
async function engCreate(){
 const name=($("eng-name")?.value||"").trim();
 if(name.length<3){toast("Dê um nome com pelo menos 3 letras.");return}
 const cat=$("eng-cat")?.value||"outro",sub=$("eng-sub")?.value||"geral";
 const max=Math.min(1000,Math.max(2,Math.floor(Number($("eng-max").value)||100)));
 const need=Math.max(1,Math.floor(Number($("eng-need").value)||10));
 const sh=Number($("eng-sh").value),eh=Number($("eng-eh").value);
 const tmode=$("eng-tmode")?.value||"auto";
 const opp=Math.min(240,Math.max(1,Math.floor(Number($("eng-opp").value)||2)));
 const collab=Math.min(720,Math.max(1,Math.floor(Number($("eng-collab").value)||30)));
 const tol=Math.min(120,Math.max(0,Math.floor(Number($("eng-tol").value)||10)));
 /* aviso de capacidade: participantes × rodada dentro do horário */
 const hours=(sh<=eh?eh-sh:24-sh+eh);
 const perDay=Math.max(1,Math.floor(hours*60/(opp+collab)));
 if(max>perDay)toast("Atenção: no horário escolhido cabem ~"+perDay+" rodada(s) por dia — com "+max+" participantes, nem todos recebem a vez todo dia.");
 try{
  const ref=await addDoc(collection(db,"affGroups"),{name:name.slice(0,40),desc:($("eng-desc")?.value||"").trim().slice(0,140),cat,sub,rules:($("eng-rules")?.value||"").trim().slice(0,500),maxMembers:max,sharesNeeded:need,startHour:sh,endHour:eh,timeMode:tmode,oppMin:opp,collabMin:collab,tolMin:tol,createdBy:currentUser.uid,ownerName:profile?.name||"Membro",active:true,membersCount:0,cycles:0,proofsReceived:0,cycleDate:"",queue:[],postedLink:"",createdAt:serverTimestamp()});
  await affJoin(ref.id);
  toast("Grupo criado! Você é o 1º da fila — divulgue o grupo para encher.");
 }catch(e){console.error(e);toast("Não foi possível criar o grupo agora.")}
}
/* apagar grupo (só o criador) */
async function affDelete(id){
 const g=affGroups.find(x=>x.id===id);
 if(!g||g.createdBy!==currentUser?.uid){toast("Só quem criou o grupo pode apagá-lo.");return}
 if(!confirm('Apagar o grupo "'+(g.name||"")+'", a fila e todas as provas?'))return;
 try{
  const batch=writeBatch(db);
  (await getDocs(collection(db,"affGroups",id,"members"))).docs.forEach(d=>batch.delete(d.ref));
  (await getDocs(collection(db,"affGroups",id,"proofs"))).docs.forEach(d=>batch.delete(d.ref));
  (await getDocs(query(collection(db,"affProofs"),where("groupId","==",id)))).docs.forEach(d=>batch.delete(d.ref));
  batch.delete(doc(db,"affGroups",id));
  await batch.commit();
  await updateDoc(doc(db,"users",currentUser.uid),{affGroups:arrayRemove(id)}).catch(()=>{});
  if(affActive?.id===id)affBack();
  toast("Grupo apagado.");
 }catch(e){console.error(e);toast("Não foi possível apagar agora.")}
}
/* participante da vez publica o link */
async function engPost(){
 if(!affActive||!currentUser)return;
 const link=($("eng-post-link")?.value||"").trim().slice(0,300);
 const note=($("eng-post-note")?.value||"").trim().slice(0,140);
 if(!/^https?:\/\/.+/.test(link)){toast("Cole um link válido (começando com https://).");return}
 const gid=affActive.id;
 try{
  await runTransaction(db,async tx=>{
   const gRef=doc(db,"affGroups",gid);
   const gs=await tx.get(gRef);
   if(!gs.exists())throw new Error("_gone");
   const g=gs.data();
   if(g.currentUid!==currentUser.uid)throw new Error("_notme");
   if(g.postedLink)throw new Error("_dup");
   const now=Date.now();
   if(now>Number(g.roundOppEnds))throw new Error("_late");
   const col=Math.max(1,Number(g.collabMin)||30)*60000;
   tx.set(gRef,{postedLink:link,postedNote:note,postedAt:serverTimestamp(),roundCollabEnds:now+col,updatedAt:serverTimestamp()},{merge:true});
  });
  toast("Link publicado! Agora os colaboradores têm o tempo de colaboração para apoiar.");
  affRender();
 }catch(e){
  const m={"_gone":"O grupo não existe mais.","_notme":"Não é a sua vez agora.","_dup":"Você já publicou o link desta rodada.","_late":"O tempo de oportunidade acabou — você foi para o fim da fila."};
  toast(m[e?.message]||"Não foi possível publicar agora.");
 }
}
/* enviar prova de colaboração — 1 por rodada, fila anda sozinha */
async function engProof(){
 if(!affActive||!currentUser)return;
 const platform=$("engp-plat")?.value||"outro";
 const link=($("engp-link")?.value||"").trim().slice(0,300);
 const note=($("engp-note")?.value||"").trim().slice(0,400);
 if(!note&&!link){toast("Descreva ou cole o link da sua colaboração.");return}
 const gid=affActive.id;
 try{
  const rotated=await runTransaction(db,async tx=>{
   const gRef=doc(db,"affGroups",gid);
   const gs=await tx.get(gRef);
   if(!gs.exists())throw new Error("_gone");
   const g=gs.data();
   if(g.active===false)throw new Error("_off");
   const mRef=doc(db,"affGroups",gid,"members",currentUser.uid);
   if(!(await tx.get(mRef)).exists())throw new Error("_member");
   const front=g.currentUid;
   if(!front)throw new Error("_front");
   if(front===currentUser.uid)throw new Error("_me");
   if(!g.postedLink)throw new Error("_nopost");
   if(Date.now()>Number(g.roundCollabEnds))throw new Error("_late");
   const cycleKey=(g.cycleDate||"")+"_"+front;
   const pid=cycleKey+"_"+currentUser.uid;
   if((await tx.get(doc(db,"affGroups",gid,"proofs",pid))).exists())throw new Error("_dup");
   const payload={uid:currentUser.uid,name:profile?.name||"Membro",platform,note,link,targetUid:front,targetName:g.currentName||"",cycleKey,groupId:gid,groupName:g.name||"",createdAt:serverTimestamp()};
   tx.set(doc(db,"affGroups",gid,"proofs",pid),payload);
   tx.set(doc(db,"affProofs",gid+"_"+pid),{...payload});
   tx.set(mRef,{proofsGiven:increment(1),lastActive:serverTimestamp()},{merge:true});
   const now=(Number(g.proofsReceived)||0)+1;
   const need=Math.max(1,Number(g.sharesNeeded)||10);
   if(now>=need){
    const mq=await tx.get(query(collection(db,"affGroups",gid,"members"),orderBy("position","asc"),limit(500)));
    const mem=mq.docs.map(d=>({ref:d.ref,uid:d.data().uid,position:Number(d.data().position)||0,name:d.data().name})).sort((a,b)=>a.position-b.position);
    const q=Array.isArray(g.queue)?g.queue:mem.map(m=>m.uid);
    const fm=mem.find(m=>m.uid===front);
    const rest=q.filter(u=>u!==front);
    if(fm)tx.set(fm.ref,{position:rest.length+1,cyclesDone:increment(1),lastTurnAt:Date.now(),state:"disponivel"},{merge:true});
    rest.forEach((u,i)=>{const m=mem.find(x=>x.uid===u);if(m)tx.set(m.ref,{position:i+1},{merge:true})});
    const next=rest.length?mem.find(m=>m.uid===rest[0]):null;
    tx.set(gRef,{proofsReceived:0,cycles:increment(1),queue:rest,currentUid:next?next.uid:"",currentName:next?(next.name||"Membro"):"",roundOppEnds:Date.now()+Math.max(1,Number(g.oppMin)||2)*60000,roundCollabEnds:Date.now()+(Math.max(1,Number(g.oppMin)||2)+Math.max(1,Number(g.collabMin)||30))*60000,postedLink:"",postedNote:"",postedAt:null,updatedAt:serverTimestamp()},{merge:true});
    return true;
   }
   tx.set(gRef,{proofsReceived:now,updatedAt:serverTimestamp()},{merge:true});
   return false;
  });
  toast(rotated?"Prova registrada — meta atingida! A fila andou: o próximo é o participante da vez.":"Prova registrada! Obrigado por colaborar.");
  affRender();
 }catch(e){
  const m={"_gone":"O grupo não existe mais.","_off":"O grupo está desativado.","_member":"Você não participa deste grupo.","_front":"A fila está sem um participante da vez agora.","_me":"É a sua vez de receber — aguarde as provas.","_nopost":"O participante da vez ainda não publicou o link.","_late":"O tempo de colaboração desta rodada acabou.","_dup":"Você já enviou sua prova desta rodada."};
  toast(m[e?.message]||"Não foi possível enviar a prova agora.");
 }
}
/* dono: estado de membro / remover / reorganizar; membro: pausa */
async function engSetState(uid,state){
 if(!affActive)return;
 try{await updateDoc(doc(db,"affGroups",affActive.id,"members",uid),{state,updatedAt:serverTimestamp()});toast("Estado atualizado.")}catch(e){toast("Não foi possível atualizar agora.")}
}
async function engRemove(uid){
 if(!affActive||!currentUser)return;
 const g=affActive;
 if(g.createdBy!==currentUser.uid&&uid!==currentUser.uid){toast("Só o proprietário pode remover participantes.");return}
 if(!confirm("Remover este participante do grupo?"))return;
 try{
  await runTransaction(db,async tx=>{
   const gs=await tx.get(doc(db,"affGroups",g.id));
   if(!gs.exists())throw new Error("_gone");
   const gd=gs.data();
   const mRef=doc(db,"affGroups",g.id,"members",uid);
   const ms=await tx.get(mRef);
   if(!ms.exists())return;
   tx.delete(mRef);
   const cnt=Math.max(0,(Number(gd.membersCount)||0)-1);
   const q=(Array.isArray(gd.queue)?gd.queue:[]).filter(u=>u!==uid);
   const patch={membersCount:cnt,queue:q,updatedAt:serverTimestamp()};
   if(gd.currentUid===uid){
    const mq=await tx.get(query(collection(db,"affGroups",g.id,"members"),orderBy("position","asc"),limit(500)));
    const rest=mq.docs.map(d=>({uid:d.data().uid,name:d.data().name})).filter(m=>m.uid!==uid);
    rest.forEach((m,i)=>tx.set(doc(db,"affGroups",g.id,"members",m.uid),{position:i+1},{merge:true}));
    const next=rest[0];
    patch.currentUid=next?next.uid:"";patch.currentName=next?(next.name||"Membro"):"";
    patch.proofsReceived=0;patch.postedLink="";patch.roundOppEnds=Date.now()+Math.max(1,Number(gd.oppMin)||2)*60000;patch.roundCollabEnds=Date.now()+(Math.max(1,Number(gd.oppMin)||2)+Math.max(1,Number(gd.collabMin)||30))*60000;
   }
   tx.set(doc(db,"affGroups",g.id),patch,{merge:true});
  });
  await updateDoc(doc(db,"users",uid),{affGroups:arrayRemove(affActive.id)}).catch(()=>{});
  toast("Participante removido.");
 }catch(e){console.error(e);toast("Não foi possível remover agora.")}
}
async function engCycleNow(){
 if(!affActive)return;
 try{
  await runTransaction(db,async tx=>{
   const gRef=doc(db,"affGroups",affActive.id);
   const gs=await tx.get(gRef);
   if(!gs.exists())throw new Error("_gone");
   const g=gs.data();
   if(g.createdBy!==currentUser.uid)throw new Error("_owner");
   const mq=await tx.get(query(collection(db,"affGroups",affActive.id,"members"),orderBy("position","asc"),limit(500)));
   const mem=mq.docs.map(d=>({ref:d.ref,uid:d.data().uid,name:d.data().name,state:d.data().state||"ativo",lastTurnAt:Number(d.data().lastTurnAt)||0})).filter(m=>m.state!=="pausado"&&m.state!=="suspenso");
   const elig=engShuffleFair(mem);
   elig.forEach((m,i)=>tx.set(m.ref,{position:i+1,state:"disponivel"},{merge:true}));
   const opp=Math.max(1,Number(g.oppMin)||2)*60000,col=Math.max(1,Number(g.collabMin)||30)*60000,tol=(Number.isFinite(Number(g.tolMin))?Number(g.tolMin):10)*60000;
   tx.set(gRef,{queue:elig.map(m=>m.uid),currentUid:elig[0]?.uid||"",currentName:elig[0]?(elig[0].name||"Membro"):"",roundOppEnds:Date.now()+opp,roundCollabEnds:Date.now()+opp+col+tol,proofsReceived:0,postedLink:"",postedNote:"",postedAt:null,updatedAt:serverTimestamp()},{merge:true});
  });
  toast("Fila reorganizada com equilíbrio — novo ciclo iniciado.");
 }catch(e){toast(e?.message==="_owner"?"Só o proprietário pode reorganizar a fila.":"Não foi possível reorganizar agora.")}
}
/* ferramentas */
function affTool1(){
 const u=($("aff-t1-url")?.value||"").trim();
 if(!/^https?:\/\/.+/.test(u)){toast("Cole um link válido (começando com https://).");return}
 const camp=($("aff-t1-camp")?.value||"grupo").trim().replace(/\s+/g,"-").toLowerCase();
 const sep=u.includes("?")?"&":"?";
 const out=u+sep+"utm_source=yshipp&utm_medium=engajamento&utm_campaign="+encodeURIComponent(camp);
 $("aff-t1-out").innerHTML=`<button class="btn sm ghost" data-copy="${esc(out)}">Copiar</button><br>${esc(out)}`;
}
function affTool2(){
 const prod=($("aff-t2-prod")?.value||"").trim();
 const link=($("aff-t2-link")?.value||"").trim();
 const plat=$("aff-t2-plat")?.value||"Facebook";
 if(prod.length<2||!link){toast("Preencha o conteúdo e o link.");return}
 $("aff-t2-out").textContent=`Dá uma olhada nisso: ${prod} (${plat})\nApoia quem está divulgando — confere aí:\n${link}`;
}
function affTool3(){
 const p=Number($("aff-t3-p")?.value)||0,c=Number($("aff-t3-c")?.value)||0,h=Number($("aff-t3-h")?.value)||0;
 if(p<=0||c<=0||h<=0){toast("Preencha participantes, minutos por rodada e horas de funcionamento.");return}
 const perDay=Math.floor(h*60/c),days=Math.ceil(p/Math.max(1,perDay));
 $("aff-t3-out").innerHTML=`Cabem <b>${perDay}</b> rodada(s) por dia · o grupo completo leva <b>${days}</b> dia(s) para todo mundo receber a vez.`;
}
/* delegação de cliques da Central de Engajamento Coletivo */
document.addEventListener("click",e=>{
 const tb=e.target.closest("[data-afftab]");
 if(tb){affTab=tb.dataset.afftab;if(affTab==="hist"&&!affHistUn)affWatchHist();affRender();return}
 if(e.target.closest("[data-affopen]")){affOpen();return}
 if(e.target.closest("[data-affback]")){affBack();return}
 const gp=e.target.closest("[data-affgroup]");
 if(gp){affOpenGroup(gp.dataset.affgroup);return}
 const jn=e.target.closest("[data-affjoin]");
 if(jn){affJoin(jn.dataset.affjoin);return}
 if(e.target.closest("[data-engnew]")){engCreate();return}
 if(e.target.closest("[data-engpost]")){engPost();return}
 if(e.target.closest("[data-engproof]")){engProof();return}
 if(e.target.closest("[data-engcycle]")){engCycleNow();return}
 const stt=e.target.closest("[data-engstate]");
 if(stt){const[uid,s]=stt.dataset.engstate.split("|");engSetState(uid,s);return}
 const rm=e.target.closest("[data-engrm]");
 if(rm){engRemove(rm.dataset.engrm);return}
 const me=e.target.closest("[data-engme]");
 if(me){engSetState(currentUser.uid,me.dataset.engme);return}
 const dl=e.target.closest("[data-affdel]");
 if(dl){affDelete(dl.dataset.affdel);return}
 if(e.target.closest("[data-aff-t1]")){affTool1();return}
 if(e.target.closest("[data-aff-t2]")){affTool2();return}
 if(e.target.closest("[data-aff-t3]")){affTool3();return}
});
/* ============================================================
   OFERTAS AVULSAS (tarefas sem evento), com Ativas/Futuras
   ============================================================ */
let offView="active",offViewColab="active";
/* estado da oferta: aceita tarefas publicadas no painel com ou sem evento,
   respeita datas, ativo e estoque de vagas */
function offerState(t){
 if(t.active===false)return"off";
 const now=Date.now(),s=tms(t.startAt),e=t.endAt?tme(t.endAt):Infinity;
 if(s>now)return"future";
 if(now>=e)return"off";
 const left=stockOf(t);
 if(left!==null&&left<=0)return"off";
 return"on";
}
function renderOffers(){
 [...$("offtabs").children].forEach(b=>b.classList.toggle("on",b.dataset.v===offView));
 [...$("offtabs2").children].forEach(b=>b.classList.toggle("on",b.dataset.v===offViewColab));
 const now=Date.now();
 const all=generalTasks();
 const render=(view,listEl,emptyTxt,colab)=>{
  if(!listEl)return;
  const offs=all.filter(t=>(t.source==="collab")===colab&&(view==="active"?offerState(t)==="on":offerState(t)==="future"));
  listEl.innerHTML=offs.length?offs.map(t=>{
   const c=claims[t.id],st=c?.status,rd=Math.max(0.01,Math.round((Number(t.reward)||0.01)*100)/100),ty=t.ticketType||"common",d=diffOfS(t);
   if(view!=="active")return `<div class="task openable" style="margin-top:10px" data-ws-open="${esc(t.id)}" role="button" tabindex="0"><div class="task-head"><h4>${catIcoS(t.category)} ${esc(plainTxt(t.serviceLabel||t.name))}</h4><button class="tid" type="button" data-copy="${esc(t.id)}" title="Toque para copiar o ID da tarefa">${esc(t.id)}</button></div><div class="actions" style="margin:0 0 4px;gap:6px"><span class="tag g">${esc(plainTxt(catLabelS(t.category)))}</span>${d?`<span class="tag y">${esc(plainTxt(d.label))}</span>`:""}<span class="tk-stamp ${colab?"y":"g"}" style="align-self:center">${colab?"<i class=yi data-i=handshake></i> Colaborador":"Yshippcommerce"}</span></div><div class="kv"><span>Valor</span><b>+${xcShort(t.rewardCur,rd)}</b></div><p class="mono">Começa em ${fmt(t.startAt)}</p></div>`;
   return taskCard(t);
  }).join(""):`<div class="card evc"><p class="hint">${view==="active"?emptyTxt:"Nenhuma oferta futura por enquanto."}</p></div>`;
 };
 render(offView,$("offs"),offView==="active"?"Nenhuma oferta Yshippcommerce ativa agora. Volte mais tarde.":"",false);
 render(offViewColab,$("offs-colab"),offViewColab==="active"?"Nenhuma oferta de colaborador no ar agora. Envie a primeira pelo botão “Anunciar como colaborador”!":"",true);
}
$("offtabs").onclick=e=>{const v=e.target.dataset.v;if(v){offView=v;renderOffers()}};
$("offtabs2").onclick=e=>{const v=e.target.dataset.v;if(v){offViewColab=v;renderOffers()}};
$("ofcprev").onclick=()=>slide($("offs-colab"),-1);
$("ofcnext").onclick=()=>slide($("offs-colab"),1);
/* copiar ID (e qualquer [data-copy]) funciona em qualquer seção */
document.addEventListener("click",e=>{const b=e.target.closest("[data-copy]");if(b)return copyText(b.dataset.copy)});
/* menu expansível de provas: abre/fecha dentro do card da oferta (vale
   para ofertas avulsas, eventos e assistente — delegação global) */
document.addEventListener("click",e=>{
 const t=e.target.closest("[data-proof-toggle]");if(!t)return;
 const body=t.parentElement.querySelector(".pm-body");if(!body)return;
 const open=body.hidden;
 body.hidden=!open;
 t.setAttribute("aria-expanded",String(open));
 const caret=t.querySelector(".pm-caret");if(caret)caret.textContent=open?"▴":"▾";
});

/* ============================================================
   16 · CONFIRMAR EVENTO VINCULADO AO SORTEIO
   ============================================================ */
function evConfirmCard(ev){
 const cost=Math.max(0,Math.floor(Number(ev.entryCost)||0));
 const ets=tasksOfEvent(ev.id);
 const dvs=draws.filter(x=>x.eventId===ev.id&&x.status!=="draft");
 const aus=auctions.filter(x=>x.eventId===ev.id&&x.status!=="draft");
 return `<div class="task"><div class="task-head"><h4>${esc(ev.name)}</h4><span class="tag y">Evento</span></div>
 ${ev.description?`<p>${esc(ev.description)}</p>`:""}
 <div class="kv"><span><i class=yi data-i=calendar></i> Início / término</span><b>${fmt(ev.startAt)}${ev.endAt?" · "+fmt(ev.endAt):""}</b></div>
 <div class="kv"><span>Entrada do evento</span><b>${cost?fmtBRL(cost):"Gratuita"}</b></div>
 <div class="kv"><span>Sorteios deste evento</span><b>${dvs.length?dvs.map(d=>esc(d.name||"—")).join(" · "):"—"}</b></div>
 <div class="kv"><span>Leilões deste evento</span><b>${aus.length?aus.map(a=>esc(a.name||"—")).join(" · "):"—"}</b></div>
 <div class="kv"><span>Tarefas do evento</span><b>${ets.length}</b></div>
 ${ev.rules?`<p class="hint">${esc(ev.rules)}</p>`:""}
 <p class="hint">A entrada libera todos os sorteios e leilões deste evento. Todos os valores são em reais (R$).</p>
 <div class="actions">${evState(ev)!=="active"?(evState(ev)==="future"?'<span class="tag y">Evento em breve — abre em '+(fmt(ev.startAt)!=="—"?fmt(ev.startAt):"data a definir")+"</span>":'<span class="tag r">Evento encerrado</span>'):(myJoins.has(ev.id)?'<span class="tag g">Participação confirmada ✓</span>':`<button class="btn wide" data-evjoin="${esc(ev.id)}">Confirmar participação no evento</button>`)}</div>
 </div>`;
}
async function joinEvent(id){
 if(!termsOk())return askTerms();
 const ev=events.find(x=>x.id===id);
 if(!ev)return toast("Evento não encontrado.");
 if(!currentUser?.emailVerified)return toast("Entre com uma conta verificada.");
 if(profile?.banned)return toast("Sua conta foi suspensa pelo organizador.");
 if(!profileOk())return toast("Salve seus dados de perfil primeiro.");
 const st=evState(ev);
 if(st==="future")return toast("Este evento ainda não começou. Abre em "+(fmt(ev.startAt)!=="—"?fmt(ev.startAt):"data a definir")+".");
 if(st==="ended")return toast("Este evento já foi encerrado"+(fmt(ev.endAt)!=="—"?" ("+fmt(ev.endAt)+")":"")+".");
 if(st!=="active")return toast("Este evento não está aberto no momento.");
 if(myJoins.has(id))return toast("Você já confirmou este evento.");
 const cost=Math.max(0,Math.floor(Number(ev.entryCost)||0));
 const uid=currentUser.uid,jRef=doc(db,"eventJoins",uid+"_"+id),wRef=doc(db,"wallets",uid);
 /* a carteira pode ainda não ter chegado no snapshot: busca direto antes de
    recusar (antes dava falso "bilhetes insuficientes" logo após o login) */
 if(cost>0&&!wallet){try{const ws=await getDoc(wRef);if(ws.exists())wallet=ws.data()}catch(e){}}
 if(cost>0&&pointsOf(wallet)<cost)return toast("Saldo insuficiente: a entrada custa "+fmtBRL(cost)+". Conclua tarefas para ganhar reais.");
 try{
  await runTransaction(db,async tx=>{
   const [js,ws]=await Promise.all([tx.get(jRef),tx.get(wRef)]);
   if(js.exists())return;
   if(cost>0){
    const wd=ws.exists()?ws.data():{};
    const spend=spendValue(wd,cost);
    if(!spend)throw new Error("Saldo insuficiente: a entrada custa "+fmtBRL(cost)+".");
    tx.set(wRef,{...applySpend(wd,spend),updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",uid,"history")),{kind:"event_join",amount:cost,eventId:id,eventName:ev.name||"",createdAt:serverTimestamp()});
   }
   tx.set(jRef,{uid,eventId:id,displayName:profile?.name||"",photo:myPhoto(),cost,joinedAt:serverTimestamp()});
  });
  toast("Entrada do evento confirmada! Sorteios e leilões liberados.");
 }catch(e){toast(e.message||"Erro ao confirmar o evento.")}
}

/* ============================================================
   17 · LEILÕES
   ============================================================ */
function renderAuctions(){
 const el=$("aucs");if(!el)return;
 const act=aucView==="active";
 const list=auctions.filter(a=>act?a.status==="open":a.status==="ended");
 if(!list.length){el.innerHTML=`<div class="card evc"><p class="hint">${act?"Nenhum leilão aberto agora. Volte mais tarde.":"Nenhum leilão encerrado ainda."}</p></div>`;return}
 el.innerHTML=list.map(a=>{
  const min=Math.max(1,Math.floor(Number(a.minBid)||1)),tot=Math.max(1,Math.floor(Number(a.totalTickets)||100));
  const bids=aucBidsOf(a.id);
  const total=bids.reduce((s,b)=>s+Math.max(0,Math.floor(Number(b.amount)||0)),0);
  const pct=Math.min(100,Math.round(total/tot*100));
  const ev=a.eventId?events.find(x=>x.id===a.eventId):null;
  const evOk=!ev||(evState(ev)==="active"&&myJoins.has(ev.id));
  const head=`<div class="ev-row"><h3>${esc(a.name||"Leilão")}</h3>${act?'<span class="tag g">Aberto</span>':'<span class="tag">Encerrado</span>'}</div>
  ${a.prize?`<div class="lrow"><span class="tn">Prêmio deste leilão</span><b class="lval">${esc(a.prize)}</b></div>`:""}
  ${a.description?`<p>${esc(a.description)}</p>`:""}
  ${ev?`<div class="lrow"><span class="tn">Evento</span><b class="lval">${esc(ev.name)}</b></div>`:""}
  <div class="auc-meta"><span>Arrecadado · meta ${fmtBRL(tot)}</span><b class="mono">${brl(total)} / ${brl(tot)}</b></div>
  <div class="track"><div class="fill" style="width:${pct}%"></div></div>`;
  if(act){
   const ranked=bids.filter(b=>b.uid&&Math.max(0,Math.floor(Number(b.amount)||0))>0).sort((x,y)=>(Number(y.amount)||0)-(Number(x.amount)||0));
   const top=ranked.slice(0,10);
   const myIdx=currentUser?ranked.findIndex(b=>b.uid===currentUser.uid):-1;
   const my=currentUser?Math.max(0,Math.floor(Number(bids.find(b=>b.uid===currentUser.uid)?.amount)||0)):0;
   const canClaim=currentUser?.emailVerified&&my>=tot;
   const rkRow=(b,pos)=>{
    const me=currentUser&&b.uid===currentUser.uid;
    return `<div class="rrow ${pos===1?"first":""} ${me?"me":""}">
     <span class="pos">${pos}º</span>
     ${whoHTML(b,(b.displayName||b.uid||"—").trim().charAt(0))}
     <span class="rname" data-up="${esc(b.uid||"")}" style="cursor:pointer" title="Ver perfil público">${esc(maskName(b.displayName||b.uid||"—"))}${me?' <span class="tag g">Você</span>':""}</span>
     <b class="amt">${fmtBRL(Math.max(0,Math.floor(Number(b.amount)||0)))}</b>
    </div>`;
   };
   return `<div class="card evc">${head}
   ${top.length?`<div class="auc-rk">
    <span class="rk-head">Participantes · top 10</span>
    ${top.map((b,i)=>rkRow(b,i+1)).join("")}
    ${myIdx>=10?`<span class="rk-head" style="margin-top:8px">Sua posição</span>${rkRow(ranked[myIdx],myIdx+1)}`:""}
   </div>`:`<p class="hint">Nenhum lance ainda. Dê o primeiro lance!</p>`}
   ${settlingAuctions.has(a.id)?`<p class="mono">Encerrando… apurando o resultado final <i class=yi data-i=hourglass></i></p>`:`<p class="mono">${a.endAt?"Encerra em "+fmt(a.endAt):""} · Lance mínimo: ${fmtBRL(min)}</p>`}
   <p class="hint">Quem acumular mais reais até o fim do prazo leva o prêmio. Atingiu ${fmtBRL(tot)}? Reivindique na hora. Todos os valores são em reais (R$). Se a meta não for atingida, todos os lances voltam para a carteira.</p>
   ${!evOk&&ev?(evState(ev)==="active"?`<p class="hint"><b>Pague a entrada do evento ${esc(ev.name)} para dar lances.</b></p>`:`<p class="hint"><b>O evento ${esc(ev.name)} ${evState(ev)==="future"?"ainda não começou":"já foi encerrado"}.</b> Os lances deste leilão ficam bloqueados.</p>`):""}
   <div class="tk-cut" aria-hidden="true"></div>
   ${currentUser?.emailVerified?(evOk?`<div class="lrow"><span class="tn">Seu lance vai para</span><b class="lval"><i class=yi data-i=scale></i> ${esc(a.name||"Leilão")} — prêmio: ${esc(a.prize||"—")}</b></div><div class="actions" style="margin:0"><input class="mono" style="max-width:110px" type="text" inputmode="numeric" placeholder="Lance" aria-label="Lance" data-bidamt="${esc(a.id)}"><select data-bidcur="${esc(a.id)}" style="max-width:150px" aria-label="Moeda do lance"><option value="brl">R$ (reais)</option><option value="diamond">Diamantes (1 = R$ 1)</option></select><button class="btn sm" data-bid="${esc(a.id)}">Dar lance</button></div>${my?`<p class="hint">Seu total: <b class="mono">${fmtBRL(my)} / ${fmtBRL(tot)}</b></p>`:""}`:""):""}
   ${canClaim?`<button class="btn wide" data-claim="${esc(a.id)}"><i class=yi data-i=trophy></i> Reivindicar o prêmio agora</button>`:""}
   </div>`;
  }
  const res=a.result||{};
  if(res.winnerUid){
   const iWon=currentUser&&res.winnerUid===currentUser.uid;
   const iBid=currentUser&&bids.find(b=>b.uid===currentUser.uid);
   return `<div class="card evc">${head}
   <div class="auc-lider"><span>Ganhador: ${whoHTML(res,(res.winnerName||"—").trim().charAt(0))}<span data-up="${esc(res.winnerUid||"")}" style="cursor:pointer;text-decoration:underline dotted" title="Ver perfil público">${esc(maskName(res.winnerName||"—"))}</span></span><b class="mono">${fmtBRL(Math.max(0,Math.floor(Number(res.winnerAmount)||0)))}</b></div>
   <p class="hint">Arrecadação final: <b class="mono">${fmtBRL(Math.max(0,Math.floor(Number(res.totalRaised)||0)))}</b>. Lances que não venceram foram devolvidos.</p>
   ${iWon?`<p class="hint"><b>Você ganhou este leilão! <i class=yi data-i=trophy></i> O organizador entrará em contato.</b></p>`:(iBid?`<p class="hint">Seu lance foi devolvido para a carteira.</p>`:"")}
   </div>`;
  }
  return `<div class="card evc">${head}
  <div class="auc-lider"><span>Meta não atingida</span><span class="tag r">Lances devolvidos</span></div>
  <p class="hint">O prêmio valia ${fmtBRL(tot)}. Como a meta não foi atingida, todos os lances voltaram para a carteira dos participantes.</p>
  </div>`;
 }).join("");
}
async function claimAuction(aid){
 if(!termsOk())return askTerms();
 if(!currentUser?.emailVerified)return toast("Entre com uma conta verificada.");
 if(profile?.banned)return toast("Sua conta foi suspensa pelo organizador.");
 if(!profileOk())return toast("Salve seus dados de perfil primeiro.");
 const aRef=doc(db,"auctions",aid);
 const tot0=Math.max(1,Math.floor(Number(auctions.find(x=>x.id===aid)?.totalTickets)||1));
 /* validação amigável antes do diálogo — a transação abaixo refaz TODAS as checagens */
 try{
  const bs=await getDocs(query(collection(db,"bids"),where("auctionId","==",aid)));
  const all=bs.docs.map(d=>d.data());
  const mine=all.find(b=>b.uid===currentUser.uid);
  const my=Math.max(0,Math.floor(Number(mine?.amount)||0));
  if(!mine||my<tot0)return toast("Você ainda não atingiu a meta de "+fmtBRL(tot0)+" neste leilão.");
  return askConfirm("Reivindicar o prêmio agora? O leilão encerra imediatamente e você é o ganhador.","Reivindicar prêmio",async()=>{
   try{
    /* TUDO numa única transação: dois participantes reivindicando juntos não
       podem mais ganhar os dois nem receber reembolso em dobro — quem chegar
       depois vê status "ended" e sai sem escrever nada. */
    await runTransaction(db,async tx=>{
     const as=await tx.get(aRef);
     if(!as.exists()||as.data().status!=="open")throw new Error("Este leilão já foi encerrado.");
     const a=as.data();
     const tot=Math.max(1,Math.floor(Number(a.totalTickets)||1));
     const bs=await tx.get(query(collection(db,"bids"),where("auctionId","==",aid)));
     const bids=bs.docs.map(d=>d.data());
     const me=bids.find(b=>b.uid===currentUser.uid);
     const my=Math.max(0,Math.floor(Number(me?.amount)||0));
     if(!me||my<tot)throw new Error("Você ainda não atingiu a meta de "+fmtBRL(tot)+" neste leilão.");
     const total=bids.reduce((s,b)=>s+Math.max(0,Math.floor(Number(b.amount)||0)),0);
     tx.set(aRef,{status:"ended",result:{winnerUid:currentUser.uid,winnerName:profile?.name||"",winnerAmount:my,totalRaised:total,endedAt:serverTimestamp()},updatedAt:serverTimestamp()},{merge:true});
     for(const b of bids){
      if(b.uid===currentUser.uid)continue;
      const amt=Math.max(0,Math.floor(Number(b.amount)||0));
      if(!b.uid||amt<1)continue;
      refundBidTx(tx,b,aid,a.name||"");
     }
    });
    toast("Prêmio reivindicado! <i class=yi data-i=trophy></i> O organizador entrará em contato.","win");
   }catch(e){toast(e.message||"Erro ao reivindicar o prêmio.")}
  },"Reivindicar agora");
 }catch(e){toast(e.message||"Erro ao reivindicar o prêmio.")}
}
/* ── FECHAMENTO AUTOMÁTICO DO LEILÃO EXPIRADO ──────────────────────────
   Sem backend agendado, o próprio site apura: quando o prazo (endAt) passa,
   o primeiro cliente que notar encerra o leilão em UMA transação idempotente
   e à prova de corrida (quem chegar depois vê status "ended" e não escreve).
   Meta não atingida → todos os lances voltam; meta atingida → maior lance
   vence e os demais são reembolsados. */
/* reembolso de lance na MOEDA certa, mesmo com lances mistos (parte em reais,
   parte em diamantes): amtB = parte em reais · amtD = parte em diamantes.
   Fichas nunca viram reais — cada parte volta no campo próprio da carteira. */
function refundBidTx(tx,b,aid,aName){
 if(!b.uid)return;
 const amtT=Math.max(0,Math.floor(Number(b.amount)||0));
 const dQ=Math.max(0,Math.floor(Number(b.amtD??b.dQty)||0));
 const bQ=Math.max(0,amtT-dQ);
 if(bQ>0){
  tx.set(doc(db,"wallets",b.uid),{change:increment(bQ),updatedAt:serverTimestamp()},{merge:true});
  tx.set(doc(collection(db,"wallets",b.uid,"history")),{kind:"auction_refund",amount:bQ,auctionId:aid,auctionName:aName||"",createdAt:serverTimestamp()});
 }
 if(dQ>0){
  tx.set(doc(db,"wallets",b.uid),{diamonds:increment(dQ),updatedAt:serverTimestamp()},{merge:true});
  tx.set(doc(collection(db,"wallets",b.uid,"history")),{kind:"auction_refund",amount:0,xcKind:"diamond",xcQty:dQ,auctionId:aid,auctionName:aName||"",reason:"Devolução de lance pago com diamantes",createdAt:serverTimestamp()});
 }
}
async function settleAuction(aid){
 /* guarda POR leilão: antes o settleBusy global descartava a apuração de
    outros leilões que venceram juntos — agora só bloqueia o mesmo leilão */
 if(settlingAuctions.has(aid))return;
 settlingAuctions.add(aid);
 try{
  const aRef=doc(db,"auctions",aid);
  await runTransaction(db,async tx=>{
   const as=await tx.get(aRef);
   if(!as.exists()||as.data().status!=="open")return;
   const a=as.data();
   const end=a.endAt?validDate(a.endAt):null;
   if(!end||end.getTime()>Date.now())return; /* ainda dentro do prazo */
   const bs=await tx.get(query(collection(db,"bids"),where("auctionId","==",aid)));
   const bids=bs.docs.map(d=>d.data());
   const meta=Math.max(1,Math.floor(Number(a.totalTickets)||1));
   const total=bids.reduce((s,b)=>s+Math.max(0,Math.floor(Number(b.amount)||0)),0);
   const sorted=[...bids].sort((x,y)=>(Number(y.amount)||0)-(Number(x.amount)||0));
   const winner=sorted.find(b=>b.uid);
   const refund=(list,winnerUid)=>{
    for(const b of list){
     if(b.uid===winnerUid)continue;
     const amt=Math.max(0,Math.floor(Number(b.amount)||0));
     if(!b.uid||amt<1)continue;
     refundBidTx(tx,b,aid,a.name||"");
    }
   };
   if(!winner||total<meta){
    refund(bids,null);
    tx.set(aRef,{status:"ended",result:{winnerUid:null,winnerName:null,winnerAmount:0,totalRaised:total,endedAt:serverTimestamp(),auto:true},updatedAt:serverTimestamp()},{merge:true});
   }else{
    refund(bids,winner.uid);
    tx.set(aRef,{status:"ended",result:{winnerUid:winner.uid,winnerName:winner.displayName||winner.uid||"—",winnerAmount:Math.max(0,Math.floor(Number(winner.amount)||0)),totalRaised:total,endedAt:serverTimestamp(),auto:true},updatedAt:serverTimestamp()},{merge:true});
   }
  });
 }catch(e){console.error("Fechamento automático do leilão:",e)}
 finally{settlingAuctions.delete(aid);try{renderAuctions()}catch(e){}}
}
function settleExpiredAuctions(){
 auctions.filter(a=>a.status==="open"&&a.endAt&&tme(a.endAt)<Date.now())
  .forEach((a,i)=>setTimeout(()=>settleAuction(a.id),i*800));
}
async function placeBid(aid){
 if(!termsOk())return askTerms();
 const a=auctions.find(x=>x.id===aid);
 if(!a)return;
 if(!currentUser?.emailVerified)return toast("Entre com uma conta verificada.");
 if(!profileOk())return toast("Salve seus dados de perfil primeiro.");
 if(a.status!=="open")return toast("Este leilão não está aberto.");
 if(a.endAt&&tme(a.endAt)<Date.now())return toast("O prazo deste leilão terminou.");
 const ev=a.eventId?events.find(x=>x.id===a.eventId):null;
 if(ev&&evState(ev)!=="active")return toast(evState(ev)==="future"?"O evento deste leilão ainda não começou.":"O evento deste leilão já foi encerrado.");
 if(ev&&!myJoins.has(ev.id))return toast("Pague a entrada do evento "+ev.name+" antes de dar lances.");
 const input=document.querySelector('[data-bidamt="'+aid+'"]');
 const amt=Math.floor(Number(input?.value));
 if(input)input.value="";
 if(!Number.isInteger(amt)||amt<1)return toast("Informe um lance válido.");
 /* moeda do lance: reais (padrão) ou diamantes (1 diamante = R$ 1,00) */
 const bidCur=document.querySelector('[data-bidcur="'+aid+'"]')?.value==="diamond"?"diamond":"brl";
 const min=Math.max(1,Math.floor(Number(a.minBid)||1));
 const uid=currentUser.uid,bRef=doc(db,"bids",aid+"_"+uid),wRef=doc(db,"wallets",uid);
 try{
  await runTransaction(db,async tx=>{
   /* revalida o leilão DENTRO da transação (status e prazo): antes, a única
      checagem era fora, e um leilão encerrado no meio aceitava o lance */
   const [bs,ws,as]=await Promise.all([tx.get(bRef),tx.get(wRef),tx.get(doc(db,"auctions",aid))]);
   if(!as.exists()||as.data().status!=="open")throw new Error("Este leilão não está mais aberto.");
   const aEnd=as.data().endAt?validDate(as.data().endAt):null;
   if(aEnd&&aEnd.getTime()<Date.now())throw new Error("O prazo deste leilão terminou.");
   const prevB=bs.exists()?Math.max(0,Math.floor(Number(bs.data().amtB??(bs.data().cur==="diamond"?0:bs.data().amount))||0)):0;
   const prevD=bs.exists()?Math.max(0,Math.floor(Number(bs.data().amtD??bs.data().dQty)||0)):0;
   const prev=prevB+prevD;
   if(prev===0&&amt<min)throw new Error("O lance mínimo é de "+fmtBRL(min)+".");
   const wd=ws.exists()?ws.data():{};
   if(bidCur==="diamond"){
    /* lance em DIAMANTES: 1 diamante = R$ 1,00. Debita os diamantes e
       registra o equivalente em reais para o ranking do leilão. */
    const haveD=Math.max(0,Math.floor(Number(wd.diamonds)||0));
    if(haveD<amt)throw new Error("Diamantes insuficientes: você tem "+haveD+" diamante(s). Compre diamantes no Market (aba Pacotes) ou dê o lance em reais.");
    tx.set(wRef,{...wd,diamonds:haveD-amt,updatedAt:serverTimestamp()},{merge:true});
    tx.set(bRef,{auctionId:aid,uid,displayName:profile?.name||"",photo:myPhoto(),amount:prev+amt,amtB:prevB,amtD:prevD+amt,dQty:prevD+amt,cur:"diamond",updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",uid,"history")),{kind:"xc_spend",amount:0,xcKind:"diamond",xcQty:amt,auctionId:aid,auctionName:a.name||"",reason:"Lance no leilão \""+(a.name||"")+"\" pago com diamantes ("+amt+" diamante(s))",createdAt:serverTimestamp()});
   }else{
    const spend=spendValue(wd,amt);
    if(!spend)throw new Error("Saldo insuficiente na carteira. Conclua tarefas para ganhar mais reais.");
    tx.set(wRef,{...applySpend(wd,spend),updatedAt:serverTimestamp()},{merge:true});
    tx.set(bRef,{auctionId:aid,uid,displayName:profile?.name||"",photo:myPhoto(),amount:prev+amt,amtB:prevB+amt,amtD:prevD,dQty:prevD,cur:"brl",updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",uid,"history")),{kind:"auction_bid",amount:amt,auctionId:aid,auctionName:a.name||"",createdAt:serverTimestamp()});
   }
  });
  toast(bidCur==="diamond"?("Lance de "+amt+" diamante(s) (≈ "+fmtBRL(amt)+") registrado no leilão \""+(a.name||"")+"\"! Boa sorte com o prêmio "+(a.prize||"")+"."):("Lance de "+fmtBRL(amt)+" registrado no leilão \""+(a.name||"")+"\"! Boa sorte com o prêmio "+(a.prize||"")+"."));
 }catch(e){toast(e.message||"Erro ao registrar o lance.")}
}
$("aprev").onclick=()=>{const el=$("aucs");if(el)slide(el,-1)};
$("anext").onclick=()=>{const el=$("aucs");if(el)slide(el,1)};
$("autabs").onclick=e=>{const v=e.target.dataset.v;if(v){aucView=v;watchAuctionBids();$("autabs").querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.v===v));renderAuctions()}};
document.addEventListener("click",e=>{
 const info=e.target.dataset?.info;
 if(info){const el=document.getElementById(info);if(el)el.hidden=!el.hidden;return}
 if(e.target.dataset?.evjoin)return joinEvent(e.target.dataset.evjoin);
 if(e.target.dataset?.bid)return placeBid(e.target.dataset.bid);
 if(e.target.dataset?.claim)return claimAuction(e.target.dataset.claim);
});
document.addEventListener("click",async e=>{
 const id=e.target.dataset.req;if(!id)return;
 if(!termsOk())return askTerms();
 try{
  if(!currentUser?.emailVerified)return toast("Entre com uma conta verificada.");
  if(!profileOk())return toast("Salve seus dados de perfil primeiro.");
  const t=tasks.find(x=>x.id===id);
  if(!t||taskState(t)!=="on")return toast("Esta tarefa não está disponível agora.");
  const leftVagas=stockOf(t);
  if(leftVagas!==null&&leftVagas<=0)return toast("Esta oferta esgotou as vagas. Fique de olho nas próximas!");
  const ref=doc(db,"taskClaims",currentUser.uid+"_"+id),old=await getDoc(ref);
  if(old.exists()&&["pending","approved"].includes(old.data().status))return toast("Você já solicitou esta tarefa.");
  /* prova: lê os campos da área de trabalho da tarefa */
  const box=e.target.closest(".task");
  const pt=t.proofType||"text";
  let proof="",proofText="",proofCode="",proofImage="",proofVideo="",proofWhen="";
  const g=k=>String(box?.querySelector("[data-proof-"+k+"]")?.value||"").trim();
  if(t.proofReq){
   /* novo modelo: tipos exigidos definidos no formulário guiado do painel */
   const pr=t.proofReq;
   proofText=g("text").slice(0,1000);proofCode=g("code").slice(0,300);proofImage=g("image").slice(0,600);proofVideo=g("video").slice(0,600);proofWhen=g("when").slice(0,40);
   proof=proofText||proofCode||proofImage||proofVideo||proofWhen;
   if(!proof)return toast("Abra a prova da tarefa e preencha os campos exigidos.");
   const vals={text:proofText,code:proofCode,image:proofImage,video:proofVideo,datetime:proofWhen};
   const enabled=Object.keys(pr).filter(k=>pr[k]);
   const provided=enabled.filter(k=>String(vals[k]||"").trim()).length;
   const min=Math.max(1,Math.floor(Number(t.minProofs)||1));
   if(provided<min)return toast("Prova incompleta: envie "+min+" prova(s) — você preencheu "+provided+".");
   if((proofImage&&!/^https?:\/\//i.test(proofImage))||(proofVideo&&!/^https?:\/\//i.test(proofVideo)))return toast("Os links do print e da gravação devem começar com http:// ou https://.");
  }else if(t.requiresProof!==false){
   if(pt==="name"){
    proof=(profile?.name||"").trim();
    if(!proof)return toast("Salve seu nome no perfil antes.");
   }else{
    proofText=g("text").slice(0,1000);proofCode=g("code").slice(0,300);proofImage=g("image").slice(0,600);proofVideo=g("video").slice(0,600);
    proof=proofText||proofCode||proofImage||proofVideo;
    if(!proof)return toast("Abra a prova da oferta e preencha pelo menos um campo.");
    if(pt==="email"&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(proof))return toast("Informe um e-mail válido.");
    if((proofImage&&!/^https?:\/\//i.test(proofImage))||(proofVideo&&!/^https?:\/\//i.test(proofVideo)))return toast("Os links do print e da gravação devem começar com http:// ou https://.");
   }
  }
  const data={uid:currentUser.uid,email:currentUser.email||"",taskId:id,eventId:t.eventId||"",taskName:t.serviceLabel||t.name||"",source:t.source||"",ownerUid:t.ownerUid||"",ownerName:t.ownerName||"",participantName:profile.name,proof,proofText,proofCode,proofImage,proofVideo,proofWhen,status:"pending",submittedAt:serverTimestamp()};
  if(old.exists())await updateDoc(ref,data);else await setDoc(ref,data);
  /* reserva a vaga na hora do envio (reabre se a prova for negada) */
  if(t.stock>0 && t.autoApprove!==true){
    try{
      await runTransaction(db,async tx=>{
        const ts=await tx.get(doc(db,"tasks",id));
        const td=ts.exists()?ts.data():{};
        const totT=Math.max(0,Math.floor(Number(td.stock)||0));
        const leftT=Number.isFinite(Number(td.stockLeft))?Math.floor(Number(td.stockLeft)):totT;
        if(leftT<=0)throw new Error("Esta oferta esgotou as vagas agora mesmo.");
        tx.set(doc(db,"tasks",id),{stockLeft:Math.max(0,leftT-1),updatedAt:serverTimestamp()},{merge:true});
      });
    }catch(err){console.warn("Reserva de vaga:",err); /* claim já gravado; admin/colaborador vê */}
  }
  box?.querySelectorAll("[data-proof-text],[data-proof-code],[data-proof-image],[data-proof-video],[data-proof-when]").forEach(i=>i.value="");
  /* se o envio veio da área de trabalho, fecha para o participante ver o resultado no card */
  if(box&&box.closest("#ws"))closeWorkspace();
  /* aprovação automática (definida no painel): credita a carteira na hora */
  if(t.autoApprove===true){
   const rd=Math.max(0.01,Math.round((Number(t.reward)||0.01)*100)/100),ty=t.ticketType||"common";
   const rdB=boosted(rd,"taskBoost");
   const rc=t.rewardCur||"brl";
   const wRef=doc(db,"wallets",currentUser.uid);
   /* fichas (moedas/bilhetes/diamantes): credita o campo próprio da carteira
      e registra no histórico com kind xc_reward — o real continua o centro */
   const xcField=rc==="coin"?"coins":rc==="ticket"?"tickets":rc==="diamond"?"diamonds":null;
   try{
    await runTransaction(db,async tx=>{
     const cs=await tx.get(ref);
     if(!cs.exists()||cs.data().status!=="pending")return;
     /* baixa de estoque lida DENTRO da transação, com leitura fresca do doc:
        antes usava stockOf(t) calculado fora, e duas aprovações simultâneas
        gravavam o mesmo número → vagas vendidas além do limite */
     if(t.stock>0){
      const ts=await tx.get(doc(db,"tasks",id));
      const td=ts.exists()?ts.data():{};
      const totT=Math.max(0,Math.floor(Number(td.stock)||0));
      const leftT=Number.isFinite(Number(td.stockLeft))?Math.floor(Number(td.stockLeft)):totT;
      if(leftT<=0)throw new Error("Esta oferta esgotou as vagas agora mesmo. Fique de olho nas próximas!");
      tx.set(doc(db,"tasks",id),{stockLeft:Math.max(0,leftT-1),updatedAt:serverTimestamp()},{merge:true});
     }
     if(xcField){
      tx.set(wRef,{[xcField]:increment(rdB),updatedAt:serverTimestamp()},{merge:true});
      tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"xc_reward",amount:rdB,xcKind:xcField,xcQty:rdB,taskId:id,taskName:t.name||"",eventName:"",createdAt:serverTimestamp()});
      tx.update(ref,{status:"approved",reviewedAt:serverTimestamp(),reward:rdB,rewardCur:rc,ticketType:ty,autoApproved:true});
     }else{
      tx.set(wRef,{[ty]:increment(rdB),updatedAt:serverTimestamp()},{merge:true});
      tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"reward",amount:rdB,ticketType:ty,taskId:id,taskName:t.name||"",eventName:"",createdAt:serverTimestamp()});
      tx.update(ref,{status:"approved",reviewedAt:serverTimestamp(),reward:rdB,rewardCur:rc,ticketType:ty,autoApproved:true});
     }
    });
    return toast(xcField?("Tarefa aprovada automaticamente! "+XC_LABEL[rc]+" creditados na carteira <i class=yi data-i=spark></i>"):"Tarefa aprovada automaticamente! Reais creditados na carteira <i class=yi data-i=spark></i>");
   }catch(err){showError(err);return}
  }
  toast("Comprovante enviado para análise.");
 }catch(err){showError(err)}
});

/* ============================================================
   15 · REGRAS DE PARTICIPAÇÃO
   ============================================================ */
const freeNumbers=()=>{const r=[];for(let n=1;n<=TOTAL;n++)if(!taken.has(n))r.push(n);return r};
/* evento do sorteio atual: o sorteio pertence a um evento (draw.eventId).
   Para participar é preciso que o evento esteja ativo E ter confirmado a entrada dele. */
const evOfDraw=()=>{const d=draws.find(x=>x.id===drawId);const eid=d?.eventId;return eid?events.find(x=>x.id===eid):null};
const eventOk=()=>{const ev=evOfDraw();return !ev||(evState(ev)==="active"&&myJoins.has(ev.id))};
function canParticipate(){
 /* canReserveCount()>0 = saldo cobre 1 número. A comparação antiga com
    mine().length travava quem recebeu reembolso de sorteios encerrados. */
 return !!(ready()&&drawId&&currentUser?.emailVerified&&!profile?.banned&&profileOk()&&canReserveCount()>0&&drawState()==="open"&&eventOk());
}

/* ============================================================
   16 · SELETOR DE NÚMERO
   ============================================================ */
function refreshSugg(force){
 const free=freeNumbers();
 sugg=force?[]:sugg.filter(n=>!taken.has(n));
 while(sugg.length<Math.min(5,free.length)){const n=free[Math.floor(Math.random()*free.length)];if(!sugg.includes(n))sugg.push(n)}
 sugg.sort((a,b)=>a-b);
}
$("sugg").addEventListener("click",e=>{
 const b=e.target.closest("[data-n]");
 if(b){$("numin").value=b.dataset.n;validateNumber()}
 if(e.target.id==="more"){refreshSugg(true);renderSugg()}
});
function renderSugg(){
 $("sugg").innerHTML=sugg.length?'<span class="hint">Livres:</span>'+sugg.map(n=>`<button class="chip" data-n="${n}">${pad(n,String(TOTAL).length)}</button>`).join("")+'<button class="link" id="more">Outras</button>':"";
}
$("numin").addEventListener("input",()=>{$("numin").value=$("numin").value.replace(/\D/g,"").slice(0,String(TOTAL).length);validateNumber()});
function validateNumber(){
 const v=$("numin").value,n=Number(v),ok=Number.isInteger(n)&&n>=1&&n<=TOTAL,occ=ok&&taken.has(n),el=$("nstat");
 if(!v){el.textContent="";el.className="nstat"}
 else if(!ok){el.textContent="Escolha um número entre 1 e "+TOTAL+".";el.className="nstat bad"}
 else if(occ){el.textContent="Este número já foi reservado. Escolha outro.";el.className="nstat bad"}
 else{el.textContent="Este número está livre. Toque em Confirmar número para reservar.";el.className="nstat ok"}
 $("confirm").disabled=!canParticipate()||!ok||occ||busy;
}
$("random").onclick=()=>{
 if(!canParticipate())return;
 const f=freeNumbers();
 if(!f.length)return toast("Todos os números foram reservados.");
 $("numin").value=String(f[Math.floor(Math.random()*f.length)]);validateNumber();
};
$("confirm").onclick=()=>{const n=Number($("numin").value);if(canParticipate()&&n>=1&&n<=TOTAL&&!taken.has(n)){armed=n;render()}};
$("no").onclick=()=>{armed=0;render()};

/* ============================================================
   17 · RESERVA ATÔMICA DO NÚMERO (transação Firestore)
   Nota: consome o saldo por VALOR (todas as categorias valem R$ 1,00),
   usando primeiro o troco, depois comuns, dourados e VIPs. O que sobra vira troco.
   As regras do Firestore devem revalidar período (request.time), saldo e disponibilidade. */
$("yes").onclick=async()=>{
 if(!termsOk())return askTerms();
 const number=armed;
 if(!canParticipate()||busy||!number)return toast("Não foi possível confirmar agora. Confira seu progresso.");
 const payTk=!!document.getElementById("paytick")?.checked;
 busy=true;render();
 try{
  /* ID canônico SEM padding: o formato antigo (_n007) dependia da quantidade
     de dígitos de totalNumbers — se o painel mudasse o total, o mesmo número
     virava outro documento e podia ser reservado 2x. Os formatos antigos
     ainda são verificados para respeitar reservas já existentes. */
  const resvDocId=(did,n)=>did+"_n"+n;
  const resvLegacyIds=(did,n)=>{const r=[];for(let w=2;w<=6;w++){const id=did+"_n"+pad(n,w);if(id!==resvDocId(did,n))r.push(id)}return r};
  const uid=currentUser.uid,wRef=doc(db,"wallets",uid),uRef=doc(db,"users",uid),dRef=doc(db,"draws",drawId),
   rRef=doc(db,"reservations",resvDocId(drawId,number)),
   rOld=resvLegacyIds(drawId,number).map(id=>doc(db,"reservations",id));
  await runTransaction(db,async tx=>{
   const gets=[tx.get(wRef),tx.get(uRef),tx.get(rRef),tx.get(dRef)].concat(rOld.map(r=>tx.get(r)));
   const sn=await Promise.all(gets);
   const [ws,us,rs,ds]=sn;
   if(!Number.isInteger(number)||number<1||number>TOTAL)throw new Error("Número inválido.");
   if(!ds.exists()||ds.data().status!=="open")throw new Error("Este sorteio não está aberto para reservas.");
   if(rs.exists()||sn.slice(4).some(s=>s.exists()))throw new Error("Este número acabou de ser reservado por outra pessoa. Escolha outro.");
   if(!us.exists())throw new Error("Perfil não encontrado.");
   const ud=us.data(),have=Array.isArray(ud.numbers)?ud.numbers:[];
   if(!ud.name||ud.name.trim().length<3)throw new Error("Seu perfil precisa estar completo.");
   const wd=ws.exists()?ws.data():{};
   /* a limitação de saldo é feita APENAS pelo débito real na carteira
      (spendValue). A checagem antiga have.length >= saldo/COST travava para
      sempre quem recebeu reembolso de sorteios anteriores. */
   let wPatch=null,hist=null;
   if(payTk){
    /* pagamento com BILHETES: 1 bilhete = R$ 0,50. O custo do número precisa
       fechar em múltiplos exatos de R$ 0,50 — bilhetes nunca viram reais. */
    const tkNeed=Math.round(COST/0.5);
    if(Math.abs(tkNeed*0.5-COST)>0.004)throw new Error("Pagamento com bilhetes disponível apenas para números cujo custo fecha em múltiplos de R$ 0,50 (este número custa "+fmtBRL(COST)+").");
    const haveTk=Math.max(0,Math.floor(Number(wd.tickets)||0));
    if(haveTk<tkNeed)throw new Error("Bilhetes insuficientes: este número custa "+tkNeed+" bilhete(s) e você tem "+haveTk+". Compre bilhetes no Market (aba Pacotes) ou pague em reais.");
    wPatch={...wd,tickets:haveTk-tkNeed,updatedAt:serverTimestamp()};
    hist={kind:"xc_spend",amount:0,xcKind:"ticket",xcQty:tkNeed,drawId,drawName:draw?.name||"",reason:"Reserva do número "+pad(number,String(TOTAL).length)+" paga com bilhetes ("+tkNeed+" bilhete(s))",createdAt:serverTimestamp()};
   }else{
    const spend=spendValue(wd,COST);
    if(!spend)throw new Error("Saldo insuficiente. Conclua mais tarefas para ganhar reais.");
    wPatch={...applySpend(wd,spend),updatedAt:serverTimestamp()};
    hist={kind:"reserve",amount:COST,drawId,drawName:draw?.name||"",createdAt:serverTimestamp()};
   }
   tx.set(rRef,{drawId,number,uid,displayName:maskName(ud.name),photo:myPhoto(),paidWith:payTk?"ticket":"brl",createdAt:serverTimestamp()});
   tx.set(wRef,wPatch,{merge:true});
   tx.update(uRef,{numbers:[...have,number],numberAssignedAt:serverTimestamp()});
   tx.set(doc(collection(db,"wallets",uid,"history")),hist);
  });
  $("numin").value="";toast("Número "+pad(number,String(TOTAL).length)+" reservado com sucesso.");
 }catch(e){showError(e)}
 finally{busy=false;armed=0;render()}
};

/* ============================================================
   18 · COMPROVANTE OFICIAL (comprovante do participante)
   ============================================================ */
const ticketCode=(n,uid)=>"YS"+pad(n,String(TOTAL).length)+"-"+uid.slice(0,6).toUpperCase();
$("copy-proof").onclick=()=>copyText($("proof").value);
/* situação de um bilhete: participando, ganhador, não ganhador ou expirado */
function ticketStatus(t){
 const d=t.drawId?draws.find(x=>x.id===t.drawId):null;
 if(!d)return{state:"expired",label:"Expirado",cls:"r",canDelete:true,why:"O sorteio foi removido e o número não vale mais."};
 const ev=d.eventId?events.find(x=>x.id===d.eventId):null;
 if(ev&&ev.active===false)return{state:"expired",label:"Expirado",cls:"r",canDelete:true,why:"O evento "+ev.name+" ficou inativo e o número não vale mais."};
 const res=Array.isArray(d.result?.winners)?d.result.winners:[];
 if(d.status==="ended"||res.length){
  const win=res.find(w=>Number(w.number)===Number(t.number));
  if(win)return{state:"won",label:"<i class=yi data-i=trophy></i> Ganhador",cls:"g",canDelete:false,prize:win.prize||""};
  return{state:"lost",label:"Não ganhador",cls:"",canDelete:true,why:"O sorteio foi encerrado e este número não foi sorteado."};
 }
 return{state:"active",label:"Em andamento",cls:"y",canDelete:false};
}
/* código de barras decorativo gerado a partir do código do bilhete */
function barcodeSVG(code){
 const s=String(code||"YS");let x=0,bars="";
 for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);for(let j=0;j<5;j++){const w=((c>>j)&1)+1;if(j%2===0)bars+=`<rect x="${x}" y="0" width="${w}" height="24"/>`;x+=w+1}}
 return `<svg class="tk-bar" viewBox="0 0 ${x} 24" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
}
function tkCardHTML(o){
 const stamp=o.state==="won"?'<span class="tk-stamp g">Premiado</span>':o.state==="expired"?'<span class="tk-stamp r">Expirado</span>':o.state==="lost"?'<span class="tk-stamp">Encerrado</span>':o.state==="active"?'<span class="tk-stamp y">Válido</span>':"";
 return `<div class="tkc" data-st="${o.state}">
  <span class="tk-wm" aria-hidden="true">Y</span>
  <div class="tk-top"><span class="label"><i class=yi data-i=ticket></i> Comprovante oficial</span>${o.label?`<span class="tag ${o.cls||""}">${o.label}</span>`:""}</div>
  <div class="tk-nrow"><div><span class="tk-nlab">Número da sorte</span><div class="num${o.empty?" empty":""}">${o.num}</div></div>${stamp}</div>
  <div class="of mono">${o.line}</div>
  ${o.extra||""}
  <div class="tk-cut" aria-hidden="true"></div>
  ${o.rows||""}
  ${o.code?barcodeSVG(o.code)+`<div class="tk-serial"><span>${esc(o.code)}</span><span>Série ${esc(o.serial||"A")}</span></div>`:""}
  ${o.when?`<div class="tk-when mono">${o.when}</div>`:""}
  ${o.after||""}
 </div>`;
}
function renderTicket(done){
 const name=profile?.name||"Aguardando";
 /* seletor de filtro dos bilhetes */
 [...$("tktabs").children].forEach(b=>b.classList.toggle("on",b.dataset.f===tkFilter));
 let list=myTickets.filter(t=>ticketStatus(t).state===tkFilter);
 const total=myTickets.length;
 /* badge e progresso do bloco "Bilhete oficial" removidos da interface */
 const dname=draw?.name||"Sorteio";
 const evn=draw?.eventId?events.find(x=>x.id===draw.eventId)?.name:null;
 const ofLine=esc(dname)+(evn?" · "+esc(evn):"");
 const emptyCard=(msg)=>tkCardHTML({state:"empty",num:"---",empty:true,line:esc(dname)+" · 001 a "+TOTAL,
  rows:`<div class="kv"><span>Titular</span><b>${currentUser?esc(maskName(name)):"Aguardando"}</b></div><div class="kv"><span>Evento</span><b>${evn?esc(evn):"—"}</b></div><p class="hint" style="margin:0">${msg}</p>`});
 const pzBox=pz=>pz.length?`<div class="tk-prize"><span>Prêmio em disputa</span><b><i class=yi data-i=gift></i> ${esc(pz[0].name)}${pz[0].value?" · "+esc(pz[0].value):""}${pz.length>1?" · +"+(pz.length-1)+" outro(s)":""}</b></div>`:"";
 const evBox=n=>n?`<div class="tk-prize"><span>Evento de origem</span><b><i class=yi data-i=calendar></i> ${esc(n)}</b></div>`:"";
 if(currentUser&&total){
  $("tks").innerHTML=list.length?list.map(t=>{
   const st=ticketStatus(t);
   const d=t.drawId?draws.find(x=>x.id===t.drawId):null;
   const ev=d?.eventId?events.find(x=>x.id===d.eventId):null;
   const pz=Array.isArray(d?.prizes)?d.prizes.filter(x=>x&&x.name):[];
   return tkCardHTML({state:st.state,cls:st.cls,label:st.label,
    num:pad(Number(t.number)||0,String(Math.floor(Number(d?.totalNumbers))||150).length),
    line:esc(d?.name||"Sorteio removido")+(ev?" · "+esc(ev.name):""),
    extra:pzBox(pz)+evBox(ev?.name),
    code:ticketCode(Number(t.number),currentUser.uid),serial:(t.drawId||"").slice(0,4).toUpperCase(),
    rows:`<div class="kv"><span>Titular</span><b>${esc(maskName(t.displayName||name))}</b></div><div class="kv"><span>Valor pago</span><b>${fmtBRL(Math.max(1,Math.floor(Number(d?.ticketCost))||1))}</b></div><div class="kv"><span>Situação</span><b>${st.state==="won"?"<i class=yi data-i=trophy></i> "+esc(st.prize||"Ganhador"):esc(st.why||st.label)}</b></div>`,
    when:"Reservado em "+(t.createdAt?.toDate?fmt(t.createdAt.toDate()):"—"),
    after:st.canDelete?`<button class="btn ghost sm tk-del" data-delticket="${esc(t.id)}"><i class=yi data-i=trash></i> Excluir este número</button>`:""});
  }).join(""):emptyCard("Nenhum número neste filtro.");
 }else if(currentUser){
  const ns=mine();
  $("tks").innerHTML=ns.length?ns.map(n=>{
   const fi=feedItems.find(i=>i.number===n);
   const pz=Array.isArray(draw?.prizes)?draw.prizes.filter(x=>x&&x.name):[];
   return tkCardHTML({state:"active",cls:"y",label:"Em andamento",num:pad(n,String(TOTAL).length),line:ofLine,
    extra:pzBox(pz)+evBox(evn),code:ticketCode(n,currentUser.uid),serial:(drawId||"").slice(0,4).toUpperCase(),
    rows:`<div class="kv"><span>Titular</span><b>${esc(maskName(name))}</b></div><div class="kv"><span>Situação</span><b>Participando do sorteio</b></div>`,
    when:"Reservado em "+(fi?.createdAt?.toDate?fmt(fi.createdAt.toDate()):"—")});
  }).join(""):emptyCard(currentUser.emailVerified?"Você ainda não tem números reservados. Conclua tarefas para participar!":"Confirme seu e-mail para começar.");
 }else{
  $("tks").innerHTML=emptyCard("Entre ou crie sua conta para reservar seu número.");
 }
 const shown=$("tks").children.length;
 $("tk-count").textContent="1/"+Math.max(1,shown);
 /* apuração e etapas do bloco do bilhete removidas junto com ele */
 const nsNow=mine();
 if(nsNow.length){
  const p="Yshippcommerce | "+dname+" | Número"+(nsNow.length>1?"s ":" ")+nsNow.map(x=>pad(x,String(TOTAL).length)).join(", ")+" | "+name+" | Código "+ticketCode(nsNow[0],currentUser?.uid||"");
  $("proof").value=p;$("share-wa").href="https://wa.me/?text="+encodeURIComponent(p+" | "+location.href);
 }
}
/* setas e contador do carrossel de bilhetes */
$("tkprev").onclick=()=>slide($("tks"),-1);
$("tknext").onclick=()=>slide($("tks"),1);
/* botão "Meus bilhetes" dentro da gaveta de Sorteios: abre/fecha o carrossel */
if($("tks-toggle"))$("tks-toggle").onclick=()=>{
 const box=$("tks-box"),btn=$("tks-toggle");
 const open=box.hidden;
 box.hidden=!open;
 btn.setAttribute("aria-expanded",open?"true":"false");
 btn.innerHTML=open?"<i class=yi data-i=ticket></i> Meus números — fechar carrossel":"<i class=yi data-i=ticket></i> Meus números — abrir carrossel";
};
$("tks").addEventListener("scroll",()=>{const el=$("tks");if(!el.children.length)return;const i=Math.min(el.children.length-1,Math.round(el.scrollLeft/((el.firstElementChild?.getBoundingClientRect().width||246)+10)));$("tk-count").textContent=(i+1)+"/"+el.children.length},{passive:true});
/* filtro dos bilhetes */
$("tktabs").onclick=e=>{const f=e.target.dataset.f;if(f){tkFilter=f;renderTicket([true,true,true,mine().length>0])}};
/* excluir bilhete inútil (sorteio removido / encerrado sem prêmio / evento inativo) */
$("tks").addEventListener("click",async e=>{
 const id=e.target.dataset&&e.target.dataset.delticket;
 if(!id)return;
 const t=myTickets.find(x=>x.id===id);
 if(!t)return;
 askConfirm("Excluir este número? Ele não serve mais para nada e a ação não pode ser desfeita.","Excluir número",async()=>{
 try{
  await deleteDoc(doc(db,"reservations",id));
  if(Array.isArray(profile?.numbers)&&profile.numbers.includes(Number(t.number)))
   await updateDoc(doc(db,"users",currentUser.uid),{numbers:arrayRemove(Number(t.number))}).catch(()=>{});
  toast("Número excluído.");
 }catch(err){showError(err)}
 },"Excluir agora");
});

/* ============================================================
   19 · RESULTADO OFICIAL (em andamento · ganhadores · encerrados)
   ============================================================ */
let resView="running";
function renderResult(){
 const el=$("res");if(!el)return;
 [...$("rtabs").children].forEach(b=>b.classList.toggle("on",b.dataset.v===resView));
 const openDraws=draws.filter(d=>drawStateOf(d)==="open");
 const openAuc=auctions.filter(a=>a.status==="open");
 const endedDraws=draws.filter(d=>d.status==="ended"||drawStateOf(d)==="ended");
 const endedAuc=auctions.filter(a=>a.status==="ended");
 const endedEv=events.filter(e=>evState(e)==="ended");
 const winDraws=draws.filter(d=>Array.isArray(d.result?.winners)&&d.result.winners.length);
 const winAuc=auctions.filter(a=>a.result&&a.result.winnerUid);
 let tag="Em andamento",cls="tag y";
 if(winDraws.length||winAuc.length){tag="Publicado";cls="tag g"}
 else if(!openDraws.length&&!openAuc.length){tag="Encerrados";cls="tag"}
 $("res-tag").textContent=tag;$("res-tag").className=cls;
 $("res-sub").textContent=(winDraws.length+winAuc.length)+" ganhador(es) publicado(s) · "+(openDraws.length+openAuc.length)+" disputa(s) em andamento.";
 const evName=id=>id?(events.find(e=>e.id===id)?.name||""):"";
 const n0=v=>Math.max(0,Math.floor(Number(v)||0));
 const totN=d=>Math.floor(Number(d.totalNumbers))||150;
 const pzList=d=>Array.isArray(d.prizes)?d.prizes.filter(x=>x&&x.name):[];
 const pzSum=d=>pzList(d).reduce((s,p)=>s+parseMoney(p.value),0);
 const grp=(t,n)=>`<div class="rgrp"><b>${t}</b><span class="tag">${n}</span></div>`;
 const row=(pos,main,sub,val,vsub,win)=>`<div class="rx ${win?"win":""}"><span class="rp">${pos}</span><div class="rm"><b>${main}</b><small>${sub}</small></div><div class="rv"><b>${val}</b>${vsub?`<small>${vsub}</small>`:""}</div></div>`;
 const empty=t=>`<div class="foot">${t}</div>`;
 const aucBids=a=>aucBidsOf(a.id);
 let html="";
 if(resView==="running"){
  html+=grp("<i class=yi data-i=ticket></i> Sorteios em andamento",openDraws.length);
  html+=openDraws.length?openDraws.map(d=>{
   const ev=evName(d.eventId),pz=pzList(d),sum=pzSum(d);
   return row("<i class=yi data-i=ticket></i>",esc(d.name||"Sorteio"),[ev?"<i class=yi data-i=calendar></i> Evento "+esc(ev):"",pz.length?pz.length+" prêmio(s) · principal: "+esc(pz[0].name)+(sum>0?" · total "+fmtBRL(sum):""):"prêmios a divulgar","custo "+fmtBRL(Math.max(1,n0(d.ticketCost)))+" por número","encerra "+(validDate(d.endAt)?fmt(d.endAt):"—"),d.drawDate?"apuração "+fmt(d.drawDate):""].filter(Boolean).join(" · "),resvCount(d.id)+"/"+totN(d),"números reservados");
  }).join(""):empty("Nenhum sorteio em andamento agora.");
  html+=grp("<i class=yi data-i=scale></i> Leilões em andamento",openAuc.length);
  html+=openAuc.length?openAuc.map(a=>{
   const bids=aucBids(a),lead=[...bids].sort((x,y)=>(Number(y.amount)||0)-(Number(x.amount)||0))[0];
   const tot=Math.max(1,n0(a.totalTickets)||1),raised=bids.reduce((s,b)=>s+n0(b.amount),0),ev=evName(a.eventId);
   return row("<i class=yi data-i=scale></i>",esc(a.name||"Leilão"),[a.prize?"<i class=yi data-i=gift></i> Prêmio: "+esc(a.prize):"",ev?"<i class=yi data-i=calendar></i> Evento "+esc(ev):"",lead?"líder: "+esc(maskName(lead.displayName||"—"))+" com "+fmtBRL(n0(lead.amount)):"sem lances ainda",bids.length+" participante(s)","lance mínimo "+fmtBRL(Math.max(1,n0(a.minBid))),a.endAt?"encerra "+fmt(a.endAt):""].filter(Boolean).join(" · "),raised+"/"+tot,Math.min(100,Math.round(raised/tot*100))+"% da meta");
  }).join(""):empty("Nenhum leilão em andamento agora.");
 }else if(resView==="winners"){
  html+=grp("<i class=yi data-i=ticket></i> Ganhadores dos sorteios",winDraws.reduce((s,d)=>s+d.result.winners.length,0));
  html+=winDraws.length?winDraws.map(d=>{
   const ev=evName(d.eventId),pz=pzList(d),t=totN(d);
   const head=`<div class="rsub"><b><i class=yi data-i=ticket></i> ${esc(d.name||"Sorteio")}</b><small>${[ev?"<i class=yi data-i=calendar></i> Evento "+esc(ev):"",resvCount(d.id)+" de "+t+" números reservados",d.drawDate?"apuração "+fmt(d.drawDate):validDate(d.endAt)?"encerrou "+fmt(d.endAt):"",d.result.winners.length+" prêmio(s) apurado(s)",pzSum(d)>0?"total "+fmtBRL(pzSum(d)):""].filter(Boolean).join(" · ")}</small></div>`;
   return head+d.result.winners.map((w,i)=>{
    const p=pz.find(x=>x.name===w.prize)||pz[i];
    const mine=!!currentUser&&myTickets.some(tk=>tk.drawId===d.id&&Number(tk.number)===Number(w.number));
    return row((i+1)+"º",whoHTML(w,(w.displayName||"—").trim().charAt(0))+esc(maskName(w.displayName||"—"))+(mine?' <span class="tag g">Você!</span>':""),"<i class=yi data-i=gift></i> "+esc(w.prize||p?.name||"Prêmio")+(p?" · "+esc(prizeType(p).label)+(p.value?" · "+esc(p.value):""):""),"Nº "+pad(n0(w.number),String(t).length),"número sorteado",mine);
   }).join("");
  }).join(""):empty("Nenhum ganhador de sorteio publicado ainda.");
  html+=grp("<i class=yi data-i=scale></i> Ganhadores dos leilões",winAuc.length);
  html+=winAuc.length?winAuc.map(a=>{
   const r=a.result,ev=evName(a.eventId),tot=Math.max(1,n0(a.totalTickets)||1),mine=!!currentUser&&r.winnerUid===currentUser.uid;
   return row("<i class=yi data-i=trophy></i>",whoHTML({uid:r.winnerUid,photo:r.winnerPhoto},(r.winnerName||"—").trim().charAt(0))+esc(maskName(r.winnerName||"—"))+(mine?' <span class="tag g">Você!</span>':""),["<i class=yi data-i=scale></i> "+esc(a.name||"Leilão"),a.prize?"<i class=yi data-i=gift></i> "+esc(a.prize):"",ev?"<i class=yi data-i=calendar></i> Evento "+esc(ev):"","arrecadado "+fmtBRL(n0(r.totalRaised))+" de "+fmtBRL(tot),n0(r.winnerAmount)>=tot?"meta atingida (arremate imediato)":"maior lance no prazo",r.endedAt?"encerrado "+fmt(r.endedAt):""].filter(Boolean).join(" · "),fmtBRL(n0(r.winnerAmount)),"lance vencedor",mine);
  }).join(""):empty("Nenhum ganhador de leilão publicado ainda.");
 }else{
  html+=grp("<i class=yi data-i=ticket></i> Sorteios encerrados",endedDraws.length);
  html+=endedDraws.length?endedDraws.map(d=>{
   const w=Array.isArray(d.result?.winners)?d.result.winners:[],ev=evName(d.eventId),pz=pzList(d),sum=pzSum(d);
   return row("<i class=yi data-i=ticket></i>",esc(d.name||"Sorteio"),[ev?"<i class=yi data-i=calendar></i> Evento "+esc(ev):"",resvCount(d.id)+" de "+totN(d)+" números reservados",pz.length?pz.length+" prêmio(s)"+(sum>0?" · "+fmtBRL(sum):""):"",validDate(d.endAt)?"encerrou "+fmt(d.endAt):""].filter(Boolean).join(" · "),w.length?w.length+" <i class=yi data-i=trophy></i>":"—",w.length?"ganhador(es)":"sem resultado publicado");
  }).join(""):empty("Nenhum sorteio encerrado ainda.");
  html+=grp("<i class=yi data-i=scale></i> Leilões encerrados",endedAuc.length);
  html+=endedAuc.length?endedAuc.map(a=>{
   const r=a.result||{},ev=evName(a.eventId),tot=Math.max(1,n0(a.totalTickets)||1);
   return row("<i class=yi data-i=scale></i>",esc(a.name||"Leilão"),[a.prize?"<i class=yi data-i=gift></i> "+esc(a.prize):"",ev?"<i class=yi data-i=calendar></i> Evento "+esc(ev):"",r.winnerUid?"ganhador: "+esc(maskName(r.winnerName||"—"))+" com "+fmtBRL(n0(r.winnerAmount)):"meta não atingida · lances devolvidos","arrecadado "+fmtBRL(n0(r.totalRaised))+" de "+fmtBRL(tot),r.endedAt?"encerrado "+fmt(r.endedAt):a.endAt?"prazo "+fmt(a.endAt):""].filter(Boolean).join(" · "),r.winnerUid?"Arrematado":"Devolvido",r.winnerUid?"com ganhador":"sem ganhador");
  }).join(""):empty("Nenhum leilão encerrado ainda.");
  html+=grp("<i class=yi data-i=calendar></i> Eventos encerrados",endedEv.length);
  html+=endedEv.length?endedEv.map(e=>{
   const nd=draws.filter(x=>x.eventId===e.id&&x.status!=="draft").length,na=auctions.filter(x=>x.eventId===e.id&&x.status!=="draft").length;
   return row("<i class=yi data-i=calendar></i>",esc(e.name||"Evento"),[validDate(e.endAt)?"encerrou "+fmt(e.endAt):"evento encerrado",nd+" sorteio(s)",na+" leilão(ões)"].join(" · "),"Fim","");
  }).join(""):empty("Nenhum evento encerrado ainda.");
 }
 el.innerHTML=html;
}
$("rtabs").onclick=e=>{const v=e.target.dataset.v;if(v){resView=v;renderResult()}};

/* ============================================================
   20 · ASSISTENTE DE PARTICIPAÇÃO (decide o próximo passo)
   ============================================================ */
function flow(){
 const rd=ready(),st=rd?drawState():"open",v=!!currentUser?.emailVerified,ok=profileOk();
 const ns=mine(),extra=canReserveCount()-ns.length;
 if(ns.length&&extra<=0&&drawId)return{p:"p-done",h:"Participação confirmada!",t:(ns.length>1?"Seus "+ns.length+" números estão reservados":"Seu número está reservado")+". "+(st==="ended"?"Acompanhe o resultado oficial abaixo.":"Conclua mais tarefas para ganhar mais reais.")};
 /* cadastro sempre disponível, mesmo sem sorteio aberto */
 if(!currentUser){
  if(authMode==="reset")return{p:"p-auth",h:"Redefinir senha",t:"Informe o e-mail da sua conta e enviaremos um link para você criar uma nova senha."};
  if(authMode==="register")return{p:"p-auth",h:"Crie sua conta gratuita",t:"Leva menos de um minuto. Depois, vamos orientar você nas próximas etapas."};
  return{p:"p-auth",h:"Sua participação começa aqui.",t:"Entre ou crie sua conta. Depois, vamos orientar você nas próximas etapas."};
 }
 if(!v)return{p:"p-verify",h:"Falta apenas verificar seu e-mail.",t:"Enviamos um link para "+currentUser.email+". Esta tela atualiza sozinha quando você confirmar."};
 if(!ok||editProfile)return{p:"p-profile",h:ok?"Alterar dados":"Sua conta está pronta!",t:"Informe seu nome completo, data de nascimento e chave Pix para receber o prêmio."};
 if(!rd)return{p:"p-task",h:"Carregando…",t:"Buscando as informações do sorteio."};
 if(!drawId)return{p:"p-task",h:"Nenhum sorteio aberto",t:"Aguarde o organizador abrir um novo sorteio. Enquanto isso, conclua tarefas gerais para acumular reais."};
 const ev=evOfDraw();
 if(ev&&evState(ev)!=="active")return{p:"p-event",h:evState(ev)==="future"?"O evento ainda não começou":"Evento encerrado",t:"O sorteio "+(draw?.name||"")+" faz parte do evento "+ev.name+(evState(ev)==="future"?", que abre em "+(fmt(ev.startAt)!=="—"?fmt(ev.startAt):"data a definir"):" e já foi encerrado")+". Os números deste sorteio só ficam liberados durante o evento."};
 if(ev&&!myJoins.has(ev.id))return{p:"p-event",h:"Confirme o evento "+ev.name,t:"O sorteio "+(draw?.name||"")+" faz parte do evento "+ev.name+". Pague a entrada do evento para liberar a escolha dos seus números."};
 if(st==="ended")return{p:ns.length?"p-done":"",h:"Participação encerrada",t:"O período terminou e novos números não podem ser reservados. Veja o resultado oficial abaixo."};
 if(st==="waiting")return{p:"p-task",h:"Sorteio em breve!",t:"A escolha dos números abre em "+(START.getTime()?fmt(START):"data a definir")+". Conclua tarefas já para acumular reais."};
 if(taken.size>=TOTAL)return{p:"p-done",h:"Números esgotados",t:"Todos os "+TOTAL+" números já foram reservados."};
 if(pointsOf(wallet)<COST)return{p:"p-task",h:"Acumule reais!",t:"Conclua uma das tarefas abaixo e aguarde a aprovação do organizador. Tudo é pago em reais (R$)."};
 const ev2=evOfDraw();
 const pzN=Array.isArray(draw?.prizes)&&draw.prizes.filter(x=>x&&x.name).length?draw.prizes.filter(x=>x&&x.name)[0].name:null;
 return{p:"p-number",h:"Sorteio: "+(draw?.name||"—"),t:"Você está usando seu saldo em reais no sorteio \""+(draw?.name||"—")+"\""+(pzN?", concorrendo ao prêmio \""+pzN+"\"":"")+". Escolha seu número entre os "+(TOTAL-taken.size)+" disponíveis. Cada número consome "+fmtBRL(COST)+(ev2?" do evento "+ev2.name:"")+"."};
}

/* TELA DE CARREGAMENTO: o skeleton agora é controlado pelo bskMark()
   acima — ele só some quando todos os dados já chegaram. */

function renderNow(){
 const logged=!!currentUser,v=logged&&currentUser.emailVerified,ok=profileOk(),num=mine().length>0;
 const f=flow();
 $("as-h").textContent=f.h;$("as-t").textContent=f.t;
 /* o painel de cadastro nunca aparece na interface: a etapa de login mostra só o cartão de botões */
 const showP=f.p==="p-auth"?"p-auth-cta":f.p;
 ["p-auth","p-auth-cta","p-verify","p-profile","p-event","p-task","p-number","p-done"].forEach(id=>$(id).hidden=id!==showP);
 renderAuth();

 const done=[v,ok,pointsOf(wallet)>=COST,num];
 const reg=[v,ok],rc=reg.indexOf(false);
 $("prog").innerHTML=["Conta","Perfil"].map((n,k)=>`<li class="${reg[k]?"d":k===rc?"c":""}"><i>${reg[k]?"✓":k+1}</i>${n}</li>`).join("");
 $("as-tag").textContent=num?"Concluído":rc>=0?"Etapa "+(rc+1)+" de 2":"Cadastro completo";
 $("as-tag").className="tag "+(num||rc<0?"g":"y");

 /* menu da conta no cabeçalho */
 $("acct").hidden=!logged;
 if(logged){
  const ini=(profile?.name||currentUser.email||"U").trim().charAt(0).toUpperCase();
  const yv=pointsOf(wallet);
  const yk=yv>=1e6?(Math.round(yv/1e5)/10)+"M":yv>=1000?(Math.round(yv/100)/10)+"k":fmtBRL(yv);
  const _ava=$("ava");if(_ava)_ava.innerHTML='<span class="ava-bal">'+yk+"</span>";
  const _an=$("acct-n");if(_an)_an.textContent=profile?.name?maskName(profile.name):"Conta";
  $("am-email").textContent=currentUser.email||"";
  $("am-ver").textContent=v?"E-mail verificado ✓":"Verificação pendente";
  $("m-acct").hidden=false;
  $("m-acct").innerHTML=`<div class="ma-card"><span class="ava">${avatarHTML(profile?.photoMode,ini)}</span><div class="ma-meta"><b>${esc(profile?.name?maskName(profile.name):"Minha conta")}</b><small>${esc(currentUser.email||"")}</small><small>${v?"E-mail verificado ✓":"Verificação pendente"}</small></div>${v?`<div class="ma-bal"><small>Saldo</small><b class="mono">${pointsOf(wallet)}</b></div>`:""}</div>
   <div class="ma-acts"><button type="button" class="btn sm ghost" data-ma="edit"><span class="icn" aria-hidden="true" style="width:13px;height:13px;vertical-align:-2px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg></span> Perfil</button><button type="button" class="btn sm ghost" data-ma="wallet"><span class="icn" aria-hidden="true" style="width:13px;height:13px;vertical-align:-2px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M2.5 10h19" opacity=".55"/><circle cx="17" cy="13.5" r="1.4" fill="currentColor" stroke="none"/></svg></span> Carteira</button><button type="button" class="btn sm ghost out" data-ma="logout"><span class="icn" aria-hidden="true" style="width:13px;height:13px;vertical-align:-2px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="m15 8 4 4-4 4M19 12H9"/></svg></span> Sair</button></div>`;
 }else{
  $("m-acct").hidden=false;
  $("m-acct").innerHTML=`<div class="ma-card"><span class="ava">?</span><div class="ma-meta"><b>Você não está conectado</b><small>Entre para participar dos sorteios e leilões.</small></div></div><a class="btn wide" href="#participar"><i class=yi data-i=unlock></i> Entrar ou criar conta</a>`;
 }

 /* tarefas do assistente (mesmo sem sorteio aberto, o usuário pode se cadastrar e acumular) */
 const visibleTasks=[...generalTasks(),...events.filter(e=>evState(e)==="active").flatMap(e=>tasksOfEvent(e.id))].filter(t=>taskState(t)==="on"||offerState(t)==="on");
 $("tasks-list").innerHTML=visibleTasks.length?visibleTasks.map(taskCard).join(""):drawId?'<p class="foot">Nenhuma tarefa disponível agora. Volte mais tarde.</p>':'<p class="foot">Nenhum sorteio aberto ainda. Assim que o organizador abrir, as tarefas aparecem aqui.</p>';


 if(armed&&(taken.has(armed)||!canParticipate())){if(taken.has(armed))toast("O número "+pad(armed,String(TOTAL).length)+" acabou de ser reservado por outra pessoa.");armed=0}
 $("cbox").hidden=!armed;$("pick").hidden=!!armed;$("sugg").hidden=!!armed;
 const pcPz=Array.isArray(draw?.prizes)?draw.prizes.filter(x=>x&&x.name):[];
 $("cbox-t").textContent="Reservar o número "+pad(armed||0,String(TOTAL).length)+" no sorteio "+(draw?.name||"atual")+"? (custo: "+fmtBRL(COST)+")";
 $("cbox-p").textContent="Você está usando seu saldo em reais no sorteio "+(draw?.name||"—")+" · Prêmio em disputa: "+(pcPz.length?pcPz[0].name+(pcPz.length>1?" (+"+(pcPz.length-1)+" outro(s))":""):"a definir pelo organizador");
 $("yes").disabled=busy;
 $("numin").disabled=!canParticipate()||busy||!!armed;
 $("random").disabled=!canParticipate()||busy;
 $("free-t").textContent="Restam "+Math.max(0,TOTAL-taken.size)+" de "+TOTAL+" números livres. A disponibilidade atualiza em tempo real.";
 refreshSugg(false);renderSugg();
 if(!busy)validateNumber();
 /* card de contexto: deixa claro em qual sorteio/prêmio a troca está acontecendo */
 $("pick-ctx").hidden=!drawId||!draw;
 if(drawId){
  const ev=evOfDraw(),free=Math.max(0,TOTAL-taken.size),ds=drawState();
  $("pc-draw").textContent=draw?.name||"—";
  $("pc-ev-row").hidden=!ev;
  if(ev)$("pc-event").textContent=ev.name+(logged?(myJoins.has(ev.id)?" · entrada confirmada ✓":" · entrada pendente"):"");
  $("pc-prize").textContent=pcPz.length?pcPz[0].name+(pcPz[0].value?" · "+pcPz[0].value:"")+(pcPz.length>1?" (+"+(pcPz.length-1)+" outro(s))":""):"A definir pelo organizador";
  $("pc-cost").textContent=fmtBRL(COST);
  $("pc-free").textContent=free+" de "+TOTAL;
  $("pc-wallet").textContent=logged?fmtBRL(pointsOf(wallet)):"Entre na conta";
  $("pc-mine").textContent=logged?String(myTickets.filter(t=>t.drawId===drawId).length):"—";
  $("pc-fill").style.width=(TOTAL?Math.round(taken.size/TOTAL*100):0)+"%";
  $("pc-state").textContent=ds==="open"?"Aberto":ds==="waiting"?"Em breve":ds==="paused"?"Pausado":"Encerrado";
  $("pc-state").className="tag "+(ds==="open"?"g":ds==="waiting"?"y":"");
  $("pc-note").textContent=v&&ds==="open"?"Com seu saldo, dá para reservar mais "+Math.max(0,canReserveCount()-mine().length)+" número(s) agora.":taken.size+" número(s) já reservado(s) pelos participantes.";
 }

 if(f.p==="p-verify")$("v-mail").textContent=currentUser.email||"";
 if(f.p==="p-event"){
  const ev=evOfDraw();
  if(ev)$("ev-card").innerHTML=evConfirmCard(ev);
 }
 if(f.p==="p-profile"){
  $("pw-conf").hidden=!(editProfile&&currentUser.providerData?.some(p=>p.providerId==="password"));
  /* preenche só o que o usuário não está digitando (evita perder o que foi escrito) */
  const set=(id,v)=>{const el=$(id);if(document.activeElement!==el&&el.value!==v)el.value=v};
  if(!nameDirty)set("fbname",profile?.name||"");
  set("birth",profile?.birthDate||"");
  set("pix",profile?.pixKey||"");
  set("gender",profile?.gender||"");
  set("street",profile?.address?.street||"");
  set("housenum",profile?.address?.housenum||"");
  set("compl",profile?.address?.complement||"");
  set("uf",profile?.address?.state||"");
  set("country",profile?.address?.country||"Brasil");
  set("whatsapp",profile?.whatsapp||"");
 }

 renderFeed();renderTicket(done);renderResult();renderEvents();renderHero();renderAuctions();renderSorteios();renderStage();updateWfloat();renderTicker();renderAdBtn();renderHeroStats();updateCtaFinal();
 if(sheetOpen==="profile"){buildProfileHead();fillProfileForm(false)}
 updatePagers();tbSync();
}
render();
if(location.hash==="#participar")goStage(true);
/* ── links de notificação (#participar · #wallet · #colab · #oportunidades):
      abrem a tela certa em vez de só trocar o hash, que não levava a lugar algum ── */
function openHashLink(h){
 if(!h)return false;
 if(h==="#participar"){goStage(true);return true}
 if(h==="#wallet"){if(currentUser){walOpen()}else toast("Entre na sua conta para abrir a carteira.");return true}
 if(h==="#colab"){if(currentUser){openClv()}else toast("Entre na sua conta para abrir a Central do colaborador.");return true}
 if(h==="#oportunidades"){if(currentUser){openOg()}else toast("Entre na sua conta para ver as oportunidades.");return true}
 return false;
}
window.addEventListener("hashchange",()=>{try{openHashLink(location.hash)}catch(e){}});
/* ============================================================
   RENDER SEM TRAVAMENTO: chamadas repetidas de render() em um
   mesmo instante (vários snapshots chegando juntos) são unidas em
   um único quadro de animação — a tela nunca "congela".
   ============================================================ */
var _rAFq=0;
function render(){
 if(_rAFq)return;
 _rAFq=requestAnimationFrame(()=>{_rAFq=0;renderNow()});
}

/* ============================================================
   19c · CENTRAL DE AJUDA · tela cheia, nativa e inteligente
   - identifica automaticamente o usuário logado (UID + nome)
   - se não estiver logado, pede o UID (salvo no navegador)
   - abas: nova solicitação · meus atendimentos · perguntas
   - conversa em tempo real na MESMA coleção da Central de Suporte
   ============================================================ */
const HCATS={conta:"Conta e acesso",pagamentos:"Pagamentos e carteira",tarefas:"Tarefas e provas",sorteios:"Sorteios e números",colaborador:"Colaboradores",outro:"Outro assunto"};
const HSTAT={novo:["tag r","recebido <i class=yi data-i=inbox></i>"],atendimento:["tag y","em atendimento"],aguardando:["tag b","aguardando você"],resolvido:["tag g","resolvido <i class=yi data-i=checkc></i>"],fechado:["tag","encerrado"]};
let HP={tab:"new",uid:"",name:"",logged:false,cat:"conta",chat:null,tickets:[],unTk:null,unMsg:null};
const hpWhen=v=>{const ms=stampMs(v);return ms?new Date(ms).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):""};

function hpIdent(){
 if(currentUser&&currentUser.uid){
  HP.logged=true;
  HP.uid=currentUser.uid;
  HP.name=(profile&&profile.name)||(currentUser.displayName||"")||((currentUser.email||"").split("@")[0])||"Participante";
 }else{
  HP.logged=false;
  HP.uid=localStorage.getItem("yshHelpUid")||"";
  HP.name=localStorage.getItem("yshHelpName")||"";
 }
 $("hp-who").textContent=HP.logged
  ?("<i class=yi data-i=checkc></i> Identificado automaticamente: "+HP.name+" · "+HP.uid.slice(0,10)+"…")
  :"Visitante — entre na conta ou informe seu UID para abrir uma solicitação";
}

/* trava de rolagem compartilhada: sempre recalculada a partir do estado real
   de TODAS as telas (gavetas + central de ajuda), para não destravar o fundo
   quando duas telas estão empilhadas e uma delas fecha */
function syncGavLock(){
 const anyOpen=[...document.querySelectorAll(".gaveta.open")].length>0||!($("sup-modal")?.hidden??true);
 document.documentElement.classList.toggle("gav-lock",anyOpen);
}
function openSupport(){
 const m=$("sup-modal");
 m.hidden=!m.hidden;
 syncGavLock();
 if(!m.hidden){
  /* código de suporte salvo no painel (settings.supportCode), se houver,
     roda isolado no lugar da Central de Ajuda nativa; campo vazio = nativa */
  const custom=String(settings.supportCode||"").trim();
  const frame=$("sup-frame"),main=$("hp-main");
  if(frame&&main){
   if(custom){
    frame.hidden=false;main.hidden=true;
    frame.srcdoc=buildAdDoc(custom);
   }else{
    frame.hidden=true;main.hidden=false;frame.srcdoc="";
    hpIdent();
    hpWatch();
    hpRender();
    $("hp-main").scrollTop=0;
   }
  }else{
   hpIdent();
   hpWatch();
   hpRender();
   $("hp-main").scrollTop=0;
  }
 }else{
  const frame=$("sup-frame");
  if(frame)frame.srcdoc="";
  hpStopChat();
 }
}
function hpStopChat(){HP.unMsg?.();HP.unMsg=null;HP.chat=null}
$("nav-sup").onclick=e=>{e.preventDefault();openSupport()};
const nsq=$("nav-sup-top");if(nsq)nsq.onclick=e=>{e.preventDefault();openSupport()};
const nsf=$("nav-sup-faq");if(nsf)nsf.onclick=e=>{e.preventDefault();openSupport()};
$("sup-close").onclick=()=>{$("sup-modal").hidden=true;syncGavLock();hpStopChat()};
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("sup-modal").hidden){$("sup-modal").hidden=true;syncGavLock();hpStopChat()}});

function hpWatch(){
 HP.unTk?.();HP.unTk=null;
 const uid=HP.logged?currentUser.uid:(HP.uid||"").trim();
 if(!uid){HP.tickets=[];return}
 HP.unTk=onSnapshot(query(collection(db,"supportTickets"),where("uid","==",uid),limit(50)),s=>{
  HP.tickets=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(stampMs(b.updatedAt||b.createdAt)||0)-(stampMs(a.updatedAt||a.createdAt)||0));
  if(!$("sup-modal").hidden)hpRender();
 },e=>console.warn("Ajuda:",e));
}

function hpRender(){
 const inr=$("hp-inner");
 if(!inr)return;
 if(HP.chat){hpChatPane();return}
 const open=HP.tickets.filter(t=>t.status!=="fechado"&&t.status!=="resolvido").length;
 inr.innerHTML=`
 <div class="tabs" role="tablist">
  <button class="${HP.tab==="new"?"on":""}" data-hptab="new"><i class=yi data-i=mail></i> Nova solicitação</button>
  <button class="${HP.tab==="mine"?"on":""}" data-hptab="mine"><i class=yi data-i=chat></i> Meus atendimentos${open?` <span class="tag r">${open}</span>`:""}</button>
  <button class="${HP.tab==="faq"?"on":""}" data-hptab="faq"><i class=yi data-i=help></i> Perguntas</button>
 </div>
 <div id="hp-pane"></div>`;
 inr.querySelectorAll("[data-hptab]").forEach(b=>b.onclick=()=>{HP.tab=b.dataset.hptab;hpRender()});
 if(HP.tab==="new")hpForm();
 else if(HP.tab==="mine")hpMine();
 else hpFaq();
}

/* ---- nova solicitação ---- */
function hpForm(){
 const p=$("hp-pane");
 const idBox=HP.logged
  ?`<div class="notice"><i class=yi data-i=checkc></i> Sua identificação é automática: <b>${esc(HP.name)}</b> · UID <b class="mono">${esc(HP.uid.slice(0,12))}…</b></div>`
  :`<div class="notice">Você não está logado. Informe seu UID (no site: menu → Carteira) para a equipe localizar sua conta:</div>
  <div class="field"><span class="label">Seu UID *</span><input id="hp-uid" placeholder="ex.: aB3xK9q2…" value="${esc(HP.uid)}"></div>
  <div class="field"><span class="label">Seu nome ou apelido</span><input id="hp-nome" placeholder="Como podemos te chamar?" value="${esc(HP.name)}"></div>`;
 p.innerHTML=`
 <div class="card" style="padding:18px;display:grid;gap:4px">
 <h3 style="font-size:16px">Nova solicitação</h3>
 <p class="hint" style="margin:4px 0 6px">A resposta da equipe chega em “Meus atendimentos”, aqui mesmo, em tempo real.</p>
 ${idBox}
 <div class="field"><span class="label">Assunto rápido (opcional)</span><div class="hp-chips" id="hp-quick"></div></div>
 <div class="field"><span class="label">Categoria *</span><div class="hp-chips" id="hp-cats"></div></div>
 <div class="field"><span class="label">Assunto *</span><input id="hp-subj" placeholder="Ex.: recompensa não caiu na carteira"></div>
 <div class="field"><span class="label">Descreva o que aconteceu *</span><textarea id="hp-msg" rows="5" placeholder="Conte com detalhes: o que você fez, o que esperava e o que aconteceu. Se for sobre uma tarefa, informe o ID da tarefa."></textarea></div>
 <div class="field"><span class="label">Link de print ou gravação (opcional)</span><input id="hp-link" placeholder="https://…"></div>
 <button class="btn wide" id="hp-send" style="margin-top:10px">Enviar para o suporte ➤</button>
 <p class="hint" style="margin-top:8px;font-size:11.5px">Pagamentos e carteira entram com prioridade <b>alta</b> na fila da equipe.</p>
 </div>`;
 const cats=$("hp-cats");
 cats.innerHTML=Object.entries(HCATS).map(([k,v])=>`<button class="hp-chip${HP.cat===k?" on":""}" data-cat="${k}">${v}</button>`).join("");
 cats.querySelectorAll("[data-cat]").forEach(b=>b.onclick=()=>{HP.cat=b.dataset.cat;hpForm()});
 const QUICK={
  recompensa:["Recompensa não caiu","Minha prova foi aprovada, mas os reais (R$) não apareceram na carteira.\nID da tarefa: "],
  prova:["Prova rejeitada injustamente","Acho que minha prova foi avaliada com má-fé.\nID da tarefa: "],
  numero:["Não consigo reservar número","Não estou conseguindo reservar meu número no sorteio. "],
  conta:["Problema na minha conta","Estou com um problema na minha conta. "]
 };
 $("hp-quick").innerHTML=Object.entries(QUICK).map(([k,v])=>`<button class="hp-chip" data-q="${k}">${v[0]}</button>`).join("");
 $("hp-quick").querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>{const q=QUICK[b.dataset.q];$("hp-subj").value=q[0];$("hp-msg").value=q[1];$("hp-msg").focus()});
 $("hp-send").onclick=hpSend;
}

async function hpSend(){
 if(!HP.logged){
  HP.uid=($("hp-uid").value||"").trim();
  HP.name=($("hp-nome").value||"").trim()||"Participante";
  if(!HP.uid||HP.uid.length<6)return toast("Informe um UID válido (menu → Carteira).");
  localStorage.setItem("yshHelpUid",HP.uid);
  localStorage.setItem("yshHelpName",HP.name);
 }
 const subj=($("hp-subj").value||"").trim();
 const msg=($("hp-msg").value||"").trim();
 if(!subj||!msg)return toast("Preencha assunto e descrição.");
 const link=($("hp-link").value||"").trim();
 const uid=HP.logged?currentUser.uid:HP.uid;
 $("hp-send").disabled=true;
 try{
  const ref=await addDoc(collection(db,"supportTickets"),{
   uid,userName:HP.name,userEmail:(HP.logged&&currentUser.email)||"",
   subject:subj,category:HP.cat,
   priority:HP.cat==="pagamentos"?"alta":"normal",
   status:"novo",channel:"site",
   createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessageAt:serverTimestamp(),
   firstResponseAt:null,unread:1,assignedTo:"—",assignedName:"—"
  });
  let text=msg;
  if(link)text+="\n\n<i class=yi data-i=link></i> "+link;
  await addDoc(collection(db,"supportTickets",ref.id,"messages"),{from:"client",authorName:HP.name,text,createdAt:serverTimestamp()});
  toast("Solicitação enviada ✔ A resposta chega em Meus atendimentos.");
  HP.chat=ref.id;
  HP.tab="mine";
  hpWatch();
  hpRender();
 }catch(e){toast("Não foi possível enviar: "+(e.message||e));$("hp-send").disabled=false}
}

/* ---- meus atendimentos ---- */
function hpMine(){
 const p=$("hp-pane");
 if(!HP.logged&&!(HP.uid||"").trim()){
  p.innerHTML=`<div class="card" style="padding:22px;text-align:center;display:grid;gap:10px">
  <p class="hint">Para ver seus atendimentos automaticamente, entre na sua conta.</p>
  <div><button class="btn sm" id="hp-gouid">Informar meu UID agora</button></div></div>`;
  $("hp-gouid").onclick=()=>{HP.tab="new";hpRender()};
  return;
 }
 const list=HP.tickets.map(t=>{
  const st=HSTAT[t.status]||HSTAT.novo;
  return `<button class="hp-tk" data-tk="${t.id}">
  <b>${esc(t.subject||"(sem assunto)")}</b>
  <span class="${st[0]}">${st[1]}</span>
  <span class="mono" style="font-size:11px;color:var(--mu)">#${t.id.slice(-6).toUpperCase()}</span>
  </button>`;
 }).join("")||`<p class="hint">Nenhuma solicitação ainda. Abra a primeira na aba “Nova solicitação”.</p>`;
 p.innerHTML=`<div class="card" style="padding:18px;display:grid;gap:12px">
 <h3 style="font-size:15px">Meus atendimentos</h3>
 <div style="display:grid;gap:10px">${list}</div></div>`;
 p.querySelectorAll("[data-tk]").forEach(b=>b.onclick=()=>{HP.chat=b.dataset.tk;hpRender()});
}

/* ---- perguntas frequentes (reaproveita as do próprio site) ---- */
function hpFaq(){
 const p=$("hp-pane");
 const items=[...document.querySelectorAll("#faq-dyn details, #faq-static details")].map(d=>{
  const s=d.querySelector("summary")?.textContent||"";
  const b=d.querySelector("div")?.innerHTML||"";
  return `<details><summary>${esc(s)}</summary><div>${b}</div></details>`;
 }).join("");
 p.innerHTML=`<div class="faq" style="display:grid;gap:8px">${items||"<p class='hint'>Nenhuma pergunta cadastrada.</p>"}</div>`;
}

/* ---- conversa do ticket (tempo real) ---- */
function hpChatPane(){
 const p=$("hp-pane");
 if(!p)return;
 const t=HP.tickets.find(x=>x.id===HP.chat)||{id:HP.chat,status:"novo",subject:""};
 const st=HSTAT[t.status]||HSTAT.novo;
 p.innerHTML=`
 <div class="card" style="padding:16px;display:grid;gap:12px">
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
   <button class="btn sm ghost" id="hp-back">‹ Voltar</button>
   <b style="flex:1;min-width:120px;font-size:14px;overflow-wrap:anywhere">${esc(t.subject||"(sem assunto)")}</b>
   <span class="${st[0]}">${st[1]}</span>
  </div>
  <div class="hp-thread" id="hp-thread"></div>
  <div style="display:grid;gap:8px">
   <textarea id="hp-reply" rows="3" placeholder="Escreva sua mensagem… (Enter envia · Shift+Enter quebra linha)"></textarea>
   <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
    <button class="btn sm ghost" id="hp-cancel" style="color:var(--rd);border-color:var(--rd)">Cancelar solicitação</button>
    <button class="btn sm" id="hp-sendreply" style="margin-left:auto">Enviar ➤</button>
   </div>
  </div>
 </div>`;
 $("hp-back").onclick=()=>{hpStopChat();hpRender()};
 $("hp-sendreply").onclick=hpReply;
 $("hp-reply").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();hpReply()}});
 $("hp-cancel").onclick=async()=>{
  if(!confirm("Cancelar esta solicitação? A equipe será avisada."))return;
  try{
   await addDoc(collection(db,"supportTickets",HP.chat,"messages"),{from:"system",authorName:"Sistema",text:"<i class=yi data-i=hands></i> O participante cancelou esta solicitação.",createdAt:serverTimestamp()});
   await updateDoc(doc(db,"supportTickets",HP.chat),{status:"fechado",updatedAt:serverTimestamp()});
   hpStopChat();hpRender();
  }catch(e){toast("Erro: "+(e.message||e))}
 };
 HP.unMsg?.();
 HP.unMsg=onSnapshot(query(collection(db,"supportTickets",HP.chat,"messages"),orderBy("createdAt","asc"),limit(200)),s=>{
  const el=$("hp-thread");
  if(!el)return;
  el.innerHTML=s.docs.map(d=>{
   const m=d.data();
   if(m.from==="system")return `<div class="hp-msg sys">${esc(m.text)}</div>`;
   const me=m.from==="client";
   return `<div class="hp-msg${me?" me":""}"><b style="font-size:11px">${me?"Você":esc(m.authorName||"Suporte")}</b><br>${esc(m.text)}<small>${hpWhen(m.createdAt)}</small></div>`;
  }).join("")||'<p class="hint" style="text-align:center">Aguardando as primeiras mensagens…</p>';
  el.scrollTop=el.scrollHeight;
 },e=>console.warn("Ajuda chat:",e));
}

async function hpReply(){
 const el=$("hp-reply");
 const txt=(el.value||"").trim();
 if(!txt||!HP.chat)return;
 const t=HP.tickets.find(x=>x.id===HP.chat);
 if(t&&(t.status==="fechado"||t.status==="resolvido"))return toast("Este atendimento já foi encerrado pela equipe.");
 el.value="";
 try{
  await addDoc(collection(db,"supportTickets",HP.chat,"messages"),{from:"client",authorName:HP.name||"Participante",text:txt,createdAt:serverTimestamp()});
  const patch={updatedAt:serverTimestamp(),lastMessageAt:serverTimestamp(),unread:1};
  if(t&&t.status==="aguardando")patch.status="atendimento";
  await updateDoc(doc(db,"supportTickets",HP.chat),patch);
 }catch(e){toast("Não foi possível enviar: "+(e.message||e))}
}

/* ============================================================
   19d · ANUNCIAR COMO COLABORADOR (aviso em forma de notificação)
   O processo é tratado no suporte: o aviso pergunta se o usuário
   quer abrir o suporte agora para começar a trabalhar conosco
   ou prefere deixar para depois.
   ============================================================ */
function openColabNotice(){openClvTo("anunciar");clvAnun("notice")}
/* botão "Anunciar" ABAIXO das abas da Central do colaborador */
if($("clv-anunciar-btn"))$("clv-anunciar-btn").onclick=()=>openColabNotice();
document.addEventListener("click",e=>{
 if(e.target.closest("[data-collab]")){openColabNotice();return}
 if(e.target.closest("[data-colab-close]")){clvFilter="pending";clvSwap();clvRenderAll();return}
});
$("colab-go").onclick=()=>{clvAnun("form");openCollabForm()};
/* move o aviso e o formulário de anunciar para DENTRO da Central do colaborador */
try{
 const an=$("clv-anunciar");
 const cc=document.querySelector("#colab-modal .colab-card"),cb=document.querySelector("#cform-modal .cform-box");
 if(an&&cc)an.appendChild(cc);
 if(an&&cb)an.appendChild(cb);
 const ce=document.getElementById("clv-enviadas");if(an&&ce)an.appendChild(ce);
 const mo=$("colab-modal");if(mo)mo.remove();
 const mf=$("cform-modal");if(mf)mf.remove();
 if(cc)cc.hidden=false;
 if(cb)cb.hidden=true;
}catch(e){console.warn("Aba Anunciar:",e)}
function clvAnun(which){
 const cc=document.querySelector("#clv-anunciar .colab-card"),cb=document.querySelector("#clv-anunciar .cform-box");
 if(cc)cc.hidden=which!=="notice";
 if(cb)cb.hidden=which!=="form";
}

/* ============================================================
   19d · FORMULÁRIO DE TAREFA DO COLABORADOR
   O membro preenche a tarefa direto no site; ela vai para a
   coleção "collabTasks" e aparece na seção "Tarefas dos
   colaboradores" do painel para revisão, pedido de edição,
   negação com motivo ou aprovação — sempre com botão de recorrer.
   ============================================================ */
let collabUnsub=null,myCollabs=[],cfEditId=null;
function watchCollab(uid){
 if(collabUnsub){try{collabUnsub()}catch(e){}collabUnsub=null}
 myCollabs=[];
 if(!uid){renderCollabMine();return}
 try{
  collabUnsub=onSnapshot(query(collection(db,"collabTasks"),where("uid","==",uid)),s=>{
   myCollabs=s.docs.map(d=>({id:d.id,...d.data()}));
   renderCollabMine();
  },e=>console.error("Tarefas de colaborador:",e));
 }catch(e){console.error("Watch colaborador:",e)}
}
function collabStatusChip(st){
 if(st==="approved")return'<span class="tag g"><i class=yi data-i=checkc></i> Publicada</span>';
 if(st==="changes_requested"||st==="changes")return'<span class="tag y"><i class=yi data-i=edit></i> Correção pedida</span>';
 if(st==="rejected")return'<span class="tag r"><i class=yi data-i=ban></i> Negada</span>';
 return'<span class="tag y"><i class=yi data-i=hourglass></i> Em análise</span>';
}
function renderCollabMine(){
 const el=$("cform-mine");
 if(!el)return;
 if(!currentUser){el.innerHTML='<p class="hint">Entre na sua conta para enviar tarefas de colaborador.</p>';return}
 if(!myCollabs.length){el.innerHTML='<p class="hint">Você ainda não enviou tarefas. Preencha o formulário guiado de 4 etapas acima e clique em “Pagar taxa e enviar”.</p>';return}
 el.innerHTML=myCollabs
  .sort((a,b)=>((stampOfCollab(b))||0)-((stampOfCollab(a))||0))
  .map(c=>{
   const st=c.status||"pending";
   return `<div class="cform-item">
    <div class="cf-head"><b>${esc(c.name||"Tarefa")}</b>${collabStatusChip(st)}</div>
    <div class="kv"><span>Valor</span><b>+${fmtBRL(Math.max(0.01,Math.round((Number(c.reward)||0)*100)/100))} × ${Math.max(1,Math.floor(Number(c.stock)||1))} vaga(s)</b></div>
    ${Number(c.feePaid)>0?`<div class="kv"><span>Taxa paga (30%)</span><b>${fmtBRL(Math.floor(Number(c.feePaid)))}${c.feeRefunded?' · <span class="tag g">devolvida</span>':""}</b></div>`:""}
    ${c.comment?`<p class="hint"><i class=yi data-i=chat></i> Equipe: ${esc(c.comment)}</p>`:""}
    ${c.appealNote?`<p class="hint"><i class=yi data-i=hands></i> Seu recurso: ${esc(c.appealNote)}</p>`:""}
    <div class="actions" style="margin:0">
     ${(st==="changes_requested"||st==="changes"||st==="rejected")?`<button class="btn sm" type="button" data-cf-edit="${esc(c.id)}">${st==="rejected"?"Recorrer / reenviar":"Corrigir e reenviar"}</button>`:""}
     ${st==="approved"?'<span class="hint">Já está no ar na seção <b>Ofertas dos colaboradores</b> com o carimbo <i class=yi data-i=handshake></i> — e <b>a inspeção das provas é sua</b>: aprovar, pedir correção ou negar é com você na Central do colaborador.</span><button class="btn sm" type="button" data-clv="1" style="margin-top:8px"><i class=yi data-i=handshake></i> Avaliar as provas desta tarefa →</button>':""}
    </div>
   </div>`;
  }).join("");
}
const stampOfCollab=c=>{const v=c?.updatedAt||c?.createdAt;if(v?.toDate)return v.toDate().getTime();if(v?.seconds)return v.seconds*1000;const d=new Date(v);return isNaN(d)?0:d.getTime()};
/* ---- wizard guiado de 5 etapas (igual ao painel) + taxa de 30% ---- */
const CF_FEE_PCT=0.30;
let cfStep=1,cfRewManual=false,cfCatSel="",cfSvcSel="";
const cfCatList=()=>Array.isArray(catalog?.categories)?catalog.categories:[];
const cfCatOf=id=>cfCatList().find(c=>c.id===id)||null;
const cfSvcOf=(cid,sid)=>cfCatOf(cid)?.services?.find(s=>s.id===sid)||null;
const cfDiffKeyOf=v=>{const k=String(v||"").toLowerCase();if(DIFFS_SITE[k])return k;if(k.includes("méd")||k.includes("med")||k.includes("inter"))return"medium";if(k.includes("dif"))return"hard";return"simple"};
const cfProofCount=()=>["t","c","i","v","d"].map(k=>"cf-p"+k).map(id=>$(id)).filter(x=>x&&x.checked).length;
const cfStockBounds=()=>{const s=(window.__taskLimits||{});const min=Math.max(1,Math.floor(Number(s.minStock)||25));const max=Math.max(min,Math.floor(Number(s.maxStock)||500));return{min,max}};
const cfVagas=()=>{const b=cfStockBounds();return Math.min(b.max,Math.max(b.min,Math.floor(Number($("cf-vagas").value)||b.min)));};
/* X = total pago aos participantes: recompensa × vagas, convertido para
   reais pela cotação da moeda escolhida (bilhetes 0,50 · moedas 0,001).
   A taxa é 30% FORA do X e continua sendo cobrada em reais. */
const cfCurBRL=c=>c==="ticket"?0.5:c==="coin"?0.001:1;
const cfCurName=c=>c==="ticket"?"bilhete(s)":c==="coin"?"moeda(s)":"real(is)";
const cfRewardCur=()=>$("cf-cur")?$("cf-cur").value:"brl";
const cfRewardPts=()=>{const v=Number($("cf-reward").value)||0;const q=cfRewardCur()==="brl"?Math.max(0.01,v):Math.max(1,Math.floor(v||1));return q*cfVagas()*cfCurBRL(cfRewardCur())};
const cfFeePts=()=>Math.max(1,Math.ceil(cfRewardPts()*CF_FEE_PCT));
function cfFillCats(sel){
 cfCatSel=sel||"";
 $("cf-cats").innerHTML=cfCatList().map(c=>`<button type="button" class="cf-card${c.id===cfCatSel?" on":""}" data-cfc="${esc(c.id)}"><span class="cf-cico">${c.icon||""}</span><b>${esc(c.label)}</b>${c.id===cfCatSel?'<span class="cf-selb">✓ Selecionado</span>':''}<small>${(c.services||[]).length} serviço(s)</small></button>`).join("")||'<p class="hint">Nenhuma categoria no catálogo ainda. A equipe cadastra em Tarefas → Catálogo.</p>';
 cfFillSvc();
}
function cfFillSvc(sel){
 cfSvcSel=sel||"";
 $("cf-svcs-h").hidden=!cfCatSel;
 const list=cfCatOf(cfCatSel)?.services||[];
 $("cf-svcs").innerHTML=list.map(s=>{
  const D=DIFFS_SITE[cfDiffKeyOf(s.difficulty)]||DIFFS_SITE.simple;
  return `<button type="button" class="cf-card${s.id===cfSvcSel?" on":""}" data-cfs="${esc(s.id)}"><b>${esc(s.label)}</b>${s.id===cfSvcSel?'<span class="cf-selb">✓ Selecionado</span>':''}<small><span class="cf-svcreward">+${fmtBRL(Math.max(0.01,Math.round((Number(s.reward)||0.01)*100)/100))}</span> · ${D.dot} ${esc(D.label)}</small></button>`;
 }).join("")||'<p class="hint">Nenhum serviço nesta categoria ainda — escolha outra categoria acima.</p>';
 cfOnPick();
}
function cfOnPick(){
 const s=cfSvcOf(cfCatSel,cfSvcSel);
 const dk=cfDiffKeyOf(s?.difficulty);
 const D=DIFFS_SITE[dk]||DIFFS_SITE.simple;
 $("cf-diff").textContent=cfSvcSel?D.dot+" "+D.label:"— escolha um serviço";
 if(!cfRewManual&&s){
  /* sugestão vem em reais — converte para a moeda escolhida
     (2 bilhetes = R$ 1 · 1.000 moedas = R$ 1) */
  const sug=Math.max(0.01,Math.round((Number(s.reward)||0.01)*100)/100);
  const c=cfRewardCur();
  $("cf-reward").value=c==="ticket"?Math.max(1,Math.ceil(sug/0.5)):c==="coin"?Math.max(1,Math.ceil(sug/0.001)):sug;
 }
 $("cf-min").value=String(dk==="simple"?1:2);
 cfUpdateFee();
}
function cfUpdateFee(){
 if(!$("cf-save").hidden)$("cf-save").innerHTML=(cfEditId?"Salvar e reenviar":"Pagar "+fmtBRL(cfFeePts())+" de taxa e enviar")+" <i class=yi data-i=handshake></i>";
}
function cfSummary(){
 const pr={text:$("cf-pt").checked,code:$("cf-pc").checked,image:$("cf-pi").checked,video:$("cf-pv").checked,datetime:$("cf-pd").checked};
 const prOn=Object.keys(pr).filter(k=>pr[k]);
 const r=cfRewardCur()==="brl"?Math.max(0.01,Number($("cf-reward").value)||0):Math.max(1,Math.floor(Number($("cf-reward").value)||1));
 const cur=cfRewardCur();
 const fee=cfFeePts(),bal=pointsOf(wallet);
 $("cf-summary").innerHTML=`
 <div class="kv"><span>Categoria</span><b>${esc(catLabelS(cfCatSel))}</b></div>
 <div class="kv"><span>Serviço</span><b>${esc(cfSvcOf(cfCatSel,cfSvcSel)?.label||"—")}</b></div>
 <div class="kv"><span>Nome da tarefa</span><b>${esc($("cf-name").value.trim()||"—")}</b></div>
 <div class="kv"><span>Missão</span><b>${esc($("cf-desc").value.trim()||"—")}</b></div>
 <div class="kv"><span>Etapas</span><b>${esc($("cf-steps-in").value.split("\n").map(s=>s.trim()).filter(Boolean).join(" · ")||"—")}</b></div>
 ${$("cf-link").value.trim()?`<div class="kv"><span>Link</span><b>${esc($("cf-link").value.trim())}</b></div>`:""}
 <div class="kv"><span>Provas exigidas</span><b>${prOn.map(k=>PROOF_REQ_SITE[k]).join(" · ")||"sem prova"}</b></div>
 <div class="kv"><span>Moeda do pagamento</span><b>${cur==="ticket"?"Bilhetes <i class=yi data-i=ticket></i>":cur==="coin"?"Moedas Yshipp <i class=yi data-i=coins></i>":"Reais (R$)"}</b></div>
 <div class="kv"><span>Valor por participante</span><b>${r} ${cfCurName(cur)} (≈ ${fmtBRL(r*cfCurBRL(cur))})</b></div>
 <div class="kv"><span>Vagas</span><b>${cfVagas()} participante(s)</b></div>
 <p class="hint" style="margin:0">O valor da taxa de publicação aparece na etapa <b>5 · Pagamento</b>.</p>`;
}
function cfValidate(){
 if(cfStep===1){
  if(!cfCatSel)return toast("Escolha a categoria do serviço.");
  if(!cfSvcSel)return toast("Escolha o serviço da categoria.");
  if($("cf-name").value.trim().length<5)return toast("Dê um nome claro para a tarefa (mín. 5 caracteres).");
  const r=cfRewardCur()==="brl"?Number($("cf-reward").value):Math.floor(Number($("cf-reward").value));
  if(!Number.isFinite(r)||r<0.01)return toast("Informe a recompensa por participante (em reais aceita centavos, ex.: 0,50; nas outras moedas, mínimo 1).");
  const v=Math.floor(Number($("cf-vagas").value));
  if(!Number.isFinite(v)||v<1)return toast("Informe o número de vagas (mín. 1 participante).");
 }
 if(cfStep===2){
  if($("cf-desc").value.trim().length<15)return toast("Descreva melhor a missão (mín. 15 caracteres).");
  if(!$("cf-steps-in").value.split("\n").map(s=>s.trim()).filter(Boolean).length)return toast("Liste pelo menos 1 etapa da missão.");
  if(!$("cf-rules-in").value.split("\n").map(s=>s.trim()).filter(Boolean).length)return toast("Liste pelo menos 1 regra da tarefa.");
  const link=$("cf-link").value.trim();
  if(link&&!/^https?:\/\//i.test(link))return toast("O link deve começar com http:// ou https://.");
 }
 if(cfStep===3){
  const n=cfProofCount();
  const dk=cfDiffKeyOf(cfSvcOf(cfCatSel,cfSvcSel)?.difficulty);
  const minP=Math.max(Number($("cf-min").value)||1,dk==="simple"?1:2);
  if(n&&minP>n)return toast("O mínimo de provas ("+minP+") não pode passar dos tipos exigidos ("+n+").");
  if(n&&$("cf-proof").value.trim().length<10)return toast("Explique como o participante deve comprovar a tarefa (mín. 10 caracteres).");
 }
 return true;
}
/* etapa 5 · pagamento: X total + 30% de taxa fora do X.
   A taxa pode ser paga em reais (padrão) ou em Moedas Yshipp
   (10 moedas = R$ 0,01) — a moeda das tarefas. */
let cfFeeMode="brl";
function cfPay(){
 const r=cfRewardCur()==="brl"?Math.max(0.01,Number($("cf-reward").value)||0):Math.max(1,Math.floor(Number($("cf-reward").value)||1));
 const cur=cfRewardCur(),ty="common";
 const X=cfRewardPts(),fee=cfFeePts(),bal=pointsOf(wallet);
 const feeCoins=fee*1000,coinBal=Math.max(0,Math.floor(Number(wallet?.coins)||0));
 $("cf-pay").innerHTML=`
 <div class="kv"><span>Moeda do pagamento aos participantes</span><b>${cur==="ticket"?"Bilhetes <i class=yi data-i=ticket></i>":cur==="coin"?"Moedas Yshipp <i class=yi data-i=coins></i>":"Reais (R$)"}</b></div>
 <div class="kv"><span>Recompensa por participante</span><b>+${r} ${cfCurName(cur)} (≈ ${fmtBRL(r*cfCurBRL(cur))})</b></div>
 <div class="kv"><span>Vagas</span><b>${cfVagas()} participante(s)</b></div>
 <div class="kv"><span>Total pago aos participantes (X)</span><b>≈ ${fmtBRL(X)}</b></div>
 <div class="kv"><span><i class=yi data-i=safe></i> Taxa de publicação (30% de X, fora do X)</span><b>${cfEditId?"— (edição/recorrência não cobra nova taxa)":fmtBRL(fee)}</b></div>
 <div class="kv"><span>Seu saldo em reais</span><b>${fmtBRL(bal)}${(!cfEditId&&cfFeeMode==="brl"&&bal<fee)?' <span class="tag r">insuficiente</span>':""}</b></div>
 <div class="kv"><span>Seu saldo em Moedas Yshipp</span><b class="mono">${coinBal} moedas${(!cfEditId&&cfFeeMode==="coin"&&coinBal<feeCoins)?' <span class="tag r">insuficiente</span>':""}</b></div>
 ${cfEditId?"":`<div class="field" style="margin:4px 0 0"><label class="label">Como pagar a taxa de publicação</label><div class="actions" style="margin:0"><button type="button" class="btn sm ${cfFeeMode==="brl"?"":"ghost"}" data-cffee="brl"><i class=yi data-i=cash></i> Reais · ${fmtBRL(fee)}</button><button type="button" class="btn sm ${cfFeeMode==="coin"?"":"ghost"}" data-cffee="coin"><i class=yi data-i=coins></i> Moedas · ${feeCoins} moedas</button></div></div><p class="hint" style="margin:0">Ao enviar, ${cfFeeMode==="coin"?("<b>"+feeCoins+" moedas</b> saem da sua carteira (só servem para tarefas — a taxa é um pagamento de tarefa)"):("<b>"+fmtBRL(fee)+"</b> saem da sua carteira em reais")} e ficam retidos pela equipe: entram no <i class=yi data-i=trophy></i> Cofre Real quando a tarefa for <b>publicada</b>. Se for negada, a taxa é <b>devolvida</b> na mesma moeda. A parte dos participantes (≈ ${fmtBRL(X)}${cur==="brl"?"":" em reais"}) é paga ${cur==="brl"?"pelo Yshippcommerce":"por você, na moeda escolhida, ao aprovar cada prova na Central do colaborador"}.</p>`}`;
}
$("cf-pay").addEventListener("click",e=>{
 const f=e.target.closest("[data-cffee]");
 if(f){cfFeeMode=f.dataset.cffee==="coin"?"coin":"brl";cfPay()}
});
function cfShow(n){
 cfStep=Math.min(5,Math.max(1,n));
 [1,2,3,4,5].forEach(i=>$("cf-p"+i).hidden=i!==cfStep);
 [...$("cf-steps").children].forEach(b=>{b.classList.toggle("on",Number(b.dataset.goto)===cfStep);b.classList.toggle("done",Number(b.dataset.goto)<cfStep)});
 $("cf-prev").hidden=cfStep===1;
 $("cf-next").hidden=cfStep===5;
 $("cf-save").hidden=cfStep!==5;
 try{const yv=window.scrollY;requestAnimationFrame(()=>{if(Math.abs(window.scrollY-yv)>60)window.scrollTo({top:yv,behavior:"auto"})})}catch(e){}
 if(cfStep===4)cfSummary();
 if(cfStep===5)cfPay();
 cfUpdateFee();
}
$("cf-steps").onclick=e=>{const g=Number(e.target.dataset?.goto);if(g){if(g<cfStep||cfValidate())cfShow(g)}};
$("cf-prev").onclick=()=>cfShow(cfStep-1);
$("cf-next").onclick=()=>{if(cfValidate())cfShow(cfStep+1)};
$("cf-cats").onclick=e=>{const c=e.target.closest("[data-cfc]");if(c)cfFillCats(c.dataset.cfc)};
$("cf-svcs").onclick=e=>{const s=e.target.closest("[data-cfs]");if(s)cfFillSvc(s.dataset.cfs)};
$("cf-vagas").oninput=cfUpdateFee;
$("cf-reward").oninput=()=>{cfRewManual=true;cfUpdateFee()};
/* trocar a moeda do pagamento atualiza a taxa, o resumo e a sugestão de recompensa */
$("cf-cur").onchange=()=>{cfRewManual=false;try{cfFillSvc(cfSvcSel)}catch(e){}cfUpdateFee();if(cfStep===4)cfSummary();if(cfStep===5)cfPay()};
function openCollabForm(editId){
 if(!currentUser||!currentUser.emailVerified)return toast("Entre com uma conta verificada para publicar tarefas.");
 cfEditId=editId||null;
 const sub=editId?myCollabs.find(x=>x.id===editId):null;
 if(editId&&!sub)return;
 cfRewManual=!!sub;
 $("cf-cur").value=sub?.rewardCur||"brl";
 cfFeeMode="brl";
 $("cform-title").textContent=sub?(sub.status==="rejected"?"Recorrer · reenviar tarefa":"Editar tarefa enviada"):"Publicar tarefa de colaborador";
 cfFillCats(sub?.category||"");
 if(sub?.serviceId)cfFillSvc(sub.serviceId);
 $("cf-name").value=sub?.name||"";
 if(sub){const sv=Number(sub.reward||sub.suggestedReward)||1;$("cf-reward").value=cfRewardCur()==="brl"?sv:Math.max(1,Math.floor(sv))}
 $("cf-vagas").value=sub?Math.max(1,Math.floor(Number(sub.stock)||1)):10;
 $("cf-desc").value=sub?.description||"";
 $("cf-steps-in").value=(sub?.steps||[]).join("\n");
 $("cf-rules-in").value=(Array.isArray(sub?.rules)?sub.rules:String(sub?.rules||"").split("\n").filter(Boolean)).join("\n");
 $("cf-req-in").value=(sub?.requirements||[]).join(" · ");
 $("cf-extra").value=sub?.extra||"";
 $("cf-review").value=String(Math.min(30,Math.max(1,Math.floor(Number(sub?.reviewDays)||3))));
 $("cf-link").value=sub?.link||"";
 if(sub){const p=sub.proofReq||{};$("cf-pt").checked=!!p.text;$("cf-pc").checked=!!p.code;$("cf-pi").checked=!!p.image;$("cf-pv").checked=!!p.video;$("cf-pd").checked=!!p.datetime}
 $("cf-proof").value=sub?.proofDetails||"";
 $("cf-min").value=String(Math.max(1,Math.floor(Number(sub?.minProofs)||1)));
 $("cf-note").value="";
 cfShow(1);
 renderCollabMine();
 clvAnun("form");
}
function closeCollabForm(){
 clvAnun("notice");
 cfEditId=null;
}
$("cform-close").onclick=closeCollabForm;
$("cform-cancel").onclick=closeCollabForm;
$("cform-mine").addEventListener("click",e=>{
 const edit=e.target.dataset.cfEdit;
 if(edit)openCollabForm(edit);
});
var cfSending=false;
$("cf-save").onclick=async()=>{
 if(cfSending)return toast("Aguarde: o envio já está em andamento. Não clique de novo. <i class=yi data-i=hourglass></i>");
 if(!currentUser||!currentUser.emailVerified)return toast("Entre com uma conta verificada para publicar tarefas.");
 cfSending=true;try{$("cf-save").disabled=true;$("cf-save").style.opacity=.6}catch(e){}
 try{
 if(!cfValidate())return;
 if(!cfEditId){
  /* limite de envios simultâneos pendentes — configurável no painel
     (settings/taskLimits.maxCollabPending; padrão 3) — evita flooding
     da fila de revisão da equipe */
  const lim=Math.max(1,Math.floor(Number(window.__taskLimits?.maxCollabPending)||3));
  const pend=myCollabs.filter(c=>(c.status||"pending")==="pending").length;
  if(pend>=lim)return toast("Você já tem "+pend+" tarefa(s) aguardando revisão e o limite é "+lim+". Aguarde a revisão da equipe antes de enviar outra. <i class=yi data-i=hourglass></i>");
 }
 const name=$("cf-name").value.trim();
 const description=$("cf-desc").value.trim();
 const link=$("cf-link").value.trim();
 const steps=$("cf-steps-in").value.split("\n").map(s=>s.trim()).filter(Boolean);
 const rules=$("cf-rules-in").value.split("\n").map(s=>s.trim()).filter(Boolean);
 const requirements=$("cf-req-in").value.trim()?$("cf-req-in").value.split(/[·\n]/).map(s=>s.trim()).filter(Boolean):[];
 const extra=$("cf-extra").value.trim();
 const reviewDays=Math.min(30,Math.max(1,Math.floor(Number($("cf-review").value)||3)));
 const proofDetails=$("cf-proof").value.trim();
 const note=$("cf-note").value.trim();
 const reward=cfRewardCur()==="brl"?Math.max(0.01,Number($("cf-reward").value)||0):Math.max(1,Math.floor(Number($("cf-reward").value)||1));
 const rewardCur=cfRewardCur();
 const ticketType="common";
 const vagas=cfVagas();
 const category=cfCatSel;
 const serviceId=cfSvcSel;
 const serviceLabel=cfSvcOf(category,serviceId)?.label||name;
 const dk=cfDiffKeyOf(cfSvcOf(category,serviceId)?.difficulty);
 const pr={text:$("cf-pt").checked,code:$("cf-pc").checked,image:$("cf-pi").checked,video:$("cf-pv").checked,datetime:$("cf-pd").checked};
 const prOn=Object.keys(pr).filter(k=>pr[k]);
 const minProofs=prOn.length?Math.max(Number($("cf-min").value)||1,dk==="simple"?1:2):0;
 if(prOn.length&&minProofs>prOn.length)return toast("Mínimo de provas maior que os tipos exigidos.");
 const wasRejected=cfEditId?(myCollabs.find(x=>x.id===cfEditId)?.status==="rejected"):false;
 const data={
  uid:currentUser.uid,
  email:currentUser.email||"",
  ownerName:(profile?.name||"").trim()||"Colaborador",
  name,category,serviceId,serviceLabel,difficulty:dk,reward,rewardCur,ticketType,stock:vagas,
  description,steps,rules,requirements,extra,reviewDays,link,proofReq:pr,minProofs,proofDetails,
  suggestedReward:reward,note,
  status:"pending",
  updatedAt:serverTimestamp()
 };
 if(cfEditId){
  data.editedAt=serverTimestamp();
  if(wasRejected){data.appealed=true;data.appealNote=note}
  /* fecha a brecha da edição: numa tarefa AINDA NÃO PUBLICADA, aumentar
     recompensa ou vagas depois de pagar a taxa agora cobra a DIFERENÇA de
     30% na hora (na mesma moeda da taxa original). Se a taxa foi devolvida
     (negação anterior), a taxa cheia do novo valor é cobrada de novo. */
  const sub=myCollabs.find(x=>x.id===cfEditId);
  const notPublished=!sub||sub.status!=="approved";
  let feeMsg="";
  if(notPublished){
   const feeCur=sub?.feeCur||"brl";
   const paid=sub?.feeRefunded?0:(Number(sub?.feePaid)||0);
   const newFee=cfFeePts();
   const diff=Math.round((newFee-paid)*100)/100;
   if(diff>0.009){
    const uid=currentUser.uid,wRef=doc(db,"wallets",uid);
    try{
     await runTransaction(db,async tx=>{
      const wd=await tx.get(wRef);
      const w=wd.exists()?wd.data():{};
      const patch={...data,feePaid:newFee,feeCur,feeRefunded:false,updatedAt:serverTimestamp()};
      if(feeCur==="coin"){
       const need=Math.ceil(diff*1000);
       if(Math.max(0,Math.floor(Number(w.coins)||0))<need)throw new Error("Moedas Yshipp insuficientes para a diferença de taxa ("+need+" moedas). Reduza a recompensa ou as vagas, ou pague a diferença em reais recomeçando o envio.");
       tx.set(wRef,{...w,coins:Math.max(0,Math.floor(Number(w.coins)||0))-need,updatedAt:serverTimestamp()},{merge:true});
       tx.set(doc(collection(db,"wallets",uid,"history")),{kind:"xc_spend",amount:0,xcKind:"coin",xcQty:need,reason:"Diferença de taxa de publicação (edição de tarefa ainda não publicada)",collabId:cfEditId,createdAt:serverTimestamp()});
      }else{
       const spend=spendValue(w,diff);
       if(!spend)throw new Error("Saldo insuficiente para a diferença de taxa ("+fmtBRL(diff)+"). Reduza a recompensa ou as vagas e tente de novo.");
       tx.set(wRef,{...applySpend(w,spend),updatedAt:serverTimestamp()},{merge:true});
       tx.set(doc(collection(db,"wallets",uid,"history")),{kind:"collab_fee",amount:diff,reason:"Diferença de taxa de publicação (edição de tarefa ainda não publicada)",collabId:cfEditId,createdAt:serverTimestamp()});
      }
      tx.set(doc(db,"collabTasks",cfEditId),patch,{merge:true});
     });
     feeMsg=feeCur==="coin"?(" Diferença de taxa cobrada: "+Math.ceil(diff*1000)+" moedas."):(" Diferença de taxa cobrada: "+fmtBRL(diff)+".");
    }catch(err){
     if(String(err?.message||"").includes("suficiente"))return toast(err.message);
     showError(err);return;
    }
   }
  }
  try{
   if(!feeMsg)await setDoc(doc(db,"collabTasks",cfEditId),data,{merge:true});
   closeCollabForm();
   toast((wasRejected?"Recurso enviado! A equipe vai revisar de novo. <i class=yi data-i=hands></i>":"Tarefa atualizada e reenviada para revisão. <i class=yi data-i=handshake></i>")+feeMsg);
  }catch(err){showError(err)}
  return;
 }
 /* NOVO ENVIO: taxa de 30% (fora do X) descontada da carteira agora e
    RETIDA pela equipe — ela entra no <i class=yi data-i=trophy></i> Cofre Real somente quando a
    tarefa for PUBLICADA no painel. Se for negada, volta para a carteira. */
 const fee=cfFeePts();
 const uid=currentUser.uid,wRef=doc(db,"wallets",uid);
 /* o documento do envio é criado ANTES e gravado DENTRO da transação:
    se qualquer parte falhar (débito OU gravação), nada é debitado —
    antes, a gravação acontecia fora da transação e uma falha depois do
    débito fazia o colaborador perder a taxa sem a tarefa ser enviada */
 const collabRef=doc(collection(db,"collabTasks"));
 try{
  await runTransaction(db,async tx=>{
   const wd=await tx.get(wRef);
   const w=wd.exists()?wd.data():{};
   if(cfFeeMode==="coin"){
    /* taxa paga com Moedas Yshipp: a moeda das tarefas (10 moedas = R$ 0,01) */
    const need=fee*1000;
    if(Math.max(0,Math.floor(Number(w.coins)||0))<need)throw new Error("Moedas Yshipp insuficientes para a taxa ("+need+" moedas). Compre no Market (aba Pacotes) ou pague em reais.");
    tx.set(wRef,{...w,coins:Math.max(0,Math.floor(Number(w.coins)||0))-need,updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",uid,"history")),{kind:"xc_spend",amount:0,xcKind:"coin",xcQty:need,reason:"Taxa de publicação de tarefa de colaborador paga com Moedas Yshipp ("+need+" moedas)",createdAt:serverTimestamp()});
   }else{
    const spend=spendValue(w,fee);
    if(!spend)throw new Error("Saldo insuficiente para a taxa de publicação ("+fmtBRL(fee)+"). Faça tarefas para acumular e tente de novo.");
    tx.set(wRef,{...applySpend(w,spend),updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",uid,"history")),{kind:"collab_fee",amount:fee,reason:"Taxa de publicação de tarefa de colaborador (30% de "+fmtBRL(cfRewardPts())+")",createdAt:serverTimestamp()});
   }
   /* gravação do envio DENTRO da mesma transação do débito */
   tx.set(collabRef,{...data,feePaid:fee,feeCur:cfFeeMode,createdAt:serverTimestamp(),appeals:0});
  });
  closeCollabForm();
  toast(cfFeeMode==="coin"?("Taxa de "+(fee*1000)+" moedas paga e tarefa enviada para revisão! Se for negada, as moedas voltam para a sua carteira. <i class=yi data-i=handshake></i>"):("Taxa de "+fmtBRL(fee)+" paga e tarefa enviada para revisão! Se for negada, a taxa volta para a sua carteira. <i class=yi data-i=handshake></i>"));
 }catch(err){
  if(String(err?.message||"").includes("insuficiente"))return toast(err.message);
  showError(err);
 }
 }finally{cfSending=false;try{$("cf-save").disabled=false;$("cf-save").style.opacity=""}catch(e){}}
};

/* ============================================================
   19g · CENTRAL DO COLABORADOR · inspeção das provas (tela cheia)
   Dono de tarefa publicada (tasks com source:"collab" e ownerUid)
   inspeciona os comprovantes enviados em taskClaims e decide:
   aprovar (credita na hora na carteira), pedir correção ou negar.
   Abre pela gaveta #claveta a partir do MENU ("Avaliar provas")
   e do resumo da seção Ofertas dos colaboradores (#clv-teaser).
   O participante pode levar o caso ao suporte com o ID da tarefa
   (coleção "disputes" — auditada pelo painel na aba Disputas).
   ============================================================ */
let clvIsOpen=false,clvClaims={},clvUns=[],clvKey=null,clvFilter="pending",clvTask="all",dispTaskId=null;
const clvMyTasks=()=>tasks.filter(t=>t.source==="collab"&&t.ownerUid&&currentUser&&t.ownerUid===currentUser.uid);
const clvAllMine=()=>{const ids=new Set(clvMyTasks().map(t=>t.id));return Object.values(clvClaims).filter(c=>ids.has(c.taskId))};
function clvStop(){clvUns.forEach(f=>{try{f()}catch(e){}});clvUns=[];clvClaims={};clvKey=null;try{clvRenderAll()}catch(e){}}
/* aviso ao participante sobre a avaliação feita pelo colaborador — grava na
   mesma coleção "notifications" que o painel usa (target = uid), então chega
   como aviso instantâneo e fica na Central de Notificações do site */
async function clvNotify(uid,title,text){
 if(!uid)return;
 try{
  await addDoc(collection(db,"notifications"),{
   target:uid,
   title,
   category:"collab",
   link:"",
   code:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:sans-serif;background:#0b0e11;color:#eaecef"><div style="padding:28px 18px;max-width:560px;margin:auto"><h2 style="margin:0 0 10px">'+title+'</h2><p style="color:#848e9c;line-height:1.7">'+text+'</p></div></body></html>',
   createdAt:serverTimestamp()
  });
 }catch(e){console.warn("clvNotify:",e)}
}
function watchCollabReview(){
 const ids=clvMyTasks().map(t=>t.id).sort();
 const key=ids.join("|");
 if(key===clvKey)return;
 clvKey=key;
 clvUns.forEach(f=>{try{f()}catch(e){}});clvUns=[];clvClaims={};
 if(!ids.length){clvRenderAll();return}
 try{
  /* Firestore: no máximo 30 valores por consulta "in" — divide em blocos */
  for(let i=0;i<ids.length;i+=30){
   clvUns.push(onSnapshot(query(collection(db,"taskClaims"),where("taskId","in",ids.slice(i,i+30))),s=>{
    s.docChanges().forEach(ch=>{if(ch.type==="removed")delete clvClaims[ch.doc.id];else clvClaims[ch.doc.id]={id:ch.doc.id,...ch.doc.data()}});
    clvRenderAll();
   },e=>console.error("Provas das minhas tarefas:",e)));
  }
 }catch(e){console.error("Central do colaborador:",e)}
}
function clvCounts(){
 const m=clvAllMine();
 return{pend:m.filter(c=>(c.status||"pending")==="pending").length,ok:m.filter(c=>c.status==="approved").length,no:m.filter(c=>c.status==="rejected").length,chg:m.filter(c=>c.status==="changes").length,total:m.length};
}
function clvRenderAll(){
 if(clvFilter==="enviadas")renderCollabMine();
 const cnt=clvCounts(),mine=clvMyTasks();
 /* resumo na seção Ofertas dos colaboradores */
 const tz=$("clv-teaser");
 if(tz){
  if(currentUser&&currentUser.emailVerified&&mine.length){
   tz.hidden=false;
   tz.innerHTML=`<div class="clv-tbtn"><div style="min-width:0"><b><i class=yi data-i=handshake></i> Central do colaborador</b><p class="hint" style="margin:4px 0 0">${mine.length} oferta(s) sua(s) no ar · ${cnt.pend?`<b style="color:var(--acx)">${cnt.pend} prova(s) para avaliar</b>`:"tudo em dia — nenhuma prova esperando"}</p></div><button class="btn" type="button" data-clv="1">${cnt.pend?"Avaliar provas →":"Abrir central →"}</button></div>`;
  }else tz.hidden=true;
 }
 /* badge vermelho no menu */
 const mb=$("clv-menu-badge");
 if(mb){mb.hidden=!(currentUser&&cnt.pend>0);mb.textContent=cnt.pend}
 /* conteúdo da gaveta (só se estiver aberta) */
 if(!clvIsOpen)return;
 const st=$("clv-stats");
 if(st)st.innerHTML=[["toolbox","Tarefas publicadas",mine.length,""],["hourglass","Aguardando você",cnt.pend,"gold"],["checkc","Aprovadas",cnt.ok,"green"],["ban","Negadas",cnt.no,"red"]].map(([ic,l,v,c])=>`<div class="ap-kpi"><span class="kl">${ico(ic,14)}${l}</span><b class="${c}">${v}</b></div>`).join("");
 const tb=$("clv-tabs");
 if(tb)tb.innerHTML=`<button type="button" id="clv-anunciar-btn" data-collab="1" class="${clvFilter==="anunciar"?"on":""}">${ico("handshake",17)}<span>Anunciar oferta</span></button>`+`<button type="button" data-clv-tab="enviadas" class="${clvFilter==="enviadas"?"on":""}">${ico("send",17)}<span>Enviadas</span></button>`+[["pending","hourglass","Pendentes ("+cnt.pend+")"],["changes","edit","Correção ("+cnt.chg+")"],["approved","checkc","Aprovadas ("+cnt.ok+")"],["rejected","ban","Negadas ("+cnt.no+")"]].map(([k,ic,l])=>`<button type="button" data-clv-tab="${k}" class="${clvFilter===k?"on":""}">${ico(ic,17)}<span>${l}</span></button>`).join("");
 const ab=$("clv-anunciar-btn");
 if(ab)ab.classList.toggle("on",clvFilter==="anunciar");
 const sel=$("clv-tasksel");
 if(sel){
  let chipHidden=[];try{chipHidden=JSON.parse(localStorage.getItem("ycxChipHide")||"[]")}catch(e){}
  const hidN=mine.filter(t=>chipHidden.indexOf(t.id)>=0).length;
  sel.innerHTML=`<button type="button" class="clv-taskchip ${clvTask==="all"?"on":""}" data-clv-task="all"><span>Todas as minhas tarefas</span><b>${cnt.total} prova(s)</b></button>`+(hidN?`<button type="button" class="clv-taskchip" data-chipshow="1"><span>${hidN} tarefa(s) oculta(s)</span><b>mostrar</b></button>`:"")+mine.map(t=>{
   const n=clvAllMine().filter(c=>c.taskId===t.id).length;
   const pend=clvAllMine().filter(c=>c.taskId===t.id&&(c.status||"pending")==="pending").length;
   if(chipHidden.indexOf(t.id)>=0)return "";
   return `<button type="button" class="clv-taskchip ${clvTask===t.id?"on":""}" data-clv-task="${esc(t.id)}"><span>${esc(plainTxt(t.serviceLabel||t.name||t.id))} <button type="button" class="tid" data-copy="${esc(t.id)}" title="Toque para copiar o ID">${esc(t.id)}</button>${pend?` · <b style="color:var(--acx)">${pend} pendente(s)</b>`:""}</span><b>${n}</b><span class="chip-x" data-chipx="${esc(t.id)}" title="Ocultar">✕</span></button>`;
  }).join("");
 }
 const list=$("clv-list");
 if(!list)return;
 let items=clvAllMine().filter(c=>clvFilter==="pending"?(c.status||"pending")==="pending":c.status===clvFilter);
 if(clvTask!=="all")items=items.filter(c=>c.taskId===clvTask);
 items.sort((a,b)=>(stampMs(b.submittedAt)||0)-(stampMs(a.submittedAt)||0));
 if(!mine.length){
  list.innerHTML=`<div class="clv-claim"><b>Nenhuma tarefa publicada ainda</b><p class="hint" style="margin:0">Quando a equipe aprovar uma das suas tarefas enviadas, ela aparece no ar com o carimbo <i class=yi data-i=handshake></i> e as provas enviadas pelos participantes chegam aqui para você inspecionar. Envie uma tarefa pelo botão “Anunciar como colaborador”.</p></div>`;
  return;
 }
 list.innerHTML=(()=>{
  /* cabeçalho com os números da tarefa selecionada (ou agregado de todas):
     vagas restantes, provas aprovadas, total pago e prazo de avaliação */
  let head="";
  if(clvTask!=="all"){
   const t=tasks.find(x=>x.id===clvTask);
   if(t){
    const left=stockOf(t);
    const mt=clvAllMine().filter(c=>c.taskId===clvTask);
    const ok2=mt.filter(c=>c.status==="approved");
    const paid=ok2.reduce((s,c)=>s+((c.rewardCur||"brl")==="brl"?(Number(c.reward)||0):((Number(c.reward)||0)*cfCurBRL(c.rewardCur||"brl"))),0);
    const rv=Math.max(1,Math.floor(Number(t.reviewDays)||3));
    head=`<div class="clv-claim" style="border-color:var(--ac)"><b><i class=yi data-i=chart></i> Números de "${esc(plainTxt(t.serviceLabel||t.name||t.id))}"</b>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
     <span class="ap-m">${ico("list",12)} Vagas restantes <b>${left===null?"ilimitadas":left+" de "+Math.max(0,Math.floor(Number(t.stock)||0))}</b></span>
     <span class="ap-m">${ico("checkc",12)} Aprovadas <b>${ok2.length}</b></span>
     <span class="ap-m" style="color:var(--acx)">${ico("coins",12)} Total pago <b>≈ ${fmtBRL(paid)}</b></span>
     <span class="ap-m">${ico("clock",12)} Prazo de avaliação <b>${rv} dia(s) por prova</b></span>
    </div></div>`;
   }
  }else{
   const all=clvAllMine();
   const ok2=all.filter(c=>c.status==="approved");
   const paid=ok2.reduce((s,c)=>s+((c.rewardCur||"brl")==="brl"?(Number(c.reward)||0):((Number(c.reward)||0)*cfCurBRL(c.rewardCur||"brl"))),0);
   if(all.length)head=`<div class="clv-claim" style="border-color:var(--ac)"><b><i class=yi data-i=chart></i> Todas as suas tarefas</b>
   <div style="display:flex;gap:8px;flex-wrap:wrap">
    <span class="ap-m">${ico("checkc",12)} Aprovadas <b>${ok2.length}</b></span>
    <span class="ap-m" style="color:var(--acx)">${ico("coins",12)} Total pago <b>≈ ${fmtBRL(paid)}</b></span>
    <span class="ap-m">${ico("hourglass",12)} Pendentes <b>${cnt.pend}</b></span>
   </div></div>`;
  }
  return head+(items.length?items.map(clvClaimCard).join(""):`<div class="clv-claim"><p class="hint" style="margin:0">Nenhuma prova nesta visão.${clvFilter==="pending"?" Quando um participante concluir uma das suas tarefas e anexar o comprovante, ele aparece aqui para você avaliar.":""}</p></div>`);
 })();
}
function clvClaimCard(c){
 const t=tasks.find(x=>x.id===c.taskId)||{};
 const st=c.status||"pending";
 const rd=Math.max(0.01,Math.round((Number(t.reward??c.reward)||0.01)*100)/100),ty=t.ticketType||c.ticketType||"common",rc=t.rewardCur||c.rewardCur||"brl";
 const ini=String(c.participantName||"?").charAt(0).toUpperCase();
 const proofs=[
  c.proofText?["<i class=yi data-i=note></i> Texto da prova",c.proofText,false]:null,
  c.proofCode?["<i class=yi data-i=key></i> Código / cupom",c.proofCode,false]:null,
  c.proofImage?["<i class=yi data-i=image></i> Print (link da imagem)",c.proofImage,true]:null,
  c.proofVideo?["<i class=yi data-i=video></i> Gravação de tela (link)",c.proofVideo,true]:null,
  c.proofWhen?["<i class=yi data-i=clock></i> Data e hora da execução",c.proofWhen,false]:null
 ].filter(Boolean);
 const pending=st==="pending"||st==="changes";
 /* prazo de avaliação: submittedAt + reviewDays da tarefa — vencido, o
    colaborador pode escalar a prova para a equipe avaliar e pagar */
 const rv=Math.max(1,Math.floor(Number(t.reviewDays)||3));
 const dl=(stampMs(c.submittedAt)||0)+rv*864e5;
 const overdue=pending&&Date.now()>dl;
 const cls=st==="approved"?"ok":st==="rejected"?"no":pending?"wait":"";
 const stampTxt=c.reviewedAt?`Avaliada ${String(c.reviewedBy||"").startsWith("collab:")?"por você":"pela equipe"} em ${fmt(c.reviewedAt)}`:"";
 return `<div class="clv-claim ${cls}">
  <div class="clv-who">
   <span class="ico" aria-hidden="true">${esc(ini)}</span>
   <div class="nm"><b ${c.uid?`data-up="${esc(c.uid)}" style="cursor:pointer;text-decoration:underline dotted" title="Ver perfil público do participante"`:""}>${esc(c.participantName||"Participante")}</b><small>${esc(c.email||c.uid||"")} · enviada em ${fmt(c.submittedAt)}${c.uid?' · <span style="color:var(--acx)">ver perfil ↗</span>':""}</small></div>
   <span class="tag ${st==="approved"?"g":st==="rejected"?"r":st==="changes"?"y":"y"}" style="align-self:flex-start">${st==="approved"?"✓ Aprovada":st==="rejected"?"<i class=yi data-i=ban></i> Negada":st==="changes"?"<i class=yi data-i=edit></i> Correção pedida":"<i class=yi data-i=hourglass></i> Aguardando você"}</span>
  </div>
  <div class="clv-taskchip" style="cursor:default"><span><b style="font:600 13px var(--sans)">${esc(plainTxt(t.serviceLabel||t.name||c.taskId))}</b> <button type="button" class="tid" data-copy="${esc(c.taskId)}" title="Toque para copiar o ID">${esc(c.taskId)}</button></span><b>+${xcRewardTxt(rc,rd)}</b></div>
  <div class="clv-proofs">
   ${proofs.map(([lab,val,url])=>`<div class="clv-proof"><span>${lab}</span>${url&&/^https?:\/\//i.test(String(val))?`<a href="${esc(String(val))}" target="_blank" rel="noopener noreferrer">${esc(val)}</a>`:esc(val)}${url&&!/^https?:\/\//i.test(String(val))?` <small>(link inválido)</small>`:""}</div>`).join("")||'<div class="clv-proof"><span>Comprovante</span>'+esc(c.proof||"(nenhuma prova anexada)")+"</div>"}
  </div>
  ${c.blockedOwner===true?`<p class="clv-note" style="color:var(--acx)"><i class=yi data-i=shield></i> Este participante bloqueou você: a avaliação desta prova fica com a equipe Yshippcommerce.</p>`:""}
  ${overdue?`<p class="clv-note" style="color:var(--acx)"><i class=yi data-i=hourglass></i> Prazo de ${rv} dia(s) vencido — avalie agora ou escale para a equipe.</p>`:""}
  ${pending&&!c.blockedOwner?`
  <div class="field" style="margin:0"><label class="label">Nota para o participante (obrigatória em correção e negação)</label><textarea data-clv-note="${esc(c.id)}" maxlength="500" placeholder="Ex.: O print não mostra o @ do perfil — envie um print completo."></textarea></div>
  <div class="clv-act">
   <button class="btn sm" type="button" data-clv-ok="${esc(c.id)}"><i class=yi data-i=checkc></i> Aprovar e pagar +${xcRewardTxt(rc,rd)}</button>
   <button class="btn sm ghost" type="button" data-clv-chg="${esc(c.id)}"><i class=yi data-i=edit></i> Pedir correção</button>
   <button class="btn sm ghost" type="button" data-clv-no="${esc(c.id)}" style="color:var(--rd)"><i class=yi data-i=ban></i> Negar com motivo</button>
   ${overdue?`<button class="btn sm ghost" type="button" data-clv-esc="${esc(c.id)}"><i class=yi data-i=users></i> Escalar para a equipe</button>`:""}
  </div>`:`
  <p class="clv-note">${stampTxt}${st==="rejected"&&c.rejectionReason?" · Motivo: "+esc(c.rejectionReason):""}${st==="changes"&&c.reviewNote?" · Correção pedida: "+esc(c.reviewNote):""}</p>`}
 </div>`;
}
async function clvApprove(cid){
 const c=clvClaims[cid];
 if(!c)return toast("Prova não encontrada — atualize a página.");
 if(!(c.status==="pending"||c.status==="changes"))return toast("Esta prova já foi avaliada.");
 const t=tasks.find(x=>x.id===c.taskId);
 if(!t)return toast("Tarefa não encontrada — atualize a página.");
 const left=stockOf(t);
 if(left!==null&&left<=0)return toast("As vagas desta tarefa esgotaram — aprovação bloqueada.");
 const rd=Math.max(0.01,Math.round((Number(t.reward)||0.01)*100)/100),ty=t.ticketType||"common",rc=t.rewardCur||"brl";
 try{
  await runTransaction(db,async tx=>{
   const ref=doc(db,"taskClaims",cid);
   const cs=await tx.get(ref);
   if(!cs.exists())throw new Error("Prova não encontrada.");
   /* Turbo Tarefas: buff do PARTICIPANTE lido na hora, dentro da transação */
   const wsx=await tx.get(doc(db,"wallets",c.uid));
   const wb=wsx.exists?wsx.data():{};
   const nowx=Date.now();
   const bpx=Math.min(200,(Array.isArray(wb.buffs)?wb.buffs:[]).reduce((s,b)=>{if(!b||!b.effect||b.effect.type!=="taskBoost")return s;const stx=typeof b.startsAt==="number"?b.startsAt:(b.startsAt&&b.startsAt.toDate?b.startsAt.toDate().getTime():((b.startsAt&&b.startsAt.seconds)||0)*1000);const end=b.endsAtMs?b.endsAtMs:stx+(Number(b.durDays)||7)*864e5;return end>nowx?s+(Number(b.effect.pct)||0):s},0));
   const rdB=bpx?rd+Math.ceil(rd*bpx/100):rd;
   const st=cs.data().status;
   if(!(st==="pending"||st==="changes"))throw new Error("Esta prova já foi avaliada.");
   /* moeda do pagamento definida pelo colaborador: reais (padrão),
      bilhetes ou moedas — creditada na carteira correspondente */
   if(rc==="ticket")tx.set(doc(db,"wallets",c.uid),{tickets:increment(rdB),updatedAt:serverTimestamp()},{merge:true});
   else if(rc==="coin")tx.set(doc(db,"wallets",c.uid),{coins:increment(rdB),updatedAt:serverTimestamp()},{merge:true});
   else tx.set(doc(db,"wallets",c.uid),{[ty]:increment(rdB),updatedAt:serverTimestamp()},{merge:true});
   tx.set(doc(collection(db,"wallets",c.uid,"history")),{kind:rc==="ticket"||rc==="coin"?"xc_reward":"reward",amount:rc==="brl"?rdB:0,brl:rc==="brl"?rdB:0,xcKind:rc==="ticket"?"ticket":rc==="coin"?"coin":"",xcQty:rc==="brl"?0:rdB,ticketType:ty,taskId:t.id,taskName:t.serviceLabel||t.name||"",eventName:"",reason:rc==="ticket"?"Tarefa aprovada — pagamento em bilhetes":rc==="coin"?"Tarefa aprovada — pagamento em moedas":"",reviewedByOwner:true,createdAt:serverTimestamp()});
   /* vaga já foi reservada no envio da prova — não decrementa de novo */
   tx.update(ref,{status:"approved",reviewedAt:serverTimestamp(),reviewedBy:"collab:"+currentUser.uid,reviewerName:(profile?.name||"Colaborador").trim(),reward:rdB,ticketType:ty,rewardCur:rc});
  });
  toast(`Prova aprovada! +${xcRewardTxt(rc,rdB)} creditado(s) ao participante <i class=yi data-i=spark></i>`);
  clvNotify(c.uid,"Prova aprovada na tarefa "+(t.serviceLabel||t.name||""),"Boa notícia: sua prova foi avaliada pelo colaborador e aprovada. A recompensa de +"+xcRewardTxt(rc,rdB)+" já está na sua carteira. <i class=yi data-i=checkc></i>");
 }catch(err){showError(err)}
}
async function clvSetStatus(cid,status){
 const c=clvClaims[cid];
 if(!c)return;
 if(!(c.status==="pending"||c.status==="changes"))return toast("Esta prova já foi avaliada.");
 const box=document.querySelector(`[data-clv-note="${cid}"]`);
 const note=(box?.value||"").trim();
 if(!note)return toast(status==="changes"?"Escreva o que o participante deve corrigir.":"Explique o motivo da negação — o participante pode recorrer ao suporte.");
 try{
  await runTransaction(db,async tx=>{
   const ref=doc(db,"taskClaims",cid);
   const cs=await tx.get(ref);
   if(!cs.exists())throw new Error("Prova não encontrada.");
   const st=cs.data().status;
   if(!(st==="pending"||st==="changes"))throw new Error("Esta prova já foi avaliada.");
   tx.update(ref,{
    status,
    reviewNote:status==="changes"?note.slice(0,500):"",
    rejectionReason:status==="rejected"?note.slice(0,500):"",
    reviewedAt:serverTimestamp(),
    reviewedBy:"collab:"+currentUser.uid,
    reviewerName:(profile?.name||"Colaborador").trim()
   });
   /* reabre a vaga quando a prova é NEGADA (a reserva feita no envio volta) */
   if(status==="rejected" && c.taskId){
    const tRef=doc(db,"tasks",c.taskId);
    const ts=await tx.get(tRef);
    if(ts.exists()){
     const td=ts.data()||{};
     const tot=Math.max(0,Math.floor(Number(td.stock)||0));
     if(tot>0){
      const left=Number.isFinite(Number(td.stockLeft))?Math.floor(Number(td.stockLeft)):tot;
      tx.set(tRef,{stockLeft:Math.min(tot,left+1),updatedAt:serverTimestamp()},{merge:true});
     }
    }
   }
  });
  toast(status==="changes"?"Correção pedida: o participante vai reenviar a prova.":"Prova negada com motivo registrado. A vaga voltou para o site. Se ele desconfiar de má-fé, pode levar o caso ao suporte.");
  clvNotify(c.uid,status==="changes"?"Correção pedida na sua prova":"Prova negada na tarefa "+((tasks.find(x=>x.id===c.taskId)||{}).serviceLabel||c.taskId),
   status==="changes"
    ?("O colaborador pediu uma correção na sua prova: "+note.slice(0,300)+" Reenvie a prova corrigida na área de trabalho da tarefa. <i class=yi data-i=edit></i>")
    :("O colaborador negou a sua prova. Motivo: "+note.slice(0,300)+" A vaga voltou para o site. Se você desconfiar de má-fé na avaliação, leve o caso ao suporte com o ID da tarefa ("+c.taskId+") direto da área de trabalho. <i class=yi data-i=shield></i>"));
 }catch(err){showError(err)}
}
function openClv(){
 if(!currentUser||!currentUser.emailVerified){toast("Entre com uma conta verificada para usar a Central do colaborador.");return}
 clvIsOpen=true;
 $("claveta").classList.add("open");
 $("clav").classList.add("open");
 syncGavLock();
 clvSwap();
 clvRenderAll();
}
function openClvTo(f){clvFilter=f||"pending";openClv()}
function clvSwap(){
 const an=clvFilter==="anunciar";const A=$("clv-anunciar");if(A)A.hidden=!an;
 const E2=$("clv-enviadas");if(E2)E2.hidden=clvFilter!=="enviadas";
 ["clv-tasksel","clv-list","clv-stats"].forEach(id=>{const el=$(id);if(el)el.hidden=an||clvFilter==="enviadas"});
}
function closeClv(){
 clvIsOpen=false;
 $("claveta").classList.remove("open");
 $("clav").classList.remove("open");
 syncGavLock();
}
document.addEventListener("click",async e=>{
 const b=e.target.closest("[data-clv]");
 if(b){clvFilter="pending";openClv();return}
 const tab=e.target.closest("[data-clv-tab]");
 if(tab){clvFilter=tab.dataset.clvTab;clvSwap();clvRenderAll();return}
 const cx=e.target.closest("[data-chipx]");
 if(cx){let h=[];try{h=JSON.parse(localStorage.getItem("ycxChipHide")||"[]")}catch(e){}if(h.indexOf(cx.dataset.chipx)<0)h.push(cx.dataset.chipx);localStorage.setItem("ycxChipHide",JSON.stringify(h));toast("Tarefa oculta da lista. Use \u0022mostrar\u0022 para revert.");clvRenderAll();return}
 const cw=e.target.closest("[data-chipshow]");
 if(cw){localStorage.setItem("ycxChipHide","[]");clvRenderAll();return}
 const tk=e.target.closest("[data-clv-task]");
 if(tk){clvTask=tk.dataset.clvTask;clvRenderAll();return}
 const ok=e.target.closest("[data-clv-ok]");
 if(ok)return clvApprove(ok.dataset.clvOk);
 const escBtn=e.target.closest("[data-clv-esc]");
 if(escBtn){
  const cid=escBtn.dataset.clvEsc;
  try{
   await updateDoc(doc(db,"taskClaims",cid),{escalated:true,escalatedAt:serverTimestamp()});
   toast("Prova escalada para a equipe: eles vão avaliar e pagar. <i class=yi data-i=users></i>");
  }catch(err){showError(err)}
  return;
 }
 const ch=e.target.closest("[data-clv-chg]");
 if(ch)return clvSetStatus(ch.dataset.clvChg,"changes");
 const no=e.target.closest("[data-clv-no]");
 if(no)return clvSetStatus(no.dataset.clvNo,"rejected");
 if(e.target.closest("#clv-x"))return closeClv();
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&clvIsOpen)closeClv()});

/* ============================================================
   GAVETAS DE TELA CHEIA · SORTEIOS E LEILÕES
   A tela inicial mostra só resumos; cada assunto abre a sua
   própria tela completa, descendo até logo abaixo do cabeçalho.
   ============================================================ */
let sgIsOpen=false,lgIsOpen=false;
function openSg(){sgIsOpen=true;$("sgaveta").classList.add("open");$("sgav").classList.add("open");syncGavLock()}
function closeSg(){sgIsOpen=false;$("sgaveta").classList.remove("open");$("sgav").classList.remove("open");syncGavLock()}
function openLg(){lgIsOpen=true;$("lgaveta").classList.add("open");$("lgav").classList.add("open");syncGavLock()}
function closeLg(){lgIsOpen=false;$("lgaveta").classList.remove("open");$("lgav").classList.remove("open");syncGavLock()}
try{const _lx=$("lg-auc-x");if(_lx)_lx.onclick=()=>closeLg()}catch(e){}
document.addEventListener("click",e=>{
 if(e.target.closest("#sg-x"))return closeSg();
 if(e.target.closest("#lg-auc-x"))return closeLg();
 const a=e.target.closest('a[href="#sorteios"],[data-sg]');
 if(a){e.preventDefault();openSg();return}
 const l=e.target.closest('a[href="#leiloes"],[data-lg]');
 if(l){e.preventDefault();openLg();return}
 const p=e.target.closest('a[href="#participar"]');
 if(p){e.preventDefault();openSg()}
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(sgIsOpen)closeSg();if(lgIsOpen)closeLg();if(ogIsOpen)closeOg();if(cogIsOpen)closeCog();if(rgIsOpen)closeRg();if(cgIsOpen)closeCg()}});
/* Escape para TODAS as demais gavetas (market, carteira, mina, forja, eventos,
   engajamento, VIP, pagamento, centrais, AppHub, login…): fecha só a gaveta
   mais ao topo que estiver aberta. A gaveta de anúncio fica de fora de propósito
   (o fechamento durante a contagem é controlado pelo próprio fluxo do anúncio). */
document.addEventListener("keydown",e=>{
 if(e.key!=="Escape")return;
 const closes={
  claveta:closeClv,prosgaveta:closeProsGaveta,offergaveta:closeOfferGaveta,svcadsgaveta:closeSvcAdsGaveta,caixagaveta:closeCaixaGaveta,"login-gaveta":closeLoginGaveta,appgaveta:ahClose,
  adcveta:adcClose,adctool:()=>{try{$("adct-x").click()}catch(err){}},
  pesgaveta:pesClose,pescgaveta:pesNewClose,adcngaveta:adcWClose,pescmgaveta:pesCenterClose,
  mktgaveta:mktClose,walgaveta:walClose,mngaveta:mnClose,fjgaveta:fjClose,
  evtgaveta:evtClose,affgaveta:affClose,vipgaveta:vipClose,paygaveta:payClose
 };
 const open=[...document.querySelectorAll(".gaveta.open")].filter(g=>closes[g.id]);
 const top=open[open.length-1];
 if(top){try{closes[top.id]()}catch(err){}}
});

/* ═══ GAVETAS DE OFERTAS, RESULTADOS E MINHA CONTA · 100% tela cheia ═══ */
let ogIsOpen=false,cogIsOpen=false,rgIsOpen=false,cgIsOpen=false;
/* a gaveta "Minha conta" nasce dentro do menu; muda para o corpo da página
   para continuar visível mesmo com o menu fechado */
try{const cg=$("cgaveta");if(cg)document.body.appendChild(cg)}catch(e){}
function openOg(){ogIsOpen=true;$("ogaveta").classList.add("open");$("ogav").classList.add("open");syncGavLock()}
function closeOg(){ogIsOpen=false;$("ogaveta").classList.remove("open");$("ogav").classList.remove("open");syncGavLock()}
function openCog(){cogIsOpen=true;$("cogaveta").classList.add("open");$("cogav").classList.add("open");syncGavLock()}
function openProsGaveta(){
 if(!$("prosgaveta")||!$("prosv")){console.warn("prosgaveta missing");return}
 $("prosgaveta").classList.add("open");$("prosv").classList.add("open");
 try{syncGavLock()}catch(e){}
 try{renderProsSite()}catch(e){console.error(e)}
}
function closeProsGaveta(){
 if($("prosgaveta"))$("prosgaveta").classList.remove("open");
 if($("prosv"))$("prosv").classList.remove("open");
 try{syncGavLock()}catch(e){}
}
function openOfferGaveta(){
 if(!$("offergaveta")||!$("offerv"))return;
 $("offergaveta").classList.add("open");$("offerv").classList.add("open");
 try{syncGavLock()}catch(e){}
 try{fillOfferForm()}catch(e){console.error(e)}
}
function closeOfferGaveta(){
 if($("offergaveta"))$("offergaveta").classList.remove("open");
 if($("offerv"))$("offerv").classList.remove("open");
 try{syncGavLock()}catch(e){}
}
function openSvcAdsGaveta(){
 if(!$("svcadsgaveta")||!$("svcadsv"))return;
 $("svcadsgaveta").classList.add("open");$("svcadsv").classList.add("open");
 try{syncGavLock()}catch(e){}
 try{fillSvcAds()}catch(e){console.error(e)}
}
function closeSvcAdsGaveta(){
 if($("svcadsgaveta"))$("svcadsgaveta").classList.remove("open");
 if($("svcadsv"))$("svcadsv").classList.remove("open");
 try{syncGavLock()}catch(e){}
}
function openCaixaGaveta(){
 if(!$("caixagaveta")||!$("caixav"))return;
 $("caixagaveta").classList.add("open");$("caixav").classList.add("open");
 try{syncGavLock()}catch(e){}
 try{renderCaixa()}catch(e){console.error(e)}
}
function closeCaixaGaveta(){
 if($("caixagaveta"))$("caixagaveta").classList.remove("open");
 if($("caixav"))$("caixav").classList.remove("open");
 try{syncGavLock()}catch(e){}
}
document.addEventListener("click",function(e){
 var t=e.target&&e.target.closest?e.target.closest("[data-pros],[data-offer-svc],[data-svc-ads],[data-caixa],#prosv-x,#offerv-x,#svcadsv-x,#caixav-x"):null;
 if(!t)return;
 if(t.id==="prosv-x"){e.preventDefault();closeProsGaveta();return}
 if(t.id==="offerv-x"){e.preventDefault();closeOfferGaveta();return}
 if(t.id==="svcadsv-x"){e.preventDefault();closeSvcAdsGaveta();return}
 if(t.id==="caixav-x"){e.preventDefault();closeCaixaGaveta();return}
 if(t.getAttribute("data-pros")!=null||(t.closest&&t.closest("[data-pros]"))){e.preventDefault();e.stopPropagation();openProsGaveta();return}
 if(t.getAttribute("data-offer-svc")!=null||(t.closest&&t.closest("[data-offer-svc]"))){e.preventDefault();e.stopPropagation();openOfferGaveta();return}
 if(t.getAttribute("data-svc-ads")!=null||(t.closest&&t.closest("[data-svc-ads]"))){e.preventDefault();e.stopPropagation();openSvcAdsGaveta();return}
 if(t.getAttribute("data-caixa")!=null||(t.closest&&t.closest("[data-caixa]"))){e.preventDefault();e.stopPropagation();openCaixaGaveta();return}
},true);
function closeCog(){cogIsOpen=false;$("cogaveta").classList.remove("open");$("cogav").classList.remove("open");syncGavLock()}
function openRg(){rgIsOpen=true;$("rgaveta").classList.add("open");$("rgav").classList.add("open");syncGavLock()}
function closeRg(){rgIsOpen=false;$("rgaveta").classList.remove("open");$("rgav").classList.remove("open");syncGavLock()}
function openCg(){cgIsOpen=true;$("cgaveta").classList.add("open");$("cgav").classList.add("open");syncGavLock()}
function closeCg(){cgIsOpen=false;$("cgaveta").classList.remove("open");$("cgav").classList.remove("open");syncGavLock()}
document.addEventListener("click",e=>{
 if(e.target.closest("#og-x"))return closeOg();
 if(e.target.closest("#cog-x"))return closeCog();
 if(e.target.closest("#rg-x"))return closeRg();
 if(e.target.closest("#c-x"))return closeCg();
 const o=e.target.closest('a[href="#ofertas"],[data-of]');
 if(o){e.preventDefault();openOg();return}
 const co=e.target.closest('a[href="#ofertas-colab"],[data-cof]');
 if(co){e.preventDefault();openCog();return}
 const r=e.target.closest('a[href="#resultado"],[data-res]');
 if(r){e.preventDefault();openRg();return}
 const c=e.target.closest("[data-conta]");
 if(c){const ms=$("menu-sheet");if(ms)ms.hidden=true;openCg();return}
});
/* resumos ao vivo da tela inicial (contagem + destaques) */
function renderResumo(){
 const so=$("res-sg-open"),su=$("res-sg-sub"),ao=$("res-lg-open"),au=$("res-lg-sub");
 if(!so)return;
 const op=draws.filter(d=>drawStateOf(d)==="open");
 const fu=draws.filter(d=>["waiting","paused"].includes(drawStateOf(d)));
 so.textContent=op.length;
 su.innerHTML=op.length?op.slice(0,2).map(d=>esc(d.name||"Sorteio")).join(" · ")+(op.length>2?" e outros":""):(fu.length?fu.length+" futuro(s) no calendário":"Nenhum aberto agora — volte mais tarde");
 const la=auctions.filter(a=>a.status==="open");
 ao.textContent=la.length;
 au.innerHTML=la.length?la.slice(0,2).map(a=>esc(a.name||"Leilão")).join(" · ")+(la.length>2?" e outros":""):"Nenhum leilão aberto agora — volte mais tarde";
 /* blocos de Tarefas: ofertas oficiais e de colaboradores separadas */
 const tk=$("res-tk-open"),ts=$("res-tk-sub");
 if(tk){
  const onAll=generalTasks().filter(t=>offerState(t)==="on");
  const on=onAll.filter(t=>t.source!=="collab");
  tk.textContent=on.length;
  if(ts)ts.innerHTML=on.length?"Ofertas oficiais da plataforma. Cada aprovação credita reais (R$).":"Nenhuma tarefa oficial ativa agora — volte mais tarde";
 }
 const ck=$("res-cof-open"),cs=$("res-cof-sub");
 if(ck){
  const onC=generalTasks().filter(t=>offerState(t)==="on"&&t.source==="collab");
  ck.textContent=onC.length;
  if(cs)cs.innerHTML=onC.length?"Ofertas <i class=yi data-i=handshake></i> de parceiros revisadas pela equipe.":"Nenhuma oferta de colaborador ativa agora";
 }
 const tbE=$("tb-evt");
 if(tbE){const nn=op.length+la.length;tbE.hidden=!nn;tbE.textContent=String(nn)}
 /* contadores ao vivo dos cards de tarefas: mesma fonte que alimenta o resumo,
    sem script avulso (evita dessincronizar com o estado real das ofertas) */
 try{
  const nOf=(sel)=>{const h=$(sel);if(!h)return null;const k=h.querySelectorAll(".card,.task,.evc").length;return k||h.children.length||0};
  const a=nOf("#offs"),b=nOf("#offs-colab");
  const ea=$("res-of-n");if(ea)ea.textContent=a==null?"—":a+" ativa"+(a===1?"":"s")+" agora";
  const eb=$("res-cof-n");if(eb)eb.textContent=b==null?"—":b+" no ar";
 }catch(e){}
}
try{renderResumo()}catch(e){}
/* ---- DISPUTA: participante leva o caso ao suporte com o ID da tarefa ---- */
function openDispute(id){
 const t=tasks.find(x=>x.id===id);
 if(!t)return;
 if(!currentUser||!currentUser.emailVerified){toast("Entre com uma conta verificada para levar o caso ao suporte.");return}
 dispTaskId=id;
 $("disp-info").innerHTML=`Tarefa: <b>${esc(t.serviceLabel||t.name||"")}</b> · ID <b class="mono">${esc(t.id)}</b> · Colaborador: <b>${esc(t.ownerName||"—")}</b> · Sua prova: <b>${claims[t.id]?{pending:"aguardando avaliação",changes:"correção pedida",approved:"aprovada",rejected:"negada"}[claims[t.id].status]||claims[t.id].status:"ainda não enviada"}</b>`;
 $("disp-reason").value="";
 $("disp-modal").hidden=false;
}
function closeDispute(){$("disp-modal").hidden=true;dispTaskId=null}
$("disp-close").onclick=closeDispute;
$("disp-cancel").onclick=closeDispute;
$("disp-modal").addEventListener("click",e=>{if(e.target===$("disp-modal"))closeDispute()});
$("disp-send").onclick=async()=>{
 if(!dispTaskId)return;
 const t=tasks.find(x=>x.id===dispTaskId);
 if(!t)return closeDispute();
 const reason=($("disp-reason").value||"").trim();
 if(reason.length<10)return toast("Descreva a suspeita com pelo menos 10 caracteres.");
 const c=claims[t.id]||{};
 try{
  await addDoc(collection(db,"disputes"),{
   taskId:t.id,
   taskName:t.serviceLabel||t.name||"",
   claimId:currentUser.uid+"_"+t.id,
   collabId:t.collabId||"",
   ownerUid:t.ownerUid||"",
   ownerName:t.ownerName||"",
   uid:currentUser.uid,
   participantName:(profile?.name||"Participante").trim(),
   email:currentUser.email||"",
   reason:reason.slice(0,800),
   claimStatus:c.status||"",
   proofText:c.proofText||"",
   proofCode:c.proofCode||"",
   proofImage:c.proofImage||"",
   proofVideo:c.proofVideo||"",
   proofWhen:c.proofWhen||"",
   status:"open",
   createdAt:serverTimestamp()
  });
  closeDispute();
  toast("Caso enviado ao suporte com o ID da tarefa "+t.id+". A equipe vai auditar a avaliação e pode reverter a decisão. <i class=yi data-i=shield></i>");
 }catch(err){showError(err)}
};
document.addEventListener("click",e=>{
 const dp=e.target.closest("[data-dispute]");
 if(dp)openDispute(dp.dataset.dispute);
});

/* ============================================================
   19d-3 · COFRE REAL · sorteio mensal das taxas de publicação
   Todas as taxas de 30% pagas pelos colaboradores somam aqui
   (settings/cofre · pot). Participante escolhe 1 número de 1 a
   1000 (cofreTickets/{uid}_{mês}). No fim do mês a equipe sorteia:
   quem tem o número sorteado leva o cofre (dividido entre
   ganhadores); se ninguém acertar, acumula para o mês seguinte.
   Histórico dos sorteios em cofireDraws (mesma coleção do painel).
   ============================================================ */
const cofreMonthKey=(d=new Date())=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
let cofrePot=0,cofreDraws=[],cofreMy=null,unCof=null;
const cofreFmt=v=>fmtBRL(Number(v)||0);const cofireFmt=cofreFmt;
onSnapshot(doc(db,"settings","cofre"),s=>{const d=s.exists()?s.data():{};cofrePot=Math.max(0,Math.floor(Number(d.pot)||0));renderCofre()},e=>console.error("Cofre:",e));
onSnapshot(query(collection(db,"cofireDraws"),orderBy("createdAt","desc"),limit(10)),s=>{cofreDraws=s.docs.map(d=>({id:d.id,...d.data()}));renderCofre()},e=>console.error("Sorteios do cofre:",e));
function watchCofreMy(uid){
 if(unCof){try{unCof()}catch(e){}unCof=null}
 cofreMy=null;
 if(!uid){renderCofre();return}
 try{
  unCof=onSnapshot(doc(db,"cofreTickets",uid+"_"+cofreMonthKey()),x=>{cofreMy=x.exists()?x.data():null;renderCofre()},e=>console.error("Número do cofre:",e));
 }catch(e){console.error("Cofre (meu número):",e)}
}
function cofreCountdown(){
 const now=new Date();
 const end=new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59);
 const days=Math.max(0,Math.ceil((end-now)/864e5));
 return "sorteio em até "+days+" dia(s) · "+["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"][now.getMonth()];
}
function renderCofre(){
 /* card resumido no carrossel de oportunidades (seção #cofire foi removida) */
 const cp=$("cfrep-pot");
 if(cp)cp.textContent=cofreFmt(cofrePot);
 const cc=$("cfrep-count");if(cc)cc.textContent=cofreCountdown();
 const cmy=$("cfrep-my");if(cmy)cmy.textContent=cofreMy?"Seu número: Nº "+Math.floor(Number(cofreMy.number)||0):"Escolha seu número na tela cheia";
 if(!$("cfre-pot")){if(sheetOpen==="cofire"){try{renderCofireSheet()}catch(e){}}return}
 $("cfre-pot").textContent=cofreFmt(cofrePot);
 $("cfre-month").textContent=cofreMonthKey();
 $("cfre-count").textContent=cofreCountdown();
 $("cfre-mine").textContent=cofreMy?"Nº "+Math.floor(Number(cofreMy.number)||0):"—";
 $("cfre-tag").textContent="Acumulado: "+cofreFmt(cofrePot);
 const dn=$("cfre-drawn-n");if(dn)dn.textContent=String(cofreDraws.length);
 if(sheetOpen==="cofire")renderCofireSheet();
 /* botão explícito: se já escolheu número, mostra que dá para trocar */
 const elBtn=$("cfre-pick");
 if(elBtn)elBtn.innerHTML=(cofreMy?"Alterar número ":"Confirmar número ")+"<i class=yi data-i=spark></i>";
 if(cofreMy&&!$("cfre-num").value)$("cfre-num").value=Math.floor(Number(cofreMy.number)||"")||"";
 $("cfre-draws").innerHTML=cofreDraws.length?cofreDraws.map(d=>{
  const w=Array.isArray(d.winners)?d.winners:[];
  return `<div class="cform-item"><div class="cf-head"><b>${esc(d.monthKey||"—")} · número sorteado: <span class="mono">${Math.floor(Number(d.drawnNumber)||0)}</span></b>${d.rolledOver?'<span class="tag y">Ninguém acertou · acumulou</span>':`<span class="tag g">${w.length} ganhador(es)</span>`}</div>
  <p class="hint">Cofre do mês: ${cofreFmt(Math.floor(Number(d.pot)||0))}${w.length?" · "+w.map(x=>esc(x.displayName||"?")+" levou "+cofreFmt(Math.floor(Number(x.payout)||0))).join(" · "):""}</p></div>`;
 }).join(""):'<p class="hint">O primeiro sorteio acontece no fim deste mês. Boa sorte!</p>';
}
const cfrePickBtn=$("cfre-pick");if(cfrePickBtn)cfrePickBtn.onclick=async()=>{
 if(!termsOk())return askTerms();
 if(!currentUser||!currentUser.emailVerified)return toast("Entre com uma conta verificada para escolher seu número do Cofre Real.");
 if(profile?.banned)return toast("Sua conta foi suspensa pelo organizador.");
 if(!profileOk())return toast("Salve seus dados de perfil primeiro.");
 const n=Math.floor(Number($("cfre-num").value));
 if(!Number.isInteger(n)||n<1||n>1000)return toast("Escolha um número entre 1 e 1000.");
 try{
  const prev=cofreMy?Math.floor(Number(cofreMy.number)||0):0;
  await setDoc(doc(db,"cofreTickets",currentUser.uid+"_"+cofreMonthKey()),{uid:currentUser.uid,displayName:(profile?.name||"").trim()||"Participante",number:n,monthKey:cofreMonthKey(),updatedAt:serverTimestamp()},{merge:true});
  toast(prev===n?("Número "+n+" mantido no Cofre Real! Boa sorte!"):prev?("Número alterado: "+prev+" → "+n+" no Cofre Real! Boa sorte!"):("Número "+n+" confirmado no Cofre Real! Boa sorte!")+" <i class=yi data-i=spark></i>");
 }catch(err){showError(err)}
};
/* tela cheia do Cofre Real: acumulado, origem, histórico, evolução, regras e número da sorte */
function renderCofireSheet(){
 const b=$("cf2-body");if(!b)return;
 const hist=[...cofireDraws].sort((a,x)=>String(a.monthKey||"").localeCompare(String(x.monthKey||"")));
 const paidOut=hist.reduce((s,d)=>s+Math.max(0,Math.floor(Number(d.pot)||0)),0);
 const pts=hist.map(d=>Math.max(0,Math.floor(Number(d.pot)||0)));
 const my=cofireMy?Math.floor(Number(cofireMy.number)||0):0;
 b.innerHTML=`
 <div class="card" style="border-color:var(--ac);background:linear-gradient(150deg,var(--as),var(--p) 78%);padding:20px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
  <div style="min-width:0">
   <div class="vault-label"><i class=yi data-i=safe></i> Valor total acumulado no cofre</div>
   <b class="vault-big">${cofreFmt(cofirePot)}</b>
   <small class="hint">em reais (R$) · ${cofireCountdown()}</small>
  </div>
  <span class="vault-chip"><i class=yi data-i=gavel></i> Taxas de publicação (30%)</span>
 </div>
 <div class="vault-grid">
  <div class="vault-cell"><span class="vault-label"><i class=yi data-i=cash></i> Reais acumulados (R$)</span><b>${cofreFmt(cofirePot)}</b></div>
  <div class="vault-cell"><span class="vault-label"><i class=yi data-i=gavel></i> Origem dos valores</span><b class="txt">Taxas de publicação (30%) dos colaboradores</b></div>
  <div class="vault-cell"><span class="vault-label"><i class=yi data-i=trophy></i> Já distribuído</span><b>${cofreFmt(paidOut)}</b></div>
  <div class="vault-cell"><span class="vault-label"><i class=yi data-i=hourglass></i> Sorteios realizados</span><b>${hist.length}</b></div>
 </div>
 ${pts.length>1?`<div class="card" style="margin-top:12px;padding:14px"><div class="ws-h">Evolução do cofre por mês</div>${sparkSVG(pts)}</div>`:""}
 <div class="card" style="margin-top:12px">
  <div class="ws-h">Escolha seu número da sorte</div>
  <p class="hint">Um número por participante, gratuitamente. Você pode alterar sua escolha quantas vezes quiser até o encerramento do sorteio mensal — vale sempre o último número salvo.${hist.length?"":" O primeiro sorteio acontece no fim deste mês. Boa sorte!"}</p>
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px">
   <span class="tag ${my?"y":""}">${my?"Seu número atual: Nº "+my:"Nenhum número escolhido ainda"}</span>
   <input id="cf2-num" type="number" min="1" max="1000" step="1" placeholder="1 a 1000" style="max-width:140px" inputmode="numeric" value="${my||""}">
   <button class="btn" type="button" id="cf2-pick">${my?"Alterar número":"Confirmar número"} <i class=yi data-i=spark></i></button>
  </div>
 </div>
 <div class="card" style="margin-top:12px">
  <div class="ws-h">Histórico de sorteios do cofre</div>
  ${hist.length?[...hist].reverse().map(d=>{
   const w=Array.isArray(d.winners)?d.winners:[];
   return `<div class="cform-item" style="margin-top:8px"><div class="cf-head"><b>${esc(d.monthKey||"—")} · número sorteado: <span class="mono">${Math.floor(Number(d.drawnNumber)||0)}</span></b>${d.rolledOver?'<span class="tag y">Ninguém acertou · acumulou</span>':`<span class="tag g">${w.length} ganhador(es)</span>`}</div>
   <p class="hint">Cofre do mês: ${cofireFmt(Math.floor(Number(d.pot)||0))}${w.length?" · "+w.map(x=>esc(x.displayName||"?")+" levou "+cofireFmt(Math.floor(Number(x.payout)||0))).join(" · "):""}</p></div>`;
  }).join(""):'<p class="hint" style="margin:6px 0 0">O primeiro sorteio acontece no fim deste mês. Boa sorte!</p>'}
 </div>
 <div class="card" style="margin-top:12px">
  <div class="ws-h">Regras e funcionamento</div>
  <ul class="hint" style="margin:8px 0 0;padding-left:18px;line-height:1.8">
   <li>Toda taxa de publicação de tarefa de colaborador (30% do valor) entra no cofre.</li>
   <li>Cada participante tem <b>um número ativo</b> por sorteio mensal (1 a 1000).</li>
   <li>O número pode ser trocado livremente até o sorteio — vale o último salvo.</li>
   <li>No fim do mês a equipe sorteia um número: quem tiver o número sorteado leva o cofre.</li>
   <li>Se ninguém acertar, o valor <b>acumula para o mês seguinte</b>.</li>
   <li>Resultados oficiais ficam registrados aqui e no painel da administração.</li>
  </ul>
 </div>`;
 const pb=$("cf2-pick");
 if(pb)pb.onclick=async()=>{
  if(!termsOk())return askTerms();
  if(!currentUser||!currentUser.emailVerified)return toast("Entre com uma conta verificada para escolher seu número do Cofre Real.");
  if(profile?.banned)return toast("Sua conta foi suspensa pelo organizador.");
  if(!profileOk())return toast("Salve seus dados de perfil primeiro.");
  const n=Math.floor(Number($("cf2-num").value));
  if(!Number.isInteger(n)||n<1||n>1000)return toast("Escolha um número entre 1 e 1000.");
  try{
   const prev=cofireMy?Math.floor(Number(cofireMy.number)||0):0;
   await setDoc(doc(db,"cofreTickets",currentUser.uid+"_"+cofreMonthKey()),{uid:currentUser.uid,displayName:(profile?.name||"").trim()||"Participante",number:n,monthKey:cofreMonthKey(),updatedAt:serverTimestamp()},{merge:true});
   toast(prev===n?("Número "+n+" mantido! Boa sorte!"):prev?("Número alterado: "+prev+" → "+n+"! Boa sorte!"):("Número "+n+" confirmado no Cofre Real! Boa sorte!")+" <i class=yi data-i=spark></i>");
  }catch(err){showError(err)}
 };
}
const cfFull=$("cfre-full");
if(cfFull)if(cfFull)cfFull.addEventListener("click",()=>{try{openSheet("cofire")}catch(err){console.error("Cofre:",err)}});

/* ============================================================
   19e · ANÚNCIO PATROCINADO (botão flutuante + gaveta + recompensa)
   Campos do Firestore em settings/platform (editados no painel):
   · adCode ....... código HTML/CSS/JS do anúncio (gaveta em iframe)
   · adSeconds .... tempo de espera (contagem regressiva) em segundos
   · adReward ..... quantidade de reais pagos pela espera
   · adActive ..... true = botão em destaque (anúncio no ar)
   · adUpdatedAt .. data de atualização (identifica o anúncio: a
                    recompensa é paga 1x por anúncio por usuário)
   Recibo do pagamento: adsClaims/{uid}_{adId}
   ============================================================ */
let adI=0,adLeft=0,adAdId="",adClaiming=false,adOpening=false;
const adLive=()=>settings.adActive===true&&String(settings.adCode||"").trim().length>0;
const adIdOf=()=>{const t=validDate(settings.adUpdatedAt);return t?t.getTime().toString(36):"0"};
function adCfg(){return{
 code:String(settings.adCode||"").trim(),
 secs:Math.min(600,Math.max(3,Math.floor(Number(settings.adSeconds)||10))),
 reward:Math.max(0,Math.floor(Number(settings.adReward)||0))
}}
function renderAdBtn(){
 const b=$("adfloat");if(!b)return;
 const live=adLive(),cfg=adCfg();
 /* botão fica no cabeçalho, à esquerda do menu hambúrguer; aparece
    sempre que o usuário está logado; o destaque (badge dourado + ponto
    verde) liga sozinho quando o painel salva o código com adActive=true */
 b.hidden=!currentUser;
 b.classList.toggle("hot",live);
 const bg=$("ad-badge");
 if(bg){bg.hidden=!live||cfg.reward<=0;bg.textContent="+"+cfg.reward}
 if(!live&&typeof closeAdDrawer==="function")closeAdDrawer();
}
function adStopTimer(){if(adI){clearInterval(adI);adI=0}}
function closeAdDrawer(){
 adStopTimer();
 const gt=$("gaveta");if(gt)gt.classList.remove("open");
 syncGavLock();
 const f=$("gv-frame");if(f)f.srcdoc="";
}
function adAfterSlide(gv){
 return new Promise(res=>{
  let done=false;
  const end=()=>{if(done)return;done=true;gv.removeEventListener("transitionend",onEnd);res()};
  const onEnd=e=>{if(e.target===gv)end()};
  gv.addEventListener("transitionend",onEnd);
  setTimeout(end,520);
 });
}
/* monta o documento do anúncio:
   · se o anúncio pinta o próprio fundo (body/html com background),
     o tema DELE é respeitado — nada é forçado por cima;
   · se não pinta, injeta o TEMA DO SITE (fundo escuro + texto claro),
     para nunca aparecer o branco padrão do navegador */
function buildAdDoc(code){
 let html=String(code||"");
 const selfBg=/(body|html)(\[[^\]]*\])?\s*\{[^{}]*background/i.test(html);
 const fix='<meta name="viewport" content="width=device-width, initial-scale=1">';
 if(/<\/body>/i.test(html))return html.replace(/<\/body>/i,fix+"</body>");
 if(/<\/head>/i.test(html))return html.replace(/<\/head>/i,fix+"</head>");
 if(/<head[^>]*>/i.test(html))return html.replace(/<head[^>]*>/i,m=>m+fix);
 return '<!doctype html><html><head><meta charset="utf-8">'+fix+"</head><body>"+html+"</body></html>";
}
async function openAdDrawer(){
 const gt=$("gaveta"),gv=$("gav");
 if(!gt||!gv)return;
 if(adOpening||gt.classList.contains("open"))return;
 if(!currentUser?.emailVerified)return toast("Entre com uma conta verificada para ver anúncios.");
 if(!termsOk())return askTerms();
 if(!profileOk())return toast("Salve seus dados de perfil primeiro.");
 if(!adLive())return toast("Nenhum anúncio disponível agora. Volte logo!");
 const cfg=adCfg();
 if(cfg.reward<=0)return toast("Este anúncio não oferece recompensa no momento.");
 adOpening=true;
 adAdId=adIdOf();
 $("gv-brand").textContent=(String(settings.adBrand||"").trim()||"Yshippcommerce")+" · propaganda";
 $("gv-reward").textContent="para receber "+fmtBRL(cfg.reward);
 $("gv-note").textContent="Carregando o anúncio…";
 $("gv-skip").hidden=true;
 $("gv-collect").hidden=true;
 $("gv-secs").textContent="…";
 $("gv-secs").classList.remove("ok");
 const bar=$("gv-bar");bar.classList.remove("run");
 gt.classList.add("open");gv.classList.add("open");
 syncGavLock();
 await adAfterSlide(gv);
 if(!gt.classList.contains("open")){adOpening=false;return}
 let claimed=false;
 try{claimed=(await getDoc(doc(db,"adsClaims",currentUser.uid+"_"+adAdId))).exists()}catch(e){}
 if(claimed){toast("Você já recebeu a recompensa deste anúncio. Aguarde o próximo!");closeAdDrawer();adOpening=false;return}
 const f=$("gv-frame");
 f.style.background="transparent";
 f.srcdoc=buildAdDoc(cfg.code);
 $("gv-note").textContent="Mantenha o anúncio aberto até o fim da contagem para receber a recompensa.";
 $("gv-skip").hidden=false;
 adLeft=cfg.secs;
 $("gv-secs").textContent=adLeft+"s";
 void bar.offsetWidth;bar.style.animationDuration=cfg.secs+"s";bar.classList.add("run");
 adStopTimer();
 adI=setInterval(()=>{
  adLeft--;
  if(adLeft>0){$("gv-secs").textContent=adLeft+"s";return}
  adStopTimer();
  const s=$("gv-secs");s.textContent="pronto ✓";s.classList.add("ok");
  $("gv-note").textContent="Tempo completo! Toque em coletar para receber seus reais.";
  $("gv-skip").hidden=true;
  const c=$("gv-collect");c.hidden=false;c.disabled=false;c.textContent="Coletar "+fmtBRL(cfg.reward);
 },1000);
 adOpening=false;
}
async function collectAdReward(){
 if(adI||adLeft>0)return;
 if(adClaiming)return;adClaiming=true;
 const btn=$("gv-collect");btn.disabled=true;btn.textContent="Creditando…";
 const cfg=adCfg();
 const rw=boosted(cfg.reward,"adBoost");
 try{
  const claimRef=doc(db,"adsClaims",currentUser.uid+"_"+(adAdId||adIdOf()));
  await runTransaction(db,async tx=>{
   const c=await tx.get(claimRef);
   if(c.exists())throw new Error("already");
   tx.set(claimRef,{uid:currentUser.uid,adId:adAdId||adIdOf(),reward:cfg.reward,watchedAt:serverTimestamp()});
   tx.set(doc(db,"wallets",currentUser.uid),{common:increment(rw),updatedAt:serverTimestamp()},{merge:true});
   tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"ad_reward",amount:rw,ticketType:"common",reason:"Anúncio patrocinado assistido",createdAt:serverTimestamp()});
  });
  toast(fmtBRL(rw)+" do anúncio creditados na carteira!","win");
  closeAdDrawer();
  render();
 }catch(e){
  if(String(e?.message||e).includes("already")){toast("Você já recebeu a recompensa deste anúncio.");closeAdDrawer()}
  else showError(e);
 }finally{adClaiming=false}
}
$("adfloat").onclick=openAdDrawer;
$("gv-x").onclick=closeAdDrawer;
$("gv-skip").onclick=closeAdDrawer;
$("gv-collect").onclick=collectAdReward;

/* ============================================================
   19d · NOTIFICAÇÕES DO ORGANIZADOR (estilo celular: desliza p/ sair)
   Enviadas pelo painel (coleção "notifications"): target = uid ou "all".
   Ao tocar, abre uma tela igual à do suporte rodando o código salvo.
   ============================================================ */
let freshNotes=[];
const noteSeenKey=()=>"ynotes_seen_"+(currentUser?.uid||"anon");
function noteSeen(){try{return JSON.parse(localStorage.getItem(noteSeenKey())||"{}")}catch(e){return{}}}
function noteMarkSeen(id){const s=noteSeen();s[id]=1;try{localStorage.setItem(noteSeenKey(),JSON.stringify(s))}catch(e){}}
function watchNotes(){
 if(unN){unN();unN=null}
 const seen=noteSeen();
 const q=query(collection(db,"notifications"),orderBy("createdAt","desc"),limit(200));
 unN=onSnapshot(q,snap=>{
  /* orderBy simples em 1 campo: não exige índice composto (where+orderBy
     exigiria). Pega as 200 mais recentes e filtra o destinatário aqui —
     antes era where+limit(20) sem orderBy, que devolvia um subconjunto
     arbitrário e fazia notificação sumir. */
  const t=currentUser?currentUser.uid:"";
  const all=snap.docs.map(d=>({id:d.id,...d.data()})).filter(n=>n.target==="all"||(t&&n.target===t));
  all.sort((a,b)=>(stampMs(b.createdAt)||0)-(stampMs(a.createdAt)||0));
  freshNotes=all;
  const seenNow=noteSeen(),prefs=notePrefs();
  /* aviso instantâneo só das categorias com preferência ligada — as demais
     ficam guardadas na Central de Notificações */
  const shown=all.filter(n=>!seenNow[n.id]&&prefs[n.category||"system"]!==false).slice(0,3);
  renderNotes(shown);
  updateTabBadges();renderProfileNotes();
  if(sheetOpen==="notes")renderNotesCentral();
 },e=>console.error("Notificações:",e));
}
function stampMs(v){if(!v)return 0;if(typeof v==="number")return v;if(v.toDate)return v.toDate().getTime();if(typeof v.seconds==="number")return v.seconds*1000+Math.round((v.nanoseconds||0)/1e6);const d=new Date(v);return isNaN(d)?0:d.getTime()}
/* contadores do menu inferior: sorteios abertos, leilões abertos e notificações não lidas */
function updateTabBadges(){
 const bD=$("tb-draws"),bA=$("tb-aucs"),bN=$("tb-notes");
 if(bD){const n=draws.filter(d=>drawStateOf(d)==="open").length;bD.textContent=n;bD.hidden=!n}
 if(bA){const n=auctions.filter(a=>a.status==="open").length;bA.textContent=n;bA.hidden=!n}
 if(bN){const n=freshNotes.filter(x=>!noteSeen()[x.id]).length;bN.textContent=n;bN.hidden=!n}
 const bM=$("nt-menu-badge");
 if(bM){const n=freshNotes.filter(x=>!noteSeen()[x.id]).length;bM.textContent=n;bM.hidden=!n}
 renderResumo();
}
/* notificações do organizador dentro do perfil (só as do painel aparecem aqui) */
function renderProfileNotes(){
 const box=$("pf-notes");if(!box)return;
 const seen=noteSeen();
 const list=[...freshNotes].sort((a,b)=>(stampMs(b.createdAt)||0)-(stampMs(a.createdAt)||0));
 box.innerHTML=list.length?list.map(n=>{
  const un=!seen[n.id];
  return `<div class="pfn-row ${un?"un":""}" role="button" tabindex="0" data-pfn="${esc(n.id)}">
   <span class="pfn-ico" aria-hidden="true"><i class=yi data-i=megaphone></i></span>
   <div class="pfn-t"><b>${esc(n.title||"Notificação do organizador")}</b><small>${stampMs(n.createdAt)?fmt(n.createdAt):""}</small></div>
   ${un?'<span class="tag y">Nova</span>':'<span class="tag">Lida</span>'}
  </div>`;
 }).join(""):'<p class="hint" style="margin:0">Nenhuma notificação do organizador por enquanto.</p>';
}
document.addEventListener("click",e=>{
 const r=e.target.closest("[data-pfn]");
 if(r){openNote(r.dataset.pfn);renderProfileNotes();updateTabBadges()}
 const all=e.target.closest("#pf-notes-read");
 if(all){freshNotes.forEach(n=>noteMarkSeen(n.id));renderNotes([]);renderProfileNotes();updateTabBadges();toast("Todas as notificações marcadas como lidas.")}
});
function noteCard(n){
 return `<div class="pnote nt-org" data-note="${esc(n.id)}" role="button" tabindex="0" aria-label="Abrir notificação: ${esc(n.title||"")}">
  <span class="nico"><i class=yi data-i=megaphone></i></span>
  <span class="nbody"><span class="nkind">Organizador</span><b>${esc(n.title||"Notificação do organizador")}</b><small>Toque para abrir · deslize para o lado para sair</small></span>
  <button class="nclose" data-noteclose="${esc(n.id)}" aria-label="Fechar notificação">✕</button>
 </div>`;
}
function renderNotes(list){
 if(consent()?.notes===false)list=[];/* permissão de notificações recusada */
 const box=$("notes");
 /* só troca os cards do painel; os avisos do site (.tnote) ficam onde estão */
 box.querySelectorAll(".pnote:not(.tnote)").forEach(e=>e.remove());
 const d=document.createElement("div");
 d.innerHTML=(list||[]).map(noteCard).join("");
 [...d.children].forEach(c=>box.prepend(c));
}
function dismissNote(card){
 if(!card)return;
 const id=card.dataset.note;
 if(id&&!card.classList.contains("tnote"))noteMarkSeen(id);
 card.classList.add("gone");
 setTimeout(()=>{card.remove();/* reexibe as próximas não lidas */
  const seen=noteSeen();
  const next=freshNotes.filter(n=>!seen[n.id]).slice(0,3);
  renderNotes(next);
 },260);
}
function openNote(id){
 const n=freshNotes.find(x=>x.id===id);
 if(!n)return;
 $("note-title").innerHTML="<i class=yi data-i=megaphone></i> "+(n.title||"Notificação");
 $("note-frame").srcdoc=(n.code||"").trim()||"<!doctype html><html><head><meta charset='utf-8'></head><body style='font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0'><p>Nova notificação do organizador. Volte em breve!</p></body></html>";
 $("note-modal").hidden=false;
 noteMarkSeen(id);
 const card=document.querySelector(`[data-note="${CSS.escape(id)}"]`);
 if(card)dismissNote(card);
}
$("notes").addEventListener("click",e=>{
 const close=e.target.closest("[data-noteclose]");
 if(close){e.stopPropagation();dismissNote(close.closest(".pnote"));return}
 const card=e.target.closest(".pnote");
 if(card&&!card.dataset.suppress){if(card.classList.contains("tnote"))dismissNote(card);else openNote(card.dataset.note)}
});
/* deslizar para o lado (esquerda ou direita) fecha a notificação */
{
 let x0=null,moved=false;
 $("notes").addEventListener("touchstart",e=>{const c=e.target.closest(".pnote");if(!c)return;x0=e.touches[0].clientX;moved=false;c.style.transition="none"},{passive:true});
 $("notes").addEventListener("touchmove",e=>{const c=e.target.closest(".pnote");if(!c||x0==null)return;const dx=e.touches[0].clientX-x0;if(Math.abs(dx)>8)moved=true;c.style.transform="translateX("+dx+"px)"},{passive:true});
 $("notes").addEventListener("touchend",e=>{const c=e.target.closest(".pnote");if(!c||x0==null)return;const dx=e.changedTouches[0].clientX-x0;x0=null;c.style.transition="";c.style.transform="";
  if(Math.abs(dx)>56)dismissNote(c);
  else if(moved){c.dataset.suppress="1";setTimeout(()=>{delete c.dataset.suppress},60)}
 },{passive:true});
}
$("note-close").onclick=()=>{$("note-modal").hidden=true;$("note-frame").srcdoc=""};
$("note-modal").addEventListener("click",e=>{if(e.target===$("note-modal")){$("note-modal").hidden=true;$("note-frame").srcdoc=""}});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("note-modal").hidden){$("note-modal").hidden=true;$("note-frame").srcdoc=""}});

/* ============================================================
   19d+ · CENTRAL DE NOTIFICAÇÕES (tela cheia)
   Categorias, lidas/não lidas, filtros, histórico e
   preferências de avisos instantâneos por categoria.
   Desligar o aviso de uma categoria NÃO apaga a notificação:
   ela continua guardada aqui na Central.
   ============================================================ */
const NOTE_CATS={
 system:{label:"Sistema",icon:"gear"},
 finance:{label:"Financeiro",icon:"coins"},
 tasks:{label:"Tarefas",icon:"checkc"},
 collab:{label:"Colaboradores",icon:"handshake"},
 draws:{label:"Sorteios",icon:"ticket"},
 auctions:{label:"Leilões",icon:"scale"},
 events:{label:"Eventos",icon:"calendar"},
 challenges:{label:"Desafios",icon:"target"},
 community:{label:"Comunidade",icon:"users"},
 security:{label:"Segurança",icon:"shield"},
 ads:{label:"Anúncios",icon:"megaphone"}
};
const noteCatOf=n=>NOTE_CATS[n?.category]||NOTE_CATS.system;
const notePrefsKey=()=>"ynote_prefs_"+(currentUser?.uid||"anon");
function notePrefs(){try{return JSON.parse(localStorage.getItem(notePrefsKey())||"{}")}catch(e){return{}}}
function noteSetPref(cat,val){const p=notePrefs();p[cat]=val===false?false:true;try{localStorage.setItem(notePrefsKey(),JSON.stringify(p))}catch(e){}}
let ntFilter="all";
function renderNotesCentral(){
 const box=$("nt-body");if(!box)return;
 const seen=noteSeen(),prefs=notePrefs();
 const list=[...freshNotes].sort((a,b)=>(stampMs(b.createdAt)||0)-(stampMs(a.createdAt)||0));
 const catsIn=[...new Set(list.map(n=>n.category||"system"))];
 const unread=list.filter(n=>!seen[n.id]).length;
 const chips=['<button class="tag '+(ntFilter==="all"?"y":"")+'" type="button" data-ntf="all">Todas'+(unread?" · "+unread:"")+"</button>"]
  .concat(catsIn.map(c=>{
   const un=list.filter(n=>(n.category||"system")===c&&!seen[n.id]).length;
   return '<button class="tag '+(ntFilter===c?"y":"")+'" type="button" data-ntf="'+esc(c)+'">'+esc(NOTE_CATS[c].label)+(un?" · "+un:"")+"</button>";
  })).join("");
 const shown=ntFilter==="all"?list:list.filter(n=>(n.category||"system")===ntFilter);
 box.innerHTML=
  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">'+chips+"</div>"+
  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">'+
  '<span class="hint">'+(unread?unread+" não lida(s)":"Tudo em dia <i class=yi data-i=checkc></i>")+"</span>"+
  '<button class="btn sm ghost" type="button" data-nt-readall>Marcar todas como lidas</button>'+
  "</div>"+
  '<div style="display:grid;gap:8px">'+
  (shown.length?shown.map(n=>{
   const un=!seen[n.id],cat=noteCatOf(n);
   return '<div class="trow" role="button" tabindex="0" data-ntn="'+esc(n.id)+'" style="'+(un?"border-color:var(--ac);background:var(--as)":"")+'">'+
    '<span class="tn" style="display:flex;gap:8px;align-items:center;flex:1 1 auto"><i class=yi data-i='+cat.icon+"></i> "+esc(n.title||"Notificação")+"</span>"+
    '<span class="hint mono" style="font-size:11px">'+(stampMs(n.createdAt)?fmt(n.createdAt):"")+"</span>"+
    (un?'<span class="tag y">Nova</span>':'<span class="tag">Lida</span>')+
    "</div>";
  }).join(""):'<p class="hint">Nenhuma notificação nesta categoria.</p>')+
  "</div>"+
  '<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--l)">'+
  '<p class="hint" style="margin:0 0 10px"><i class=yi data-i=bulb></i> <b>Avisos instantâneos:</b> desligue uma categoria para não receber os avisos na tela. As notificações continuam guardadas aqui na Central.</p>'+
  '<div style="display:grid;gap:6px">'+
  Object.entries(NOTE_CATS).map(([k,c])=>{
   const on=prefs[k]!==false;
   return '<button class="trow" type="button" data-ntp="'+k+'" style="cursor:pointer">'+
    '<span class="tn" style="display:flex;gap:8px;align-items:center"><i class=yi data-i='+c.icon+"></i> "+esc(c.label)+"</span>"+
    '<span class="tag '+(on?"g":"")+'">'+(on?"Ligado":"Desligado")+"</span></button>";
  }).join("")+
  "</div></div>";
}
document.addEventListener("click",e=>{
 const f=e.target.closest("[data-ntf]");
 if(f){ntFilter=f.dataset.ntf;renderNotesCentral();return}
 if(e.target.closest("[data-nt-readall]")){freshNotes.forEach(n=>noteMarkSeen(n.id));renderNotes([]);renderProfileNotes();renderNotesCentral();updateTabBadges();toast("Todas as notificações marcadas como lidas.");return}
 const o=e.target.closest("[data-ntn]");
 if(o){
  const n=freshNotes.find(x=>x.id===o.dataset.ntn);
  if(!n)return;
  noteMarkSeen(n.id);
  if(n.link){closeSheet();if(!openHashLink(n.link))openNote(n.id)}
  else openNote(n.id);
  renderNotesCentral();updateTabBadges();return;
 }
 const p=e.target.closest("[data-ntp]");
 if(p){const k=p.dataset.ntp;noteSetPref(k,notePrefs()[k]===false);renderNotesCentral();return}
});

/* ============================================================
   19f · CENTRAL DE FEEDBACK
   Coleção "feedback". O administrador escolhe no painel quais
   seções têm o botão de feedback (settings/platform.feedback).
   ============================================================ */
const FB_SECTIONS={
 geral:{label:"Site em geral",icon:"spark"},
 sorteios:{label:"Sorteios",icon:"ticket"},
 leiloes:{label:"Leilões",icon:"scale"},
 eventos:{label:"Eventos",icon:"calendar"},
 ofertas:{label:"Tarefas / Ofertas",icon:"checkc"},
 "ofertas-colab":{label:"Ofertas dos colaboradores",icon:"handshake"},
 resultado:{label:"Resultado oficial",icon:"trophy"},
 anuncios:{label:"Central de Anúncios",icon:"megaphone"},
 "pesquisas-main":{label:"Pesquisas",icon:"flask"},
 "market-main":{label:"Yshipp Market",icon:"cart"},
 "carteira-main":{label:"YshippWallet",icon:"safe"},
 cofre:{label:"Cofre",icon:"coins"},
 comunidade:{label:"Comunidade",icon:"users"},
 suporte:{label:"Suporte",icon:"headset"}
};
const fbCfg=()=>settings?.feedback&&typeof settings.feedback==="object"?settings.feedback:{};
const fbSectionOn=id=>fbCfg().enabled!==false&&(fbCfg().sections||{})[id]!==false;
let fbPreset="geral";
/* denúncia de perfil: contexto anexado ao próximo feedback enviado */
let fbExtra=null;
function fbFillSections(){
 const sel=$("fb-section");if(!sel)return;
 sel.innerHTML=Object.entries(FB_SECTIONS).map(([id,c])=>'<option value="'+id+'">'+esc(c.label)+"</option>").join("");
 sel.value=FB_SECTIONS[fbPreset]?fbPreset:"geral";
}
function renderFbButtons(){
 /* botões discretos de feedback dentro das seções configuradas no painel */
 Object.keys(FB_SECTIONS).forEach(id=>{
  if(id==="geral")return;
  const sec=$(id);
  if(!sec)return;
  const old=sec.querySelector("[data-fb]");
  if(old)old.remove();
  if(!fbSectionOn(id))return;
  const b=document.createElement("button");
  b.type="button";
  b.className="btn sm ghost";
  b.setAttribute("data-fb",id);
  b.style.cssText="margin-top:10px;font-size:11.5px;opacity:.85";
  b.innerHTML='<i class=yi data-i=chat></i> Dar feedback sobre esta seção';
  try{if(Date.now()-Number(localStorage.getItem("ycxTksPay")||0)>6048e5)b.innerHTML+='<span class="fb-coin">+R$ 0,01</span>'}catch(e){}
  sec.querySelector(".wrap")?.appendChild(b)||sec.appendChild(b);
 });
}
document.addEventListener("click",e=>{
 const f=e.target.closest("[data-fb],[data-fb-open]");
 if(f){
  fbPreset=f.dataset.fb||f.dataset.fbOpen||"geral";openSheet("feedback");
  (async()=>{try{
   const last=Number(localStorage.getItem("ycxTksPay")||0);
   if(Date.now()-last<6048e5)return;
   if(!currentUser||!currentUser.emailVerified)return;
   localStorage.setItem("ycxTksPay",String(Date.now()));
   const wRef=doc(db,"wallets",currentUser.uid);
   await runTransaction(db,async tx=>{
    const wd=await tx.get(wRef);const w=wd.exists()?wd.data():{};
    tx.set(wRef,{...w,brl:(Number(w.brl)||0)+0.01,updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"feedback_reward",amount:0.01,reason:"Recompensa semanal por feedback de seção <i class=yi data-i=chat></i>",createdAt:serverTimestamp()});
   });
   toast("+R$ 0,01 creditado na sua carteira pelo feedback. <i class=yi data-i=coins></i>");
  }catch(e){}})();
  return}
});
$("fb-form")?.addEventListener("submit",async e=>{
 e.preventDefault();
 const msg=$("fb-msg").value.trim();
 if(msg.length<10){try{$("fb-status").hidden=false;$("fb-status").textContent="Escreva um pouco mais (mínimo 10 caracteres)."}catch(x){}return toast("Escreva um pouco mais sobre o que você quer relatar (mínimo 10 caracteres).")}
 if(!currentUser)return toast("Entre na sua conta para enviar feedback.");
 const st=$("fb-status");
 if(st){st.hidden=false;st.textContent="Enviando…"}
 try{
  await addDoc(collection(db,"feedback"),{
   uid:currentUser.uid||"",
   name:(profile?.name||"").trim()||"Participante",
   email:currentUser.email||"",
   section:$("fb-section").value||"geral",
   sectionLabel:FB_SECTIONS[$("fb-section").value]?.label||"Site em geral",
   type:$("fb-type").value||"avaliacao",
   rating:Math.max(0,Math.min(5,Math.floor(Number($("fb-rating").value)||0))),
   message:msg.slice(0,2000),
   report:fbExtra||null,
   status:"new",
   createdAt:serverTimestamp()
  });
  /* denúncia de perfil: também vira um caso na aba Disputas do painel,
     com o motivo escrito no feedback — a equipe audita por lá */
  if(fbExtra&&fbExtra.type==="profile_report"){
   try{
    await addDoc(collection(db,"disputes"),{
     type:"profile_report",
     taskId:"—",
     taskName:"Denúncia de perfil público",
     claimId:"",
     collabId:"",
     ownerUid:fbExtra.targetUid||"",
     ownerName:fbExtra.targetName||"",
     uid:currentUser.uid||"",
     participantName:(profile?.name||"").trim()||"Participante",
     email:currentUser.email||"",
     reason:("[Denúncia de perfil] "+msg).slice(0,800),
     claimStatus:"",
     status:"open",
     createdAt:serverTimestamp()
    });
   }catch(e2){console.error("Denúncia de perfil:",e2)}
  }
  fbExtra="";
  $("fb-msg").value="";
  if(st){st.hidden=false;st.textContent="Feedback enviado! Obrigado por ajudar o Yshippcommerce a melhorar."}
  toast("Feedback enviado! A equipe vai analisar. <i class=yi data-i=thumbsup></i>");
 }catch(err){
  if(st){st.hidden=false;st.textContent="Não foi possível enviar agora. Tente de novo em instantes."}
  toast("Não foi possível enviar o feedback agora.");
 }
});

/* ============================================================
   19h · BLOCOS DA TELA INICIAL (configuráveis pelo painel)
   settings/platform.homeBlocks = {enabled, blocks:[{id,show,title,desc,format,count}]}
   O painel escolhe: quais resumos aparecem, ordem, títulos e
   descrições próprios, formato (carrossel ou empilhado) e
   quantidade de itens por resumo. Novos resumos entram no
   registro e ficam disponíveis automaticamente no painel.
   ============================================================ */
const HOME_BLOCKS_DEFAULT=["eventos","ofertas","ofertas-colab","sorteios","leiloes","resultado","anuncios","pesquisas-main","market-main","carteira-main","cofire"];
function applyHomeBlocks(){
 const cfg=settings?.homeBlocks;
 if(!cfg||cfg.enabled===false)return;
 const blocks=Array.isArray(cfg.blocks)?cfg.blocks:[];
 if(!blocks.length)return;
 const wrapOf=id=>document.querySelector('section[id="'+id+'"]')?.closest(".wrap");
 const anchorWrap=blocks.map(b=>b&&b.id&&wrapOf(b.id)).find(Boolean);
 if(!anchorWrap)return;
 const parent=anchorWrap.parentNode;
 blocks.forEach(b=>{
  if(!b||!b.id)return;
  const w=wrapOf(b.id);if(!w)return;
  const sec=w.querySelector('section[id="'+b.id+'"]');
  w.hidden=b.show===false;
  if(!sec)return;
  if(b.format==="stack")sec.classList.add("stacked");else sec.classList.remove("stacked");
  if(b.title){const h=sec.querySelector(".sec-head h2");if(h){const ic=h.querySelector("svg,.yi");h.innerHTML=(ic?ic.outerHTML+" ":"")+esc(b.title)}}
  if(b.desc){const p=sec.querySelector(".sec-head p");if(p)p.innerHTML=b.desc}
  parent.insertBefore(w,anchorWrap);
 });
 /* limite de itens por resumo (via CSS: não interfere nos renders) */
 let st=$("home-blocks-css");
 if(!st){st=document.createElement("style");st.id="home-blocks-css";document.head.appendChild(st)}
 st.textContent=blocks.filter(b=>b&&b.id&&Number(b.count)>0).map(b=>
  'section[id="'+b.id+'"] .evs>*:nth-child(n+'+(Math.floor(b.count)+1)+'),section[id="'+b.id+'"] .tks>*:nth-child(n+'+(Math.floor(b.count)+1)+'),section[id="'+b.id+'"] .how>*:nth-child(n+'+(Math.floor(b.count)+1)+'){display:none!important}'
 ).join("");
}
/* ============================================================
   19g · PERFIL PÚBLICO DOS MEMBROS
   Só informações públicas: nome, entrada, estatísticas e selos.
   Nada de e-mail, PIX, endereço, carteira ou dados financeiros.
   ============================================================ */
async function openUserProfile(uid){
 if(!uid)return;
 /* CORREÇÃO: garante que o perfil abra NA FRENTE de qualquer gaveta/área de
    trabalho aberta — sobe o z-index, força visibilidade e recoloca o painel
    como último filho do body (topo absoluto da pilha de empilhamento). */
 openSheet("user");
 try{
  const us=$("user-sheet");
  if(us){
   us.style.zIndex="400";
   us.hidden=false;
   us.style.visibility="visible";
   us.style.pointerEvents="auto";
   if(us.parentNode&&us.parentNode!==document.body||us!==document.body.lastElementChild)document.body.appendChild(us);
  }
 }catch(e){}
 const b=$("up-body");if(!b)return;
 if($("up-title"))$("up-title").innerHTML='<i class=yi data-i=user></i> Perfil público';
 b.innerHTML='<p class="hint">Carregando perfil…</p>';
 /* dados públicos derivados do que o site já carrega */
 const nm=resvAll.find(x=>x.uid===uid)?.displayName||bidsArr.find(x=>x.uid===uid)?.displayName||tasks.find(t=>t.ownerUid===uid)?.ownerName||"";
 const isCollab=tasks.some(t=>t.source==="collab"&&t.ownerUid===uid);
 const stats=[
  ["Participações em sorteios",resvAll.filter(x=>x.uid===uid).length,"ticket"],
  ["Lances em leilões",bidsArr.filter(x=>x.uid===uid).length,"scale"],
  ["Leilões ganhos",auctions.filter(a=>a.result?.winnerUid===uid).length,"trophy"],
  ["Ofertas publicadas",tasks.filter(t=>t.source==="collab"&&t.ownerUid===uid).length,"handshake"]
 ];
 let name=nm,memberSince=null,avatar="";
 try{
  const us=await getDoc(doc(db,"users",uid));
  if(us.exists()){const d=us.data();if(d.name)name=d.name;memberSince=d.createdAt||null;if(d.banned)name=nm||"Membro";avatar=d.avatar||d.photoChar||""}
 }catch(e){/* regras podem restringir a leitura: segue só com dados públicos */}
 const badges=[];
 if(stats[3][1]>0)badges.push('<span class="tag y"><i class=yi data-i=handshake></i> Colaborador</span>');
 if(stats[2][1]>0)badges.push('<span class="tag g"><i class=yi data-i=trophy></i> Ganhador de leilão</span>');
 const ini=(name||"?").trim().charAt(0).toUpperCase();
 /* ── histórico público do colaborador: ofertas dele que o site já carrega ── */
 const collabTasks=tasks.filter(t=>t.source==="collab"&&t.ownerUid===uid)
  .sort((a,b)=>(stampMs(b.updatedAt||b.createdAt)||0)-(stampMs(a.updatedAt||a.createdAt)||0));
 const activeOf=collabTasks.filter(t=>offerState(t)==="on");
 const collabHist=collabTasks.length?`
 <div class="card" style="margin-top:14px;padding:14px;display:grid;gap:10px">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
   <b style="font-size:14px"><i class=yi data-i=handshake></i> Histórico público do colaborador</b>
   <span class="tag y">${collabTasks.length} oferta(s) · ${activeOf.length} ativa(s) agora</span>
  </div>
  <p class="hint" style="margin:0">Ofertas enviadas por este colaborador, revisadas pela equipe antes de entrar no ar. O preço exibido é o que cada participante recebe ao concluir a tarefa.</p>
  <div style="display:grid;gap:8px">
   ${collabTasks.slice(0,6).map(t=>{
    const st=offerState(t);
    const tag=st==="on"?'<span class="tag g">Ativa agora</span>':st==="future"?'<span class="tag y">Em breve</span>':'<span class="tag">Encerrada / pausada</span>';
    const rc=t.rewardCur||"brl",rd=Math.max(0.01,Math.round((Number(t.reward)||0)*100)/100);
    return `<div class="trow"><span class="tn"><i class=yi data-i=checkc></i> ${esc(plainTxt(t.serviceLabel||t.name||t.id))}${t.id?` <button type="button" class="tid" data-copy="${esc(t.id)}" title="Toque para copiar o ID">${esc(t.id)}</button>`:""}</span>${tag}<b class="mono" style="color:var(--g);white-space:nowrap">+${xcRewardTxt(rc,rd)}</b></div>`;
   }).join("")}
   ${collabTasks.length>6?`<p class="hint" style="margin:0">E mais ${collabTasks.length-6} oferta(s) no histórico — veja todas na seção <b>Tarefas de colaboradores</b>.</p>`:""}
  </div>
 </div>`:"";
 const reportBtn=(currentUser&&uid!==currentUser.uid&&currentUser.emailVerified)
  ?`<button class="btn sm ghost" type="button" data-up-report="${esc(uid)}" data-up-name="${esc(name||"Membro")}" style="color:var(--rd)"><i class=yi data-i=flag></i> Denunciar este perfil</button>`
  :"";
 b.innerHTML=`
 <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
  <span class="ava" style="width:56px;height:56px;font-size:22px">${esc(ini||"?")}</span>
  <div style="min-width:0">
   <b style="font-size:18px;overflow-wrap:anywhere">${esc(name||"Membro do Yshippcommerce")}</b>
   <div class="hint mono" style="font-size:11px">ID pública: ${esc(uid.slice(0,8))}…</div>
   <div class="hint">${memberSince?"Membro desde "+fmt(memberSince):"Participante do Yshippcommerce"}</div>
  </div>
 </div>
 <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:14px">
  ${stats.map(([l,v,ic])=>`<div class="card" style="padding:12px"><div class="tk-nlab" style="display:block"><i class=yi data-i=${ic}></i> ${esc(l)}</div><b class="mono" style="font-size:18px">${v}</b></div>`).join("")}
 </div>
 <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">${badges.join("")||'<span class="tag">Sem selos públicos ainda</span>'}</div>
 ${collabHist}
 ${currentUser&&uid!==currentUser.uid?`<div style="margin-top:12px;display:grid;gap:8px">
  ${myBlocked().includes(uid)
   ?`<button class="btn sm ghost" type="button" data-up-unblock="${esc(uid)}"><i class=yi data-i=unlock></i> Desbloquear — voltar a ver as tarefas dele</button>`
   :`<button class="btn sm ghost" type="button" data-up-block="${esc(uid)}"><i class=yi data-i=ban></i> Bloquear tarefas deste colaborador</button>
   <p class="hint" style="margin:0;font-size:11.5px">Você deixa de ver as tarefas publicadas por ele. Ninguém é avisado e você pode desfazer quando quiser.</p>`}
  ${reportBtn}
  <p class="hint" style="margin:0;font-size:11.5px"><i class=yi data-i=flag></i> Denuncie apenas suspeitas reais: oferta enganosa, link quebrado de propósito, cobrança indevida ou má-fé na avaliação. A equipe audita com o histórico e pode pausar as ofertas do colaborador.</p>
 </div>`:""}
 <p class="hint" style="margin-top:14px"><i class=yi data-i=shield></i> Este perfil mostra apenas informações públicas. Dados pessoais, carteira e informações financeiras nunca aparecem aqui.</p>`;
}
document.addEventListener("click",async e=>{
 const bl=e.target.closest("[data-up-block]");
 if(bl){
  const uid=bl.dataset.upBlock;
  try{
   await updateDoc(doc(db,"users",currentUser.uid),{blockedUids:arrayUnion(uid),updatedAt:serverTimestamp()});
   /* bloqueio simétrico nas provas: suas provas PENDENTES nas tarefas desse
      colaborador são marcadas com blockedOwner — saem da fila da Central do
      colaborador e passam a ser avaliadas somente pela equipe (painel) */
   try{
    const ownerTaskIds=new Set(tasks.filter(t=>t.source==="collab"&&t.ownerUid===uid).map(t=>t.id));
    if(ownerTaskIds.size){
     const qs=await getDocs(query(collection(db,"taskClaims"),where("uid","==",currentUser.uid)));
     await Promise.all(qs.docs
      .filter(d=>ownerTaskIds.has(d.data().taskId)&&(d.data().status||"pending")!=="approved"&&d.data().blockedOwner!==true)
      .map(d=>updateDoc(doc(db,"taskClaims",d.id),{blockedOwner:true,blockedAt:serverTimestamp()})));
    }
   }catch(be){console.warn("Marcação de provas (bloqueio):",be)}
   toast("Colaborador bloqueado — as tarefas dele não aparecem mais para você e suas provas pendentes passam para a avaliação da equipe.");
   openUserProfile(uid);
  }catch(err){showError(err)}
  return;
 }
 const ub=e.target.closest("[data-up-unblock]");
 if(ub){
  const uid=ub.dataset.upUnblock;
  try{
   await updateDoc(doc(db,"users",currentUser.uid),{blockedUids:arrayRemove(uid),updatedAt:serverTimestamp()});
   toast("Colaborador desbloqueado — as tarefas dele voltam a aparecer.");
   openUserProfile(uid);
  }catch(err){showError(err)}
  return;
 }
 const u=e.target.closest("[data-up]");
 if(u){e.stopPropagation();openUserProfile(u.dataset.up)}
 /* denúncia de perfil: pré-preenche o feedback com o alvo e abre a Central de Feedback */
 const rp=e.target.closest("[data-up-report]");
 if(rp){
  e.stopPropagation();
  if(!currentUser||!currentUser.emailVerified)return toast("Entre com uma conta verificada para denunciar.");
  const targetUid=rp.dataset.upReport,targetName=rp.dataset.upName||"Membro";
  fbExtra={type:"profile_report",targetUid,targetName,reporterUid:currentUser.uid,reporterName:(profile?.name||"").trim(),page:"perfil-publico"};
  fbPreset="ofertas-colab";
  try{
   const m=$("fb-msg");
   if(m&&!m.value.trim())m.value="Denúncia contra "+targetName+" (perfil público): ";
  }catch(x){}
  openSheet("feedback");
  toast("Descreva o motivo da denúncia e envie — a equipe vai auditar. <i class=yi data-i=flag></i>");
 }
});

/* ============================================================
   19e · CAPAS DO SITE (carrossel de imagens configurado no painel)
   O painel escolhe a posição e quantas imagens cada capa tem.
   Sem capa cadastrada, o site age como se nada existisse ali.
   ============================================================ */
const CV_POS={hero:"cvp-hero",sorteios:"cvp-sorteios",premios:"cvp-premios",leiloes:"cvp-leiloes",rodape:"cvp-rodape"};
function cvShow(cv,i){
 const slides=cv.querySelectorAll(".cv-slide").length;
 if(!slides)return;
 i=((i%slides)+slides)%slides;
 cv.dataset.i=String(i);
 cv.querySelector(".cv-track").style.transform="translateX(-"+(i*100)+"%)";
 cv.querySelectorAll(".cv-dots i").forEach((d,k)=>d.classList.toggle("on",k===i));
}
function cvBind(){
 document.querySelectorAll(".cv").forEach(cv=>{
  if(cv.dataset.bound)return;
  cv.dataset.bound="1";
  const cur=()=>Number(cv.dataset.i)||0;
  const n=cv.querySelectorAll(".cv-slide").length;
  cv.querySelectorAll("[data-cvstep]").forEach(b=>b.onclick=e=>{e.stopPropagation();cvShow(cv,cur()+Number(b.dataset.cvstep))});
  cv.querySelectorAll("[data-cvi]").forEach(d=>d.onclick=e=>{e.stopPropagation();cvShow(cv,Number(d.dataset.cvi))});
  if(n>1)cv._t=setInterval(()=>cvShow(cv,cur()+1),5000);
  let x0=null;
  cv.addEventListener("touchstart",e=>{x0=e.touches[0].clientX;clearInterval(cv._t)},{passive:true});
  cv.addEventListener("touchend",e=>{
   if(x0!=null){
    const dx=e.changedTouches[0].clientX-x0;
    if(Math.abs(dx)>40)cvShow(cv,cur()-(dx>0?1:-1));
    x0=null;
    cv._t=setInterval(()=>cvShow(cv,cur()+1),5000);
   }
  },{passive:true});
 });
}
function renderCovers(){
 const groups={};
 covers.filter(c=>c.active!==false).forEach(c=>{
  /* "eventos" era a antiga seção Eventos da home (removida): capas antigas
     nessa posição caem para o rodapé em vez de desaparecerem */
  let pos=CV_POS[c.position]?c.position:"rodape";
  if(c.position==="eventos")pos="rodape";
  (groups[pos]=groups[pos]||[]).push(...c.images.filter(Boolean));
 });
 for(const[pos,id]of Object.entries(CV_POS)){
  const el=$(id);
  if(!el)continue;
  const imgs=groups[pos]||[];
  el.innerHTML="";
  el.hidden=!imgs.length;
  if(!imgs.length)continue;
  el.innerHTML=`<div class="cv" data-i="0"><div class="cv-track">${imgs.map(s=>`<div class="cv-slide"><img src="${esc(s)}" alt="Capa do site" loading="lazy" decoding="async"></div>`).join("")}</div>${imgs.length>1?`<button class="cv-b p" data-cvstep="-1" aria-label="Capa anterior">‹</button><button class="cv-b n" data-cvstep="1" aria-label="Próxima capa">›</button><div class="cv-dots">${imgs.map((_,k)=>`<i data-cvi="${k}" class="${k===0?"on":""}"></i>`).join("")}</div>`:""}</div>`;
 }
 cvBind();
}

/* ============================================================
   19b · CARTEIRA FLUTUANTE (botão inferior direito, estilo Binance)
   ============================================================ */function updateWfloat(){
 const b=$("wfloat");if(!b)return;
 const on=!!currentUser?.emailVerified,pts=pointsOf(wallet);
 b.hidden=!on;
 $("wbadge").textContent=pts;
 const tb=$("tb-wbadge");if(tb){tb.textContent=pts>9999?Math.floor(pts/1000)+"k":pts;tb.hidden=!on}
 if(sheetOpen==="wallet")buildWallet();
}
$("wfloat").onclick=e=>{e.stopPropagation();openSheet("wallet")};

/* ============================================================
   19b · PAINÉIS (menu completo, carteira e perfil)
   No celular abrem de baixo para cima; no computador, pela lateral.
   ============================================================ */
const SHEETS={menu:"menu-sheet",wallet:"wallet-sheet",profile:"profile-sheet",notes:"notes-sheet",feedback:"feedback-sheet",cofire:"cofire-sheet",user:"user-sheet"};
function closeSheet(){
 Object.values(SHEETS).forEach(id=>{const el=$(id);if(el)el.hidden=true});
 sheetOpen="";document.body.classList.remove("no-scroll");
 $("menu").setAttribute("aria-expanded","false");
 tbSync();
}
function openSheet(name){
 if(!name||!SHEETS[name])return closeSheet();
 /* abas internas (perfil/carteira) fecham a gaveta Minha conta primeiro */
 try{if(cgIsOpen)closeCg()}catch(e){}
 if((name==="wallet"||name==="profile")&&!currentUser?.emailVerified){
  closeSheet();goStage(true);
  toast(currentUser?"Confirme seu e-mail para acessar "+(name==="wallet"?"a carteira":"o seu perfil")+".":"Entre na sua conta para acessar "+(name==="wallet"?"a carteira":"o seu perfil")+".","info");
  return;
 }
 Object.entries(SHEETS).forEach(([k,id])=>{const el=$(id);if(el)el.hidden=k!==name});
 sheetOpen=name;document.body.classList.add("no-scroll");
 $("menu").setAttribute("aria-expanded",String(name==="menu"));
 if(name==="wallet")buildWallet();
 if(name==="notes")renderNotesCentral();
 if(name==="cofire"){try{renderCofireSheet()}catch(err){console.error("Cofre:",err);const cb=$("cf2-body");if(cb)cb.innerHTML='<p class="hint">Não foi possível montar o Cofre agora. Feche e abra de novo.</p>'}}
 if(name==="feedback"){fbFillSections();const st=$("fb-status");if(st){st.hidden=true}}
 if(name==="profile"){pfDirty=false;buildProfileHead();fillProfileForm(true);renderLinks();renderProfileNotes()}
 const panel=$(SHEETS[name]).querySelector(".sheet-b");if(panel)panel.scrollTop=0;
 setTimeout(()=>$(SHEETS[name]).querySelector("[data-close].ib")?.focus({preventScroll:true}),60);
 tbSync();
}
document.addEventListener("click",e=>{
 if(e.target.closest("#cfre-full")){e.preventDefault();try{openSheet("cofire")}catch(err){console.error("Cofre:",err)}return}
 const o=e.target.closest("[data-open]");
 if(o){e.preventDefault();openSheet(o.dataset.open);return}
 if(e.target.closest("[data-close]")){closeSheet();return}
 const a=e.target.closest('.sheet a[href^="#"]');
 if(a&&sheetOpen)closeSheet();
 if(e.target.closest("[data-tbtop]"))scrollTo({top:0,behavior:reduceMotion?"auto":"smooth"});
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&sheetOpen)closeSheet()});

/* barra inferior: destaca a área visível */
function tbSync(){
 const bar=$("tabbar");if(!bar)return;
 let cur="";const mid=innerHeight*.42;
 for(const id of ["sorteios","leiloes"]){const r=$(id)?.getBoundingClientRect();if(r&&r.top<mid&&r.bottom>mid)cur=id}
 if(sheetOpen==="wallet"||sheetOpen==="profile")cur=sheetOpen;
 if($("walgaveta").classList.contains("open"))cur="wallet";
 bar.querySelectorAll("[data-tb]").forEach(x=>x.classList.toggle("on",x.dataset.tb===cur));
}
{let tbT=0;addEventListener("scroll",()=>{if(tbT)return;tbT=requestAnimationFrame(()=>{tbT=0;tbSync()})},{passive:true})}

/* ============================================================
   19g · CARROSSÉIS ALINHADOS (um card por vez + paginação)
   ============================================================ */
function slide(el,dir){
 if(!el)return;
 const c=el.firstElementChild;
 const step=c?c.getBoundingClientRect().width+12:el.clientWidth;
 el.scrollBy({left:dir*step,behavior:reduceMotion?"auto":"smooth"});
}
function pagerOf(id){
 const el=$(id);if(!el)return null;
 let pg=el.nextElementSibling;
 if(!pg||!pg.classList.contains("pager")){
  pg=document.createElement("div");pg.className="pager";pg.dataset.for=id;
  pg.innerHTML='<div class="dots"></div><span class="mono pg-n"></span>';
  el.insertAdjacentElement("afterend",pg);
  el.addEventListener("scroll",()=>updatePager(id),{passive:true});
  pg.addEventListener("click",e=>{const b=e.target.closest("[data-pgi]");if(!b)return;const c=el.firstElementChild;const step=c?c.getBoundingClientRect().width+12:el.clientWidth;el.scrollTo({left:Number(b.dataset.pgi)*step,behavior:reduceMotion?"auto":"smooth"})});
 }
 return pg;
}
function updatePager(id){
 const el=$(id),pg=pagerOf(id);if(!el||!pg)return;
 const kids=[...el.children].filter(k=>!k.classList.contains("pager"));
 const c=kids[0],w=c?c.getBoundingClientRect().width+12:1;
 const per=Math.max(1,Math.round(el.clientWidth/w)||1);
 const pages=Math.max(1,kids.length-per+1);
 const hide=el.hidden||kids.length<=per;
 pg.hidden=hide;if(hide)return;
 const i=Math.min(pages-1,Math.round(el.scrollLeft/w));
 const dots=pg.firstElementChild;
 if(dots.children.length!==pages)dots.innerHTML=Array.from({length:pages},(_,k)=>`<button type="button" data-pgi="${k}" aria-label="Ir para ${k+1}"></button>`).join("");
 [...dots.children].forEach((d,k)=>d.classList.toggle("on",k===i));
 dots.hidden=pages>12;
 pg.lastElementChild.textContent=(i+1)+"/"+pages;
}
function updatePagers(){["how","sdraws","evs","offs","aucs"].forEach(updatePager)}
addEventListener("resize",updatePagers);

/* ============================================================
   DESLIZE ESTILO NETFLIX · motor único para todos os carrosséis
   Arraste com o mouse (ou caneta) e solte: o deslize continua com
   inércia e encaixa suavemente no início do card mais próximo,
   igual à Netflix. No toque, o deslize nativo do celular é mantido
   (já tem inércia) e o encaixe fica mais suave (proximity).
   Aplica-se a: listas de cards (.evs), como funciona (.how),
   bilhetes (.tks), carteira (.wal-fcar), pesquisas (.pes-strip)
   e faixas de KPIs das centrais.
   ============================================================ */
const NX_SEL=".evs,.how,.tks,.wal-fcar,.pes-strip,#adc-stats,#clv-stats,#mn-stats,#fj-stats,#evt-stats";
function nxStep(el){
 /* largura de passo = card + vão (usada no encaixe) */
 const c=el.firstElementChild;
 return c?c.getBoundingClientRect().width+(parseFloat(getComputedStyle(el).gap)||12):el.clientWidth;
}
function nxSnap(el){
 const kids=[...el.children].filter(k=>k.nodeType===1);
 if(!kids.length)return;
 const step=nxStep(el);
 if(step<=0)return;
 const target=Math.max(0,Math.round(el.scrollLeft/step)*step);
 el.scrollTo({left:Math.min(target,el.scrollWidth-el.clientWidth),behavior:reduceMotion?"auto":"smooth"});
}
function nxBind(el){
 let down=false,drag=false,sx=0,sl=0,lx=0,lt=0,v=0,raf=0;
 el.addEventListener("pointerdown",e=>{
  if(e.pointerType==="touch")return;                 /* toque: rolagem nativa */
  if(e.button!==0)return;
  down=true;drag=false;sx=e.clientX;sl=el.scrollLeft;lx=e.clientX;lt=performance.now();v=0;
  cancelAnimationFrame(raf);
 });
 el.addEventListener("pointermove",e=>{
  if(!down)return;
  const dx=e.clientX-sx;
  if(!drag&&Math.abs(dx)>6){
   drag=true;el.classList.add("nx-drag");
   try{el.setPointerCapture(e.pointerId)}catch(x){}
  }
  if(!drag)return;
  el.scrollLeft=sl-dx;
  const now=performance.now(),dt=Math.max(1,now-lt);
  v=(e.clientX-lx)/dt;lx=e.clientX;lt=now;
 });
 const end=()=>{
  if(!down)return;down=false;
  el.classList.remove("nx-drag");
  if(!drag)return;
  let vel=-v*16;                                     /* px por quadro ao soltar */
  const step=()=>{
   if(Math.abs(vel)<1.2){nxSnap(el);return}
   el.scrollLeft+=vel;vel*=0.94;
   raf=requestAnimationFrame(step);
  };
  raf=requestAnimationFrame(step);
 };
 el.addEventListener("pointerup",end);
 el.addEventListener("pointercancel",end);
 /* se arrastou, o clique não abre o card por baixo */
 el.addEventListener("click",e=>{
  if(!drag)return;
  drag=false;e.stopPropagation();e.preventDefault();
 },true);
}
let nxT=0;
function nxEnhance(){
 if(nxT)return;
 nxT=requestAnimationFrame(()=>{
  nxT=0;
  document.querySelectorAll(NX_SEL).forEach(el=>{
   if(el.dataset.nx)return;
   el.dataset.nx="1";el.classList.add("nx");nxBind(el);
  });
 });
}
nxEnhance();
new MutationObserver(nxEnhance).observe(document.documentElement,{childList:true,subtree:true});

/* ============================================================
   19h · CARTEIRA INTELIGENTE (visão de ativos estilo corretora)
   ============================================================ */
let wlFilter="all",wlHide=false;
try{wlHide=localStorage.getItem("wlhide")==="1"}catch(e){}
const HICON={check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.5 5 5 10-11"/></svg>',gift:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5.5 12v7a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-7M3.5 8l2-3.5h13l2 3.5M12 8v12M8.5 4.5c-1.5 0-2.5 1-2.5 2.2 0 1.3 1.3 2 2.8 1.3zM15.5 4.5c1.5 0 2.5 1 2.5 2.2 0 1.3-1.3 2-2.8 1.3z"/></svg>',cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h3"/></svg>',ticket:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 0 2-2h12a2 2 0 0 1 2 2v1a2.5 2.5 0 0 0 0 5v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2.5 2.5 0 0 0 0-5z"/><path d="M14.5 7v9.5" stroke-dasharray="2.5 3"/></svg>',undo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h11a5 5 0 0 1 0 10H9"/><path d="m8 5-4 4 4 4"/></svg>',gavel:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6a3.5 3.5 0 0 1 5 5l-2 2-5-5zM8.5 10.5 3 16v5h5l5.5-5.5zM14 20h7M4 3l3 3"/></svg>',star:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8z"/></svg>',bolt:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4.5 13.5H11L9.5 22 18 10.5h-6.5z"/></svg>',cash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M2.5 10h19" opacity=".45"/><circle cx="12" cy="13.5" r="2.6"/><path d="M6.5 9.5h.01M17.5 17.5h.01"/></svg>',swap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13l-3.5-3.5M20 17H7l3.5 3.5"/></svg>',flask:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3h4M9 3v5l-5 9a2.4 2.4 0 0 0 2 3.5h12a2.4 2.4 0 0 0 2-3.5l-5-9V3M7.5 14h9"/></svg>',cart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.5 11h11L21 8H6"/></svg>',mega:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.2v4.6l11.4 4.6V5.6L3 10.2z"/><path d="M16.8 9a4 4 0 0 1 0 6M19.6 6.4a8 8 0 0 1 0 11.2"/></svg>',pick:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.5v5l3.4 2"/></svg>'};
const HKIND={reward:["Tarefa aprovada",HICON.check],welcome:["Bônus de boas-vindas",HICON.gift],event_join:["Entrada no evento",HICON.cal],reserve:["Reserva de número",HICON.ticket],refund:["Devolução do sorteio",HICON.undo],auction_bid:["Lance no leilão",HICON.gavel],auction_refund:["Devolução de leilão",HICON.undo],admin_credit:["Crédito do organizador",HICON.star],ad_reward:["Recompensa do anúncio",HICON.bolt],collab_fee:["Taxa de publicação (colaborador)",HICON.ticket],collab_refund:["Devolução da taxa (colaborador)",HICON.undo],cofre_reward:["Prêmio do Cofre Real <i class=yi data-i=trophy></i>",HICON.star],survey_purchase:["Pesquisa publicada",HICON.flask],survey_reward:["Recompensa da pesquisa",HICON.check],withdraw_request:["Saque PIX solicitado",HICON.cash],withdraw_refund:["Saque recusado — valor devolvido",HICON.undo],market_buy:["Compra no Market",HICON.cart],market_purchase:["Recarga no Market",HICON.cart],ad_purchase:["Anúncio publicado",HICON.mega],convert_t2b:["Conversão: bilhetes → reais (legado)",HICON.swap],convert_b2t:["Conversão: reais → bilhetes (legado)",HICON.swap],convert_t2t:["Conversão entre tipos (legado)",HICON.swap],convert_b2c:["Compra de criptomoeda",HICON.swap],convert_c2b:["Venda de criptomoeda",HICON.swap],mining_collect:["Mineração coletada",HICON.bolt],affiliate:["Indicação de amigo",HICON.star],welcome_ref:["Bônus de indicação",HICON.star],checkin:["Check-in diário da Central de Eventos",HICON.gift],challenge_reward:["Recompensa do desafio <i class=yi data-i=trophy></i>",HICON.trophy],room_reward:["Recompensa da comunidade",HICON.star],vip_dist:["Distribuição do caixa VIP",HICON.star],ad_refund:["Estorno de anúncio",HICON.undo],survey_refund:["Pesquisa recusada — valor devolvido",HICON.undo]};
/* movimentos em REAIS: exibem "R$ ..." em vez de "−0 bilhetes" */
const HBRL=/withdraw_request|withdraw_refund|market_buy|market_purchase|convert_t2b|convert_b2t|convert_b2c|convert_c2b|recarga|xc_buy/;
const hPlus=k=>/reward|welcome|refund|credit|affiliate|mining_collect|convert_b2t|convert_c2b|vip_dist|checkin|app_install/.test(k||"");
function sparkSVG(pts){
 if(pts.length<2)return"";
 const mn=Math.min(...pts),mx=Math.max(...pts),W=300,H=60,r=mx-mn||1;
 const xy=pts.map((v,i)=>[(i/(pts.length-1))*W,H-5-((v-mn)/r)*(H-12)]);
 const d=xy.map((q,i)=>(i?"L":"M")+q[0].toFixed(1)+" "+q[1].toFixed(1)).join("");
 const up=pts[pts.length-1]>=pts[0],col=up?"#0ecb81":"#f6465d";
 return `<svg class="wl-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="wlg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".32"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><path d="${d}L${W} ${H}L0 ${H}Z" fill="url(#wlg)"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
function buildWallet(){
 const b=$("wl-body");if(!b)return;
 const n=k=>Math.max(0,Math.floor(Number(wallet?.[k])||0));
 const nf=v=>Number(v).toLocaleString("pt-BR");
 const mask=v=>wlHide?"••••":fmtBRL(v);
 const tot=pointsOf(wallet);
 const assets=[{k:"brl",name:"Reais (R$)",color:"#f0b90b",qty:tot,unit:1,val:tot}];
 const H=history.map(h=>({...h,amt:Math.round(Math.abs(Number(h.amount)||0)*100)/100*(VAL[h.ticketType]||1),plus:hPlus(h.kind),at:stampMs(h.createdAt)}));
 const sum=f=>H.filter(f).reduce((s,h)=>s+h.amt,0);
 const earned=sum(h=>h.plus),spent=sum(h=>!h.plus);
 const inDraws=sum(h=>h.kind==="reserve"),inAuc=Math.max(0,sum(h=>h.kind==="auction_bid")-sum(h=>h.kind==="auction_refund")),inEv=sum(h=>h.kind==="event_join");
 const wk=Date.now()-7*864e5,net7=H.filter(h=>h.at>=wk).reduce((s,h)=>s+(h.plus?h.amt:-h.amt),0);
 let bal=tot;const pts=[tot];for(const h of H){bal-=h.plus?h.amt:-h.amt;pts.push(Math.max(0,bal))}pts.reverse();
 const uid=currentUser?.uid;
 const myBids=bidsArr.filter(x=>uid&&x.uid===uid);
 const activeBids=myBids.filter(x=>auctions.some(a=>a.id===x.auctionId&&a.status==="open")).reduce((s,x)=>s+Math.max(0,Math.floor(Number(x.amount)||0)),0);
 const cl=Object.values(claims).filter(Boolean),tOk=cl.filter(c=>c.status==="approved").length,tPend=cl.filter(c=>c.status==="pending").length;
 const tkSt=myTickets.map(t=>ticketStatus(t).state),nAct=tkSt.filter(x=>x==="active").length,nWon=tkSt.filter(x=>x==="won").length;
 const canBuy=Math.floor(tot/COST);
 const list=H.filter(h=>wlFilter==="all"||(wlFilter==="in"?h.plus:!h.plus));
 b.innerHTML=`<div class="wl-hero">
   <div class="wl-top"><span class="label">Saldo estimado</span><button type="button" class="wl-eye" id="wl-eye" aria-pressed="${wlHide}"><span class="icn" aria-hidden="true">${wlHide?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="m4 4 16 16"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'}</span>${wlHide?"Mostrar":"Ocultar"}</button></div>
   <div class="wl-bal">${wlHide?"••••":fmtBRL(tot)}</div>
   <div class="wl-sub"><span class="${net7>=0?"up":"down"} mono">${net7>=0?"▲ +":"▼ "}${wlHide?"••":mask(net7)} · 7 dias</span><span>≈ ${wlHide?"••":nf(canBuy)} número(s) no sorteio atual</span></div>
   ${sparkSVG(pts)}
   <div class="wl-acts">
    <button type="button" class="wl-act" data-wl="tasks"><span>${HICON.bolt}</span>Ganhar</button>
    <button type="button" class="wl-act" data-wl="pick"><span>${HICON.ticket}</span>Sortear</button>
    <button type="button" class="wl-act" data-wl="auc"><span>${HICON.gavel}</span>Leilões</button>
    <button type="button" class="wl-act" data-wl="tickets"><span>${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 0 2-2h12a2 2 0 0 1 2 2v1a2.5 2.5 0 0 0 0 5v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2.5 2.5 0 0 0 0-5z"/><path d="M14.5 7v9.5" stroke-dasharray="2.5 3"/></svg>'}</span>Carteira</button>
   </div>
  </div>
  <div class="wl-sec"><div class="wl-sh"><b>Saldo</b><span class="hint" style="font-size:11.5px">moeda única em reais (R$)</span></div>
   <div class="wl-alloc">${tot?'<i style="width:100%;background:#f0b90b" title="Reais (R$)"></i>':""}</div>
   <div class="wl-list"><div class="wl-asset"><span class="wl-ai" style="--c:#f0b90b">R</span><div><b>Reais (R$)</b><small>saldo único · saque via PIX na carteira completa</small></div><div class="r"><b class="mono">${mask(tot)}</b><small>100%</small></div></div></div>
  </div>
  <div class="wl-sec"><div class="wl-sh"><b>Desempenho</b><span class="hint" style="font-size:11.5px">últimos ${H.length} movimento(s)</span></div>
   <div class="wl-stats">
    <div class="wl-st"><small>Ganhos</small><b class="up">+${mask(earned)}</b><span>tarefas, bônus e devoluções</span></div>
    <div class="wl-st"><small>Gastos</small><b class="down">−${mask(spent)}</b><span>números, lances e entradas</span></div>
    <div class="wl-st"><small>Em sorteios</small><b>${mask(inDraws)}</b><span>${myTickets.length} número(s) · ${nAct} ativo(s)${nWon?" · "+nWon+" <i class=yi data-i=trophy></i>":""}</span></div>
    <div class="wl-st"><small>Em leilões</small><b>${mask(inAuc)}</b><span>${mask(activeBids)} em lances ativos</span></div>
    <div class="wl-st"><small>Eventos</small><b>${mask(inEv)}</b><span>${myJoins.size} entrada(s) confirmada(s)</span></div>
    <div class="wl-st"><small>Tarefas</small><b>${tOk}</b><span>aprovada(s)${tPend?" · "+tPend+" em análise":""}</span></div>
   </div>
  </div>
  <div class="wl-sec"><div class="wl-sh"><b>Histórico</b><div class="chips">${[["all","Todos"],["in","Entradas"],["out","Saídas"]].map(([k,l])=>`<button type="button" class="chip2 ${wlFilter===k?"on":""}" data-wlf="${k}">${l}</button>`).join("")}</div></div>
   <div class="wl-list">${list.length?list.map(h=>{const K=HKIND[h.kind]||[h.kind||"Movimento",HICON.star];const isXc=Number(h.xcQty)>0&&h.kind!=="xc_convert"&&h.kind!=="xc_buy";const isBrl=!isXc&&HBRL.test(h.kind||"")&&Number(h.brl)>0;const xcName=h.xcKind==="coin"?"moeda(s)":h.xcKind==="ticket"?"bilhete(s)":h.xcKind==="diamond"?"diamante(s)":"";const amtTxt=wlHide?"••••":isXc?(h.plus?"+":"−")+Math.floor(Number(h.xcQty)||0).toLocaleString("pt-BR")+" "+xcName:isBrl?(h.plus?"+":"−")+fmtBRL(h.brl):(h.plus?"+":"−")+mask(h.amt);const sub=[h.taskName||h.eventName||h.drawName||h.auctionName||h.reason||"",h.ticketType&&!isBrl&&!isXc?typeName(h.ticketType):""].filter(Boolean).join(" · ");return `<div class="wl-h"><span class="wl-hi ${h.plus?"plus":""}">${K[1]}</span><div><b>${esc(K[0])}</b><small>${esc(sub||"—")}</small></div><div class="r"><b class="mono ${h.plus?"up":"down"}">${amtTxt}</b><small>${h.at?fmtS(new Date(h.at)):"—"}</small></div></div>`}).join(""):`<div class="wl-empty">${H.length?"Nenhum movimento neste filtro.":"Sem movimentos ainda. Faça tarefas para ganhar seus primeiros reais."}</div>`}</div>
  </div>
  <p class="hint" style="font-size:11px;margin:0;text-align:center">Moeda única: reais (R$) · saque via PIX na carteira completa.</p>`;
}
$("wl-body").addEventListener("click",e=>{
 const nav=e.target.closest("[data-fcar]");
 if(nav){const c=$("wal-fcar");if(!c)return;const step=c.clientWidth*.7;c.scrollBy({left:nav.dataset.fcar==="prev"?-step:step,behavior:"smooth"});return}
 if(e.target.closest("#wl-eye")){wlHide=!wlHide;try{localStorage.setItem("wlhide",wlHide?"1":"0")}catch(x){}buildWallet();return}
 const f=e.target.closest("[data-wlf]");if(f){wlFilter=f.dataset.wlf;buildWallet();return}
 const a=e.target.closest("[data-wl]")?.dataset.wl;if(!a)return;
 closeSheet();
 if(a==="tasks"||a==="pick")goStage(true);
 if(a==="auc")openLg();
 if(a==="tickets"){walTab="visao";walOpen();return}
});

/* ============================================================
   19i · TELA DE PERFIL (ver e editar dados)
   ============================================================ */
let pfDirty=false;
["gender","uf","country"].forEach(k=>{$("pf-"+k).innerHTML=$(k).innerHTML});
$("pf-form").addEventListener("input",()=>{pfDirty=true});
function pfFields(){
 const a=profile?.address||{};
 return [["Nome",profile?.name&&profile.name.trim().length>=3],["Nascimento",profile?.birthDate],["Gênero",profile?.gender],["WhatsApp",profile?.whatsapp],["Pix",profile?.pixKey],["Rua",a.street],["Número",a.housenum],["Estado",a.state],["País",a.country]];
}
/* ---- FOTO DO PERFIL: personagens do próprio site ----
     O participante escolhe um personagem navegando com as setas ‹ ›
     (as opções não ficam expostas em uma lista). A escolha é salva no
     perfil e aparece em TODOS os círculos de identificação: conta,
     menu, perfil, números e no histórico de participações — inclusive
     para os outros usuários. Os desenhos são emojis do próprio
     navegador: nada é baixado da internet (economia de dados). */
const CHARACTERS=[
 ["raposa","","#f59e0b"],["tigre","","#f97316"],["leao","","#eab308"],
 ["panda","","#22c55e"],["urso","","#a16207"],["lobo","","#64748b"],
 ["gato","","#8b5cf6"],["coelho","","#f472b6"],["polvo","","#06b6d4"],
 ["robo","","#3b82f6"],["fantasma","","#71717a"],["unicornio","","#ec4899"],
 ["dragao","","#10b981"],["alien","","#84cc16"],["palhaco","","#ef4444"],
 ["macaco","","#d97706"]
];
function charOf(mode){const k=(mode||"").replace(/^ch:/,"");return CHARACTERS.find(c=>c[0]===k)||null}
function avatarInitial(){return (profile?.name||currentUser?.email||"U").trim().charAt(0).toUpperCase()}
/* HTML do círculo de identificação: monograma profissional com a cor do personagem */
function avatarHTML(mode,ini){const c=charOf(mode);const l=esc((ini||"U").toString().charAt(0).toUpperCase());return c?'<span class="chv mono" style="background:linear-gradient(145deg,'+c[2]+'40,'+c[2]+'1a);color:'+c[2]+';font-weight:600">'+l+'</span>':l}
function myPhoto(){return profile?.photoMode||""}
/* mapa uid → foto: alimenta a identificação nos históricos públicos
   (var: precisa existir antes da hidratação do cache, mais acima) */
var uidPhoto={};
function mapPhotos(list){(list||[]).forEach(r=>{if(r?.uid&&r.photo)uidPhoto[r.uid]=r.photo})}
function whoHTML(rec,ini){
 /* o próprio usuário vê SEMPRE o personagem atual do perfil (foto ao vivo);
   os outros veem a foto anexada no registro (ou a mais recente do mapa) */
 const me=rec&&rec.uid&&currentUser&&rec.uid===currentUser.uid;
 const p=me?myPhoto():((rec&&rec.photo)||(rec&&rec.uid&&uidPhoto[rec.uid])||"");
 return '<span class="pava" aria-hidden="true">'+avatarHTML(p,ini||"?")+'</span>';
}
function paintAvatars(){
 const h=avatarHTML(profile?.photoMode,avatarInitial());
 const a=$("ava");if(a)a.innerHTML=h;
 const p=$("pf-ava");if(p)p.innerHTML=h;
 const m=document.querySelector("#m-acct .ava");if(m)m.innerHTML=h;
}
async function setPhotoMode(mode){
 if(!currentUser?.emailVerified)return toast("Verifique seu e-mail primeiro.");
 try{
  await updateDoc(doc(db,"users",currentUser.uid),{photoMode:mode,photoConsent:false,updatedAt:serverTimestamp()});
  profile={...(profile||{}),photoMode:mode};
  /* trocou o personagem? o mapa público e todos os círculos atualizam na hora */
  if(currentUser)uidPhoto[currentUser.uid]=mode;
  const c=charOf(mode);
  toast(c?"Personagem "+c[0]+" ativado ✓":"Foto alterada ✓");
  paintAvatars();buildProfileHead();render();
 }catch(e){showError(e)}
}
/* trocar personagem: setas ‹ › (uma opção por vez, sem lista exposta) */
function cyclePhoto(dir){
 if(!currentUser?.emailVerified)return toast("Verifique seu e-mail primeiro.");
 const cur=charOf(profile?.photoMode);const i=cur?CHARACTERS.indexOf(cur):-1;
 const n=CHARACTERS[((i<0?0:i+dir)+CHARACTERS.length)%CHARACTERS.length];
 setPhotoMode("ch:"+n[0]);
}
$("pf-head").addEventListener("click",e=>{
 const c=e.target.closest("[data-chchar]");if(c)return cyclePhoto(Number(c.dataset.chchar)||1);
 if(e.target.closest("#pf-ava"))return cyclePhoto(1);
});
$("pf-head").addEventListener("keydown",e=>{
 if((e.key==="Enter"||e.key===" ")&&e.target.id==="pf-ava"){e.preventDefault();cyclePhoto(1)}
});
function buildProfileHead(){
 const el=$("pf-head");if(!el||!currentUser)return;
 const name=profile?.name||"",ini=(name||currentUser.email||"U").trim().charAt(0).toUpperCase();
 const F=pfFields(),okN=F.filter(f=>f[1]).length,pct=Math.round(okN/F.length*100),miss=F.filter(f=>!f[1]).map(f=>f[0]);
 const since=validDate(profile?.createdAt);
 const tOk=Object.values(claims).filter(c=>c?.status==="approved").length;
 el.innerHTML=`<div class="pf-card">
  <div class="pf-top"><span class="pf-ava" id="pf-ava" role="button" tabindex="0" title="Toque para trocar o personagem">${avatarHTML(profile?.photoMode,ini)}</span><div><b>${esc(name||"Complete seu nome")}${vipMe?.vip?' <span class="tag y" style="vertical-align:2px">★ VIP</span>':""}</b><small>${esc(currentUser.email||"")}</small><span class="tag ${currentUser.emailVerified?"g":"y"}" style="margin-top:6px">${currentUser.emailVerified?"E-mail verificado ✓":"Verificação pendente"}</span><div class="pf-id">ID ${esc(currentUser.uid.slice(0,8))}${since?" · desde "+since.toLocaleDateString("pt-BR"):""}</div></div></div>
  <div class="pf-photo">
   <span class="pf-st">Personagem do perfil</span>
   <div class="pf-char">
    <button type="button" class="btn ghost sm" data-chchar="-1" aria-label="Personagem anterior">‹</button>
    <span class="pf-char-cur">${avatarHTML(profile?.photoMode,ini)}</span>
    <button type="button" class="btn ghost sm" data-chchar="1" aria-label="Próximo personagem">›</button>
   </div>
   <small id="pf-ava-msg">Use as setas ‹ › para escolher seu personagem. Ele aparece em todos os círculos do seu perfil, nos seus números e no histórico de participações — para você e para os outros usuários.</small>
  </div>
  <div class="tk-cut" aria-hidden="true"></div>
  <div class="pf-stats"><div><b class="mono">${fmtBRL(pointsOf(wallet))}</b><small>Saldo (R$)</small></div><div><b class="mono">${myTickets.length}</b><small>Números</small></div><div><b class="mono">${tOk}</b><small>Tarefas</small></div><div><b class="mono">${myJoins.size}</b><small>Eventos</small></div></div>
  <div class="pf-comp"><div class="ev-row"><span>Perfil completo</span><b class="mono">${pct}%</b></div><div class="track"><div class="fill" style="width:${pct}%;background:${pct===100?"var(--g)":"var(--ac)"}"></div></div>${miss.length?`<span>Falta: ${esc(miss.join(", "))}.</span>`:"<span>Tudo pronto para receber prêmios. ✓</span>"}</div>
 </div>`;
 $("pf-pw").hidden=!(profileOk()&&currentUser.providerData?.some(p=>p.providerId==="password"));
 $("pf-theme-v").textContent=root.dataset.theme==="dark"?"Escuro":"Claro";
}
function fillProfileForm(force){
 if(!profile||(pfDirty&&!force))return;
 const set=(id,v)=>{const el=$("pf-"+id);if(el&&(force||document.activeElement!==el))el.value=v??""};
 const a=profile.address||{};
 set("fbname",profile.name||"");set("birth",profile.birthDate||"");set("gender",profile.gender||"");
 set("whatsapp",profile.whatsapp||"");set("pix",profile.pixKey||"");
 set("street",a.street||"");set("housenum",a.housenum||"");set("compl",a.complement||"");
 set("uf",a.state||"");set("country",a.country||"Brasil");
 if(force)$("pf-reauth").value="";
}
$("pf-save").onclick=async()=>{
 const b=$("pf-save");if(b.disabled)return;
 b.disabled=true;b.textContent="Salvando…";
 const ok=await saveProfileFrom("pf-",profileOk());
 b.disabled=false;b.textContent="Salvar alterações";
 if(ok){pfDirty=false;toast("Perfil atualizado com sucesso.","success");buildProfileHead()}
};
$("pf-showpw").onclick=()=>{const p=$("pf-reauth"),sh=p.type==="password";p.type=sh?"text":"password";$("pf-showpw").textContent=sh?"Ocultar":"Mostrar"};
$("pf-forgot").onclick=()=>$("forgot-in-profile").click();
/* (o botão de tema do cabeçalho foi removido; a troca fica no perfil) */
$("pf-sup").onclick=()=>{closeSheet();openSupport()};
$("pf-logout").onclick=()=>{closeSheet();signOut(auth).catch(showError)};


/* permite avisos de scripts externos: yToast("texto","success|error|warn|info|win") */
window.yToast=toast;
/* ============================================================
   19f · TERMOS DE USO, RESPONSABILIDADES E PERMISSÕES
   Barra inferior de largura total. A escolha fica salva no aparelho
   (localStorage "ycons_v1") e fica disponível em window.yConsent
   (ex.: window.yConsent.ads para anúncios personalizados).
   Sem aceitar os termos, a pessoa navega, mas não entra nem participa.
   ============================================================ */
function consent(){try{return JSON.parse(localStorage.getItem("ycons_v1")||"null")}catch(e){return null}}
function termsOk(){return !!consent()?.terms}
function saveConsent(o){
 const c={terms:!!o.terms,notes:!!o.notes,ads:!!o.ads,stats:!!o.stats,at:new Date().toISOString()};
 try{localStorage.setItem("ycons_v1",JSON.stringify(c))}catch(e){}
 window.yConsent=c;
 document.dispatchEvent(new CustomEvent("yconsent",{detail:c}));
 return c;
}
function csLayout(){
 const el=$("consent"),on=!el.hidden;
 document.body.classList.toggle("cs-open",on);
 if(on)root.style.setProperty("--csh",el.offsetHeight+"px");
}
function csPane(id,on){
 const p=$(id);p.hidden=on===undefined?!p.hidden:!on;
 (id==="cs-perms"?$("cs-manage"):$("cs-terms-open")).setAttribute("aria-expanded",String(!p.hidden));
 csLayout();
}
function showConsent(open){
 const c=consent();
 $("cs-notes").checked=c?c.notes!==false:true;
 $("cs-ads").checked=!!c?.ads;
 $("cs-stats").checked=!!c?.stats;
 $("cs-terms-ok").checked=!!c?.terms;
 $("cs-msg").textContent="";
 $("consent").hidden=false;
 if(open)csPane(open==="perms"?"cs-perms":"cs-terms",true);
 csLayout();
}
function hideConsent(){$("consent").hidden=true;csPane("cs-perms",false);csPane("cs-terms",false);csLayout()}
/* fechar o consentimento: botão ✕ ou clique fora da barra */
(function(){
 const addX=()=>{
  const row=document.querySelector("#consent .cs-act");
  if(!row||document.getElementById("cs-x"))return;
  const b=document.createElement("button");
  b.className="ib sm";b.id="cs-x";b.type="button";b.setAttribute("aria-label","Fechar");
  b.textContent="✕";row.appendChild(b);
 };
 try{addX()}catch(e){}
 document.addEventListener("click",e=>{
  const c=$("consent");if(!c||c.hidden)return;
  if(e.target.closest("#cs-x")){hideConsent();return}
  /* não feche quando o clique veio de um botão que ABRE o consentimento */
  if(e.target.closest("[data-terms],[data-consent],#cs-reopen"))return;
  if(!e.target.closest("#consent"))hideConsent();
 });
})();
function askTerms(){toast("Para continuar, aceite os termos de uso e responsabilidades.");showConsent("terms");return false}
$("cs-manage").onclick=()=>csPane("cs-perms");
$("cs-terms-open").onclick=()=>csPane("cs-terms");
$("cs-yes").onclick=()=>{saveConsent({terms:true,notes:true,ads:true,stats:true});hideConsent();watchNotes();toast("Termos aceitos. Você pode mudar as permissões no rodapé quando quiser.")};
$("cs-no").onclick=()=>{saveConsent({terms:false,notes:false,ads:false,stats:false});hideConsent();watchNotes();toast("Sem aceitar os termos você pode navegar, mas não entrar nem participar. Mude isso no rodapé.")};
$("cs-save").onclick=()=>{
 const c=saveConsent({terms:$("cs-terms-ok").checked,notes:$("cs-notes").checked,ads:$("cs-ads").checked,stats:$("cs-stats").checked});
 hideConsent();watchNotes();
 toast(c.terms?"Preferências salvas.":"Preferências salvas. Para entrar e participar, aceite os termos de uso.");
};
$("cs-reopen").onclick=()=>showConsent("perms");
document.addEventListener("click",e=>{if(e.target.closest("[data-terms]")){e.preventDefault();showConsent("terms")}});
/* "gerencie suas permissões": abre o painel de permissões do consentimento */
document.addEventListener("click",e=>{if(e.target.closest("[data-consent]")){e.preventDefault();showConsent("perms")}});
addEventListener("resize",()=>{if(!$("consent").hidden)csLayout()});
window.yConsent=consent();
if(!termsOk())setTimeout(()=>showConsent(),600);

/* ============================================================
   20 · FAQ EM CARROSSEL (um carrossel por seção/categoria)
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */
/* ============================================================
   20 · FAQ — o bloco de perguntas da home foi removido da
   interface: as perguntas e respostas agora vivem só na
   Central de Ajuda (botão de suporte), que lê em tempo real
   os dados ocultos de #faq-dyn / #faq-static.
   ============================================================ */

/* ============================================================
   20 · CONFIRMAÇÃO PROFISSIONAL (nada de alertas nativos do navegador)
   ============================================================ */
function askConfirm(msg,title,onOk,okLabel){
 const m=$("cf-modal");if(!m)return;
 $("cf-title").textContent=title||"Confirmar ação";
 $("cf-msg").textContent=msg;
 $("cf-ok").textContent=okLabel||"Confirmar";
 $("cf-cancel").textContent="Cancelar";
 m.hidden=false;
 $("cf-ok").onclick=()=>{m.hidden=true;try{onOk&&onOk()}catch(e){showError(e)}};
 const close=()=>{m.hidden=true};
 $("cf-cancel").onclick=close;
 $("cf-x").onclick=close;
 m.onclick=e=>{if(e.target===m)close()};
}

/* ============================================================
   21 · GAVETA DE LOGIN EM TELA CHEIA (etapa 1 de 2 · deslogado)
   ============================================================ */
let lgMode="login",lgNote="";
function renderLg(){
 const r=lgMode==="reset",reg=lgMode==="register";
 [...$("lg-tabs").children].forEach(b=>b.classList.toggle("on",b.dataset.m===lgMode));
 $("lg-tabs").hidden=r;$("lg-pw-f").hidden=r;$("lg-or").hidden=r;
 $("lg-go").textContent=r?"Enviar link de redefinição":reg?"Criar conta":"Entrar";
 $("lg-forgot").textContent=r?"Voltar para o login":"Esqueci minha senha";
 $("lg-forgot").hidden=reg;
 $("lg-pw").autocomplete=reg?"new-password":"current-password";
 const tw=$("lg-terms-wrap");
 if(tw)tw.hidden=r;
 $("lg-msg").textContent=lgNote||(reg?"Use pelo menos "+MIN_PW+" caracteres. Enviaremos um link para verificar seu e-mail.":"");
}
/* caixa de aceitação dos termos: obrigatória para entrar/criar conta */
function lgTermsOk(){
 const cb=$("lg-terms-ok"),wrap=$("lg-terms-wrap");
 if(!cb||!wrap||wrap.hidden)return true;
 const row=cb.closest(".lg-terms");
 if(cb.checked){row.classList.remove("on");return true}
 row.classList.add("on");
 lgNote="☑ Marque a caixa aceitando os termos de uso e responsabilidades para continuar.";
 renderLg();
 row.classList.add("on");
 try{toast("Marque a caixa aceitando os termos de uso e responsabilidades para continuar.")}catch(e){}
 try{cb.focus()}catch(e){}
 return false;
}
function openLoginGaveta(mode){
 lgMode=mode||"login";lgNote="";
 renderLg();
 $("login-gaveta").classList.add("open");
 $("login-gav").classList.add("open");
 syncGavLock();
 setTimeout(()=>{try{$("lg-email").focus()}catch(e){}},400);
}
function closeLoginGaveta(){
 $("login-gav").classList.remove("open");
 setTimeout(()=>{
  if(!$("login-gav").classList.contains("open")){
   $("login-gaveta").classList.remove("open");
   syncGavLock();
  }
 },400);
}
$("ld-login").onclick=()=>openLoginGaveta("login");
$("ld-register").onclick=()=>openLoginGaveta("register");
$("cta-login").onclick=()=>openLoginGaveta("login");
$("cta-register").onclick=()=>openLoginGaveta("register");
$("lg-x").onclick=closeLoginGaveta;
$("lg-tabs").onclick=e=>{const m=e.target.dataset.m;if(m){lgMode=m;lgNote="";renderLg()}};
$("lg-forgot").onclick=()=>{lgMode=lgMode==="reset"?"login":"reset";lgNote="";renderLg()};
$("lg-showpw").onclick=()=>{const p=$("lg-pw"),s=p.type==="password";p.type=s?"text":"password";$("lg-showpw").textContent=s?"Ocultar":"Mostrar"};
$("lg-go").onclick=async()=>{
 const email=$("lg-email").value.trim(),pw=$("lg-pw").value;
 if(lgMode!=="reset"&&!termsOk())return askTerms();
 if(lgMode!=="reset"&&!lgTermsOk())return;
 const b=$("lg-go");if(b.disabled)return;
 try{
  if(lgMode==="reset"){
   if(!email)return toast("Digite seu e-mail para receber o link.");
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return toast("Informe um e-mail válido, ex.: seuemail@exemplo.com.");
   b.disabled=true;b.textContent="Enviando…";
   await sendPasswordResetEmail(auth,email,{url:location.href,handleCodeInApp:false});
   lgNote="✓ Se existir uma conta para "+email+", enviamos o link de redefinição. Confira a caixa de entrada e o spam. O link vale por 1 hora.";
   toast("Link de redefinição enviado para "+email+".");
   renderLg();
  }else if(lgMode==="register"){
   if(!email||pw.length<MIN_PW)return toast("Informe e-mail e senha com pelo menos "+MIN_PW+" caracteres.");
   b.disabled=true;b.textContent="Criando…";
   const c=await createUserWithEmailAndPassword(auth,email,pw);
   await sendEmailVerification(c.user);
   toast("Conta criada. Enviamos o link de verificação.");
  }else{
   if(!email)return toast("Digite seu e-mail.");
   b.disabled=true;b.textContent="Entrando…";
   await signInWithEmailAndPassword(auth,email,pw);
  }
 }catch(e){showError(e)}
 finally{b.disabled=false;renderLg()}
};
["lg-email","lg-pw"].forEach(id=>$(id).addEventListener("keydown",e=>{if(e.key==="Enter")$("lg-go").click()}));

/* ============================================================
   22 · LOGIN SOCIAL (Google, Facebook, TikTok) e conexões da conta
   ============================================================ */
function tikTokNotice(){
 toast("A entrada com TikTok está sendo liberada pelo organizador. Use Google, Facebook ou e-mail e senha por enquanto.","info");
}
const fbProvider=()=>new FacebookAuthProvider();
async function socialSignIn(make){
 if(!termsOk())return askTerms();
 try{await signInWithPopup(auth,make())}catch(e){showError(e)}
}
$("facebook").onclick=()=>socialSignIn(fbProvider);
$("tiktok").onclick=tikTokNotice;
$("lg-google").onclick=()=>{if(!lgTermsOk())return;socialSignIn(()=>new GoogleAuthProvider())};
$("lg-facebook").onclick=()=>{if(!lgTermsOk())return;socialSignIn(fbProvider)};
$("lg-tiktok").onclick=()=>{if(!lgTermsOk())return;tikTokNotice()};
$("lg-terms-ok")?.addEventListener("change",()=>{const cb=$("lg-terms-ok");if(cb.checked)cb.closest(".lg-terms").classList.remove("on")});
$("lg-inapp").hidden=!inApp;

/* conectar outras formas de entrar (usuário já logado por e-mail/senha) */
const LOGO_G='<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.5-5.2l-6.2-5.3C29.4 35.1 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.3C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';
const LOGO_F='<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="#1877f2"/><path fill="#fff" d="M34.1 24.1h-6.2V38h-6.4V24.1H17v-5.5h4.5v-3.3c0-4.3 2.6-7.3 7.3-7.3h5.3v5.6h-3.2c-1.6 0-2.5.9-2.5 2.4v2.6h6.2z"/></svg>';
const LOGO_T='<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#010101"/><text x="21" y="32" text-anchor="middle" font-size="26" fill="#25F4EE" font-family="Arial,sans-serif"><i class=yi data-i=music></i></text><text x="27" y="32" text-anchor="middle" font-size="26" fill="#FE2C55" font-family="Arial,sans-serif"><i class=yi data-i=music></i></text><text x="24" y="32" text-anchor="middle" font-size="26" fill="#fff" font-family="Arial,sans-serif"><i class=yi data-i=music></i></text></svg>';
const PROVIDERS=[
 {id:"google.com",n:"Google",d:"Entrar com um toque pela sua conta Google — sem digitar senha.",cls:"lk-g",logo:LOGO_G,make:()=>new GoogleAuthProvider()},
 {id:"facebook.com",n:"Facebook",d:"Use sua conta do Facebook como chave de entrada.",cls:"lk-f",logo:LOGO_F,make:fbProvider},
 {id:"tiktok.com",n:"TikTok",d:"Conexão em preparação — o organizador está liberando com a TikTok.",cls:"lk-t",logo:LOGO_T,make:null}
];
function renderLinks(){
 if(!currentUser)return;
 const pd=currentUser.providerData||[];
 const linked=new Set(pd.map(p=>p.providerId));
 const html=PROVIDERS.map(p=>{
  const on=linked.has(p.id);
  const info=pd.find(x=>x.providerId===p.id);
  const detail=on
   ?"Conectado"+(info?.email?" · "+info.email:"")+" — entre com um toque, sem senha."
   :p.d;
  return `<div class="lk-row ${on?"on":""}">
   <span class="lk-logo ${p.cls}" aria-hidden="true">${p.logo}</span>
   <div class="lk-info"><b>${p.n}</b><small>${detail}</small></div>
   ${p.make?(on?`<button class="btn sm ghost" type="button" data-unlink="${p.id}">Desconectar</button>`:`<button class="btn sm" type="button" data-link="${p.id}">Conectar</button>`):`<span class="tag">Em breve</span>`}
  </div>`;
 }).join("");
 document.querySelectorAll('[id^="link-accounts"]').forEach(box=>box.innerHTML=html);
}
document.addEventListener("click",async e=>{
 const l=e.target.closest("[data-link]");
 if(l&&currentUser){
  const p=PROVIDERS.find(x=>x.id===l.dataset.link);if(!p)return;
  try{
   await linkWithPopup(currentUser,p.make());
   await reload(currentUser);
   renderLinks();
   toast(p.n+" conectado à sua conta. Agora você também entra por ele.");
  }catch(err){
   if(err?.code==="auth/provider-already-linked")toast(p.n+" já está conectado à sua conta.");
   else if(err?.code==="auth/credential-already-in-use")toast("Esta conta de "+p.n+" já pertence a outro usuário.");
   else showError(err);
  }
  return;
 }
 const u=e.target.closest("[data-unlink]");
 if(u&&currentUser){
  const prov=PROVIDERS.find(x=>x.id===u.dataset.unlink);if(!prov)return;
  askConfirm("Desconectar "+prov.n+" da sua conta? Você continua podendo entrar pelas outras formas.","Desconectar "+prov.n,async()=>{
   try{
    await currentUser.unlink(u.dataset.unlink);
    await reload(currentUser);
    renderLinks();
    toast(prov.n+" desconectado.");
   }catch(err){showError(err)}
  },"Desconectar");
 }
});
/* ============================================================
   22 · CENTRAL DE ANÚNCIOS YSHIPPCOMMERCE (gaveta tela cheia)
   · Anunciar: banners, links e vídeos pagos em reais
   · Ferramentas: encurtadores, plataformas de monetização,
     gerador de banner, calculadora e testador de código
   · Monetização Yshipp: programa de afiliados e pool de anúncios
   · Rotação automática: gaveta obrigatória a cada X minutos
     (settings.adcEveryMin / settings.adcViewSec no painel)
   ============================================================ */
const ADPRICE={
 banner:{n:"Banner de imagem",i:"<i class=yi data-i=image></i>",p:{h12:30,h24:50,d7:200}},
 link:{n:"Link patrocinado",i:"<i class=yi data-i=link></i>",p:{h12:20,h24:35,d7:120}},
 video:{n:"Vídeo / embed",i:"<i class=yi data-i=video></i>",p:{h12:40,h24:70,d7:280}},
 youtube:{n:"YouTube",i:"<i class=yi data-i=video></i>",p:{h12:40,h24:70,d7:280}},
 adsterra:{n:"Adsterra",i:"<i class=yi data-i=megaphone></i>",p:{h12:35,h24:60,d7:240}},
 monetag:{n:"Monetag",i:"<i class=yi data-i=bolt></i>",p:{h12:35,h24:60,d7:240}},
 encurtanet:{n:"EncurtaNet",i:"<i class=yi data-i=link></i>",p:{h12:25,h24:45,d7:180}}
};
/* formatos oficiais de banner da Adsterra/Monetag (dims registradas na campanha) */
const ADFORMATS={
 b468x60:{n:"Banner 468×60",w:468,h:60},b728x90:{n:"Leaderboard 728×90",w:728,h:90},
 b300x250:{n:"Medium rect 300×250",w:300,h:250},b160x600:{n:"Skyscraper 160×600",w:160,h:600},
 b320x50:{n:"Mobile 320×50",w:320,h:50},b320x100:{n:"Mobile 320×100",w:320,h:100},
 native:{n:"Native Banner",w:0,h:0}
};
/* extrai o ID do vídeo de qualquer URL oficial do YouTube — a modalidade YouTube
   NUNCA aceita iframe/script arbitrário, só a incorporação oficial (nocookie) */
function ytIdOf(u){
 const m=String(u||"").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/))([\w-]{6,})/);
 return m?m[1]:"";
}
const ADUR={h12:{n:"12 horas",ms:432e5},h24:{n:"24 horas",ms:864e5},d7:{n:"7 dias",ms:6048e5}};
/* ── ícones vetoriais profissionais (SVG inline, traço fino estilo Binance) ── */
const ADCICONS={
calendar:'<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
gavel:'<path d="m13 5.5 5.5 5.5M8 4l4 4-6.5 6.5L4 15l6.5-6.5zM7 20h13"/>',
star:'<path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z"/>',
list:'<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.6" cy="6" r="1.1"/><circle cx="3.6" cy="12" r="1.1"/><circle cx="3.6" cy="18" r="1.1"/>',
home:'<path d="M3 11.2 12 3.5l9 7.7"/><path d="M5.4 10v10.5h13.2V10"/>',
megaphone:'<path d="M3 10.2v4.6l11.4 4.6V5.6L3 10.2z"/><path d="M16.8 9a4 4 0 0 1 0 6"/><path d="M19.6 6.4a8 8 0 0 1 0 11.2"/>',
toolbox:'<path d="M4 8.5h16v11H4z"/><path d="M9 8.5V5.6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.9"/><path d="M12 11.5v5"/><path d="M9.8 13.7h4.4"/>',
chart:'<path d="M5 20v-6"/><path d="M12 20V5"/><path d="M19 20v-9"/><path d="M2.8 20h18.4"/>',
coins:'<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4v9.2"/><path d="M15 9.2c-.5-1-1.7-1.7-3-1.7-1.8 0-3 1-3 2.3s1.2 2 3 2.3c1.8.3 3 1 3 2.3s-1.2 2.3-3 2.3c-1.3 0-2.5-.7-3-1.7"/>',
eye:'<path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="3"/>',
pointer:'<path d="M5.5 3.2l13.6 6.8-5.8 1.5-1.9 5.7z"/>',
target:'<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.2"/>',
ticket:'<path d="M3.4 8.4a2 2 0 0 1 2-2h13.2a2 2 0 0 1 2 2 2.2 2.2 0 0 0 0 7.2 2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2 2.2 2.2 0 0 0 0-7.2z"/><path d="M13.8 10v4"/>',
image:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.6" cy="10" r="1.8"/><path d="M21 15.6 15.4 10 5 20"/>',
link:'<path d="M9.8 14.2a4.2 4.2 0 0 1 0-6l2-2a4.2 4.2 0 0 1 6 6l-1 1"/><path d="M14.2 9.8a4.2 4.2 0 0 1 0 6l-2 2a4.2 4.2 0 0 1-6-6l1-1"/>',
video:'<rect x="2.8" y="6" width="12.4" height="12" rx="2"/><path d="M15.6 10.4l5.6-2.8v8.8l-5.6-2.8"/>',
clock:'<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.4 2"/>',
trend:'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
check:'<path d="M4 12.6l5 5L20 6.6"/>',
gift:'<rect x="3" y="9" width="18" height="4"/><path d="M5 13v8h14v-8"/><path d="M12 9v12"/><path d="M12 9c-4 0-5-2.4-3.4-4C10 3.6 12 6 12 9zm0 0c4 0 5-2.4 3.4-4C14 3.6 12 6 12 9z"/>',
spark:'<path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/><circle cx="12" cy="12" r="2.6"/>',
flask:'<path d="M10 3h4"/><path d="M9 3v5l-5 9a2.4 2.4 0 0 0 2 3.5h12a2.4 2.4 0 0 0 2-3.5l-5-9V3"/><path d="M7.5 14h9"/>',
warn:'<path d="M12 4L2.8 20h18.4z"/><path d="M12 10v4"/><path d="M12 17.4v.2"/>',
inbox:'<path d="M22 13h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5h13.2l3.4 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
users:'<circle cx="9" cy="8" r="3.4"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6a4.6 4.6 0 0 1 4 5.4"/>',
note:'<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/><path d="M8.5 8.5h7M8.5 12h5"/>',
hourglass:'<path d="M6.5 4h11"/><path d="M6.5 20h11"/><path d="M8 4v3.5L12 12l4-4.5V4"/><path d="M8 20v-3.5L12 12l4 4.5V20"/>',
external:'<path d="M7 17L17 7"/><path d="M9 7h8v8"/>',
bulb:'<path d="M9.5 18h5"/><path d="M10 21h4"/><path d="M8 11a4 4 0 1 1 8 .5c0 1.7-1.6 2.6-2 4.5h-4c-.4-1.9-2-2.8-2-4.5z"/>',
pin:'<path d="M12 21s-6.5-5.4-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>',
checkc:'<circle cx="12" cy="12" r="8.6"/><path d="M8.4 12.4l2.4 2.4 4.8-5"/>',
trash:'<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/>',
dice:'<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
music:'<path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/>',
mobile:'<rect x="7.5" y="3" width="9" height="18" rx="2"/><path d="M11 18h2"/>',
cart:'<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.5 11h11L21 8H6"/>',
book:'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
trophy:'<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M7 5H4a3 3 0 0 0 3 5"/><path d="M17 5h3a3 3 0 0 1-3 5"/>',
search:'<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
help:'<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.5a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1 1-1 1.8"/><path d="M12 16.5v.2"/>',
scale:'<path d="M12 3v18"/><path d="M7 21h10"/><path d="M5 7h14"/><path d="M5 7l-2.6 6a3 3 0 0 0 5.2 0z"/><path d="M19 7l2.6 6a3 3 0 0 1-5.2 0z"/>',
handshake:'<path d="M2.5 12.5l4-3.5 3 1.5 2.5-2 2.5 2 3-1.5 4 3.5-2.5 3-2-1-2.5 2.5a1.9 1.9 0 0 1-2.7-2.7l1.3-1.3"/><path d="M6.5 9l2.5-3.5 3 1.5 3-1.5 2.5 3.5"/>',
ban:'<circle cx="12" cy="12" r="8.6"/><path d="M6 6l12 12"/>',
paperclip:'<path d="M20 11.5l-8.4 8.4a5 5 0 0 1-7-7L13.6 3.9a3.3 3.3 0 0 1 4.7 4.7l-8.9 8.9a1.7 1.7 0 0 1-2.4-2.4L15.5 7.2"/>',
send:'<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M21 3l-11 10"/>'
};
const ico=(n,s=16)=>`<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ADCICONS[n]||ADCICONS.spark}</svg>`;
const ADCFORMAT={banner:"image",link:"link",video:"video"};
/* ── PESQUISAS PAGAS ── categorias pré-definidas (as únicas aceitas) ── */
const PESCATS=[
 {id:"saude",n:"Saúde e bem-estar",ic:"flask",c:"#0ecb81"},
 {id:"casa",n:"Casa e decoração",ic:"home",c:"#f0b90b"},
 {id:"moda",n:"Moda e vestuário",ic:"gift",c:"#f6465d"},
 {id:"eletronico",n:"Eletrônicos e tecnologia",ic:"mobile",c:"#3861fb"},
 {id:"alimentos",n:"Alimentos e bebidas",ic:"cart",c:"#f0b90b"},
 {id:"beleza",n:"Beleza e cuidados pessoais",ic:"spark",c:"#f6465d"},
 {id:"transporte",n:"Automóveis e transporte",ic:"bolt",c:"#8ecbff"},
 {id:"viagem",n:"Viagens e turismo",ic:"pin",c:"#0ecb81"},
 {id:"educacao",n:"Educação e cursos",ic:"book",c:"#3861fb"},
 {id:"financas",n:"Finanças e investimentos",ic:"coins",c:"#fcd535"},
 {id:"pets",n:"Pets e animais",ic:"users",c:"#0ecb81"},
 {id:"esporte",n:"Esportes e fitness",ic:"trophy",c:"#fcd535"},
 {id:"jogos",n:"Jogos e entretenimento",ic:"dice",c:"#8ecbff"},
 {id:"musica",n:"Música e streaming",ic:"music",c:"#f6465d"},
 {id:"trabalho",n:"Trabalho e carreira",ic:"chart",c:"#fcd535"},
 {id:"infantil",n:"Maternidade e infantil",ic:"bulb",c:"#f0b90b"}
];
const pesCat=k=>PESCATS.find(c=>c.id===k)||{id:"outro",n:"Geral",ic:"flask",c:"#848e9c"};
const pesCatChip=k=>{const c=pesCat(k);return `<span class="pes-chip" style="background:color-mix(in srgb,${c.c} 14%,transparent);color:${c.c}">${ico(c.ic,13)} ${esc(c.n)}</span>`};
const icoFormat=t=>ico(ADCFORMAT[t]||"megaphone",18);
/* ── gráficos (SVG puro, dados reais ao vivo) ── */
const adcDefs='<defs><linearGradient id="adcGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe56b"/><stop offset="1" stop-color="#f0b90b"/></linearGradient></defs>';
/* gráfico de colunas: valores + rótulos */
function adcColsChart(vals,labels,h=96){
 if(!vals.length)return'<p class="hint" style="margin:0">Sem dados ainda.</p>';
 const max=Math.max(1,...vals),W=100,slot=W/vals.length;
 return `<svg viewBox="0 0 100 ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block">${adcDefs}
  ${vals.map((v,i)=>{const bh=Math.max(2,(v/max)*(h-22));return `<rect x="${(i*slot+slot*0.22).toFixed(2)}" y="${(h-12-bh).toFixed(2)}" width="${(slot*0.56).toFixed(2)}" height="${bh.toFixed(2)}" rx="1.2" fill="url(#adcGrad)" opacity="${v===max?1:0.55}"/>`}).join("")}
  <line x1="0" y1="${h-12}" x2="100" y2="${h-12}" stroke="#2b3139" stroke-width="0.7"/>
 </svg>
 <div style="display:flex;margin-top:4px">${vals.map((v,i)=>`<span style="flex:1;text-align:center;font:600 9px var(--mono);color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px">${esc(labels[i]||"")}</span>`).join("")}</div>`;
}
/* donut: segmentos [{v,c}] com legenda */
function adcDonut(segs,centerTop,centerBot){
 const tot=segs.reduce((s,x)=>s+x.v,0)||1,C=2*Math.PI*26;let off=0;
 return `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
 <svg viewBox="0 0 64 64" width="88" height="88" style="flex:none">
  ${segs.map(s=>{const len=(s.v/tot)*C;const el=`<circle cx="32" cy="32" r="26" fill="none" stroke="${s.c}" stroke-width="9" stroke-dasharray="${len.toFixed(2)} ${(C-len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 32 32)"/>`;off+=len;return el}).join("")}
  <text x="32" y="30.5" text-anchor="middle" font-size="9.5" font-weight="600" fill="currentColor">${esc(centerTop)}</text>
  <text x="32" y="40" text-anchor="middle" font-size="4.6" fill="#848e9c" letter-spacing="0.8">${esc(centerBot||"")}</text>
 </svg>
 <div style="display:grid;gap:5px;min-width:0">
  ${segs.map(s=>`<span style="display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--mu)"><i style="width:9px;height:9px;border-radius:3px;background:${s.c};display:inline-block;flex:none"></i>${esc(s.n)} <b style="font:600 11.5px var(--mono);color:var(--ink);margin-left:auto">${s.v}</b></span>`).join("")}
 </div></div>`;
}
let adcAds=[],adcMine=[],unAdcRot=null,unAdcMine=null,adcTab="inicio";
let surveys=[],surveyMine={},mySurveys=[],unSurveys=null,unSurveyMine=null,unMySurveys=null;
let pesView=null,pesDraft=null,pesTab="disponiveis";
let adcType="banner",adcDur="h24";
/* orçamento restante da campanha EncurtaNet (reserva - já pago) */
const adcBudgetLeft=a=>Math.max(0,(Math.floor(Number(a.budgetReserved)||0))-(Math.floor(Number(a.budgetPaid)||0)));
const adcActive=a=>{
 if(!a||a.status!=="active")return false;
 if(a.expiresAt&&stampMs(a.expiresAt)<=Date.now())return false;
 /* EncurtaNet: só roda com link encurtado cadastrado e orçamento disponível */
 if(a.type==="encurtanet")return !!a.shortUrl&&adcBudgetLeft(a)>0;
 return true;
};
const adcMineLive=a=>a&&(!a.expiresAt||stampMs(a.expiresAt)>Date.now());
function adcOpen(){$("adcveta").classList.add("open");$("adcav").classList.add("open");syncGavLock();adcRender()}
function adcClose(){$("adcveta").classList.remove("open");$("adcav").classList.remove("open");syncGavLock()}
/* resumo da Central de Anúncios na página principal (seção #anuncios) */
function adcMainSync(){
 const n=$("resadc-n"),p=$("resadc-pool");
 if(!n)return;
 const live=adcAds.filter(adcActive);
 n.textContent=live.length?live.length+" anúncio"+(live.length===1?"":"s")+" no ar":"Nenhum anúncio no ar";
 n.className="tag "+(live.length?"y":"");
 if(p)p.textContent="Pool do mês: "+fmtBRL(live.reduce((s,a)=>s+Math.max(0,Math.floor(Number(a.amount)||0)),0));
 pesMainSync();
 try{walMainSync()}catch(e){}
}
/* resumo da YshippWallet na página principal (#carteira-main) */
function walMainSync(){
 const t=$("walm-total");if(!t)return;
 const on=!!currentUser&&!!wallet;
 const tot=on?(walBrl()+cryptoBrlValue()):0;
 t.textContent=on?brl(tot):"— entre na conta";
 $("walm-tk").textContent=on?brl(walBrl()):"—";
 if($("walm-brl"))$("walm-brl").textContent=on?brl(walBrl()):"—";
 $("walm-crypto").textContent=on?((cryptoLive()||!cryptoBrlValue())?"":"≈ ")+brl(cryptoBrlValue()):"—";
 const wx=$("walm-xc");if(wx)wx.textContent=on?brl(xcBrlTotal()):"—";
 const wr=$("walm-rate");if(wr)wr.textContent="1";
}
/* resumo da Central de Pesquisas Pagas na página principal (#pesquisas-main) */
function pesMainSync(){
 const el=$("resp-n");if(!el)return;
 const avail=surveys.filter(s=>s.audience!=="collab"&&pesLive(s)&&!pesDone(s));
 const mine=Object.keys(surveyMine).length;
 const earned=Object.values(surveyMine).reduce((s,d)=>s+(Number(d.reward)||0),0);
 el.textContent=avail.length?avail.length+" no ar":"Nenhuma no ar";
 el.className="tag "+(avail.length?"g":"");
 const pot=$("resp-pot");if(pot)pot.textContent="ganho até "+fmtBRL(avail.reduce((s,x)=>s+pesReward(x),0));
 const me=$("resp-me");if(me)me.textContent=mine+" respondida"+(mine===1?"":"s");
 const earn=$("resp-earn");if(earn)earn.textContent=fmtBRL(earned)+" ganhos";
}
/* ── documento da Central de Anúncios salvo pelo painel (settings/adsCenter):
   rotação, preços e ferramentas recomendadas com mini-curso ── */
let adcCenter=null,adcCenterErr=null;
onSnapshot(doc(db,"settings","adsCenter"),s=>{
 adcCenterErr=null;
 adcCenter=s.exists()?s.data():null;
 try{adcRender()}catch(e){}
 try{adcMainSync()}catch(e){}
},e=>{adcCenterErr=(e&&e.code)||"erro";console.warn("Central de anúncios:",e);try{adcRender()}catch(_){}});
function adcPriceOf(t,d){
 const p=adcCenter?.prices?.[t]?.[d];
 return Math.max(1,Math.floor(Number(p)||0))||ADPRICE[t].p[d];
}
const adcToolsOf=()=>{
 const list=Array.isArray(adcCenter?.tools)?adcCenter.tools.filter(t=>t&&t.name&&t.active!==false):[];
 return list;
};
let adcOpenTool=null;
function adcToolOpen(tool){
 adcOpenTool=tool;
 $("adct-ico").innerHTML=String(tool.icon||"<i class=yi data-i=toolbox></i>").slice(0,220);
 $("adct-name").textContent=String(tool.name||"Ferramenta").slice(0,60);
 const stage=$("adct-stage");
 const course=String(tool.course||"").trim();
 if(course){
  const f=document.createElement("iframe");
  f.setAttribute("sandbox","allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-same-origin");
  f.style.cssText="width:100%;height:100%;min-height:220px;border:0;background:#fff";
  f.srcdoc=buildAdDoc(course);
  stage.innerHTML="";stage.appendChild(f);
 }else{
  stage.innerHTML=`<div style="padding:24px 16px;display:grid;gap:10px;justify-items:center;text-align:center;align-content:center;min-height:200px"><b style="font-size:18px">${tool.icon||""} ${esc(tool.name||"")}</b><p style="color:var(--mu);font-size:13.5px;max-width:52ch;margin:0;line-height:1.7">${esc(tool.desc||"")}</p></div>`;
 }
 const op=$("adct-open");
 op.hidden=!validUrl(tool.ref);
 if(!op.hidden)op.onclick=()=>{
  /* estatística: clique no botão "Abrir ferramenta" (visto no painel) */
  const k=String(tool.id||"").trim()||("n_"+String(tool.name||"").replace(/[^a-zA-Z0-9_]/g,"").slice(0,24));
  updateDoc(doc(db,"settings","adsCenter"),{["toolClicks."+k]:increment(1)}).catch(()=>{});
  window.open(tool.ref,"_blank","noopener")
 };
 $("adct-note").textContent=String(tool.tag||"Conteúdo escolhido pela equipe Yshippcommerce.").slice(0,90);
 $("adctool").classList.add("open");$("adctv").classList.add("open");syncGavLock();
}
$("adct-x").onclick=()=>{
 $("adctool").classList.remove("open");$("adctv").classList.remove("open");syncGavLock();
 $("adct-stage").innerHTML="";
};
/* pesquisas pagas · leitor e criador em tela cheia */
$("pes-x").onclick=pesClose;
$("pesc-x").onclick=pesNewClose;
document.addEventListener("click",e=>{
 const ad=e.target.closest("[data-pesad]");
 if(ad){const a=adcAds.find(x=>x.id===ad.dataset.pesad);if(a){updateDoc(doc(db,"marketAds",a.id),{clicks:increment(1)}).catch(()=>{});if(a.linkUrl&&validUrl(a.linkUrl))window.open(a.linkUrl,"_blank","noopener")}return}
 const po=e.target.closest("[data-pes-open]");
 if(po){pesOpen(po.dataset.pesOpen);return}
 if(e.target.closest("[data-pes-start]")){if(pesView){pesView.phase="q";pesView.idx=0;pesView.ans=[];const st=pesView.steps[0]||{};pesView.phase=st.kind==="banner"?"banner":st.kind==="direct"?"direct":st.type==="text"?"text":"q";pesRender()}return}
 const op=e.target.closest("[data-pes-opt]");
 if(op){pesAnswer(Math.max(0,Math.floor(Number(op.dataset.pesOpt)||0)));return}
 if(e.target.closest("[data-pes-textgo]")){pesTextGo();return}
 if(e.target.closest("[data-pes-bango]")){pesBanGo();return}
 if(e.target.closest("[data-pes-diropen]")){pesDirOpen();return}
 if(e.target.closest("[data-pes-dirgo]")){pesDirGo();return}
 if(e.target.closest("[data-pes-exit]")){pesClose();return}
 if(e.target.closest("[data-pesn-open]")){pesNewOpen();return}
 if(e.target.closest("[data-adcw-open]")){adcWOpen(e.target.closest("[data-adcw-open]").dataset.adcwOpen||"banner");return}
 if(e.target.closest("[data-pess-del]")){(async()=>{await pesNewCollect();if(pesDraft){pesDraft.steps.splice(Math.max(0,Math.floor(Number(e.target.closest("[data-pess-del]").dataset.pessDel)||0)),1);pesNewRender()}})();return}
 if(e.target.closest("[data-pess-addq]")){(async()=>{await pesNewCollect();if(pesDraft){pesDraft.steps.push({kind:"question",type:"choice",text:"",opts:["",""],trap:false,correct:0});pesNewRender()}})();return}
 if(e.target.closest("[data-pess-addt]")){(async()=>{await pesNewCollect();if(pesDraft){pesDraft.steps.push({kind:"question",type:"text",text:"",minChars:10,maxChars:300});pesNewRender()}})();return}
 if(e.target.closest("[data-pess-addb]")){(async()=>{await pesNewCollect();if(pesDraft){pesDraft.steps.push({kind:"banner",platform:"Adsterra",code:"",w:300,h:250});pesNewRender()}})();return}
 if(e.target.closest("[data-pess-addd]")){(async()=>{await pesNewCollect();if(pesDraft){pesDraft.steps.push({kind:"direct",url:"",label:"Continuar"});pesNewRender()}})();return}
 const oa=e.target.closest("[data-peso-add]");
 if(oa){(async()=>{await pesNewCollect();if(pesDraft){const q=pesDraft.steps[Math.max(0,Math.floor(Number(oa.dataset.pesoAdd)||0))];if(q&&q.kind==="question"&&(q.opts||[]).length<6){q.opts.push("");pesNewRender()}}})();return}
 const od=e.target.closest("[data-peso-del]");
 if(od){(async()=>{await pesNewCollect();if(pesDraft){const [qi,oi]=od.dataset.pesoDel.split(":").map(Number);const q=pesDraft.steps[qi];if(q&&q.kind==="question"){q.opts.splice(Math.max(0,oi||0),1);if(q.correct>=q.opts.length)q.correct=0;pesNewRender()}}})();return}
 if(e.target.closest("[data-pesn-go]")){pesNewSubmit();return}
});
/* marcar/desmarcar "pergunta isca" re-renderiza o builder para mostrar o seletor da correta */
document.addEventListener("change",e=>{
 if(e.target instanceof Element&&e.target.id&&/^pesn-qt\d+$/.test(e.target.id)){(async()=>{await pesNewCollect();if(pesDraft)pesNewRender()})()}
});
function adcAutoCfg(){return{everyMin:Math.min(240,Math.max(5,Math.floor(Number(adcCenter?.everyMin)||Number(settings.adcEveryMin)||20))),viewSec:Math.min(120,Math.max(5,Math.floor(Number(adcCenter?.viewSec)||Number(settings.adcViewSec)||10)))}}
function adcWatch(uid){
 unAdcRot?.();unAdcMine?.();unAdcRot=null;unAdcMine=null;
 unSurveys?.();unSurveyMine?.();unMySurveys?.();unSurveys=null;unSurveyMine=null;unMySurveys=null;
 if(!uid){adcAds=[];adcMine=[];surveys=[];surveyMine={};mySurveys=[];try{adcMainSync()}catch(e){}return}
 unAdcRot=onSnapshot(query(collection(db,"marketAds"),limit(100)),s=>{adcAds=s.docs.map(d=>({id:d.id,...d.data()}));try{adcRender()}catch(e){}try{adcMainSync()}catch(e){}},e=>console.warn("Anúncios:",e));
 unAdcMine=onSnapshot(query(collection(db,"marketAds"),where("uid","==",uid),limit(25)),s=>{adcMine=s.docs.map(d=>({id:d.id,...d.data()}));try{adcRender()}catch(e){}},e=>console.warn(e));
 /* pesquisas pagas: todas as aprovadas + as que EU já respondi (pg só 1 vez por pesquisa) */
 unSurveys=onSnapshot(query(collection(db,"surveys"),limit(200)),s=>{surveys=s.docs.map(d=>({id:d.id,...d.data()}));try{adcRender()}catch(e){}try{pesMainSync()}catch(e){}try{if($("pescmgaveta").classList.contains("open"))pesCenterRender()}catch(e){}},e=>console.warn("Pesquisas:",e));
 unSurveyMine=onSnapshot(query(collection(db,"surveyAnswers"),where("uid","==",uid),limit(300)),s=>{surveyMine={};s.docs.forEach(d=>{const dd=d.data();surveyMine[dd.surveyId]=dd});try{adcRender()}catch(e){}try{pesMainSync()}catch(e){}try{if($("pescmgaveta").classList.contains("open"))pesCenterRender()}catch(e){}},e=>console.warn(e));
 unMySurveys=onSnapshot(query(collection(db,"surveys"),where("uid","==",uid),limit(50)),s=>{mySurveys=s.docs.map(d=>({id:d.id,...d.data()}));try{adcRender()}catch(e){}},e=>console.warn(e));
}
function adcStats(){
 const live=adcAds.filter(adcActive);
 const mine=adcMine.filter(adcMineLive);
 const pool=live.reduce((s,a)=>s+Math.max(0,Math.floor(Number(a.amount)||0)),0);
 const views=adcMine.reduce((s,a)=>s+(Number(a.impressions)||0),0);
 const clicks=adcMine.reduce((s,a)=>s+(Number(a.clicks)||0),0);
 $("adc-stats").innerHTML=`
  <div class="ap-kpi"><span class="kl">${ico("megaphone",14)}No ar agora</span><b class="gold">${live.length}</b></div>
  <div class="ap-kpi"><span class="kl">${ico("ticket",14)}Pool do mês</span><b class="gold">${pool}</b></div>
  <div class="ap-kpi"><span class="kl">${ico("toolbox",14)}Ferramentas</span><b>${adcToolsOf().length}</b></div>
  <div class="ap-kpi"><span class="kl">${ico("chart",14)}Minhas campanhas</span><b class="${mine.length?"green":""}">${mine.length}</b></div>
  <div class="ap-kpi"><span class="kl">${ico("eye",14)}Meus views</span><b>${views}</b></div>
  ${views?`<div class="ap-kpi"><span class="kl">${ico("target",14)}Meu CTR</span><b class="green">${((clicks/views)*100).toFixed(1)}%</b></div>`:`<div class="ap-kpi"><span class="kl">${ico("pointer",14)}Meus cliques</span><b>${clicks}</b></div>`}`;
}
function adcRender(){
 $("adc-stats").hidden=adcTab!=="inicio";
 if(adcTab==="inicio")adcStats();
 const tabs=[["inicio","home","Início"],["anunciar","megaphone","Anunciar"],["pesquisas","flask","Pesquisas"],["ferramentas","toolbox","Ferramentas"],["minhas","chart","Minhas"],["monetizar","coins","Monetizar"]];
 $("adc-tabs").innerHTML=tabs.map(([k,ic,l])=>`<button class="${adcTab===k?"on":""}" data-adctab="${k}">${ico(ic,17)}<span>${l}</span></button>`).join("");
 const b=$("adc-body");
 if(adcTab==="inicio")b.innerHTML=adcHome();
 else if(adcTab==="anunciar")b.innerHTML=adcForm();
 else if(adcTab==="pesquisas")b.innerHTML=adcSurveys();
 else if(adcTab==="ferramentas")b.innerHTML=adcTools();
 else if(adcTab==="minhas")b.innerHTML=adcMineTab();
 else b.innerHTML=adcMoney();
}
const ADCCATN={encurtador:"Encurtador",monetizacao:"Monetização",trafego:"Tráfego",banner:"Banners",video:"Vídeos",outro:"Outro"};
/* ═══════════════════════════════════════════════════════════════
   PESQUISAS PAGAS · aba, leitor em tela cheia e criador de pesquisas
   Princípios: participação 100% voluntária (nada obrigatório), 1
   resposta por usuário por pesquisa, pergunta isca encerra na hora
   sem recompensa, banners e links patrocinados intercalados.
   ═══════════════════════════════════════════════════════════════ */
const pesLive=s=>s&&s.status==="approved"&&(()=>{const slots=Math.floor(Number(s.slots)||0),resp=Math.floor(Number(s.responses)||0);return !slots||resp<slots})();
const pesDone=s=>!!surveyMine[s?.id];
const pesLeft=s=>{const slots=Math.floor(Number(s.slots)||0),resp=Math.floor(Number(s.responses)||0);return slots?Math.max(0,slots-resp):0};
const pesTime=s=>{const n=(s.questions||[]).length||1;return n<=3?"~1 min":n<=6?"~2 min":n<=10?"~3 min":"~5 min"};
const pesReward=s=>Math.max(0,Math.floor(Number(s?.reward)||0));
/* faixa de anúncios patrocinados intercalada entre as pesquisas */
function pesStrip(){
 const live=adcAds.filter(a=>adcActive(a)&&(a.type==="link"||a.type==="banner"));
 if(!live.length)return"";
 const top=[...live].sort((a,b)=>(Number(b.weight)||1)-(Number(a.weight)||1)).slice(0,4);
 return `<div style="display:grid;gap:8px;margin-top:16px">
  <div class="ap-sec">${ico("megaphone",13)} Patrocinado agora</div>
  <div class="pes-strip">${top.map(a=>`<button type="button" class="pes-tile" data-pesad="${esc(a.id)}">${a.imageUrl&&validUrl(a.imageUrl)?`<img src="${esc(a.imageUrl)}" alt="" style="width:100%;height:64px;object-fit:cover;border-radius:8px">`:`<b>${ico("link",12)} ${esc(a.title||"Anúncio")}</b>`}<small>${esc(a.text||"").slice(0,60)}</small><span style="font:600 9px var(--mono);letter-spacing:.6px;color:var(--acx)">ANÚNCIO · ABRIR LINK</span></button>`).join("")}</div>
 </div>`;
}
/* card de pesquisa (usado nas duas centrais) */
function pesCardHTML(s){
 const cat=pesCat(s.cat),left=pesLeft(s),nq=(s.questions||[]).length;
 return `<div class="pes-card">
  <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">${pesCatChip(s.cat)}<span class="ap-m">${ico("hourglass",11)} ${pesTime(s)}</span><span class="ap-m"><i class=yi data-i=note></i> ${nq} perguntas</span><span style="margin-left:auto;font:600 13px var(--mono);color:var(--acx)">+${pesReward(s)} <i class=yi data-i=ticket></i></span></div>
  <div><h4>${esc(s.title||"Pesquisa")}</h4><p>${esc(s.desc||"")}</p></div>
  ${left?`<div style="display:grid;gap:4px"><div class="pes-bar"><i style="width:${Math.min(100,Math.round((Number(s.responses)||0)/Math.max(1,Number(s.slots)||1)*100))}%"></i></div><span style="font:600 9.5px var(--mono);color:var(--mu);letter-spacing:.6px">${left} VAGAS RESTANTES</span></div>`:`<span class="ap-m">${ico("users",11)} vagas ilimitadas</span>`}
  <button class="btn sm" type="button" data-pes-open="${esc(s.id)}">Responder pesquisa <i class=yi data-i=external></i></button>
 </div>`;
}
const pesHeroKPIs=(avail)=>{
 const doneN=Object.keys(surveyMine).length;
 const earned=Object.values(surveyMine).reduce((s,d)=>s+(Number(d.reward)||0),0);
 const pot=avail.reduce((s,x)=>s+pesReward(x),0);
 return `<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:15px;display:flex;align-items:center;gap:8px">${ico("flask",18)} Pesquisas pagas</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Responda pesquisas e ganhe reais. <b>Participação sempre voluntária</b> — nada é obrigatório. Cada pesquisa tem perguntas rápidas e pode conter uma <b>pergunta isca</b> de atenção: se errar, a pesquisa encerra na hora e a recompensa não é creditada. 1 resposta por pesquisa por pessoa.</p></div>
  <div class="ap-hero-grid">
   <div class="ap-kpi"><span>Disponíveis agora</span><b class="${avail.length?"green":""}">${avail.length}</b></div>
   <div class="ap-kpi"><span>Ganho potencial</span><b class="gold">${pot} <i class=yi data-i=ticket></i></b></div>
   <div class="ap-kpi"><span>Respondidas por você</span><b>${doneN}</b></div>
   <div class="ap-kpi"><span>Recebido em pesquisas</span><b class="green">${earned} <i class=yi data-i=ticket></i></b></div>
  </div></div>`;
};
/* aba PESQUISAS da CENTRAL DE ANÚNCIOS: pesquisas do próprio Yshippcommerce voltadas
   aos COLABORADORES (pesquisas de mercado sobre parceiros e negócios) */
function adcSurveys(){
 const avail=surveys.filter(s=>s.audience==="collab"&&pesLive(s)&&!pesDone(s));
 return `${pesHeroKPIs(avail)}
  ${avail.length?`<div style="display:grid;gap:10px;margin-top:14px">${avail.map(pesCardHTML).join("")}</div>`:`<div class="ap-row" style="margin-top:14px"><p class="hint" style="margin:0">Nenhuma pesquisa para colaboradores no ar agora. O Yshippcommerce publica aqui pesquisas para conhecer melhor os parceiros e seus negócios — volte mais tarde.</p></div>`}
  ${pesStrip()}
  <div class="ap-form-note" style="margin-top:14px">${ico("bulb",14)}<span>As <b>pesquisas para os membros</b> (pagas em reais) ficam na <b>Central de Pesquisas Pagas</b>, na página principal. Colaboradores também podem criá-las na aba <b><i class=yi data-i=megaphone></i> Anunciar</b> — formato <b>Pesquisa paga</b>.</span></div>`;
}
/* ═══ CENTRAL DE PESQUISAS PAGAS · tela cheia própria ═══
   Pesquisas para os MEMBROS pagarem reais por resposta. */
function pesCenterOpen(){$("pescmgaveta").classList.add("open");$("pescm").classList.add("open");syncGavLock();pesCenterRender()}
function pesCenterClose(){$("pescmgaveta").classList.remove("open");$("pescm").classList.remove("open");syncGavLock()}
function pesCenterRender(){
 const tabs=[["disponiveis","flask","Disponíveis"],["respondidas","checkc","Respondidas"],["minhas","chart","Minhas"]];
 $("pescm-tabs").innerHTML=tabs.map(([k,ic,l])=>`<button class="${pesTab===k?"on":""}" data-pestab="${k}">${ico(ic,17)}<span>${l}</span></button>`).join("");
 $("pescm-body").innerHTML=pesTab==="respondidas"?pesTabDone():pesTab==="minhas"?pesTabMine():pesTabAvail();
}
function pesTabAvail(){
 const avail=surveys.filter(s=>s.audience!=="collab"&&pesLive(s)&&!pesDone(s));
 return `${pesHeroKPIs(avail)}
  ${avail.length?`<div style="display:grid;gap:10px;margin-top:14px">${avail.map(pesCardHTML).join("")}</div>`:`<div class="ap-row" style="margin-top:14px"><p class="hint" style="margin:0">Nenhuma pesquisa disponível agora. Volte mais tarde — novas pesquisas de parceiros entram aqui toda semana.</p></div>`}
  ${pesStrip()}
  <div class="ap-form-note" style="margin-top:14px">${ico("bulb",14)}<span>Quer <b>pagar</b> para a comunidade responder a <b>sua</b> pesquisa? Toque em <b>Minhas</b> acima e depois em <b>Criar pesquisa paga</b> — você define as perguntas, as vagas e a recompensa por resposta.</span></div>`;
}
function pesTabDone(){
 const entries=Object.values(surveyMine);
 const spent=entries.reduce((s,d)=>s+(Number(d.reward)||0),0);
 return `<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:15px;display:flex;align-items:center;gap:8px">${ico("checkc",18)} Respondidas</b>
  <p class="hint" style="margin:0;font-size:12.5px">Seu histórico de participação em pesquisas, com o que foi creditado em cada uma.</p></div>
  <div class="ap-hero-grid">
   <div class="ap-kpi"><span>Participações</span><b>${entries.length}</b></div>
   <div class="ap-kpi"><span>Concluídas</span><b class="green">${entries.filter(d=>d.result==="done").length}</b></div>
   <div class="ap-kpi"><span>Encerradas por isca</span><b class="red">${entries.filter(d=>d.result==="fail").length}</b></div>
   <div class="ap-kpi"><span>Total recebido</span><b class="gold">${spent} <i class=yi data-i=ticket></i></b></div>
  </div></div>
  <div style="display:grid;gap:10px;margin-top:14px">${entries.length?entries.map(d=>{
   const s=surveys.find(x=>x.id===d.surveyId);
   return `<div class="ap-row"><div class="r-head"><span class="r-ico" style="color:${d.result==="done"?"var(--g)":"var(--rd)"}">${ico(d.result==="done"?"checkc":"warn",16)}</span><div class="r-title"><b>${esc(s?.title||"Pesquisa")}</b><small>${esc(s?pesCat(s.cat).n:"")} ${d.createdAt?"· "+fmt(d.createdAt):""}</small></div></div><span style="margin-left:auto;font:600 13px var(--mono);color:${d.result==="done"?"var(--g)":"var(--rd)"}">${d.result==="done"?"+"+Math.max(0,Math.floor(Number(d.reward)||0)):"sem prêmio"}</span></div>`;
  }).join(""):'<div class="ap-row"><p class="hint" style="margin:0">Você ainda não participou de nenhuma pesquisa. Veja a aba Disponíveis!</p></div>'}</div>`;
}
function pesTabMine(){
 const mine=[...mySurveys].sort((a,b)=>(stampMs(b.createdAt)||0)-(stampMs(a.createdAt)||0));
 return `<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:15px;display:flex;align-items:center;gap:8px">${ico("chart",18)} Minhas pesquisas</b>
  <button class="btn sm" data-pesn-open style="margin-left:auto">＋ Criar pesquisa paga</button>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Pesquisas que você criou e pagou para a comunidade responder. O custo é <b>recompensa × vagas</b>, debitado na publicação; aprovadas, entram na aba Disponíveis para todos.</p></div></div>
  <div style="display:grid;gap:10px;margin-top:14px">${mine.length?mine.map(s=>`<div class="ap-row"><div class="r-head"><span class="r-ico" style="color:var(--acx)">${ico("flask",16)}</span><div class="r-title"><b>${esc(s.title||"Pesquisa")}</b><small>${esc(pesCat(s.cat).n)}</small></div><span style="margin-left:auto">${s.status==="pending"?'<span class="tag y"><i class=yi data-i=hourglass></i> Em aprovação</span>':s.status==="approved"?'<span class="tag g">No ar</span>':s.status==="paused"?'<span class="tag y">Pausada</span>':s.status==="rejected"?'<span class="tag r">Recusada</span>':'<span class="tag">—</span>'}</span></div><div class="r-metrics"><span class="ap-m">Respostas <b>${Number(s.responses)||0}${Math.floor(Number(s.slots)||0)?"/"+Math.floor(Number(s.slots)):""}</b></span><span class="ap-m">Gasto <b>${Math.max(0,Math.floor(Number(s.amount)||0))} <i class=yi data-i=ticket></i></b></span></div></div>`).join(""):'<div class="ap-row"><p class="hint" style="margin:0">Você ainda não criou nenhuma pesquisa. Toque em <b>＋ Criar pesquisa paga</b> para publicar a primeira.</p></div>'}</div>`;
}
/* ── PESQUISAS · roteiro completo (perguntas, escritas, blocos de anúncio, links diretos) ── */
const pesStepsOf=s=>{
 if(Array.isArray(s?.steps)&&s.steps.length)return s.steps;
 return (s?.questions||[]).map(q=>({...q,kind:"question",type:"choice"}));
};
const ECON_DEF={ticketPoints:{common:1,gold:1,vip:1},ticketsPerBrl:1000,withdrawMin:5,withdrawFee:0,withdrawDays:2,survey:{base:4,perQuestion:2,perOption:0.5,perText:3,perBanner:3,perDirect:2,perTime:0.5,min:3,max:100},miningOn:true,buffsOn:true,maxMiningBuffPct:100,maxRewardBuffPct:50,pix:{key:"",name:"",city:"SAO PAULO",desc:"YSHIPPMARKET"},cryptos:["BTC","ETH","USDT","BNB","SOL","XRP","ADA","DOGE","LTC","MATIC"],ticketConv:{enabled:true,feePct:0,min:1,max:100000,pairs:{common:{gold:true,vip:false},gold:{common:true,vip:true},vip:{common:true,gold:true}}}};
const econNum=(value,fallback)=>{if(value===undefined||value===null||value==="")return fallback;const n=Number(value);return Number.isFinite(n)?n:fallback};
const econCfg=()=>{
 const e=econ||{};
 const sv={...ECON_DEF.survey,...(e.survey||{})};
 const tc=e.ticketConv&&typeof e.ticketConv==="object"?e.ticketConv:{};
 return{
  ticketPoints:{...ECON_DEF.ticketPoints,...(e.ticketPoints||{})},
  ticketsPerBrl:Math.max(1,Math.floor(econNum(e.ticketsPerBrl,ECON_DEF.ticketsPerBrl))),
  withdrawMin:Math.max(0.01,econNum(e.withdrawMin,ECON_DEF.withdrawMin)),
  withdrawFee:Math.min(50,Math.max(0,econNum(e.withdrawFee,ECON_DEF.withdrawFee))),
  withdrawDays:Math.min(30,Math.max(0,Math.floor(econNum(e.withdrawDays,ECON_DEF.withdrawDays)))),
  survey:sv,
  miningOn:e.miningOn!==false,
  buffsOn:e.buffsOn!==false,
  maxMiningBuffPct:Math.min(500,Math.max(0,Math.floor(econNum(e.maxMiningBuffPct,ECON_DEF.maxMiningBuffPct)))),
  maxRewardBuffPct:Math.min(500,Math.max(0,Math.floor(econNum(e.maxRewardBuffPct,ECON_DEF.maxRewardBuffPct)))),
  pix:{...ECON_DEF.pix,...(e.pix||{})},
  cryptos:Array.isArray(e.cryptos)&&e.cryptos.length?e.cryptos:ECON_DEF.cryptos.slice(),
  ticketConv:{enabled:tc.enabled!==false,feePct:Math.min(50,Math.max(0,Number(tc.feePct)||0)),min:Math.max(1,Math.floor(Number(tc.min)||1)),max:Math.max(1,Math.floor(Number(tc.max)||100000)),pairs:{common:{...(ECON_DEF.ticketConv.pairs.common||{}),...(tc.pairs?.common||{})},gold:{...(ECON_DEF.ticketConv.pairs.gold||{}),...(tc.pairs?.gold||{})},vip:{...(ECON_DEF.ticketConv.pairs.vip||{}),...(tc.pairs?.vip||{})}}}
 };
};
function pesAutoValue(steps){
 const cfg=econCfg().survey;
 const qs=steps.filter(s=>s&&s.kind==="question");
 const nq=qs.length;
 let opts=0;qs.forEach(q=>opts+=(q.opts||[]).length);
 const nText=qs.filter(q=>q.type==="text").length;
 const nBan=steps.filter(s=>s&&s.kind==="banner").length;
 const nDir=steps.filter(s=>s&&s.kind==="direct").length;
 let v=cfg.base+nq*cfg.perQuestion+(nq?(opts/nq)*cfg.perOption:0)+nText*cfg.perText+nBan*cfg.perBanner+nDir*cfg.perDirect+nq*cfg.perTime;
 return Math.max(cfg.min,Math.min(cfg.max,Math.round(v)));
}
/* buffs ativos do usuário (da carteira) */
const activeBuffs=(type)=>{
 const arr=Array.isArray(wallet?.buffs)?wallet.buffs:[];
 const now=Date.now();
 return arr.filter(b=>{if(!b||!b.effect||b.effect.type!==type)return false;const st=b.startsAt?stampMs(b.startsAt):0;const end=b.endsAtMs?b.endsAtMs:st+(Number(b.durDays)||7)*864e5;return end>now;});
};
const buffPct=type=>activeBuffs(type).reduce((s,b)=>s+(Number(b.effect?.pct)||0),0);
/* tipos de buff: rótulo e ícone usados no Market, na carteira e nas aprovações */
const BUFF_META={miningBoost:["Mineração","hammer"],rewardBoost:["Pesquisas pagas","flask"],taskBoost:["Tarefas","check"],adBoost:["Anúncios","megaphone"]};
const buffCap=200;
const boosted=(base,type)=>{const p=Math.min(buffCap,buffPct(type));return p?base+Math.ceil(base*p/100):base};
/* ── LEITOR EM TELA CHEIA ── */
function pesOpen(id){
 const s=surveys.find(x=>x.id===id);
 if(!s)return;
 if(pesDone(s)){toast("Você já respondeu a esta pesquisa. Cada pessoa participa 1 vez.");return}
 pesView={s,idx:0,phase:"intro",steps:pesStepsOf(s),ans:[],dirOpened:false,dirReady:false};
 $("pesgaveta").classList.add("open");$("pesv").classList.add("open");syncGavLock();
 pesRender();
}
function pesClose(){$("pesgaveta").classList.remove("open");$("pesv").classList.remove("open");syncGavLock();pesView=null}
function pesSponsor(){
 const live=adcAds.filter(a=>adcActive(a)&&(a.type==="link"||a.type==="banner"));
 if(!live.length)return"";
 const a=live[Math.floor(Math.random()*live.length)];
 return `<div style="margin-top:14px"><div class="ap-sec">${ico("megaphone",13)} Patrocinado</div><button type="button" class="ap-row" style="width:100%;text-align:left" data-pesad="${esc(a.id)}"><div class="r-head"><span class="r-ico" style="color:var(--acx)">${icoFormat(a.type)}</span><div class="r-title"><b>${esc(a.title||"Anúncio")}</b><small>${esc(a.text||"").slice(0,70)}</small></div></div></button></div>`;
}
function pesNext(v){
 if(v.idx+1>=v.steps.length)return"end";
 v.idx++;
 const st=v.steps[v.idx];
 if(st.kind==="banner")return"banner";
 if(st.kind==="direct"){v.dirOpened=false;v.dirReady=false;return"direct"}
 return st.type==="text"?"text":"q";
}
function pesRender(){
 const v=pesView;if(!v)return;
 const s=v.s,steps=v.steps||[],cat=pesCat(s.cat);
 const nq=steps.filter(x=>x.kind==="question").length;
 const nBan=steps.filter(x=>x.kind==="banner").length;
 const nDir=steps.filter(x=>x.kind==="direct").length;
 $("pes-ico").innerHTML=ico(cat.ic,18);
 $("pes-name").textContent=s.title||"Pesquisa paga";
 const body=$("pes-body");
 if(v.phase==="intro"){
  body.innerHTML=`<div style="max-width:560px;margin:0 auto;display:grid;gap:12px;padding-top:6px">
   ${pesCatChip(s.cat)}
   <div class="pes-note">Esta pesquisa tem <b>${nq} pergunta(s)</b>${nBan?`, <b>${nBan} bloco(s) de anúncio</b> do patrocinador`:""}${nDir?` e <b>${nDir} link(s) direto(s)</b>`:""} — tempo médio de ${pesTime(s)}.</div>
   <div class="ap-row"><div class="r-metrics">
    <span class="ap-m">Recompensa <b class="gold" style="color:var(--acx)">+${fmtBRL(pesReward(s))}</b></span>
    <span class="ap-m">Etapas <b>${steps.length}</b></span>
    <span class="ap-m">Tempo <b>${pesTime(s)}</b></span>
    ${pesLeft(s)?`<span class="ap-m">Vagas <b>${pesLeft(s)}</b></span>`:""}
   </div></div>
   ${buffPct("rewardBoost")?`<div class="pes-result ok" style="text-align:left">${ico("bolt",16)} <b>Buff ativo:</b> +${buffPct("rewardBoost")}% nos reais desta pesquisa enquanto o buff durar.</div>`:""}
   ${nBan||nDir?`<div class="ap-form-note">${ico("megaphone",14)}<span>Ao longo da pesquisa aparecem <b>blocos de anúncio</b> do patrocinador (banners em janelas seguras) e possivelmente um <b>link direto</b>: antes de sair, você é <b>avisado</b> e o link abre em outra aba — <b>volte para a pesquisa para terminar</b> e receber os reais.</span></div>`:""}
   <div class="ap-form-note">${ico("warn",14)}<span>Pode aparecer uma <b>pergunta isca</b> só para conferir sua atenção. Se errar, a pesquisa <b>encerra na hora</b> e a recompensa não é creditada.</span></div>
   <div class="ap-form-note">${ico("check",14)}<span><b>Participação voluntária:</b> você escolhe responder. Pode sair quando quiser, sem penalidade — só não ganha os reais.</span></div>
   <button class="btn" type="button" data-pes-start style="width:100%">Começar pesquisa · +${pesReward(s)} <i class=yi data-i=ticket></i></button>
   <button class="btn ghost sm" type="button" data-pes-exit style="width:100%">Agora não</button>
  </div>`;
 }else if(v.phase==="q"||v.phase==="text"){
  const q=v.steps[v.idx]||{};
  const pct=Math.round((v.idx/steps.length)*100);
  const isText=q.type==="text";
  const mn=Math.max(0,Math.floor(Number(q.minChars)||0)),mx=Math.max(20,Math.floor(Number(q.maxChars)||300));
  body.innerHTML=`<div style="max-width:560px;margin:0 auto;display:grid;gap:14px;padding-top:6px">
   <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="pes-qnum">Etapa ${v.idx+1} de ${steps.length}</span><span class="pes-pct" style="margin-left:auto">${pct}% concluído</span>${v.idx&&v.idx%2===0?`<span style="flex-basis:100%;font:600 9px var(--mono);color:var(--mu);letter-spacing:.6px">LEIA COM ATENÇÃO <i class=yi data-i=eye></i></span>`:""}</div>
   <div class="pes-bar"><i style="width:${pct}%"></i></div>
   <div class="pes-qcard"><span class="pes-ql">${isText?"Resposta aberta":"Escolha uma opção"}</span><h3>${esc(q.text||"")}</h3></div>
   ${isText?`
   <div class="pes-opts">
    <textarea id="pes-txt" maxlength="${mx}" placeholder="Escreva sua resposta (${mn}–${mx} caracteres)"></textarea>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
     <span class="hint" style="font-size:11px" id="pes-txt-cnt">0/${mx}</span>
     <button class="btn" type="button" data-pes-textgo style="width:auto">Continuar <i class=yi data-i=check></i></button>
    </div>
   </div>`:`
   <div class="pes-opts">${(q.opts||[]).map((o,i)=>`<button type="button" class="pes-opt" data-pes-opt="${i}"><span class="pes-l">${i+1}</span><span>${esc(o)}</span></button>`).join("")}</div>`}
   <button class="link" type="button" data-pes-exit style="justify-self:center">Cancelar e sair</button>
  </div>`;
  if(isText){
   const ta=$("pes-txt");
   ta.oninput=()=>{const c=$("pes-txt-cnt");if(c)c.textContent=String(ta.value.length)+"/"+mx};
   ta.focus();
  }
 }else if(v.phase==="banner"){
  const b=v.steps[v.idx]||{};
  const w=Math.min(800,Math.max(120,Math.floor(Number(b.w)||300)));
  const h=Math.min(800,Math.max(60,Math.floor(Number(b.h)||250)));
  const pct=Math.round((v.idx/steps.length)*100);
  body.innerHTML=`<div style="max-width:640px;margin:0 auto;display:grid;gap:12px;padding-top:6px">
   <div style="display:flex;align-items:center;gap:10px"><span class="pes-qnum">Etapa ${v.idx+1} de ${steps.length} · bloco de anúncio</span></div>
   <div class="pes-bar"><i style="width:${pct}%"></i></div>
   <div class="pes-note">Patrocinado pela plataforma <b>${esc(b.platform||"de anúncios")}</b> · o banner roda em janela isolada e segura.</div>
   <iframe class="preview-frame" style="width:100%;max-width:${w}px;height:${h}px;margin:auto;background:#fff;border:1px solid var(--l);border-radius:10px" sandbox="allow-scripts allow-popups allow-forms" srcdoc="${esc(b.code||"")}"></iframe>
   <button class="btn" type="button" data-pes-bango style="width:100%">Continuar a pesquisa <i class=yi data-i=check></i></button>
   <button class="link" type="button" data-pes-exit style="justify-self:center">Cancelar e sair</button>
  </div>`;
 }else if(v.phase==="direct"){
  const d=v.steps[v.idx]||{};
  const pct=Math.round((v.idx/steps.length)*100);
  body.innerHTML=`<div style="max-width:560px;margin:0 auto;display:grid;gap:12px;padding-top:6px">
   <div style="display:flex;align-items:center;gap:10px"><span class="pes-qnum">Etapa ${v.idx+1} de ${steps.length} · link direto</span></div>
   <div class="pes-bar"><i style="width:${pct}%"></i></div>
   <div class="pes-result ok" style="text-align:left">
    <span style="color:var(--acx)">${ico("external",22)}</span>
    <b>${esc(d.label||"Visitar o link do patrocinador")}</b>
    <p class="pes-note" style="margin:0">Você será <b>redirecionado automaticamente</b> para o endereço abaixo em <b>outra aba</b>. Isso faz parte da pesquisa — depois de conhecer o conteúdo, <b>volte para esta tela para terminar</b> e receber os reais.</p>
    <p class="mono" style="margin:0;font-size:11.5px;color:var(--mu);overflow-wrap:anywhere">${esc(d.url||"")}</p>
   </div>
   ${v.dirOpened?`
   <div class="ap-form-note">${ico("inbox",14)}<span>Link aberto em outra aba. Quando terminar por lá, <b>volte aqui</b> e toque no botão para concluir a etapa.</span></div>
   <button class="btn" type="button" data-pes-dirgo style="width:100%" ${v.dirReady?"":"disabled"}>${v.dirReady?`Voltar e continuar <i class=yi data-i=check></i>`:"Aguardando seu retorno…"}</button>
   `:`
   <button class="btn" type="button" data-pes-diropen style="width:100%">Abrir o link (nova aba) <i class=yi data-i=external></i></button>
   `}
   <button class="link" type="button" data-pes-exit style="justify-self:center">Cancelar e sair</button>
  </div>`;
 }else if(v.phase==="done"){
  const got=v.paid||pesReward(s);
  body.innerHTML=`<div style="max-width:560px;margin:0 auto;display:grid;gap:14px;padding-top:20px">
   <div class="pes-result ok">
    <span style="color:var(--g)">${ico("checkc",42)}</span>
    <div class="pes-big">+${got} <i class=yi data-i=ticket></i></div>
    <b>Pesquisa concluída!</b>
    <p class="pes-note" style="margin:0">Obrigado pelas suas respostas. Os reais já estão na sua carteira e a participação desta pesquisa ficou registrada.</p>
   </div>
   ${pesSponsor()}
   <button class="btn" type="button" data-pes-exit style="width:100%">Concluir <i class=yi data-i=check></i></button>
  </div>`;
 }else if(v.phase==="fail"){
  body.innerHTML=`<div style="max-width:560px;margin:0 auto;display:grid;gap:14px;padding-top:20px">
   <div class="pes-result bad">
    <span style="color:var(--rd)">${ico("warn",42)}</span>
    <b>Pesquisa encerrada</b>
    <p class="pes-note" style="margin:0">A pergunta de atenção foi respondida de forma incorreta, então a pesquisa foi encerrada e <b>a recompensa não foi creditada</b>. Fique atento às perguntas isca na próxima!</p>
   </div>
   ${pesSponsor()}
   <button class="btn ghost" type="button" data-pes-exit style="width:100%">Fechar</button>
  </div>`;
 }else if(v.phase==="dup"){
  body.innerHTML=`<div style="max-width:560px;margin:0 auto;padding-top:20px">
   <div class="pes-result bad"><span style="color:var(--acx)">${ico("inbox",36)}</span><b>Vagas encerradas</b><p class="pes-note" style="margin:0">As vagas desta pesquisa acabaram ou você já participou dela.</p></div>
   <button class="btn ghost" type="button" data-pes-exit style="width:100%;margin-top:14px">Fechar</button></div>`;
 }
}
async function pesAnswer(opt){
 const v=pesView;if(!v)return;
 const q=v.steps[v.idx];
 v.ans.push(opt);
 if(q&&q.trap===true&&((Number(q.correct)||0)!==opt)){
  v.phase="fail";pesRender();
  try{await setDoc(doc(db,"surveyAnswers",currentUser.uid+"_"+v.s.id),{uid:currentUser.uid,surveyId:v.s.id,reward:0,result:"fail",createdAt:serverTimestamp()})}catch(e){console.warn(e)}
  return;
 }
 const nx=pesNext(v);
 if(nx==="end"){
  const btnOk=await pesFinish(v);
  if(btnOk){v.phase="done"}else{v.phase="dup"}
  pesRender();
 }else{v.phase=nx;pesRender()}
}
async function pesTextGo(){
 const v=pesView;if(!v)return;
 const q=v.steps[v.idx]||{};
 const mn=Math.max(0,Math.floor(Number(q.minChars)||0)),mx=Math.max(20,Math.floor(Number(q.maxChars)||300));
 const txt=String($("pes-txt")?.value||"").trim();
 if(txt.length<mn)return toast("Escreva pelo menos "+mn+" caracteres para continuar.");
 if(txt.length>mx)return toast("Limite de "+mx+" caracteres excedido.");
 v.ans.push(txt.slice(0,mx));
 const nx=pesNext(v);
 if(nx==="end"){
  const btnOk=await pesFinish(v);
  if(btnOk){v.phase="done"}else{v.phase="dup"}
  pesRender();
 }else{v.phase=nx;pesRender()}
}
function pesDirOpen(){
 const v=pesView;if(!v)return;
 const d=v.steps[v.idx]||{};
 if(!validUrl(d.url))return toast("Este link está indisponível. Tente novamente mais tarde.");
 window.open(d.url,"_blank","noopener");
 v.dirOpened=true;v.dirReady=false;pesRender();
 let left=5;
 const tick=()=>{
  left--;
  v.dirReady=left<=0;
  try{if(v.phase==="direct")pesRender()}catch(e){}
 };
 const t1=setInterval(tick,1000);
 setTimeout(()=>{clearInterval(t1);v.dirReady=true;try{if(v.phase==="direct")pesRender()}catch(e){}},5200);
 document.addEventListener("visibilitychange",function once(){
  if(document.visibilityState==="visible"){clearInterval(t1);v.dirReady=true;document.removeEventListener("visibilitychange",once);try{if(v.phase==="direct")pesRender()}catch(e){}}
 });
}
function pesDirGo(){
 const v=pesView;if(!v)return;
 if(!v.dirReady)return;
 const nx=pesNext(v);
 if(nx==="end"){
  (async()=>{
   const btnOk=await pesFinish(v);
   if(btnOk){v.phase="done"}else{v.phase="dup"}
   pesRender();
  })();
 }else{v.phase=nx;pesRender()}
}
function pesBanGo(){
 const v=pesView;if(!v)return;
 const nx=pesNext(v);
 if(nx==="end"){
  (async()=>{
   const btnOk=await pesFinish(v);
   if(btnOk){v.phase="done"}else{v.phase="dup"}
   pesRender();
  })();
 }else{v.phase=nx;pesRender()}
}
async function pesFinish(v){
 const ref=doc(db,"surveyAnswers",currentUser.uid+"_"+v.s.id);
 try{
  const extra=await runTransaction(db,async tx=>{
   const ex=await tx.get(ref);
   if(ex.exists())throw new Error("Você já participou desta pesquisa.");
   const ss=await tx.get(doc(db,"surveys",v.s.id));
   if(!ss.exists())throw new Error("Esta pesquisa não está mais disponível.");
   const sd=ss.data();
   if(sd.status!=="approved")throw new Error("Esta pesquisa não está mais disponível.");
   const slots=Math.floor(Number(sd.slots)||0),resp=Math.floor(Number(sd.responses)||0);
   if(slots&&resp>=slots)throw new Error("As vagas desta pesquisa acabaram.");
   const base=Math.max(0,Math.floor(Number(sd.reward)||0));
   const pct=Math.min(500,buffPct("rewardBoost"));
   const bonus=pct?Math.ceil(base*pct/100):0;
   const rd=base+bonus;
   tx.set(ref,{uid:currentUser.uid,surveyId:v.s.id,reward:rd,base,bonus,pct,result:"done",answers:v.ans||[],createdAt:serverTimestamp()});
   tx.set(doc(db,"surveys",v.s.id),{responses:increment(1),updatedAt:serverTimestamp()},{merge:true});
   if(rd>0){
    tx.set(doc(db,"wallets",currentUser.uid),{common:increment(rd),updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"survey_reward",amount:rd,ticketType:"common",reason:"Pesquisa paga: "+String(sd.title||"").slice(0,60)+(bonus?" (inclui +"+pct+"% do buff)":""),createdAt:serverTimestamp()});
   }
   return rd;
  });
  v.paid=extra;
  return true;
 }catch(e){
  toast(String(e?.message||e));
  return false;
 }
}
/* ── CRIAR PESQUISA PAGA (formato da aba Anunciar) · roteiro com valor automático ── */
function pesNewOpen(){
 pesDraft={title:"",desc:"",cat:"saude",slots:20,steps:[{kind:"question",type:"choice",text:"",opts:["",""],trap:false,correct:0}]};
 $("pescgaveta").classList.add("open");$("pescv").classList.add("open");syncGavLock();
 pesNewRender();
}
function pesNewClose(){$("pescgaveta").classList.remove("open");$("pescv").classList.remove("open");syncGavLock();pesDraft=null}
function pesNewCost(){return pesNewValue()*Math.max(0,Math.floor(Number(pesDraft?.slots)||0))}
function pesNewValue(){return pesDraft?pesAutoValue(pesDraft.steps||[]):0}
function pesNewRender(){
 const d=pesDraft;if(!d)return;
 const cost=pesNewCost(),val=pesNewValue();
 const bal=Math.max(0,Math.floor(Number(wallet?.common)||0));
 const nq=(d.steps||[]).filter(x=>x.kind==="question").length;
 const nBan=(d.steps||[]).filter(x=>x.kind==="banner").length;
 const nDir=(d.steps||[]).filter(x=>x.kind==="direct").length;
 $("pesc-body").innerHTML=`<div style="max-width:640px;margin:0 auto;display:grid;gap:12px;padding-top:6px">
  <div class="ap-hero"><div class="ap-hero-top"><b style="font-size:15px;display:flex;align-items:center;gap:8px">${ico("flask",18)} Pesquisa paga</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Monte uma pesquisa em passos. A comunidade responde <b>voluntariamente</b> e você paga <b>valor × vagas</b> em reais — debitado na hora, com aprovação da equipe. <b>O valor por resposta cresce automaticamente</b> conforme a pesquisa fica maior: perguntas, opções, perguntas escritas, blocos de anúncio e links diretos somam pontos.</p></div>
  <div class="ap-hero-grid">
   <div class="ap-kpi"><span>Valor por resposta</span><b class="gold">${val} <i class=yi data-i=ticket></i></b></div>
   <div class="ap-kpi"><span>Custo total</span><b class="${bal>=cost?"green":"red"}">${cost} <i class=yi data-i=ticket></i></b></div>
   <div class="ap-kpi"><span>Vagas</span><b>${Math.max(0,Math.floor(Number(d.slots)||0))}</b></div>
   <div class="ap-kpi"><span>Roteiro</span><b>${nq}Q${nBan?" · "+nBan+"banner":""}${nDir?" · "+nDir+"link":""}</b></div>
  </div></div>
  <div class="ap-sec">1 · Sobre a pesquisa</div>
  <div class="field"><label class="label">Título (mín. 3 letras)</label><input id="pesn-title" maxlength="80" value="${esc(d.title)}" placeholder="Ex.: Hábitos de compra de suplementos"></div>
  <div class="field"><label class="label">Descrição (o que o participante vai responder)</label><textarea id="pesn-desc" maxlength="300">${esc(d.desc)}</textarea></div>
  <div class="field"><label class="label">Categoria (pré-definida)</label><select id="pesn-cat">${PESCATS.map(c=>`<option value="${c.id}" ${d.cat===c.id?"selected":""}>${esc(c.n)}</option>`).join("")}</select></div>
  <div class="adc-grid2">
   <div class="field"><label class="label">Vagas / respostas (1 a 500)</label><input id="pesn-slots" type="number" min="1" max="500" step="1" value="${Math.max(1,Math.floor(Number(d.slots)||1))}"></div>
   <div class="field"><label class="label">Valor por resposta (automático)</label><input value="${fmtBRL(val)} (automático)" disabled></div>
  </div>
  <div class="ap-sec">2 · Roteiro da pesquisa</div>
  ${(d.steps||[]).map((st,i)=>{
   if(st.kind==="banner")return `<div class="pes-q">
    <div style="display:flex;align-items:center;gap:8px"><span class="pes-qnum">Etapa ${i+1} · bloco de anúncio</span><button class="btn ghost sm" type="button" data-pess-del="${i}" style="margin-left:auto"><i class=yi data-i=trash></i></button></div>
    <div class="field"><label class="label">Plataforma do banner</label><select id="pesn-bplat${i}">${["Adsterra","Monetag","Outra"].map(p=>`<option value="${p}" ${(st.platform||"Adsterra")===p?"selected":""}>${p}</option>`).join("")}</select></div>
    <div class="adc-grid2">
     <div class="field"><label class="label">Largura do bloco (px · 120–800)</label><input id="pesn-bw${i}" type="number" min="120" max="800" value="${Math.floor(Number(st.w)||300)}"></div>
     <div class="field"><label class="label">Altura do bloco (px · 60–800)</label><input id="pesn-bh${i}" type="number" min="60" max="800" value="${Math.floor(Number(st.h)||250)}"></div>
    </div>
    <div class="field"><label class="label">Código do anúncio (HTML/JS da plataforma — Adsterra, Monetag etc.)</label><textarea id="pesn-bcode${i}" style="font:12.5px var(--mono);min-height:90px" placeholder="Cole aqui o código do banner">${esc(st.code||"")}</textarea></div>
    <p class="hint" style="margin:0;font-size:11.5px">O banner aparece <b>dentro da pesquisa</b>, em janela isolada (sandbox), nas dimensões que você definir — ajuste para o formato do seu banner (300×250, 320×50, 728×90…).</p>
   </div>`;
   if(st.kind==="direct")return `<div class="pes-q">
    <div style="display:flex;align-items:center;gap:8px"><span class="pes-qnum">Etapa ${i+1} · link direto</span><button class="btn ghost sm" type="button" data-pess-del="${i}" style="margin-left:auto"><i class=yi data-i=trash></i></button></div>
    <div class="field"><label class="label">URL (http/https)</label><input id="pesn-durl${i}" value="${esc(st.url||"")}" placeholder="https://…"></div>
    <div class="field"><label class="label">Rótulo do botão</label><input id="pesn-dlbl${i}" value="${esc(st.label||"")}" placeholder="Ex.: Conhecer a oferta"></div>
    <p class="hint" style="margin:0;font-size:11.5px">O participante é <b>avisado antes do redirecionamento</b>; o link abre em nova aba e ele precisa <b>voltar para a pesquisa</b> para terminar.</p>
   </div>`;
   const q=st;
   if(q.type==="text")return `<div class="pes-q">
    <div style="display:flex;align-items:center;gap:8px"><span class="pes-qnum">Etapa ${i+1} · pergunta escrita</span><button class="btn ghost sm" type="button" data-pess-del="${i}" style="margin-left:auto"><i class=yi data-i=trash></i></button></div>
    <textarea id="pesn-q${i}" maxlength="160" placeholder="Texto da pergunta">${esc(q.text||"")}</textarea>
    <div class="adc-grid2">
     <div class="field"><label class="label">Mínimo de caracteres</label><input id="pesn-mn${i}" type="number" min="0" max="1000" value="${Math.floor(Number(q.minChars)||10)}"></div>
     <div class="field"><label class="label">Máximo de caracteres (20–2000)</label><input id="pesn-mx${i}" type="number" min="20" max="2000" value="${Math.floor(Number(q.maxChars)||300)}"></div>
    </div>
   </div>`;
   return `<div class="pes-q">
    <div style="display:flex;align-items:center;gap:8px"><span class="pes-qnum">Etapa ${i+1} · pergunta de opções</span>${q.trap?'<span class="tag y"><i class=yi data-i=eye></i> isca</span>':""}<button class="btn ghost sm" type="button" data-pess-del="${i}" style="margin-left:auto"><i class=yi data-i=trash></i></button></div>
    <textarea id="pesn-q${i}" maxlength="160" placeholder="Texto da pergunta">${esc(q.text||"")}</textarea>
    <div style="display:grid;gap:6px">
     <span class="label" style="font-size:11px">Opções de resposta</span>
     ${(q.opts||[]).map((o,j)=>`<div style="display:flex;gap:6px;align-items:center">
      <span class="pes-l" style="width:26px;height:26px;border-radius:8px;background:var(--p);border:1px solid var(--l);display:grid;place-items:center;font:700 11.5px var(--mono);color:var(--acx)">${j+1}</span>
      <input id="pesn-qo${i}_${j}" maxlength="80" value="${esc(o)}" placeholder="Opção de resposta ${j+1}" style="flex:1;min-width:0">
      <button class="ib sm" type="button" data-peso-del="${i}:${j}" aria-label="Remover opção" style="flex:none"><i class=yi data-i=trash></i></button>
     </div>`).join("")}
     ${(q.opts||[]).length<6?`<button class="btn ghost sm" type="button" data-peso-add="${i}" style="justify-self:start"><i class=yi data-i=edit></i> + Adicionar opção de resposta</button>`:`<span class="hint" style="font-size:11px">Máximo de 6 opções por pergunta.</span>`}
    </div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
     <label style="display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--mu)"><input type="checkbox" id="pesn-qt${i}" ${q.trap?"checked":""} style="width:auto"> Pergunta isca (atenção)</label>
     ${q.trap?`<label style="display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--mu)">Opção correta <select id="pesn-qc${i}" style="width:auto">${(q.opts||[]).map((o,j)=>`<option value="${j}" ${j===Math.max(0,Math.floor(Number(q.correct)||0))?"selected":""}>${j+1} — ${esc(String(o).slice(0,24)||"(em branco)")}</option>`).join("")}</select></label>`:""}
    </div>
   </div>`;
  }).join("")}
  <div style="display:flex;gap:6px;flex-wrap:wrap">
   <button class="btn ghost sm" type="button" data-pess-addq>+ Pergunta de opções</button>
   <button class="btn ghost sm" type="button" data-pess-addt>+ Pergunta escrita</button>
   <button class="btn ghost sm" type="button" data-pess-addb>+ Bloco de anúncio</button>
   <button class="btn ghost sm" type="button" data-pess-addd>+ Link direto</button>
  </div>
  <div class="ap-sec">3 · Resumo e publicar</div>
  <div class="ap-row"><div class="r-metrics">
   <span class="ap-m">Saldo atual <b>${bal} <i class=yi data-i=ticket></i></b></span>
   <span class="ap-m">Valor/resposta <b class="gold" style="color:var(--acx)">${val} <i class=yi data-i=ticket></i></b></span>
   <span class="ap-m">Custo total <b class="${bal>=cost?"":"red"}">${cost} <i class=yi data-i=ticket></i></b></span>
   <span class="ap-m">Categoria <b>${esc(pesCat(d.cat).n)}</b></span>
  </div></div>
  <button class="btn" type="button" data-pesn-go style="width:100%">Publicar pesquisa (${fmtBRL(cost)})</button>
  <p class="ap-form-note" style="margin:0">${ico("pin",14)}<span>Ao publicar, o valor é debitado na hora e a pesquisa vai para <b>aprovação da equipe</b> — aprovada, aparece para todos. Pesquisas recusadas têm o valor devolvido.</span></p>
 </div>`;
}
async function pesNewCollect(){
 const d=pesDraft;if(!d)return null;
 d.title=$("pesn-title")?.value.trim()||"";
 d.desc=$("pesn-desc")?.value.trim()||"";
 d.cat=$("pesn-cat")?.value||"saude";
 d.slots=Math.max(1,Math.min(500,Math.floor(Number($("pesn-slots")?.value)||1)));
 d.steps=(d.steps||[]).map((st,i)=>{
  if(st.kind==="banner")return{...st,platform:$("pesn-bplat"+i)?.value||st.platform||"Adsterra",code:$("pesn-bcode"+i)?.value||st.code||"",w:Math.max(120,Math.min(800,Math.floor(Number($("pesn-bw"+i)?.value)||st.w||300))),h:Math.max(60,Math.min(800,Math.floor(Number($("pesn-bh"+i)?.value)||st.h||250)))};
  if(st.kind==="direct")return{...st,url:($("pesn-durl"+i)?.value||"").trim(),label:($("pesn-dlbl"+i)?.value||"").trim()||"Continuar"};
  const q={...st};
  q.text=($("pesn-q"+i)?.value||"").trim();
  if(q.type==="text"){
   q.minChars=Math.max(0,Math.min(1000,Math.floor(Number($("pesn-mn"+i)?.value)||10)));
   q.maxChars=Math.max(20,Math.min(2000,Math.floor(Number($("pesn-mx"+i)?.value)||300)));
  }else{
   q.opts=(q.opts||[]).map((_,j)=>($("pesn-qo"+i+"_"+j)?.value||"").trim()).filter(Boolean).slice(0,6);
   q.trap=!!$("pesn-qt"+i)?.checked;
   q.correct=Math.max(0,Math.floor(Number($("pesn-qc"+i)?.value)||0));
  }
  return q;
 });
 return d;
}
async function pesNewSubmit(){
 const d=await pesNewCollect();
 if(!d)return;
 if(d.title.length<3)return toast("Dê um título de pelo menos 3 letras à pesquisa.");
 const qs=d.steps.filter(s=>s.kind==="question");
 if(!qs.length)return toast("Adicione pelo menos 1 pergunta à pesquisa.");
 for(const q of qs){
  if((q.text||"").length<3)return toast("Toda pergunta precisa de texto (mín. 3 letras).");
  if(q.type!=="text"&&(q.opts||[]).length<2)return toast("Cada pergunta de opções precisa de pelo menos 2 opções de resposta.");
  if(q.type!=="text"&&q.trap&&(Number(q.correct)||0)>=(q.opts||[]).length)return toast("Pergunta isca: informe a opção correta.");
 }
 for(const b of d.steps.filter(s=>s.kind==="banner")){if(!String(b.code||"").trim())return toast("Preencha o código de todos os blocos de anúncio.")}
 for(const l of d.steps.filter(s=>s.kind==="direct")){if(!/^https?:\/\//i.test(l.url||""))return toast("Links diretos precisam de uma URL http(s) válida.")}
 const val=pesAutoValue(d.steps);
 const cost=val*Math.max(1,Math.floor(Number(d.slots)||1));
 const bal=Math.max(0,Math.floor(Number(wallet?.common)||0));
 if(bal<cost)return toast("Você tem "+fmtBRL(bal)+". Faltam "+fmtBRL(cost-bal)+" para publicar esta pesquisa.");
 if(!confirm('Publicar "'+d.title+'" por '+fmtBRL(cost)+' ('+d.slots+' vagas × '+fmtBRL(val)+' por resposta)? O valor é debitado na carteira agora.'))return;
 const btn=$("[data-pesn-go]");if(btn){btn.disabled=true;btn.textContent="Publicando…"}
 try{
  await runTransaction(db,async tx=>{
   const ws=await tx.get(doc(db,"wallets",currentUser.uid));
   const wd=ws.exists()?ws.data():{};
   const spend=spendValue(wd,cost);
   if(!spend)throw new Error("Saldo insuficiente. Conclua tarefas para ganhar mais.");
   tx.set(doc(collection(db,"surveys")),{
    uid:currentUser.uid,ownerName:maskName(profile?.name||""),
    title:d.title,desc:d.desc,cat:d.cat,reward:val,slots:d.slots,
    steps:d.steps,
    questions:d.steps.filter(s=>s.kind==="question").map(q=>({text:q.text,opts:q.type==="text"?[]:(q.opts||[]),trap:q.trap===true,correct:Number(q.correct)||0,type:q.type||"choice",minChars:Number(q.minChars)||0,maxChars:Number(q.maxChars)||300})),
    amount:cost,ticketType:"common",
    audience:"members",
    status:"pending",responses:0,createdAt:serverTimestamp()
   });
   tx.set(doc(db,"wallets",currentUser.uid),{...applySpend(wd,spend),updatedAt:serverTimestamp()},{merge:true});
   tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"survey_purchase",amount:cost,ticketType:"common",reason:"Pesquisa publicada: "+d.title.slice(0,60),createdAt:serverTimestamp()});
  });
  toast("<i class=yi data-i=flask></i> Pesquisa enviada! Ela aparece na aba Pesquisas assim que a equipe aprovar.");
  pesNewClose();
  adcTab="pesquisas";adcRender();
 }catch(e){showError(e)}
 finally{if(btn){btn.disabled=false;btn.textContent="Publicar pesquisa ("+fmtBRL(pesNewCost())+")"}}
}
const adcStatusTag=a=>{
 if(a.status==="pending")return'<span class="tag y"><i class=yi data-i=hourglass></i> Em aprovação</span>';
 if(a.status==="rejected")return'<span class="tag r">Rejeitada</span>';
 if(a.status==="paused")return'<span class="tag">Pausada</span>';
 if(a.expiresAt&&stampMs(a.expiresAt)<=Date.now())return'<span class="tag">Encerrada</span>';
 return'<span class="tag g">No ar</span>';
};
function adcHome(){
 const live=adcAds.filter(adcActive);
 const pool=live.reduce((s,a)=>s+Math.max(0,Math.floor(Number(a.amount)||0)),0);
 const cfg=adcAutoCfg();
 return `<div class="ap-hero">
   <div class="ap-hero-top">
    <b style="font-size:16px">Central de Anúncios Yshippcommerce</b>
    <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Anuncie para toda a comunidade, use ferramentas profissionais de monetização e fature com o programa de afiliados da casa. Cada real pago em anúncio alimenta o pool de prêmios dos sorteios do mês.</p>
   </div>
   <div class="ap-hero-grid">
    <div class="ap-kpi"><span>Pool do mês (prêmios)</span><b class="gold">${pool} <i class=yi data-i=ticket></i></b></div>
    <div class="ap-kpi"><span>Anúncios no ar</span><b>${live.length}</b></div>
    <div class="ap-kpi"><span>Rotação automática</span><b>${cfg.everyMin} min</b></div>
    <div class="ap-kpi"><span>Visualização</span><b>${cfg.viewSec}s</b></div>
   </div>
  </div>
  <div class="ap-benefits">
   <div class="ap-b"><em style="color:var(--acx)">${ico("megaphone",20)}</em><b>Anuncie</b><p>Banner, link patrocinado ou vídeo na rotação automática, visto por todos os membros.</p></div>
   <div class="ap-b"><em style="color:var(--acx)">${ico("toolbox",20)}</em><b>Ferramentas</b><p>Mini-cursos indicados pela administração para você monetizar links e conteúdo.</p></div>
   <div class="ap-b"><em style="color:var(--acx)">${ico("coins",20)}</em><b>Afiliados</b><p>Convida amigos, ganhe comissões e acompanhe seus resultados na aba Monetizar.</p></div>
  </div>
  <div class="ap-sec">Em rotação agora · ao vivo</div>
  ${live.length?live.slice(0,6).map(a=>{
   const imp=Number(a.impressions)||0,clk=Number(a.clicks)||0;
   const expMs=a.expiresAt?stampMs(a.expiresAt):0;
   const dur=ADUR[a.duration]?.ms||864e5;
   const pct=expMs?Math.max(0,Math.min(100,Math.round(100-((expMs-Date.now())/dur)*100))):0;
   return `<div class="ap-row">
    <div class="r-head">
     <span class="r-ico" style="color:var(--acx)">${icoFormat(a.type)}</span>
     <div class="r-title"><b>${esc(a.title||"Anúncio")}</b><small>${esc(a.advertiserName||"Anunciante")} · ${ADUR[a.duration]?.n||"24 horas"} · prioridade ${Math.min(10,Math.max(1,Math.floor(Number(a.weight)||1)))}</small></div>
    </div>
    <div class="r-metrics">
     <span class="ap-m">${ico("eye",13)} <b>${imp}</b> views</span>
     <span class="ap-m">${ico("pointer",13)} <b>${clk}</b> cliques</span>
     ${imp?`<span class="ap-m">${ico("target",13)} CTR <b>${((clk/imp)*100).toFixed(1)}%</b></span>`:""}
     <span class="ap-m">${ico("ticket",13)} <b>${Math.max(0,Math.floor(Number(a.amount)||0))}</b> no pool</span>
    </div>
    <div class="ap-bar"><i style="width:${pct}%"></i></div>
   </div>`;
  }).join(""):'<div class="ntv-empty" style="border-style:solid">Nenhum anúncio no ar neste momento. Seja o primeiro a anunciar!</div>'}
  ${live.length?`<div class="ap-sec">Desempenho da rotação</div>
  <div class="ap-row">
   <div class="r-metrics" style="justify-content:space-between"><span style="font-size:12px;font-weight:600">Views por anúncio</span><span class="ap-m">${ico("trend",13)} top ${Math.min(5,live.length)}</span></div>
   ${adcColsChart(live.slice(0,5).map(a=>Number(a.impressions)||0),live.slice(0,5).map(a=>String(a.title||"").slice(0,10)))}
  </div>
  <div class="ap-row">
   <div class="r-metrics" style="justify-content:space-between"><span style="font-size:12px;font-weight:600">Pool do mês por formato</span><span class="ap-m">${ico("ticket",13)} ${fmtBRL(pool)}</span></div>
   ${adcDonut([["banner","image","Banner"],["link","link","Link"],["video","video","Vídeo"]].map(([t,icn,n])=>({n:n+" "+(live.filter(a=>a.type===t).reduce((s,a)=>s+Math.max(0,Math.floor(Number(a.amount)||0)),0)),v:live.filter(a=>a.type===t).reduce((s,a)=>s+Math.max(0,Math.floor(Number(a.amount)||0)),0),c:t==="banner"?"#f0b90b":t==="link"?"#0ecb81":"#3861fb"})).filter(s=>s.v>0),String(pool),"REAIS")}
  </div>`:""}
  <div class="actions" style="margin:0">
   <button class="btn sm" data-adctab-go="anunciar"><i class=yi data-i=rocket></i> Criar anúncio agora</button>
   <button class="btn sm ghost" data-adctab-go="ferramentas"><i class=yi data-i=toolbox></i> Ver ferramentas</button>
   ${adLive()?'<button class="btn sm ghost" id="adc-reward"><i class=yi data-i=gift></i> Anúncio com recompensa ('+esc(String(settings.adReward||"+0"))+' reais)</button>':""}
  </div>`;
}
/* aba <i class=yi data-i=chart></i> Minhas: campanhas do membro com métricas e prazo ao vivo */
function adcMineTab(){
 const list=[...adcMine].sort((a,b)=>(stampMs(b.createdAt)||0)-(stampMs(a.createdAt)||0));
 const views=list.reduce((s,a)=>s+(Number(a.impressions)||0),0);
 const clicks=list.reduce((s,a)=>s+(Number(a.clicks)||0),0);
 const spent=list.reduce((s,a)=>s+Math.max(0,Math.floor(Number(a.amount)||0)),0);
 const total=list.filter(adcMineLive).length;
 return `<div class="ap-hero"><div class="ap-hero-top">
   <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><b style="font-size:15px"><i class=yi data-i=chart></i> Minhas campanhas</b>
   <button class="btn sm" data-adctab-go="anunciar" style="margin-left:auto">＋ Nova campanha</button></div>
   <p class="hint" style="margin:0;font-size:12.5px">Acompanhe views, cliques, CTR e o prazo de cada anúncio — tudo ao vivo, direto do Firestore.</p>
  </div>
  <div class="ap-hero-grid">
   <div class="ap-kpi"><span>Campanhas válidas</span><b class="${total?"green":""}">${total}</b></div>
   <div class="ap-kpi"><span>Views recebidos</span><b>${views}</b></div>
   <div class="ap-kpi"><span>Cliques</span><b>${clicks}</b></div>
   <div class="ap-kpi"><span>CTR médio</span><b class="${views?"green":""}">${views?((clicks/views)*100).toFixed(1)+"%":"—"}</b></div>
   <div class="ap-kpi"><span>Total investido</span><b class="gold">${spent} <i class=yi data-i=ticket></i></b></div>
  </div></div>
  ${list.length?list.map(a=>{
   const expMs=a.expiresAt?stampMs(a.expiresAt):0;
   const dur=ADUR[a.duration]?.ms||864e5;
   const pct=expMs?Math.max(0,Math.min(100,Math.round(100-((expMs-Date.now())/dur)*100))):0;
   const hrs=expMs?Math.floor((expMs-Date.now())/36e5):-1;
   const imp=Number(a.impressions)||0,clk=Number(a.clicks)||0;
   const war=hrs>=0&&hrs<12&&adcActive(a)?`<span class="ap-m" style="color:var(--rd)"><i class=yi data-i=hourglass></i> expira em ${hrs}h</span>`:"";
   return `<div class="ap-row">
    <div class="r-head">
     <span class="r-ico">${ADPRICE[a.type]?.i||"<i class=yi data-i=megaphone></i>"}</span>
     <div class="r-title"><b>${esc(a.title||"Anúncio")}</b><small>${ADUR[a.duration]?.n||""} · criada ${a.createdAt?new Date(stampMs(a.createdAt)).toLocaleDateString("pt-BR"):"—"}</small></div>
     ${adcStatusTag(a)}
    </div>
    <div class="r-metrics">
     <span class="ap-m">${ico("eye",13)} <b>${imp}</b> views</span>
     <span class="ap-m">${ico("pointer",13)} <b>${clk}</b> cliques</span>
     ${imp?`<span class="ap-m">${ico("target",13)}  <b>${((clk/imp)*100).toFixed(1)}%</b></span>`:""}
     <span class="ap-m">${ico("ticket",13)} <b>${Math.max(0,Math.floor(Number(a.amount)||0))}</b> investidos</span>
     ${a.type==="encurtanet"?`<span class="ap-m">Reservado <b>${Math.floor(Number(a.budgetReserved)||0)}</b></span><span class="ap-m">Pago <b>${Math.floor(Number(a.budgetPaid)||0)}</b></span><span class="ap-m">Restante <b>${adcBudgetLeft(a)}</b></span>`:""}
     ${war}
    </div>
    ${a.type==="encurtanet"&&(a.status==="pending"||a.status==="changes")?`
    <div class="adc-code" style="margin-top:6px"><button class="btn sm ghost adc-copy" data-adccopy data-enccopy="${esc(a.destUrl||"")}">Copiar link de destino</button>${esc(a.destUrl||"—")}</div>
    <div class="field" style="margin-top:8px"><label class="label">Link encurtado (destino = link oficial acima)</label><input data-encshort="${esc(a.id)}" value="${esc(a.shortUrl||"")}" placeholder="https://encurtador.com/abc123"></div>
    <button class="btn sm" data-encshortsave="${esc(a.id)}">Salvar link encurtado</button>`:""}
    <div class="ap-bar"><i style="width:${pct}%;${hrs>=0&&hrs<12?"background:linear-gradient(90deg,var(--rd),#ff9aa8)":""}"></i></div>
   </div>`;
  }).join(""):'<div class="ntv-empty" style="border-style:solid">Você ainda não criou campanhas. Publique a primeira e apareça para toda a comunidade!</div>'}
  ${list.length?`<div class="ap-sec">Meu desempenho</div>
  <div class="ap-row">
   <div class="r-metrics" style="justify-content:space-between"><span style="font-size:12px;font-weight:600">Views por campanha</span><span class="ap-m">${ico("trend",13)} ao vivo</span></div>
   ${adcColsChart(list.slice(0,5).map(a=>Number(a.impressions)||0),list.slice(0,5).map(a=>String(a.title||"").slice(0,10)))}
  </div>`:""}
  <div class="adc-approval"><span class="a-ico">${ico("shield",18)}</span><div><b>Toda campanha passa por aprovação da equipe</b><p>Antes de entrar na rotação, a equipe revisa o conteúdo. O prazo conta a partir da publicação e você recebe notificação quando faltam menos de 12h para expirar.</p></div></div>`;
}
const ADCFEAT={banner:["Imagem em tela cheia na gaveta","Maior impacto visual","Ideal para lojas e artes"],link:["Card de destaque com botão","Clique direto no seu link","Mais barato de testar"],video:["Embed em iframe isolado","Roda HTML/script do host","Maior tempo de atenção"],
 youtube:["Player oficial do YouTube","Incorporação segura (nocookie)","Sem códigos arbitrários"],
 adsterra:["Seus banners Adsterra","Formatos oficiais com dimensões","Execução isolada em sandbox"],
 monetag:["Seus códigos Monetag","Configuração separada da Adsterra","Execução isolada em sandbox"],
 encurtanet:["Recompensa por conclusão","Orçamento reservado no ato","Validação na página oficial de destino"]};
function adcForm(){
 const bal=Math.max(0,Math.floor(Number(wallet?.common)||0));
 return `<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:15px;display:flex;align-items:center;gap:8px">${ico("megaphone",18)} Criar anúncio pago</b>
   <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Escolha o formato da campanha — cada formato abre uma <b>tela própria</b> com tudo o que você precisa. O custo sai da sua carteira em reais, a campanha passa por aprovação da equipe e entra na rotação automática vista por todos os membros.</p></div>
   <div class="ap-hero-grid">
    <div class="ap-kpi"><span>Saldo disponível</span><b class="gold">${bal} <i class=yi data-i=ticket></i></b></div>
    <div class="ap-kpi"><span>Campanhas no ar</span><b>${adcAds.filter(adcActive).length}</b></div>
    <div class="ap-kpi"><span>Suas campanhas</span><b>${adcMine.filter(a=>a.status!=="rejected").length}</b></div>
    <div class="ap-kpi"><span>Moeda do jogo</span><b>Real (R$)</b></div>
   </div></div>
  <div class="clv-claim">
   <div class="ap-sec">Escolha o formato do anúncio</div>
   <div class="adc-grid2">
    ${Object.entries(ADPRICE).map(([k,v])=>`<button class="ap-tcard" data-adcw-open="${k}" style="text-align:left">
     <div class="t-head"><span class="t-ico" style="color:var(--acx)">${icoFormat(k)}</span><div><b style="font-size:13.5px">${v.n}</b></div></div>
     ${(ADCFEAT[k]||[]).map(f=>`<p style="margin:0;font-size:11.5px;color:var(--mu)">✓ ${f}</p>`).join("")}
     <p style="margin:0;font-size:11.5px;color:var(--acx);font-weight:700">desde ${adcPriceOf(k,"h12")} <i class=yi data-i=ticket></i></p>
     <p style="margin:0;color:var(--acx);font-weight:600;font-size:12px">Abrir tela do formato →</p>
    </button>`).join("")}
   </div>
   <button type="button" class="ap-tcard" data-pesn-open style="margin-top:10px;width:100%;flex-direction:row;align-items:center;gap:10px;display:flex">
    <span class="t-ico" style="color:var(--g)">${ico("flask",20)}</span>
    <span style="flex:1;text-align:left"><b style="font-size:13.5px">Pesquisa paga</b><p style="margin:0;font-size:11.5px;color:var(--mu)">Perguntas com resposta em reais · perguntas isca · vagas</p></span>
    <span style="font:700 10px var(--mono);color:var(--g);white-space:nowrap">RECOMPENSA × VAGAS</span>
   </button>
   <div class="adc-approval"><span class="a-ico">${ico("shield",18)}</span><div><b>Toda campanha passa por aprovação da equipe</b><p>Antes de entrar na rotação, a equipe revisa o conteúdo. O prazo da campanha conta a partir da <b>publicação aprovada</b> e você recebe notificação quando faltam menos de 12h para expirar.</p></div></div>
  </div>`;
}
/* ── tela própria de criação por formato (banner / link / vídeo) ── */
/* estado da campanha EncurtaNet em criação (id gerado antes de publicar) */
let encDestReady="",encDraftId="";
const ADCWN={banner:"Banner de imagem",link:"Link patrocinado",video:"Vídeo / embed",youtube:"Anúncio de YouTube",adsterra:"Anúncio Adsterra",monetag:"Anúncio Monetag",encurtanet:"Campanha EncurtaNet"};
function adcWOpen(t){
 adcType=t;adcDur="h24";
 /* id do documento da campanha gerado antes de publicar — usado no link de destino oficial da EncurtaNet */
 encDraftId=doc(collection(db,"marketAds")).id;encDestReady="";
 $("adcn-title").textContent="Criar "+(ADCWN[t]||"anúncio").toLowerCase();
 adcWRender();
 $("adcngaveta").classList.add("open");$("adcnv").classList.add("open");syncGavLock();
}
function adcWClose(){$("adcngaveta").classList.remove("open");$("adcnv").classList.remove("open");syncGavLock()}
function adcWRender(){
 const b=$("adcn-body");if(!b)return;
 const bal=Math.max(0,Math.floor(Number(wallet?.common)||0));
 const price=adcPriceOf(adcType,adcDur);
 b.innerHTML=`<div style="max-width:680px;margin:0 auto;display:grid;gap:14px;padding-top:6px">
  <div class="ap-hero"><div class="ap-hero-top"><b style="font-size:15px;display:flex;align-items:center;gap:8px">${icoFormat(adcType)} ${ADCWN[adcType]||""}</b>
   <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">${(ADCFEAT[adcType]||[]).map(f=>"<b>✓</b> "+esc(f)).join(" · ")} — monte a campanha abaixo e publique.</p></div>
   <div class="ap-hero-grid">
    <div class="ap-kpi"><span>Duração</span><b>${ADUR[adcDur]?.n||""}</b></div>
    <div class="ap-kpi"><span>Investimento</span><b class="gold">${price} <i class=yi data-i=ticket></i></b></div>
    <div class="ap-kpi"><span>Saldo após</span><b class="${bal>=price?"green":"red"}">${Math.max(0,bal-price)} <i class=yi data-i=ticket></i></b></div>
    <div class="ap-kpi"><span>No pool de prêmios</span><b>${price} <i class=yi data-i=ticket></i></b></div>
   </div></div>
  <div class="clv-claim">
   <div class="ap-sec">1 · Duração da campanha</div>
   <div class="adc-price">
    ${Object.entries(ADUR).map(([k,v])=>`<button class="prc ${adcDur===k?"on":""}" data-adcdur="${k}"><b>${adcPriceOf(adcType,k)} <i class=yi data-i=ticket></i></b><small>${v.n}</small>${k==="h24"?'<small style="color:var(--acx);font-weight:700">POPULAR</small>':""}</button>`).join("")}
   </div>
   <div class="ap-sec">2 · Conteúdo</div>
   <div class="field"><label class="label">Título do anúncio (mín. 3 letras)</label><input id="adcf-title" maxlength="60" placeholder="Ex.: Promoção imperdível na minha loja"></div>
   <div class="field"><label class="label">Texto / descrição</label><textarea id="adcf-text" maxlength="300" placeholder="Fale o que você anuncia em 1 ou 2 frases…"></textarea></div>
   <div class="field"><label class="label">${(adcType==="youtube"||adcType==="banner"||adcType==="link"||adcType==="video")?"Link de destino (obrigatório)":"Link de destino (opcional nesta modalidade)"}</label><input id="adcf-link" placeholder="https://…"></div>
   ${adcType==="banner"?`
   <div class="field"><label class="label">Imagem do banner (URL, obrigatória)</label><input id="adcf-img" placeholder="https://…/banner.jpg"></div>
   <div class="field"><label class="label">Prévia do banner</label><div class="adc-prev" id="adcn-bprev" style="min-height:90px;display:grid;place-items:center;background:#fff;color:#555;font-size:12px">A prévia aparece aqui</div>
   <button class="btn sm ghost" id="adcn-bgo" style="justify-self:start">${ico("image",14)} Ver prévia da imagem</button>`:""}
   ${adcType==="video"?`
   <div class="field"><label class="label">Código do vídeo/embed (iframe, script ou HTML)</label><textarea id="adcf-embed" placeholder="Cole aqui o código de incorporação…"></textarea></div>
   <div class="field"><label class="label">Teste do embed</label><iframe class="adc-prev" id="adcn-tprev" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-same-origin" hidden></iframe>
   <button class="btn sm ghost" id="adcn-tgo" style="justify-self:start">${ico("video",14)} Testar código</button>`:""}
   ${adcType==="youtube"?`
   <div class="field"><label class="label">Link do vídeo no YouTube (obrigatório)</label><input id="adcf-yt" placeholder="https://www.youtube.com/watch?v=… ou https://youtu.be/…"></div>
   <div class="field"><label class="label">Prévia do vídeo (player oficial)</label>
    <div id="adcn-ytprev" class="adc-prev" style="display:grid;place-items:center;min-height:120px;background:#101419;color:var(--mu)">Cole o link para ver a prévia</div>
    <button class="btn sm ghost" id="adcn-ytgo" style="justify-self:start">${ico("video",14)} Ver prévia do vídeo</button>
    <span class="hint" style="margin-top:6px">Incorporação oficial do YouTube (youtube-nocookie). Iframes e scripts personalizados não são aceitos nesta modalidade — proteção contra execução de código arbitrário.</span></div>`:""}
   ${(adcType==="adsterra"||adcType==="monetag")?`
   <div class="field"><label class="label">Formato do anúncio (${adcType==="adsterra"?"Adsterra":"Monetag"})</label><select id="adcf-format">${Object.entries(ADFORMATS).map(([k,v])=>`<option value="${k}">${v.n}</option>`).join("")}</select></div>
   <div class="field"><label class="label">Código do anúncio (o que a ${adcType==="adsterra"?"Adsterra":"Monetag"} fornece)</label><textarea id="adcf-code" style="font:12px var(--mono);min-height:120px" placeholder="Cole aqui o código do banner…"></textarea>
    <span class="hint" style="margin-top:6px">O código roda em <b>iframe isolado (sandbox)</b>, sem acesso aos dados internos do YshippCommerce. O formato escolhido registra as dimensões da campanha.</span></div>
   <div class="field"><label class="label">Teste do código</label><iframe class="adc-prev" id="adcn-tprev" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-same-origin" hidden></iframe>
   <button class="btn sm ghost" id="adcn-tgo" style="justify-self:start">${ico("eye",14)} Testar código</button>`:""}
   ${adcType==="encurtanet"?`
   <div class="adc-approval" style="margin-top:0"><span class="a-ico">${ico("bulb",18)}</span><div><b>Como funciona a EncurtaNet</b><p><b>1.</b> Crie a campanha e receba o <b>link de destino oficial</b> do YshippCommerce.<br><b>2.</b> Use esse link como destino numa plataforma externa de encurtamento monetizado e cadastre o link encurtado aqui.<br><b>3.</b> O membro percorre o encurtador, chega à página oficial e recebe os reais prometidos — pagos pelo <b>orçamento reservado</b> desta campanha.</p></div></div>
   <div class="field"><label class="label">Recompensa por conclusão (em reais)</label><input id="adcf-rwd" type="number" min="1" step="1" value="20"></div>
   <div class="field"><label class="label">Máximo de participações recompensadas</label><input id="adcf-max" type="number" min="1" step="1" value="10"></div>
   <div class="field"><label class="label">Link de destino oficial desta campanha (use como destino no encurtador)</label>
    <div class="adc-code"><button class="btn sm ghost adc-copy" data-adccopy id="adcn-destcopy">Copiar</button><span id="adcn-desttxt">Gere o link de destino agora</span></div>
    <button class="btn sm ghost" id="adcn-destgen" style="justify-self:start">${ico("link",14)} Gerar link de destino agora</button>
    <span class="hint" style="margin-top:6px">Este link aponta para a página oficial de validação do YshippCommerce (encurtanet.html). Ele prova que o membro completou o percurso.</span></div>
   <div class="field"><label class="label">Link encurtado (cole depois de configurar o encurtador externo)</label><input id="adcf-short" placeholder="https://plataforma-encurtadora.com/abc123"></div>
   <div class="ap-row"><div class="r-metrics">
    <span class="ap-m">Recompensa <b><span id="adcn-rwdv">20</span> <i class=yi data-i=ticket></i>/participação</b></span>
    <span class="ap-m">Orçamento a reservar <b class="gold" style="color:var(--acx)"><span id="adcn-budv">200</span> <i class=yi data-i=ticket></i></b></span>
   </div></div>`:""}
   <div class="ap-sec">3 · Prioridade</div>
   <div class="field"><label class="label">Prioridade na rotação (1 a 10 — quanto maior, mais vezes aparece)</label><select id="adcf-weight"><option value="1" selected>1 — padrão (grátis)</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option><option value="9">9</option><option value="10">10 — máxima</option></select></div>
   <div class="ap-row"><div class="r-metrics">
    <span class="ap-m">Saldo atual <b>${bal} <i class=yi data-i=ticket></i></b></span>
    <span class="ap-m">Custo <b class="gold" style="color:var(--acx)">${price} <i class=yi data-i=ticket></i></b></span>
    <span class="ap-m">Válido por <b>${ADUR[adcDur]?.n||""}</b></span>
   </div></div>
   <button class="btn" id="adcf-go" style="width:100%">${adcType==="encurtanet"?"Publicar campanha (custo + orçamento reservado)":"Publicar anúncio ("+fmtBRL(price)+")"}</button>
   <div class="adc-approval"><span class="a-ico">${ico("shield",18)}</span><div><b>Toda campanha passa por aprovação da equipe</b><p>Ao publicar, o valor é debitado na hora e a campanha vai para revisão — aprovada, entra na rotação automática. Acompanhe views, cliques e status na aba <b><i class=yi data-i=chart></i> Minhas</b>. A equipe pode rejeitar anúncios inadequados ou pausar campanhas no ar (o valor não é devolvido — anuncie com responsabilidade).</p></div></div>
  </div>
 </div>`;
}
$("adcn-x").onclick=adcWClose;
$("adcn-body").addEventListener("click",e=>{
 const du=e.target.closest("[data-adcdur]");if(du){adcDur=du.dataset.adcdur;adcWRender();return}
 /* YouTube: prévia com incorporação oficial (nunca código arbitrário) */
 if(e.target.closest("#adcn-ytgo")){
  const vid=ytIdOf($("adcf-yt")?.value||"");
  if(!vid)return toast("Cole um link válido do YouTube (watch, youtu.be ou shorts).");
  $("adcn-ytprev").innerHTML=`<iframe width="100%" height="200" style="border:0;border-radius:8px" src="https://www.youtube-nocookie.com/embed/${esc(vid)}?rel=0" title="Prévia" allow="accelerometer;encrypted-media;picture-in-picture" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>`;
  return;
 }
 /* Adsterra/Monetag: teste do código isolado */
 if(e.target.closest("#adcn-tgo")&&adcType!=="video"){
  const code=$("adcf-code")?.value.trim()||"";
  if(!code)return toast("Cole o código do anúncio para testar.");
  const f=$("adcn-tprev");f.hidden=false;f.srcdoc=buildAdDoc(code);
  return;
 }
 /* EncurtaNet: gera o link de destino oficial desta campanha */
 if(e.target.closest("#adcn-destgen")){
  encDestReady=location.origin+location.pathname.replace(/[^/]*$/,"")+"encurtanet.html?c="+encDraftId;
  $("adcn-desttxt").textContent=encDestReady;
  return;
 }
 if(e.target.closest("#adcn-bgo")){
  const img=$("adcf-img")?.value.trim()||"";
  if(!validUrl(img))return toast("Informe a URL da imagem do banner.");
  $("adcn-bprev").innerHTML=`<img src="${esc(img)}" alt="Prévia do banner" style="max-width:100%;max-height:240px;object-fit:contain;display:block;margin:auto">`;
  return;
 }
 if(e.target.closest("#adcn-tgo")){
  const code=$("adcf-embed")?.value.trim()||"";
  if(!code)return toast("Cole um código para testar.");
  const f=$("adcn-tprev");f.hidden=false;f.srcdoc=buildAdDoc(code);
  return;
 }
 if(e.target.closest("#adcf-go"))return adcPublish();
});
/* EncurtaNet: recalcula o orçamento a reservar em tempo real */
$("adcn-body").addEventListener("input",e=>{
 if(adcType==="encurtanet"&&(e.target.id==="adcf-rwd"||e.target.id==="adcf-max")){
  const r=Math.max(1,Math.floor(Number($("adcf-rwd")?.value)||1)),m=Math.max(1,Math.floor(Number($("adcf-max")?.value)||1));
  if($("adcn-rwdv"))$("adcn-rwdv").textContent=r;
  if($("adcn-budv"))$("adcn-budv").textContent=r*m;
 }
});
let adcToolCat="";
function adcTools(){
 const tools=adcToolsOf();
 const cats=[...new Set(tools.map(t=>t.cat||"outro"))];
 const shown=adcToolCat&&cats.includes(adcToolCat)?adcToolCat:"";
 return `<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:15px;display:flex;align-items:center;gap:8px">${ico("toolbox",18)} Ferramentas de anúncio e monetização</b>
   <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Ferramentas <b>indicadas pela administração</b>: toque em qualquer uma para abrir o <b>mini-curso completo</b> em tela cheia. O botão "Abrir ferramenta" usa o link oficial de indicação da casa.</p></div>
   <div class="ap-hero-grid">
    <div class="ap-kpi"><span>Ferramentas</span><b>${tools.length}</b></div>
    <div class="ap-kpi"><span>Categorias</span><b>${cats.length}</b></div>
    <div class="ap-kpi"><span>Com mini-curso</span><b class="green">${tools.filter(t=>t.course&&String(t.course).trim()).length}</b></div>
   </div></div>
  ${tools.length?`
  <div class="ap-chips">${cats.map(c=>`<button class="hp-chip ${shown===c?"on":""}" data-adctoolcat="${esc(c)}">${esc(ADCCATN[c]||c)}</button>`).join("")}</div>
  <div class="adc-grid2">
   ${tools.map((t,i)=>{
    if(shown&&t.cat!==shown)return "";
    const clicks=Number(adcCenter?.toolClicks?.[t.id]||0);
    return `<div class="ap-tcard" data-adctoolopen="${i}">
     <div class="t-head"><span class="t-ico">${t.icon||""}</span>
      <div style="min-width:0"><span style="font:600 9px var(--mono);letter-spacing:.8px;text-transform:uppercase;color:var(--acx)">${esc(t.tag||ADCCATN[t.cat]||"ferramenta")}</span><b style="display:block">${esc(t.name)}</b></div>
     </div>
     <p style="margin:0;font-size:12px;color:var(--mu);line-height:1.55">${esc(t.desc||"")}</p>
     <div class="r-metrics">
      ${t.course&&String(t.course).trim()?`<span class="ap-m">${ico("check",13)} mini-curso completo</span>`:""}
      ${clicks?`<span class="ap-m">${ico("trend",13)} <b>${clicks}</b> aberturas</span>`:""}
      ${validUrl(t.ref)?`<span class="ap-m">${ico("link",13)} link da casa</span>`:""}
     </div>
     <p style="margin:0;color:var(--acx);font-weight:600;font-size:12px;position:relative">Abrir mini-curso →</p>
    </div>`;
   }).join("")}
  </div>`:(adcCenter?`<div class="ntv-empty" style="border-style:solid">A administração ainda não publicou ferramentas recomendadas. Volte em breve!</div>`:adcCenterErr?`<div class="clv-claim no" style="display:grid;gap:8px"><b style="font-size:14px"><i class=yi data-i=warn></i> Não conseguimos ler a Central de Anúncios (${esc(adcCenterErr)}).</b><p class="clv-note" style="margin:0">A configuração existe no servidor, mas a leitura foi negada (regras do Firestore). Verifique a coleção <b>settings</b> nas regras ou tente de novo:</p><button class="btn sm" data-adcretry="1"><i class=yi data-i=refresh></i> Tentar de novo</button></div>`:`<div class="ntv-empty" style="border-style:solid">Carregando ferramentas…</div>`)}
  <div class="clv-claim">
   <b style="font-size:13.5px"><i class=yi data-i=image></i> Gerador de banner HTML</b>
   <div class="adc-grid2">
    <div class="field"><label class="label">URL da imagem</label><input id="bimg" placeholder="https://…/banner.jpg"></div>
    <div class="field"><label class="label">Link de destino</label><input id="blink" placeholder="https://…"></div>
   </div>
   <button class="btn sm" id="bgen">Gerar código + prévia</button>
   <div id="bprev"></div>
  </div>
  <div class="clv-claim">
   <b style="font-size:13.5px"><i class=yi data-i=calc></i> Calculadora de ganhos</b>
   <div class="adc-grid2">
    <div class="field"><label class="label">Impressões/dia</label><input id="cimp" type="number" min="0" placeholder="1000"></div>
    <div class="field"><label class="label">CPM médio (US$)</label><input id="ccpm" type="number" step="0.1" min="0" placeholder="1.20"></div>
   </div>
   <div class="field"><label class="label">Dias</label><input id="cdays" type="number" min="1" placeholder="30"></div>
   <button class="btn sm" id="ccalc">Calcular</button>
   <div id="cres"></div>
  </div>
  <div class="clv-claim">
   <b style="font-size:13.5px"><i class=yi data-i=flask></i> Testador de código de anúncio</b>
   <p class="clv-note">Cole o código do seu anúncio e veja como ele renderiza isolado, igual à gaveta de exibição.</p>
   <textarea id="tcode" placeholder="<div>Seu HTML/script aqui…</div>"></textarea>
   <button class="btn sm" id="tgo" style="margin-top:8px">Testar visualização</button>
   <iframe class="adc-prev" id="tprev" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-same-origin" hidden></iframe>
  </div>`;
}
function adcMoney(){
 const uid=currentUser?.uid||"";
 const refLink=location.origin+location.pathname+"?ref="+encodeURIComponent(uid);
 const live=adcAds.filter(adcActive);
 const pool=live.reduce((s,a)=>s+Math.max(0,Math.floor(Number(a.amount)||0)),0);
 return `<div class="adc-hero"><b><i class=yi data-i=safe></i> Monetização Yshippcommerce</b><p>Programas da própria casa para o membro transformar presença em reais: afiliado, anúncios pagos e pool coletivo.</p></div>
  <div class="clv-claim">
   <b style="font-size:13.5px"><i class=yi data-i=handshake></i> Programa de afiliados</b>
   <p class="clv-note">Compartilhe seu link: quando alguém criar a conta pelo seu link, <b>você ganha +R$ 5,00</b> e a pessoa ganha <b>+R$ 5,00 de bônus extra</b> além das boas-vindas. Sem limite de indicações.</p>
   <div class="adc-code"><button class="btn sm ghost adc-copy" data-adccopy>Copiar</button>${esc(refLink)}</div>
   <div class="adc-mrow"><span>Contas indicadas por você:</span><b id="adc-refcount">…</b></div>
  </div>
  <div class="clv-claim">
   <b style="font-size:13.5px"><i class=yi data-i=megaphone></i> Anúncio pago = pool dos sorteios</b>
   <p class="clv-note">Cada real pago em anúncio vai direto para o pool que fortalece os prêmios dos sorteios do mês. Anunciar é patrocinar a comunidade — e aparecer para todo mundo.</p>
   <div class="adc-mrow"><span>Pool atual do mês:</span><b class="gold">${pool} <i class=yi data-i=ticket></i></b></div>
  </div>
  <div class="clv-claim">
   <b style="font-size:13.5px"><i class=yi data-i=ticket></i> Tabela de preços de anúncio</b>
   <div class="adc-price" style="margin-top:8px">
    ${Object.entries(ADPRICE).map(([k,v])=>`<div class="prc on"><b>${v.n.split(" ")[0]}</b><small>${adcPriceOf(k,"h12")} / ${adcPriceOf(k,"h24")} / ${adcPriceOf(k,"d7")}</small><small>12h / 24h / 7d</small></div>`).join("")}
   </div>
   <p class="clv-note">Preços definidos pela administração no painel — atualizam na hora.</p>
  </div>`;
}
/* delegação dos cliques da central de anúncios */
$("adc-x").onclick=adcClose;
if($("adc-main-open"))$("adc-main-open").onclick=()=>adcOpen();
if($("pes-main-open"))$("pes-main-open").onclick=pesCenterOpen;
/* expõe as centrais para os cards do resumo (data-anun / data-pesq) */
try{window.adcOpen=adcOpen;window.pesCenterOpen=pesCenterOpen}catch(e){}
document.addEventListener("click",e=>{
 if(e.target.closest("[data-anun]")){e.preventDefault();adcOpen();return}
 if(e.target.closest("[data-pesq]")){e.preventDefault();pesCenterOpen();return}
 if(e.target.closest("[data-cofire]")){e.preventDefault();try{openSheet("cofire")}catch(err){}return}
 if(e.target.closest("[data-ogopen]")){e.preventDefault();openOg();return}
});
/* teclado: Enter/Espaço nos cards do resumo */
document.addEventListener("keydown",e=>{
 if(e.key!=="Enter"&&e.key!==" ")return;
 const c=e.target.closest?.("[data-anun],[data-pesq]");if(!c)return;
 e.preventDefault();
 if(c.dataset.anun)adcOpen();else pesCenterOpen();
});
$("pescm-x").onclick=pesCenterClose;
$("pescm-tabs").addEventListener("click",e=>{const b=e.target.closest("[data-pestab]");if(b){pesTab=b.dataset.pestab;pesCenterRender()}});
$("adc-tabs").addEventListener("click",e=>{const b=e.target.closest("[data-adctab]");if(b){adcTab=b.dataset.adctab;adcRender()}});
/* EncurtaNet: anunciante cadastra o link encurtado depois de configurar o encurtador externo */
$("adc-body").addEventListener("click",async e=>{
 const sv=e.target.closest("[data-encshortsave]");
 if(!sv)return;
 const id=sv.dataset.encshortsave;
 const v=(document.querySelector('[data-encshort="'+CSS.escape(id)+'"]')?.value||"").trim();
 if(!v)return toast("Cole o link encurtado gerado pela plataforma externa.");
 if(!validUrl(v))return toast("O link encurtado deve começar com https://.");
 sv.disabled=true;
 try{
  await updateDoc(doc(db,"marketAds",id),{shortUrl:v,shortUpdatedAt:serverTimestamp()});
  toast("<i class=yi data-i=link></i> Link encurtado salvo! Assim que a equipe aprovar, a campanha entra no ar.");
  adcRender();
 }catch(err){showError(err)}
 finally{sv.disabled=false}
});
$("adc-body").addEventListener("click",async e=>{
 const tl=e.target.closest("[data-adctoolopen]");
 const tc=e.target.closest("[data-adctoolcat]");
 if(tc){const c=tc.dataset.adctoolcat;adcToolCat=adcToolCat===c?"":c;adcRender();return}
 const rt=e.target.closest("[data-adcretry]");
 if(rt){
  adcCenterErr=null;adcRender();
  getDoc(doc(db,"settings","adsCenter")).then(s=>{adcCenter=s.exists()?s.data():null;adcRender()})
  .catch(er=>{adcCenterErr=(er&&er.code)||"erro";adcRender()});
  return;
 }
 if(tl){const tools=adcToolsOf();const t=tools[Number(tl.dataset.adctoolopen)];if(t)adcToolOpen(t);return}
 const go=e.target.closest("[data-adctab-go]");
 if(go){adcTab=go.dataset.adctabGo;adcRender();return}
 if(e.target.closest("#adc-reward")){adcClose();return openAdDrawer()}
 const cp=e.target.closest("[data-adccopy]");
 if(cp){
  /* link de destino explícito (EncurtaNet) copia só a URL; nos blocos de código,
     copia o texto do bloco SEM o rótulo do próprio botão "Copiar" */
  const enc=cp.getAttribute("data-enccopy");
  if(enc){copyText(enc);return}
  const box=cp.parentElement.cloneNode(true);
  box.querySelectorAll("[data-adccopy]").forEach(b=>b.remove());
  copyText(box.textContent.trim());
  return;
 }
 const ty=e.target.closest("[data-adcty]");if(ty){adcType=ty.dataset.adcty;return adcRender()}
 const du=e.target.closest("[data-adcdur]");if(du){adcDur=du.dataset.adcdur;return adcRender()}
 if(e.target.closest("#bgen")){
  const img=$("bimg").value.trim(),ln=$("blink").value.trim();
  if(!validUrl(img))return toast("Informe a URL da imagem do banner.");
  const code=`<a href="${esc(validUrl(ln)?ln:"#")}" target="_blank" rel="noopener sponsored"><img src="${esc(img)}" alt="Banner patrocinado" style="width:100%;max-width:480px;border-radius:10px;display:block"></a>`;
  $("bprev").innerHTML=`<div class="adc-code" style="margin-top:10px"><button class="btn sm ghost adc-copy" data-adccopy>Copiar</button>${esc(code)}</div><img src="${esc(img)}" style="width:100%;max-width:480px;border-radius:10px;margin-top:8px" alt="Prévia">`;
  return;
 }
 if(e.target.closest("#ccalc")){
  const imp=Math.max(0,Number($("cimp").value)||0),cpm=Math.max(0,Number($("ccpm").value)||0),d=Math.max(1,Number($("cdays").value)||1);
  const usd=imp*cpm/1000*d;
  $("cres").innerHTML=`<div class="adc-mrow" style="margin-top:8px"><span>Ganho estimado em ${d} dia(s):</span><b class="gold">US$ ${usd.toFixed(2)}</b></div><p class="clv-note">Estimativa por CPM — valores reais variam com país e formato.</p>`;
  return;
 }
 if(e.target.closest("#tgo")){
  const code=$("tcode").value.trim();
  if(!code)return toast("Cole um código para testar.");
  const f=$("tprev");f.hidden=false;f.srcdoc=buildAdDoc(code);
  return;
 }
 if(e.target.closest("#adcf-go"))return adcPublish();
 if(e.target.closest("#adc-refcount"))return;
 if(adcTab==="monetizar"){
  const el=$("adc-refcount");
  if(el&&el.textContent==="…"&&currentUser){
   try{const n=await getCountFromServer(query(collection(db,"users"),where("referredBy","==",currentUser.uid)));el.textContent=String(n)}catch(err){el.textContent="0"}
  }
 }
});
async function adcPublish(){
 if(!currentUser?.emailVerified)return toast("Entre com uma conta verificada para anunciar.");
 if(!termsOk())return askTerms();
 if(!profileOk())return toast("Salve seus dados de perfil primeiro.");
 const title=$("adcf-title")?.value.trim()||"";
 const text=$("adcf-text")?.value.trim()||"";
 const link=$("adcf-link")?.value.trim()||"";
 const img=$("adcf-img")?.value.trim()||"";
 const embed=$("adcf-embed")?.value.trim()||"";
 if(title.length<3)return toast("Dê um título de pelo menos 3 letras ao anúncio.");
 const price=adcPriceOf(adcType,adcDur);
 /* validações e campos por modalidade */
 let videoId="",format="b468x60",code="",reward=0,maxComp=0,budget=0,shortUrl="";
 if(adcType==="youtube"){
  videoId=ytIdOf($("adcf-yt")?.value||"");
  if(!videoId)return toast("Cole um link válido do YouTube (watch, youtu.be ou shorts).");
  if(!validUrl(link))return toast("Informe um link de destino válido (https://…).");
 }else if(adcType==="adsterra"||adcType==="monetag"){
  code=$("adcf-code")?.value.trim()||"";
  format=$("adcf-format")?.value||"b468x60";
  if(!code)return toast("Cole o código do anúncio "+(adcType==="adsterra"?"Adsterra":"Monetag")+".");
 }else if(adcType==="encurtanet"){
  reward=Math.max(1,Math.floor(Number($("adcf-rwd")?.value)||0));
  maxComp=Math.max(1,Math.floor(Number($("adcf-max")?.value)||0));
  budget=reward*maxComp;
  if(!encDestReady){encDestReady=location.origin+location.pathname.replace(/[^/]*$/,"")+"encurtanet.html?c="+encDraftId}
  shortUrl=$("adcf-short")?.value.trim()||"";
  if(shortUrl&&!validUrl(shortUrl))return toast("O link encurtado deve começar com https://.");
 }else{
  if(!validUrl(link))return toast("Informe um link de destino válido (https://…).");
  if(adcType==="banner"&&!validUrl(img))return toast("Banners precisam de uma imagem válida (https://…).");
  if(adcType==="video"&&!embed)return toast("Cole o código do vídeo/embed para o formato Vídeo.");
 }
 /* EncurtaNet: custo = preço da campanha + orçamento de recompensas (reservado no ato) */
 const cost=price+(adcType==="encurtanet"?budget:0);
 const bal=Math.max(0,Math.floor(Number(wallet?.common)||0));
 if(bal<cost)return toast("Você tem "+fmtBRL(bal)+". Faltam "+fmtBRL(cost-bal)+" para esta campanha"+(adcType==="encurtanet"?" (custo + orçamento reservado)":"")+".");
 if(!confirm('Publicar "'+title+'" por '+ADUR[adcDur].n+'? Custo: '+fmtBRL(price)+(adcType==="encurtanet"?' + '+fmtBRL(budget)+' reservados para recompensas ('+maxComp+' participações × '+fmtBRL(reward)+')':'')+'. O valor é debitado na carteira agora.'))return;
 const btn=$("adcf-go");btn.disabled=true;btn.textContent="Publicando…";
 try{
  const uid=currentUser.uid;
  if(!encDraftId)encDraftId=doc(collection(db,"marketAds")).id;
  const ref=doc(db,"marketAds",encDraftId);
  await runTransaction(db,async tx=>{
   const ws=await tx.get(doc(db,"wallets",uid));
   const wd=ws.exists()?ws.data():{};
   const spend=spendValue(wd,cost);
   if(!spend)throw new Error("Saldo insuficiente. Conclua tarefas para ganhar mais.");
   tx.set(ref,{
    uid,advertiserName:maskName(profile?.name||""),type:adcType,duration:adcDur,
    title,text,linkUrl:link,imageUrl:adcType==="banner"?img:"",
    embed:adcType==="video"?embed:"",
    /* YouTube: só o ID do vídeo — incorporação oficial, sem código arbitrário */
    videoId:adcType==="youtube"?videoId:"",
    /* Adsterra/Monetag: registros independentes (platform) + formato/dimensões */
    platform:adcType==="adsterra"?"adsterra":adcType==="monetag"?"monetag":"",
    adCode:(adcType==="adsterra"||adcType==="monetag")?code:"",
    format:(adcType==="adsterra"||adcType==="monetag")?format:"",
    dims:(adcType==="adsterra"||adcType==="monetag")&&ADFORMATS[format]?{w:ADFORMATS[format].w,h:ADFORMATS[format].h}:{w:0,h:0},
    /* EncurtaNet: economia da campanha (recompensas custeadas pela reserva) */
    rewardPerCompletion:adcType==="encurtanet"?reward:0,
    maxCompletions:adcType==="encurtanet"?maxComp:0,
    budgetReserved:adcType==="encurtanet"?budget:0,
    budgetPaid:0,completions:0,
    destUrl:adcType==="encurtanet"?encDestReady:"",
    shortUrl:adcType==="encurtanet"?shortUrl:"",
    amount:price,ticketType:"common",status:"pending",
    weight:Math.min(10,Math.max(1,Math.floor(Number($("adcf-weight")?.value)||1))),
    impressions:0,clicks:0,
    createdAt:serverTimestamp(),
    expiresAt:new Date(Date.now()+ADUR[adcDur].ms)
   });
   tx.set(doc(db,"wallets",uid),{...applySpend(wd,spend),updatedAt:serverTimestamp()},{merge:true});
   tx.set(doc(collection(db,"wallets",uid,"history")),{kind:"ad_purchase",amount:cost,ticketType:"common",reason:"Anúncio publicado ("+adcType+"): "+title.slice(0,60)+(adcType==="encurtanet"?" — inclui "+fmtBRL(budget)+" reservados para recompensas":""),createdAt:serverTimestamp()});
  });
  toast(adcType==="encurtanet"
   ?"<i class=yi data-i=link></i> Campanha EncurtaNet criada! Copie o link de destino, configure o encurtador externo e cole o link encurtado na campanha (aba Minhas). A equipe aprova e ela entra no ar."
   :"<i class=yi data-i=megaphone></i> Anúncio enviado! Ele entra na rotação assim que a equipe aprovar. Acompanhe em <i class=yi data-i=home></i> Início → Minhas campanhas.");
  try{adcWClose()}catch(x){}
  adcTab="inicio";adcRender();
 }catch(e){showError(e)}
 finally{const b=$("adcf-go");if(b){b.disabled=false;b.textContent=adcType==="encurtanet"?"Publicar campanha (custo + orçamento reservado)":"Publicar anúncio ("+fmtBRL(price)+")"}}
}
/* ── ROTAÇÃO AUTOMÁTICA DE ANÚNCIOS PAGOS (gaveta obrigatória) ── */
let adcVwI=0,adcVwLeft=0;
const adcAutoLS=()=>{try{return JSON.parse(localStorage.getItem("yadcauto")||"{}")}catch(e){return{}}};
function adViewOpen(ad,cfg){
 $("adcv-brand").textContent=(ad.title||"Anúncio patrocinado").slice(0,60);
 const stage=$("adcv-stage");
 if(ad.type==="banner"&&validUrl(ad.imageUrl)){
  stage.innerHTML=`<a href="${esc(ad.linkUrl||"")}" target="_blank" rel="noopener sponsored" id="adcv-a" style="display:block;width:100%;height:100%"><img src="${esc(ad.imageUrl)}" alt="${esc(ad.title||"Banner patrocinado")}" style="width:100%;height:100%;object-fit:cover;min-height:200px"></a>`;
 }else if(ad.type==="youtube"&&ad.videoId){
  /* YouTube: somente a incorporação oficial — nenhum código do usuário é executado */
  stage.innerHTML=`<iframe width="100%" height="100%" style="border:0;min-height:220px" src="https://www.youtube-nocookie.com/embed/${esc(ad.videoId)}?rel=0" title="${esc(ad.title||"Vídeo patrocinado")}" allow="accelerometer;encrypted-media;picture-in-picture" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>`;
 }else if(ad.type==="adsterra"||ad.type==="monetag"){
  /* Adsterra/Monetag: código do anunciante roda em iframe isolado (origem opaca) */
  const f=document.createElement("iframe");
  f.setAttribute("sandbox","allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-same-origin");
  f.style.cssText="width:100%;height:100%;min-height:220px;border:0;background:#fff";
  f.srcdoc=buildAdDoc(String(ad.adCode||""));
  stage.innerHTML="";stage.appendChild(f);
 }else if(ad.type==="encurtanet"){
  const left=adcBudgetLeft(ad);
  stage.innerHTML=`<div style="padding:22px 16px;display:grid;gap:8px;justify-items:center;text-align:center;align-content:center;min-height:200px">
   <span class="tag y">ENCURTANET</span>
   <b style="font-size:17px">${esc(ad.title||"")}</b>
   <p style="color:var(--mu);font-size:13.5px;max-width:48ch;margin:0">${esc(ad.text||"Conclua o percurso do link e ganhe reais.")}</p>
   <b style="font:600 22px var(--mono);color:var(--acx)">+${Number(ad.rewardPerCompletion)||0} <i class=yi data-i=ticket></i></b>
   <span class="hint">${left>0?left+" recompensa(s) restante(s) nesta campanha":"Encerrando…"}</span></div>`;
 }else if(ad.embed||ad.code){
  const f=document.createElement("iframe");
  f.setAttribute("sandbox","allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-same-origin");
  f.style.cssText="width:100%;height:100%;min-height:220px;border:0;background:#fff";
  f.srcdoc=buildAdDoc(String(ad.embed||ad.code));
  stage.innerHTML="";stage.appendChild(f);
 }else{
  stage.innerHTML=`<div style="padding:24px 16px;display:grid;gap:8px;justify-items:center;text-align:center;align-content:center;min-height:200px"><b style="font-size:17px">${esc(ad.title||"")}</b><p style="color:var(--mu);font-size:13.5px;max-width:48ch;margin:0">${esc(ad.text||"")}</p></div>`;
 }
 const op=$("adcv-open");
 /* EncurtaNet: o botão abre o link encurtado externo; as outras modalidades abrem o link de destino */
 const dest=ad.type==="encurtanet"?ad.shortUrl:ad.linkUrl;
 op.hidden=!validUrl(dest);
 op.onclick=()=>{updateDoc(doc(db,"marketAds",ad.id),{clicks:increment(1)}).catch(()=>{});window.open(dest,"_blank","noopener")};
 $("adcv-x").disabled=true;
 const secs=$("adcv-secs");secs.classList.remove("ok");
 const bar=$("adcv-bar");bar.classList.remove("run");void bar.offsetWidth;bar.style.animationDuration=cfg.viewSec+"s";bar.classList.add("run");
 $("adcvw").classList.add("open");$("adcwv").classList.add("open");syncGavLock();
 try{localStorage.setItem("yadcauto",JSON.stringify({...adcAutoLS(),last:Date.now()}))}catch(e){}
 updateDoc(doc(db,"marketAds",ad.id),{impressions:increment(1)}).catch(()=>{});
 if(adcVwI)clearInterval(adcVwI);
 adcVwLeft=cfg.viewSec;
 secs.textContent=adcVwLeft+"s";
 adcVwI=setInterval(()=>{
  adcVwLeft--;
  if(adcVwLeft>0){secs.textContent=adcVwLeft+"s";return}
  clearInterval(adcVwI);adcVwI=0;
  secs.textContent="pronto ✓";secs.classList.add("ok");
  $("adcv-x").disabled=false;
 },1000);
}
function adcVwClose(){
 if($("adcv-x").disabled)return; /* visualização obrigatória em andamento */
 if(adcVwI){clearInterval(adcVwI);adcVwI=0}
 $("adcvw").classList.remove("open");$("adcwv").classList.remove("open");syncGavLock();
 $("adcv-stage").innerHTML="";
}
$("adcv-x").onclick=adcVwClose;
function adcAutoTick(){
 try{
  if(!currentUser?.emailVerified||!termsOk())return;
  if($("adcvw").classList.contains("open"))return;
  if(document.querySelector(".gaveta.open"))return;
  if(!($("sup-modal")?.hidden??true))return;
  const ae=document.activeElement;
  if(ae&&(ae.tagName==="INPUT"||ae.tagName==="TEXTAREA"||ae.isContentEditable))return;
  const st=adcAutoLS(),cfg=adcAutoCfg();
  if(Date.now()-(st.last||0)<cfg.everyMin*6e4)return;
  const pool=adcAds.filter(adcActive);
  if(!pool.length)return;
  /* sorteio ponderado pelo peso da campanha (1 a 10, padrão 1) */
  let tot=0;
  pool.forEach(p=>tot+=Math.min(10,Math.max(1,Math.floor(Number(p.weight)||1))));
  let r=Math.random()*tot,ad=pool[0];
  for(const p of pool){
   r-=Math.min(10,Math.max(1,Math.floor(Number(p.weight)||1)));
   if(r<=0){ad=p;break}
  }
  adViewOpen(ad,cfg);
 }catch(e){}
}
setInterval(adcAutoTick,20000);
onAuthStateChanged(auth,u=>{adcWatch(u?.uid)});
/* barra do topo + gaveta reagem ao estado de login */
onAuthStateChanged(auth,u=>{
 $("ldbar").hidden=!!u;
 if(u){closeLoginGaveta();renderLinks()}
});

/* ══════════════════════════════════════════════════════════════════
   YSHIPPCOMMERCE MARKET + YSHIPPWALLET + PAGAMENTOS PIX
   dinheiro real · mineração · buffs · conversão · criptomoedas
   ══════════════════════════════════════════════════════════════════ */

let econ=null,unEcon=null;
let storeItems=[],myOrders=[],myWds=[],unStore=null,unOrders=null,unWds=null;
let mktTab="packages",walTab="visao",convMode="b2c",payCtx=null,convMenuOpen=false;
let cryptoPrices={};
const CRYPTO_META={BTC:{n:"Bitcoin",id:"bitcoin",fp:350000},ETH:{n:"Ethereum",id:"ethereum",fp:12000},USDT:{n:"Tether",id:"tether",fp:5.20},BNB:{n:"BNB",id:"binancecoin",fp:3200},SOL:{n:"Solana",id:"solana",fp:600},XRP:{n:"XRP",id:"ripple",fp:3.2},ADA:{n:"Cardano",id:"cardano",fp:2.4},DOGE:{n:"Dogecoin",id:"dogecoin",fp:0.8},LTC:{n:"Litecoin",id:"litecoin",fp:400},MATIC:{n:"Polygon",id:"matic-network",fp:2.2}};
const brl=n=>"R$ "+(Math.round((Number(n)||0)*100)/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const numPt=n=>(Number(n)||0).toLocaleString("pt-BR");

unEcon=onSnapshot(doc(db,"settings","economy"),d=>{econ=d.exists()?d.data():{};const tp=econ.ticketPoints||{};CATS.forEach(k=>{const v=Number(tp[k]);VAL[k]=Number.isFinite(v)&&v>0?v:1});render();try{mktMainSync()}catch(e){}try{walMainSync()}catch(e){}try{if($("mktgaveta").classList.contains("open"))mktRender()}catch(e){}try{if($("walgaveta").classList.contains("open"))walRender()}catch(e){}},e=>console.warn("Economia:",e));

async function fetchCrypto(){
 try{
  const ids=Object.values(CRYPTO_META).map(m=>m.id).join(",");
  const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids="+ids+"&vs_currencies=brl");
  if(!r.ok)throw new Error("preço");
  const j=await r.json();
  const out={};
  for(const sym of Object.keys(CRYPTO_META)){const p=j[CRYPTO_META[sym].id]?.brl;if(p>0)out[sym]=p}
  if(Object.keys(out).length){cryptoPrices=out;try{if($("walgaveta").classList.contains("open"))walRender()}catch(e){}}
 }catch(e){/* mantém preços de referência (fallback) */}
}
fetchCrypto();
setInterval(fetchCrypto,5*60*1000);
const cryptoPrice=sym=>Number(cryptoPrices[sym])||CRYPTO_META[sym]?.fp||1;
/* true = cotação ao vivo carregada; false = exibindo preço de referência
   (fallback) — a UI marca os valores com "≈" para não confundir o usuário */
const cryptoLive=()=>Object.keys(cryptoPrices).length>0;

/* ── PIX: monta o "copia e cola" (payload EMV + CRC16) ── */
function pixCrc16(str){
 let crc=0xFFFF;
 for(let i=0;i<str.length;i++){
  crc^=str.charCodeAt(i)<<8;
  for(let j=0;j<8;j++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xFFFF:(crc<<1)&0xFFFF;
 }
 return crc.toString(16).toUpperCase().padStart(4,"0");
}
function pixPayload(key,name,city,amount,txid,desc){
 const f=(id,v)=>id+String(v.length).padStart(2,"0")+v;
 const clean=(s,n)=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9 ]/g,"").slice(0,n).trim().toUpperCase();
 let p="000201"+f("26",f("00","BR.GOV.BCB.PIX")+f("01",String(key).slice(0,77)));
 p+="5204000053039865802BR"+f("59",clean(name,25))+f("60",clean(city,15));
 if(amount>0)p+=f("54",Number(amount).toFixed(2));
 p+=f("62",f("05",clean(txid||"***",25))+(desc?f("08",clean(desc,40)):""));
 p+="6304";
 return p+pixCrc16(p);
}
function validPixKey(k){
 k=String(k||"").trim();
 return k.length>=4&&k.length<=77;
}

/* ── sincronização por usuário ── */
onAuthStateChanged(auth,u=>{
 unStore?.();unOrders?.();unWds?.();unStore=null;unOrders=null;unWds=null;
 storeItems=[];myOrders=[];myWds=[];
 if(u){
  unStore=onSnapshot(query(collection(db,"storeItems"),limit(200)),s=>{storeItems=s.docs.map(d=>({id:d.id,...d.data()}));try{mktRender()}catch(e){}try{mktMainSync()}catch(e){}mnFjSync()},e=>console.warn(e));
  unOrders=onSnapshot(query(collection(db,"orders"),where("uid","==",u.uid),limit(100)),s=>{myOrders=s.docs.map(d=>({id:d.id,...d.data()}));try{mktRender()}catch(e){}mnFjSync()},e=>console.warn(e));
  unWds=onSnapshot(query(collection(db,"withdrawals"),where("uid","==",u.uid),limit(100)),s=>{myWds=s.docs.map(d=>({id:d.id,...d.data()}));try{walRender()}catch(e){}},e=>console.warn(e));
 }
});

/* ── resumo na página principal ── */
function mktMainSync(){
 const pkg=$("mktm-pkg");if(!pkg)return;
 const cfg=econCfg();
 const on=storeItems.filter(x=>x.active!==false);
 pkg.textContent=String(on.filter(x=>x.section==="packages").length);
 $("mktm-mine").textContent=String(on.filter(x=>x.section==="mining").length);
 $("mktm-buff").textContent=String(on.filter(x=>x.section==="buffs").length);
 const mr=$("mktm-rate");if(mr)mr.textContent="1";
}

/* ── MARKET · gaveta ── */
function mktOpen(){if(!currentUser){toast("Entre na sua conta para comprar no Market.");return}$("mktgaveta").classList.add("open");$("mktv").classList.add("open");syncGavLock();mktRender()}
if($("mkt-top"))$("mkt-top").onclick=()=>mktOpen();
function mktClose(){$("mktgaveta").classList.remove("open");$("mktv").classList.remove("open");syncGavLock()}
$("mkt-x").onclick=mktClose;
$("nc-mkt").onclick=()=>{closeAcct();mktOpen()};
$("nc-wal").onclick=()=>{closeAcct();walOpen()};
$("mkt-main-open").onclick=mktOpen;$("wal-main-open").onclick=()=>walOpen();$("tb-wal").onclick=()=>walOpen();


const MKT_SECN={packages:"Pacotes de reais",fichas:"Pacotes de fichas",mining:"Mineração",buffs:"Buffs",recarga:"Recarga em reais",custom:"Itens avulsos"};
function mktRender(){
 const cfg=econCfg();
 const tabs=[["packages","ticket","Pacotes"],["mining","hammer","Mineração"],["buffs","bolt","Buffs"],["recarga","coins","Recargas"],["pedidos","note","Meus pedidos"]]
 .filter(([k])=>k!=="mining"||cfg.miningOn).filter(([k])=>k!=="buffs"||cfg.buffsOn);
 $("mkt-tabs").innerHTML=tabs.map(([k,ic,l])=>`<button class="${mktTab===k?"on":""}" data-mkttab="${k}">${ico(ic,17)}<span>${l}</span></button>`).join("");
 const b=$("mkt-body");const st=$("mkt-stats");st.innerHTML="";st.hidden=true;
 if(mktTab==="pedidos"){
  const pend=myOrders.filter(o=>o.status==="pending");
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:15px">${ico("note",18)} Meus pedidos</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Acompanhe seus pagamentos PIX. Assim que a administração confirmar o recebimento, o item é <b>creditado na sua carteira automaticamente</b>.</p></div>
  <div class="ap-hero-grid">
   <div class="ap-kpi"><span>Pedidos</span><b>${myOrders.length}</b></div>
   <div class="ap-kpi"><span>Aguardando PIX</span><b class="${pend.length?"gold":""}">${pend.length}</b></div>
   <div class="ap-kpi"><span>Creditados</span><b class="green">${myOrders.filter(o=>o.status==="paid").length}</b></div>
   <div class="ap-kpi"><span>Total pago</span><b>${brl(myOrders.filter(o=>o.status==="paid").reduce((s,o)=>s+(Number(o.amountBrl)||0),0))}</b></div>
  </div></div>
  <div style="display:grid;gap:10px;margin-top:14px">${myOrders.length?myOrders.map(o=>`<div class="ap-row"><div class="r-head"><span class="r-ico">${ico(o.section==="mining"?"hammer":o.section==="buffs"?"bolt":o.section==="recarga"?"coins":"ticket",16)}</span><div class="r-title"><b>${esc(o.item?.name||"Item")}</b><small>${esc(MKT_SECN[o.section]||"")} · ${o.createdAt?fmt(o.createdAt):""}</small></div></div>
  <div class="r-metrics"><span class="ap-m">${brl(o.amountBrl)}</span>${o.status==="pending"?'<span class="ap-m" style="color:var(--acx)">Aguardando confirmação</span>':o.status==="paid"?'<span class="ap-m" style="color:var(--g)">Pago e creditado</span>':'<span class="ap-m">Cancelado</span>'}</div></div>`).join(""):'<div class="ap-row"><p class="hint" style="margin:0">Você ainda não fez pedidos no Market.</p></div>'}</div>`;
  return;
 }
 const sec=mktTab;
 const list=storeItems.filter(x=>x.section===sec&&x.active!==false).sort((a,b2)=>(Number(a.sortOrder)||0)-(Number(b2.sortOrder)||0));
 const descs={
  packages:x=>`${fmtBRL(x.amount)}${x.goldBonus?` + <b>${fmtBRL(x.goldBonus)}</b> de brinde`:""}`,
  mining:x=>`Mina até <b>${fmtBRL(x.yieldPerMonth)}/mês</b> por ${x.durationDays} dias`,
  buffs:x=>`+${x.effect?.pct||0}% em ${(BUFF_META[x.effect?.type]||["recompensas"])[0].toLowerCase()} · ${x.durationDays} dias`,
  recarga:x=>`<b>${brl(x.brlAmount)}</b> de saldo em reais na carteira`,
  custom:x=>esc(x.desc||"")
 };
 b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:15px">${ico("cart",18)} ${esc(MKT_SECN[sec]||"Market")}</b>
 <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">${sec==="packages"?"Pacotes de reais direto na carteira — crédito imediato. E também os <b>pacotes de fichas</b> (Moedas Yshipp, Bilhetes e Diamantes) logo abaixo, com cotação fixa: 10 moedas = R$ 0,01 · 1 bilhete = R$ 0,50 · 1 diamante = R$ 1,00.":sec==="mining"?"Assine um plano e <b>mine reais</b> todo mês: o plano rende no ritmo do poder de processamento contratado e você coleta quando quiser na carteira.":sec==="buffs"?"Buffs temporários que turbinam suas recompensas de pesquisas e o rendimento da mineração enquanto duram.":sec==="recarga"?"Adicione saldo em reais para usar na conversão, criptomoedas e saques PIX.":"Itens escolhidos pela administração."} Pagamento por <b>PIX QR Code</b>.</p></div></div>
 ${sec==="packages"?XCPACKS_HTML():""}
 <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-top:14px">
 ${list.length?list.map(x=>{
  const price=Math.max(0,Number(x.priceBrl)||0);
  let extra="";
  if(sec==="packages"){
   const qts=Number(x.amount)||0;
   const bonus=Number(x.goldBonus)||0;
   extra=`<span class="ap-m" style="font-size:11px">Crédito direto na carteira${bonus?" · +"+fmtBRL(bonus)+" de brinde":""}</span>`;
  }else if(sec==="mining"){
   const y=Number(x.yieldPerMonth)||0,d=Number(x.durationDays)||30;
   extra=`<span class="ap-m" style="font-size:11px">Rende até ${fmtBRL(y)}/mês · ≈ ${fmtBRL(Math.ceil(y/30))} por dia · validade de ${d} dias</span>`;
  }else if(sec==="buffs"){
   const d=Number(x.durationDays)||0;
   extra=`<span class="ap-m" style="font-size:11px">Efeito ativo por ${d} dias · a partir da compra</span>`;
  }else if(sec==="recarga"){
   extra=`<span class="ap-m" style="font-size:11px">Vira saldo em reais na carteira · use em conversões, cripto e saques PIX</span>`;
  }
  return `<button type="button" class="ap-tcard" data-buy="${esc(x.id)}">
  <div class="t-head"><span class="t-ico">${ico(x.icon||"cart",17)}</span><b>${esc(x.name)}</b></div>
  ${x.badge?`<span class="pes-chip" style="background:var(--as);color:var(--acx);justify-self:start">${esc(x.badge)}</span>`:""}
  <p class="hint" style="margin:0;font-size:12px;line-height:1.5">${esc(x.desc||"")}</p>
  <span class="hint" style="font-size:11.5px">${descs[sec]?descs[sec](x):""}</span>
  ${extra?`<span style="display:grid;gap:3px;padding:7px 9px;background:var(--p2);border:1px solid var(--l);border-radius:8px;justify-items:start">${extra}<span class="ap-m" style="font-size:11px"><i class=yi data-i=checkc style="width:12px;height:12px"></i> Crédito automático na carteira após a confirmação do PIX</span></span>`:""}
  <b class="mono" style="font-size:17px;color:var(--acx)">${brl(x.priceBrl)}</b>
  <span class="hint" style="font-size:10.5px">PIX · confirmação da administração</span>
 </button>`}).join(""):'<div class="ap-row"><p class="hint" style="margin:0">Nada à venda neste setor agora.</p></div>'}
 </div>`;
}

/* ── TELA DE PAGAMENTO (PIX) ── */
function payOpen(item){
 payCtx={item};
 $("paygaveta").classList.add("open");$("payv").classList.add("open");syncGavLock();
 payRender();
}
function payClose(){$("paygaveta").classList.remove("open");$("payv").classList.remove("open");syncGavLock();payCtx=null;$("pay-body").innerHTML=""}
$("pay-x").onclick=payClose;
function payRender(){
 const cfg=econCfg();
 const item=payCtx?.item;if(!item){payClose();return}
 $("pay-name").textContent="Pagamento · "+(item.name||"Item");
 const amount=Number(item.priceBrl)||0;
 const okPix=validPixKey(cfg.pix.key)&&cfg.pix.name;
 const pend=myOrders.find(o=>o.status==="pending"&&o.itemId===item.id);
 const txid=("YM"+Date.now().toString(36)).slice(0,25).toUpperCase();
 let payload="";
 if(okPix)payload=pixPayload(cfg.pix.key,cfg.pix.name,cfg.pix.city,amount,txid,cfg.pix.desc);
 $("pay-body").innerHTML=`<div style="max-width:560px;margin:0 auto;display:grid;gap:14px;padding-top:8px">
  <div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${esc(item.name||"Item")}</b>
  <p class="hint" style="margin:0;font-size:13px">${esc(item.desc||"")}</p></div>
  <div class="ap-hero-grid">
   <div class="ap-kpi"><span>Valor</span><b class="gold">${brl(amount)}</b></div>
   <div class="ap-kpi"><span>Método</span><b>PIX</b></div>
   <div class="ap-kpi"><span>Crédito</span><b>automático</b></div>
   <div class="ap-kpi"><span>Situação</span><b>${pend?"aguardando":"novo pedido"}</b></div>
  </div></div>
  ${pend?`
  <div class="pes-result ok" style="text-align:left">
   <span style="color:var(--g)">${ico("checkc",20)}</span><b>Pedido em análise</b>
   <p class="pes-note" style="margin:0">Fizemos o pedido <b class="mono">#${esc(pend.id.slice(0,8))}</b> de ${brl(pend.amountBrl)} chegar para a administração. Assim que o PIX for confirmado na conta, o item entra na sua carteira na hora — normalmente em poucos minutos.</p>
  </div>`:`
  ${okPix?`
  <div class="ap-row" style="display:grid;justify-items:center;gap:10px">
   <span class="ap-sec" style="width:100%">Pague com PIX · QR Code</span>
   <div id="pay-qr" style="background:#fff;padding:12px;border-radius:12px;display:inline-block"></div>
   <p class="hint" style="margin:0;font-size:12.5px;text-align:center">Abra o app do seu banco → PIX → <b>Ler QR Code</b> ou use o <b>copia e cola</b> abaixo.</p>
  </div>
  <div class="ap-row" style="align-items:center;gap:8px">
   <span class="ap-code" style="flex:1">${esc(payload)}</span>
   <button class="btn sm ghost" type="button" data-pay-copy>Copiar</button>
  </div>
  <button class="btn" type="button" data-pay-paid style="width:100%">Já paguei · enviar para confirmação <i class=yi data-i=check></i></button>
  `:`
  <div class="pes-result bad" style="text-align:left"><span style="color:var(--rd)">${ico("warn",20)}</span><b>PIX temporariamente indisponível</b><p class="pes-note" style="margin:0">A administração ainda não configurou a chave PIX do Market. Volte em breve ou fale com o suporte.</p></div>
  `}
  <div class="ap-sec">Formas de pagamento</div>
  <div class="ap-row" style="flex-wrap:wrap;gap:7px;align-items:center">
   <span class="pmb pix"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4.6" y="4.6" width="14.8" height="14.8" rx="4" transform="rotate(45 12 12)"/></svg>PIX<span class="pmb-ok">✓ ativo</span></span>
   <span class="pmb pp off"><b>Pay</b><em>Pal</em></span>
   <span class="pmb visa off">VISA</span>
   <span class="pmb off"><span class="mc"><i></i><i></i></span>mastercard</span>
   <span class="pmb elo off">elo</span>
   <span class="pmb off"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5v14M7 5v14M10.5 5v14M14 5v14M16.5 5v14M20 5v14" stroke-dasharray="2 2.2"/></svg>boleto</span>
   <span class="pmb btc off"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.6"/><path d="M10 7.5v9M12.8 7.5v9M10 7.5h3.2a2.2 2.2 0 0 1 0 4.4H10M10 11.9h3.6a2.2 2.2 0 0 1 0 4.4H10"/></svg>cripto</span>
  </div>
  <p class="hint" style="font-size:11px;margin:0">Pagamento ativo: <b>PIX</b> com confirmação da administração. PayPal, cartão de crédito, boleto e cripto chegam em breve.</p>
  <button class="btn ghost" type="button" data-pay-cancel style="width:100%">Cancelar e voltar</button>`}
 </div>`;
 if(okPix&&!pend){
  try{
   $("pay-qr").innerHTML="";
   if(typeof QRCode!=="undefined")new QRCode($("pay-qr"),{text:payload,width:190,height:190,correctLevel:QRCode.CorrectLevel.M});
   else $("pay-qr").innerHTML='<p class="hint">Use o copia e cola abaixo.</p>';
  }catch(e){console.warn(e)}
 }
}

/* pedido: "já paguei" */
async function payConfirmPaid(){
 const item=payCtx?.item;if(!item||!currentUser)return;
 const amount=Number(item.priceBrl)||0;
 try{
  await setDoc(doc(collection(db,"orders")),{
   uid:currentUser.uid,userName:maskName(profile?.name||"Participante"),
   itemId:item.id,item:{name:item.name,desc:item.desc,ticketType:item.ticketType,amount:item.amount,goldBonus:item.goldBonus,yieldPerMonth:item.yieldPerMonth,durationDays:item.durationDays,brlAmount:item.brlAmount,effect:item.effect||null,xcKind:item.xcKind||"",xcQty:item.xcQty||0},
   section:item.section,amountBrl:amount,status:"pending",method:"pix",
   createdAt:serverTimestamp()
  });
  toast("Pedido enviado! A administração confirma seu PIX em instantes.");
  payClose();
 }catch(e){showError(e)}
}

/* ── YSHIPPWALLET · carteira completa em tela cheia ── */
function walOpen(){if(!currentUser){toast("Entre na sua conta para abrir a carteira.");return}$("walgaveta").classList.add("open");$("walv").classList.add("open");syncGavLock();walRender()}
function walClose(){$("walgaveta").classList.remove("open");$("walv").classList.remove("open");syncGavLock()}
$("wal-x").onclick=walClose;

const walCommon=()=>Math.max(0,Math.floor(Number(wallet?.common)||0));
const walGold=()=>Math.max(0,Math.floor(Number(wallet?.gold)||0));
const walVip=()=>Math.max(0,Math.floor(Number(wallet?.vip)||0));
const walBrl=()=>pointsOf(wallet);
const walCrypto=()=>wallet?.crypto&&typeof wallet.crypto==="object"?wallet.crypto:{};
const rate=()=>1;
const cryptoBrlValue=()=>Object.entries(walCrypto()).reduce((s,[sym,q])=>s+(Number(q)||0)*cryptoPrice(sym),0);
const buffList=()=>{
 const now=Date.now();
 return (Array.isArray(wallet?.buffs)?wallet.buffs:[]).map(b=>{
  const st=b.startsAt?stampMs(b.startsAt):0;
  const end=st+(Number(b.durDays)||7)*864e5;
  return {...b,active:end>now,msLeft:Math.max(0,end-now)};
 }).filter(b=>b.active);
};
function miningPlans(){
 const now=Date.now();
 return (Array.isArray(wallet?.miningPlans)?wallet.miningPlans:[]).map(p=>{
  const st=p.startsAt?stampMs(p.startsAt):0;
  const end=st+(Number(p.durDays)||30)*864e5;
  const lc=p.lastCollect?stampMs(p.lastCollect):st;
  const boost=1+Math.min(econCfg().maxMiningBuffPct,buffPct("miningBoost"))/100;
  const perMs=(Number(p.yieldPerMonth)||0)/(30*864e5);
  const pending=perMs*Math.max(0,Math.min(now,end)-lc)*boost;
  return {...p,active:end>now,msLeft:Math.max(0,end-now),pending:Math.floor(pending)};
 }).filter(p=>p.active);
}
function walRender(){
 const cfg=econCfg();
 const tabs=[["visao","home","Visão geral"],["reais","coins","Dinheiro (R$)"],["fichas","star","Fichas"],["cripto","coins","Criptomoedas"],["converter","refresh","Converter"],["sacar","send","Sacar"]];
 $("wal-tabs").innerHTML=tabs.map(([k,ic,l])=>`<button class="${walTab===k?"on":""}" data-waltab="${k}">${ico(ic,17)}<span>${l}</span></button>`).join("");
 {const cvb=$("wal-tabs").querySelector('[data-waltab="converter"] svg');if(cvb)cvb.outerHTML='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h12M4 7l3-3M4 7l3 3"/><path d="M20 17H8M20 17l-3-3M20 17l-3 3"/><circle cx="18.5" cy="7" r="1.7" fill="currentColor" stroke="none"/><circle cx="5.5" cy="17" r="1.7" fill="currentColor" stroke="none"/></svg>';}
 const b=$("wal-body");const st=$("wal-stats");st.innerHTML="";st.hidden=true;
 const buffs=buffList();
 try{
 if(walTab==="fichas"){
  /* FICHAS YSHIPP: Moedas, Bilhetes e Diamantes — cotação fixa em reais
     apenas como referência; conversão só ENTRE as fichas, nunca para reais. */
  const cb=xcBal("coin"),tb=xcBal("ticket"),db2=xcBal("diamond");
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("star",18)} Fichas Yshipp</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">As fichas são a economia interna de tarefas, sorteios e leilões. Cotação de referência: <b>10 moedas = R$ 0,01</b> · <b>1 bilhete = R$ 0,50</b> · <b>1 diamante = R$ 1,00</b>. Fichas <b>não são convertidas em reais</b> — apenas entre si — e o real continua sendo o centro da plataforma.</p></div>
  <div class="ap-hero-grid">
   <div class="ap-kpi"><span>Moedas Yshipp (tarefas)</span><b class="gold">${nf(cb)}</b></div>
   <div class="ap-kpi"><span>Bilhetes (números de sorteio)</span><b class="green">${nf(tb)}</b></div>
   <div class="ap-kpi"><span>Diamantes (lances de leilão)</span><b style="color:#7cc0ff">${nf(db2)}</b></div>
   <div class="ap-kpi"><span>Valor de referência</span><b>${brl(xcBrlTotal())}</b></div>
  </div></div>
  <div class="wal-bal" style="grid-template-columns:repeat(3,1fr)">
   <div class="bal"><span class="blab"><i class=yi data-i=coins style="width:13px;height:13px"></i> Moedas</span><b class="bval" style="color:var(--acx)">${nf(cb)}</b><span class="bsub">10 = R$ 0,01 · paga tarefas e taxas de publicação de colaboradores</span></div>
   <div class="bal"><span class="blab"><i class=yi data-i=ticket style="width:13px;height:13px"></i> Bilhetes</span><b class="bval" style="color:var(--g)">${nf(tb)}</b><span class="bsub">1 = R$ 0,50 · troque por números de sorteio na hora de reservar</span></div>
   <div class="bal"><span class="blab"><i class=yi data-i=gift style="width:13px;height:13px"></i> Diamantes</span><b class="bval" style="color:#7cc0ff">${nf(db2)}</b><span class="bsub">1 = R$ 1,00 · use como lances nos leilões</span></div>
  </div>
  <div class="ap-sec" style="margin-top:14px">Converter fichas · só entre elas</div>
  <div class="ap-row" style="display:grid;gap:10px">
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <div class="field" style="margin:0"><label class="label">De</label><select id="xc-from"><option value="coin">Moedas Yshipp</option><option value="ticket">Bilhetes</option><option value="diamond">Diamantes</option></select></div>
    <div class="field" style="margin:0"><label class="label">Para</label><select id="xc-to"><option value="ticket">Bilhetes</option><option value="coin">Moedas Yshipp</option><option value="diamond">Diamantes</option></select></div>
   </div>
   <div class="field" style="margin:0"><label class="label">Quantidade a converter</label><input id="xc-amt" type="number" min="1" step="1" inputmode="numeric" placeholder="0"></div>
   <div class="kv"><span>Recebe aproximadamente</span><b class="mono" id="xc-out">—</b></div>
   <button class="btn" type="button" data-xc-go style="width:100%">Converter fichas <i class=yi data-i=refresh></i></button>
   <p class="hint" style="margin:0;font-size:11.5px">A conversão usa a cotação fixa (via reais como referência) e arredonda para baixo. Fichas nunca saem do universo interno: <b>não há conversão de fichas para reais nem saque de fichas</b>.</p>
  </div>
  <div class="ap-row" style="margin-top:12px;flex-wrap:wrap;gap:8px">
   <button class="btn sm ghost" type="button" data-wmk="packages">${ico("cart",14)} Comprar fichas no Market</button>
   <span class="hint" style="font-size:11.5px">A cotação serve para você saber quanto vale cada ficha — ex.: uma tarefa de R$ 1,00 equivale a 2 bilhetes, 1000 moedas ou 1 diamante.</span>
  </div>`;
  const xf=$("xc-from"),xt=$("xc-to"),xa=$("xc-amt");
  const prev=()=>{const f=xf?.value,t=xt?.value,q=Math.max(0,Math.floor(Number(xa?.value)||0));const o=$("xc-out");if(!o)return;if(f===t){o.textContent="Escolha moedas diferentes.";return}o.textContent=q>0?nf(Math.floor(q*XC_RATE[f]/XC_RATE[t]))+" "+XC_NAME[t]:"—"};
  if(xf)xf.onchange=prev;if(xt)xt.onchange=prev;if(xa)xa.oninput=prev;
  return;
 }
 if(walTab==="visao"){
  const total=walBrl()+cryptoBrlValue();
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("coins",18)} YshippWallet</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Seu dinheiro no Yshippcommerce: <b>tudo em reais (R$)</b> — um saldo único, com saque via PIX.</p></div>
  <div class="ap-hero-grid">
   <div class="ap-kpi"><span>Saldo em reais (R$)</span><b class="gold">${brl(walBrl())}</b></div>
   <div class="ap-kpi"><span>Valor total (com cripto)</span><b>${brl(total)}</b></div>
   <div class="ap-kpi"><span>Cripto em reais</span><b>${(cryptoLive()||!cryptoBrlValue())?"":"≈ "}${brl(cryptoBrlValue())}</b></div>
   <div class="ap-kpi"><span>Planos de mineração ativos</span><b>${miningPlans().length}</b></div>
  </div></div>
  <div class="wal-bal">
   <div class="bal">
    <span class="blab"><i class=yi data-i=cash style="width:13px;height:13px"></i> Saldo em reais</span>
    <b class="bval" style="color:var(--acx)">${brl(walBrl())}</b>
    <span class="bsub">Moeda única da plataforma · saque via PIX</span>
   </div>
   <div class="bal">
    <span class="blab"><i class=yi data-i=coins style="width:13px;height:13px"></i> Cripto</span>
    <b class="bval">${(cryptoLive()||!cryptoBrlValue())?"":"≈ "}${brl(cryptoBrlValue())}</b>
    <span class="bsub">Referência em reais · aba Cripto</span>
   </div>
  </div>
  <div class="ap-row" style="margin-top:12px"><div class="r-metrics">
   <span class="ap-m">${ico("hammer",13)} Planos ativos <b>${miningPlans().length}</b></span>
   <span class="ap-m">${ico("bolt",13)} Buffs ativos <b>${buffs.length}</b></span>
   <span class="ap-m">${ico("ticket",13)} Números reservados <b>${myTickets.length}</b></span>
  </div></div>
  ${buffs.length?`<div class="ap-sec">Buffs ativos</div>${buffs.map(x=>`<div class="ap-row"><div class="r-head"><span class="r-ico" style="color:var(--acx)">${ico("bolt",16)}</span><div class="r-title"><b>${esc(x.name||"Buff")}</b><small>+${x.effect?.pct||0}% ${(BUFF_META[x.effect?.type]||["recompensa"])[0].toLowerCase()} · termina em ${Math.ceil(x.msLeft/36e5)}h</small></div></div></div>`).join("")}`:""}
  <div class="ap-sec" style="margin-top:14px">Funcionalidades financeiras</div>
  <div class="wal-fcar-wrap">
   <button class="wal-fcar-nav prev" type="button" data-fcar="prev" aria-label="Anterior">‹</button>
   <div class="wal-fcar" id="wal-fcar">
    <button class="wal-fcard" type="button" data-wgo="converter"><span class="fc-ico"><i class=yi data-i=refresh></i></span><b>Cripto</b><small>Compre e venda criptomoedas com seus reais</small></button>
    <button class="wal-fcard" type="button" data-mn="1"><span class="fc-ico"><i class=yi data-i=hammer></i></span><b>Mina de Reais</b><small>Planos que rendem reais todo mês</small></button>
    <button class="wal-fcard" type="button" data-fj="1"><span class="fc-ico"><i class=yi data-i=bolt></i></span><b>Forja de Buffs</b><small>Turbine recompensas e mineração por um período</small></button>
    <button class="wal-fcard" type="button" data-wgo="sacar"><span class="fc-ico"><i class=yi data-i=send></i></span><b>Sacar via PIX</b><small>Saque seus reais — mínimo ${brl(cfg.withdrawMin)}</small></button>
    <button class="wal-fcard" type="button" data-wmk="recarga"><span class="fc-ico"><i class=yi data-i=coins></i></span><b>Recarregar reais</b><small>Adicione saldo em R$ por PIX na carteira</small></button>
    <button class="wal-fcard" type="button" data-vipopen="1"><span class="fc-ico"><i class=yi data-i=star></i></span><b>Membros VIP</b><small>Dedicação diária, caixa da taxa de 5% e benefícios</small></button>
   </div>
   <button class="wal-fcar-nav next" type="button" data-fcar="next" aria-label="Próximo">›</button>
  </div>
  <div class="wm-pay" style="margin-top:14px">
   <span class="wm-pay-l"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>Formas de pagamento</span>
   <span class="pmb pix"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4.6" y="4.6" width="14.8" height="14.8" rx="4" transform="rotate(45 12 12)"/></svg>PIX<span class="pmb-ok">✓ ativo</span></span>
   <span class="pmb pp off"><b>Pay</b><em>Pal</em></span>
   <span class="pmb visa off">VISA</span>
   <span class="pmb off"><span class="mc"><i></i><i></i></span>mastercard</span>
   <span class="pmb elo off">elo</span>
   <span class="pmb off"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5v14M7 5v14M10.5 5v14M14 5v14M16.5 5v14M20 5v14" stroke-dasharray="2 2.2"/></svg>boleto</span>
   <span class="pmb btc off"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.6"/><path d="M10 7.5v9M12.8 7.5v9M10 7.5h3.2a2.2 2.2 0 0 1 0 4.4H10M10 11.9h3.6a2.2 2.2 0 0 1 0 4.4H10"/></svg>cripto</span>
  </div>`;
 }else if(walTab==="reais"){
  /* ── DINHEIRO REAL (R$) · aba exclusiva: saldo em destaque, nada corta ── */
  const H=history.map(h=>({...h,at:stampMs(h.createdAt),v:Math.abs(Math.round((Number(h.brl)>0?Number(h.brl):(Math.abs(Math.floor(Number(h.amount)||0))*(VAL[h.ticketType]||1)))*100)/100)})).filter(h=>h.v>0).sort((a,b)=>b.at-a.at);
  const ins=H.filter(h=>hPlus(h.kind)).reduce((s,h)=>s+h.v,0);
  const outs=H.filter(h=>!hPlus(h.kind)).reduce((s,h)=>s+h.v,0);
  const wdPend=myWds.filter(w=>w.status==="pending");
  const blocked=wdPend.reduce((s,w)=>s+Math.round((Number(w.amountBrl)||0)*100)/100,0);
  const fees=myWds.reduce((s,w)=>s+(Number(w.feeBrl)||0),0);
  b.innerHTML=`<div class="money-hero">
   <span class="mh-label">${ico("coins",13)} SALDO DISPONÍVEL EM REAIS</span>
   <b class="mh-big">${brl(walBrl())}</b>
   <div class="mh-row">
    <span class="mh-chip g"><i class=yi data-i=trend></i> Entradas <b id="mny-ins">${brl(ins)}</b></span>
    <span class="mh-chip r"><i class=yi data-i=send></i> Saídas <b id="mny-outs">${brl(outs)}</b></span>
    <span class="mh-chip"><i class=yi data-i=hourglass></i> ${wdPend.length} saque(s) em análise</span>
   </div>
  </div>
  <div class="money-actions">
   <button class="btn ghost" data-wgo="sacar">${ico("send",14)} Sacar via PIX</button>
   <button class="btn ghost" data-wmk="recarga">${ico("coins",14)} Recarregar</button>
  </div>
  <div class="money-grid">
   <div class="money-kpi"><span>Em processamento (saques)</span><b>${brl(blocked)}</b></div>
   <div class="money-kpi"><span>Saques feitos</span><b>${myWds.length}</b></div>
   <div class="money-kpi"><span>Taxas de saque pagas</span><b>${brl(fees)}</b></div>
   <div class="money-kpi"><span>Mínimo de saque</span><b>${brl(cfg.withdrawMin)}</b></div>
  </div>
  <div class="ap-sec" style="margin-top:16px">Extrato financeiro (só movimentações em reais)</div>
  <div style="display:grid;gap:8px">${H.length?H.slice(0,20).map(h=>{
   const plus=hPlus(h.kind);
   const lbl=(HKIND[h.kind]||["Movimentação",HICON.pick])[0];
   return `<div class="ap-row" style="padding:10px 12px;flex-wrap:wrap;gap:6px"><b class="mono" style="color:${plus?"var(--g)":"var(--rd)"};white-space:nowrap">${plus?"+":"−"}${brl(h.v)}</b><span class="hint" style="font-size:11.5px;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis">${esc(h.reason||lbl)}</span><span class="hint mono" style="font-size:11px;flex:none">${h.at?fmt(h.createdAt):""}</span></div>`;
  }).join(""):'<p class="hint" style="margin:4px 0 0">Nenhuma movimentação em reais ainda. Recarregue, conclua tarefas ou venda cripto para começar.</p>'}</div>
  <p class="hint" style="margin-top:12px">Este é o seu <b>dinheiro real</b>: o centro da carteira. Tarefas, sorteios, leilões e saques partem deste saldo em reais; as fichas (bilhetes, moedas e diamantes) ficam na aba <b>Fichas</b>.</p>`;
  walMoneyFull();
 }else if(walTab==="converter"){
  const modes={b2c:"Reais → Cripto",c2b:"Cripto → Reais"};
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("refresh",18)} Criptomoedas</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Compre e venda <b>criptomoedas</b> das 10 suportadas usando o seu <b>saldo em reais</b>.</p></div></div>
  <div class="ap-row" style="margin-top:10px;display:grid;gap:8px">
   <!-- NOTA: os ids cv-amt/cv-out/cv-sym aparecem em vários ramos abaixo, mas os ramos
        de convMode são mutuamente exclusivos — apenas um é renderizado por vez em
        #wal-body, portanto nunca há ids duplicados no DOM ao mesmo tempo. -->
   <button class="prc ${convMenuOpen?"on":""}" data-convmenu="1" style="width:100%;justify-content:space-between;padding:12px 14px" aria-expanded="${convMenuOpen}"><b style="font-size:12px">${esc(modes[convMode])}</b><span class="hint" style="font-size:11px">${convMenuOpen?"fechar ▴":"trocar ▾"}</span></button>
   ${convMenuOpen?`<div class="adc-grid2" style="margin:0">${Object.entries(modes).map(([k,l])=>`<button class="prc ${convMode===k?"on":""}" data-convmode="${k}"><b style="font-size:12px">${esc(l)}</b></button>`).join("")}</div>`:""}
   ${convMode==="b2c"?`
   <div class="field"><label class="label">Valor em reais (R$)</label><input id="cv-amt" type="number" min="0.01" step="0.01" value="10"></div>
   <div class="field"><label class="label">Criptomoeda</label><select id="cv-sym">${cfg.cryptos.map(s=>`<option value="${s}">${s} — ${esc(CRYPTO_META[s]?.n||s)}</option>`).join("")}</select></div>
   <p class="hint" style="margin:0">Preço: <b id="cv-out" class="mono"></b> · saldo em reais: <b>${brl(walBrl())}</b></p>
   <button class="btn" data-conv-go style="width:100%">Comprar cripto</button>`:""}
   ${convMode==="c2b"?`
   <div class="field"><label class="label">Criptomoeda</label><select id="cv-sym">${cfg.cryptos.map(s=>`<option value="${s}">${s} — ${esc(CRYPTO_META[s]?.n||s)} (${(Number(walCrypto()[s])||0).toFixed(6)})</option>`).join("")}</select></div>
   <div class="field"><label class="label">Quantidade a vender</label><input id="cv-amt" type="number" min="0.000001" step="0.000001"></div>
   <p class="hint" style="margin:0">Você recebe: <b id="cv-out" class="mono">R$ 0,00</b></p>
   <button class="btn" data-conv-go style="width:100%">Vender por reais</button>`:""}
  </div>
  <p class="ap-form-note" style="margin-top:10px">${ico("shield",14)}<span>Cada ação pede <b>confirmação</b> antes de sair da sua carteira. O saque para o seu banco é feito via PIX na aba <b>Sacar</b> (mínimo ${brl(cfg.withdrawMin)}${cfg.withdrawFee?` · taxa de ${cfg.withdrawFee}%`:""}).</span></p>`;
  walConvPreview();
  const inp=$("cv-amt");if(inp)inp.oninput=walConvPreview;
  const sy=$("cv-sym");if(sy)sy.onchange=walConvPreview;
 }else if(walTab==="cripto"){
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("coins",18)} Criptomoedas</b>
  <p class="hint" style="margin:0;font-size:12.5px">${cryptoLive()?"Preço ao vivo (referência) e suas posições. Converta reais ↔ cripto na aba Converter.":"Cotação ao vivo indisponível agora — os valores abaixo usam preços de referência aproximados (≈). Converta com cuidado."}</p></div></div>
  <div style="display:grid;gap:10px;margin-top:12px">${cfg.cryptos.map(s=>{
   const q=Number(walCrypto()[s])||0,pr=cryptoPrice(s),live=Number(cryptoPrices[s])>0;
   return `<div class="ap-row"><div class="r-head"><span class="r-ico">${ico("coins",16)}</span><div class="r-title"><b>${s} <span class="hint" style="font-size:11px">${esc(CRYPTO_META[s]?.n||"")}</span></b><small class="mono">${live?"":"≈ "}${brl(pr)}</small></div></div>
   <div class="r-metrics"><span class="ap-m">Saldo <b class="mono">${q?q.toFixed(6):"0"}</b></span><span class="ap-m">Em reais <b class="mono">${live?"":"≈ "}${brl(q*pr)}</b></span><button class="btn sm ghost" data-convgo2="${s}">Converter</button></div></div>`;
  }).join("")}</div>`;
 }else if(walTab==="sacar"){
  const wdPendN=myWds.filter(w=>w.status==="pending").length;
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("send",18)} Área de saque</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Transfira o seu saldo em reais com segurança. Mínimo <b>${brl(cfg.withdrawMin)}</b>${cfg.withdrawFee?` · taxa de <b>${cfg.withdrawFee}%</b>`:" · sem taxa"} · pagamento em até <b>${cfg.withdrawDays} dia(s) úteis</b> após a aprovação.</p></div>
  <div class="ap-hero-grid">
   <div class="ap-kpi"><span>Saldo em reais</span><b>${brl(walBrl())}</b></div>
   <div class="ap-kpi"><span>Mínimo</span><b>${brl(cfg.withdrawMin)}</b></div>
   <div class="ap-kpi"><span>Taxa</span><b>${cfg.withdrawFee}%</b></div>
   <div class="ap-kpi"><span>Em análise</span><b>${wdPendN?brl(myWds.filter(w=>w.status==="pending").reduce((s,w)=>s+(Number(w.amountBrl)||0),0)):brl(0)}</b></div>
   <div class="ap-kpi"><span>Criptomoedas</span><b>${brl(cryptoBrlValue())}</b></div>
   <div class="ap-kpi"><span>Fichas</span><b>${CATS.reduce((s,k)=>s+Math.max(0,Math.floor(Number(wallet?.[k])||0)),0)}</b></div>
  </div></div>
  <div class="wd-grid">
   <div class="wd-panel">
    <span class="ap-sec" style="padding:0">Método de recebimento</span>
    <div class="wd-methods">
     <div class="wd-mth sel"><span class="radio"></span><span class="pmb pix" style="height:24px"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4.6" y="4.6" width="14.8" height="14.8" rx="4" transform="rotate(45 12 12)"/></svg>PIX</span><div style="min-width:0"><b>Chave PIX</b><small>crédito direto na sua conta · na hora após aprovação</small></div><span class="pmb-ok" style="margin-left:auto">✓ ativo</span></div>
     <div class="wd-mth" style="opacity:.5"><span class="radio"></span><span class="pmb pp off" style="height:24px"><b>Pay</b><em>Pal</em></span><div><b>PayPal</b><small>em breve pela equipe</small></div></div>
     <div class="wd-mth" style="opacity:.5"><span class="radio"></span><span class="pmb off" style="height:24px"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></svg>TED</span><div><b>Conta bancária (TED)</b><small>em breve pela equipe</small></div></div>
     <div class="wd-mth" style="opacity:.5"><span class="radio"></span><span class="pmb off" style="height:24px"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.6"/><path d="M10 7.5v9M12.8 7.5v9M10 7.5h3.2a2.2 2.2 0 0 1 0 4.4H10M10 11.9h3.6a2.2 2.2 0 0 1 0 4.4H10"/></svg>₿</span><div><b>Criptomoedas</b><small>em breve · BTC · ETH · USDT (TRC-20)</small></div></div>
    </div>
    <span class="ap-sec" style="padding:0;margin-top:4px">Dados do saque</span>
    <div class="field" style="margin:0">
     <label class="label">Valor do saque (R$)</label>
     <input id="wd-amt" type="number" min="${cfg.withdrawMin}" step="0.01" placeholder="0,00">
     <div class="wd-quick"><button type="button" data-wdq="25">25%</button><button type="button" data-wdq="50">50%</button><button type="button" data-wdq="75">75%</button><button type="button" data-wdq="100">Máximo</button></div>
    </div>
    <div class="field" style="margin:0">
     <label class="label">Sua chave PIX</label>
     <input id="wd-key" placeholder="CPF, e-mail, telefone ou chave aleatória">
     <span id="wd-keytype" class="wd-keytype">Aguardando a chave…</span>
    </div>
   </div>
   <div class="wd-panel">
    <span class="ap-sec" style="padding:0">Resumo da transferência</span>
    <div class="wd-sum">
     <div><span>Valor solicitado</span><b id="wd-amt-v">R$ 0,00</b></div>
     <div><span>Taxa de saque (${cfg.withdrawFee}%)</span><b id="wd-fee-v">R$ 0,00</b></div>
     <div><span>Você recebe</span><b id="wd-net">R$ 0,00</b></div>
     <div class="tot"><span>Saldo após o saque</span><b id="wd-after-v">${brl(walBrl())}</b></div>
    </div>
    <button class="btn" data-wd-go style="width:100%">Confirmar saque via PIX ${ico("send",14)}</button>
    <p class="hint" style="font-size:11px;margin:0">${ico("shield",12)} O valor é debitado na hora e fica reservado em análise até a confirmação da administração. Se o saque for recusado, o valor volta integralmente para a sua carteira.</p>
   </div>
  </div>
  <div class="ap-sec" style="margin-top:14px">Como funciona</div>
  <div class="wd-steps">
   <div class="wd-step done"><i>✓</i><div><b>Saque solicitado</b><small>valor debitado da carteira e reservado para o pagamento</small></div></div>
   <div class="wd-step cur"><i>2</i><div><b>Em análise pela administração</b><small>conferência dos dados e envio do PIX${vipMe?.vip===true?" · membros VIP têm prioridade na fila":""}</small></div></div>
   <div class="wd-step"><i>3</i><div><b>Pago</b><small>o valor chega na sua conta PIX · até ${cfg.withdrawDays} dia(s) útil(is)</small></div></div>
  </div>
  <div class="ap-sec" style="margin-top:14px">Meus saques</div>
  <div style="display:grid;gap:8px">${myWds.length?myWds.map(w=>`<div class="ap-row" style="padding:9px 12px"><span class="mono">${brl(w.netBrl||w.amountBrl)}</span><span class="hint" style="font-size:11.5px">${esc((w.pixKey||"").slice(0,24))} · ${w.createdAt?fmt(w.createdAt):""}</span><span style="margin-left:auto">${w.priority?'<span class="tag y">★ fila VIP</span> ':''}${w.status==="pending"?'<span class="tag y">Em análise</span>':w.status==="paid"?'<span class="tag g">Pago</span>':'<span class="tag r">Recusado</span>'}</span></div>`).join(""):'<p class="hint" style="margin:0">Nenhum saque solicitado ainda.</p>'}</div>`;
  const wdSync=()=>{
   const v=Math.max(0,Number($("wd-amt")?.value)||0);
   const fee=Math.round(v*cfg.withdrawFee*100)/100;
   const net=Math.round((v-fee)*100)/100;
   const set=(id,t)=>{const e=$(id);if(e)e.textContent=t};
   set("wd-amt-v",brl(v));set("wd-fee-v",brl(fee));set("wd-net",brl(net));
   set("wd-after-v",brl(Math.max(0,Math.round((walBrl()-v)*100)/100)));
  };
  const inp=$("wd-amt");if(inp)inp.oninput=wdSync;
  const ki=$("wd-key");
  const wdKeyType=k=>{k=(k||"").trim();if(!k)return[0,"Aguardando a chave…"];if(k.replace(/\D/g,"").length===11&&/^[\d.\-\s]+$/.test(k))return[1,"CPF detectado"];if(k.replace(/\D/g,"").length===14&&/^[\d.\-\/\s]+$/.test(k))return[1,"CNPJ detectado"];if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k))return[1,"E-mail detectado"];if(/^\+?[\d\s\-()]{8,}$/.test(k))return[1,"Telefone detectado"];if(/^[a-f0-9\-]{20,}$/i.test(k))return[1,"Chave aleatória detectada"];return[-1,"Formato ainda não reconhecido"]};
  if(ki)ki.oninput=()=>{const s=wdKeyType(ki.value);const el=$("wd-keytype");if(el){el.className="wd-keytype"+(s[0]===1?" ok":s[0]<0?" bad":"");el.textContent=(s[0]===1?"✓ ":s[0]<0?"⚠ ":"")+s[1]}};
  document.querySelectorAll("[data-wdq]").forEach(bt=>bt.onclick=()=>{const pct=Number(bt.dataset.wdq)||0;const v=pct>=100?walBrl():Math.round(walBrl()*pct)/100;if(inp)inp.value=Math.max(0,v).toFixed(2);wdSync()});
 }
 }catch(err){
  console.error("YshippWallet:",err);
  b.innerHTML='<div class="ap-hero"><div class="ap-hero-top"><b>Ops… não foi possível carregar esta aba</b></div><p class="hint" style="margin:4px 0 0">Algo saiu do previsto ao montar o conteúdo. Tente abrir a aba de novo ou recarregue a página — seu saldo está seguro e não foi afetado.</p></div>';
 }
}

/* ── entradas/saídas da aba Dinheiro: soma completa (500 entradas do histórico) ── */
async function walMoneyFull(){
 var insEl=$("mny-ins"),outsEl=$("mny-outs");
 if(!insEl&&!outsEl)return;
 try{
  var h=await ecHist(true)||[];
  var reAny=/^(convert_t2b|convert_b2t|convert_b2c|convert_c2b|withdraw_request|withdraw_refund|market_buy|market_purchase|recarga|admin_credit)$/;
  var reIn=/^(convert_t2b|convert_c2b|withdraw_refund|market_purchase|recarga|admin_credit)$/;
  var ins=0,outs=0;
  for(var i=0;i<h.length;i++){
   var k=h[i]&&h[i].kind,v=Math.abs(Math.round((Number(h[i].brl)||0)*100)/100);
   if(!k||!reAny.test(k)||v<=0)continue;
   if(reIn.test(k))ins+=v;else outs+=v;
  }
  insEl.textContent=brl(ins);
  outsEl.textContent=brl(outs);
 }catch(e){}
}

/* ── conversões (criptomoedas) ── */
function walConvPreview(){ const cfg=econCfg();
 const amt=Math.max(0,Number($("cv-amt")?.value)||0);
 const out=$("cv-out");if(!out)return;
 if(convMode==="b2c"){const s=$("cv-sym")?.value;out.textContent=(amt>0&&cryptoPrice(s)?(amt/cryptoPrice(s)).toFixed(8):"—")+" "+(s||"")}
 if(convMode==="c2b"){const s=$("cv-sym")?.value;out.textContent=brl(amt*cryptoPrice(s))}
}
/* consome o saldo único em reais de um objeto de carteira (dentro de uma
   transação): primeiro o campo brl (recargas), depois troco e créditos */
function debitCombined(w,amt){
 let rest=Math.round(amt*100)/100;
 const b=Math.min(rest,Math.max(0,Number(w.brl)||0));
 w.brl=Math.round(((Number(w.brl)||0)-b)*100)/100;
 rest=Math.round((rest-b)*100)/100;
 if(rest>0.0001){
  const ch=Math.min(Math.ceil(rest),Math.max(0,Math.floor(Number(w.change)||0)));
  if(ch>0){w.change=Math.floor(Number(w.change)||0)-ch;rest=Math.round((rest-ch)*100)/100}
  for(const k of CATS){
   if(rest<=0.0001)break;
   const take=Math.min(Math.ceil(rest),Math.max(0,Math.floor(Number(w[k])||0)));
   if(take>0){w[k]=Math.floor(Number(w[k])||0)-take;rest=Math.round((rest-take)*100)/100}
  }
 }
 return rest<=0.0001;
}
/* saldo total disponível em reais (leitura dentro de transação) */
const availCombined=w=>Math.max(0,Number(w.brl)||0)+Math.max(0,Math.floor(Number(w.change)||0))+CATS.reduce((s,k)=>s+Math.max(0,Math.floor(Number(w?.[k])||0))*VAL[k],0);
async function walConvGo(){
 if(!currentUser)return;
 try{
  const amt=Math.max(0,Number($("cv-amt")?.value)||0);
  if(convMode==="b2c"){
   const sym=$("cv-sym")?.value;if(!sym)return;
   if(amt<=0)return toast("Informe um valor em reais.");
   const pr=cryptoPrice(sym);
   const qty=amt/pr;
   if(qty<=0)return toast("Valor muito pequeno.");
   if(!confirm("Comprar "+qty.toFixed(8)+" "+sym+" com "+brl(amt)+"?\n\nConfirmar a compra?"))return;
   await runTransaction(db,async tx=>{
    const ws=await tx.get(doc(db,"wallets",currentUser.uid));
    const w=ws.exists()?ws.data():{};
    if(availCombined(w)<amt-0.001)throw new Error("Saldo em reais insuficiente.");
    debitCombined(w,amt);
    const cr=w.crypto&&typeof w.crypto==="object"?{...w.crypto}:{};
    cr[sym]=Number((Number(cr[sym])||0)+qty);
    w.crypto=cr;
    tx.set(doc(db,"wallets",currentUser.uid),{...w,updatedAt:serverTimestamp()});
    /* taxa do clube VIP: fatia da compra de cripto vai para o caixa VIP */
    const fee=Math.round(amt*vipFeePct())/100*1;
    if(fee>0)tx.set(doc(db,"settings","vip"),{pool:increment(fee),updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"convert_b2c",amount:0,brl:amt,reason:"Conversão: reais → "+sym+" ("+qty.toFixed(8)+" "+sym+")",createdAt:serverTimestamp()});
   });
   toast("Compra feita: "+qty.toFixed(8)+" "+sym);
  }else if(convMode==="c2b"){
   const sym=$("cv-sym")?.value;if(!sym)return;
   const qty=Math.max(0,Number($("cv-amt")?.value)||0);
   if(qty<=0)return toast("Informe a quantidade a vender.");
   const brlv=qty*cryptoPrice(sym);
   if(brlv<0.01)return toast("Quantidade muito pequena.");
   if(!confirm("Vender "+qty.toFixed(8)+" "+sym+" → "+brl(brlv)+"?\n\nConfirmar a venda?"))return;
   await runTransaction(db,async tx=>{
    const ws=await tx.get(doc(db,"wallets",currentUser.uid));
    const w=ws.exists()?ws.data():{};
    const cr=w.crypto&&typeof w.crypto==="object"?{...w.crypto}:{};
    if((Number(cr[sym])||0)<qty-1e-12)throw new Error("Saldo de "+sym+" insuficiente.");
    cr[sym]=Number((Number(cr[sym])||0)-qty);
    if(cr[sym]<=1e-9)delete cr[sym];
    w.crypto=cr;
    w.brl=Math.round(((Number(w.brl)||0)+brlv)*100)/100;
    tx.set(doc(db,"wallets",currentUser.uid),{...w,updatedAt:serverTimestamp()});
    tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"convert_c2b",amount:0,brl:brlv,reason:"Conversão: "+sym+" → reais ("+qty.toFixed(8)+" "+sym+")",createdAt:serverTimestamp()});
   });
   toast("Venda feita: "+brl(brlv));
  }
  walRender();
 }catch(e){toast(String(e?.message||e))}
}

/* ── coletar mineração ── */
async function mineCollect(planId){
 if(!currentUser)return;
 const cfg=econCfg();
 try{
  await runTransaction(db,async tx=>{
   const ws=await tx.get(doc(db,"wallets",currentUser.uid));
   const w=ws.exists()?ws.data():{};
   const plans=Array.isArray(w.miningPlans)?w.miningPlans:[];
   const i=plans.findIndex(p=>p.id===planId);
   if(i<0)throw new Error("Plano não encontrado.");
   const p=plans[i];
   const st=p.startsAt?stampMs(p.startsAt):0;
   const end=st+(Number(p.durDays)||30)*864e5;
   const lc=p.lastCollect?stampMs(p.lastCollect):st;
   const now=Date.now();
   const boost=1+Math.min(cfg.maxMiningBuffPct,buffPct("miningBoost"))/100;
   const pending=Math.floor((Number(p.yieldPerMonth)||0)/(30*864e5)*Math.max(0,Math.min(now,end)-lc)*boost);
   if(pending<1)throw new Error("Ainda não há reais prontos para coletar.");
   if(!confirm("Coletar "+fmtBRL(pending)+" da mineração agora?"))throw new Error("Coleta cancelada.");
   plans[i]={...p,lastCollect:Date.now()};
   w.miningPlans=plans;
   w.gold=(Math.floor(Number(w.gold)||0))+pending;
   tx.set(doc(db,"wallets",currentUser.uid),{...w,updatedAt:serverTimestamp()});
   tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"mining_collect",amount:pending,ticketType:"gold",reason:"Mineração coletada: "+String(p.name||"plano").slice(0,40),createdAt:serverTimestamp()});
   toast("Coletado: +"+fmtBRL(pending)+"!");
  });
  walRender();
  mnFjSync();
 }catch(e){toast(String(e?.message||e))}
}

/* ═══════════════════════════════════════════════════════════════
   MEMBROS VIP · dedicação diária virá benefício
   VIP = manter, dia após dia, check-in feito + 5 tarefas aprovadas
   por dia, por 7 dias seguidos. Falhou um dia? A sequência zera.
   Cada compra de criptomoeda paga 5% de taxa em reais,
   que alimenta o caixa VIP; ao atingir a meta (padrão: 100 mil
   reais), o caixa
   é dividido igualmente entre todos os membros VIP ativos.
   ═══════════════════════════════════════════════════════════════ */
/* parâmetros do clube VIP configuráveis no painel (settings/economy.vip);
   sem configuração, valem os padrões: 5% · 100 mil · 7 dias · 5 tarefas */
const vipCfgK=()=>{const v=econCfg().vip||{};const f=Number(v.feePct),g=Number(v.poolGoal),s=Number(v.streakDays),t=Number(v.tasksPerDay);
 return{feePct:(Number.isFinite(f)&&f>=0&&f<=50)?f:5,poolGoal:(Number.isFinite(g)&&g>=1000)?Math.floor(g):100000,streakDays:(Number.isFinite(s)&&s>=1)?Math.floor(s):7,tasksPerDay:(Number.isFinite(t)&&t>=1)?Math.floor(t):5}};
function vipFeePct(){return vipCfgK().feePct}
function vipPoolGoal(){return vipCfgK().poolGoal}
function vipStreakDays(){return vipCfgK().streakDays}
function vipTasksDay(){return vipCfgK().tasksPerDay}
 let vipMe=null, vipPoolData={pool:0,distributions:[]}, vipMembers=[], vipUn=null, vipMemUn=null, vipLastSig="";
const vipDayK=ms=>{const x=new Date(ms);return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")};
const vipMs=h=>h?.toMillis?h.toMillis():(h?.seconds?h.seconds*1000:0);
/* mapa dia → {ck:check-in feito, tasks: tarefas aprovadas no dia} */
function vipDailyMap(list){
 const m={};
 for(const h of list||[]){
  const ms=vipMs(h.createdAt);if(!ms)continue;
  const k=vipDayK(ms);
  m[k]=m[k]||{ck:0,tasks:0};
  if(h.kind==="checkin")m[k].ck++;
  if(h.kind==="reward"||h.kind==="survey_reward"||h.kind==="ad_reward"||h.kind==="challenge_reward")m[k].tasks++;
 }
 return m;
}
/* sequência de dias cumpridos (check-in + 5 tarefas), contando de hoje para trás;
   o dia de hoje só conta se já estiver completo */
async function vipSync(force){
 if(!currentUser||!currentUser.emailVerified)return;
 try{
  const list=await ecHist(!!force);
  const dm=vipDailyMap(list);
  const today=vipDayK(Date.now());
  const good=k=>dm[k]&&dm[k].ck>=1&&dm[k].tasks>=vipTasksDay();
  let streak=0;
  for(let i=1;i<=400;i++){const k=vipDayK(Date.now()-i*864e5);if(good(k))streak++;else break}
  const todayGood=good(today);
  if(todayGood)streak+=1;
  const wasVip=vipMe?.vip===true;
  vipMe={streak,todayCk:(dm[today]?.ck||0)>=1,todayTasks:dm[today]?.tasks||0,todayGood,vip:streak>=vipStreakDays(),best:Math.max(streak,vipMe?.best||0)};
  const p=profile||{};
  const rec={name:maskName(p.name||"Participante"),streak,todayGood,vip:vipMe.vip,updatedAt:serverTimestamp()};
  if(vipMe.vip&&!wasVip)rec.since=serverTimestamp();
  /* grava só quando algo relevante muda — evita escrita no Firestore a
     cada movimentação da carteira (amplificação de escritas) */
  const sig=[rec.name,rec.streak,rec.todayGood,rec.vip].join("|");
  if(sig!==vipLastSig){vipLastSig=sig;setDoc(doc(db,"vipMembers",currentUser.uid),rec,{merge:true})}
  if($("vipgaveta")?.classList.contains("open"))vipRender();
 }catch(e){console.warn("VIP:",e)}
}
/* pool e membros ao vivo */
function vipStart(){
 if(vipUn)return;
 vipUn=onSnapshot(doc(db,"settings","vip"),d=>{vipPoolData=d.exists()?d.data():{pool:0,distributions:[]};if($("vipgaveta")?.classList.contains("open"))vipRender()},e=>console.warn("Caixa VIP:",e));
 vipMemUn=onSnapshot(query(collection(db,"vipMembers"),where("vip","==",true),limit(500)),s=>{vipMembers=s.docs.map(x=>({id:x.id,...x.data()}));if($("vipgaveta")?.classList.contains("open"))vipRender()},e=>console.warn("Membros VIP:",e));
 vipMaybeDistribute();   /* caso o caixa tenha cruzado a meta offline */
}
function vipStop(){
 [vipUn,vipMemUn].forEach(f=>{try{f&&f()}catch(e){}});
 vipUn=vipMemUn=null;vipMe=null;vipMembers=[];vipLastSig="";
}
/* distribuição: quando o caixa chega a 100 mil, divide igualmente entre VIPs */
async function vipMaybeDistribute(){
 try{
  const s=await getDoc(doc(db,"settings","vip"));
  const pool=Math.floor(Number(s.data()?.pool)||0);
  if(pool<vipPoolGoal())return;
  const mems=vipMembers.filter(m=>m.vip===true&&m.id);
  if(!mems.length)return;
  const share=Math.floor(pool/mems.length);
  if(share<1)return;
  const rec=await runTransaction(db,async tx=>{
   const vs=await tx.get(doc(db,"settings","vip"));
   const p=Math.floor(Number(vs.data()?.pool)||0);
   if(p<vipPoolGoal())return null;
   const dist=Array.isArray(vs.data()?.distributions)?vs.data().distributions.slice(-9):[];
   for(const m of mems){
    tx.set(doc(db,"wallets",m.id),{common:increment(share),updatedAt:serverTimestamp()},{merge:true});
    tx.set(doc(collection(db,"wallets",m.id,"history")),{kind:"vip_dist",amount:share,ticketType:"common",reason:"Distribuição do caixa VIP <i class=yi data-i=star></i> ("+fmtBRL(share)+")",createdAt:serverTimestamp()});
   }
   const rec={total:p,perMember:share,members:mems.length,at:Date.now()};
   tx.set(doc(db,"settings","vip"),{pool:p-share*mems.length,distributions:[...dist,rec],lastDistAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
   return rec;
  });
  if(rec){toast("Caixa VIP distribuído: "+mems.length+" membro(s) VIP receberam "+fmtBRL(share)+" cada.");vipRender()}
 }catch(e){console.error("Distribuição VIP:",e)}
}
/* ── central em tela cheia ── */
function vipOpen(){if(!currentUser||!currentUser.emailVerified){toast("Entre na sua conta para acessar a Central de Membros VIP.");return}try{if($("walgaveta").classList.contains("open"))walClose()}catch(e){}vipStart();vipSync(true);$("vipgaveta").classList.add("open");$("vipv").classList.add("open");syncGavLock();vipRender()}
function vipClose(){$("vipgaveta").classList.remove("open");$("vipv").classList.remove("open");syncGavLock()}
$("vip-x").onclick=vipClose;
function vipRender(){
 const b=$("vip-body");if(!b)return;
 const me=vipMe||{streak:0,todayCk:false,todayTasks:0,vip:false};
 const pool=Math.max(0,Math.floor(Number(vipPoolData.pool)||0));
 const dists=Array.isArray(vipPoolData.distributions)?vipPoolData.distributions:[];
 const mems=vipMembers.filter(m=>m.vip===true);
 const myShare=mems.length?Math.floor(pool/mems.length):0;
 const pct=Math.min(100,pool/vipPoolGoal()*100);
 b.innerHTML=`
 <div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("star",18)} Central de Membros VIP</b>
 <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">O clube da dedicação: quem faz <b>check-in</b> e <b>${vipTasksDay()} tarefas por dia</b>, ${vipStreakDays()} dias seguidos, vira VIP — e passa a receber parte do <b>caixa VIP</b>, alimentado pela taxa de ${vipFeePct()}% das compras de criptomoeda.</p></div></div>
 <div class="money-hero" style="margin-top:12px">
  <div class="mh-label">${me.vip?'<span class="tag g">★ membro vip ativo</span>':'<span class="tag y">status: não-vip</span>'}<span>sequência atual</span></div>
  <b class="mh-big">${me.streak}<small style="font-size:14px;color:var(--mu)"> / ${vipStreakDays()} dias</small></b>
  <div class="mh-row">
   <span class="mh-chip ${me.todayCk?"g":"r"}">Check-in de hoje: ${me.todayCk?"feito ✓":"pendente"}</span>
   <span class="mh-chip ${me.todayTasks>=vipTasksDay()?"g":"r"}">Tarefas hoje: ${Math.min(me.todayTasks,vipTasksDay())}/${vipTasksDay()}</span>
  </div>
  <p class="hint" style="margin:0;font-size:11.5px">${me.vip?"Você está dentro! Mantenha o ritmo todos os dias para não perder o status — um dia sem cumprir zera a sequência.":"Complete o dia (check-in + "+vipTasksDay()+" tarefas) e mantenha "+(vipStreakDays()-me.streak)+" dia(s) seguido(s) para virar VIP."}</p>
  <div class="money-actions" style="margin-top:4px">
   <button class="btn sm" type="button" data-vipck="1">Fazer check-in ${ico("gift",14)}</button>
   <button class="btn sm ghost" type="button" data-viptask="1">Ver tarefas ${ico("check",14)}</button>
  </div>
 </div>
 <div class="ap-sec" style="margin-top:16px">Caixa VIP compartilhado</div>
 <div class="ap-row" style="padding:12px">
  <div class="vip-bar"><i style="width:${pct}%"></i></div>
  <div class="vip-bar-txt"><span>${fmtBRL(pool)} acumulados</span><b>meta: ${brl(vipPoolGoal())}</b></div>
  <p class="hint" style="margin:8px 0 0;font-size:11.5px">Cada compra de criptomoeda deposita <b>${vipFeePct()}% em reais</b> aqui. Ao atingir <b>${fmtBRL(vipPoolGoal())}</b>, o caixa é dividido igualmente entre os ${mems.length||"—"} membro(s) VIP ativo(s) ${me.vip?"— sua fatia estimada agora: <b>"+fmtBRL(myShare)+"</b>":""}.</p>
 </div>
 <div class="ap-sec" style="margin-top:16px">Benefícios VIP</div>
 <div class="money-grid" style="grid-template-columns:1fr">
  <div class="money-kpi"><span>${ico("coins",14)} Caixa VIP</span><p class="hint" style="margin:2px 0 0">Fatia igual do caixa compartilhado a cada ${fmtBRL(vipPoolGoal())} acumulados com a taxa de ${vipFeePct()}% das compras de cripto.</p></div>
  <div class="money-kpi"><span>${ico("star",14)} Selo VIP dourado</span><p class="hint" style="margin:2px 0 0">Seu nome aparece com o selo VIP na lista de membros e nas listas da plataforma — sinônimo de dedicação.</p></div>
  <div class="money-kpi"><span>${ico("gift",14)} Check-in em dobro</span><p class="hint" style="margin:2px 0 0">Enquanto for VIP, a recompensa do check-in diário é <b>duplicada</b>, inclusive bônus de sequência.</p></div>
  <div class="money-kpi"><span>${ico("bolt",14)} Fila prioritária nos saques</span><p class="hint" style="margin:2px 0 0">Seus saques PIX saem com sinal de prioridade e são processados antes dos saques comuns.</p></div>
 </div>
 <div class="ap-sec" style="margin-top:16px">Membros VIP ativos</div>
 <div style="display:grid;gap:8px">${mems.length?mems.map(m=>`<div class="ap-row" style="padding:9px 12px"><span>${esc(m.name||"Participante")} ${m.id===currentUser?.uid?'<span class="tag g">você</span>':""}</span><span style="margin-left:auto" class="hint">★ ${m.streak||0} dia(s)</span></div>`).join(""):'<p class="hint" style="margin:0">Nenhum membro VIP ativo no momento — seja o primeiro!</p>'}</div>
 <div class="ap-sec" style="margin-top:16px">Distribuições do caixa</div>
 <div style="display:grid;gap:8px">${dists.length?dists.slice().reverse().map(d=>`<div class="ap-row" style="padding:9px 12px"><span class="mono">+${fmtBRL(d.perMember)}</span><span class="hint" style="font-size:11.5px">${d.members||0} membro(s) · total ${brl(d.total)}</span><span style="margin-left:auto" class="hint">${d.at?fmt(d.at):""}</span></div>`).join(""):'<p class="hint" style="margin:0">Nenhuma distribuição ainda. A primeira acontece quando o caixa chegar a '+fmtBRL(vipPoolGoal())+'.</p>'}</div>
 <p class="ap-form-note" style="margin-top:14px">${ico("shield",14)}<span>Regra do clube: <b>check-in + ${vipTasksDay()} tarefas/dia, ${vipStreakDays()} dias seguidos</b> = VIP. Um dia sem cumprir zera a sequência. Os benefícios valem enquanto a sequência continuar de pé.</span></p>`;
}

/* ═══════════════════════════════════════════════════════════════
   MINA DE REAIS · central de mineração em tela cheia
   Os planos vivem na carteira (wallet.miningPlans) e rendem
   reais continuamente; a coleta credita na hora.
   ═══════════════════════════════════════════════════════════════ */
let mnTab="producao";
function mnOpen(){if(!currentUser){toast("Entre na sua conta para abrir a Mina de Reais.");return}$("mngaveta").classList.add("open");$("mnv").classList.add("open");syncGavLock();mnRender()}
function mnClose(){$("mngaveta").classList.remove("open");$("mnv").classList.remove("open");syncGavLock()}
$("mn-x").onclick=mnClose;
const mnKpi=(ic2,l,v,cls)=>`<div class="ap-kpi"><span class="kl">${ico(ic2,14)}${l}</span><b class="${cls||""}">${v}</b></div>`;
const msLeftTxt=ms=>{const d=Math.floor(ms/864e5),h=Math.round(ms%864e5/36e5);return d>0?d+"d "+h+"h":h+"h"};
function mnStats(){
 const cfg=econCfg();
 const plans=miningPlans();
 const boost=Math.min(cfg.maxMiningBuffPct,buffPct("miningBoost"));
 $("mn-stats").innerHTML=
  mnKpi("hammer","Planos ativos",plans.length)+
  mnKpi("chart","Rendimento/mês",brl(plans.reduce((s,p)=>s+(Number(p.yieldPerMonth)||0),0)),"gold")+
  mnKpi("ticket","Pronto p/ coletar",brl(plans.reduce((s,p)=>s+p.pending,0)),"green")+
  mnKpi("coins","Reais na carteira",brl(walBrl()))+
  mnKpi("bolt","Buff de mineração",boost?"+"+boost+"%":"—","gold");
}
function mnRender(){
 $("mn-stats").hidden=mnTab!=="producao";
 if(mnTab==="producao")mnStats();
 const tabs=[["producao","hammer","Produção"],["planos","cart","Contratar"],["pedidos","note","Pedidos"]];
 $("mn-tabs").innerHTML=tabs.map(([k,ic2,l])=>`<button class="${mnTab===k?"on":""}" data-mntab="${k}">${ico(ic2,17)}<span>${l}</span></button>`).join("");
 const b=$("mn-body");
 if(mnTab==="producao"){
  const cfg=econCfg();
  const plans=miningPlans();
  const boost=Math.min(cfg.maxMiningBuffPct,buffPct("miningBoost"));
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("hammer",18)} Sua produção</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Seus planos rendem <b>reais</b> continuamente${boost?` — <b style="color:var(--acx)">+${boost}% com o buff de mineração ativo</b>`:""}. Colete quando quiser: o rendimento acumula até o fim do plano.</p></div></div>
  <div style="display:grid;gap:10px;margin-top:12px">${plans.length?plans.map(p=>`<div class="ap-row"><div class="r-head"><span class="r-ico" style="color:var(--acx)">${ico("hammer",16)}</span><div class="r-title"><b>${esc(p.name||"Minerador")}</b><small>${brl(p.yieldPerMonth)}/mês · ${msLeftTxt(p.msLeft)} restantes</small></div></div>
  <div class="r-metrics"><span class="ap-m">${ico("clock",12)} Acumulado <b class="gold mono">${brl(p.pending)}</b></span><button class="btn sm" data-mine-collect="${esc(p.id)}" ${p.pending>0?"":"disabled"}>Coletar</button></div>
  <div class="ap-bar"><i style="width:${Math.min(100,Math.round(p.pending/Math.max(1,p.yieldPerMonth/30)*100))}%"></i></div></div>`).join(""):`<div class="ap-row"><p class="hint" style="margin:0">Você ainda não tem planos de mineração contratados. Contratou um plano e ele não aparece? Ele entra em produção assim que a administração confirma o PIX.</p><button class="btn sm" data-mntab="planos">Contratar plano <i class=yi data-i=cart></i></button></div>`}</div>`;
 }else if(mnTab==="planos"){
  const list=storeItems.filter(x=>x.section==="mining"&&x.active!==false).sort((a,c)=>(Number(a.sortOrder)||0)-(Number(c.sortOrder)||0));
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("cart",18)} Contratar plano</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Escolha o poder de processamento: quanto maior o plano, mais <b>reais por mês</b> ele mina para a sua carteira. O plano entra em produção assim que a administração confirma o PIX.</p></div></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-top:14px">${list.length?list.map(x=>`<button type="button" class="ap-tcard" data-buy="${esc(x.id)}">
  <div class="t-head"><span class="t-ico">${ico(x.icon||"hammer",17)}</span><b>${esc(x.name)}</b></div>
  ${x.badge?`<span class="pes-chip" style="background:var(--as);color:var(--acx);justify-self:start">${esc(x.badge)}</span>`:""}
  <p class="hint" style="margin:0;font-size:12px;line-height:1.5">${esc(x.desc||"")}</p>
  <span class="hint" style="font-size:11.5px">Mina até <b>${fmtBRL(x.yieldPerMonth)}</b>/mês por ${x.durationDays} dias</span>
  <b class="mono" style="font-size:17px;color:var(--acx)">${brl(x.priceBrl)}</b>
  <span class="hint" style="font-size:10.5px">PIX · confirmação da administração</span>
  </button>`).join(""):'<div class="ap-row"><p class="hint" style="margin:0">Nenhum plano à venda agora — volte em breve.</p></div>'}</div>`;
 }else{
  const orders=myOrders.filter(o=>o.section==="mining");
  const pend=orders.filter(o=>o.status==="pending");
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("note",18)} Pedidos de mineração</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Cada plano comprado gera um pedido: <b>aguardando confirmação</b> significa que a administração ainda vai validar o PIX; <b>pago e creditado</b> significa que o plano já está produzindo na aba Produção.</p></div></div>
  <div style="display:grid;gap:10px;margin-top:14px">${orders.length?orders.map(o=>`<div class="ap-row"><div class="r-head"><span class="r-ico" style="color:var(--acx)">${ico("hammer",16)}</span><div class="r-title"><b>${esc(o.item?.name||"Plano")}</b><small>${o.createdAt?fmt(o.createdAt):""} · ${brl(o.amountBrl)}</small></div></div>
  <div class="r-metrics">${o.status==="pending"?'<span class="ap-m" style="color:var(--acx)">Aguardando confirmação</span>':o.status==="paid"?'<span class="ap-m" style="color:var(--g)">Pago e creditado</span>':'<span class="ap-m">Cancelado</span>'}</div></div>`).join(""):'<div class="ap-row"><p class="hint" style="margin:0">Você ainda não fez pedidos de mineração.</p></div>'}</div>`;
 }
}

/* ═══════════════════════════════════════════════════════════════
   FORJA DE BUFFS · central de buffs em tela cheia
   Os buffs vivem na carteira (wallet.buffs) e turbinam
   pesquisas, tarefas, anúncios e a mineração enquanto duram.
   ═══════════════════════════════════════════════════════════════ */
let fjTab="ativos";
function fjOpen(){if(!currentUser){toast("Entre na sua conta para abrir a Forja de Buffs.");return}$("fjgaveta").classList.add("open");$("fjv").classList.add("open");syncGavLock();fjRender()}
function fjClose(){$("fjgaveta").classList.remove("open");$("fjv").classList.remove("open");syncGavLock()}
$("fj-x").onclick=fjClose;
const fjAll=()=>{
 const now=Date.now();
 return (Array.isArray(wallet?.buffs)?wallet.buffs:[]).map(b=>{const st=b.startsAt?stampMs(b.startsAt):0;const dur=(Number(b.durDays)||7)*864e5;const end=b.endsAtMs?b.endsAtMs:st+dur;return{...b,active:end>now,msLeft:Math.max(0,end-now),totDur:dur||1}}).sort((a,b)=>(b.active?1:0)-(a.active?1:0)||(b.msLeft-a.msLeft));
};
function fjStats(){
 const on=fjAll().filter(x=>x.active);
 $("fj-stats").innerHTML=
  mnKpi("bolt","Buffs ativos",on.length,"green")+
  mnKpi("hammer","Turbo mineração","+"+Math.min(buffCap,buffPct("miningBoost"))+"%","gold")+
  mnKpi("check","Turbo tarefas","+"+Math.min(buffCap,buffPct("taskBoost"))+"%","gold")+
  mnKpi("flask","Turbo pesquisas","+"+Math.min(buffCap,buffPct("rewardBoost"))+"%","gold")+
  mnKpi("megaphone","Turbo anúncios","+"+Math.min(buffCap,buffPct("adBoost"))+"%","gold");
}
function fjRender(){
 $("fj-stats").hidden=fjTab!=="ativos";
 if(fjTab==="ativos")fjStats();
 const tabs=[["ativos","bolt","Meus buffs"],["loja","cart","Comprar"],["pedidos","note","Pedidos"]];
 $("fj-tabs").innerHTML=tabs.map(([k,ic2,l])=>`<button class="${fjTab===k?"on":""}" data-fjtab="${k}">${ico(ic2,17)}<span>${l}</span></button>`).join("");
 const b=$("fj-body");
 if(fjTab==="ativos"){
  const all=fjAll();
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("bolt",18)} Meus turbinos</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Buffs são turbinadores temporários comprados no Market: eles aumentam as recompensas de <b>pesquisas pagas</b>, <b>tarefas</b>, <b>anúncios</b> e o rendimento da <b>mineração</b> enquanto duram — quando expiram, saem sozinhos da lista. A força de cada tipo soma até o teto de +${buffCap}%.</p></div></div>
  <div style="display:grid;gap:10px;margin-top:12px">${all.length?all.map(x=>{const meta=BUFF_META[x.effect?.type]||["Recompensa","bolt"];const pr=Math.min(100,Math.round(x.msLeft/x.totDur*100));return `<div class="ap-row"${x.active?"":' style="opacity:.45"'}><div class="r-head"><span class="r-ico" style="color:var(--acx)">${ico(meta[1],16)}</span><div class="r-title"><b>${esc(x.name||"Buff")}</b><small>${x.active?`+${x.effect?.pct||0}% ${meta[0].toLowerCase()} · ${msLeftTxt(x.msLeft)} restantes`:"expirado"}</small></div></div>
  <div class="ap-bar"><i style="width:${pr}%"></i></div></div>`}).join(""):`<div class="ap-row"><p class="hint" style="margin:0">Nenhum buff comprado ainda. Compre um turbo na aba Comprar e ele entra em ação assim que a administração confirma o PIX.</p><button class="btn sm" data-fjtab="loja">Ver buffs <i class=yi data-i=bolt></i></button></div>`}</div>`;
 }else if(fjTab==="loja"){
  const list=storeItems.filter(x=>x.section==="buffs"&&x.active!==false).sort((a,c)=>(Number(a.sortOrder)||0)-(Number(c.sortOrder)||0));
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("cart",18)} Turbinos à venda</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Buffs comprados entram em ação assim que a administração confirma o PIX. Você pode acumular buffs diferentes — a força de cada tipo soma até o teto de +${buffCap}%.</p></div></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-top:14px">${list.length?list.map(x=>{const meta=BUFF_META[x.effect?.type]||["Recompensa","bolt"];return `<button type="button" class="ap-tcard" data-buy="${esc(x.id)}">
  <div class="t-head"><span class="t-ico">${ico(meta[1],17)}</span><b>${esc(x.name)}</b></div>
  ${x.badge?`<span class="pes-chip" style="background:var(--as);color:var(--acx);justify-self:start">${esc(x.badge)}</span>`:""}
  <p class="hint" style="margin:0;font-size:12px;line-height:1.5">${esc(x.desc||"")}</p>
  <span class="hint" style="font-size:11.5px">+${x.effect?.pct||0}% em ${meta[0].toLowerCase()} · ${x.durationDays} dias</span>
  <b class="mono" style="font-size:17px;color:var(--acx)">${brl(x.priceBrl)}</b>
  <span class="hint" style="font-size:10.5px">PIX · confirmação da administração</span>
  </button>`}).join(""):'<div class="ap-row"><p class="hint" style="margin:0">Nenhum buff à venda agora — volte em breve.</p></div>'}</div>`;
 }else{
  const orders=myOrders.filter(o=>o.section==="buffs");
  const pend=orders.filter(o=>o.status==="pending");
  b.innerHTML=`<div class="ap-hero"><div class="ap-hero-top"><b style="font-size:16px">${ico("note",18)} Pedidos de buffs</b>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.6">Cada buff comprado gera um pedido: <b>aguardando confirmação</b> significa que a administração ainda vai validar o PIX; <b>pago e creditado</b> significa que o turbo já está ativo na aba Meus buffs.</p></div></div>
  <div style="display:grid;gap:10px;margin-top:14px">${orders.length?orders.map(o=>`<div class="ap-row"><div class="r-head"><span class="r-ico" style="color:var(--acx)">${ico("bolt",16)}</span><div class="r-title"><b>${esc(o.item?.name||"Buff")}</b><small>${o.createdAt?fmt(o.createdAt):""} · ${brl(o.amountBrl)}</small></div></div>
  <div class="r-metrics">${o.status==="pending"?'<span class="ap-m" style="color:var(--acx)">Aguardando confirmação</span>':o.status==="paid"?'<span class="ap-m" style="color:var(--g)">Pago e creditado</span>':'<span class="ap-m">Cancelado</span>'}</div></div>`).join(""):'<div class="ap-row"><p class="hint" style="margin:0">Você ainda não fez pedidos de buffs.</p></div>'}</div>`;
 }
}
/* re-render ao vivo das centrais quando a gaveta está aberta */
const mnFjSync=()=>{try{if($("mnv").classList.contains("open"))mnRender()}catch(e){}try{if($("fjv").classList.contains("open"))fjRender()}catch(e){}};

/* ── saque ── */
async function wdGo(){
 if(!currentUser)return;
 const cfg=econCfg();
 const amt=Math.max(0,Number($("wd-amt")?.value)||0);
 const key=String($("wd-key")?.value||"").trim();
 if(amt<cfg.withdrawMin)return toast("Saque mínimo de "+brl(cfg.withdrawMin)+".");
 if(!validPixKey(key))return toast("Informe uma chave PIX válida.");
 const fee=Math.round(amt*cfg.withdrawFee*100)/100;
 const net=Math.round((amt-fee)*100)/100;
 if(!confirm("Solicitar saque de "+brl(amt)+(fee?" (taxa "+brl(fee)+", você recebe "+brl(net)+")":"")+" via PIX para:\n"+key))return;
 try{
  await runTransaction(db,async tx=>{
   const ws=await tx.get(doc(db,"wallets",currentUser.uid));
   const w=ws.exists()?ws.data():{};
   if(availCombined(w)<amt-0.001)throw new Error("Saldo em reais insuficiente.");
   debitCombined(w,amt);
   tx.set(doc(db,"wallets",currentUser.uid),{...w,updatedAt:serverTimestamp()});
   tx.set(doc(collection(db,"withdrawals")),{uid:currentUser.uid,userName:maskName(profile?.name||"Participante"),amountBrl:amt,feeBrl:fee,netBrl:net,pixKey:key,status:"pending",priority:vipMe?.vip===true,createdAt:serverTimestamp()});
   tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"withdraw_request",amount:0,brl:amt,reason:"Saque PIX solicitado ("+key.slice(0,24)+")",createdAt:serverTimestamp()});
  });
  toast("Saque solicitado! A equipe paga o PIX em até "+cfg.withdrawDays+" dia(s) úteis.");
  walRender();
 }catch(e){toast(String(e?.message||e))}
}

/* ── delegação de cliques do Market / Carteira / Pagamento ── */
document.addEventListener("click",e=>{
 const tab=e.target.closest("[data-mkttab]");
 if(tab){mktTab=tab.dataset.mkttab;mktRender();return}
 const mnb=e.target.closest("[data-mntab]");
 if(mnb){mnTab=mnb.dataset.mntab;mnRender();return}
 const fjb=e.target.closest("[data-fjtab]");
 if(fjb){fjTab=fjb.dataset.fjtab;fjRender();return}
 const evtb=e.target.closest("[data-evttab]");
 if(evtb){const v=evtb.dataset.evttab;if(v==="active"||v==="future"||v==="ended"){evView=v;ecView="eventos"}else{ecView=v;if(v==="ranking")ecRkSubscribe()}renderEvents();return}
 if(e.target.closest("[data-evtopen]")){evtOpen();return}
 if(e.target.closest("[data-vipopen]")){vipOpen();return}
 if(e.target.closest("[data-vipck]")){vipClose();evtOpen();ecView="checkin";renderEvents();return}
 if(e.target.closest("[data-viptask]")){vipClose();openOg();return}
 const mno=e.target.closest("[data-mn]");
 if(mno){walClose();mnOpen();return}
 const fjo=e.target.closest("[data-fj]");
 if(fjo){walClose();fjOpen();return}
 const wtab=e.target.closest("[data-waltab]");
 if(wtab){walTab=wtab.dataset.waltab;walRender();return}
 const wgo=e.target.closest("[data-wgo]");
 if(wgo){walTab=wgo.dataset.wgo;walRender();return}
 const wmk=e.target.closest("[data-wmk]");
 if(wmk){walClose();mktTab=wmk.dataset.wmk;mktRender();mktOpen();return}
 const buy=e.target.closest("[data-buy]");
 if(buy){const it=storeItems.find(x=>x.id===buy.dataset.buy);if(it)payOpen(it);return}
 const cm=e.target.closest("[data-convmode]");
 if(cm){convMode=cm.dataset.convmode;convMenuOpen=false;walRender();return}
 const cmo=e.target.closest("[data-convmenu]");
 if(cmo){convMenuOpen=!convMenuOpen;walRender();return}
 const cg2=e.target.closest("[data-convgo2]");
 if(cg2){convMode="b2c";walTab="converter";walRender();const s=$("cv-sym");if(s)s.value=cg2.dataset.convgo2;walConvPreview();return}
 if(e.target.closest("[data-conv-go]")){walConvGo();return}
 if(e.target.closest("[data-mine-collect]")){mineCollect(e.target.closest("[data-mine-collect]").dataset.mineCollect);return}
 if(e.target.closest("[data-wd-go]")){wdGo();return}
 if(e.target.closest("[data-pay-copy]")){
  const code=$("pay-body")?.querySelector(".ap-code")?.textContent||"";
  try{navigator.clipboard.writeText(code);toast("Código PIX copiado! Cole no app do seu banco.")}catch(err){toast("Copie o código manualmente abaixo do QR Code.")}
  return;
 }
 if(e.target.closest("[data-pay-paid]")){payConfirmPaid();return}
 if(e.target.closest("[data-pay-cancel]")){payClose();return}
});

/* ============================================================
   40 · FICHAS YSHIPP (Moedas · Bilhetes · Diamantes) + APPHUB
   ------------------------------------------------------------
   COTAÇÃO FIXA (referência em reais — o real continua sendo o centro):
   · 10 Moedas Yshipp  = R$ 0,01  → 1 moeda   = R$ 0,001
   · 1  Bilhete        = R$ 0,50
   · 1  Diamante       = R$ 1,00
   Regras:
   · Fichas NUNCA são convertidas em reais — apenas entre si.
   · Moedas: só servem para pagamento de tarefas (taxa de publicação
     de colaboradores e recompensas em moedas).
   · Bilhetes: trocáveis por números de sorteio (1 bilhete = R$ 0,50).
   · Diamantes: servem de lances nos leilões (1 diamante = R$ 1,00).
   Saldos guardados na MESMA carteira (wallets/{uid}): campos
   coins, tickets e diamonds (inteiros, ao lado dos reais).
   ============================================================ */
const XC_RATE={coin:0.001,ticket:0.5,diamond:1};
const XC_NAME={coin:"moeda(s)",ticket:"bilhete(s)",diamond:"diamante(s)"};
const XC_LABEL={coin:"Moedas Yshipp",ticket:"Bilhetes",diamond:"Diamantes"};
const nf=v=>Math.max(0,Math.floor(Number(v)||0)).toLocaleString("pt-BR");
const xcBal=k=>Math.max(0,Math.floor(Number(wallet?.[k])||0));
const xcBrlTotal=()=>xcBal("coin")*XC_RATE.coin+xcBal("ticket")*XC_RATE.ticket+xcBal("diamond")*XC_RATE.diamond;
/* texto de recompensa na moeda certa: "R$ 2,00", "4 bilhete(s) (≈ R$ 2,00)"… */
function xcRewardTxt(cur,qty){
 qty=Math.max(0,Math.floor(Number(qty)||0));
 if(cur==="ticket")return nf(qty)+" bilhete(s) (≈ "+fmtBRL(qty*XC_RATE.ticket)+")";
 if(cur==="coin")return nf(qty)+" moeda(s) (≈ "+fmtBRL(qty*XC_RATE.coin)+")";
 if(cur==="diamond")return nf(qty)+" diamante(s) (≈ "+fmtBRL(qty*XC_RATE.diamond)+")";
 return fmtBRL(qty);
}
/* forma curta para cards: "R$ 2,00" · "2 bilhete(s)" · "1.000 moeda(s)" · "3 diamante(s)" */
const xcShort=(cur,qty)=>cur==="ticket"?nf(qty)+" bilhete(s)":cur==="coin"?nf(qty)+" moeda(s)":cur==="diamond"?nf(qty)+" diamante(s)":fmtBRL(qty);
/* novos tipos de histórico (carteira inteligente) */
Object.assign(HKIND,{
 xc_buy:["Compra de fichas no Market",HICON.cart],
 xc_convert:["Conversão entre fichas",HICON.swap],
 xc_reward:["Recompensa em fichas",HICON.star],
 xc_spend:["Uso de fichas",HICON.ticket],
 xc_refund:["Devolução de fichas",HICON.undo],
 app_install:["Instalação aprovada (AppHub)",HICON.pick],
 app_reward:["Recompensa do AppHub",HICON.bolt]
});
/* pacotes fixos de fichas à venda na aba Pacotes do Market (PIX) */
const XCPACKS=[
 {id:"fichas-coin-500",section:"fichas",xcKind:"coin",xcQty:500,priceBrl:0.5,icon:"coins",name:"500 Moedas Yshipp",desc:"Moeda das tarefas: pague taxas de publicação de colaboradores e receba recompensas em moedas."},
 {id:"fichas-coin-2000",section:"fichas",xcKind:"coin",xcQty:2000,priceBrl:2,icon:"coins",name:"2.000 Moedas Yshipp",desc:"Moeda das tarefas com 0% de tarifa extra — cotação fixa de 10 moedas = R$ 0,01."},
 {id:"fichas-coin-10000",section:"fichas",xcKind:"coin",xcQty:10000,priceBrl:10,icon:"coins",name:"10.000 Moedas Yshipp",desc:"Pacote grande da moeda das tarefas — ideal para colaboradores que publicam ofertas com frequência."},
 {id:"fichas-ticket-2",section:"fichas",xcKind:"ticket",xcQty:2,priceBrl:1,icon:"ticket",name:"2 Bilhetes Yshipp",desc:"Cada bilhete vale R$ 0,50 e pode ser trocado por números de sorteio na hora de reservar."},
 {id:"fichas-ticket-10",section:"fichas",xcKind:"ticket",xcQty:10,priceBrl:5,icon:"ticket",name:"10 Bilhetes Yshipp",desc:"Bilhetes trocáveis por números de sorteio — 1 bilhete = R$ 0,50 de número."},
 {id:"fichas-ticket-40",section:"fichas",xcKind:"ticket",xcQty:40,priceBrl:20,icon:"ticket",name:"40 Bilhetes Yshipp",desc:"Reserve números sem mexer no saldo em reais — os bilhetes fazem a troca por você."},
 {id:"fichas-diamond-1",section:"fichas",xcKind:"diamond",xcQty:1,priceBrl:1,icon:"gift",name:"1 Diamante Yshipp",desc:"Diamantes valem R$ 1,00 cada e são usados como lances nos leilões."},
 {id:"fichas-diamond-5",section:"fichas",xcKind:"diamond",xcQty:5,priceBrl:5,icon:"gift",name:"5 Diamantes Yshipp",desc:"Dê lances em diamantes sem tocar no seu saldo em reais — 1 diamante = R$ 1,00 de lance."},
 {id:"fichas-diamond-20",section:"fichas",xcKind:"diamond",xcQty:20,priceBrl:20,icon:"gift",name:"20 Diamantes Yshipp",desc:"Pacote de diamantes para quem disputa leilões de olho no prêmio."}
];
function XCPACKS_HTML(){
 return `<div class="ap-sec" style="margin-top:16px">Pacotes de fichas · moedas, bilhetes e diamantes</div>
 <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-top:10px">
 ${XCPACKS.map(x=>`<button type="button" class="ap-tcard" data-buyf="${esc(x.id)}">
  <div class="t-head"><span class="t-ico">${ico(x.icon,17)}</span><b>${esc(x.name)}</b></div>
  <span class="pes-chip" style="background:var(--as);color:var(--acx);justify-self:start">${x.xcKind==="coin"?"Moeda das tarefas":x.xcKind==="ticket"?"Vira número de sorteio":"Lance de leilão"}</span>
  <p class="hint" style="margin:0;font-size:12px;line-height:1.5">${esc(x.desc)}</p>
  <span class="hint" style="font-size:11.5px">Cotação fixa: ${x.xcKind==="coin"?"10 moedas = R$ 0,01":x.xcKind==="ticket"?"1 bilhete = R$ 0,50":"1 diamante = R$ 1,00"} · não converte em reais</span>
  <b class="mono" style="font-size:17px;color:var(--acx)">${brl(x.priceBrl)}</b>
  <span class="hint" style="font-size:10.5px">PIX · confirmação da administração</span>
 </button>`).join("")}
 </div>`;
}
/* conversão ENTRE fichas (nunca para reais): cotação fixa via reais */
async function xcConvertGo(){
 if(!currentUser)return toast("Entre na sua conta para converter fichas.");
 const from=$("xc-from")?.value,to=$("xc-to")?.value,q=Math.max(0,Math.floor(Number($("xc-amt")?.value)||0));
 if(!from||!to)return;
 if(from===to)return toast("Escolha duas fichas diferentes para converter.");
 if(q<1)return toast("Informe a quantidade a converter.");
 const out=Math.floor(q*XC_RATE[from]/XC_RATE[to]);
 if(out<1)return toast("Quantidade muito pequena — a conversão arredonda para baixo e daria menos de 1 "+XC_NAME[to].replace("(s)","")+".");
 const have=xcBal(from);
 if(have<q)return toast("Você tem "+nf(have)+" "+XC_NAME[from]+" — saldo insuficiente para converter "+nf(q)+".");
 if(!confirm("Converter "+nf(q)+" "+XC_NAME[from]+" em "+nf(out)+" "+XC_NAME[to]+"?\n\nCotação fixa · a operação não pode ser desfeita."))return;
 try{
  const cbtn=document.querySelector("[data-xc-go]");if(cbtn){cbtn.disabled=true;cbtn.style.opacity=.6}
  const chost=$("wal-body");
  if(chost&&!chost.querySelector(".xc-anim")){const cd=document.createElement("div");cd.className="xc-anim";cd.innerHTML='<span class="xc-coin1"></span><span class="xc-coin2"></span><small>Convertendo suas fichas…</small>';chost.prepend(cd)}
  await new Promise(r=>setTimeout(r,5000));
  const cda=chost&&chost.querySelector(".xc-anim");if(cda)cda.remove();
  const cb2=document.querySelector("[data-xc-go]");if(cb2){cb2.disabled=false;cb2.style.opacity=""}
 }catch(e){}
 try{
  await runTransaction(db,async tx=>{
   const ws=await tx.get(doc(db,"wallets",currentUser.uid));
   const w=ws.exists()?ws.data():{};
   if(Math.max(0,Math.floor(Number(w[from])||0))<q)throw new Error("Saldo de "+XC_LABEL[from]+" insuficiente.");
   w[from]=Math.max(0,Math.floor(Number(w[from])||0))-q;
   w[to]=Math.max(0,Math.floor(Number(w[to])||0))+out;
   tx.set(doc(db,"wallets",currentUser.uid),{...w,updatedAt:serverTimestamp()},{merge:true});
   tx.set(doc(collection(db,"wallets",currentUser.uid,"history")),{kind:"xc_convert",amount:0,xcKind:from+"2"+to,xcQty:q,reason:"Conversão: "+nf(q)+" "+XC_NAME[from]+" → "+nf(out)+" "+XC_NAME[to],createdAt:serverTimestamp()});
  });
  toast("Conversão feita: "+nf(q)+" "+XC_NAME[from]+" → "+nf(out)+" "+XC_NAME[to]+".");
  walRender();
 }catch(e){toast(e.message||"Erro ao converter fichas.")}
}

/* ============================================================
   41 · YSHIPP APPHUB (antes "Central de aplicativos")
   Aplicativos colocados pela equipe no painel (coleção "apps").
   O usuário ganha pela INSTALAÇÃO (mediante prova, aprovada pela
   equipe) e por ATIVIDADES pré-definidas dentro do app, liberadas
   após a instalação aprovada e pagas mediante prova. Recompensas:
   reais, bilhetes, moedas, diamantes — e extras (pacotes, mineração
   e buffs) entregues pela equipe, conectados ao Yshipp Market.
   Coleções: apps · appInstalls/{uid}_{appId} · appActivityClaims/{uid}_{appId}_{actId}
   ============================================================ */
let apps=[],appInstalls={},appActClaims={},ahView="apps",ahOpenFlag=false,ahUns=[];
const ahStop=()=>{ahUns.forEach(f=>{try{f()}catch(e){}});ahUns=[];apps=[];appInstalls={};appActClaims={}};
function ahWatch(){
 if(ahUns.length||!currentUser)return;
 try{
  ahUns.push(onSnapshot(query(collection(db,"apps"),where("active","==",true)),s=>{
   apps=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0));
   const c=$("res-ah-open");if(c)c.textContent=String(apps.length);
   try{if(ahOpenFlag)ahRender()}catch(e){}
  },e=>console.warn("AppHub:",e)));
  ahUns.push(onSnapshot(query(collection(db,"appInstalls"),where("uid","==",currentUser.uid)),s=>{
   appInstalls={};s.docs.forEach(d=>appInstalls[d.data().appId]=({id:d.id,...d.data()}));
   try{if(ahOpenFlag)ahRender()}catch(e){}
  },e=>console.warn("AppHub:",e)));
  ahUns.push(onSnapshot(query(collection(db,"appActivityClaims"),where("uid","==",currentUser.uid)),s=>{
   appActClaims={};s.docs.forEach(d=>{const v=d.data();appActClaims[v.appId+"_"+v.actId]={id:d.id,...v}});
   try{if(ahOpenFlag)ahRender()}catch(e){}
  },e=>console.warn("AppHub:",e)));
 }catch(e){console.warn("AppHub:",e)}
}
function ahOpen(){
 if(!currentUser?.emailVerified)return toast("Entre com uma conta verificada para usar o AppHub.");
 ahOpenFlag=true;ahWatch();
 $("appgaveta").classList.add("open");$("appv").classList.add("open");syncGavLock();
 ahRender();
}
function ahClose(){ahOpenFlag=false;$("appgaveta").classList.remove("open");$("appv").classList.remove("open");syncGavLock()}
function ahRewardTxt(r){
 if(!r||!Number(r.qty))return"Em breve — combine com o organizador";
 const t=xcRewardTxt(r.cur||"brl",r.qty);
 return r.extra?t+" + "+esc(r.extra):t;
}
const ahInstOf=id=>appInstalls[id];
const ahClaimOf=(aid,actId)=>appActClaims[aid+"_"+actId];
function ahAppCard(a){
 const inst=ahInstOf(a.id);
 const acts=Array.isArray(a.activities)?a.activities:[];
 const st=inst?.status||"none";
 const done=acts.filter(x=>ahClaimOf(a.id,x.id)?.status==="approved").length;
 const ic=String(a.icon||"").trim();
 return `<div class="card evc" style="display:grid;gap:9px;align-content:start">
  <div style="display:flex;gap:10px;align-items:center">
   <span style="width:44px;height:44px;border-radius:12px;background:var(--as);border:1px solid var(--ac);display:grid;place-items:center;font-size:22px;flex:none">${ic&&/^https?:\/\//i.test(ic)?`<img src="${esc(ic)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`:(ic?esc(ic):'<i class=yi data-i=mobile style="width:22px;height:22px"></i>')}</span>
   <div style="min-width:0"><b style="font-size:14.5px">${esc(a.name||"App")}</b><small class="hint" style="display:block">${esc(a.category||"App parceiro")}</small></div>
   <span class="tag ${st==="approved"?"g":st==="pending"?"y":st==="rejected"?"r":""}" style="margin-left:auto">${st==="approved"?"<i class=yi data-i=checkc></i> Instalado":st==="pending"?"<i class=yi data-i=hourglass></i> Em análise":st==="rejected"?"<i class=yi data-i=ban></i> Rejeitado":"Novo"}</span>
  </div>
  <p class="hint" style="margin:0;font-size:12.5px;line-height:1.55">${esc(a.desc||"")}</p>
  <div class="lrow"><span class="tn">Quanto você ganha</span><span class="lval"><i class=yi data-i=gift></i> ${ahRewardTxt(a.install&&Number(a.install.qty)?a.install:(acts.length?{cur:(acts.find(x=>x.reward&&Number(x.reward.qty))||{reward:{}}).reward?.cur||"brl",qty:acts.reduce((s,x)=>s+(Number(x.reward?.qty)||0),0)}:null))}</span></div>
  <div class="kv"><span>Atividades dentro do app</span><b>${done}/${acts.length} concluída(s)</b></div>
  ${acts.length?`<div class="app-act-preview"><b style="font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:var(--mu)">O que você pode fazer</b>${acts.map(x=>`<div style="margin-top:6px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>${esc(x.title||"Atividade")}</span><b class="gold" style="font-size:12px">${ahRewardTxt(x.reward)}</b></div>`).join("")}${st!=="approved"?`<p class="hint" style="margin:8px 0 0;font-size:11.5px">Você já vê as atividades. Depois da instalação aprovada, envia as provas aqui.</p>`:""}</div>`:""}
  ${st==="none"||st==="rejected"?`
  <div class="actions" style="margin:0">
   ${a.link?`<a class="btn sm" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" data-ah-go="${esc(a.id)}">${ico("external",14)} Instalar o app</a>`:""}
   <button class="btn sm ghost" type="button" data-ah-form="${esc(a.id)}"><i class=yi data-i=paperclip></i> Enviar prova de instalação</button>
  </div>
  <div id="ah-form-${esc(a.id)}" hidden style="display:grid;gap:8px;border:1px dashed var(--l);border-radius:10px;padding:10px">
   <span class="hint" style="font-size:11.5px">${esc(a.proofHelp||"Instale o app pelo botão acima e envie a prova (print da tela do app instalado ou texto com o seu usuário lá dentro). A equipe confere e libera as atividades.")}</span>
   <input data-ah-pt="${esc(a.id)}" placeholder="Texto da prova (ex.: seu usuário no app)" maxlength="300">
   <input data-ah-pi="${esc(a.id)}" placeholder="Link do print (https://…)" maxlength="600">
   <button class="btn sm" type="button" data-ah-inst="${esc(a.id)}"><i class=yi data-i=send></i> Enviar para análise</button>
  </div>`:""}
  ${st==="pending"?`<p class="hint" style="margin:0"><i class=yi data-i=hourglass></i> Prova enviada em ${inst?.createdAt?fmt(inst.createdAt):"—"}. Assim que a equipe aprovar, as atividades do app liberam aqui.</p>`:""}
  ${st==="approved"?`<div style="display:grid;gap:8px">
   <span class="ap-sec">Atividades do app</span>
   ${acts.length?acts.map(x=>ahActRow(a,x)).join(""):'<p class="hint" style="margin:0">Este app ainda não tem atividades cadastradas.</p>'}
  </div>`:""}
 </div>`;
}
function ahActRow(a,x){
 const c=ahClaimOf(a.id,x.id);
 const st=c?.status||"none";
 const pr=x.proof||{};
 const fid="ahf_"+a.id+"_"+x.id;
 return `<div style="border:1px solid var(--l);border-radius:10px;padding:10px;display:grid;gap:7px;background:var(--p2)">
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:13px">${esc(x.title||"Atividade")}</b><span class="tag g" style="margin-left:auto">${ahRewardTxt(x.reward)}</span>${st==="approved"?'<span class="tag g"><i class=yi data-i=checkc></i> Aprovada</span>':st==="pending"?'<span class="tag y"><i class=yi data-i=hourglass></i> Em análise</span>':st==="rejected"?'<span class="tag r"><i class=yi data-i=ban></i> Rejeitada</span>':""}</div>
  ${x.desc?`<p class="hint" style="margin:0;font-size:12px">${esc(x.desc)}</p>`:""}
  ${st==="none"?`<button class="btn sm ghost" type="button" data-ah-actform="${esc(a.id)}|${esc(x.id)}" data-fid="${fid}"><i class=yi data-i=paperclip></i> Enviar prova desta atividade</button>
  <div id="${fid}" hidden style="display:grid;gap:7px">
   ${pr.text!==false?'<input data-f="text" placeholder="Texto da prova (ex.: @ do perfil, código, cupom)" maxlength="300">':""}
   ${pr.code?'<input data-f="code" placeholder="Código / cupom" maxlength="300">':""}
   ${pr.image!==false?'<input data-f="image" placeholder="Link do print (https://…)" maxlength="600">':""}
   ${pr.video?'<input data-f="video" placeholder="Link da gravação de tela (https://…)" maxlength="600">':""}
   ${pr.datetime?'<input data-f="datetime" placeholder="Data e hora da execução (ex.: 11/11/2026 14:30)" maxlength="40">':""}
   <button class="btn sm" type="button" data-ah-act="${esc(a.id)}|${esc(x.id)}"><i class=yi data-i=send></i> Enviar prova</button>
  </div>`:""}
  ${st==="rejected"&&c?.reviewNote?`<p class="hint" style="margin:0;color:var(--rd)">Motivo: ${esc(c.reviewNote)}</p>`:""}
 </div>`;
}
function ahRender(){
 if(!ahOpenFlag)return;
 const tabs=[["apps","mobile","Aplicativos"],["minhas","checkc","Minhas participações"],["guia","book","Como funciona"]];
 $("ah-tabs").innerHTML=tabs.map(([k,ic,l])=>`<button type="button" data-ahtab="${k}" class="${ahView===k?"on":""}">${ico(ic,17)}<span>${l}</span></button>`).join("");
 const st=$("ah-stats");
 if(st){
  const mine=Object.values(appInstalls);
  const done=Object.values(appActClaims).filter(c=>c.status==="approved").length;
  st.innerHTML=[["mobile","Apps no ar",apps.length,""],["checkc","Instalações aprovadas",mine.filter(i=>i.status==="approved").length,"green"],["hourglass","Em análise",mine.filter(i=>i.status==="pending").length,"gold"],["star","Atividades concluídas",done,"gold"]].map(([ic,l,v,c])=>`<div class="ap-kpi"><span class="kl">${ico(ic,14)}${l}</span><b class="${c}">${v}</b></div>`).join("");
 }
 const b=$("ah-body");if(!b)return;
 if(ahView==="apps"){
  b.innerHTML=`<div class="sec-head" style="margin-bottom:12px"><h2 style="font-size:22px">Aplicativos parceiros</h2><p>Instale, comprove e complete atividades dentro dos apps. A instalação libera as atividades; cada atividade aprovada credita a recompensa na sua carteira.</p></div>
  ${apps.length?`<div class="stack">${apps.map(ahAppCard).join("")}</div>`:'<div class="empty" style="padding:30px;text-align:center;border:1px dashed var(--l);border-radius:12px;color:var(--mu)"><p class="hint">Nenhum aplicativo no ar agora. A equipe publica novos apps aqui — fique de olho!</p></div>'}`;
  return;
 }
 if(ahView==="minhas"){
  const insts=Object.values(appInstalls);
  const claims=Object.values(appActClaims);
  b.innerHTML=`<div class="sec-head" style="margin-bottom:12px"><h2 style="font-size:22px">Minhas participações</h2><p>Todas as suas instalações e provas de atividades enviadas ao AppHub.</p></div>
  ${insts.length||claims.length?`<div class="stack">
   ${insts.map(i=>`<div class="card evc" style="display:grid;gap:6px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${esc(i.appName||"App")}</b><span class="tag ${i.status==="approved"?"g":i.status==="rejected"?"r":"y"}" style="margin-left:auto">${i.status==="approved"?"<i class=yi data-i=checkc></i> Instalação aprovada":i.status==="rejected"?"<i class=yi data-i=ban></i> Rejeitada":"<i class=yi data-i=hourglass></i> Em análise"}</span></div><small class="hint">${i.createdAt?fmt(i.createdAt):""}${i.reviewNote?" · "+esc(i.reviewNote):""}</small></div>`).join("")}
   ${claims.map(c=>`<div class="card evc" style="display:grid;gap:6px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${esc(c.actTitle||"Atividade")}</b><small class="hint">${esc(c.appName||"")}</small><span class="tag ${c.status==="approved"?"g":c.status==="rejected"?"r":"y"}" style="margin-left:auto">${c.status==="approved"?"<i class=yi data-i=checkc></i> Aprovada":c.status==="rejected"?"<i class=yi data-i=ban></i> Rejeitada":"<i class=yi data-i=hourglass></i> Em análise"}</span></div><small class="hint">${c.createdAt?fmt(c.createdAt):""}${c.reviewNote?" · "+esc(c.reviewNote):""}</small></div>`).join("")}
  </div>`:'<div class="empty" style="padding:30px;text-align:center;border:1px dashed var(--l);border-radius:12px;color:var(--mu)"><p class="hint">Você ainda não enviou provas no AppHub. Abra a aba Apps e instale o primeiro!</p></div>'}`;
  return;
 }
 b.innerHTML=`<div class="sec-head" style="margin-bottom:12px"><h2 style="font-size:22px">Como funciona o AppHub</h2><p>O hub de aplicativos do Yshippcommerce: a equipe publica apps parceiros e você ganha por instalar e usar.</p></div>
 <div class="stack">
  <div class="card evc"><b>1 · Instale o app</b><p class="hint" style="margin:0">Abra o app pelo botão da loja oficial (Play Store / App Store / site), use-o de verdade e envie a prova de instalação (print ou seu usuário lá dentro).</p></div>
  <div class="card evc"><b>2 · Análise da instalação</b><p class="hint" style="margin:0">A equipe confere a prova e aprova. Aprovou, a recompensa de instalação cai na sua carteira — pode ser em reais, bilhetes, moedas ou diamantes, além de extras como pacotes, mineração e buffs.</p></div>
  <div class="card evc"><b>3 · Atividades desbloqueadas</b><p class="hint" style="margin:0">Com a instalação aprovada, as atividades pré-definidas do app liberam (ex.: criar perfil, publicar, convidar um amigo). Cada uma tem prova própria e recompensa própria.</p></div>
  <div class="card evc"><b>4 · Cotação das fichas</b><p class="hint" style="margin:0">10 moedas = R$ 0,01 · 1 bilhete = R$ 0,50 · 1 diamante = R$ 1,00. A cotação serve de referência para você saber quanto vale cada recompensa. Fichas <b>nunca</b> viram reais — são convertidas apenas entre si, na aba Fichas da YshippWallet. Compre fichas no <b>Yshipp Market</b>, aba Pacotes.</p></div>
  <div class="card evc"><b>5 · Segurança</b><p class="hint" style="margin:0">Nunca envie senhas ou dados bancários como prova. Provas falsas anulam recompensas e podem suspender a conta. A análise final é sempre da equipe Yshippcommerce.</p></div>
 </div>`;
}
async function ahSubmitInstall(aid){
 const a=apps.find(x=>x.id===aid);if(!a)return;
 if(!currentUser?.emailVerified)return toast("Entre com uma conta verificada.");
 const box=$("ah-form-"+aid);if(!box)return;
 const txt=String(box.querySelector("[data-ah-pt]")?.value||"").trim().slice(0,300);
 const img=String(box.querySelector("[data-ah-pi]")?.value||"").trim().slice(0,600);
 if(!txt&&!img)return toast("Envie ao menos uma prova: texto ou print da instalação.");
 if(img&&!/^https?:\/\//i.test(img))return toast("O link do print deve começar com http:// ou https://.");
 try{
  await setDoc(doc(db,"appInstalls",currentUser.uid+"_"+aid),{
   uid:currentUser.uid,appId:aid,appName:a.name||"App",
   participantName:maskName(profile?.name||"Participante"),email:currentUser.email||"",photo:myPhoto(),
   proofText:txt,proofImage:img,status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  },{merge:true});
  toast("Prova de instalação enviada! A equipe vai analisar e liberar as atividades. <i class=yi data-i=mobile></i>");
  box.hidden=true;
 }catch(e){showError(e)}
}
async function ahSubmitAct(aid,actId){
 const a=apps.find(x=>x.id===aid);if(!a)return;
 const act=(a.activities||[]).find(x=>x.id===actId);if(!act)return;
 const inst=ahInstOf(aid);
 if(!inst||inst.status!=="approved")return toast("A instalação deste app precisa estar aprovada antes das atividades.");
 const old=ahClaimOf(aid,actId);
 if(old&&(old.status==="pending"||old.status==="approved"))return toast("Esta atividade já foi enviada"+(old.status==="approved"?" e aprovada.":" e está em análise."));
 const box=$("ahf_"+aid+"_"+actId);if(!box)return;
 const g=k=>String(box.querySelector(`[data-f="${k}"]`)?.value||"").trim();
 const vals={text:g("text").slice(0,300),code:g("code").slice(0,300),image:g("image").slice(0,600),video:g("video").slice(0,600),datetime:g("datetime").slice(0,40)};
 const pr=act.proof||{};
 const need=Object.keys(pr).filter(k=>pr[k]);
 const filled=need.filter(k=>vals[k]);
 if(need.length&&!filled.length)return toast("Preencha as provas exigidas desta atividade.");
 const bad=filled.find(k=>(k==="image"||k==="video")&&!/^https?:\/\//i.test(vals[k]));
 if(bad)return toast("O link da prova ("+bad+") deve começar com http:// ou https://.");
 try{
  await setDoc(doc(db,"appActivityClaims",currentUser.uid+"_"+aid+"_"+actId),{
   uid:currentUser.uid,appId:aid,appName:a.name||"App",actId,actTitle:act.title||"Atividade",
   participantName:maskName(profile?.name||"Participante"),email:currentUser.email||"",photo:myPhoto(),
   ...vals,status:"pending",reward:act.reward||null,extra:act.reward?.extra||"",
   createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  },{merge:true});
  toast("Prova enviada! A equipe vai analisar e creditar a recompensa. <i class=yi data-i=rocket></i>");
  box.hidden=true;
 }catch(e){showError(e)}
}
/* eventos do AppHub + fichas */
document.addEventListener("click",e=>{
 const ah=e.target.closest("[data-apphub]");
 if(ah){e.preventDefault();ahOpen();return}
 if(e.target.closest("#ah-x"))return ahClose();
 const tab=e.target.closest("[data-ahtab]");
 if(tab){ahView=tab.dataset.ahtab;ahRender();return}
 const go=e.target.closest("[data-ah-go]");
 if(go){try{$("ah-form-"+go.dataset.ahGo).hidden=false}catch(x){}return}
 const form=e.target.closest("[data-ah-form]");
 if(form){const f=$("ah-form-"+form.dataset.ahForm);if(f)f.hidden=!f.hidden;return}
 const inst=e.target.closest("[data-ah-inst]");
 if(inst)return ahSubmitInstall(inst.dataset.ahInst);
 const af=e.target.closest("[data-ah-actform]");
 if(af){const f=$(af.dataset.fid);if(f)f.hidden=!f.hidden;return}
 const act=e.target.closest("[data-ah-act]");
 if(act){const[aid,actId]=String(act.dataset.ahAct).split("|");return ahSubmitAct(aid,actId)}
 const bf=e.target.closest("[data-buyf]");
 if(bf){const p=XCPACKS.find(x=>x.id===bf.dataset.buyf);if(p)payOpen(p);return}
 if(e.target.closest("[data-xc-go]"))return xcConvertGo();
});
/* teclado: o card do AppHub é role=button — Enter/Espaço abrem */
document.addEventListener("keydown",e=>{
 if(e.key!=="Enter"&&e.key!==" ")return;
 if(e.target.closest?.("[data-apphub]")){e.preventDefault();ahOpen()}
});
/* devolução de fichas quando a equipe recusa uma instalação/atividade é
   feita pelo painel; aqui nada é creditado automaticamente. */
