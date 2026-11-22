const { createServer } = require('http');
const next = require('next');
const { Server } = require('socket.io');

const { addAccount, removeAccount, listAccounts } = require('./lib/store');
const { runCampaign, stopCampaign } = require('./lib/sender');

const dev = process.env.NODE_ENV !== 'production';
const port = process.env.PORT || 3000;

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res));

  // 100 MB buffer so small image attachments can travel over the socket.
  const io = new Server(server, { maxHttpBufferSize: 1e8 });

  io.on('connection', (socket) => {
    socket.emit('accounts', listAccounts());

    socket.on('add_account', async (data, cb) => {
      try {
        const account = await addAccount(data);
        io.emit('accounts', listAccounts());
        if (cb) cb({ ok: true, account });
      } catch (e) {
        if (cb) cb({ ok: false, error: e.message });
      }
    });

    socket.on('remove_account', (id) => {
      removeAccount(id);
      io.emit('accounts', listAccounts());
    });

    socket.on('get_accounts', () => {
      socket.emit('accounts', listAccounts());
    });

    socket.on('start', (payload) => {
      runCampaign(payload, io).catch((e) =>
        io.emit('log', { type: 'error', msg: 'Campaign crashed: ' + e.message })
      );
    });

    socket.on('stop', () => stopCampaign());
  });

  server.listen(port, () => {
    console.log(`> Mail Rotator ready on http://localhost:${port}`);
  });
});
