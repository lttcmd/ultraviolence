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

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1500;
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;

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

function getCamera(player) {
  let camX = player.x + 10 - CANVAS_WIDTH / 2;
  let camY = player.y + 10 - CANVAS_HEIGHT / 2;
  camX = Math.max(0, Math.min(MAP_WIDTH - CANVAS_WIDTH, camX));
  camY = Math.max(0, Math.min(MAP_HEIGHT - CANVAS_HEIGHT, camY));
  return { x: camX, y: camY };
}

function isInCone(px, py, player, camera) {
  const cx = player.x - camera.x + 10;
  const cy = player.y - camera.y + 10;
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(lastDir.dy, lastDir.dx);
  const pointAngle = Math.atan2(dy, dx);
  const coneLength = 400;
  const coneAngle = Math.PI * 0.6;
  let da = Math.abs(((pointAngle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  return dist < coneLength && da < coneAngle / 2;
}

function drawTorchCone(ctx, player, camera) {
  const px = player.x - camera.x + 10;
  const py = player.y - camera.y + 10;
  const angle = Math.atan2(lastDir.dy, lastDir.dx);
  ctx.save();
  // Draw a radial gradient for darkness
  let grad = ctx.createRadialGradient(px, py, 100, px, py, 420);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0.95)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  // Mask out the cone
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(px, py);
  const coneLength = 400;
  const coneAngle = Math.PI * 0.6;
  ctx.arc(px, py, coneLength, angle - coneAngle / 2, angle + coneAngle / 2);
  ctx.lineTo(px, py);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const me = players.find(p => p.id === playerId);
  const camera = me ? getCamera(me) : { x: 0, y: 0 };
  // Draw walls
  ctx.fillStyle = 'gray';
  for (const w of walls) {
    // Only draw if center of wall is in cone
    if (!me || isInCone(w.x + w.w / 2 - camera.x, w.y + w.h / 2 - camera.y, me, camera))
      ctx.fillRect(w.x - camera.x, w.y - camera.y, w.w, w.h);
  }
  // Draw weapon pickups
  for (const w of weaponsOnMap) {
    if (!me || isInCone(w.x - camera.x, w.y - camera.y, me, camera)) {
      if (w.type === 'shotgun') {
        ctx.fillStyle = 'orange';
        ctx.fillRect(w.x - 8 - camera.x, w.y - 8 - camera.y, 16, 16);
        ctx.fillStyle = 'black';
        ctx.fillText('S', w.x - 5 - camera.x, w.y + 5 - camera.y);
      } else if (w.type === 'sniper') {
        ctx.fillStyle = 'blue';
        ctx.fillRect(w.x - 8 - camera.x, w.y - 8 - camera.y, 16, 16);
        ctx.fillStyle = 'white';
        ctx.fillText('N', w.x - 5 - camera.x, w.y + 5 - camera.y);
      }
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
    // Only draw self or opponent if in cone
    if (p.id === playerId || (me && isInCone(p.x + 10 - camera.x, p.y + 10 - camera.y, me, camera))) {
      ctx.fillStyle = p.id === playerId ? 'lime' : 'red';
      ctx.fillRect(p.x - camera.x, p.y - camera.y, 20, 20);
      // Draw HP bar
      ctx.fillStyle = 'black';
      ctx.fillRect(p.x - camera.x, p.y - 10 - camera.y, 20, 5);
      ctx.fillStyle = 'green';
      ctx.fillRect(p.x - camera.x, p.y - 10 - camera.y, 20 * (p.hp / 3), 5);
      // Draw weapon name
      ctx.fillStyle = 'white';
      ctx.font = '12px Arial';
      ctx.fillText(p.weapon || 'basic', p.x - camera.x, p.y - 15 - camera.y);
    }
  }
  // Draw bullets
  ctx.fillStyle = 'yellow';
  for (const b of bullets) {
    if (!me || isInCone(b.x - camera.x, b.y - camera.y, me, camera)) {
      ctx.beginPath();
      ctx.arc(b.x - camera.x, b.y - camera.y, 5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  // Show weapon info for player
  if (me) {
    let info = '';
    if (me.weapon === 'shotgun') info = 'Shotgun: 3 bullets, 1 dmg, 0.5s cooldown';
    else if (me.weapon === 'sniper') info = 'Sniper: 1 bullet, 3 dmg, 1.5s cooldown';
    else info = 'Rifle: 1 bullet, 1 dmg (3 close), 0.25s cooldown';
    ctx.fillStyle = 'white';
    ctx.font = '16px Arial';
    ctx.fillText(info, 20, canvas.height - 20);
    // Draw torch/vision cone
    drawTorchCone(ctx, me, camera);
  }
}

function gameLoop() {
  sendMovement();
  draw();
  requestAnimationFrame(gameLoop);
}

gameLoop();
