/* ============================================================
   DETECÇÃO DE APARELHO (roda antes de qualquer render)
   Navegadores embutidos em editores de código (WebView) usam um
   viewport VIRTUAL largo (980–1280px) mesmo num celular, ignorando
   a meta viewport. Por isso a detecção usa o APARELHO (toque/UA)
   e não só a largura: celular detectado => layout celular forçado.
   ============================================================ */
(function(){
 /* re-aplica a meta viewport em tempo de execução (ajuda quando o
    cabeçalho foi injetado antes do DOM pelo editor) */
 try{
  var m=document.querySelector('meta[name="viewport"]');
  if(m)m.content="width=device-width, initial-scale=1, viewport-fit=cover";
 }catch(e){}
 function isTouch(){
  try{
   return matchMedia("(pointer:coarse)").matches
    ||navigator.maxTouchPoints>0
    ||("ontouchstart"in window)
    ||/Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent||"");
  }catch(e){return false}
 }
 function mark(){
  var w=window.innerWidth||document.documentElement.clientWidth||0;
  var narrow=matchMedia("(max-width:1023px)").matches;
  /* celular real = tela estreita OU aparelho de toque com viewport virtual < 1280px */
  var mob=narrow||(isTouch()&&w<1280);
  document.documentElement.classList.toggle("is-mobile",mob);
  document.documentElement.classList.toggle("is-desktop",!mob);
 }
 mark();
 var mq=matchMedia("(max-width:1023px)");
 if(mq.addEventListener)mq.addEventListener("change",mark);
 else if(mq.addListener)mq.addListener(mark);
 window.addEventListener("resize",mark);
 window.addEventListener("orientationchange",function(){setTimeout(mark,120)});
})();
