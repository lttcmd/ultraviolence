const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${protocol}://${location.host}`);

let playerId = null;
let players = [];

const keys = {};

document.addEventListener('keydown', (e) => keys[e.key] = true);
document.addEventListener('keyup', (e) => keys[e.key] = false);

socket.addEventListener('message', (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'init') {
    playerId = data.id;
  } else if (data.type === 'state') {
    players = data.players;
  }
});

function sendMovement() {
  let dx = 0, dy = 0;
  if (keys['w']) dy = -2;
  if (keys['s']) dy = 2;
  if (keys['a']) dx = -2;
  if (keys['d']) dx = 2;
  if (dx !== 0 || dy !== 0) {
    socket.send(JSON.stringify({ type: 'move', dx, dy }));
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const p of players) {
    ctx.fillStyle = p.id === playerId ? 'lime' : 'red';
    ctx.fillRect(p.x, p.y, 20, 20);
  }
}

function gameLoop() {
  sendMovement();
  draw();
  requestAnimationFrame(gameLoop);
}

gameLoop();
