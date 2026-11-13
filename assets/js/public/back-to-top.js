(function(){
 var btn=document.querySelector("footer [data-tbtop]");
 if(!btn)return;
 var tick=false;
 function check(){
  tick=false;
  var doc=document.documentElement;
  var end=doc.scrollHeight-window.innerHeight-560;
  btn.classList.toggle("near-end",window.scrollY>=end);
 }
 window.addEventListener("scroll",function(){if(!tick){tick=true;requestAnimationFrame(check)}},{passive:true});
 window.addEventListener("resize",check);
 check();
})();
