document.addEventListener('DOMContentLoaded', () => {
  fetch('layout-principal/layout.html')
    .then(response => {
      if (!response.ok) {
        throw new Error('Erro ao carregar layout.html');
      }
      return response.text();
    })
    .then(html => {
      const app = document.getElementById('app');

      if (!app) {
        console.error('Elemento #app não encontrado');
        return;
      }

      app.innerHTML = html;
      console.log('Layout principal carregado com sucesso');
    })
    .catch(error => {
      console.error('Falha ao carregar layout:', error);
    });
});
