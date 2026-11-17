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
  projects/transfer-flow/           Transfer Flow 3D
    config.ts                       medidas, layout, modelos de TV, câmeras, etiquetas
    world.ts                        monta a linha, alimenta, avança no tempo, reinicia
    transfers.ts                    Transfer 1 e 2: divisão do trabalho, poses, intertravamento
    inspection.ts                   célula de inspeção com IA
    products.ts                     TV, suporte da montagem, pallet de teste
    ui/                             painel de indicadores, parâmetros, PNG
    main.ts                         liga tudo e roda o laço
  portal/                           portal
public/
  projetos.json                     lista de projetos do portal
  capas/<id>.png                    capas dos cartões
  assets/ur10e/*.dae · assets/env/  modelos originais do UR10e e HDRI do galpão
  licencas/                         licenças de terceiros
tests/
  unit/                             Vitest: pista, esteira, IK, indicadores
  e2e/                              Playwright: página sem erros, vazão de referência por modelo
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

## Publicação

`wrangler.jsonc` roda `npm run build` e publica `dist/`. Acesso de clientes: Cloudflare Zero Trust → Access →
Applications, uma aplicação por caminho (ex.: `/projetos/transfer-flow-3d/*`) com os e-mails liberados.

## Licenças

Modelos 3D do UR10e: ROS-Industrial `universal_robot`, licença BSD (`public/licencas/LICENSE-UR10e.txt`).
Iluminação: HDRI "Empty Warehouse 01", Poly Haven, CC0. three.js r128, licença MIT.
