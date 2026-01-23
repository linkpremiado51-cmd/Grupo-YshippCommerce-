
/**
 * Lógica da Aba Futebol - AniGeekNews
 * Responsabilidade: Gerenciar o conteúdo esportivo e eventos da arena.
 */

import { buscarNoticiasPorCategoria } from '../../camada-dados/noticias.repository.js';

/**
 * Função de inicialização disparada pelo gerenciador-abas.js
 */
export async function init() {
    console.log('Iniciando Aba: Futebol');
    
    // Busca as notícias específicas de futebol
    const noticiasFutebol = await buscarNoticiasPorCategoria('futebol', 8);

    if (noticiasFutebol.length > 0) {
        configurarDestaqueFutebol(noticiasFutebol[0]);
        renderizarFeedFutebol(noticiasFutebol.slice(1));
    } else {
        exibirMensagemSemNoticias();
    }
}

/**
 * Configura o banner superior da seção de futebol
 */
function configurarDestaqueFutebol(noticia) {
    const banner = document.getElementById('futebol-banner-principal');
    const titulo = document.getElementById('futebol-destaque-titulo');
    const btn = document.getElementById('btn-futebol-destaque');

    titulo.textContent = noticia.titulo;
    banner.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.7)), url('${noticia.imagemUrl}')`;
    banner.style.backgroundSize = 'cover';
    banner.style.backgroundPosition = 'center';

    btn.onclick = () => {
        window.location.href = `noticias-completas/futebol/${noticia.slug}.html`;
    };
}

/**
 * Renderiza a grade de notícias de futebol
 */
function renderizarFeedFutebol(noticias) {
    const container = document.getElementById('lista-noticias-futebol');
    container.innerHTML = ''; // Limpa os skeletons

    noticias.forEach(item => {
        const card = document.createElement('div');
        card.className = 'futebol-card';
        card.innerHTML = `
            <div class="futebol-card-img" style="background-image: url('${item.imagemUrl}')"></div>
            <div class="futebol-card-detalhes">
                <h4>${item.titulo}</h4>
                <span class="futebol-data">${new Date(item.dataPublicacao).toLocaleDateString()}</span>
            </div>
        `;

        card.onclick = () => {
            window.location.href = `noticias-completas/futebol/${item.slug}.html`;
        };

        container.appendChild(card);
    });
}

function exibirMensagemSemNoticias() {
    const container = document.getElementById('lista-noticias-futebol');
    container.innerHTML = '<p class="aviso">Nenhum lance registrado no momento.</p>';
}
