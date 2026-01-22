// componentes-reutilizaveis/card-noticia/card-noticia.js

import { emitirEvento } from '../../sistema-comunicacao/barramento-eventos.js';
import { registrarInteracao } from '../../sistema-recomendacao/coletor-interacoes.js';

const TEMPLATE_PATH =
  '/componentes-reutilizaveis/card-noticia/card-noticia.html';

/**
 * Carrega o template HTML do card
 */
async function carregarTemplate() {
  const response = await fetch(TEMPLATE_PATH);
  const html = await response.text();

  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();

  return wrapper.firstElementChild;
}

/**
 * Cria um card de notícia a partir dos dados do Firebase
 */
export async function criarCardNoticia(dados) {
  const card = await carregarTemplate();

  // Metadados
  card.dataset.id = dados.id;
  card.dataset.categoria = dados.categoria;
  card.dataset.timestamp = dados.timestamp;

  // Categoria
  const categoriaEl = card.querySelector('[data-categoria]');
  categoriaEl.textContent = dados.categoria;

  if (dados.cor) {
    categoriaEl.style.backgroundColor = dados.cor;
  }

  // Título + link
  const linkEl = card.querySelectorAll('[data-link-artigo]');
  linkEl.forEach(link => {
    link.href = dados.linkArtigo;
    link.textContent = dados.titulo;
  });

  // Resumo
  card.querySelector('[data-resumo]').textContent = dados.resumo;

  // Vídeo principal
  if (dados.videoPrincipal) {
    card.querySelector('[data-video]').innerHTML = `
      <iframe
        src="${dados.videoPrincipal}"
        loading="lazy"
        allowfullscreen
      ></iframe>
    `;
  }

  // Ficha técnica
  if (Array.isArray(dados.ficha)) {
    const fichaEl = card.querySelector('[data-ficha]');
    fichaEl.innerHTML = '';

    dados.ficha.forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${item.label}:</strong> ${item.valor}`;
      fichaEl.appendChild(li);
    });
  }

  // Relacionados
  if (Array.isArray(dados.relacionados)) {
    const relacionadosEl = card.querySelector('[data-relacionados]');
    relacionadosEl.innerHTML = '';

    dados.relacionados.forEach(rel => {
      const div = document.createElement('div');
      div.classList.add('card-noticia__relacionado');
      div.innerHTML = `
        <img src="${rel.thumb}" alt="${rel.titulo}">
        <span>${rel.titulo}</span>
      `;
      relacionadosEl.appendChild(div);
    });
  }

  // Interações (clique)
  card.querySelector('.card-noticia__ver-completo')
    .addEventListener('click', () => {
      registrarInteracao({
        tipo: 'clique-noticia',
        noticiaId: dados.id,
        categoria: dados.categoria,
        timestamp: Date.now()
      });

      emitirEvento('noticia:clicada', {
        id: dados.id,
        categoria: dados.categoria,
        origem: 'card-noticia'
      });
    });

  return card;
}
