# Portal de Projetos de Automação

Site estático publicado no Cloudflare Pages. Cada envio (push) para a branch `main` atualiza o site.

## Estrutura

```
index.html                  portal (lê os cartões de projetos.json)
projetos.json               lista de projetos (um objeto por cartão)
capas/<id>.png              imagem de capa de cada projeto (proporção 16:9, cortada em faixa no cartão)
projetos/<id>/index.html    simulação de cada projeto
_headers                    cabeçalhos do Cloudflare (sem indexação em buscadores)
robots.txt                  bloqueia buscadores
```

## Adicionar um projeto

1. Criar a pasta `projetos/<id>/` com o `index.html` da simulação.
2. Colocar a capa em `capas/<id>.png`.
3. Acrescentar um objeto em `projetos.json`:

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

## Configuração no Cloudflare (Workers com arquivos estáticos)

- `wrangler.jsonc` define o site; `.assetsignore` lista o que não é publicado.
- No painel: Build command vazio, Deploy command `npx wrangler deploy`.
- Acesso de clientes: Cloudflare Zero Trust → Access → Applications, uma aplicação por caminho
  (ex.: `/projetos/transfer-flow-3d/*`) com a lista de e-mails liberados.

## Testar no computador

O navegador não deixa `index.html` ler `projetos.json` quando aberto direto do disco. Na pasta, rode:

```
npx serve .
```

e abra o endereço mostrado.

## Licenças

Modelos 3D do UR10e: ROS-Industrial `universal_robot`, licença BSD (ver `projetos/transfer-flow-3d/LICENSE-UR10e.txt`).
Iluminação: HDRI "Empty Warehouse 01", Poly Haven, CC0. Three.js r128, licença MIT.
