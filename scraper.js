/**
 * Módulo de automação para extração de dados de cartões de transporte
 * Versão Otimizada - Alta eficiência, resiliência e logs detalhados
 */

const { chromium } = require("playwright-chromium");

/**
 * Função utilitária para retry automático em etapas críticas
 */
async function withRetry(fn, retries = 3, delay = 2000, step = "desconhecida") {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      if (i > 0) console.log(`[Retry] Tentativa ${i + 1} de ${retries} para etapa: ${step}`);
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await new Promise(res => setTimeout(res, delay));
    }
  }
  throw new Error(`Falha após ${retries} tentativas na etapa: ${step}. Erro: ${lastErr.message}`);
}

/**
 * Bloqueia carregamento de imagens para acelerar o scraping
 */
async function bloquearRecursos(page) {
  await page.route('**/*.{png,jpg,jpeg,gif,svg,webp}', route => route.abort());
}

/**
 * Marcação de checkbox apenas se necessário
 */
async function marcarSeNaoMarcado(page, selector) {
  if (!(await page.isChecked(selector))) {
    await page.check(selector);
  }
}

/**
 * Marca tempo de execução de cada etapa
 */
function tempo(label) {
  const ini = Date.now();
  return () => {
    const delta = ((Date.now() - ini) / 1000).toFixed(2);
    console.log(`[Tempo] ${label}: ${delta}s`);
  }
}

/**
 * Função principal híbrida com otimizações
 */
async function scrapTransportCards(username, password) {
  console.log(`[Scraper.js] 🔰 Iniciando automação otimizada para usuário: ${username}`);

  // Primeira tentativa com V1 (muitos cartões)
  try {
    return await scrapTransportCardsV1(username, password);
  } catch (err) {
    console.warn(`[Scraper.js] [Híbrido] Método V1 falhou (${err.message}), tentando V2...`);
    return await scrapTransportCardsV2(username, password);
  }
}

/**
 * Método para muitos cartões (V1) - Otimizado
 */
async function scrapTransportCardsV1(username, password) {
  const LOGIN_URL = "https://recargaonline.gvbus.org.br/frmLogin.aspx";
  const PEDIDO_URL = "https://recargaonline.gvbus.org.br/frmPedidoCargaIndividual.aspx?TituloMenu=Novo+pedido+de+carga&NumDias=0&InserePedido=s&FatorAnterior=0&ChaveGrupo=&ValorCarga=0&CodPedidoCopy=0&CodAnoCopy=";
  const TIMEOUT = 30000;

  const tAll = tempo("Execução V1");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await bloquearRecursos(page);

  try {
    // Login
    const tLogin = tempo("Login");
    await withRetry(() => page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT }), 2, 2000, "Acesso à página de login");
    tLogin();

    // LGPD
    const lgpdCheckbox = await page.$("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
    if (lgpdCheckbox) {
      await page.click("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
      await page.waitForSelector("#Toolbar_modalTermoAceiteLGPD", { state: "hidden", timeout: 7000 });
    }

    // Cookies
    const btnCookies = await page.$("#modalPoliticaCookies input.button");
    if (btnCookies) {
      await btnCookies.click();
      await page.waitForSelector("#modalPoliticaCookies", { state: "hidden", timeout: 7000 });
    }

    // Preenche credenciais
    await withRetry(() => page.waitForSelector("#txtEmailTitular", { timeout: TIMEOUT }), 2, 1000, "Campo usuário");
    await page.fill("#txtEmailTitular", username);
    await withRetry(() => page.waitForSelector("#txtSenha", { timeout: TIMEOUT }), 2, 1000, "Campo senha");
    await page.fill("#txtSenha", password);

    // Submete login
    await withRetry(() => Promise.all([
      page.click("#btnLogin"),
      page.waitForLoadState("networkidle", { timeout: TIMEOUT })
    ]), 2, 2000, "Submissão do login");

    // Verificar erro de login pelo seletor correto
    const loginError = await page.$("#ValidationSummary1.erro");
    if (loginError && await loginError.isVisible()) {
      const errorMessage = await loginError.innerText();
      throw new Error(`Falha no login: ${errorMessage.trim()}`);
    }

    // Navega para pedido de carga
    await withRetry(() => page.goto(PEDIDO_URL, { waitUntil: "networkidle", timeout: TIMEOUT }), 2, 2000, "Navegação Pedido de Carga");

    // Fecha mensagem de erro se existir
    const errorOkButton = await page.$("#imgOK");
    if (errorOkButton) {
      await errorOkButton.click();
      await page.waitForTimeout(700);
    }

    // Marcar "Exibir detalhes" só se necessário
    await withRetry(() => page.waitForSelector("label[for=\"chkGrid\"]", { timeout: 7000 }), 2, 1000, "Exibir detalhes");
    await marcarSeNaoMarcado(page, "#chkGrid");

    // Espera pela tabela (timeout reduzido)
    await withRetry(() => page.waitForSelector("table#gridPedidos tbody tr", { timeout: 12000 }), 2, 1000, "Tabela");

    // Extrai dados
    const tExtra = tempo("Extração dos dados");
    const rows = await page.$$("table#gridPedidos tbody tr.trNormal, table#gridPedidos tbody tr.trNormal_impar");
    if (rows.length === 0) throw new Error("Nenhuma linha encontrada na tabela (V1)");

    const dados = [];
    for (const [i, row] of rows.entries()) {
      try {
        const [cardNumber, employeeId, employeeName, balanceText] = await row.$$eval(
          "td",
          (tds) => tds.slice(0, 4).map((td) => td.innerText.trim())
        );
        if (!cardNumber || !employeeId || !employeeName) continue;

        let balance = 0;
        if (balanceText) {
          balance = parseFloat(balanceText.replace(/\./g, "").replace(",", "."));
          if (isNaN(balance)) balance = 0;
        }

        dados.push({ cardNumber, employeeId, employeeName, balance });
      } catch (_) { continue; }
    }
    tExtra();

    if (dados.length === 0) throw new Error("Nenhum dado extraído da tabela (V1)");
    return dados;
  } finally {
    await browser.close();
    tAll();
  }
}

/**
 * Método para poucos cartões (V2) - Otimizado
 */
async function scrapTransportCardsV2(username, password) {
  const LOGIN_URL = "https://recargaonline.gvbus.org.br/frmLogin.aspx";
  const PEDIDO_URL = "https://recargaonline.gvbus.org.br/frmPedidoCargaIndividual.aspx?TituloMenu=Novo+pedido+de+carga&NumDias=0&InserePedido=s&FatorAnterior=0&ChaveGrupo=&ValorCarga=0&CodPedidoCopy=0&CodAnoCopy=";
  const TIMEOUT = 30000;

  const tAll = tempo("Execução V2");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await bloquearRecursos(page);

  try {
    await withRetry(() => page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT }), 2, 2000, "Acesso à página de login");

    const lgpdCheckbox = await page.$("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
    if (lgpdCheckbox) {
      await page.click("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
      await page.waitForSelector("#Toolbar_modalTermoAceiteLGPD", { state: "hidden", timeout: 7000 });
    }
    const cookiesBtn = await page.$("#modalPoliticaCookies input.button");
    if (cookiesBtn) {
      await cookiesBtn.click();
      await page.waitForSelector("#modalPoliticaCookies", { state: "hidden", timeout: 7000 });
    }

    await withRetry(() => page.waitForSelector("#txtEmailTitular", { state: 'visible', timeout: TIMEOUT }), 2, 1000, "Campo usuário");
    await page.fill("#txtEmailTitular", username);
    await withRetry(() => page.waitForSelector("#txtSenha", { state: 'visible', timeout: TIMEOUT }), 2, 1000, "Campo senha");
    await page.fill("#txtSenha", password);

    await withRetry(() => Promise.all([
      page.click("#btnLogin"),
      page.waitForLoadState("networkidle", { timeout: TIMEOUT })
    ]), 2, 2000, "Submissão do login");

    // Verificar erro de login pelo seletor correto
    const loginError = await page.$("#ValidationSummary1.erro");
    if (loginError && await loginError.isVisible()) {
      const errorMessage = await loginError.innerText();
      throw new Error(`Falha no login: ${errorMessage.trim()}`);
    }

    await withRetry(() => page.goto(PEDIDO_URL, { waitUntil: "networkidle", timeout: TIMEOUT }), 2, 2000, "Navegação Pedido de Carga");

    await withRetry(() => page.waitForSelector("table#gridPedidos", { state: 'visible', timeout: TIMEOUT }), 2, 1000, "Tabela carregada");

    // Marcar "Exibir detalhes" só se necessário
    await marcarSeNaoMarcado(page, "#chkGrid");
    await page.waitForTimeout(700); // tempo curto só para atualização

    // Espera pela tabela
    await withRetry(() => page.waitForSelector("table#gridPedidos tbody tr", { state: 'visible', timeout: TIMEOUT }), 2, 1000, "Linhas da tabela");

    // Extrai dados
    const tExtra = tempo("Extração dos dados");
    const dados = await page.$$eval(
      "table#gridPedidos tbody tr",
      (rows) =>
        Array.from(rows)
          .filter(row => !row.classList.contains('trTitulo'))
          .map((row) => {
            try {
              const tds = Array.from(row.querySelectorAll("td"));
              if (tds.length < 4) return null;
              const [cardNumber, employeeId, employeeName, balanceText] = tds.slice(0, 4).map(td => td.textContent.trim());
              if (!cardNumber || !employeeId || !employeeName) return null;
              let balance = 0;
              if (balanceText) {
                balance = parseFloat(balanceText.replace(/\./g, "").replace(",", "."));
                if (isNaN(balance)) balance = 0;
              }
              return { cardNumber, employeeId, employeeName, balance };
            } catch (_) { return null; }
          })
          .filter(Boolean)
    );
    tExtra();

    if (dados.length === 0) throw new Error("Nenhum dado extraído da tabela (V2)");
    return dados;
  } finally {
    await browser.close();
    tAll();
  }
}

module.exports = { scrapTransportCards };
