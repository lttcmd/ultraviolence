const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const socket = new WebSocket(`ws://${location.host}`);
let playerId = null;
let players = [];
let bullets = [];
let lastDir = { dx: 0, dy: -1 };

const keys = {};

document.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  if (e.key === ' ') {
    // Shoot in last direction
    socket.send(JSON.stringify({ type: 'shoot', dx: lastDir.dx, dy: lastDir.dy }));
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
  }
});

function sendMovement() {
  let dx = 0, dy = 0;
  if (keys['w']) dy = -2;
  if (keys['s']) dy = 2;
  if (keys['a']) dx = -2;
  if (keys['d']) dx = 2;
  if (dx !== 0 || dy !== 0) {
    lastDir = { dx, dy };
    socket.send(JSON.stringify({ type: 'move', dx, dy }));
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Draw players
  for (const p of players) {
    ctx.fillStyle = p.id === playerId ? 'lime' : 'red';
    ctx.fillRect(p.x, p.y, 20, 20);
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
