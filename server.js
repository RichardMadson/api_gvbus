const express = require('express');
const { scrapTransportCards } = require('./scraper'); // Seu scraper.js

const app = express();
const port = process.env.PORT || 3000;

// Middleware para parsear JSON no corpo das requisições
app.use(express.json());

// Middleware simples para autenticação com X-API-Key
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const SERVER_API_KEY = process.env.SCRAPER_API_KEY;
  if (!SERVER_API_KEY) {
    console.error("[Server.js] ERRO CRÍTICO: SCRAPER_API_KEY não está definida no ambiente do servidor.");
    return res.status(500).json({ error: 'Erro de configuração interna do servidor.' });
  }
  if (apiKey && apiKey === SERVER_API_KEY) {
    next();
  } else {
    res.status(401).json({ error: 'Não autorizado. Chave de API inválida ou ausente.' });
  }
};

app.get('/', (req, res) => {
  res.send('API Scraper está no ar!');
});

/* ------------------- SISTEMA DE FILA ------------------- */
const jobQueue = [];
let busy = false;

async function processQueue() {
  if (busy || jobQueue.length === 0) return;
  busy = true;
  const { req, res } = jobQueue.shift();

  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    busy = false;
    setImmediate(processQueue);
    return;
  }

  try {
    console.log(`[Server.js] Recebida solicitação de scraping para usuário: ${username}`);
    const cardsData = await scrapTransportCards(username, password);
    console.log(`[Server.js] Scraping concluído para usuário: ${username}. Dados obtidos: ${cardsData.length} cartões.`);
    res.json({ success: true, data: cardsData });
  } catch (error) {
    console.error('[Server.js] Erro durante o scraping:', error);
    let errorMessage = 'Falha ao obter dados dos cartões.';
    if (error.message.includes('Falha no login')) {
        errorMessage = 'Falha no login na operadora. Verifique as credenciais.';
    }
    res.status(500).json({ success: false, error: errorMessage, details: error.message });
  } finally {
    busy = false;
    setImmediate(processQueue); // Chama o próximo da fila
  }
}

/* ------------ Alterado: POST agora usa fila ------------ */
app.post('/scrape', apiKeyAuth, (req, res) => {
  jobQueue.push({ req, res });
  processQueue();
  // O retorno da resposta é feito apenas dentro do processQueue!
});

/* --------- (Opcional) Endpoint para status da fila ----- */
app.get('/fila', (req, res) => {
  res.json({ jobsNaFila: jobQueue.length, ocupado: busy });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`API Scraper rodando em http://0.0.0.0:${port}`);
});
