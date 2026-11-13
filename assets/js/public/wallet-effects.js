(function(){
 function burst(){
  var b=document.getElementById("tb-wal");if(!b)return;
  var m=b.querySelector(".tbm");if(!m)return;
  if(m.querySelector(".ycx-coin"))return;
  function mk(cl){var s=document.createElement("span");s.className=cl;return s}
  m.appendChild(mk("ycx-shine"));
  m.appendChild(mk("ycx-coin"));
  for(var i=0;i<16;i++){var p=mk("ycx-p");
   var a=Math.PI*(0.04+0.92*i/15);
   var sz=(2+(i*7)%4)+"px";p.style.width=sz;p.style.height=sz;
   p.style.setProperty("--tx",Math.round(Math.cos(a)*(10+(i*5)%14))+"px");
   p.style.setProperty("--ty",Math.round(Math.sin(a)*-(8+(i*3)%12))+"px");
   p.style.animationDelay=(0.4+(i%6)*0.14)+"s";
   m.appendChild(p);}
  b.classList.add("tb-wal-anim");
  setTimeout(function(){b.classList.remove("tb-wal-anim");
   var ns=m.querySelectorAll(".ycx-coin,.ycx-p,.ycx-shine");for(var j=0;j<ns.length;j++)ns[j].remove();
  },2500);
 }
 setInterval(burst,10000);
})();
