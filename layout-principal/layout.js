/**
 * Layout Principal - Gerencia a moldura do site (Header, Nav, Footer)
 */

import { carregarAba } from '../scripts-navegacao/gerenciador-abas.js';

/**
 * Inicializa o layout básico do portal.
 * Busca o arquivo layout.html e injeta no container principal.
 */
export async function inicializarLayout() {
    const container = document.getElementById('layout-container');

    try {
        const response = await fetch('layout-principal/layout.html');
        if (!response.ok) throw new Error('Erro ao carregar layout.html');
        
        const html = await response.text();
        container.innerHTML = html;

        configurarEventosMenu();
        console.log('Layout principal injetado e configurado.');
        
        // Carrega a aba inicial por padrão após o layout estar pronto
        carregarAba('inicio');

    } catch (error) {
        console.error('Falha na inicialização do layout:', error);
        container.innerHTML = '<p>Erro crítico ao carregar a interface principal.</p>';
    }
}

/**
 * Configura os cliques nos itens do menu para alternar entre as abas.
 */
function configurarEventosMenu() {
    const menuItems = document.querySelectorAll('.menu-item');

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const abaAlvo = e.target.getAttribute('data-aba');
            
            // Remove classe ativa de todos e adiciona no clicado
            menuItems.forEach(i => i.classList.remove('active'));
            e.target.classList.add('active');

            // Chama o gerenciador de navegação
            carregarAba(abaAlvo);
        });
    });
}

/**
 * Atualiza o status de autenticação na interface (chamado pelo Firebase Auth)
 */
export function atualizarInterfaceAuth(usuario) {
    const authContainer = document.getElementById('auth-status-container');
    if (!authContainer) return;

    if (usuario) {
        authContainer.innerHTML = `<span class="user-name">Olá, ${usuario.displayName || 'Geek'}</span>`;
    } else {
        authContainer.innerHTML = `<button class="btn-login" onclick="window.location.hash = 'acesso'">Login</button>`;
    }
}
