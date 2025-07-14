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
let playerDirs = {};
let lastShotTimes = [0, 0];
const weaponTypes = [
  { type: 'shotgun', cooldown: 600 },
  { type: 'sniper', cooldown: 3000 }
];

const GRID_SIZE = 40;
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1500;

function generateWalls() {
  walls = [];
  const gridCols = Math.floor((MAP_WIDTH - 80) / GRID_SIZE);
  const gridRows = Math.floor((MAP_HEIGHT - 80) / GRID_SIZE);
  const used = new Set();
  // Add border walls
  walls.push({ x: 0, y: 0, w: MAP_WIDTH, h: GRID_SIZE }); // top
  walls.push({ x: 0, y: MAP_HEIGHT - GRID_SIZE, w: MAP_WIDTH, h: GRID_SIZE }); // bottom
  walls.push({ x: 0, y: 0, w: GRID_SIZE, h: MAP_HEIGHT }); // left
  walls.push({ x: MAP_WIDTH - GRID_SIZE, y: 0, w: GRID_SIZE, h: MAP_HEIGHT }); // right
  for (let i = 0; i < 30; i++) {
    let gx, gy, w, h, key;
    let tries = 0;
    do {
      gx = Math.floor(2 + Math.random() * (gridCols - 4));
      gy = Math.floor(2 + Math.random() * (gridRows - 4));
      w = Math.floor(1 + Math.random() * 2) * GRID_SIZE;
      h = Math.floor(1 + Math.random() * 2) * GRID_SIZE;
      key = `${gx},${gy},${w},${h}`;
      tries++;
    } while ((used.has(key) || walls.some(wall => gx * GRID_SIZE < wall.x + wall.w && gx * GRID_SIZE + w > wall.x && gy * GRID_SIZE < wall.y + wall.h && gy * GRID_SIZE + h > wall.y)) && tries < 10);
    if (tries < 10) {
      used.add(key);
      walls.push({ x: gx * GRID_SIZE, y: gy * GRID_SIZE, w, h });
    }
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
  playerDirs[id] = { dx: 0, dy: -1 };
  // Player spawns at grid positions
  const gridCols = Math.floor((MAP_WIDTH - 80) / GRID_SIZE);
  const gridRows = Math.floor((MAP_HEIGHT - 80) / GRID_SIZE);
  let px, py, tries = 0;
  do {
    px = Math.floor(2 + Math.random() * (gridCols - 4)) * GRID_SIZE;
    py = Math.floor(2 + Math.random() * (gridRows - 4)) * GRID_SIZE;
    tries++;
  } while (walls.some(wall => px < wall.x + wall.w && px + GRID_SIZE > wall.x && py < wall.y + wall.h && py + GRID_SIZE > wall.y) && tries < 10);
  const player = {
    id,
    x: px,
    y: py,
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
      // In player movement, update bounds check for 40x40 player
      if (!collides && newX >= 0 && newX <= MAP_WIDTH - GRID_SIZE && newY >= 0 && newY <= MAP_HEIGHT - GRID_SIZE) {
        player.x = newX;
        player.y = newY;
      }
      if (data.look && typeof data.look.dx === 'number' && typeof data.look.dy === 'number') {
        playerDirs[player.id] = { dx: data.look.dx, dy: data.look.dy };
      }
    } else if (data.type === 'shoot') {
      const now = Date.now();
      let cooldown = 200;
      if (player.weapon === 'shotgun') cooldown = 300;
      if (player.weapon === 'sniper') cooldown = 500;
      if (now - lastShot[player.id] < cooldown) return;
      lastShot[player.id] = now;
      lastShotTimes[player.id] = now;
      if (typeof data.dx === 'number' && typeof data.dy === 'number') {
        const mag = Math.sqrt(data.dx * data.dx + data.dy * data.dy);
        if (mag > 0) {
          if (player.weapon === 'shotgun') {
            // Fire 3 pellets, 1hp each, cone
            for (let i = -1; i <= 1; i++) {
              const angle = Math.atan2(data.dy, data.dx) + i * 0.2;
              bullets.push({
                x: player.x + 10,
                y: player.y + 10,
                dx: Math.cos(angle) * 14,
                dy: Math.sin(angle) * 14,
                owner: player.id,
                damage: 1,
                maxDistance: 2000,
                traveled: 0,
                type: 'shotgun'
              });
            }
          } else if (player.weapon === 'sniper') {
            // Sniper: 1 large rectangular bullet, 3hp
            bullets.push({
              x: player.x + 10,
              y: player.y + 10,
              dx: (data.dx / mag) * 20,
              dy: (data.dy / mag) * 20,
              owner: player.id,
              damage: 3,
              maxDistance: 2000,
              traveled: 0,
              type: 'sniper'
            });
          } else {
            // Rifle: 1hp, shoots across map
            bullets.push({
              x: player.x + 10,
              y: player.y + 10,
              dx: (data.dx / mag) * 14,
              dy: (data.dy / mag) * 14,
              owner: player.id,
              damage: 1,
              maxDistance: 2000,
              traveled: 0,
              type: 'rifle'
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
    // In bullet out-of-bounds, update for 40x40 player
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
      if (p.id === b.owner) continue;
      // Sniper bullet: rectangle collision
      if (b.type === 'sniper') {
        // Sniper bullet is a 20x8 rectangle, rotated
        const bx = b.x, by = b.y;
        const angle = Math.atan2(b.dy, b.dx);
        // Get corners of the sniper bullet
        const cos = Math.cos(angle), sin = Math.sin(angle);
        // Centered at (bx, by), width 20, height 8
        // We'll check if any of the 4 corners of the player box are inside the bullet rectangle
        let hit = false;
        for (let dx of [0, 20]) {
          for (let dy of [0, 20]) {
            // Player corner in world coords
            const px = p.x + dx - bx;
            const py = p.y + dy - by;
            // Rotate to bullet's local space
            const rx = px * cos + py * sin;
            const ry = -px * sin + py * cos;
            if (rx >= -10 && rx <= 10 && ry >= -4 && ry <= 4) hit = true;
          }
        }
        if (hit) {
          p.hp = Math.max(0, p.hp - b.damage);
          if (p.hp === 0) {
            if (typeof scores[b.owner] === 'number') scores[b.owner]++;
            const gridCols = Math.floor((MAP_WIDTH - 80) / GRID_SIZE);
            const gridRows = Math.floor((MAP_HEIGHT - 80) / GRID_SIZE);
            p.x = Math.floor(2 + Math.random() * (gridCols - 4)) * GRID_SIZE;
            p.y = Math.floor(2 + Math.random() * (gridRows - 4)) * GRID_SIZE;
            p.hp = 3;
          }
          bullets.splice(i, 1);
          break;
        }
      } else {
        // Normal bullet: point in slightly larger player box (24x24)
        if (b.x >= p.x - 2 && b.x <= p.x + 22 && b.y >= p.y - 2 && b.y <= p.y + 22) {
          p.hp = Math.max(0, p.hp - b.damage);
          if (p.hp === 0) {
            if (typeof scores[b.owner] === 'number') scores[b.owner]++;
            const gridCols = Math.floor((MAP_WIDTH - 80) / GRID_SIZE);
            const gridRows = Math.floor((MAP_HEIGHT - 80) / GRID_SIZE);
            p.x = Math.floor(2 + Math.random() * (gridCols - 4)) * GRID_SIZE;
            p.y = Math.floor(2 + Math.random() * (gridRows - 4)) * GRID_SIZE;
            p.hp = 3;
          }
          bullets.splice(i, 1);
          break;
        }
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
    p.ws.send(JSON.stringify({ type: 'state', players: state, bullets, scores, walls, weaponsOnMap, playerDirs, lastShotTimes }));
  });
}, 1000 / 30); // 30 FPS

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
