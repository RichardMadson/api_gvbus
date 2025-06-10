const { chromium } = require('playwright');
const axios = require('axios');
const cheerio = require('cheerio');

async function loginEGetCookies(username, password) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://recargaonline.gvbus.org.br/frmLogin.aspx', { waitUntil: 'domcontentloaded' });

  // Aceita cookies se botão existir
  const aceitarBtn = await page.$('input[value="Fechar e Aceitar"]');
  if (aceitarBtn) {
    await aceitarBtn.click();
    await page.waitForTimeout(1000);
  }

  // Preenche login e senha
  await page.fill('input[name="txtEmailTitular"]', username);
  await page.fill('input[name="txtSenha"]', password);

  // Clica no login
  await Promise.all([
    page.click('input[name="btnLogin"]'),
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
  ]);

  // Captura cookies para usar no axios
  const cookies = await context.cookies();
  await browser.close();

  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

async function pegarPaginaInicial(cookieHeader) {
  const url = 'https://recargaonline.gvbus.org.br/frmPedidoCargaIndividual.aspx';
  const res = await axios.get(url, {
    headers: {
      Cookie: cookieHeader,
      'User-Agent': 'Mozilla/5.0',
      Accept: 'text/html',
    },
  });
  return res.data;
}

function extrairCamposHidden(html) {
  const $ = cheerio.load(html);
  return {
    __VIEWSTATE: $('#__VIEWSTATE').val() || '',
    __EVENTVALIDATION: $('#__EVENTVALIDATION').val() || '',
    __VIEWSTATEGENERATOR: $('#__VIEWSTATEGENERATOR').val() || '',
  };
}

function extrairDepartamentos(html) {
  const $ = cheerio.load(html);
  const departamentos = [];
  $('#DropDownDepartamento option').each((_, el) => {
    const value = $(el).attr('value');
    const label = $(el).text().trim();
    departamentos.push({ value, label });
  });
  return departamentos;
}

function extrairTodosCamposForm(html) {
  const $ = cheerio.load(html);
  const campos = {};
  $('form input').each((_, el) => {
    const name = $(el).attr('name');
    if (!name) return;
    let value = $(el).val() || '';
    campos[name] = value;
  });
  return campos;
}

async function postbackDepartamento(htmlAnterior, departamentoValue, cookieHeader) {
  const campos = extrairTodosCamposForm(htmlAnterior);

  // Atualiza os campos que indicam a mudança no dropdown
  campos['__EVENTTARGET'] = 'DropDownDepartamento';
  campos['__EVENTARGUMENT'] = '';
  campos['DropDownDepartamento'] = departamentoValue;

  const postData = new URLSearchParams();
  for (const [k, v] of Object.entries(campos)) {
    postData.append(k, v);
  }

  const url = 'https://recargaonline.gvbus.org.br/frmPedidoCargaIndividual.aspx';

  const res = await axios.post(url, postData.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader,
      'User-Agent': 'Mozilla/5.0',
    },
  });

  return res.data;
}


function extrairTabela(html) {
  const $ = cheerio.load(html);
  const linhas = [];

  $('#gridPedidos tbody tr').each((_, el) => {
    const tds = $(el).find('td');
    if (tds.length >= 4) {
      linhas.push({
        cardNumber: $(tds[0]).text().trim(),
        employeeId: $(tds[1]).text().trim(),
        employeeName: $(tds[2]).text().trim(),
        balance: parseFloat($(tds[3]).text().trim().replace(/\./g, '').replace(',', '.')) || 0,
      });
    }
  });

  return linhas;
}

async function main(username, password) {
  try {
    const inicio = Date.now(); // marca o início

    console.log('Fazendo login e obtendo cookies...');
    const cookieHeader = await loginEGetCookies(username, password);

    console.log('Buscando página inicial...');
    let html = await pegarPaginaInicial(cookieHeader);

    console.log('Extraindo departamentos...');
    const departamentos = extrairDepartamentos(html);
    console.log(`Encontrados ${departamentos.length} departamentos.`);

    const resultadoFinal = [];

    for (const dep of departamentos.filter(d => d.label.toLowerCase() !== 'todos')) {
      console.log(`Processando departamento ${dep.label} (value=${dep.value})...`);
      html = await postbackDepartamento(html, dep.value, cookieHeader);

      const cartoes = extrairTabela(html);
      console.log(`  Encontrados ${cartoes.length} cartões.`);

      cartoes.forEach(c => c.department = dep.label);
      resultadoFinal.push(...cartoes);
    }

    const fim = Date.now(); // marca o fim
    const duracaoSegundos = ((fim - inicio) / 1000).toFixed(2);
    console.log(`Total de cartões extraídos: ${resultadoFinal.length}`);
    console.log(`Tempo total da operação: ${duracaoSegundos} segundos`);

    return resultadoFinal;

  } catch (err) {
    console.error('Erro no fluxo:', err);
  }
}

module.exports = {
  scrapTransportCards: main
};

/* Usado para teste...
// Exemplo de uso:
(async () => {
  const usuario = '73686370020980';
  const senha = '16231848';

  const dados = await main(usuario, senha);
  //console.log('Resultado final:', dados);
})();
*/
