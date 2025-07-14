const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();

// Health check route so DO knows app is alive
app.get('/', (req, res) => {
  res.send('Server is running');
});

app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = [];

wss.on('connection', (ws) => {
  if (players.length >= 2) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  const id = players.length;
  const player = {
    id,
    x: Math.random() * 400,
    y: Math.random() * 400,
    hp: 3,
    ws,
  };

  players.push(player);

  ws.send(JSON.stringify({ type: 'init', id }));

  ws.on('message', (msg) => {
    const data = JSON.parse(msg);
    if (data.type === 'move') {
      player.x += data.dx;
      player.y += data.dy;
    }
  });

  ws.on('close', () => {
    players = players.filter(p => p.ws !== ws);
  });
});

// Broadcast game state 30 times per second
setInterval(() => {
  const state = players.map(p => ({ id: p.id, x: p.x, y: p.y, hp: p.hp }));
  players.forEach(p => {
    p.ws.send(JSON.stringify({ type: 'state', players: state }));
  });
}, 1000 / 30);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

