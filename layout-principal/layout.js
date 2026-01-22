
fetch('./layout-principal/layout.html')
  .then(r => r.text())
  .then(html => {
    document.getElementById('app').innerHTML = html;
  });
