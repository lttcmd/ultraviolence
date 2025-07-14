const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${protocol}://${location.host}`);
let playerId = null;
let players = [];
let bullets = [];
let lastDir = { dx: 0, dy: -1 };
let scores = [0, 0];
let walls = [];
let velocities = {};
let weaponsOnMap = [];

const keys = {};

let shootCooldown = 300; // ms for basic gun
let lastShot = 0;

document.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  if (e.key === ' ') {
    const now = Date.now();
    if (now - lastShot >= shootCooldown) {
      socket.send(JSON.stringify({ type: 'shoot', dx: lastDir.dx, dy: lastDir.dy }));
      lastShot = now;
    }
  }
});
document.addEventListener('keyup', (e) => keys[e.key] = false);

socket.addEventListener('message', (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'init') {
    playerId = data.id;
  } else if (data.type === 'state') {
    players = data.players;
    bullets = data.bullets || [];
    scores = data.scores || [0, 0];
    walls = data.walls || [];
    weaponsOnMap = data.weaponsOnMap || [];
  }
});

function sendMovement() {
  let dx = 0, dy = 0;
  if (keys['w']) dy = -3;
  if (keys['s']) dy = 3;
  if (keys['a']) dx = -3;
  if (keys['d']) dx = 3;
  if (dx !== 0 || dy !== 0) {
    lastDir = { dx, dy };
    velocities[playerId] = { dx, dy };
    socket.send(JSON.stringify({ type: 'move', dx, dy }));
  } else {
    velocities[playerId] = { dx: 0, dy: 0 };
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Draw walls
  ctx.fillStyle = 'gray';
  for (const w of walls) {
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }
  // Draw weapon pickups
  for (const w of weaponsOnMap) {
    if (w.type === 'shotgun') {
      ctx.fillStyle = 'orange';
      ctx.fillRect(w.x - 8, w.y - 8, 16, 16);
      ctx.fillStyle = 'black';
      ctx.fillText('S', w.x - 5, w.y + 5);
    } else if (w.type === 'sniper') {
      ctx.fillStyle = 'blue';
      ctx.fillRect(w.x - 8, w.y - 8, 16, 16);
      ctx.fillStyle = 'white';
      ctx.fillText('N', w.x - 5, w.y + 5);
    }
  }
  // Draw scores
  ctx.fillStyle = 'white';
  ctx.font = '20px Arial';
  ctx.fillText(`You: ${scores[playerId] || 0}`, 20, 30);
  ctx.fillText(`Opponent: ${scores[1 - playerId] || 0}`, 450, 30);
  // Draw players
  for (const p of players) {
    // Smooth movement
    if (!velocities[p.id]) velocities[p.id] = { dx: 0, dy: 0 };
    p.x += velocities[p.id].dx * 0.2;
    p.y += velocities[p.id].dy * 0.2;
    ctx.fillStyle = p.id === playerId ? 'lime' : 'red';
    ctx.fillRect(p.x, p.y, 20, 20);
    // Draw HP bar
    ctx.fillStyle = 'black';
    ctx.fillRect(p.x, p.y - 10, 20, 5);
    ctx.fillStyle = 'green';
    ctx.fillRect(p.x, p.y - 10, 20 * (p.hp / 3), 5);
    // Draw weapon name
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.fillText(p.weapon || 'basic', p.x, p.y - 15);
  }
  // Draw bullets
  ctx.fillStyle = 'yellow';
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5, 0, 2 * Math.PI);
    ctx.fill();
  }
  // Show weapon info for player
  const me = players.find(p => p.id === playerId);
  if (me) {
    let info = '';
    if (me.weapon === 'shotgun') info = 'Shotgun: 3 bullets, 1 dmg, 0.6s cooldown';
    else if (me.weapon === 'sniper') info = 'Sniper: 1 bullet, 3 dmg, 3s cooldown';
    else info = 'Basic: 1 bullet, 1 dmg, 0.3s cooldown';
    ctx.fillStyle = 'white';
    ctx.font = '16px Arial';
    ctx.fillText(info, 20, canvas.height - 20);
  }
}

function gameLoop() {
  sendMovement();
  draw();
  requestAnimationFrame(gameLoop);
}

gameLoop();
