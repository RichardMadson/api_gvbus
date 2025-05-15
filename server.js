const express = require('express');
const { scrapTransportCards } = require('./scraper'); // Assumindo que scraper.js será adaptado e colocado aqui

const app = express();
const port = process.env.PORT || 3000;

// Middleware para parsear JSON no corpo das requisições
app.use(express.json());

// Middleware simples para autenticação com X-API-Key
const apiKeyAuth = (req, res, next) => {
const apiKey = req.headers['x-api-key'];
const SERVER_API_KEY = process.env.SCRAPER_API_KEY; // Ou a forma como você definiu acima
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

// Endpoint para o scraping
app.post('/scrape', apiKeyAuth, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  try {
    console.log(`[Server.js] Recebida solicitação de scraping para usuário: ${username}`);
    // A função scrapTransportCards será adaptada para aceitar username e password
    // e retornar os dados ou um erro.
    const cardsData = await scrapTransportCards(username, password);
    console.log(`[Server.js] Scraping concluído para usuário: ${username}. Dados obtidos: ${cardsData.length} cartões.`);
    res.json({ success: true, data: cardsData });
  } catch (error) {
    console.error('[Server.js] Erro durante o scraping:', error);
    // Personalize a mensagem de erro conforme necessário
    let errorMessage = 'Falha ao obter dados dos cartões.';
    if (error.message.includes('Falha no login')) { // Exemplo de tratamento de erro específico
        errorMessage = 'Falha no login na operadora. Verifique as credenciais.';
    }
    res.status(500).json({ success: false, error: errorMessage, details: error.message });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`API Scraper rodando em http://0.0.0.0:${port}`);
});

