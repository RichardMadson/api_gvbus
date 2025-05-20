// scraper.js
const { chromium } = require("playwright-chromium");

async function scrapTransportCards(username, password) {
  const LOGIN_URL = "https://recargaonline.gvbus.org.br/frmLogin.aspx";
  const PEDIDO_URL =
    "https://recargaonline.gvbus.org.br/frmPedidoCargaIndividual.aspx?TituloMenu=Novo+pedido+de+carga&NumDias=0&InserePedido=s&FatorAnterior=0&ChaveGrupo=&ValorCarga=0&CodPedidoCopy=0&CodAnoCopy=";
  
  console.log(
    `[Scraper.js] 🔰 Iniciando automação de recarga para usuário: ${username}`
  );

  const browser = await chromium.launch({ headless: true });
  console.log("[Scraper.js] ✅ Browser lançado (headless)");

  const page = await browser.newPage();
  console.log("[Scraper.js] ✅ Nova aba aberta");

  try {
    // 1) Login
    console.log(`[Scraper.js] ➡️ 1) Navegando até ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("[Scraper.js] ✅ Página de login carregada");

    // 2) Aceita LGPD
    console.log("[Scraper.js] ➡️ 2) Verificando modal de LGPD");
    const lgpdCheckbox = await page.$(
      "#Toolbar_modalTermoAceiteLGPD input[type=checkbox]"
    );
    if (lgpdCheckbox) {
      console.log("[Scraper.js]    • Modal LGPD encontrado, aceitando...");
      await page.click("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
      await page.waitForSelector("#Toolbar_modalTermoAceiteLGPD", {
        state: "hidden",
        timeout: 30000,
      });
      console.log("[Scraper.js]    • LGPD aceita");
    } else {
      console.log("[Scraper.js]    • Modal LGPD não apareceu");
    }

    // 3) Cookies
    console.log("[Scraper.js] ➡️ 3) Fechando modal de cookies (se existir)");
    const btnCookies = await page.$("#modalPoliticaCookies input.button");
    if (btnCookies) {
      console.log("[Scraper.js]    • Modal cookies encontrado, fechando...");
      await btnCookies.click();
      await page.waitForSelector("#modalPoliticaCookies", {
        state: "hidden",
        timeout: 30000,
      });
      console.log("[Scraper.js]    • Modal cookies fechado");
    } else {
      console.log("[Scraper.js]    • Modal cookies não apareceu");
    }

    // 4) Preenche credenciais
    console.log("[Scraper.js] ➡️ 4) Preenchendo usuário e senha");
    await page.waitForSelector("#txtEmailTitular", { timeout: 60000 });
    await page.fill("#txtEmailTitular", username);
    console.log("[Scraper.js]     • Usuário preenchido");
    await page.waitForSelector("#txtSenha", { timeout: 60000 });
    await page.fill("#txtSenha", password);
    console.log("[Scraper.js]     • Senha preenchida");

    // 5) Submete login
    console.log("[Scraper.js] ➡️ 5) Submetendo login");
    await Promise.all([
      page.click("#btnLogin"),
      page.waitForLoadState("networkidle", { timeout: 60000 }),
    ]);
    console.log("[Scraper.js] ✅ Login submetido e página estabilizada");

    // 5.1) Verificar erro de login
    const loginError = await page.$("#lblErro");
    if (loginError) {
      const msg = (await loginError.innerText()).trim();
      console.error(`[Scraper.js] ❌ Falha no login: ${msg}`);
      throw new Error(`Falha no login na operadora: ${msg}`);
    }

    // 6) Abre a página direta de Pedido de Carga
    console.log(`[Scraper.js] ➡️ 6) Navegando até Pedido de Carga: ${PEDIDO_URL}`);
    await page.goto(PEDIDO_URL, { waitUntil: "networkidle", timeout: 60000 });
    console.log("[Scraper.js] ✅ Página de Pedido de Carga carregada");

    // 7) Marcar “Exibir detalhes”
    console.log("[Scraper.js] ➡️ 7) Clicando em “Exibir detalhes”");
    await page.waitForSelector('label[for="chkGrid"]', { timeout: 30000 });
    await page.click('label[for="chkGrid"]');
    await page.waitForTimeout(500);
    console.log("[Scraper.js] ✅ “Exibir detalhes” marcado");

    // 8) Esperar pela tabela
    console.log("[Scraper.js] ➡️ 8) Aguardando tabela de funcionários");
    await page.waitForSelector("table#gridPedidos tbody tr", { timeout: 60000 });
    console.log("[Scraper.js] ✅ Tabela carregada");

    // 8.1) Log de quantas linhas encontrou
    const totalRows = await page.$$eval(
      "table#gridPedidos tbody tr",
      (trs) => trs.length
    );
    console.log(`[Scraper.js] ⚙️ Encontradas ${totalRows} linhas no tbody`);

    // 9) Extrair dados
    console.log("[Scraper.js] ➡️ 9) Extraindo dados das linhas");
    const dados = await page.$$eval(
      "table#gridPedidos tbody tr",
      (rows) =>
        Array.from(rows)
          .map((row) => {
            const tds = Array.from(row.querySelectorAll("td"));
            if (tds.length < 4) return null;
            const [cardNumber, employeeId, employeeName, balanceText] = tds
              .slice(0, 4)
              .map((td) => td.innerText.trim());
            const balance = parseFloat(
              balanceText.replace(/\./g, "").replace(",", ".")
            );
            return { cardNumber, employeeId, employeeName, balance };
          })
          .filter((item) => item !== null)
    );

    console.log("[Scraper.js] ✅ Dados extraídos:", JSON.stringify(dados, null, 2));
    return dados;
  } catch (err) {
    console.error("[Scraper.js] ❌ Erro durante a automação:", err);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
      console.log("[Scraper.js] 🔒 Browser fechado");
    }
  }
}

// Executa automaticamente se rodar `node scraper.js`
if (require.main === module) {
  // substitua pelos valores de teste
  const TEST_USER = "30097554004107";
  const TEST_PASS = "2007627";

  scrapTransportCards(TEST_USER, TEST_PASS)
    .then((data) => {
      console.log("Scrape concluído, registros:", data.length);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Erro no scraper:", err);
      process.exit(1);
    });
}

module.exports = { scrapTransportCards };
