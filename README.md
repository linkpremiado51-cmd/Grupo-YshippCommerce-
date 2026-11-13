# YshippCommerce — refatoração estrutural local

Cópia de trabalho baseada nos dois HTMLs enviados: página pública e painel administrativo. **Nenhuma alteração ou envio foi feito ao GitHub.**

## Estrutura

```text
.
├── index.html
├── admin/
│   └── index.html
├── assets/
│   ├── css/
│   │   ├── public.css
│   │   └── admin.css
│   └── js/
│       ├── public/
│       │   ├── theme-init.js
│       │   ├── device-detection.js
│       │   ├── icons.js
│       │   ├── form-state-compatibility.js
│       │   ├── app.js                   # módulo principal (Firebase/fluxos públicos)
│       │   ├── wallet-effects.js
│       │   ├── carousel-hints.js
│       │   ├── ad-slot-layout.js
│       │   └── back-to-top.js
│       └── admin/
│           ├── icons.js
│           └── app.js                   # módulo principal do painel
└── README.md
```

## O que mudou nesta primeira passagem

- CSS inline foi movido para folhas CSS próprias por área, mantendo a ordem original dos blocos.
- JavaScript inline foi externalizado em arquivos identificáveis; ordem de execução e `type="module"` foram preservados.
- Os scripts CDN originais foram mantidos. IDs do DOM, textos e lógica de negócio não foram reescritos.
- Os dois pontos de entrada estão separados e usam caminhos locais verificados.

Os módulos principais ainda são grandes porque cada um contém o código integrado à inicialização Firebase. Separá-los em domínios (`auth`, `raffles`, `wallet/tasks`, `admin/dashboard`, `admin/settings`) sem testes poderia quebrar variáveis e dependências compartilhadas. Essa será uma etapa seguinte, após validar os fluxos desta versão.

## Como testar

Com Python 3 instalado, abra um terminal nesta pasta e execute:

```bash
python3 -m http.server 8000
```

Acesse `http://localhost:8000/` (página pública) e `http://localhost:8000/admin/` (painel administrativo). Não abra os HTMLs por `file://`: os módulos ES e o Firebase precisam de um servidor HTTP.

A autenticação e as operações remotas dependem do projeto Firebase configurado e do domínio autorizado. Teste primeiro em modo seguro, sem dados de produção. As imagens ou recursos externos que não foram incluídos nos dois anexos podem precisar ser adicionados ao projeto.

## Validações já executadas

- Sintaxe de todos os arquivos JavaScript extraídos: aprovada pelo Node.js.
- Referências locais a CSS/JS nos dois HTMLs: presentes.
- URLs relativas em CSS: não foram encontradas dependências ausentes.
