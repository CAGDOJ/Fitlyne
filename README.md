# FITLYNE — projeto limpo

Este pacote contém somente os arquivos ativos do painel, catálogo e Google Apps Script.

## Configuração central
A URL da API fica somente em `fitlyne-config.js`.

URL configurada:
`https://script.google.com/macros/s/AKfycbz8wSvAXMMhUwpvlXUcPp948mtf4gZ9-Sak5UynSyZfI9c9gsM-AeMH7Xwo4eLcNdkO-g/exec`

## Publicar no GitHub
1. Apague os arquivos antigos do repositório, principalmente os que têm `-v4`, `-v7`, `V11`, `V13`, `V14` ou `V15` no nome.
2. Envie apenas o conteúdo deste pacote para a raiz do repositório.
3. O `index.html` deve ficar na raiz.

## Google Apps Script
O backend completo está em `google-apps-script/Code.gs`.
Como você já criou a nova implantação, não precisa implantar outra vez apenas para atualizar o site no GitHub.
