
/**
 * Lógica da Aba Análises - AniGeekNews
 * Responsabilidade: Filtrar e exibir reviews e críticas detalhadas.
 */

import { buscarNoticiasPorCategoria } from '../../camada-dados/noticias.repository.js';

/**
 * Função de inicialização disparada pelo gerenciador-abas.js
 */
export async function init() {
    console.log('Iniciando Aba: Análises');
    
    // Inicializa os ouvintes de filtro
    const filtro = document.getElementById('filtro-categoria-analises');
    filtro.addEventListener('change', (e) => carregarConteudoAnalises(e.target.value));

    // Carregamento inicial (todas as análises)
    await carregarConteudoAnalises('todas');
}

/**
 * Busca e renderiza as análises baseadas na categoria selecionada
 */
async function carregarConteudoAnalises(subcategoria) {
    const container = document.getElementById('lista-analises-container');
    container.innerHTML = '<div class="loader-simples">Carregando análises...</div>';

    // No Firestore, filtramos pela categoria principal 'analises'
    // A subcategoria (jogos, hardware) pode ser um campo extra ou filtro no JS
    const analises = await buscarNoticiasPorCategoria('analises', 12);

    if (analises.length > 0) {
        const filtradas = subcategoria === 'todas' 
            ? analises 
            : analises.filter(item => item.subcategoria === subcategoria);
            
        renderizarListaAnalises(filtradas);
    } else {
        container.innerHTML = '<p class="msg-vazia">Nenhuma análise encontrada nesta categoria.</p>';
    }
}

/**
 * Renderiza os itens de análise com layout de lista/card horizontal
 */
function renderizarListaAnalises(lista) {
    const container = document.getElementById('lista-analises-container');
    container.innerHTML = '';

    lista.forEach(item => {
        const itemElement = document.createElement('article');
        itemElement.className = 'analise-item';
        
        // Estrutura focada em leitura e nota de avaliação (se houver)
        itemElement.innerHTML = `
            <div class="analise-imagem" style="background-image: url('${item.imagemUrl}')">
                ${item.nota ? `<div class="analise-nota">${item.nota}</div>` : ''}
            </div>
            <div class="analise-corpo">
                <span class="analise-meta">${item.subcategoria || 'Geral'} | ${new Date(item.dataPublicacao).toLocaleDateString()}</span>
                <h3>${item.titulo}</h3>
                <p>${item.resumo.substring(0, 150)}...</p>
                <button class="btn-link">Ler review completo →</button>
            </div>
        `;

        itemElement.onclick = () => {
            window.location.href = `noticias-completas/analises/${item.slug}.html`;
        };

        container.appendChild(itemElement);
    });
}
