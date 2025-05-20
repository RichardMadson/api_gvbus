/**
 * Módulo de automação para extração de dados de cartões de transporte
 * Versão Híbrida - Combina abordagens para muitos e poucos cartões
 */

const { chromium } = require("playwright-chromium");

/**
 * Função principal que tenta primeiro o método para muitos cartões
 * e, em caso de falha, utiliza o método para poucos cartões
 */
async function scrapTransportCards(username, password) {
  console.log(`[Scraper.js] 🔰 Iniciando automação de recarga para usuário: ${username}`);
  console.log("[Scraper.js] ℹ️ Usando abordagem híbrida (tentativa com dois métodos)");

  try {
    // Primeiro tenta o método para muitos cartões (Versão 1.0)
    console.log("[Scraper.js] 🔄 Tentando método para muitos cartões (Versão 1.0)");
    const dados = await scrapTransportCardsV1(username, password);
    console.log("[Scraper.js] ✅ Método para muitos cartões bem-sucedido");
    return dados;
  } catch (err) {
    // Se falhar, registra o erro e tenta o método para poucos cartões
    console.log("[Scraper.js] ⚠️ Método para muitos cartões falhou:", err.message);
    console.log("[Scraper.js] 🔄 Tentando método alternativo para poucos cartões (Versão 2.0)");

    try {
      const dados = await scrapTransportCardsV2(username, password);
      console.log("[Scraper.js] ✅ Método para poucos cartões bem-sucedido");
      return dados;
    } catch (err2) {
      console.error("[Scraper.js] ❌ Ambos os métodos falharam");
      console.error("[Scraper.js] ❌ Erro no método para poucos cartões:", err2.message);
      throw new Error(`Falha em ambos os métodos de extração: ${err2.message}`);
    }
  }
}

/**
 * Método para muitos cartões (Versão 1.0)
 * Otimizado para usuários com muitos cartões cadastrados
 */
async function scrapTransportCardsV1(username, password) {
  const LOGIN_URL = "https://recargaonline.gvbus.org.br/frmLogin.aspx";
  const PEDIDO_URL =
    "https://recargaonline.gvbus.org.br/frmPedidoCargaIndividual.aspx?TituloMenu=Novo+pedido+de+carga&NumDias=0&InserePedido=s&FatorAnterior=0&ChaveGrupo=&ValorCarga=0&CodPedidoCopy=0&CodAnoCopy=";

  const TIMEOUT_PADRAO = 60000; // 60 segundos

  console.log(`[Scraper.js] [V1] 🔰 Iniciando método para muitos cartões: ${username}`);

  const browser = await chromium.launch({ headless: true });
  console.log("[Scraper.js] [V1] ✅ Browser lançado (headless)");

  const page = await browser.newPage();
  console.log("[Scraper.js] [V1] ✅ Nova aba aberta");

  try {
    // 1) Login
    console.log(`[Scraper.js] [V1] ➡️ 1) Navegando até ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT_PADRAO });
    console.log("[Scraper.js] [V1] ✅ Página de login carregada");

    // 2) Aceita LGPD
    console.log("[Scraper.js] [V1] ➡️ 2) Verificando modal de LGPD");
    const lgpdCheckbox = await page.$("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
    if (lgpdCheckbox) {
      console.log("[Scraper.js] [V1]    • Modal LGPD encontrado, aceitando...");
      await page.click("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
      await page.waitForSelector("#Toolbar_modalTermoAceiteLGPD", { state: "hidden", timeout: 30000 });
      console.log("[Scraper.js] [V1]    • LGPD aceita");
    } else {
      console.log("[Scraper.js] [V1]    • Modal LGPD não apareceu");
    }

    // 3) Cookies
    console.log("[Scraper.js] [V1] ➡️ 3) Fechando modal de cookies (se existir)");
    const btnCookies = await page.$("#modalPoliticaCookies input.button");
    if (btnCookies) {
      console.log("[Scraper.js] [V1]    • Modal cookies encontrado, fechando...");
      await btnCookies.click();
      await page.waitForSelector("#modalPoliticaCookies", { state: "hidden", timeout: 30000 });
      console.log("[Scraper.js] [V1]    • Modal cookies fechado");
    } else {
      console.log("[Scraper.js] [V1]    • Modal cookies não apareceu");
    }

    // 4) Preenche credenciais
    console.log("[Scraper.js] [V1] ➡️ 4) Preenchendo usuário e senha");
    await page.waitForSelector("#txtEmailTitular", { timeout: TIMEOUT_PADRAO });
    await page.fill("#txtEmailTitular", username);
    console.log("[Scraper.js] [V1]     • Usuário preenchido");
    await page.waitForSelector("#txtSenha", { timeout: TIMEOUT_PADRAO });
    await page.fill("#txtSenha", password);
    console.log("[Scraper.js] [V1]     • Senha preenchida");

    // 5) Submete login
    console.log("[Scraper.js] [V1] ➡️ 5) Submetendo login");
    await Promise.all([
      page.click("#btnLogin"),
      page.waitForLoadState("networkidle", { timeout: TIMEOUT_PADRAO }),
    ]);
    console.log("[Scraper.js] [V1] ✅ Login submetido e página estabilizada");

    // Verificar se o login foi bem-sucedido
    const loginError = await page.$("#lblErro");
    if (loginError && await loginError.isVisible()) {
        const errorMessage = await loginError.innerText();
        console.error(`[Scraper.js] [V1] ❌ Falha no login: ${errorMessage}`);
        throw new Error(`Falha no login na operadora: ${errorMessage.trim()}`);
    }

    // 6) Abre a página direta de Pedido de Carga
    console.log(`[Scraper.js] [V1] ➡️ 6) Navegando até Pedido de Carga: ${PEDIDO_URL}`);
    await page.goto(PEDIDO_URL, { waitUntil: "networkidle", timeout: TIMEOUT_PADRAO });
    console.log("[Scraper.js] [V1] ✅ Página de Pedido de Carga carregada");

    // 6.1) Verificar e fechar mensagem de erro se existir
    console.log("[Scraper.js] [V1] ➡️ 6.1) Verificando se existe mensagem de erro para fechar");
    const errorOkButton = await page.$("#imgOK");
    if (errorOkButton) {
      console.log("[Scraper.js] [V1]    • Mensagem de erro encontrada, fechando...");
      await errorOkButton.click();
      await page.waitForTimeout(1000); // Aguarda um segundo para a mensagem fechar completamente
      console.log("[Scraper.js] [V1]    • Mensagem de erro fechada com sucesso");
    } else {
      console.log("[Scraper.js] [V1]    • Nenhuma mensagem de erro encontrada");
    }

    // 7) Marcar "Exibir detalhes"
    console.log("[Scraper.js] [V1] ➡️ 7) Clicando em Exibir detalhes");
    await page.waitForSelector("label[for=\"chkGrid\"]", { timeout: 30000 });
    await page.click("label[for=\"chkGrid\"]");
    console.log("[Scraper.js] [V1] ✅ Exibir detalhes marcado");

    // 8) Esperar pela tabela - TIMEOUT REDUZIDO PARA FALHAR MAIS RÁPIDO SE NECESSÁRIO
    console.log("[Scraper.js] [V1] ➡️ 8) Aguardando tabela de funcionários");
    // Reduzimos o timeout para 30 segundos para falhar mais rápido se necessário
    await page.waitForSelector("table#gridPedidos tbody tr", { timeout: 30000 });
    console.log("[Scraper.js] [V1] ✅ Tabela carregada");

    // 9) Extrair dados
    console.log("[Scraper.js] [V1] ➡️ 9) Extraindo dados das linhas");
    const rows = await page.$$("table#gridPedidos tbody tr.trNormal, table#gridPedidos tbody tr.trNormal_impar");

    // Se não encontrou linhas, lança erro para tentar o método alternativo
    if (rows.length === 0) {
      console.log("[Scraper.js] [V1] ⚠️ Nenhuma linha encontrada com seletor específico");
      throw new Error("Nenhuma linha encontrada na tabela com seletor específico");
    }

    const dados = [];
    for (const [i, row] of rows.entries()) {
      console.log(`[Scraper.js] [V1]    • Processando linha ${i + 1}`);
      try {
        const [cardNumber, employeeId, employeeName, balanceText] = await row.$$eval(
          "td",
          (tds) => tds.slice(0, 4).map((td) => td.innerText.trim())
        );

        // Validação básica dos dados
        if (!cardNumber || !employeeId || !employeeName) {
          console.log(`[Scraper.js] [V1]    • Linha ${i + 1} com dados incompletos, pulando`);
          continue;
        }

        // Tratamento do saldo
        let balance = 0;
        if (balanceText) {
          try {
            balance = parseFloat(balanceText.replace(/\./g, "").replace(",", "."));
            if (isNaN(balance)) {
              console.log(`[Scraper.js] [V1]    • Saldo inválido para cartão ${cardNumber}: "${balanceText}"`);
              balance = 0;
            }
          } catch (err) {
            console.log(`[Scraper.js] [V1]    • Erro ao converter saldo para cartão ${cardNumber}: "${balanceText}"`);
            balance = 0;
          }
        }

        dados.push({ cardNumber, employeeId, employeeName, balance });
      } catch (err) {
        console.log(`[Scraper.js] [V1]    • Erro ao processar linha ${i + 1}: ${err.message}`);
        // Continua para a próxima linha
      }
    }

    console.log(`[Scraper.js] [V1] ✅ Dados extraídos: ${dados.length} registros`);

    // Se não extraiu nenhum dado, lança erro para tentar o método alternativo
    if (dados.length === 0) {
      console.log("[Scraper.js] [V1] ⚠️ Nenhum dado extraído da tabela");
      throw new Error("Nenhum dado extraído da tabela");
    }

    return dados; // Retorna os dados extraídos

  } catch (err) {
    console.error("[Scraper.js] [V1] ❌ Erro durante a automação:", err.message);
    // Propaga o erro para ser tratado pelo método híbrido
    throw err;
  } finally {
    if (browser) {
      await browser.close();
      console.log("[Scraper.js] [V1] 🔒 Browser fechado");
    }
  }
}

/**
 * Método para poucos cartões (Versão 2.0)
 * Otimizado para usuários com poucos cartões cadastrados
 */
async function scrapTransportCardsV2(username, password) {
  const LOGIN_URL = "https://recargaonline.gvbus.org.br/frmLogin.aspx";
  const PEDIDO_URL =
    "https://recargaonline.gvbus.org.br/frmPedidoCargaIndividual.aspx?TituloMenu=Novo+pedido+de+carga&NumDias=0&InserePedido=s&FatorAnterior=0&ChaveGrupo=&ValorCarga=0&CodPedidoCopy=0&CodAnoCopy=";

  const DEFAULT_TIMEOUT = 30000; // 30 segundos para operações padrão
  const EXTENDED_TIMEOUT = 60000; // 60 segundos para operações críticas

  console.log(`[Scraper.js] [V2] 🔰 Iniciando método para poucos cartões: ${username}`);

  const browser = await chromium.launch({ headless: true });
  console.log("[Scraper.js] [V2] ✅ Browser lançado (headless)");

  const page = await browser.newPage();
  console.log("[Scraper.js] [V2] ✅ Nova aba aberta");

  try {
    // 1) Login
    console.log(`[Scraper.js] [V2] ➡️ 1) Navegando até ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: EXTENDED_TIMEOUT });
    console.log("[Scraper.js] [V2] ✅ Página de login carregada");

    // 2) Aceita LGPD
    console.log("[Scraper.js] [V2] ➡️ 2) Verificando modal de LGPD");
    const lgpdCheckbox = await page.$("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
    if (lgpdCheckbox) {
      console.log("[Scraper.js] [V2]    • Modal LGPD encontrado, aceitando...");
      await page.click("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
      await page.waitForSelector("#Toolbar_modalTermoAceiteLGPD", { state: "hidden", timeout: DEFAULT_TIMEOUT });
      console.log("[Scraper.js] [V2]    • LGPD aceita");
    } else {
      console.log("[Scraper.js] [V2]    • Modal LGPD não apareceu");
    }

    // 3) Cookies
    console.log("[Scraper.js] [V2] ➡️ 3) Fechando modal de cookies (se existir)");
    const cookiesBtn = await page.$("#modalPoliticaCookies input.button");
    if (cookiesBtn) {
      console.log("[Scraper.js] [V2]    • Modal cookies encontrado, fechando...");
      await cookiesBtn.click();
      await page.waitForSelector("#modalPoliticaCookies", { state: "hidden", timeout: DEFAULT_TIMEOUT });
      console.log("[Scraper.js] [V2]    • Modal cookies fechado");
    } else {
      console.log("[Scraper.js] [V2]    • Modal cookies não apareceu");
    }

    // 4) Preenche credenciais
    console.log("[Scraper.js] [V2] ➡️ 4) Preenchendo usuário e senha");
    try {
      await page.waitForSelector("#txtEmailTitular", { state: 'visible', timeout: DEFAULT_TIMEOUT });
      await page.fill("#txtEmailTitular", username);
      console.log("[Scraper.js] [V2]    • Usuário preenchido");

      await page.waitForSelector("#txtSenha", { state: 'visible', timeout: DEFAULT_TIMEOUT });
      await page.fill("#txtSenha", password);
      console.log("[Scraper.js] [V2]    • Senha preenchida");
    } catch (err) {
      throw new Error(`Falha ao preencher credenciais: ${err.message}`);
    }

    // 5) Submete login
    console.log("[Scraper.js] [V2] ➡️ 5) Submetendo login");
    try {
      await Promise.all([
        page.click("#btnLogin"),
        page.waitForLoadState("networkidle", { timeout: EXTENDED_TIMEOUT }),
      ]);

      // 5.1) Verifica possível erro de login
      if (await page.$("#lblErro")) {
        const errorMessage = await page.$eval("#lblErro", (el) => el.innerText.trim());
        console.error(`[Scraper.js] [V2] ❌ Falha no login: ${errorMessage}`);
        throw new Error(`Falha no login na operadora: ${errorMessage}`);
      }
      console.log("[Scraper.js] [V2] ✅ Login bem-sucedido e página estabilizada");
    } catch (err) {
      if (!err.message.includes("Falha no login na operadora")) {
        err.message = `Erro durante submissão do login: ${err.message}`;
      }
      throw err;
    }

    // 6) Abre a página direta de Pedido de Carga
    console.log(`[Scraper.js] [V2] ➡️ 6) Navegando até Pedido de Carga: ${PEDIDO_URL}`);
    try {
      await page.goto(PEDIDO_URL, { waitUntil: "networkidle", timeout: EXTENDED_TIMEOUT });
      await page.waitForSelector("table#gridPedidos", { state: 'visible', timeout: EXTENDED_TIMEOUT });
      console.log("[Scraper.js] [V2] ✅ Página de Pedido de Carga carregada");
    } catch (err) {
      throw new Error(`Falha ao carregar página de Pedido de Carga: ${err.message}`);
    }

    // 7) Marcar "Exibir detalhes"
    console.log("[Scraper.js] [V2] ➡️ 7) Clicando em Exibir detalhes");
    try {
      await page.check("#chkGrid");
      await page.waitForTimeout(1000); // Aumentado para 1 segundo para garantir atualização da tabela
      console.log("[Scraper.js] [V2] ✅ Exibir detalhes marcado");
    } catch (err) {
      console.log(`[Scraper.js] [V2] ⚠️ Falha ao marcar "Exibir detalhes": ${err.message}`);
      // Continua mesmo com falha, pois pode ser que já esteja marcado
    }

    // 8) Esperar pela tabela
    console.log("[Scraper.js] [V2] ➡️ 8) Aguardando tabela de funcionários");
    try {
      await page.waitForSelector("table#gridPedidos tbody tr", { state: 'visible', timeout: EXTENDED_TIMEOUT });

      // 8.1) Log de quantas linhas encontrou
      const totalRows = await page.$$eval(
        "table#gridPedidos tbody tr",
        (trs) => trs.length
      );

      if (totalRows <= 1) {
        console.log("[Scraper.js] [V2] ⚠️ Tabela carregada, mas apenas com cabeçalho ou vazia");

        // Verificar se a única linha é o cabeçalho
        const isTitleOnly = await page.evaluate(() => {
          const rows = document.querySelectorAll("table#gridPedidos tbody tr");
          return rows.length === 1 && rows[0].classList.contains('trTitulo');
        });

        if (isTitleOnly) {
          console.log("[Scraper.js] [V2] ℹ️ Tabela contém apenas o cabeçalho, sem dados");
          return [];
        }
      }

      console.log(`[Scraper.js] [V2] ⚙️ Encontradas ${totalRows} linhas no tbody`);
      console.log("[Scraper.js] [V2] ✅ Tabela carregada");
    } catch (err) {
      throw new Error(`Falha ao aguardar tabela de funcionários: ${err.message}`);
    }

    // 9) Extrair dados de forma robusta
    console.log("[Scraper.js] [V2] ➡️ 9) Extraindo dados das linhas");
    try {
      const dados = await page.$$eval(
        "table#gridPedidos tbody tr",
        (rows) =>
          Array.from(rows)
            .filter(row => !row.classList.contains('trTitulo')) // Excluir linha de cabeçalho
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
            .filter(Boolean) // Remover itens nulos
      );

      console.log(`[Scraper.js] [V2] ✅ Dados extraídos: ${dados.length} registros`);
      return dados; // Retorna os dados extraídos
    } catch (err) {
      throw new Error(`Falha ao extrair dados da tabela: ${err.message}`);
    }

  } catch (err) {
    console.error("[Scraper.js] [V2] ❌ Erro durante a automação:", err.message);
    // Propaga o erro para ser tratado pelo método híbrido
    throw err;
  } finally {
    if (browser) {
      await browser.close();
      console.log("[Scraper.js] [V2] 🔒 Browser fechado");
    }
  }
}

module.exports = { scrapTransportCards };
