
/**
 * Lógica da Aba Início - AniGeekNews
 * Responsabilidade: Renderizar o destaque e a grade de notícias recentes.
 */

import { buscarUltimasNoticias } from '../../camada-dados/noticias.repository.js';

/**
 * Função de inicialização disparada pelo gerenciador-abas.js
 */
export async function init() {
    console.log('Iniciando Aba: Início');
    
    const noticias = await buscarUltimasNoticias(7); // Busca 7 (1 destaque + 6 grid)
    
    if (noticias.length > 0) {
        renderizarDestaque(noticias[0]);
        renderizarGrid(noticias.slice(1));
    } else {
        exibirMensagemVazia();
    }
}

/**
 * Preenche a seção de destaque principal
 */
function renderizarDestaque(noticia) {
    const titulo = document.getElementById('destaque-titulo');
    const resumo = document.getElementById('destaque-resumo');
    const container = document.getElementById('noticia-destaque-principal');
    const btn = document.getElementById('btn-destaque');

    titulo.textContent = noticia.titulo;
    resumo.textContent = noticia.resumo;
    
    // Define a imagem de fundo do destaque
    container.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.8)), url('${noticia.imagemUrl || '../../recursos-visuais/imagens/default-placeholder.jpg'}')`;
    container.style.backgroundSize = 'cover';
    container.style.backgroundPosition = 'center';

    // Ao clicar, redireciona para a página da notícia completa
    btn.onclick = () => {
        window.location.href = `noticias-completas/${noticia.categoria}/${noticia.slug}.html`;
    };
}

/**
 * Gera os cards para a grade de notícias recentes
 */
function renderizarGrid(noticias) {
    const grid = document.getElementById('grid-noticias-recentes');
    grid.innerHTML = ''; // Limpa os skeletons

    noticias.forEach(noticia => {
        const card = document.createElement('div');
        card.className = 'noticia-card';
        card.innerHTML = `
            <div class="card-thumb" style="background-image: url('${noticia.imagemUrl}')"></div>
            <div class="card-info">
                <span class="card-tag">${noticia.categoria}</span>
                <h4>${noticia.titulo}</h4>
                <p>${noticia.resumo.substring(0, 80)}...</p>
            </div>
        `;

        card.onclick = () => {
            window.location.href = `noticias-completas/${noticia.categoria}/${noticia.slug}.html`;
        };

        grid.appendChild(card);
    });
}

function exibirMensagemVazia() {
    const grid = document.getElementById('grid-noticias-recentes');
    grid.innerHTML = '<p>Nenhuma notícia encontrada no momento.</p>';
}
