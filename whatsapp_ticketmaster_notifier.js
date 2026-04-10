import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import * as cheerio from "cheerio";
import whatsappWeb from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
const { Client, LocalAuth } = whatsappWeb;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, "config.json");
const LAST_SENT_PATH = path.join(__dirname, "last_sent.txt");

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function saveLastSent(status) {
  fs.writeFileSync(LAST_SENT_PATH, status, "utf-8");
}

function loadLastSent() {
  if (!fs.existsSync(LAST_SENT_PATH)) {
    return "";
  }
  return fs.readFileSync(LAST_SENT_PATH, "utf-8").trim();
}

async function initBrowser() {
  return puppeteer.launch({
    headless: true, // headless para scraping
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

async function fetchPage(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise(resolve => setTimeout(resolve, 3000));
    return await page.content();
  } catch (e) {
    console.error(`Erro ao carregar página: ${e.message}`);
    return "";
  }
}

function parseTicketmaster(html, config) {
  const $ = cheerio.load(html);
  const text = $.text().replace(/\s+/g, " ").trim().toLowerCase();
  const hasKeyword = config.keywords.some((keyword) => text.includes(keyword.toLowerCase()));
  const hasBlock = config.block_keywords.some((block) => text.includes(block.toLowerCase()));
  if (hasBlock) {
    return {
      available: false,
      state: "sold_out",
      snippet: extractSnippet(text, config.block_keywords),
    };
  }
  if (hasKeyword) {
    return {
      available: true,
      state: "on_sale",
      snippet: extractSnippet(text, config.keywords),
    };
  }
  return { available: false, state: "unknown", snippet: extractSnippet(text, config.keywords) };
}

function extractSnippet(text, keywords, maxLen = 400) {
  let idx = -1;
  for (const keyword of keywords) {
    idx = text.indexOf(keyword.toLowerCase());
    if (idx >= 0) {
      break;
    }
  }
  if (idx < 0) {
    return text.slice(0, maxLen).trim();
  }
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + 220);
  return text.slice(start, end).trim();
}

function buildStatusMessage(config, available, snippet) {
  const status = available ? "Ingressos podem estar disponíveis." : "Sem disponibilidade no momento.";
  return config.status_message_template
    .replace("{url}", config.ticketmaster_url)
    .replace("{status}", status)
    .replace("{time}", new Date().toLocaleString())
    .replace("{snippet}", snippet || "");
}

function getHumanStatus(state) {
  if (state === "on_sale") {
    return "🟢 Em venda";
  }
  if (state === "sold_out") {
    return "🔴 Esgotado";
  }
  return "🟡 Indeterminado";
}

function getInterval(config) {
  if (config.check_interval_seconds) {
    return config.check_interval_seconds * 1000;
  }
  return (config.check_interval_minutes || 5) * 60 * 1000;
}

/** Conversa 1:1 clássica (evita msg.getChat(), que quebra em Canais com whatsapp-web.js). */
function isPrivateDirectChat(msg) {
  const id = msg.fromMe ? msg.to : msg.from;
  return typeof id === "string" && id.endsWith("@c.us");
}

async function main() {
  const config = loadConfig();
  let lastSent = loadLastSent();
  const browser = await initBrowser();
  const page = await browser.newPage();

  // Inicializar WhatsApp client
  const client = new Client({
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    authStrategy: new LocalAuth({
      clientId: "whatsapp-ticketmaster-bot",
      dataPath: path.join(__dirname, "whatsapp_session"),
    }),
  });

  client.on("qr", (qr) => {
    console.log("Escaneie o QR Code abaixo no WhatsApp:");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => {
    console.log("WhatsApp conectado! Iniciando monitoramento...");
  });

  client.on("message", async (msg) => {
    try {
      if (!isPrivateDirectChat(msg)) {
        return;
      }
      const lower = (msg.body || "").toLowerCase();
      if (config.status_keywords.some((keyword) => lower.includes(keyword.toLowerCase()))) {
        console.log("Solicitacao de status detectada no privado. Respondendo...");
        const html = await fetchPage(page, config.ticketmaster_url);
        const { available, state, snippet } = parseTicketmaster(html, config);
        const reply = buildStatusMessage(
          config,
          available,
          `${getHumanStatus(state)}\n${snippet || ""}`.trim()
        );
        await msg.reply(reply);
      }
    } catch (err) {
      console.error("Erro ao processar mensagem do WhatsApp:", err.message || err);
    }
  });

  await client.initialize();

  // Aguardar conexão
  await new Promise((resolve) => {
    client.once("ready", resolve);
  });

  console.log(`Monitoramento iniciado. Resposta de status apenas no privado. Intervalo: ${config.check_interval_seconds} segundos.`);


  while (true) {
    console.log(`[${new Date().toISOString()}] Verificando Ticketmaster...`);
    const html = await fetchPage(page, config.ticketmaster_url);
    const { state } = parseTicketmaster(html, config);
    const status = state;

    if (status !== lastSent) {
      console.log(`Mudança detectada (${getHumanStatus(state)}). Sem envio automatico para grupo.`);
      saveLastSent(status);
      lastSent = status;
    } else {
      console.log(`Sem mudança de estado: ${getHumanStatus(state)}.`);
    }

    const interval = getInterval(config);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

main().catch(console.error);

