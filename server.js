'use strict';
// Lightweight WhatsApp customer bot. No Chromium, paid AI, or local installation required on the host.
const express = require('express');
const QRCode = require('qrcode');
const terminalQR = require('qrcode-terminal');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const knowledge = require('./knowledge.json');

const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '2kb' }));
const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ADMIN_WEB_DISABLED = process.env.ADMIN_WEB_DISABLED === 'true';
const BOT_PAIR_PHONE = String(process.env.BOT_PAIR_PHONE || '').trim();
const SESSION_DIR = process.env.SESSION_DIR || path.join(__dirname, '.baileys_auth');
if (ADMIN_TOKEN.length < 24) {
  console.error('Missing ADMIN_TOKEN: set a random secret of at least 24 characters in Render Environment.');
  process.exit(1);
}

let sock = null;
let connectionStatus = 'starting';
let currentQR = null;
let pairingCode = null;
let pendingPairingPhone = null;
let pairingPending = false;
let lastError = '';
let isRegistered = false;
let reconnectAttempts = 0;
let restartScheduled = false;
let shuttingDown = false;
let DisconnectReason = null;
let makeWASocket = null;
let useMultiFileAuthState = null;
const seenIds = new Map();
const lastReplyByChat = new Map();
const MAX_SEEN = 500;

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function normalize(text) {
  return String(text || '').toLowerCase().normalize('NFKC')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function getReply(message) {
  const value = ` ${normalize(message)} `;
  if (value.trim().length < 2 || value.length > 1200) return null;
  for (const item of knowledge.intents) {
    for (const phrase of item.phrases) {
      const needle = ` ${normalize(phrase)} `;
      if (needle.trim() && value.includes(needle)) return { intent: item.name, reply: item.reply };
    }
  }
  return null;
}
function extractText(content) {
  const m = content?.ephemeralMessage?.message || content?.viewOnceMessage?.message || content || {};
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '';
}
function requireAdmin(req, res, next) {
  if (ADMIN_WEB_DISABLED) return res.status(404).send('Web admin disabled. Use the private hosting console to view linking QR or pairing code.');
  const auth = req.get('authorization') || '';
  let supplied = '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      if (decoded.startsWith('admin:')) supplied = decoded.slice(6);
    } catch (_) {}
  }
  const wanted = crypto.createHash('sha256').update(ADMIN_TOKEN).digest();
  const actual = crypto.createHash('sha256').update(supplied).digest();
  if (!supplied || !crypto.timingSafeEqual(actual, wanted)) {
    res.set('WWW-Authenticate', 'Basic realm="WhatsApp Admin"');
    return res.status(401).send('Use username admin and your ADMIN_TOKEN as password.');
  }
  res.set({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
  next();
}

function sameOrigin(req, res, next) {
  const origin = req.get('origin');

  if (!origin) return next();

  try {
    const parsed = new URL(origin);

    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      parsed.host !== req.get('host')
    ) {
      return res.status(403).send('Invalid form origin.');
    }

    return next();
  } catch (error) {
    return res.status(403).send('Invalid form origin.');
  }
}


app.get('/', (_, res) => res.type('text').send('WhatsApp bot running. Visit /admin for linking.'));
app.get('/health', (_, res) => res.json({
  service: 'running', whatsapp: connectionStatus, memoryMiB: Math.round(process.memoryUsage().rss / 1048576)
}));
app.get('/admin', requireAdmin, async (_, res) => {
  const qrHtml = currentQR && !pendingPairingPhone
    ? `<img width="260" height="260" alt="WhatsApp linking QR code" src="${await QRCode.toDataURL(currentQR)}">`
    : '<p>No QR code available right now. Refresh the page or select QR linking.</p>';
  const codeHtml = pairingCode ? `<p><strong>Your pairing code:</strong> <code>${escapeHTML(pairingCode)}</code></p>
    <p>On WhatsApp: Linked devices → Link a device → Link with phone number instead.</p>` : '';
  res.type('html').send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer"><title>WhatsApp Bot Admin</title>
  <style>body{font:16px system-ui;max-width:660px;margin:2rem auto;padding:0 1rem;line-height:1.5}section{padding:1rem;border:1px solid #aaa;border-radius:12px;margin:1rem 0}input,button{font:inherit;padding:.65rem}input{max-width:90%}code{font-size:1.5em}small{color:#555}</style></head><body>
  <h1>WhatsApp Customer Bot</h1><p><strong>Status:</strong> ${escapeHTML(connectionStatus)}</p>
  ${lastError ? `<p>Last issue: ${escapeHTML(lastError)}</p>` : ''}
  <section><h2>Option 1: QR code</h2>${qrHtml}<form method="post" action="/admin/qr"><button>Use QR code</button></form></section>
  <section><h2>Option 2: Phone number</h2>
  <form method="post" action="/admin/pair"><label>WhatsApp number (country code, digits only)<br>
  <input name="phone" type="tel" inputmode="numeric" pattern="[0-9]{10,15}" maxlength="15" placeholder="2348012345678" required autocomplete="off"></label>
  <button>Generate pairing code</button></form>${codeHtml}</section>
  <section><h2>Test your replies</h2><form method="post" action="/admin/test"><label>Customer message<br>
  <input name="text" maxlength="500" placeholder="How much is registration?" required></label> <button>Test reply</button></form>
  <small>Tests the rules without sending a WhatsApp message.</small></section>
  <p><a href="/admin">Refresh status</a></p>
  <small>Free Render may sleep and forget a locally saved session. Do not share this page, pairing codes, or your ADMIN_TOKEN.</small>
  </body></html>`);
});
app.post('/admin/test', requireAdmin, sameOrigin, (req, res) => {
  const q = String(req.body.text || '').slice(0, 500);
  const found = getReply(q);
  res.type('html').send(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:18px system-ui;padding:1rem"><h2>Bot reply preview</h2><p>${escapeHTML(found?.reply || '(No matching rule. The bot will stay silent.)')}</p><a href="/admin">Back to admin</a></body></html>`);
});
app.post('/admin/pair', requireAdmin, sameOrigin, (req, res) => {
  const phone = String(req.body.phone || '').trim();
  if (!/^[1-9][0-9]{9,14}$/.test(phone)) return res.status(400).send('Use country code and digits only.');
  if (isRegistered || connectionStatus === 'connected') return res.redirect(303, '/admin');
  pendingPairingPhone = phone;
  pairingCode = null;
  lastError = '';
  connectionStatus = 'pairing_requested';
  if (currentQR) void requestPairing();
  res.redirect(303, '/admin');
});
app.post('/admin/qr', requireAdmin, sameOrigin, (_, res) => {
  pendingPairingPhone = null;
  pairingCode = null;
  res.redirect(303, '/admin');
});

async function requestPairing() {
  if (!sock || !pendingPairingPhone || pairingPending || isRegistered) return;
  pairingPending = true;
  try {
    pairingCode = await sock.requestPairingCode(pendingPairingPhone);
    if (BOT_PAIR_PHONE) console.log('PRIVATE WHATSAPP PAIRING CODE:', pairingCode);
    connectionStatus = 'pairing_code_ready';
    currentQR = null;
  } catch (e) {
    connectionStatus = 'pairing_failed';
    lastError = `Could not request a pairing code: ${String(e.message || e).slice(0, 150)}`;
  } finally { pairingPending = false; }
}

async function connect() {
  if (shuttingDown) return;
  connectionStatus = 'connecting';
  currentQR = null;
  pairingCode = null;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    isRegistered = !!state.creds.registered;
    if (BOT_PAIR_PHONE && !isRegistered && /^[1-9][0-9]{9,14}$/.test(BOT_PAIR_PHONE)) pendingPairingPhone = BOT_PAIR_PHONE;
    const current = makeWASocket({
      auth: state, logger: pino({ level: 'silent' }), markOnlineOnConnect: false,
      syncFullHistory: false, connectTimeoutMs: 60000, keepAliveIntervalMs: 25000
    });
    sock = current;
    current.ev.on('creds.update', () => { void saveCreds().catch(e => console.error('Failed saving credentials:', e.message)); });
    current.ev.on('connection.update', async update => {
      if (sock !== current) return;
      if (update.qr) {
        currentQR = update.qr;
        connectionStatus = 'scan_required';
        if (ADMIN_WEB_DISABLED && !pendingPairingPhone) terminalQR.generate(update.qr, { small: true });
        if (pendingPairingPhone && !isRegistered) void requestPairing();
      }
      if (update.connection === 'open') {
        isRegistered = true;
        reconnectAttempts = 0;
        currentQR = null;
        pairingCode = null;
        pendingPairingPhone = null;
        lastError = '';
        connectionStatus = 'connected';
        console.log('WhatsApp connection established');
      }
      if (update.connection === 'close') {
        const reason = update.lastDisconnect?.error?.output?.statusCode;
        connectionStatus = 'disconnected';
        currentQR = null;
        pairingCode = null;
        sock = null;
        if (reason === DisconnectReason.loggedOut) {
          connectionStatus = 'logged_out';
          lastError = 'WhatsApp logged out. Session credentials must be cleared before relinking.';
          console.error(lastError);
        } else scheduleReconnect();
      }
    });
    current.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || sock !== current || connectionStatus !== 'connected') return;
      for (const m of messages || []) {
        const jid = m.key?.remoteJid || '';
        if (!jid.endsWith('@s.whatsapp.net') || m.key?.fromMe || !m.message) continue;
        const id = m.key.id;
        if (!id || seenIds.has(id)) continue;
        seenIds.set(id, Date.now());
        if (seenIds.size > MAX_SEEN) seenIds.delete(seenIds.keys().next().value);
        const text = extractText(m.message);
        const answer = getReply(text);
        if (!answer) continue;
        // Prevent multiple keyword-triggered replies to the same chat within 20 seconds.
        const last = lastReplyByChat.get(jid) || 0;
        if (Date.now() - last < 20000) continue;
        lastReplyByChat.set(jid, Date.now());
        if (lastReplyByChat.size > 500) lastReplyByChat.clear();
        try { await current.sendMessage(jid, { text: answer.reply }); }
        catch (e) { console.error('Reply send failed:', String(e.message || e).slice(0, 160)); }
      }
    });
  } catch (e) {
    lastError = String(e.message || e).slice(0, 160);
    connectionStatus = 'error';
    console.error('WhatsApp failed to initialize:', lastError);
    scheduleReconnect();
  }
}
function scheduleReconnect() {
  if (shuttingDown || restartScheduled) return;
  restartScheduled = true;
  const delay = Math.min(30000, 2000 * (2 ** Math.min(reconnectAttempts++, 4)));
  setTimeout(() => { restartScheduled = false; void connect(); }, delay);
}
async function boot() {
  try {
    const library = await import('@whiskeysockets/baileys');
    makeWASocket = library.default;
    useMultiFileAuthState = library.useMultiFileAuthState;
    DisconnectReason = library.DisconnectReason;
    await connect();
  } catch (e) {
    connectionStatus = 'error'; lastError = String(e.message || e).slice(0, 170);
    console.error('Failed to load Baileys:', lastError);
  }
}
process.on('SIGTERM', () => { shuttingDown = true; process.exit(0); });
app.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP server listening on ${PORT}`);
  void boot();
});
