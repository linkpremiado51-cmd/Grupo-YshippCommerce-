
// scripts-navegacao/gerenciador-abas.js

const containerAbas = document.getElementById('container-abas');

let abaAtual = null;
const abasCarregadas = new Map();

/**
 * Carrega uma aba dentro do index.html
 * @param {string} nomeAba
 */
export async function carregarAba(nomeAba) {
  if (abaAtual === nomeAba) return;

  if (!abasCarregadas.has(nomeAba)) {
    const html = await buscarHTMLAba(nomeAba);
    const wrapper = document.createElement('section');

    wrapper.classList.add('aba-conteudo');
    wrapper.dataset.aba = nomeAba;
    wrapper.innerHTML = html;

    containerAbas.appendChild(wrapper);
    abasCarregadas.set(nomeAba, wrapper);

    carregarScriptAba(nomeAba);
  }

  alternarAba(nomeAba);
}

/**
 * Busca o HTML da aba
 */
async function buscarHTMLAba(nomeAba) {
  const response = await fetch(`abas-conteudo/${nomeAba}/${nomeAba}.html`);
  if (!response.ok) {
    throw new Error(`Erro ao carregar a aba ${nomeAba}`);
  }
  return response.text();
}

/**
 * Alterna visualmente a aba ativa
 */
function alternarAba(nomeAba) {
  abasCarregadas.forEach((el) => el.classList.remove('ativa'));

  const aba = abasCarregadas.get(nomeAba);
  aba.classList.add('ativa');

  abaAtual = nomeAba;

  document.dispatchEvent(new CustomEvent('aba:alterada', {
    detail: { aba: nomeAba }
  }));
}

/**
 * Carrega o JS específico da aba (se existir)
 */
function carregarScriptAba(nomeAba) {
  const script = document.createElement('script');
  script.type = 'module';
  script.src = `abas-conteudo/${nomeAba}/${nomeAba}.js`;
  script.onerror = () => {}; // opcional, caso a aba não tenha JS
  document.body.appendChild(script);
}
