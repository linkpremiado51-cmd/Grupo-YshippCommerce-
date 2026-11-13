(function(){
"use strict";
if(window.__yddInstalled)return;window.__yddInstalled=1;

var VDESC=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value");
var SIDESC=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"selectedIndex");
var CHECK='<svg class="ydd-k" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.6l5 5L20 6.6"/></svg>';
var CARET='<svg class="ydd-c" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

function enhance(sel){
 if(sel.__ydd||sel.multiple)return;
 sel.__ydd=1;
 var w=document.createElement("span");
 w.className="ydd";
 var iw=sel.style.width;if(iw)w.style.width=iw;
 sel.parentNode.insertBefore(w,sel);
 w.appendChild(sel);
 var b=document.createElement("button");
 b.type="button";b.className="ydd-b";
 b.setAttribute("role","combobox");b.setAttribute("aria-haspopup","listbox");
 b.innerHTML='<span class="ydd-v"></span>'+CARET;
 var l=document.createElement("ul");
 l.className="ydd-l";l.setAttribute("role","listbox");l.setAttribute("aria-expanded","false");
 w.appendChild(b);w.appendChild(l);

 function lab(){
  var o=sel.options[sel.selectedIndex];
  var v=b.firstChild;
  v.textContent=o?o.textContent.replace(/\s+/g," ").trim():"";
  v.classList.toggle("empty",!o||!o.value);
  b.setAttribute("aria-disabled",sel.disabled?"true":"false");
 }
 function draw(){
  var cur=sel.value;
  l.innerHTML="";
  var g=null;
  for(var i=0;i<sel.options.length;i++){
   var o=sel.options[i];
   var pg=o.parentNode;
   if(pg&&pg.tagName==="OPTGROUP"&&pg!==g){
    g=pg;
    var gh=document.createElement("li");
    gh.className="ydd-g";gh.textContent=pg.getAttribute("label")||"";
    l.appendChild(gh);
   }
   var li=document.createElement("li");
   li.className="ydd-o"+(o.value===cur?" sel":"")+(o.disabled?" dis":"");
   li.setAttribute("role","option");
   li.setAttribute("data-i",i);
   li.setAttribute("data-v",o.value);
   li.innerHTML=CHECK+"<span></span>";
   li.lastChild.textContent=o.textContent.replace(/\s+/g," ").trim();
   l.appendChild(li);
  }
 }
 function open(){
  draw();
  var r=w.getBoundingClientRect();
  w.classList.toggle("up",r.bottom+270>innerHeight&&r.top>280);
  w.classList.add("on");b.classList.add("on");
  l.setAttribute("aria-expanded","true");
  var s=l.querySelector(".ydd-o.sel")||l.querySelector(".ydd-o:not(.dis)");
  if(s){s.classList.add("act");s.scrollIntoView({block:"nearest"});}
  b.setAttribute("aria-activedescendant",s?s.dataset.i:"");
 }
 function close(){
  w.classList.remove("on");b.classList.remove("on");
  l.setAttribute("aria-expanded","false");
  var a=l.querySelector(".ydd-o.act");if(a)a.classList.remove("act");
 }
 function pick(li){
  if(!li||li.classList.contains("dis"))return;
  VDESC.set.call(sel,li.dataset.v);
  lab();
  close();
  sel.dispatchEvent(new Event("input",{bubbles:true}));
  sel.dispatchEvent(new Event("change",{bubbles:true}));
  b.focus();
 }

 /* rótulo sempre em sincronia, mesmo quando o JS altera .value/.selectedIndex */
 try{
  Object.defineProperty(sel,"value",{
   get:function(){return VDESC.get.call(sel)},
   set:function(v){VDESC.set.call(sel,v);lab();},
   configurable:true
  });
  Object.defineProperty(sel,"selectedIndex",{
   get:function(){return SIDESC.get.call(sel)},
   set:function(v){SIDESC.set.call(sel,v);lab();},
   configurable:true
  });
 }catch(e){}

 b.addEventListener("click",function(e){
  e.preventDefault();e.stopPropagation();
  if(sel.disabled)return;
  w.classList.contains("on")?close():open();
 });
 l.addEventListener("click",function(e){
  var li=e.target.closest?e.target.closest(".ydd-o"):null;
  if(li)pick(li);
 });
 b.addEventListener("keydown",function(e){
  if(sel.disabled)return;
  var on=w.classList.contains("on");
  if(!on&&(e.key==="Enter"||e.key===" "||e.key==="ArrowDown"||e.key==="ArrowUp")){e.preventDefault();open();return}
  if(!on)return;
  var items=[].slice.call(l.querySelectorAll(".ydd-o:not(.dis)"));
  var act=l.querySelector(".ydd-o.act");
  var ix=items.indexOf(act);
  if(e.key==="Escape"){e.preventDefault();close()}
  else if(e.key==="ArrowDown"||e.key==="ArrowUp"){
   e.preventDefault();
   ix=e.key==="ArrowDown"?Math.min(items.length-1,ix+1):Math.max(0,ix-1);
   if(act)act.classList.remove("act");
   if(items[ix]){items[ix].classList.add("act");items[ix].scrollIntoView({block:"nearest"});b.setAttribute("aria-activedescendant",items[ix].dataset.i)}
  }else if(e.key==="Enter"||e.key===" "){e.preventDefault();pick(act)}
  else if(e.key==="Tab"){close()}
 });
 /* busca por digitação (destaca o primeiro item que começa com a letra) */
 b.addEventListener("keypress",function(e){
  if(String.fromCharCode(e.which).trim()==="")return;
  var on=w.classList.contains("on");if(!on){open()}
  var k=String.fromCharCode(e.which).toLowerCase();
  var hit=[].slice.call(l.querySelectorAll(".ydd-o:not(.dis)")).find(function(li){
   return li.textContent.toLowerCase().charAt(0)===k;
  });
  if(hit){var act=l.querySelector(".ydd-o.act");if(act)act.classList.remove("act");
   hit.classList.add("act");hit.scrollIntoView({block:"nearest"})}
 });

 lab();
 new MutationObserver(function(){draw();lab()}).observe(sel,{childList:true,subtree:true,attributes:true,attributeFilter:["disabled","selected"]});
}

/* rótulo <label for=...> abre o menu novo (o select nativo fica oculto) */
document.addEventListener("click",function(e){
 var lb=e.target.closest?e.target.closest("label"):null;
 if(!lb||!lb.htmlFor)return;
 var s=document.getElementById(lb.htmlFor);
 if(s&&s.__ydd){var b=s.parentNode.querySelector(".ydd-b");if(b)b.click()}
},true);
/* clique fora fecha */
document.addEventListener("click",function(e){
 if(e.target.closest&&e.target.closest(".ydd"))return;
 document.querySelectorAll(".ydd.on").forEach(function(w){w.classList.remove("on");var b=w.querySelector(".ydd-b");if(b)b.classList.remove("on")});
});
/* selects existentes agora + qualquer select criado depois pelo painel */
[].slice.call(document.querySelectorAll("select")).forEach(enhance);
new MutationObserver(function(ms){
 for(var i=0;i<ms.length;i++){
  var na=ms[i].addedNodes;
  for(var j=0;j<na.length;j++){
   var n=na[j];if(n.nodeType!==1)continue;
   if(n.tagName==="SELECT")enhance(n);
   if(n.querySelectorAll){var l=n.querySelectorAll("select");for(var k=0;k<l.length;k++)enhance(l[k])}
  }
 }
}).observe(document.documentElement,{childList:true,subtree:true});
})();
