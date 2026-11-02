# henriquemenezzo.com

Réplica do site publicado no Framer, em HTML estático gerado pelo Astro. Não há React nem runtime do Framer no navegador: só CSS e alguns módulos pequenos de JS.

## Rodar

```bash
npm install
npm run dev
```

O site abre em `http://localhost:5241`. Para ver a versão final:

```bash
npm run build
npm run preview
```

A saída fica em `dist/`, pronta para qualquer hospedagem estática.

## Onde mexer

| O que | Onde |
| --- | --- |
| Textos e links da lista de projetos | `src/data/projects.ts` |
| Home | `src/pages/index.astro` e `src/styles/home.css` |
| Cases | `src/pages/<case>.astro` e `src/styles/cases/<case>.css` |
| Nav, footer, loader, card de hover | `src/components/` |
| Fontes, cores e cortina entre páginas | `src/styles/global.css` |

Os cases foram gerados uma vez a partir do HTML do Framer por `tools/convert-case.mjs`. A partir daí, os arquivos em `src/` são a fonte de verdade: edite neles e não rode o conversor de novo, porque ele sobrescreve as páginas.

O footer é um componente só. Goldcare e Playground passam `motion` e `fixedHeight` ou `largeCredit`, porque no Framer cada um calibra o rodapé de um jeito.

## Movimento

| Efeito | Como funciona |
| --- | --- |
| Loader, marquee, hover, entrada dos títulos | CSS puro |
| Parallax | `data-speed` no HTML, lido por `src/scripts/scroll.ts` |
| Linhas de vídeo do About | `data-range` e `data-values` |
| Faixa horizontal do Tex | `data-x="inicio,fim"`, ligada ao progresso da página |
| Rastro do hero | `src/scripts/hero-trail.ts`, carregado só no primeiro movimento do mouse |
| Abrir e fechar projeto | Cortina toda em CSS (`global.css`): sobe com o nome do projeto, na lista da home e em "Next project", e no X desce até a home sem repetir o loader. `src/scripts/open-project.js` só põe as classes e segura a página nova até o hero estar pronto |
| Cursor e card de preview | `src/scripts/cursor.ts`, só em dispositivos com mouse |
| Smooth scroll | Lenis, com `duration: 2` como no Framer, só em dispositivos com mouse. O loop roda apenas durante a rolagem |
| Vídeos | `src/scripts/videos.ts`: carregam perto da tela e pausam fora dela |

Um atributo com sufixo vale só naquele breakpoint: `data-speed-p` (celular), `-t` (tablet), `-sm`, `-md`, `-lg` e `-xl`.

## Escala dos cases

De 1440 px para cima os cases têm um layout só, e o `Base.astro` o escala com a janela pela variável `--zoom` (largura / 1500). `tools/one-desktop.py` removeu os presets maiores do Framer e ajustou os `sizes`. Ele roda uma vez sobre a saída do conversor: rodar duas vezes duplica o `calc`.

Como o `zoom` multiplica px e `translate`, `scroll.ts` divide por ele.

## Mídia

A foto do hero sai de `tools/hero-photo.mjs`, em 1400, 2000 e 2800 px. A fonte tem só 1129 px, então o script limpa os blocos de compressão e devolve nitidez apenas nas bordas. Se você tiver um arquivo melhor, é só apontar o script para ele e gerar de novo. Em telas de computador ela acompanha a altura da janela (`--photo` em `home.css`).

Os arquivos em `public/img` e `public/video` saíram dos originais do Framer por `tools/optimize-media.mjs`, `tools/encode-videos.sh` e `tools/video-posters.mjs`. O mapa entre o nome original e o novo está em `src/data/media.json`.
