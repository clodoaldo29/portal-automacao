# Portal de Projetos de Automação

Portfólio de simulações 3D de linhas robotizadas. Vite + TypeScript + three.js, publicado no Cloudflare
(Workers com arquivos estáticos). Cada envio para a branch `main` gera o site e publica.

## Estrutura

```
index.html                          portal (cartões lidos de public/projetos.json)
projetos/<id>/index.html            página de cada simulação
src/
  sim/                              biblioteca compartilhada pelas simulações
    stage.ts                        renderizador, câmera, luz, piso espelhado, qualidade
    hall.ts                         galpão, cerca, faixas no piso
    track.ts · conveyor.ts          pista (linhas e arcos) e geometria das esteiras, elevadores
    line.ts                         esteira de acumulação com batentes (estações)
    sequencer.ts                    fila de movimentos dos robôs
    robots/ur-kinematics.ts         cinemática e IK numérico do UR10e e UR30
    robots/ur-arm.ts                braço na cena, modelos 3D originais, HDRI
    robots/grippers.ts              garra em gancho, cabeça de câmera
    andon.ts · labels.ts · views.ts torre de sinalização, etiquetas, câmeras e tour
    kpi.ts                          UPH e OEE (funções puras)
    shot.ts                         PNG em alta resolução
    room.ts                         sala de produção em volta de uma célula (piso ESD, paredes, luminárias)
    des.ts                          eventos discretos: fila no tempo e sorteio com semente (dias em milissegundos)
    paths.ts                        rotas no piso: grafo de corredores, menor caminho, posição na rota (AGV, AMR, carrinho)
    beacons.ts · merge.ts           luzes de estado instanciadas; junção da geometria estática por material
    ui/                             sim.css (layout das páginas), dom.ts, shot-modal.ts (diálogo do PNG),
                                    page.ts (moldura de página: câmeras, controles, abas, laço; use nos projetos novos)
  projects/transfer-flow/           Transfer Flow 3D
    config.ts                       medidas, layout, modelos de TV, câmeras, etiquetas
    world.ts                        monta a linha, alimenta, avança no tempo, reinicia
    transfers.ts                    Transfer 1 e 2: divisão do trabalho, poses, intertravamento
    inspection.ts                   célula de inspeção com IA
    products.ts                     TV, suporte da montagem, pallet de teste
    ui/                             painel de indicadores, parâmetros
    main.ts                         liga tudo e roda o laço
  projects/memory-flow/             Memory Flow 3D (planta de memórias da Adata Technology)
    layout.ts                       áreas, 219 equipamentos e corredores da planta baixa Rev. C (troque pelo DXF quando chegar)
    process.ts                      famílias, roteiro de 35 operações, tempos (provisórios), cenários
    engine.ts                       fluxo de lotes por eventos discretos: filas, falhas, frota, indicadores
    machines.ts · plant3d.ts        modelos dos equipamentos e a planta em 3D
    actors.ts                       lotes, operadores com carrinho e AMRs
    ui/                             indicadores, comparação de cenários, parâmetros, cartão do equipamento
    cell/                           célula de inspeção pós-corte com IA (página projetos/memory-flow-3d/inspecao/)
      wafer.ts                      mapa de dies e defeitos do wafer (funções puras, com semente)
      cell.ts · main.ts             UR10e com garra de garfo, cassetes, mesa XY com câmera, AMR; painel
  projects/adata-movimentacao/      Adata 06 · movimentação com AMR (usa o motor e a planta da Memory Flow)
  projects/adata-embalagem/         Adata 05 · embalagem final (dry pack) com UR10e e verificação de etiqueta
  projects/adata-retrabalho/        Adata 03 · inspeção 3D de ICs retrabalhados (ics.ts: medição das esferas, puro)
  projects/adata-substratos/        Adata 02 · inspeção de substratos, RGB + espectral (substrate.ts: modelo da tira, puro)
  projects/adata-microscopia/       Adata 01 · microscopia digital: bancada de hoje × digital (model.ts: tempos e imagens, puro)
  portal/                           portal
public/
  projetos.json                     lista de projetos do portal
  capas/<id>.png                    capas dos cartões
  assets/ur10e/*.dae · assets/env/  modelos originais do UR10e e HDRI do galpão
  licencas/                         licenças de terceiros
tests/
  unit/                             Vitest: pista, esteira, IK, indicadores, rotas, eventos, planta e fluxo da Memory Flow
  e2e/                              Playwright: páginas sem erros, vazão e fluxo de referência, portal
  e2e/capa.spec.ts                  gera a capa de um projeto (só com CAPA=<id>)
```

## Comandos

Requer Node 22.12 ou mais novo.

```
npm install
npm run dev          servidor local com recarga automática
npm run typecheck    checagem de tipos
npm test             testes de unidade
npm run build        gera dist/
npm run test:e2e     testes no Chrome (usa o build; rode npm run build antes)
npm run check        tudo acima, em ordem
```

## Testes de vazão

`tests/e2e/transfer-flow.spec.ts` roda 10 minutos simulados de cada modelo (32", 43", 65", 75") e exige
exatamente a vazão de referência e nenhuma perda (TV boa saindo pela montagem ou pallet vazio saindo do teste).
Se a lógica da linha mudar de propósito, meça de novo e atualize os números no mesmo commit.

A página aceita `?model=65` (modelo inicial) e `?bench=10` (roda 10 minutos simulados de uma vez e publica
o resultado em `window.__bench`).

`tests/unit/memory-flow.test.ts` e `tests/e2e/memory-flow.spec.ts` rodam a Memory Flow por 14 dias, depois de
7 dias de aquecimento, nos três cenários, com os parâmetros padrão e a semente 1. Eles exigem exatamente os lotes
expedidos, o lead time e o gargalo de referência. A Memory Flow aceita `?cenario=amr` e `?bench=14` (publica em
`window.__mfBench`). Os tempos de ciclo são provisórios. Quando chegarem os dados do cliente, meça de novo e
atualize as duas tabelas no mesmo commit.

`tests/e2e/memory-flow-cell.spec.ts` roda a célula de inspeção por 45 minutos simulados (`?bench=45`, publica em
`window.__cellBench`). Ele exige os wafers, os lotes e os reprovados de referência, e erro de IK do UR10e abaixo de
5 mm, ou seja, que o robô alcance todos os pontos.

## Capa de um projeto

```
npm run build
CAPA=memory-flow-3d npx playwright test tests/e2e/capa.spec.ts
```

Gera `public/capas/<id>.png` (1600 × 900) em qualidade alta, sem barra, painel e legenda.

## Adicionar um projeto

1. Criar `src/projects/<id>/` usando a biblioteca `src/sim/`.
2. Criar `projetos/<id>/index.html` carregando `src/projects/<id>/main.ts`.
3. Registrar a página em `vite.config.ts` (`pages`).
4. Colocar a capa em `public/capas/<id>.png` e um objeto em `public/projetos.json`:

```json
{
  "id": "meu-projeto",
  "client": "Cliente",
  "name": "Nome do Projeto",
  "status": "estudo",
  "description": "O que é e o que resolve.",
  "metrics": { "uph": "", "robots": "", "models": "", "stations": "" },
  "cover": "capas/meu-projeto.png",
  "url": "projetos/meu-projeto/",
  "updatedAt": "2026-11-17"
}
```

Status aceitos: `estudo`, `validacao`, `aprovado`, `implantacao`, `pausado`.

Quando os rótulos "UPH", "Robôs", "Produtos" e "Estações" não servirem, `metricLabels` troca o rótulo de cada
métrica. Exemplo: `"metricLabels": { "uph": "Capacidade" }`.

## Publicação

`wrangler.jsonc` roda `npm run build` e publica `dist/`. Acesso de clientes: Cloudflare Zero Trust → Access →
Applications, uma aplicação por caminho (ex.: `/projetos/transfer-flow-3d/*`) com os e-mails liberados.

## Licenças

Modelos 3D do UR10e: ROS-Industrial `universal_robot`, licença BSD (`public/licencas/LICENSE-UR10e.txt`).
Iluminação: HDRI "Empty Warehouse 01", Poly Haven, CC0. three.js r128, licença MIT.
