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

function showPairingCode(waNumber, code) {
  console.clear();
  showBanner();
  console.log(chalk.greenBright('✅ Pairing Code Generated Successfully!'));
  console.log(chalk.gray('───────────────────────────────────────────\n'));
  console.log(chalk.cyan('📱 WhatsApp Number:'), chalk.bold.white(waNumber));
  console.log(chalk.yellow('🔢 Pairing Code:'), chalk.bold.magentaBright(code));
  console.log(chalk.gray('\n───────────────────────────────────────────'));
  console.log(chalk.cyan('📋 Instructions:'));
  console.log(chalk.white('1. Open WhatsApp on your phone'));
  console.log(chalk.white('2. Go to Settings → Linked Devices → Link a Device'));
  console.log(chalk.white('3. Select "Link with phone number"'));
  console.log(chalk.white(`4. Enter this number: ${chalk.bold(waNumber)}`));
  console.log(chalk.white(`5. Enter this code: ${chalk.bold.magentaBright(code)}`));
  console.log(chalk.green('\n⏳ Waiting for connection...'));
}

async function startBot() {
  showBanner();
  
  // Get WhatsApp number from command line arguments
  const args = process.argv.slice(2);
  let waNumber = args[0];
  
  // Validate the phone number format
  if (!waNumber) {
    console.log(chalk.red('❌ Error: WhatsApp number is required!'));
    console.log(chalk.yellow('💡 Usage: npm start <whatsapp-number>'));
    console.log(chalk.cyan('Example: npm start 94741984208\n'));
    process.exit(1);
  }
  
  // Remove any non-digit characters
  waNumber = waNumber.replace(/\D/g, '');
  
  // Validate number format (at least 10 digits)
  if (waNumber.length < 10) {
    console.log(chalk.red('❌ Error: Invalid WhatsApp number!'));
    console.log(chalk.yellow('Please provide a valid number (e.g., 94741984208)\n'));
    process.exit(1);
  }
  
  console.log(chalk.cyan(`📱 Using WhatsApp Number: ${chalk.bold(waNumber)}\n`));
  
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  // Check if session exists
  const sessionFiles = fs.existsSync(authDir) ? 
    fs.readdirSync(authDir).filter(f => f.endsWith('.json')) : 
    [];

  // If no session exists, request pairing code
  if (sessionFiles.length === 0) {
    try {
      console.log(chalk.yellow('⏳ Generating pairing code...\n'));
      
      const code = await sock.requestPairingCode(waNumber);
      
      if (!code) {
        console.log(chalk.red('❌ Failed to generate pairing code!'));
        console.log(chalk.yellow('Please check your number and try again.\n'));
        process.exit(1);
      }
      
      showPairingCode(waNumber, code);
      
    } catch (error) {
      console.error(chalk.red('❌ Error generating pairing code:'), error.message);
      
      if (error.message.includes('not registered')) {
        console.log(chalk.yellow('\n⚠️ This number may not be registered on WhatsApp.'));
        console.log(chalk.yellow('Please check the number and try again.'));
      } else if (error.message.includes('rate limit')) {
        console.log(chalk.yellow('\n⚠️ Rate limit exceeded. Please wait a few minutes.'));
      } else if (error.message.includes('timeout')) {
        console.log(chalk.yellow('\n⚠️ Connection timeout. Please check your internet.'));
      }
      
      console.log(chalk.yellow('\n🔄 Restarting in 5 seconds...'));
      setTimeout(() => {
        console.clear();
        startBot();
      }, 5000);
      return;
    }
  } else {
    console.log(chalk.green('✅ Existing session found. Connecting...\n'));
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.clear();
      showBanner();
      console.log(chalk.greenBright('✅ Successfully Connected to WhatsApp!'));
      console.log(chalk.gray('──────────────────────────────────────\n'));
      console.log(chalk.cyan(`👤 User ID: ${sock.user?.id || 'Unknown'}`));
      console.log(chalk.cyan(`📛 Name: ${sock.user?.name || 'Not available'}`));
      console.log(chalk.yellow('\n🤖 Bot is now ready to receive messages...\n'));
    } else if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log(chalk.yellow('🔁 Connection lost. Reconnecting in 3 seconds...'));
        setTimeout(() => {
          console.clear();
          startBot();
        }, 3000);
      } else {
        console.log(chalk.red('❌ Invalid session. Please delete the session folder and try again.'));
        console.log(chalk.yellow('💡 Run: rm -rf session/\n'));
        process.exit(0);
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
}

// Handle process termination
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Bot is shutting down...'));
  process.exit(0);
});

startBot();
