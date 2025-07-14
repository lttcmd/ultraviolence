const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

let players = [];
let bullets = [];
let scores = [0, 0];
let walls = [];
let lastShot = [0, 0];
let weaponsOnMap = [];
const weaponTypes = [
  { type: 'shotgun', cooldown: 600 },
  { type: 'sniper', cooldown: 3000 }
];

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1500;

function generateWalls() {
  walls = [];
  for (let i = 0; i < 30; i++) {
    // Random wall, not too close to edges
    const x = 50 + Math.random() * (MAP_WIDTH - 150);
    const y = 50 + Math.random() * (MAP_HEIGHT - 150);
    const w = 40 + Math.random() * 60;
    const h = 40 + Math.random() * 60;
    walls.push({ x, y, w, h });
  }
}
generateWalls();

function spawnWeapon() {
  // Randomly pick a weapon type
  const weapon = weaponTypes[Math.floor(Math.random() * weaponTypes.length)];
  // Place somewhere not inside a wall
  let x, y, tries = 0;
  do {
    x = 50 + Math.random() * (MAP_WIDTH - 100);
    y = 50 + Math.random() * (MAP_HEIGHT - 100);
    tries++;
  } while (tries < 10 && walls.some(w => x > w.x - 20 && x < w.x + w.w + 20 && y > w.y - 20 && y < w.y + w.h + 20));
  weaponsOnMap.push({ type: weapon.type, x, y });
}
function resetWeapons() {
  weaponsOnMap = [];
  spawnWeapon();
  spawnWeapon();
}
resetWeapons();

wss.on('connection', (ws) => {
  if (players.length >= 2) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  const id = players.length;
  const player = {
    id,
    x: Math.random() * (MAP_WIDTH - 200),
    y: Math.random() * (MAP_HEIGHT - 200),
    hp: 3,
    ws,
    weapon: 'basic',
  };

  players.push(player);

  ws.send(JSON.stringify({ type: 'init', id }));

  ws.on('message', (msg) => {
    const data = JSON.parse(msg);
    if (data.type === 'move') {
      const newX = player.x + data.dx;
      const newY = player.y + data.dy;
      // Check collision with walls
      let collides = false;
      for (const wall of walls) {
        if (
          newX + 20 > wall.x && newX < wall.x + wall.w &&
          newY + 20 > wall.y && newY < wall.y + wall.h
        ) {
          collides = true;
          break;
        }
      }
      if (!collides && newX >= 0 && newX <= MAP_WIDTH - 20 && newY >= 0 && newY <= MAP_HEIGHT - 20) {
        player.x = newX;
        player.y = newY;
      }
    } else if (data.type === 'shoot') {
      const now = Date.now();
      let cooldown = 300;
      if (player.weapon === 'shotgun') cooldown = 500;
      if (player.weapon === 'sniper') cooldown = 1500;
      if (player.weapon === 'basic') cooldown = 250;
      if (now - lastShot[player.id] < cooldown) return;
      lastShot[player.id] = now;
      if (typeof data.dx === 'number' && typeof data.dy === 'number') {
        const mag = Math.sqrt(data.dx * data.dx + data.dy * data.dy);
        if (mag > 0) {
          if (player.weapon === 'shotgun') {
            // Fire 3 bullets in a spread, short range
            for (let i = -1; i <= 1; i++) {
              const angle = Math.atan2(data.dy, data.dx) + i * 0.2;
              bullets.push({
                x: player.x + 10,
                y: player.y + 10,
                dx: Math.cos(angle) * 10,
                dy: Math.sin(angle) * 10,
                owner: player.id,
                damage: 1,
                maxDistance: 200,
                traveled: 0
              });
            }
          } else if (player.weapon === 'sniper') {
            // Sniper: 1 bullet, 3 damage, unlimited range
            bullets.push({
              x: player.x + 10,
              y: player.y + 10,
              dx: (data.dx / mag) * 14,
              dy: (data.dy / mag) * 14,
              owner: player.id,
              damage: 3,
              maxDistance: Infinity,
              traveled: 0
            });
          } else {
            // Rifle: 1 bullet, 1 damage (3 if very close), medium range
            bullets.push({
              x: player.x + 10,
              y: player.y + 10,
              dx: (data.dx / mag) * 10,
              dy: (data.dy / mag) * 10,
              owner: player.id,
              damage: 1,
              maxDistance: 700,
              traveled: 0
            });
          }
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
    b.traveled += Math.sqrt(b.dx * b.dx + b.dy * b.dy);
    // Remove if out of bounds or over range
    if (b.x < 0 || b.x > MAP_WIDTH || b.y < 0 || b.y > MAP_HEIGHT || b.traveled > b.maxDistance) {
      bullets.splice(i, 1);
      continue;
    }
    // Check collision with walls
    let hitWall = false;
    for (const wall of walls) {
      if (b.x > wall.x && b.x < wall.x + wall.w && b.y > wall.y && b.y < wall.y + wall.h) {
        hitWall = true;
        break;
      }
    }
    if (hitWall) {
      bullets.splice(i, 1);
      continue;
    }
    // Check collision with players
    for (const p of players) {
      if (p.id !== b.owner && Math.abs(p.x + 10 - b.x) < 15 && Math.abs(p.y + 10 - b.y) < 15) {
        // Rifle close-range bonus
        let dmg = b.damage;
        if (b.damage === 1 && b.maxDistance === 700) {
          const dist = Math.sqrt(Math.pow(p.x + 10 - (b.x - b.dx), 2) + Math.pow(p.y + 10 - (b.y - b.dy), 2));
          if (dist < 40) dmg = 3;
        }
        p.hp = Math.max(0, p.hp - dmg);
        if (p.hp === 0) {
          // Increment killer's score
          if (typeof scores[b.owner] === 'number') scores[b.owner]++;
          // Respawn player
          p.x = Math.random() * (MAP_WIDTH - 200);
          p.y = Math.random() * (MAP_HEIGHT - 200);
          p.hp = 3;
        }
        bullets.splice(i, 1);
        break;
      }
    }
  }
  // Weapon pickup
  for (const player of players) {
    for (let i = weaponsOnMap.length - 1; i >= 0; i--) {
      const w = weaponsOnMap[i];
      if (player.x + 10 > w.x - 15 && player.x + 10 < w.x + 15 && player.y + 10 > w.y - 15 && player.y + 10 < w.y + 15) {
        player.weapon = w.type;
        weaponsOnMap.splice(i, 1);
        setTimeout(spawnWeapon, 2000); // respawn after 2s
      }
    }
  }
  const state = players.map(p => ({ id: p.id, x: p.x, y: p.y, hp: p.hp }));
  players.forEach(p => {
    p.ws.send(JSON.stringify({ type: 'state', players: state, bullets, scores, walls, weaponsOnMap }));
  });
}, 1000 / 30); // 30 FPS

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
