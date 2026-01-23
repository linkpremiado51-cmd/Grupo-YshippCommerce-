/**
 * Gerenciador de Abas - AniGeekNews
 * Responsabilidade: Carregar dinamicamente os módulos (HTML/JS) das abas.
 */

import { atualizarEstadoNavegacao } from '../estado-aplicacao/estado-navegacao.js';

const ABA_RENDER_AREA_ID = 'aba-render-area';
const LOADER_ID = 'view-loader';

/**
 * Carrega uma aba específica baseada no nome da pasta.
 * @param {string} nomeAba - Ex: 'inicio', 'analises', 'futebol'
 */
export async function carregarAba(nomeAba) {
    const renderArea = document.getElementById(ABA_RENDER_AREA_ID);
    const loader = document.getElementById(LOADER_ID);
    
    // 1. Início do carregamento: mostra loader e limpa área
    loader.classList.remove('loader-hidden');
    renderArea.innerHTML = '';

    try {
        // 2. Define o caminho dos arquivos (ex: abas-conteudo/aba-inicio/inicio.html)
        const caminhoBase = `abas-conteudo/aba-${nomeAba}`;
        const arquivoHTML = `${caminhoBase}/${nomeAba}.html`;
        const arquivoJS = `${caminhoBase}/${nomeAba}.js`;

        // 3. Busca o conteúdo HTML
        const response = await fetch(arquivoHTML);
        if (!response.ok) throw new Error(`Não foi possível carregar a aba: ${nomeAba}`);
        
        const html = await response.text();

        // 4. Injeta o HTML na tela
        renderArea.innerHTML = html;

        // 5. Atualiza o estado global e a URL (History API)
        atualizarEstadoNavegacao(nomeAba);
        window.history.pushState({ aba: nomeAba }, '', `#${nomeAba}`);

        // 6. Tenta carregar e executar o script específico da aba
        await importarScriptAba(arquivoJS);

    } catch (error) {
        console.error('Erro ao alternar aba:', error);
        renderArea.innerHTML = `
            <div class="error-container">
                <p>Ops! Não conseguimos carregar o conteúdo de ${nomeAba}.</p>
                <button onclick="location.reload()">Tentar novamente</button>
            </div>
        `;
    } finally {
        // 7. Finaliza o loader
        loader.classList.add('loader-hidden');
    }
}

/**
 * Importa dinamicamente o script da aba para inicializar comportamentos específicos.
 */
async function importarScriptAba(caminhoJS) {
    try {
        // O cache-busting (?t=) garante que o navegador pegue a versão mais nova do JS
        const modulo = await import(`../../${caminhoJS}?t=${Date.now()}`);
        if (modulo.init) {
            modulo.init(); // Cada aba deve exportar uma função init()
        }
    } catch (err) {
        // Nem todas as abas precisam obrigatoriamente de um script dedicado
        console.warn(`Aviso: Script para a aba não encontrado ou sem export init().`, caminhoJS);
    }
}

// Ouvinte para o botão "Voltar" do navegador
window.addEventListener('popstate', (event) => {
    if (event.state && event.state.aba) {
        carregarAba(event.state.aba);
    }
});
