/**
 * Módulo de automação para extração de dados de cartões de transporte
 * @module scraper
 */

const { chromium } = require("playwright-chromium");
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);


// Variável global para armazenar a referência do browser
let browserInstance = null;

/**
 * Obtém timestamp atual formatado para logs
 * @returns {string} Timestamp no formato [HH:MM:SS]
 */
function getTimestamp() {
  const now = new Date();
  return `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
}

/**
 * Função para log com níveis e timestamp
 * @param {string} level - Nível do log (INFO, WARN, ERROR)
 * @param {string} message - Mensagem a ser logada
 */
function log(level, message) {
  const timestamp = getTimestamp();
  const prefix = `${timestamp} [Scraper.js] ${level}`;

  switch(level) {
    case 'ERROR':
      console.error(`${prefix} ❌ ${message}`);
      break;
    case 'WARN':
      console.warn(`${prefix} ⚠️ ${message}`);
      break;
    case 'INFO':
    default:
      console.log(`${prefix} ${message}`);
  }
}

/**
 * Limpa instâncias antigas do Chromium que possam estar abertas
 * @async
 * @returns {Promise<number>} Número de processos encerrados
 */
async function cleanupOldChromiumInstances() {
  log('INFO', '🧹 Verificando instâncias antigas do Chromium...');

  try {
    // Comando para listar processos do Chromium (ajuste conforme o sistema operacional)
    const { stdout } = await execPromise('ps aux | grep -i chrom | grep -v grep || true');

    if (!stdout.trim()) {
      log('INFO', '✅ Nenhuma instância antiga do Chromium encontrada');
      return 0;
    }

    // Extrai os PIDs dos processos do Chromium
    const lines = stdout.split('\n').filter(Boolean);
    const pids = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const pid = parseInt(parts[1]);
        if (!isNaN(pid)) {
          pids.push(pid);
        }
      }
    }

    if (pids.length === 0) {
      log('INFO', '✅ Nenhuma instância antiga do Chromium encontrada para encerrar');
      return 0;
    }

    // Encerra os processos encontrados
    log('WARN', `⚠️ Encontradas ${pids.length} instâncias antigas do Chromium, encerrando...`);

    for (const pid of pids) {
      try {
        await execPromise(`kill -9 ${pid}`);
        log('INFO', `✅ Processo Chromium (PID: ${pid}) encerrado com sucesso`);
      } catch (err) {
        log('WARN', `⚠️ Falha ao encerrar processo Chromium (PID: ${pid}): ${err.message}`);
      }
    }

    log('INFO', `🧹 Limpeza concluída: ${pids.length} processos encerrados`);
    return pids.length;
  } catch (err) {
    log('WARN', `⚠️ Erro ao verificar instâncias antigas do Chromium: ${err.message}`);
    return 0;
  }
}

/**
 * Configura tratamento de sinais do sistema para garantir fechamento do browser
 */
function setupSignalHandlers() {
  // Lista de sinais a serem tratados
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];

  for (const signal of signals) {
    process.on(signal, async () => {
      log('WARN', `⚠️ Sinal ${signal} recebido, encerrando browser...`);

      if (browserInstance) {
        try {
          await browserInstance.close();
          log('INFO', '🔒 Browser fechado devido a sinal do sistema');
        } catch (err) {
          log('ERROR', `Erro ao fechar browser após sinal ${signal}: ${err.message}`);
        }
      }

      // Encerra o processo após um pequeno delay para garantir que os logs sejam escritos
      setTimeout(() => {
        process.exit(0);
      }, 500);
    });
  }

  log('INFO', '🔧 Manipuladores de sinais configurados');
}

/**
 * Extrai dados de cartões de transporte do sistema GVBus
 * @async
 * @param {string} username - Nome de usuário/login para acesso ao sistema
 * @param {string} password - Senha para acesso ao sistema
 * @returns {Promise<Array<Object>>} Lista de cartões com seus dados (cardNumber, employeeId, employeeName, balance)
 * @throws {Error} Erro durante o processo de automação, login ou extração de dados
 */

 async function scrapTransportCards(username, password) {
  // Configurações e constantes
  const LOGIN_URL = "https://recargaonline.gvbus.org.br/frmLogin.aspx";
  const PEDIDO_URL =
    "https://recargaonline.gvbus.org.br/frmPedidoCargaIndividual.aspx?TituloMenu=Novo+pedido+de+carga&NumDias=0&InserePedido=s&FatorAnterior=0&ChaveGrupo=&ValorCarga=0&CodPedidoCopy=0&CodAnoCopy=";
  const DEFAULT_TIMEOUT = 30000; // 30 segundos para operações padrão
  const EXTENDED_TIMEOUT = 60000; // 60 segundos para operações críticas
  const MAX_RETRIES = 2; // Número máximo de tentativas para operações críticas

  // Configura tratamento de sinais do sistema
  setupSignalHandlers();

  // Limpa instâncias antigas do Chromium
  await cleanupOldChromiumInstances();

  log('INFO', `🔰 Iniciando automação de recarga para usuário: ${username}`);

  let page = null;

  try {
    // Inicialização do browser
    browserInstance = await chromium.launch({ headless: true });
    log('INFO', '✅ Browser lançado (headless)');

    page = await browserInstance.newPage();
    log('INFO', '✅ Nova aba aberta');

    // 1) Login - com retry em caso de falha de rede
    let loginSuccess = false;
    let loginAttempts = 0;

    while (!loginSuccess && loginAttempts < MAX_RETRIES) {
      try {
        loginAttempts++;
        log('INFO', `➡️ 1) Navegando até ${LOGIN_URL} (tentativa ${loginAttempts}/${MAX_RETRIES})`);
        await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: EXTENDED_TIMEOUT });
        loginSuccess = true;
        log('INFO', '✅ Página de login carregada');
      } catch (err) {
        if (loginAttempts >= MAX_RETRIES) {
          throw new Error(`Falha ao carregar página de login após ${MAX_RETRIES} tentativas: ${err.message}`);
        }
        log('WARN', `⚠️ Falha ao carregar página de login, tentando novamente: ${err.message}`);
        await page.waitForTimeout(2000); // Espera 2 segundos antes de tentar novamente
      }
    }

    // 2) Aceita LGPD
    log('INFO', '➡️ 2) Verificando modal de LGPD');
    const lgpdCheckbox = await page.$("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
    if (lgpdCheckbox) {
      log('INFO', '   • Modal LGPD encontrado, aceitando...');
      await page.click("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
      await page.waitForSelector("#Toolbar_modalTermoAceiteLGPD", { state: "hidden", timeout: DEFAULT_TIMEOUT });
      log('INFO', '   • LGPD aceita');
    } else {
      log('INFO', '   • Modal LGPD não apareceu');
    }

    // 3) Cookies
    log('INFO', '➡️ 3) Fechando modal de cookies (se existir)');
    const cookiesBtn = await page.$("#modalPoliticaCookies input.button");
    if (cookiesBtn) {
      log('INFO', '   • Modal cookies encontrado, fechando...');
      await cookiesBtn.click();
      await page.waitForSelector("#modalPoliticaCookies", { state: "hidden", timeout: DEFAULT_TIMEOUT });
      log('INFO', '   • Modal cookies fechado');
    } else {
      log('INFO', '   • Modal cookies não apareceu');
    }

    // 4) Preenche credenciais
    log('INFO', '➡️ 4) Preenchendo usuário e senha');
    try {
      await page.waitForSelector("#txtEmailTitular", { state: 'visible', timeout: DEFAULT_TIMEOUT });
      await page.fill("#txtEmailTitular", username);
      log('INFO', '   • Usuário preenchido');

      await page.waitForSelector("#txtSenha", { state: 'visible', timeout: DEFAULT_TIMEOUT });
      await page.fill("#txtSenha", password);
      log('INFO', '   • Senha preenchida');
    } catch (err) {
      throw new Error(`Falha ao preencher credenciais: ${err.message}`);
    }

    // 5) Submete login
    log('INFO', '➡️ 5) Submetendo login');
    try {
      await Promise.all([
        page.click("#btnLogin"),
        page.waitForLoadState("networkidle", { timeout: EXTENDED_TIMEOUT }),
      ]);

      // 5.1) Verifica possível erro de login
      if (await page.$("#lblErro")) {
        const errorMessage = await page.$eval("#lblErro", (el) => el.innerText.trim());
        log('ERROR', `Falha no login: ${errorMessage}`);
        throw new Error(`Falha no login na operadora: ${errorMessage}`);
      }
      log('INFO', '✅ Login bem-sucedido e página estabilizada');
    } catch (err) {
      if (!err.message.includes("Falha no login na operadora")) {
        err.message = `Erro durante submissão do login: ${err.message}`;
      }
      throw err;
    }

    // 6) Abre a página direta de Pedido de Carga
    log('INFO', `➡️ 6) Navegando até Pedido de Carga: ${PEDIDO_URL}`);
    try {
      await page.goto(PEDIDO_URL, { waitUntil: "networkidle", timeout: EXTENDED_TIMEOUT });
      await page.waitForSelector("table#gridPedidos", { state: 'visible', timeout: EXTENDED_TIMEOUT });
      log('INFO', '✅ Página de Pedido de Carga carregada');
    } catch (err) {
      throw new Error(`Falha ao carregar página de Pedido de Carga: ${err.message}`);
    }

    // 7) Marcar "Exibir detalhes"
    log('INFO', '➡️ 7) Clicando em "Exibir detalhes"');
    try {
      await page.check("#chkGrid");
      await page.waitForTimeout(1000); // Aumentado para 1 segundo para garantir atualização da tabela
      log('INFO', '✅ "Exibir detalhes" marcado');
    } catch (err) {
      log('WARN', `⚠️ Falha ao marcar "Exibir detalhes": ${err.message}`);
      // Continua mesmo com falha, pois pode ser que já esteja marcado
    }

    // 8) Esperar pela tabela
    log('INFO', '➡️ 8) Aguardando tabela de funcionários');
    try {
      await page.waitForSelector("table#gridPedidos tbody tr", { state: 'visible', timeout: EXTENDED_TIMEOUT });

      // 8.1) Log de quantas linhas encontrou
      const totalRows = await page.$$eval(
        "table#gridPedidos tbody tr",
        (trs) => trs.length
      );

      if (totalRows === 0) {
        log('WARN', '⚠️ Tabela carregada, mas nenhuma linha encontrada');
        return []; // Retorna array vazio se não houver linhas
      }

      log('INFO', `⚙️ Encontradas ${totalRows} linhas no tbody`);
      log('INFO', '✅ Tabela carregada');
    } catch (err) {
      throw new Error(`Falha ao aguardar tabela de funcionários: ${err.message}`);
    }

    // 9) Extrair dados de forma robusta
    log('INFO', '➡️ 9) Extraindo dados das linhas');
    try {
      const dados = await page.$$eval(
        "table#gridPedidos tbody tr",
        (rows) =>
          Array.from(rows)
            .map((row) => {
              try {
                const tds = Array.from(row.querySelectorAll("td"));
                if (tds.length < 4) return null;

                const [cardNumber, employeeId, employeeName, balanceText] = tds
                  .slice(0, 4)
                  .map((td) => td.textContent.trim());

                // Validação dos campos obrigatórios
                if (!cardNumber || !employeeId || !employeeName) return null;

                // Tratamento robusto para o saldo
                let balance = 0;
                if (balanceText) {
                  try {
                    balance = parseFloat(
                      balanceText.replace(/\./g, "").replace(",", ".")
                    );

                    // Verifica se o resultado é um número válido
                    if (isNaN(balance)) {
                      console.warn(`Saldo inválido para cartão ${cardNumber}: "${balanceText}"`);
                      balance = 0;
                    }
                  } catch (err) {
                    console.warn(`Erro ao converter saldo para cartão ${cardNumber}: "${balanceText}"`);
                    balance = 0;
                  }
                }

                return { cardNumber, employeeId, employeeName, balance };
              } catch (err) {
                console.warn(`Erro ao processar linha da tabela: ${err.message}`);
                return null;
              }
            })
            .filter(Boolean)
      );

      if (dados.length === 0) {
        log('WARN', '⚠️ Nenhum dado válido extraído da tabela');
      } else {
        log('INFO', `✅ Dados extraídos (${dados.length} linhas):\n${JSON.stringify(dados, null, 2)}`);
      }

      return dados; // Retorna os dados extraídos
    } catch (err) {
      throw new Error(`Falha ao extrair dados da tabela: ${err.message}`);
    }

  } catch (err) {
    log('ERROR', `Erro durante a automação: ${err.message}`);
    // Propaga o erro para ser tratado pelo chamador (server.js)
    throw err;
  } finally {
    // Garante que o browser seja fechado mesmo em caso de erro
    if (browserInstance) {
      try {
        await browserInstance.close();
        browserInstance = null; // Limpa a referência global
        log('INFO', '🔒 Browser fechado');
      } catch (err) {
        log('WARN', `⚠️ Erro ao fechar browser: ${err.message}`);
        browserInstance = null; // Limpa a referência global mesmo em caso de erro
      }
    }
  }
}
// Exporta a função principal e as funções auxiliares para uso em testes
module.exports = {
  scrapTransportCards,
  cleanupOldChromiumInstances, // Exportado para permitir uso em scripts de manutenção
  setupSignalHandlers // Exportado para permitir configuração manual em outros contextos
};
