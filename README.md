# FITLYNE — versão profissional

Este pacote contém somente os arquivos ativos do painel, catálogo e Google Apps Script. Não há pastas de versões antigas.

## O que foi corrigido

- Login administrativo agora sempre mostra “Conectando”, erro ou sucesso; não fica mais sem resposta.
- Texto da abertura alterado para “Gestão simples”.
- Clientes podem pedir produtos que ainda não existem no catálogo.
- Em produto esgotado ou em reposição, aparece “Avise-me quando chegar”.
- As solicitações ficam salvas na aba `SOLICITACOES` da planilha.
- Nova área administrativa “Solicitações”, com pesquisa, filtros, status e contato.
- Quando o estoque muda de zero para maior que zero, as clientes desse produto ficam prontas para aviso.
- Com a API oficial do WhatsApp configurada, o sistema envia os avisos automaticamente.
- Sem API oficial, as solicitações continuam salvas e existe o botão “Abrir WhatsApp” para contato manual.

## API configurada no site

A URL está centralizada somente em `fitlyne-config.js`:

`https://script.google.com/macros/s/AKfycbz8wSvAXMMhUwpvlXUcPp948mtf4gZ9-Sak5UynSyZfI9c9gsM-AeMH7Xwo4eLcNdkO-g/exec`

## Atualizar o Google Apps Script

1. Abra o projeto vinculado à planilha da FITLYNE.
2. Substitua todo o conteúdo do `Code.gs` pelo arquivo `google-apps-script/Code.gs` deste pacote.
3. Salve.
4. Execute `setupSystem` uma vez e autorize. Isso cria ou atualiza a aba `SOLICITACOES`.
5. Vá em **Implantar → Gerenciar implantações → Editar**.
6. Selecione **Nova versão** e clique em **Implantar**.
7. Mantenha a implantação como **Executar como você** e acesso para **Qualquer pessoa**.

## Atualizar o GitHub

1. Apague os arquivos antigos do repositório.
2. Envie diretamente para a raiz do repositório todos os arquivos deste pacote.
3. O `index.html` e o `catalog.html` devem ficar na raiz.
4. Aguarde o GitHub Pages terminar a publicação.

## Aviso automático do WhatsApp

No painel, entre em **Configurações → Avisos automáticos pelo WhatsApp**.

O sistema espera um template da Meta com:

- Nome sugerido: `produto_disponivel`
- Idioma: `pt_BR`
- Corpo sugerido: `Olá, {{1}}! O produto {{2}} que você solicitou já está disponível na FITLYNE. Veja no catálogo: {{3}}`

Preencha no painel:

- Phone Number ID;
- versão da Graph API usada pela sua conta;
- nome e idioma do template;
- token permanente;
- opção “Enviar automaticamente quando o estoque voltar”.

O token é guardado em `PropertiesService` no Apps Script e não é enviado ao catálogo nem salvo no GitHub.

## Teste do login no console

```javascript
fetch(window.FITLYNE_CONFIG.API_URL, {
  method: "POST",
  headers: { "Content-Type": "text/plain;charset=utf-8" },
  body: JSON.stringify({ action: "login", payload: { pin: "SEU_PIN" } })
}).then(r => r.text()).then(console.log)
```

A resposta correta contém `"ok":true` e um `token`. Se vier uma página HTML, revise o acesso da implantação do Apps Script.
