// Configurações padrão de um roteiro. Cada roteiro guarda as suas em roteiro.config.
const PADRAO = {
  formato: 'horizontal',        // ver FORMATOS abaixo
  moldura: true,                // janela/aparelho com fundo colorido
  fundo: 'ameixa',              // nome de um preset ou cor '#rrggbb'
  zoom: 1.8,                    // 1 = sem zoom
  velocidade: 'normal',         // 'lenta' | 'normal' | 'rapida'
  fps: 30,
  qualidade: 'alta',            // 'alta' (1.5x) | 'maxima' (2x)
  mostrarNavegador: false,      // abre a janela do Chromium durante a gravação
  acelerarCarregamentos: true,  // encurta os trechos em que a página está carregando
  mostrarUrl: true,             // barra de endereço na moldura (desktop)
  cursor: true,
  estiloLegenda: 'escuro',      // 'escuro' | 'claro'
  musica: '',                   // nome de um arquivo da pasta /musicas
  volumeMusica: 0.5,
  esconder: '',                 // um alvo por linha: é borrado em todas as páginas
  telaDesktop: '1280x720',      // tamanho da tela em que o site abre no formato Desktop
  resolucao: '1080p'            // '1080p' | '1440p' | '4k'
};

const TELAS_DESKTOP = { '1280x720': { width: 1280, height: 720 }, '1600x900': { width: 1600, height: 900 }, '1920x1080': { width: 1920, height: 1080 } };
const RESOLUCOES = { '1080p': 1, '1440p': 4 / 3, '4k': 2 };
// fração aproximada da largura do vídeo ocupada pelo site dentro da moldura
const OCUPACAO = { horizontal: 0.75, tablet: 0.85, 'tablet-deitado': 0.62, vertical: 0.6 };

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// dispositivo: usado para filtrar passos ("só no celular" etc.)
const FORMATOS = {
  horizontal:       { nome: 'Desktop',        sufixo: 'desktop',        dispositivo: 'desktop', viewport: { width: 1280, height: 720 },  saida: { width: 1920, height: 1080 }, moldura: 'navegador' },
  tablet:           { nome: 'Tablet em pé',   sufixo: 'tablet',         dispositivo: 'tablet',  viewport: { width: 820,  height: 1180 }, saida: { width: 1080, height: 1920 }, moldura: 'tablet', ua: UA_IPAD },
  'tablet-deitado': { nome: 'Tablet deitado', sufixo: 'tablet-deitado', dispositivo: 'tablet',  viewport: { width: 1180, height: 820 },  saida: { width: 1920, height: 1080 }, moldura: 'tablet', ua: UA_IPAD },
  vertical:         { nome: 'Celular',        sufixo: 'celular',        dispositivo: 'celular', viewport: { width: 390,  height: 844 },  saida: { width: 1080, height: 1920 }, moldura: 'celular', ua: UA_IPHONE }
};
// "Gravar nos 3 formatos"
const TRES_FORMATOS = ['horizontal', 'tablet', 'vertical'];

const VELOCIDADES = { lenta: 1.4, normal: 1, rapida: 0.7 };

function comPadrao(config) {
  const c = { ...PADRAO, ...(config || {}) };
  if (!FORMATOS[c.formato]) c.formato = 'horizontal';
  return c;
}
const formatoDe = (config) => FORMATOS[comPadrao(config).formato];
function viewportDe(config) {
  const c = comPadrao(config);
  if (c.formato === 'horizontal') return TELAS_DESKTOP[c.telaDesktop] || TELAS_DESKTOP['1280x720'];
  return FORMATOS[c.formato].viewport;
}
const saidaDe = (config) => formatoDe(config).saida;          // tamanho de layout (1080p)
const fatorResolucao = (config) => RESOLUCOES[comPadrao(config).resolucao] || 1;
function saidaFinal(config) {                                  // tamanho real do vídeo
  const s = saidaDe(config), f = fatorResolucao(config);
  return { width: Math.round(s.width * f / 2) * 2, height: Math.round(s.height * f / 2) * 2 };
}
// nitidez da captura: suficiente para o tamanho final + folga para o zoom
function nitidezCaptura(config) {
  const c = comPadrao(config);
  const vp = viewportDe(c);
  const largura = saidaFinal(c).width * (OCUPACAO[c.formato] || 0.75);
  const folga = c.qualidade === 'maxima' ? 1.6 : 1.25;
  let dsf = (largura / vp.width) * folga;
  dsf = Math.min(3, Math.max(1, dsf), 3840 / vp.width, 3840 / vp.height);
  return Math.round(dsf * 4) / 4;
}

// Um passo pode valer só em alguns aparelhos: p.formatos = 'celular' | 'desktop,tablet' | ...
function passoValeNoFormato(passo, formato) {
  if (!passo || !passo.formatos) return true;
  const lista = String(passo.formatos).split(',').map((s) => s.trim()).filter(Boolean);
  return !lista.length || lista.includes(FORMATOS[formato].dispositivo);
}

// Cria o contexto do navegador no tamanho/aparelho do formato
async function criarContexto(browser, config, dsf = 1) {
  const f = formatoDe(config);
  const opcoes = { viewport: viewportDe(config), deviceScaleFactor: dsf, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' };
  if (f.ua) Object.assign(opcoes, { isMobile: true, hasTouch: false, userAgent: f.ua });
  return browser.newContext(opcoes);
}

module.exports = { PADRAO, FORMATOS, TRES_FORMATOS, VELOCIDADES, TELAS_DESKTOP, RESOLUCOES, comPadrao, formatoDe, viewportDe, saidaDe, saidaFinal, fatorResolucao, nitidezCaptura, passoValeNoFormato, criarContexto };
