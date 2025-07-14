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
  }
  // Draw bullets
  ctx.fillStyle = 'yellow';
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

function gameLoop() {
  sendMovement();
  draw();
  requestAnimationFrame(gameLoop);
}

gameLoop();
