# Componentes de terceiros

O código do ClickReel é distribuído sob a licença MIT (veja `LICENSE`).
O instalador para Windows também inclui os programas abaixo, cada um com a sua
própria licença. Eles são distribuídos sem modificação.

| Componente | Uso no ClickReel | Licença | Código-fonte |
|---|---|---|---|
| [FFmpeg](https://ffmpeg.org) (via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)) | gera o arquivo MP4 | GPL-3.0-or-later | https://ffmpeg.org/download.html · binários: https://github.com/eugeneware/ffmpeg-static/releases |
| [Playwright](https://playwright.dev) | controla o navegador | Apache-2.0 | https://github.com/microsoft/playwright |
| [Chromium](https://www.chromium.org) (baixado pelo Playwright) | navegador usado nas gravações | BSD-3-Clause e outras | https://source.chromium.org/chromium |
| [Node.js](https://nodejs.org) | executa o ClickReel | MIT e outras | https://github.com/nodejs/node |

O FFmpeg é um programa separado, chamado pelo ClickReel como um processo externo.
O texto completo da licença dele vai junto, em
`node_modules/ffmpeg-static/ffmpeg.LICENSE`. As licenças dos demais componentes
estão nas respectivas pastas dentro de `node_modules/` e `navegadores/`.
