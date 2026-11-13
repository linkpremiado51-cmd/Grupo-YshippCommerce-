(function(){
 function addHints(){
  var proto=document.querySelector(".carousel-hint");if(!proto)return;
  [].forEach.call(document.querySelectorAll(".evs,.tks,.how,.pes-strip,.wal-fcar"),function(sc){
   if(sc.getAttribute("data-hint"))return;sc.setAttribute("data-hint","1");
   if(sc.previousElementSibling&&sc.previousElementSibling.classList.contains("carousel-hint"))return;
   var h=proto.cloneNode(true);h.removeAttribute("id");
   sc.parentNode.insertBefore(h,sc);
  });
 }
 addHints();setTimeout(addHints,1800);
})();
