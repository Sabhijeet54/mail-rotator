const nodemailer = require('nodemailer');
const crypto = require('crypto');

// SMTP settings for the common providers. "custom" lets the user type their own.
const PRESETS = {
  gmail:   { host: 'smtp.gmail.com',      port: 465, secure: true  },
  outlook: { host: 'smtp.office365.com',  port: 587, secure: false },
  icloud:  { host: 'smtp.mail.me.com',    port: 587, secure: false },
  yahoo:   { host: 'smtp.mail.yahoo.com', port: 465, secure: true  },
  zoho:    { host: 'smtp.zoho.com',       port: 465, secure: true  },
};

// In-memory only. Restarting the server clears accounts (fine for a demo).
const accounts = new Map();

function buildConfig(data) {
  if (data.provider === 'custom') {
    const port = Number(data.port) || 587;
    return { host: data.host, port, secure: port === 465 };
  }
  const p = PRESETS[data.provider];
  if (!p) throw new Error('Unknown provider: ' + data.provider);
  return { ...p };
}

function makeTransport(data) {
  const cfg = buildConfig(data);
  return nodemailer.createTransport({
    ...cfg,
    auth: { user: data.email, pass: data.password },
  });
}

function publicView(acc) {
  return {
    id: acc.id,
    provider: acc.provider,
    email: acc.email,
    fromName: acc.fromName,
    dailyLimit: acc.dailyLimit,
    sentToday: acc.sentToday,
  };
}

// Adds an account only after the SMTP login actually works.
async function addAccount(data) {
  if (!data.email || !data.password) throw new Error('Email and app password are required');
  const transport = makeTransport(data);
  await transport.verify(); // throws if login / SMTP is wrong

  const id = crypto.randomUUID();
  const acc = {
    id,
    provider: data.provider,
    email: data.email,
    password: data.password,
    fromName: data.fromName || '',
    host: data.host || '',
    port: data.port || '',
    dailyLimit: Number(data.dailyLimit) || 0, // 0 = no limit
    sentToday: 0,
    transport,
  };
  accounts.set(id, acc);
  return publicView(acc);
}

function removeAccount(id) {
  accounts.delete(id);
}

function listAccounts() {
  return Array.from(accounts.values()).map(publicView);
}

// Full objects (with transport) for the sender.
function getSendingAccounts() {
  return Array.from(accounts.values());
}

module.exports = { addAccount, removeAccount, listAccounts, getSendingAccounts };
