const { chromium } = require("playwright-chromium");

async function withRetry(fn, retries = 3, delay = 2000, step = "desconhecida") {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      if (i > 0) console.log(`[Retry] Tentativa ${i + 1} de ${retries} para etapa: ${step}`);
      return await fn();
    } catch (err) {
      lastErr = err;
      console.error(`[Erro] [${step}] (${i+1}/${retries}): ${err.stack || err}`);
      if (i < retries - 1) await new Promise(res => setTimeout(res, delay));
    }
  }
  console.error(`[FALHA DEFINITIVA] [${step}] após ${retries} tentativas. Último erro:`, lastErr);
  throw new Error(`Falha após ${retries} tentativas na etapa: ${step}. Erro: ${lastErr ? lastErr.stack : 'erro desconhecido'}`);
}

async function bloquearRecursos(page) {
  const allowJs = [
    'script.js',
    'mascara.js',
    'jsPedidoCargaPedCargaBordo.js',
    'jquery-2.1.1.js',
    'WebResource.axd',
    'ScriptResource.axd'
  ];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    const tipo = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(tipo) || url.match(/\.(png|jpg|jpeg|gif|svg|webp|css|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ico)$/i)) {
      return route.abort();
    }
    if (url.endsWith('.js') || url.includes('WebResource.axd') || url.includes('ScriptResource.axd')) {
      for (const jsName of allowJs) {
        if (url.includes(jsName)) {
          return route.continue();
        }
      }
      return route.abort();
    }
    if (!url.startsWith('https://recargaonline.gvbus.org.br/')) {
      return route.abort();
    }
    return route.continue();
  });
}

async function marcarSeNaoMarcado(page, selector) {
  const checked = await page.isChecked(selector);
  console.log(`[Marcar] ${selector}: está${checked ? "" : " NÃO"} marcado`);
  if (!checked) {
    await page.check(selector);
    console.log(`[Marcar] ${selector} marcado`);
  }
}

function tempo(label) {
  const ini = Date.now();
  return () => {
    const delta = ((Date.now() - ini) / 1000).toFixed(2);
    console.log(`[Tempo] ${label}: ${delta}s`);
  }
}

function filtrarDepartamentos(departamentos) {
  const filtrados = departamentos.filter(dep => {
    const label = (dep.label || "").toLowerCase();
    return (
      dep.value !== "-1" &&
      dep.value !== "0" &&
      label !== "todos" &&
      label !== "sem departamento"
    );
  });
  console.log(`[Departamentos] Filtrados (${filtrados.length}):`, filtrados.map(d => d.label));
  return filtrados;
}

// NOVA FUNÇÃO: Encontrar opção "Todos" no dropdown
function encontrarOpcaoTodos(departamentos) {
  const todos = departamentos.find(dep => {
    const label = (dep.label || "").toLowerCase();
    return label === "todos" || dep.value === "0" || dep.value === "-1";
  });
  console.log(`[Todos] Opção encontrada:`, todos);
  return todos;
}

// NOVA FUNÇÃO: Comparar cartões e remover duplicatas
function compararERemoverDuplicatas(cartoesDepartamentos, cartoesTodos) {
  console.log(`[Comparação] Cartões dos departamentos: ${cartoesDepartamentos.length}`);
  console.log(`[Comparação] Cartões de "Todos": ${cartoesTodos.length}`);

  // Criar Set com números dos cartões dos departamentos para busca rápida
  const cartoesDepSet = new Set(cartoesDepartamentos.map(c => c.cardNumber));

  // Filtrar cartões de "Todos" que NÃO estão nos departamentos
  const cartoesExtras = cartoesTodos.filter(cartao => !cartoesDepSet.has(cartao.cardNumber));

  console.log(`[Comparação] Cartões extras encontrados em "Todos": ${cartoesExtras.length}`);
  if (cartoesExtras.length > 0) {
    console.log(`[Comparação] Cartões extras:`, cartoesExtras.map(c => `${c.cardNumber} - ${c.employeeName}`));
  }

  // Combinar todos os cartões
  const todosCartoes = [...cartoesDepartamentos, ...cartoesExtras];
  console.log(`[Comparação] Total final de cartões: ${todosCartoes.length}`);

  return todosCartoes;
}

async function aguardarAtualizacaoTabela(page, ultimoPrimeiroCartao) {
  console.log("[Aguardar] Esperando atualização da tabela...");
  try {
    await page.waitForFunction(
      (ultimoPrimeiroCartao) => {
        const rows = document.querySelectorAll("table#gridPedidos tbody tr.trNormal, table#gridPedidos tbody tr.trNormal_impar");
        if (!rows.length) return false;
        const firstCardCell = rows[0].querySelector("td");
        if (!firstCardCell) return false;
        const newCard = firstCardCell.innerText.trim();
        return newCard && newCard !== ultimoPrimeiroCartao;
      },
      { timeout: 12000 },
      ultimoPrimeiroCartao || ""
    );
    console.log("[Aguardar] Tabela atualizada!");
  } catch (e) {
    console.error("[Aguardar] Timeout ao esperar atualização da tabela!");
    throw e;
  }
}

async function extrairCartoesDaTabela(page, departamento) {
  await page.waitForSelector('table#gridPedidos', { visible: true });
  try {
    await withRetry(() => page.waitForSelector("table#gridPedidos tbody tr", { timeout: 12000 }), 2, 1000, `Tabela de cartões do departamento "${departamento}"`);
    const rows = await page.$$("table#gridPedidos tbody tr.trNormal, table#gridPedidos tbody tr.trNormal_impar");
    const dados = [];
    let count = 0;
    for (const row of rows) {
      try {
        const [cardNumber, employeeId, employeeName, balanceText] = await row.$$eval(
          "td",
          tds => tds.slice(0, 4).map(td => td.innerText.trim())
        );
        if (!cardNumber || !employeeId || !employeeName) {
          console.log(`[Log] Linha ignorada por faltar dados no departamento "${departamento}":`, { cardNumber, employeeId, employeeName });
          continue;
        }
        let balance = 0;
        if (balanceText) {
          balance = parseFloat(balanceText.replace(/\./g, "").replace(",", "."));
          if (isNaN(balance)) balance = 0;
        }
        dados.push({ cardNumber, employeeId, employeeName, balance, department: departamento });
        count++;
        console.log(`[Log] Cartão extraído (${count}/${rows.length}) do departamento "${departamento}":`, { cardNumber, employeeId, employeeName, balance });
      } catch (rowError) {
        console.error(`[Erro] Falha ao extrair dados da linha (${count+1}/${rows.length}) no departamento "${departamento}":`, rowError.message);
        continue;
      }
    }
    if (dados.length === 0) {
      console.warn(`[Aviso] Nenhum cartão extraído no departamento "${departamento}"`);
    }
    return dados;
  } catch (e) {
    console.error(`[Erro] Falha ao extrair cartões do departamento "${departamento}":`, e.message);
    return [];
  }
}

async function processarDepartamento(page, dep, detalhesExibidosRef) {
  try {
    // Pega o innerHTML atual da tabela antes de trocar
    let tabelaAnterior = "";
    try {
      tabelaAnterior = await page.$eval('#gridPedidos', el => el.innerHTML);
    } catch {
      tabelaAnterior = null;
      console.warn('[Processar] Não conseguiu pegar innerHTML da tabela antes do reload.');
    }

    // Seleciona o departamento desejado
    console.log(`[Processar] Selecionando departamento "${dep.label}" (${dep.value})...`);
    await page.selectOption('#DropDownDepartamento', dep.value);

    // Aguarda o innerHTML da tabela mudar
    let mudouTabela = false;
    let tentativas = 0;
    while (!mudouTabela && tentativas < 12) {
      await page.waitForTimeout(850);
      let tabelaAtual = "";
      try {
        tabelaAtual = await page.$eval('#gridPedidos', el => el.innerHTML);
      } catch {
        tabelaAtual = null;
      }
      if (tabelaAnterior === null || tabelaAtual === null) {
        mudouTabela = true;
      } else if (tabelaAtual !== tabelaAnterior) {
        mudouTabela = true;
      }
      tentativas++;
    }
    if (!mudouTabela) {
      console.warn(`[Processar] AVISO: innerHTML da tabela não mudou após trocar o departamento!`);
    } else {
      console.log(`[Processar] Tabela atualizada detectada após seleção!`);
    }

    // Confirma o departamento selecionado
    const selectedValue = await page.$eval('#DropDownDepartamento', el => el.value);
    const selectedLabel = await page.$eval(
      `#DropDownDepartamento option[value="${dep.value}"]`,
      opt => opt.textContent.trim()
    );
    if (selectedValue === dep.value) {
      console.log(`[Processar] Departamento selecionado confirmado (${dep.value} / ${selectedLabel})`);
    } else {
      console.warn(`[Processar] ERRO: Valor selecionado "${selectedValue}" não bate com "${dep.value}"`);
      throw new Error(`Departamento selecionado diferente do esperado!`);
    }
    if (selectedLabel !== dep.label) {
      console.warn(`[Processar] AVISO: Label "${selectedLabel}" difere do esperado "${dep.label}"`);
    }

    // Garante exibição dos detalhes
    if (!detalhesExibidosRef.value) {
      await withRetry(() => page.waitForSelector('label[for="chkGrid"]', { timeout: 7000 }), 2, 1000, "Exibir detalhes");
      await marcarSeNaoMarcado(page, "#chkGrid");
      detalhesExibidosRef.value = true;
      await page.waitForTimeout(850);
    }

    // Extração segura dos cartões
    let tentativasExtracao = 0;
    let cartoes = [];
    while (tentativas < 3) {
      cartoes = await extrairCartoesDaTabela(page, dep.label);
      const dropdownValue = await page.$eval('#DropDownDepartamento', el => el.value);
      if (dropdownValue === dep.value && cartoes.length > 0) {
        let cartoesOk = true;
        for (const c of cartoes) {
          if (c.department !== dep.label) {
            cartoesOk = false;
            console.warn(`[Processar] Cartão extraído de outro departamento: ${JSON.stringify(c)}`);
            break;
          }
        }
        if (cartoesOk) break;
      }
      tentativas++;
      console.log(`[Processar] Tentativa extra #${tentativas} de confirmação dos cartões...`);
      await page.waitForTimeout(850);
    }

    if (cartoes.length === 0) {
      console.warn(`[Processar] Nenhum cartão extraído do departamento "${dep.label}" após ${tentativas} tentativas`);
    }
    return cartoes;
  } catch (err) {
    console.error(`[Processar] ERRO inesperado ao processar departamento "${dep.label}":`, err);
    throw err;
  }
}

// NOVA FUNÇÃO: Extrair cartões de "Todos"
async function extrairCartoesTodos(page, opcaoTodos) {
  console.log(`[Todos] Iniciando extração de cartões de "Todos"...`);

  try {
    // Seleciona a opção "Todos"
    console.log(`[Todos] Selecionando opção "Todos" (${opcaoTodos.value})...`);
    await page.selectOption('#DropDownDepartamento', opcaoTodos.value);

    // Aguarda a tabela atualizar
    await page.waitForTimeout(1500);

    // Garante que os detalhes estão exibidos
    await withRetry(() => page.waitForSelector('label[for="chkGrid"]', { timeout: 7000 }), 2, 1000, "Exibir detalhes para Todos");
    await marcarSeNaoMarcado(page, "#chkGrid");
    await page.waitForTimeout(850);

    // Extrai os cartões
    const cartoes = await extrairCartoesDaTabela(page, "Todos");
    console.log(`[Todos] Cartões extraídos de "Todos": ${cartoes.length}`);

    return cartoes;
  } catch (err) {
    console.error(`[Todos] Erro ao extrair cartões de "Todos":`, err);
    return [];
  }
}

async function scrapTransportCards(username, password) {
  console.log(`[Scraper.js] 🔰 Iniciando automação otimizada para usuário: ${username}`);
  return await scrapTransportCardsV1(username, password);
}

async function scrapTransportCardsV1(username, password) {
  const LOGIN_URL = "https://recargaonline.gvbus.org.br/frmLogin.aspx";
  const PEDIDO_URL = "https://recargaonline.gvbus.org.br/frmPedidoCargaIndividual.aspx?TituloMenu=Novo+pedido+de+carga&NumDias=0&InserePedido=s&FatorAnterior=0&ChaveGrupo=&ValorCarga=0&CodPedidoCopy=0&CodAnoCopy=";
  const TIMEOUT = 30000;
  const MAX_PARALLEL = 2;

  const tAll = tempo("Execução V1");
  let browser, mainPage;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--mute-audio'
      ]
    });

    mainPage = await browser.newPage();
    await bloquearRecursos(mainPage);

    console.log(`[Login] Abrindo página de login...`);
    await withRetry(() => mainPage.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT }), 2, 2000, "Acesso à página de login");

    // LGPD
    const lgpdCheckbox = await mainPage.$("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
    if (lgpdCheckbox) {
      await mainPage.click("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
      await mainPage.waitForSelector("#Toolbar_modalTermoAceiteLGPD", { state: "hidden", timeout: 7000 });
      console.log("[Login] LGPD aceito.");
    }

    // Cookies
    const btnCookies = await mainPage.$("#modalPoliticaCookies input.button");
    if (btnCookies) {
      await btnCookies.click();
      await mainPage.waitForSelector("#modalPoliticaCookies", { state: "hidden", timeout: 7000 });
      console.log("[Login] Cookies aceitos.");
    }

    // Preenche login
    await withRetry(() => mainPage.waitForSelector("#txtEmailTitular", { timeout: TIMEOUT }), 2, 1000, "Campo usuário");
    await mainPage.fill("#txtEmailTitular", username);
    await withRetry(() => mainPage.waitForSelector("#txtSenha", { timeout: TIMEOUT }), 2, 1000, "Campo senha");
    await mainPage.fill("#txtSenha", password);
    console.log("[Login] Credenciais preenchidas.");

    // Submete login
    await withRetry(() => Promise.all([
      mainPage.click("#btnLogin"),
      mainPage.waitForLoadState("networkidle", { timeout: TIMEOUT })
    ]), 2, 2000, "Submissão do login");

    // Verificar erro de login
    const loginError = await mainPage.$("#ValidationSummary1.erro");
    if (loginError && await loginError.isVisible()) {
      const errorMessage = await loginError.innerText();
      console.error(`[Login] Falha no login: ${errorMessage.trim()}`);
      throw new Error(`Falha no login: ${errorMessage.trim()}`);
    }
    console.log("[Login] Login realizado com sucesso.");

    // Navega para pedido de carga
    console.log("[Navegação] Indo para tela de pedidos...");
    await withRetry(() => mainPage.goto(PEDIDO_URL, { waitUntil: "networkidle", timeout: TIMEOUT }), 2, 2000, "Navegação Pedido de Carga");

    // Fecha mensagem de erro se existir
    const errorOkButton = await mainPage.$("#imgOK");
    if (errorOkButton) {
      await errorOkButton.click();
      await mainPage.waitForTimeout(700);
      console.log("[Navegação] Fechou alerta inicial.");
    }

    await mainPage.waitForSelector('#DropDownDepartamento', { timeout: 8000 });
    const departamentos = await mainPage.$$eval('#DropDownDepartamento option', opts =>
      opts.map(opt => ({
        value: opt.value,
        label: opt.textContent.trim()
      }))
    );
    console.log(`[Departamentos] Encontrados: ${departamentos.length}`);

    const departamentosValidos = filtrarDepartamentos(departamentos);
    const opcaoTodos = encontrarOpcaoTodos(departamentos);

    let cartoesDepartamentos = [];
    let cartoesTodos = [];
    let todosCartoes = [];

    // NOVA LÓGICA: Sempre extrair de departamentos E de "Todos" para comparar
    if (departamentosValidos.length > 0) {
      console.log(`[Estratégia] Extraindo de ${departamentosValidos.length} departamentos + "Todos" para comparação`);

      // 1. EXTRAIR DOS DEPARTAMENTOS (usando paralelismo se necessário)
      if (departamentosValidos.length > 1) {
        console.log(`[Departamentos] Usando paralelismo de até ${MAX_PARALLEL} abas`);
        const chunks = [];
        for (let i = 0; i < departamentosValidos.length; i += MAX_PARALLEL) {
          chunks.push(departamentosValidos.slice(i, i + MAX_PARALLEL));
        }
        for (const chunk of chunks) {
          const pages = await Promise.all(chunk.map(async () => {
            const page = await browser.newPage();
            await bloquearRecursos(page);
            return page;
          }));

          await Promise.all(pages.map(async (page, idx) => {
            try {
              await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
              const lgpdCheckbox = await page.$("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
              if (lgpdCheckbox) {
                await page.click("#Toolbar_modalTermoAceiteLGPD input[type=checkbox]");
                await page.waitForSelector("#Toolbar_modalTermoAceiteLGPD", { state: "hidden", timeout: 7000 });
              }
              const btnCookies = await page.$("#modalPoliticaCookies input.button");
              if (btnCookies) {
                await btnCookies.click();
                await page.waitForSelector("#modalPoliticaCookies", { state: "hidden", timeout: 7000 });
              }
              await page.waitForSelector("#txtEmailTitular", { timeout: TIMEOUT });
              await page.fill("#txtEmailTitular", username);
              await page.waitForSelector("#txtSenha", { timeout: TIMEOUT });
              await page.fill("#txtSenha", password);
              await Promise.all([
                page.click("#btnLogin"),
                page.waitForLoadState("networkidle", { timeout: TIMEOUT })
              ]);
              await page.goto(PEDIDO_URL, { waitUntil: "networkidle", timeout: TIMEOUT });
              console.log(`[Parallel Login] Página do departamento ${chunk[idx].label} pronta`);
            } catch (e) {
              console.error(`[Parallel Login] Erro no login paralelo para departamento ${chunk[idx].label}:`, e.stack);
              throw e;
            }
          }));

          const resultadosChunk = await Promise.all(chunk.map(async (dep, idx) => {
            const page = pages[idx];
            let detalhesExibidosRef = { value: false };
            const dados = await processarDepartamento(page, dep, detalhesExibidosRef);
            await page.close();
            return dados;
          }));

          cartoesDepartamentos = cartoesDepartamentos.concat(...resultadosChunk);
        }
      } else {
        // Apenas 1 departamento, usar mainPage
        let detalhesExibidosRef = { value: false };
        cartoesDepartamentos = await processarDepartamento(mainPage, departamentosValidos[0], detalhesExibidosRef);
      }

      // 2. EXTRAIR DE "TODOS" (sempre fazer isso quando há departamentos)
      if (opcaoTodos) {
        console.log(`[Estratégia] Extraindo cartões de "Todos" para comparação...`);
        cartoesTodos = await extrairCartoesTodos(mainPage, opcaoTodos);
      }

      // 3. COMPARAR E COMBINAR
      todosCartoes = compararERemoverDuplicatas(cartoesDepartamentos, cartoesTodos);

    } else {
      // Sem departamentos personalizados, extrair apenas de "Todos"
      console.log(`[Estratégia] Sem departamentos personalizados, extraindo apenas de "Todos"`);
      await withRetry(() => mainPage.waitForSelector("label[for=\"chkGrid\"]", { timeout: 7000 }), 2, 1000, "Exibir detalhes");
      await marcarSeNaoMarcado(mainPage, "#chkGrid");
      await aguardarAtualizacaoTabela(mainPage, await mainPage.$$eval('table#gridPedidos tbody tr', trs => trs.length));
      todosCartoes = await extrairCartoesDaTabela(mainPage, "Todos");
    }

    if (todosCartoes.length === 0) {
      console.warn("[Final] Nenhum cartão foi extraído!");
      throw new Error("Nenhum dado extraído da tabela (V1)");
    }

    console.log(`[Final] Total de cartões extraídos: ${todosCartoes.length}`);
    console.log(`[Final] Resumo: ${cartoesDepartamentos.length} dos departamentos + ${cartoesTodos.length - (cartoesTodos.length - (todosCartoes.length - cartoesDepartamentos.length))} extras de "Todos"`);

    return todosCartoes;
  } catch (mainErr) {
    console.error("[ERRO FATAL NO SCRAPER]:", mainErr.stack || mainErr);
    throw mainErr;
  } finally {
    if (mainPage) {
      await mainPage.close();
      console.log("[Finalização] Página principal fechada.");
    }
    if (browser) {
      await browser.close();
      console.log("[Finalização] Browser fechado.");
    }
    tAll();
  }
}

module.exports = { scrapTransportCards };
