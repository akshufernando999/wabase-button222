#!/usr/bin/env node
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from 'atexovi-baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import figlet from 'figlet';
import dotenv from 'dotenv';
import { handler } from './src/handler.js';

dotenv.config({ debug: false });

const originalError = console.error;
const originalLog = console.log;
const originalStdoutWrite = process.stdout.write;

const FILTER_PATTERNS = [
  'Bad MAC',
  'Failed to decrypt message with any known session',
  'Session error:',
  'Failed to decrypt',
  'Closing open session',
  'Closing session:',
  'SessionEntry',
  '_chains:',
  'registrationId:',
  'currentRatchet:',
  'indexInfo:',
  '<Buffer',
  'pubKey:',
  'privKey:',
  'baseKey:',
  'remoteIdentityKey:',
  'lastRemoteEphemeralKey:',
  'ephemeralKeyPair:',
  'chainKey:',
  'chainType:',
  'messageKeys:'
];

process.stdout.write = function(chunk, encoding, callback) {
  const str = chunk?.toString() || '';
  
  const shouldFilter = FILTER_PATTERNS.some(pattern => str.includes(pattern));
  
  if (shouldFilter) {
    if (str.includes('Closing open session')) {
      const cleanMsg = chalk.blue('🔒 Signal: Encryption session updated\n');
      return originalStdoutWrite.call(this, Buffer.from(cleanMsg), encoding, callback);
    }
    
    if (typeof callback === 'function') callback();
    return true;
  }
  
  return originalStdoutWrite.call(this, chunk, encoding, callback);
};

console.error = function(...args) {
  const msg = args.join(' ');
  
  if (FILTER_PATTERNS.some(pattern => msg.includes(pattern))) {
    if (msg.includes('Bad MAC')) {
      console.log(chalk.yellow('🔄 Signal Protocol: Securing connection...'));
    }
    return;
  }
  
  originalError.apply(console, args);
};

console.log = function(...args) {
  const msg = args.join(' ');
  
  if (FILTER_PATTERNS.some(pattern => msg.includes(pattern))) {
    return;
  }
  
  originalLog.apply(console, args);
};

const authDir = path.join(process.cwd(), 'session');

function centerText(text) {
  const lines = text.split('\n');
  const width = process.stdout.columns;
  return lines
    .map(line => {
      const pad = Math.max(0, Math.floor((width - line.length) / 2));
      return ' '.repeat(pad) + line;
    })
    .join('\n');
}

function showBanner() {
  console.clear();
  const text = figlet.textSync('NovoNex Bot', { font: 'Slant' });
  console.log(chalk.cyanBright(centerText(text)));
  const desc = 'NovoNex Software Solutions & Digital Works WhatsApp Bot';
  const line = '─'.repeat(desc.length);
  console.log(chalk.greenBright(centerText(desc)));
  console.log(chalk.gray(centerText(line)) + '\n');
}

async function startBot() {
  showBanner();
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log(chalk.greenBright('✅ Connected to WhatsApp!'));
      console.log(chalk.cyan(`👤 User: ${sock.user?.id || 'Unknown'}`));
      console.log(chalk.yellow('🤖 Bot is ready to receive messages...'));
    } else if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log(chalk.yellow('🔁 Connection lost. Reconnecting...'));
        startBot();
      } else {
        console.log(chalk.red('❌ Invalid session. Please delete the session folder and try again.'));
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('messages.upsert', m => {
    const msg = m.messages?.[0];
    if (!msg) return;
    
    // Group messages ignore කරන්න
    if (msg.key.remoteJid.endsWith('@g.us')) return;

    console.log(chalk.blueBright('💬 Incoming message from:'), msg.key.remoteJid);
    
    try { 
      handler(sock, msg); 
    } catch (err) {
      console.error(chalk.red('[Handler Error]'), err);
    }
  });

  const files = fs.readdirSync(authDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    let waNumber = process.env.WA_NUMBER;

    // Number එක .env file එකෙන් නැත්නම් command line arguments වලින් ගන්න
    if (!waNumber && process.argv[2]) {
      waNumber = process.argv[2];
    }

    // තවමත් number එක නැත්නම් error message දක්වන්න
    if (!waNumber) {
      console.log(chalk.red('❌ WhatsApp number not found!'));
      console.log(chalk.yellow('📝 Usage:'));
      console.log(chalk.cyan('  npm start <your_whatsapp_number>'));
      console.log(chalk.cyan('  node index.js <your_whatsapp_number>'));
      console.log(chalk.yellow('\n📝 Or create a .env file with:'));
      console.log(chalk.cyan('  WA_NUMBER=94771234567'));
      console.log(chalk.yellow('\n📝 Example:'));
      console.log(chalk.cyan('  npm start 94771234567'));
      process.exit(1);
    }

    // Number validation
    if (!/^\d{8,}$/.test(waNumber)) {
      console.log(chalk.red('❌ Invalid WhatsApp number format!'));
      console.log(chalk.yellow('📝 Number should contain only digits (8+ digits)'));
      console.log(chalk.yellow('📝 Example: 94771234567'));
      process.exit(1);
    }

    console.log(chalk.cyanBright(`📱 WhatsApp number: ${waNumber}`));
    console.log(chalk.yellow('⏳ Requesting pairing code...'));
    
    try {
      const code = await sock.requestPairingCode(waNumber);
      console.log(chalk.greenBright('\n✅ Pairing Code Generated!'));
      console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.bold.magentaBright(`         ${code}`));
      console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.cyan('\n📱 On WhatsApp App:'));
      console.log(chalk.white('  1. Go to Settings'));
      console.log(chalk.white('  2. Tap on "Linked Devices"'));
      console.log(chalk.white('  3. Tap on "Link a Device"'));
      console.log(chalk.white('  4. Enter the code above'));
      console.log(chalk.greenBright('\n⏳ Waiting for connection...'));
    } catch (error) {
      console.error(chalk.red('\n❌ Error requesting pairing code:'));
      console.log(chalk.yellow('💡 Tips:'));
      console.log(chalk.white('  • Make sure the number is correct'));
      console.log(chalk.white('  • Ensure WhatsApp account is active'));
      console.log(chalk.white('  • Check internet connection'));
      process.exit(1);
    }
  }
}

startBot();