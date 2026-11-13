(function(){
 var IDS=["ofertas","sorteios","leiloes","market-main","carteira-main"];
 function anchors(){return IDS.map(function(i){return document.getElementById(i)}).filter(Boolean)}
 function ensure(){
  var a=anchors();if(a.length<5)return;
  var proto=document.getElementById("ad-slot-4");if(!proto)return;
  proto.setAttribute("data-rot","1");
  var slots=[].slice.call(document.querySelectorAll(".ad-slot[data-rot]"));
  while(slots.length<5){
   var c=proto.cloneNode(true);c.removeAttribute("id");c.setAttribute("data-rot","1");
   var host=a[slots.length];host.parentNode.insertBefore(c,host);slots.push(c);
  }
 }
 function shuffle(){
  var a=anchors(),s=[].slice.call(document.querySelectorAll(".ad-slot[data-rot]"));
  if(a.length<5||s.length<5)return;
  for(var i=s.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=s[i];s[i]=s[j];s[j]=t}
  for(var k=0;k<5;k++)a[k].parentNode.insertBefore(s[k],a[k]);
 }
 try{ensure();shuffle()}catch(e){}
 setInterval(function(){try{shuffle()}catch(e){}},300000);
})();
