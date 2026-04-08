import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import * as cheerio from "cheerio";
import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";

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
  if (hasKeyword && !hasBlock) {
    return { available: true, snippet: extractSnippet(text, config.keywords) };
  }
  return { available: false };
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

function buildMessage(config, snippet) {
  return config.message_template
    .replace("{url}", config.ticketmaster_url)
    .replace("{snippet}", snippet)
    .replace("{time}", new Date().toLocaleString());
}

function buildStatusMessage(config, available, snippet) {
  const status = available ? "Ingressos podem estar disponíveis." : "Sem disponibilidade no momento.";
  return config.status_message_template
    .replace("{url}", config.ticketmaster_url)
    .replace("{status}", status)
    .replace("{time}", new Date().toLocaleString())
    .replace("{snippet}", snippet || "");
}

function getInterval(config) {
  if (config.check_interval_seconds) {
    return config.check_interval_seconds * 1000;
  }
  return (config.check_interval_minutes || 5) * 60 * 1000;
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
    const chat = await msg.getChat();
    if (chat.isGroup && chat.name === config.whatsapp_group_name) {
      const lower = msg.body.toLowerCase();
      if (config.status_keywords.some((keyword) => lower.includes(keyword.toLowerCase()))) {
        console.log("Pergunta de status detectada. Respondendo...");
        const html = await fetchPage(page, config.ticketmaster_url);
        const { available, snippet } = parseTicketmaster(html, config);
        const reply = buildStatusMessage(config, available, snippet);
        await msg.reply(reply);
      }
    }
  });

  await client.initialize();

  // Aguardar conexão
  await new Promise((resolve) => {
    client.once("ready", resolve);
  });

  // Encontrar o grupo
  const chats = await client.getChats();
  const group = chats.find(chat => chat.isGroup && chat.name === config.whatsapp_group_name);
  if (!group) {
    console.error(`Grupo "${config.whatsapp_group_name}" não encontrado. Verifique o nome.`);
    console.log("Grupos disponíveis:");
    chats.filter(chat => chat.isGroup).forEach(chat => console.log(`- ${chat.name}`));
    await browser.close();
    return;
  }

  console.log(`Grupo encontrado: "${group.name}". Iniciando monitoramento a cada ${config.check_interval_seconds} segundos...`);


  while (true) {
    console.log(`[${new Date().toISOString()}] Verificando Ticketmaster...`);
    const html = await fetchPage(page, config.ticketmaster_url);
    const { available, snippet } = parseTicketmaster(html, config);
    const status = available ? "available" : "not_available";

    if (available && status !== lastSent) {
      const message = buildMessage(config, snippet);
      console.log("Disponibilidade encontrada! Enviando mensagem no WhatsApp...");
      await group.sendMessage(message);
      saveLastSent(status);
      lastSent = status;
    } else {
      console.log(available ? "Ainda disponível, sem nova mensagem." : "Sem disponibilidade no momento.");
      if (status !== lastSent) {
        saveLastSent(status);
        lastSent = status;
      }
    }

    const interval = getInterval(config);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

main().catch(console.error);

