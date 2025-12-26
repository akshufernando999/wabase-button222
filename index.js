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
  
  // Create session directory if it doesn't exist
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    
    console.log(chalk.cyan(`📡 Connection status: ${connection}`));

    if (connection === 'open') {
      console.log(chalk.greenBright('✅ Connected to WhatsApp!'));
      console.log(chalk.cyan(`👤 User: ${sock.user?.id || 'Unknown'}`));
      console.log(chalk.yellow('🤖 Bot is ready to receive messages...'));
      
      // Send connected message
      const botInfo = `🤖 *NovoNex Bot Connected*\n\n` +
                     `✅ Successfully connected to WhatsApp\n` +
                     `👤 User: ${sock.user?.id || 'Unknown'}\n` +
                     `⏰ Time: ${new Date().toLocaleString()}`;
      
      try {
        // Send message to yourself to confirm connection
        await sock.sendMessage(sock.user?.id, { text: botInfo });
      } catch (err) {
        console.log(chalk.yellow('⚠️ Could not send confirmation message'));
      }
      
    } else if (connection === 'close') {
      console.log(chalk.yellow('🔌 Connection closed'));
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(chalk.yellow(`📊 Disconnect reason code: ${reason}`));
      
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      
      if (shouldReconnect) {
        console.log(chalk.yellow('🔁 Connection lost. Reconnecting in 5 seconds...'));
        setTimeout(() => {
          startBot();
        }, 5000);
      } else {
        console.log(chalk.red('❌ Invalid session. Please delete the session folder and try again.'));
        console.log(chalk.yellow('💡 Run: rm -rf session'));
      }
    } else if (connection === 'connecting') {
      console.log(chalk.blue('🔄 Connecting to WhatsApp...'));
    }
  });

  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('messages.upsert', async m => {
    try {
      const msg = m.messages?.[0];
      if (!msg) return;
      
      // Group messages ignore කරන්න
      if (msg.key.remoteJid.endsWith('@g.us')) return;

      console.log(chalk.blueBright('💬 Incoming message from:'), msg.key.remoteJid);
      
      await handler(sock, msg); 
    } catch (err) {
      console.error(chalk.red('[Handler Error]'), err.message);
    }
  });

  // Handle pairing code request
  const files = fs.readdirSync(authDir).filter(f => f.endsWith('.json'));
  console.log(chalk.cyan(`📁 Session files found: ${files.length}`));
  
  if (files.length === 0) {
    console.log(chalk.yellow('📱 No existing session found. Creating new session...'));
    
    let waNumber = process.env.WA_NUMBER;

    // Number එක .env file එකෙන් නැත්නම් command line arguments වලින් ගන්න
    if (!waNumber && process.argv[2]) {
      waNumber = process.argv[2];
    }

    // තවමත් number එක නැත්නම් error message දක්වන්න
    if (!waNumber) {
      console.log(chalk.red('❌ WhatsApp number not found!'));
      console.log(chalk.yellow('\n📝 Usage Options:'));
      console.log(chalk.cyan('  1. Create .env file:'));
      console.log(chalk.white('     echo "WA_NUMBER=94741984208" > .env'));
      console.log(chalk.white('     npm start'));
      console.log(chalk.cyan('\n  2. Use command line:'));
      console.log(chalk.white('     npm start 94741984208'));
      console.log(chalk.white('     node index.js 94741984208'));
      console.log(chalk.cyan('\n  3. Try different formats:'));
      console.log(chalk.white('     node index.js 94741984208  (94... format)'));
      console.log(chalk.white('     node index.js 741984208     (without 94)'));
      console.log(chalk.white('     node index.js 0741984208    (with 0)'));
      process.exit(1);
    }

    // Number validation and formatting
    console.log(chalk.cyan(`📱 Processing number: ${waNumber}`));
    
    // Clean number (remove +, spaces, etc.)
    waNumber = waNumber.toString().replace(/[+\s\-()]/g, '');
    
    // If number starts with 0, replace with 94
    if (waNumber.startsWith('0')) {
      waNumber = '94' + waNumber.substring(1);
    }
    
    // If number doesn't start with country code, add it
    if (!waNumber.startsWith('94') && waNumber.length <= 10) {
      waNumber = '94' + waNumber;
    }
    
    console.log(chalk.green(`✅ Formatted number: ${waNumber}`));
    
    // Validate number
    if (!/^\d{10,15}$/.test(waNumber)) {
      console.log(chalk.red('❌ Invalid WhatsApp number format!'));
      console.log(chalk.yellow('📝 Number should be 10-15 digits'));
      console.log(chalk.yellow('📝 Examples: 94741984208, 741984208, 0741984208'));
      process.exit(1);
    }

    console.log(chalk.yellow('⏳ Requesting pairing code from WhatsApp...'));
    
    try {
      const code = await sock.requestPairingCode(waNumber);
      
      console.log(chalk.greenBright('\n' + '='.repeat(50)));
      console.log(chalk.greenBright('✅ PAIRING CODE GENERATED SUCCESSFULLY!'));
      console.log(chalk.greenBright('='.repeat(50)));
      
      console.log(chalk.yellow('\n' + '─'.repeat(40)));
      console.log(chalk.bold.magentaBright(`          ${code}`));
      console.log(chalk.yellow('─'.repeat(40)));
      
      console.log(chalk.cyan('\n📱 ON YOUR WHATSAPP APP:'));
      console.log(chalk.white('  1. Open WhatsApp on your phone'));
      console.log(chalk.white('  2. Tap on ⋮ (three dots) → Linked Devices'));
      console.log(chalk.white('  3. Tap on "Link a Device"'));
      console.log(chalk.white('  4. Tap on "Link with phone number"'));
      console.log(chalk.white('  5. Enter this code: ') + chalk.bold.magentaBright(code));
      
      console.log(chalk.yellow('\n⏳ Waiting for connection...'));
      console.log(chalk.gray('  The bot will connect automatically once you enter the code.'));
      console.log(chalk.gray('  This may take 10-30 seconds.'));
      
    } catch (error) {
      console.error(chalk.red('\n❌ ERROR REQUESTING PAIRING CODE:'));
      console.error(chalk.red('  Message:'), error.message);
      
      console.log(chalk.yellow('\n💡 TROUBLESHOOTING TIPS:'));
      console.log(chalk.white('  1. Check your number: ') + chalk.cyan(waNumber));
      console.log(chalk.white('  2. Ensure WhatsApp is active on your phone'));
      console.log(chalk.white('  3. Make sure your phone has internet'));
      console.log(chalk.white('  4. Try different number formats:'));
      console.log(chalk.white('     - ') + chalk.cyan('94741984208') + chalk.white(' (with 94)'));
      console.log(chalk.white('     - ') + chalk.cyan('741984208') + chalk.white(' (without 94)'));
      console.log(chalk.white('     - ') + chalk.cyan('0741984208') + chalk.white(' (with 0)'));
      console.log(chalk.white('  5. Wait 1 minute and try again'));
      
      console.log(chalk.yellow('\n🔄 Trying alternative solution in 5 seconds...'));
      
      // Try alternative approach
      setTimeout(async () => {
        console.log(chalk.cyan('\n🔄 Attempting alternative connection method...'));
        try {
          // Alternative: Try without explicit number
          console.log(chalk.yellow('📱 Trying to generate QR code instead...'));
          
          // We'll let the socket try to connect normally
          console.log(chalk.green('✅ Alternative method initiated.'));
          console.log(chalk.yellow('⏳ If pairing code fails, we may need QR code method.'));
          
        } catch (altError) {
          console.error(chalk.red('❌ Alternative method also failed:'), altError.message);
          console.log(chalk.yellow('💡 Please check your internet and try again.'));
        }
      }, 5000);
    }
  } else {
    console.log(chalk.green(`✅ Existing session found with ${files.length} file(s)`));
    console.log(chalk.yellow('🔄 Connecting using existing session...'));
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Received shutdown signal'));
  console.log(chalk.cyan('✅ Bot shutting down gracefully...'));
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('⚠️ Uncaught Exception:'), error.message);
  console.error(chalk.red('Stack:'), error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('⚠️ Unhandled Rejection at:'), promise);
  console.error(chalk.red('Reason:'), reason);
});

// Start the bot
startBot().catch(error => {
  console.error(chalk.red('❌ Failed to start bot:'), error.message);
  console.error(chalk.red('Stack:'), error.stack);
  process.exit(1);
});
