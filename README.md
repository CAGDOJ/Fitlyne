# FITLYNE — catálogo, estoque e vendas

Sistema mobile-first para **Moda Fitness + Makeup**, pronto para subir no GitHub e publicar no GitHub Pages, Netlify ou Vercel.

## O que funciona

- Login administrativo por PIN validado no Google Apps Script
- Cadastro de produtos pelo celular
- Câmera ou galeria, com várias fotos
- Moda Fitness e Makeup
- Tamanho único com faixa, por exemplo: **36–40**
- Tamanhos separados: P, M, G, GG etc.
- Produtos com cores, tons, volumes e variações
- Estoque, entrada, saída, perda e devolução
- Vendas com baixa automática
- Clientes
- Despesas e resumo financeiro
- Catálogo público em página separada (`catalog.html`)
- Pedido pelo WhatsApp
- Links de imagem para Catálogo, Instagram Feed, Story, WhatsApp, Facebook, Shopee e Mercado Livre
- Google Sheets como banco de dados
- Cloudinary para imagens em alta qualidade e marca d'água

## Estrutura

```text
FITLYNE_GitHub_MVP/
├── index.html
├── styles.css
├── app.js
├── config.example.js
├── manifest.webmanifest
├── sw.js
├── assets/
│   └── icon.svg
└── google-apps-script/
    ├── Code.gs
    └── appsscript.json
```

## 1. Criar a planilha

1. Crie uma planilha vazia no Google Sheets.
2. Abra `Extensões → Apps Script`.
3. Cole o conteúdo de `google-apps-script/Code.gs` em `Código.gs`.
4. Ative o manifesto em `Configurações do projeto`.
5. Cole `google-apps-script/appsscript.json` no manifesto.
6. Execute a função `setupSystem`.
7. Autorize.

O sistema criará as abas:

- CONFIG
- PRODUTOS
- FOTOS
- VARIACOES
- MOVIMENTACOES
- VENDAS
- CLIENTES
- DESPESAS

## 2. Configurar o PIN e WhatsApp

Na aba `CONFIG`, altere:

```text
ADMIN_PIN = 1234
WHATSAPP = 5591999999999
NOME_LOJA = FITLYNE
```

Use o WhatsApp apenas com números, incluindo país e DDD.

## 3. Publicar a API

No Apps Script:

```text
Implantar → Nova implantação → Aplicativo da Web
```

Configure:

- Executar como: **Eu**
- Quem pode acessar: **Qualquer pessoa**

Copie o link terminado em `/exec`.

## 4. Configurar Cloudinary

Crie uma conta no Cloudinary e crie um **Unsigned Upload Preset**.

No preset, restrinja:

- pasta: `fitlyne/produtos`
- formatos: JPG, PNG, WEBP
- tamanho máximo adequado à sua conta

Envie também a logo FITLYNE em PNG transparente e copie o `Public ID`.

## 5. Configurar o site

Copie:

```text
config.example.js
```

para:

```text
config.js
```

Preencha:

```javascript
window.FITLYNE_CONFIG = {
  API_URL: "URL_DO_APPS_SCRIPT",
  CLOUDINARY_CLOUD_NAME: "SEU_CLOUD_NAME",
  CLOUDINARY_UPLOAD_PRESET: "SEU_UNSIGNED_PRESET",
  CLOUDINARY_WATERMARK_PUBLIC_ID: "fitlyne/logo",
  STORE_NAME: "FITLYNE",
  STORE_SUBTITLE: "Moda Fitness & Makeup"
};
```

## 6. Subir no GitHub

Crie um repositório e envie todos os arquivos.

No terminal:

```bash
git init
git add .
git commit -m "Sistema FITLYNE"
git branch -M main
git remote add origin URL_DO_REPOSITORIO
git push -u origin main
```

## 7. Publicar no GitHub Pages

No repositório:

```text
Settings → Pages → Deploy from a branch → main / root
```

O arquivo `config.js` contém somente dados públicos do frontend. Nunca coloque API Secret do Cloudinary nele.

## 8. Abrir como aplicativo no celular

Abra o site no Chrome e use:

```text
Adicionar à tela inicial
```

## Observações de segurança

- O PIN é validado no Apps Script, não apenas no navegador.
- O preset do Cloudinary é público por natureza; restrinja formatos, pasta e tamanho.
- Para uma loja maior ou vários funcionários, migre depois para autenticação individual.
- Publicação automática direta em Instagram, Shopee e Mercado Livre não está incluída, pois essas plataformas exigem credenciais e aprovação de API. O sistema gera as imagens e os dados de cada canal.

## Separação entre gestão e catálogo

- `index.html`: painel administrativo.
- `catalog.html`: catálogo público para clientes.

Compartilhe somente o link de `catalog.html` com as clientes.

## Catálogo com carrinho

A versão 3 remove completamente o acesso administrativo da página pública.

O catálogo agora possui:

- carrinho persistente no navegador;
- aumento e redução de quantidade;
- limite conforme o estoque;
- remoção de itens;
- total estimado;
- campo de observação;
- pedido completo enviado para o WhatsApp da loja.

O número deve estar configurado na aba `CONFIG`:

```text
WHATSAPP = 5591999999999
```

Use somente números, incluindo código do país e DDD.
