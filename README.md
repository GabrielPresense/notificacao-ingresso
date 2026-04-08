# Automação de Notificações Ticketmaster -> WhatsApp

Projeto simples em JavaScript para monitorar uma página do Ticketmaster e enviar notificação para um grupo do WhatsApp via terminal.

## Arquivos importantes

- `.gitignore`: ignora `node_modules`, logs, dados de sessão do WhatsApp (`whatsapp_session/`, `.wwebjs_cache/`)
- `config.json`: configurações do projeto
- `package.json`: dependências Node.js
- `whatsapp_ticketmaster_notifier.js`: código principal

## Requisitos

- Node.js 18+ instalado
- Google Chrome instalado

## Instalação

1. Abra o terminal na pasta do projeto.
2. Instale dependências:

```bash
npm install
```

## Configuração

Edite `config.json` e coloque:

- `ticketmaster_url`: URL da página do Ticketmaster que você quer monitorar.
- `whatsapp_group_name`: nome exato do grupo no WhatsApp.
- `check_interval_seconds`: intervalo de verificação em segundos (recomendado 60).
- `keywords`: palavras que indicam disponibilidade.
- `block_keywords`: palavras que indicam que ainda não tem ingresso.
- `status_keywords`: palavras que o bot deve ouvir no grupo para responder com o status atual.

## Execução

```bash
npm start
```

Na primeira execução, o script vai gerar um QR Code no terminal. Escaneie com o WhatsApp do celular que está no grupo.

Nas execuções seguintes, a sessão será carregada automaticamente da pasta `whatsapp_session/` e não será necessário escanear o QR Code novamente.

## Observações

- O script usa Puppeteer em headless mode para scraping do Ticketmaster.
- Usa whatsapp-web.js para conectar ao WhatsApp via QR Code no terminal.
- O monitoramento verifica a cada `check_interval_seconds`.
- O script envia mensagem no WhatsApp somente quando a disponibilidade muda para "disponível".
- Se alguém mandar uma mensagem com palavras de status no grupo, o bot responde automaticamente com o status atual.
- Se precisar reconectar (ex: mudou de conta), delete a pasta `whatsapp_session/` e rode novamente.
