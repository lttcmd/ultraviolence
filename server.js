const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

let players = [];
let bullets = [];

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
    } else if (data.type === 'shoot') {
      // Add a bullet in the direction specified
      if (typeof data.dx === 'number' && typeof data.dy === 'number') {
        const mag = Math.sqrt(data.dx * data.dx + data.dy * data.dy);
        if (mag > 0) {
          bullets.push({
            x: player.x + 10, // center of player
            y: player.y + 10,
            dx: (data.dx / mag) * 6,
            dy: (data.dy / mag) * 6,
            owner: player.id,
          });
        }
      }
    }
  });

  ws.on('close', () => {
    players = players.filter(p => p.ws !== ws);
  });
});

setInterval(() => {
  // Move bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.dx;
    b.y += b.dy;
    // Remove if out of bounds
    if (b.x < 0 || b.x > 600 || b.y < 0 || b.y > 400) {
      bullets.splice(i, 1);
      continue;
    }
    // Check collision with players
    for (const p of players) {
      if (p.id !== b.owner && Math.abs(p.x + 10 - b.x) < 15 && Math.abs(p.y + 10 - b.y) < 15) {
        p.hp = Math.max(0, p.hp - 1);
        bullets.splice(i, 1);
        break;
      }
    }
  }
  const state = players.map(p => ({ id: p.id, x: p.x, y: p.y, hp: p.hp }));
  players.forEach(p => {
    p.ws.send(JSON.stringify({ type: 'state', players: state, bullets }));
  });
}, 1000 / 30); // 30 FPS

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
