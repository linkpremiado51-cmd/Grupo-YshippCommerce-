export function carregarAba(nome) {
  fetch(`./abas-conteudo/aba-${nome}/${nome}.html`)
    .then(r => r.text())
    .then(html => {
      document.getElementById('conteudo').innerHTML = html;
    });
}

window.carregarAba = carregarAba;
