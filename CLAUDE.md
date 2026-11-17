# Portal de Projetos de Automação

Portfólio web de simulações 3D de linhas robotizadas, usado para mostrar projetos e, mais adiante, compartilhar com clientes.
O usuário escreve em português; responda em português.

Primeiro projeto: **Transfer Flow 3D**, a transferência robotizada e a inspeção com IA de TVs de 32" a 75".
O cliente é o Grupo Multilaser, com TVs Hisense. Não use "Hisense" em textos públicos do site.

## Onde está

- Repositório: github.com/clodoaldo29/portal-automacao (privado).
- Site: https://portal-automacao.clodoaldo-fmelo.workers.dev
  - Roda no Cloudflare Workers com arquivos estáticos.
  - `wrangler.jsonc` executa `npm run build` e publica `dist/`.
- Cada push no `main` publica sozinho em cerca de 1 min.
  - Isso depende do app "Cloudflare Workers and Pages" instalado no repositório do GitHub.
  - O app já precisou ser reinstalado uma vez. Se um push não gerar build, confira esse app primeiro.

## Regras de trabalho (combinadas com o usuário)

- **Trabalhe sempre num branch novo** e faça push dele. **Só suba para o `main` quando o usuário autorizar
  explicitamente** ("pode subir pra main"). Frases vagas não contam como autorização. O `main` é o site no ar.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- O Node **não** está no PATH. O Node 24 portátil fica em `%LOCALAPPDATA%\Programs\nodejs`.
  No bash: `export PATH="$(cygpath "$LOCALAPPDATA")/Programs/nodejs:$PATH"`.
- Não há `gh` CLI. Criar repositório e mexer em permissões no GitHub ou no Cloudflare fica com o usuário.
  Ler o token do Git foi bloqueado; o `git push` funciona.
- Subir um servidor local à mão, em segundo plano, foi bloqueado. O `webServer` do Playwright funciona.
- Existe uma cópia antiga da simulação, em arquivo único, em `Área de Trabalho\Transfer Flow 3D`.
  Ela tem o modelo e a iluminação embutidos, e um LEIA-ME.
  O usuário pediu que mudanças na simulação também sejam levadas para essa pasta local.

## Arquitetura

Vite 8 + TypeScript 5.9 + three.js r128 (via npm, `three/examples/jsm`).

- `index.html` + `src/portal/`: o portal. Os cartões vêm de `public/projetos.json`.
- `projetos/<id>/index.html`: a página de cada simulação. Registre a página em `vite.config.ts` (`pages`).
- `src/sim/`: biblioteca compartilhada. Reaproveite estas peças em vez de copiar código:
  - `stage.ts`: renderizador, câmera, luz, piso espelhado, qualidade alta ou leve.
  - `hall.ts`: galpão, cerca, faixas no piso.
  - `track.ts`, `conveyor.ts`: pista com retas e arcos; geometria de esteiras e elevadores.
  - `line.ts`: esteira de acumulação com batentes (estações com `shouldStop`/`arrive`).
  - `sequencer.ts`: fila de movimentos (`runSeq`).
  - `robots/ur-kinematics.ts`: cinemática e IK numérico (DLS) do UR10e e do UR30, com dados do ROS-Industrial.
  - `robots/ur-arm.ts`: braço na cena (`makeCobot`, `upgradeArm`, `urTrack`), modelos originais do UR10e e HDRI.
  - `robots/grippers.ts`: garra em gancho e cabeça de câmera.
  - `andon.ts`, `labels.ts`, `views.ts`: torre de sinalização, etiquetas, câmeras e tour.
  - `kpi.ts`: UPH e OEE, como funções puras.
  - `shot.ts`: PNG em alta resolução.
- `src/projects/transfer-flow/`:
  - `config.ts`: todas as medidas e o layout.
  - `world.ts`: monta a linha, avança no tempo, reinicia.
  - `transfers.ts`: Transfer 1 e 2.
  - `inspection.ts`: a célula de inspeção.
  - `products.ts`: TV, suporte e pallet.
  - `ui/`: painel, parâmetros e PNG.
  - `main.ts`: liga tudo.
- `public/`:
  - `projetos.json`, `capas/`: dados e imagens do portal.
  - `assets/ur10e/*.dae`, `assets/env/*.hdr`: modelos do robô e iluminação.
  - `licencas/`, `_headers`, `robots.txt`: o site tem `noindex`.

### Comandos

```
npm run dev | typecheck | test (Vitest) | build | test:e2e (Playwright) | check (tudo, em ordem)
```

- O Playwright usa o Chrome instalado (`channel: 'chrome'`) com SwiftShader e roda contra o `vite preview`.
- O CI fica em `.github/workflows/ci.yml`.

## Transfer Flow 3D: o que já está definido

- **Escala real (1 unidade = 1 m)**, dimensionada pela TV de 75" (1,68 × 0,97 m).
  - Esteiras: 0,88 m de altura, 1,2 m de largura nas duas, 13,4 m de comprimento.
  - Transfers UR30 a 4 m um do outro, em pedestal de 1,5 m, com garra em gancho.
  - Inspeção com um UR10e com câmera, 3,8 m antes do Transfer 1.
- **Produtos e pallets:**
  - Na montagem, as TVs chegam de tela para baixo. 32" e 43" vêm em pares por suporte; 50" a 75", uma por suporte.
  - No teste, é um pallet por TV, em pé, com a **tela virada para os robôs** (frente).
  - Não inverter o lado das esteiras.
- **Divisão do trabalho 'auto':**
  - 32"/43": suportes alternados, e cada robô esvazia o seu.
  - 50"+: o Transfer 1 pega quando está livre, e o Transfer 2 pega o resto.
- **Pallets:** ficam num pulmão antes do Transfer 1, com prioridade de despacho para ele. Há intertravamento na doca.
- **Parâmetros:** braços ligados ou desligados, regra de divisão, meta de UPH (salvos no `localStorage`).
  - Trocar o modelo reinicia a linha e zera os indicadores.
- **Indicadores:** UPH por célula e OEE (disponibilidade 100%, performance = UPH ÷ meta, qualidade = aprovadas ÷ inspecionadas).

### Referência de vazão (cobrada exatamente por `tests/e2e/transfer-flow.spec.ts`)

Condições: 10 min simulados, dois braços, modo 'auto', sem NG.

| Modelo | TVs | Transfer 1 / Transfer 2 |
|---|---|---|
| 32" | 90 | 45 / 45 |
| 43" | 88 | 44 / 44 |
| 65" | 106 | 54 / 52 |
| 75" | 106 | 54 / 52 |

- Zero perdas. Com um braço só, cerca de 69 TVs (~415 TV/h).
- A URL `?bench=10&model=65` roda esse benchmark e publica o resultado em `window.__bench`.
- Se a lógica da linha mudar **de propósito**, meça de novo e atualize a tabela no mesmo commit.

## Pendências

- Configurar o Cloudflare Access (login por e-mail) antes de mandar o link a clientes. Hoje o site é público.
- Atualizar o three.js r128 para a versão atual. Isso muda luz e cores, então deve ser feito num branch próprio,
  com comparação visual.
- A validar com o cliente:
  - curva de carga do UR30 com a garra em gancho (65" e 75");
  - medidas reais do suporte e do pallet;
  - ritmo real da montagem (TV/h).
- Próximo projeto: o usuário vai mandar o conceito.
  - Crie num branch novo, em `src/projects/<id>`, usando `src/sim`.
  - Adicione a capa e o cartão em `public/projetos.json` e um teste e2e próprio.

## Outras referências

Rascunhos no Claude (artefatos), que continuam existindo:
- portal: https://claude.ai/artifact/1KnPZAokstcA4GTGXVqkTB
- simulação: https://claude.ai/artifact/9P4E4fqA1zqZgEvpsUbAD8
