
/**
 * Estado da Navegação - AniGeekNews
 * Responsabilidade: Gerenciar o estado global da navegação e histórico.
 */

// Estado interno (privado ao módulo)
const estadoNavegacao = {
    abaAtiva: 'inicio',
    historicoSessao: [],
    ultimaInteracao: null
};

/**
 * Atualiza o estado global com a nova aba e registra no histórico.
 * @param {string} novaAba 
 */
export function atualizarEstadoNavegacao(novaAba) {
    estadoNavegacao.abaAtiva = novaAba;
    estadoNavegacao.ultimaInteracao = Date.now();
    
    // Adiciona ao histórico de navegação da sessão
    estadoNavegacao.historicoSessao.push({
        aba: novaAba,
        timestamp: estadoNavegacao.ultimaInteracao
    });

    console.log(`[Estado] Navegou para: ${novaAba}`);
    
    // Notifica outros sistemas via evento customizado (opcional)
    const eventoNavegacao = new CustomEvent('mudancaAba', { detail: { aba: novaAba } });
    document.dispatchEvent(eventoNavegacao);
}

/**
 * Retorna qual aba está ativa no momento.
 */
export function getAbaAtiva() {
    return estadoNavegacao.abaAtiva;
}

/**
 * Retorna o histórico de navegação desta sessão.
 */
export function getHistoricoNavegacao() {
    return [...estadoNavegacao.historicoSessao];
}

/**
 * Verifica se o usuário já visitou uma seção específica nesta sessão.
 * Útil para o motor de recomendação.
 */
export function usuarioVisitouSecao(nomeSecao) {
    return estadoNavegacao.historicoSessao.some(item => item.aba === nomeSecao);
}
