const { getSendingAccounts } = require('./store');
const { extractEmails } = require('./extract');

let running = false;
let pointer = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Rotate to the next account that still has capacity today.
function nextAccount(accounts) {
  for (let k = 0; k < accounts.length; k++) {
    const acc = accounts[pointer % accounts.length];
    pointer++;
    if (!acc.dailyLimit || acc.sentToday < acc.dailyLimit) return acc;
  }
  return null; // everyone is at their daily limit
}

async function runCampaign(payload, io) {
  if (running) {
    io.emit('log', { type: 'warn', msg: 'A campaign is already running.' });
    return;
  }

  const accounts = getSendingAccounts();
  if (accounts.length === 0) {
    io.emit('log', { type: 'error', msg: 'No sender accounts added yet.' });
    return;
  }

  const recipients = extractEmails(payload.recipientsText);
  if (recipients.length === 0) {
    io.emit('log', { type: 'error', msg: 'No valid recipient emails found in the text.' });
    return;
  }

  const delayMin = Math.max(0, Number(payload.delayMin) || 10);
  const delayMax = Math.max(delayMin, Number(payload.delayMax) || 30);

  const attachments = (payload.attachments || []).map((a) => ({
    filename: a.filename,
    content: Buffer.from(String(a.content).split(',').pop(), 'base64'),
  }));

  running = true;
  pointer = 0;
  io.emit('status', { running: true });
  io.emit('log', {
    type: 'info',
    msg: `Starting: ${recipients.length} recipients, rotating across ${accounts.length} account(s).`,
  });

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i++) {
    if (!running) {
      io.emit('log', { type: 'warn', msg: 'Stopped by user.' });
      break;
    }

    const to = recipients[i];
    const acc = nextAccount(accounts);
    if (!acc) {
      io.emit('log', { type: 'warn', msg: 'All accounts hit their daily limit. Stopping.' });
      break;
    }

    try {
      await acc.transport.sendMail({
        from: acc.fromName ? `"${acc.fromName}" <${acc.email}>` : acc.email,
        to,
        subject: payload.subject || '',
        text: payload.body || '',
        html: payload.html || undefined,
        attachments,
      });
      sent++;
      acc.sentToday++;
      io.emit('log', { type: 'success', msg: `#${i + 1}  ${acc.email}  →  ${to}` });
    } catch (e) {
      failed++;
      io.emit('log', { type: 'error', msg: `#${i + 1}  ${acc.email}  →  ${to}  FAILED: ${e.message}` });
    }

    io.emit('progress', { sent, failed, total: recipients.length });
    io.emit('accounts_tick'); // tell UI to refresh counters

    // Wait before the next one (gap = rest time for the account just used).
    if (i < recipients.length - 1 && running) {
      const wait = rand(delayMin, delayMax);
      io.emit('log', { type: 'info', msg: `Waiting ${wait}s before next send...` });
      for (let s = 0; s < wait; s++) {
        if (!running) break;
        await sleep(1000);
      }
    }
  }

  running = false;
  io.emit('status', { running: false });
  io.emit('log', { type: 'info', msg: `Done. Sent: ${sent}, Failed: ${failed}.` });
}

function stopCampaign() {
  running = false;
}

module.exports = { runCampaign, stopCampaign };
