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
let playerDirs = {};
let lastShotTimes = [0, 0];

const keys = {};
let keyHistory = [];

let shootCooldown = 300; // ms for basic gun
let lastShot = 0;

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1500;
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;

// Preload gunshot sound
const gunshotAudio = new Audio('gunshot.wav');
gunshotAudio.volume = 0.5;

document.addEventListener('keydown', (e) => {
  if (!keys[e.key]) keyHistory.push(e.key);
  keys[e.key] = true;
  if (e.key === ' ') {
    const now = Date.now();
    if (now - lastShot >= shootCooldown) {
      socket.send(JSON.stringify({ type: 'shoot', dx: lastDir.dx, dy: lastDir.dy }));
      lastShot = now;
    }
  }
});
document.addEventListener('keyup', (e) => {
  keys[e.key] = false;
  keyHistory = keyHistory.filter(k => k !== e.key);
});

socket.addEventListener('message', (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'init') {
    playerId = data.id;
  } else if (data.type === 'state') {
    // Play gunshot sound if any player shot since last frame
    if (window.lastShotTimesPrev) {
      for (let i = 0; i < data.lastShotTimes?.length; i++) {
        if (data.lastShotTimes[i] && (!window.lastShotTimesPrev[i] || data.lastShotTimes[i] > window.lastShotTimesPrev[i])) {
          // Play a new instance so overlapping shots work
          const s = gunshotAudio.cloneNode();
          s.play();
        }
      }
    }
    window.lastShotTimesPrev = data.lastShotTimes?.slice();
    players = data.players;
    bullets = data.bullets || [];
    scores = data.scores || [0, 0];
    walls = data.walls || [];
    weaponsOnMap = data.weaponsOnMap || [];
    // Store look direction for each player
    if (data.playerDirs) playerDirs = data.playerDirs;
    if (data.lastShotTimes) lastShotTimes = data.lastShotTimes;
  }
});

function getMoveDirection() {
  // Use last two movement keys in keyHistory that are still pressed
  const dirs = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
  let dx = 0, dy = 0;
  // Only consider movement keys
  const movementKeys = keyHistory.filter(k => dirs[k] && keys[k]);
  if (movementKeys.length >= 2) {
    // Use the last two movement keys for diagonal
    const k1 = movementKeys[movementKeys.length - 1];
    const k2 = movementKeys[movementKeys.length - 2];
    dx = dirs[k1][0] + dirs[k2][0];
    dy = dirs[k1][1] + dirs[k2][1];
  } else if (movementKeys.length === 1) {
    dx = dirs[movementKeys[0]][0];
    dy = dirs[movementKeys[0]][1];
  }
  // Normalize for diagonal
  const speed = 2;
  if (dx !== 0 && dy !== 0) {
    const mag = Math.sqrt(dx * dx + dy * dy);
    dx = (dx / mag) * speed;
    dy = (dy / mag) * speed;
  } else {
    dx *= speed;
    dy *= speed;
  }
  return { dx, dy };
}

function sendMovement() {
  const { dx, dy } = getMoveDirection();
  if (dx !== 0 || dy !== 0) {
    lastDir = { dx, dy };
    velocities[playerId] = { dx, dy };
    playerDirs[playerId] = { dx, dy };
    socket.send(JSON.stringify({ type: 'move', dx, dy, look: { dx, dy } }));
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

function raycast(px, py, angle, maxDist, walls) {
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let closest = { x: px + dx * maxDist, y: py + dy * maxDist, dist: maxDist };
  for (const w of walls) {
    // Check intersection with each wall edge
    const edges = [
      [w.x, w.y, w.x + w.w, w.y],
      [w.x + w.w, w.y, w.x + w.w, w.y + w.h],
      [w.x + w.w, w.y + w.h, w.x, w.y + w.h],
      [w.x, w.y + w.h, w.x, w.y]
    ];
    for (const [x1, y1, x2, y2] of edges) {
      const denom = (x1 - x2) * dy - (y1 - y2) * dx;
      if (denom === 0) continue;
      const t = ((x1 - px) * dy - (y1 - py) * dx) / denom;
      const u = -((x1 - x2) * (y1 - py) - (y1 - y2) * (x1 - px)) / denom;
      if (t >= 0 && t <= 1 && u >= 0 && u < closest.dist) {
        const ix = x1 + t * (x2 - x1);
        const iy = y1 + t * (y2 - y1);
        const dist = Math.sqrt((ix - px) ** 2 + (iy - py) ** 2);
        if (dist < closest.dist) {
          closest = { x: ix, y: iy, dist };
        }
      }
    }
  }
  return closest;
}

function drawGrid(ctx, camera) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < MAP_WIDTH; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x - camera.x, 0);
    ctx.lineTo(x - camera.x, CANVAS_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y < MAP_HEIGHT; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y - camera.y);
    ctx.lineTo(CANVAS_WIDTH, y - camera.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTorchCone(ctx, player, camera, dir, alpha = 0.18) {
  const px = player.x + 10;
  const py = player.y + 10;
  let angle = (dir && (dir.dx !== 0 || dir.dy !== 0)) ? Math.atan2(dir.dy, dir.dx) : -Math.PI / 2;
  ctx.save();
  // 1. Draw a slightly darker fog over the whole screen
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  // 2. Add a soft circular ambient light around the player
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'lighter';
  let ambient = ctx.createRadialGradient(px - camera.x, py - camera.y, 0, px - camera.x, py - camera.y, 120);
  ambient.addColorStop(0, 'rgba(255,255,200,0.18)');
  ambient.addColorStop(1, 'rgba(255,255,200,0)');
  ctx.fillStyle = ambient;
  ctx.beginPath();
  ctx.arc(px - camera.x, py - camera.y, 120, 0, 2 * Math.PI);
  ctx.fill();
  // 3. Draw the flashlight cone with a strong gradient
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(px - camera.x, py - camera.y);
  const coneLength = 400;
  const coneAngle = Math.PI / 2; // 90 degrees
  ctx.arc(px - camera.x, py - camera.y, coneLength, angle - coneAngle / 2, angle + coneAngle / 2);
  ctx.lineTo(px - camera.x, py - camera.y);
  ctx.closePath();
  let coneGrad = ctx.createRadialGradient(px - camera.x, py - camera.y, 60, px - camera.x, py - camera.y, coneLength);
  coneGrad.addColorStop(0, 'rgba(255,255,180,0.45)');
  coneGrad.addColorStop(0.5, 'rgba(255,255,180,0.25)');
  coneGrad.addColorStop(1, 'rgba(255,255,180,0)');
  ctx.fillStyle = coneGrad;
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const me = players.find(p => p.id === playerId);
  const camera = me ? getCamera(me) : { x: 0, y: 0 };
  // Draw grid texture
  drawGrid(ctx, camera);
  // Draw walls (always visible)
  ctx.fillStyle = 'gray';
  for (const w of walls) {
    ctx.fillRect(w.x - camera.x, w.y - camera.y, w.w, w.h);
  }
  // --- FOG/FLASHLIGHT OVERLAY ---
  if (me) {
    // Draw opponent's cone first (fainter)
    for (const p of players) {
      if (p.id !== playerId) {
        drawTorchCone(ctx, p, camera, playerDirs[p.id] || { dx: 0, dy: -1 }, 0.08);
      }
    }
    // Draw my cone (brighter)
    drawTorchCone(ctx, me, camera, lastDir, 0.18);
  }
  // Draw weapon pickups (only if in cone)
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
  // Draw players (show if in your cone, or you are in their cone, or they shot in last 5s)
  for (const p of players) {
    if (!velocities[p.id]) velocities[p.id] = { dx: 0, dy: 0 };
    p.x += velocities[p.id].dx * 0.2;
    p.y += velocities[p.id].dy * 0.2;
    const now = Date.now();
    const inMyCone = p.id === playerId || (me && isInCone(p.x + 10 - camera.x, p.y + 10 - camera.y, me, camera));
    const iSeeTheirCone = (p.id !== playerId && me && isInCone(me.x + 10 - camera.x, me.y + 10 - camera.y, p, camera));
    const theyShot = lastShotTimes[p.id] && (now - lastShotTimes[p.id] < 5000);
    if (inMyCone || iSeeTheirCone || theyShot) {
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
  // Draw bullets (always visible)
  for (const b of bullets) {
    if (b.type === 'sniper') {
      ctx.save();
      ctx.translate(b.x - camera.x, b.y - camera.y);
      ctx.rotate(Math.atan2(b.dy, b.dx));
      ctx.fillStyle = 'blue';
      ctx.fillRect(-10, -4, 20, 8);
      ctx.restore();
    } else {
      ctx.fillStyle = 'yellow';
      ctx.beginPath();
      ctx.arc(b.x - camera.x, b.y - camera.y, 5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  // Draw scores and weapon info
  ctx.fillStyle = 'white';
  ctx.font = '20px Arial';
  ctx.fillText(`You: ${scores[playerId] || 0}`, 20, 30);
  ctx.fillText(`Opponent: ${scores[1 - playerId] || 0}`, 450, 30);
  // Removed weapon info text from bottom of screen
}

function gameLoop() {
  sendMovement();
  draw();
  requestAnimationFrame(gameLoop);
}

// Autoplay and loop background music
document.addEventListener('DOMContentLoaded', () => {
  const audio = new Audio('gamemusic.mp3');
  audio.loop = true;
  audio.volume = 0.5;
  audio.play().catch(() => {
    // If autoplay is blocked, try again on user interaction
    const resume = () => {
      audio.play();
      document.removeEventListener('keydown', resume);
      document.removeEventListener('mousedown', resume);
    };
    document.addEventListener('keydown', resume);
    document.addEventListener('mousedown', resume);
  });
});

gameLoop();

