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
  resolucao: '1080p',           // '1080p' | '1440p' | '4k'
  perfil: '',                   // login lembrado: nome do perfil do navegador ('' = sem login)

  // legendas
  legendasNoVideo: true,        // desligue se for usar só o arquivo .srt

  // narração automática
  narracaoAtiva: false,
  narracaoMotor: 'auto',        // 'auto' | 'neural' (internet) | 'windows' (offline)
  narracaoVoz: 'pt-BR-FranciscaNeural',
  narracaoVelocidade: 0,        // -30 a +30 (%)
  narracaoUsarLegendas: true,   // fala as legendas quando o passo não tem narração própria
  volumeNarracao: 1,

  // abertura e encerramento
  abertura: false, aberturaTitulo: '', aberturaSubtitulo: '', aberturaSegundos: 3,
  encerramento: false, encerramentoTexto: 'Compre agora', encerramentoUrl: '', encerramentoQr: true, encerramentoSegundos: 4,

  // marca d'água
  logo: false, logoPosicao: 'inf-dir', logoTamanho: 12, logoOpacidade: 0.85,

  // arquivos extras
  gerarCapa: false, gerarGif: false, gifLargura: 640, gifSegundosMax: 15, gerarSrt: false
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

function opcoesContexto(config, dsf = 1) {
  const f = formatoDe(config);
  const opcoes = { viewport: viewportDe(config), deviceScaleFactor: dsf, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' };
  if (f.ua) Object.assign(opcoes, { isMobile: true, hasTouch: false, userAgent: f.ua });
  return opcoes;
}

// Cria o contexto do navegador no tamanho/aparelho do formato
async function criarContexto(browser, config, dsf = 1) {
  return browser.newContext(opcoesContexto(config, dsf));
}

const slugPerfil = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'perfil';
const pastaPerfil = (nome) => process.env.CLICKREEL_PERFIS ? require('path').join(process.env.CLICKREEL_PERFIS, slugPerfil(nome)) : null;

// Abre o navegador. Com "perfil" (login lembrado) usa uma pasta própria que guarda
// cookies e sessões entre as gravações; sem perfil, começa sempre limpo.
// Devolve { browser, context, pagina() } — browser tem close() e on('disconnected').
async function abrirNavegador(config, { headless = true, dsf = 1 } = {}) {
  const { chromium } = require('playwright');
  const c = comPadrao(config);
  const opcoes = opcoesContexto(c, dsf);
  const dir = c.perfil ? pastaPerfil(c.perfil) : null;
  // menos "cara de robô": o Google, por exemplo, recusa login em navegador marcado como automatizado
  const disfarce = { args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] };
  if (dir) {
    require('fs').mkdirSync(dir, { recursive: true });
    // com login lembrado, usa o Google Chrome instalado (se houver): é o que menos sofre bloqueio de login
    let context;
    try { context = await chromium.launchPersistentContext(dir, { headless, channel: 'chrome', ...disfarce, ...opcoes }); }
    catch (_) { context = await chromium.launchPersistentContext(dir, { headless, ...disfarce, ...opcoes }); }
    const browser = {
      close: () => context.close(),
      on: (ev, fn) => { if (ev === 'disconnected') context.on('close', fn); }
    };
    return { browser, context, pagina: async () => context.pages()[0] || context.newPage() };
  }
  const browser = await chromium.launch({ headless, ...disfarce });
  const context = await browser.newContext(opcoes);
  return { browser, context, pagina: () => context.newPage() };
}

module.exports = { abrirNavegador, opcoesContexto, pastaPerfil, slugPerfil, PADRAO, FORMATOS, TRES_FORMATOS, VELOCIDADES, TELAS_DESKTOP, RESOLUCOES, comPadrao, formatoDe, viewportDe, saidaDe, saidaFinal, fatorResolucao, nitidezCaptura, passoValeNoFormato, criarContexto };
