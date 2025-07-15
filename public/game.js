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
let powerupsOnMap = [];
let activePowerups = [{}, {}];

const keys = {};
let keyHistory = [];
let movementKeysDown = new Set();
let movementKeyOrder = [];
let lastDiagonal = null;
let diagonalTimer = null;

let shootCooldown = 300; // ms for basic gun
let lastShot = 0;

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1500;
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 900;
const VIEW_WIDTH = 750;
const VIEW_HEIGHT = 750;
const ZOOM = CANVAS_WIDTH / VIEW_WIDTH; // 1.5

// Preload gunshot sound
const gunshotAudio = new Audio('gunshot.wav');
gunshotAudio.volume = 0.5;

document.addEventListener('keydown', (e) => {
  if (!keys[e.key]) keyHistory.push(e.key);
  keys[e.key] = true;
  if (['w','a','s','d'].includes(e.key)) {
    // Remove if already present, then push to end
    movementKeyOrder = movementKeyOrder.filter(k => k !== e.key);
    movementKeyOrder.push(e.key);
    // If a diagonal was held, cancel the grace timer
    if (diagonalTimer) {
      clearTimeout(diagonalTimer);
      diagonalTimer = null;
    }
  }
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
  if (['w','a','s','d'].includes(e.key)) {
    movementKeyOrder = movementKeyOrder.filter(k => k !== e.key);
    // If we just went from 2+ keys to 1, start the sticky diagonal timer
    const active = movementKeyOrder.filter(k => keys[k]);
    if (active.length === 1 && lastDiagonal) {
      if (diagonalTimer) clearTimeout(diagonalTimer);
      diagonalTimer = setTimeout(() => {
        lastDiagonal = null;
        diagonalTimer = null;
      }, 120);
    }
  }
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
    if (data.powerupsOnMap) powerupsOnMap = data.powerupsOnMap;
    if (data.activePowerups) activePowerups = data.activePowerups;
  }
});

function getPlayerSpeed() {
  const me = players.find(p => p.id === playerId);
  const ap = activePowerups[playerId] || {};
  if (ap.type === 'speed' && ap.expires > Date.now()) return 2.5;
  return 2;
}

function getMoveDirection() {
  // Use the last two pressed movement keys that are still held
  const dirs = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
  let dx = 0, dy = 0;
  const active = movementKeyOrder.filter(k => keys[k]);
  if (active.length >= 2) {
    const k1 = active[active.length - 1];
    const k2 = active[active.length - 2];
    dx = dirs[k1][0] + dirs[k2][0];
    dy = dirs[k1][1] + dirs[k2][1];
    lastDiagonal = { dx, dy };
    if (diagonalTimer) {
      clearTimeout(diagonalTimer);
      diagonalTimer = null;
    }
  } else if (active.length === 1 && lastDiagonal) {
    // Sticky diagonal grace period
    dx = lastDiagonal.dx;
    dy = lastDiagonal.dy;
  } else if (active.length === 1) {
    dx = dirs[active[0]][0];
    dy = dirs[active[0]][1];
    lastDiagonal = null;
  } else {
    lastDiagonal = null;
  }
  // Normalize for diagonal
  const speed = getPlayerSpeed();
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
  let camX = player.x + 10 - VIEW_WIDTH / 2;
  let camY = player.y + 10 - VIEW_HEIGHT / 2;
  camX = Math.max(0, Math.min(MAP_WIDTH - VIEW_WIDTH, camX));
  camY = Math.max(0, Math.min(MAP_HEIGHT - VIEW_HEIGHT, camY));
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

function raycastToWall(px, py, angle, maxDist, walls, camera) {
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let x = px, y = py;
  for (let t = 0; t < maxDist; t += 2) {
    let hit = false;
    for (const w of walls) {
      if (x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h) {
        hit = true;
        break;
      }
    }
    if (hit) break;
    x += dx * 2;
    y += dy * 2;
  }
  return { x, y };
}

function lineOfSight(x1, y1, x2, y2, walls) {
  // Step along the line in small increments and check for wall collision
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 4);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    for (const w of walls) {
      if (x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h) {
        return false;
      }
    }
  }
  return true;
}

function isIlluminated(x, y, me, camera, walls) {
  return isInCone(x - camera.x, y - camera.y, me, camera) && lineOfSight(me.x + 10, me.y + 10, x, y, walls);
}

function isWallIlluminated(w, me, camera, walls) {
  // Check all four corners and the center
  const points = [
    [w.x, w.y],
    [w.x + w.w, w.y],
    [w.x, w.y + w.h],
    [w.x + w.w, w.y + w.h],
    [w.x + w.w / 2, w.y + w.h / 2]
  ];
  return points.some(([x, y]) => isIlluminated(x, y, me, camera, walls));
}

function drawGrid(ctx, camera, me, walls) {
  ctx.save();
  for (let x = 0; x < MAP_WIDTH; x += 40) {
    const illuminated = me && isIlluminated(x, camera.y + CANVAS_HEIGHT / 2, me, camera, walls);
    ctx.strokeStyle = illuminated ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - camera.x, 0);
    ctx.lineTo(x - camera.x, CANVAS_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y < MAP_HEIGHT; y += 40) {
    const illuminated = me && isIlluminated(camera.x + CANVAS_WIDTH / 2, y, me, camera, walls);
    ctx.strokeStyle = illuminated ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y - camera.y);
    ctx.lineTo(CANVAS_WIDTH, y - camera.y);
    ctx.stroke();
  }
  ctx.restore();
}

let torchMultiplier = 1;

function drawTorchCone(ctx, player, camera, dir, alpha = 0.18, useRaycast = false, customMultiplier) {
  const px = player.x + 10;
  const py = player.y + 10;
  let angle = (dir && (dir.dx !== 0 || dir.dy !== 0)) ? Math.atan2(dir.dy, dir.dx) : -Math.PI / 2;
  ctx.save();
  // 1. Draw a slightly darker fog over the whole screen
  let nightvision = false;
  if (player.id === playerId) {
    const ap = activePowerups[playerId] || {};
    if (ap.type === 'nightvision' && ap.expires > Date.now()) nightvision = true;
    if (ap.type === 'torch' && ap.expires > Date.now()) torchMultiplier = 1.35;
    else torchMultiplier = 1;
  }
  if (nightvision) {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = 'rgba(255,255,200,0.7)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.restore();
    return;
  }
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
  // 3. Draw the flashlight cone with a strong gradient, using raycasting if requested
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(px - camera.x, py - camera.y);
  const baseLength = 400 * 0.7; // 30% shorter
  const coneLength = baseLength * (customMultiplier || torchMultiplier);
  const coneAngle = Math.PI / 2; // 90 degrees
  if (useRaycast) {
    const rays = 100;
    for (let i = 0; i <= rays; i++) {
      const a = angle - coneAngle / 2 + (coneAngle * i) / rays;
      const hit = raycastToWall(px, py, a, coneLength, walls, camera);
      ctx.lineTo(hit.x - camera.x, hit.y - camera.y);
    }
  } else {
    ctx.arc(px - camera.x, py - camera.y, coneLength, angle - coneAngle / 2, angle + coneAngle / 2);
  }
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
  // 4. Draw all walls again as a dark overlay to block the torch light
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  for (const w of walls) {
    ctx.fillRect(w.x - camera.x, w.y - camera.y, w.w, w.h);
  }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(ZOOM, ZOOM);
  const me = players.find(p => p.id === playerId);
  const camera = me ? getCamera(me) : { x: 0, y: 0 };
  // Draw illuminated grid texture
  drawGrid(ctx, camera, me, walls);
  // Draw walls (illuminated if any corner or center is in torch cone and line of sight)
  for (const w of walls) {
    const illuminated = me && isWallIlluminated(w, me, camera, walls);
    ctx.fillStyle = illuminated ? '#b0b0b0' : 'rgba(40,40,40,0.85)';
    ctx.fillRect(w.x - camera.x, w.y - camera.y, w.w, w.h);
  }
  // Draw powerup pickups with label
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  for (const p of powerupsOnMap) {
    let color = 'purple';
    if (p.type === 'torch') color = 'gold';
    if (p.type === 'speed') color = 'lime';
    if (p.type === 'nightvision') color = 'cyan';
    // Draw a glowing circle with a thick outline
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(p.x - camera.x, p.y - camera.y, 16, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'white';
    ctx.stroke();
    ctx.restore();
    // Draw large, bold label with shadow
    ctx.save();
    ctx.font = 'bold 20px Arial';
    ctx.fillStyle = color;
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 6;
    ctx.fillText(p.label, p.x - camera.x, p.y - camera.y + 34);
    ctx.restore();
  }
  // --- FOG/FLASHLIGHT OVERLAY ---
  if (me) {
    // Draw opponent's cone first (fainter, no raycast)
    for (const p of players) {
      if (p.id !== playerId) {
        drawTorchCone(ctx, p, camera, playerDirs[p.id] || { dx: 0, dy: -1 }, 0.08, false);
      }
    }
    // Draw my cone (brighter, with raycast)
    drawTorchCone(ctx, me, camera, lastDir, 0.18, true);
  }
  // Draw weapon pickups (only if in cone and line of sight)
  for (const w of weaponsOnMap) {
    if (!me) continue;
    const wx = w.x;
    const wy = w.y;
    if (isInCone(wx - camera.x, wy - camera.y, me, camera) && lineOfSight(me.x + 10, me.y + 10, wx, wy, walls)) {
      let color, label;
      if (w.type === 'shotgun') {
        color = 'orange';
        label = 'SHOTGUN';
      } else if (w.type === 'sniper') {
        color = 'blue';
        label = 'SNIPER';
      }
      // Draw a glowing square with a thick outline
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(w.x - 14 - camera.x, w.y - 14 - camera.y, 28, 28);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'white';
      ctx.strokeRect(w.x - 14 - camera.x, w.y - 14 - camera.y, 28, 28);
      ctx.restore();
      // Draw large, bold label with shadow
      ctx.save();
      ctx.font = 'bold 20px Arial';
      ctx.fillStyle = color;
      ctx.shadowColor = 'black';
      ctx.shadowBlur = 6;
      ctx.fillText(label, w.x - camera.x, w.y + 34 - camera.y);
      ctx.restore();
    }
  }
  // Draw players (show if in your cone and line of sight, or you are in their cone and line of sight, or they shot in last 5s)
  for (const p of players) {
    if (!velocities[p.id]) velocities[p.id] = { dx: 0, dy: 0 };
    p.x += velocities[p.id].dx * 0.2;
    p.y += velocities[p.id].dy * 0.2;
    const now = Date.now();
    const px = p.x + 10, py = p.y + 10;
    const mx = me ? me.x + 10 : 0, my = me ? me.y + 10 : 0;
    const inMyCone = p.id === playerId || (me && isInCone(px - camera.x, py - camera.y, me, camera) && lineOfSight(mx, my, px, py, walls));
    const iSeeTheirCone = (p.id !== playerId && me && isInCone(mx - camera.x, my - camera.y, p, camera) && lineOfSight(px, py, mx, my, walls));
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
  // Draw active weapon and powerup at bottom of screen with timer bars
  const ap = activePowerups[playerId] || {};
  let weaponLabel = me && me.weapon && me.weapon !== 'basic' ? me.weapon.toUpperCase() : null;
  let weaponExpires = me && me.weaponExpires && me.weaponExpires > Date.now() ? me.weaponExpires : null;
  let showBar = false;
  let barY = CANVAS_HEIGHT / ZOOM - 80;
  if (weaponLabel && weaponExpires) {
    showBar = true;
    const timeLeft = Math.max(0, weaponExpires - Date.now());
    const barWidth = 260;
    const barHeight = 22;
    const x = (CANVAS_WIDTH / ZOOM - barWidth) / 2;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#222';
    ctx.fillRect(x, barY, barWidth, barHeight);
    ctx.fillStyle = weaponLabel === 'SHOTGUN' ? 'orange' : weaponLabel === 'SNIPER' ? 'blue' : 'gray';
    ctx.fillRect(x, barY, barWidth * (timeLeft / 30000), barHeight);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, barY, barWidth, barHeight);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 6;
    ctx.fillText(weaponLabel, x + barWidth / 2, barY + barHeight - 5);
    ctx.restore();
  }
  // Powerup bar (draw below weapon bar if both)
  if (ap.type && ap.expires > Date.now()) {
    const timeLeft = Math.max(0, ap.expires - Date.now());
    const barWidth = 260;
    const barHeight = 22;
    const x = (CANVAS_WIDTH / ZOOM - barWidth) / 2;
    let y = barY + (showBar ? 32 : 0);
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#222';
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = ap.type === 'torch' ? 'gold' : ap.type === 'speed' ? 'lime' : ap.type === 'nightvision' ? 'cyan' : 'gray';
    ctx.fillRect(x, y, barWidth * (timeLeft / 15000), barHeight);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, barWidth, barHeight);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 6;
    ctx.fillText(ap.label, x + barWidth / 2, y + barHeight - 5);
    ctx.restore();
  }
  ctx.restore();
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

