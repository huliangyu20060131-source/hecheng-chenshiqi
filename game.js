(() => {
  "use strict";

  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.querySelector("#score");
  const bestEl = document.querySelector("#best");
  const nextOrb = document.querySelector("#nextOrb");
  const soundButton = document.querySelector("#soundButton");
  const restartButton = document.querySelector("#restartButton");
  const againButton = document.querySelector("#againButton");
  const gameOverEl = document.querySelector("#gameOver");
  const finalScoreEl = document.querySelector("#finalScore");

  const W = 420;
  const H = 700;
  const WALL = 11;
  const DANGER_Y = 132;
  const DROP_Y = 68;
  const STEP = 1 / 120;
  const GRAVITY = 1900;
  const RADII = [18, 23, 29, 36, 44, 53, 63, 74, 87];
  const POINTS = [2, 5, 10, 18, 30, 48, 75, 115, 180];
  const LOOKS = [
    ["#ffb398", "#f26f72", "●"],
    ["#ffd36c", "#f2a13b", "◆"],
    ["#bde47c", "#6ebd66", "✦"],
    ["#7edddd", "#45aebd", "★"],
    ["#8ebcf4", "#667bd8", "☀"],
    ["#c4a6f5", "#8e67d2", "✿"],
    ["#f0a6dc", "#ca6bab", "☾"],
    ["#ff9fbe", "#ef557c", "♛"],
    ["#ffc268", "#f05e53", "∞"]
  ];
  const ORB_SOURCES = LOOKS.map((_, index) => `assets/${String(index + 1).padStart(2, "0")}.png`);
  const ORB_IMAGES = ORB_SOURCES.map(source => {
    const image = new Image();
    image.onload = updateHud;
    image.onerror = updateHud;
    image.src = source;
    return image;
  });

  let balls = [];
  let particles = [];
  let idSeed = 1;
  let currentTier = randomTier();
  let nextTier = randomTier();
  let aimX = W / 2;
  let score = 0;
  let best = Number(localStorage.getItem("merge-pals.best")) || 0;
  let soundOn = localStorage.getItem("merge-pals.sound") !== "off";
  let running = true;
  let dragging = false;
  let dropReadyAt = 0;
  let audioContext = null;
  let lastTime = performance.now();
  let accumulator = 0;

  function randomTier() {
    const value = Math.random();
    return value < .46 ? 0 : value < .78 ? 1 : value < .94 ? 2 : 3;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(tier, x, y, vx = 0, vy = 0) {
    return {
      id: idSeed++, tier, x, y, vx, vy,
      r: RADII[tier], angle: 0, spin: 0,
      age: 0, danger: 0
    };
  }

  function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
    const [c1, c2, mark] = LOOKS[nextTier];
    const hasImage = ORB_IMAGES[nextTier].complete && ORB_IMAGES[nextTier].naturalWidth > 0;
    nextOrb.style.setProperty("--orb1", c1);
    nextOrb.style.setProperty("--orb2", c2);
    nextOrb.style.backgroundImage = hasImage ? `url("${ORB_SOURCES[nextTier]}")` : "";
    nextOrb.classList.toggle("has-image", hasImage);
    nextOrb.querySelector("b").textContent = mark;
    soundButton.textContent = `声音：${soundOn ? "开" : "关"}`;
  }

  function setScore(value) {
    score = value;
    if (score > best) {
      best = score;
      localStorage.setItem("merge-pals.best", String(best));
    }
    updateHud();
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) audioContext = new AudioCtx();
    }
    if (audioContext?.state === "suspended") audioContext.resume();
  }

  function tone(frequency, duration = .07, volume = .035) {
    if (!soundOn) return;
    ensureAudio();
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.13, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  function drop() {
    const now = performance.now();
    if (!running || now < dropReadyAt) return;
    const r = RADII[currentTier];
    aimX = clamp(aimX, WALL + r, W - WALL - r);
    balls.push(spawn(currentTier, aimX, DROP_Y));
    tone(220, .045, .022);
    currentTier = nextTier;
    nextTier = randomTier();
    aimX = clamp(aimX, WALL + RADII[currentTier], W - WALL - RADII[currentTier]);
    dropReadyAt = now + 360;
    updateHud();
  }

  function resolveWalls(ball) {
    const floor = H - WALL;
    if (ball.x - ball.r < WALL) {
      ball.x = WALL + ball.r;
      if (ball.vx < 0) ball.vx *= -.42;
    } else if (ball.x + ball.r > W - WALL) {
      ball.x = W - WALL - ball.r;
      if (ball.vx > 0) ball.vx *= -.42;
    }
    if (ball.y + ball.r > floor) {
      ball.y = floor - ball.r;
      if (ball.vy > 0) ball.vy *= -.31;
      if (Math.abs(ball.vy) < 24) ball.vy = 0;
      ball.vx *= .965;
    }
  }

  function resolvePair(a, b) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let distance = Math.hypot(dx, dy);
    const minDistance = a.r + b.r;
    if (distance >= minDistance) return false;
    if (distance < .001) {
      dx = .001;
      dy = 0;
      distance = .001;
    }

    const nx = dx / distance;
    const ny = dy / distance;
    const invA = 1 / (a.r * a.r);
    const invB = 1 / (b.r * b.r);
    const invSum = invA + invB;
    const correction = minDistance - distance;
    a.x -= nx * correction * invA / invSum;
    a.y -= ny * correction * invA / invSum;
    b.x += nx * correction * invB / invSum;
    b.y += ny * correction * invB / invSum;

    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const normalSpeed = rvx * nx + rvy * ny;
    if (normalSpeed < 0) {
      const restitution = Math.abs(normalSpeed) > 80 ? .28 : 0;
      const impulse = -(1 + restitution) * normalSpeed / invSum;
      a.vx -= impulse * nx * invA;
      a.vy -= impulse * ny * invA;
      b.vx += impulse * nx * invB;
      b.vy += impulse * ny * invB;

      const tx = -ny;
      const ty = nx;
      const tangentSpeed = rvx * tx + rvy * ty;
      const friction = tangentSpeed * .06 / invSum;
      a.vx += friction * tx * invA;
      a.vy += friction * ty * invA;
      b.vx -= friction * tx * invB;
      b.vy -= friction * ty * invB;
    }
    return true;
  }

  function burst(x, y, tier) {
    const color = LOOKS[tier][0];
    for (let i = 0; i < 10; i++) {
      const angle = Math.PI * 2 * i / 10 + Math.random() * .25;
      const speed = 70 + Math.random() * 115;
      particles.push({
        x, y, color,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 35,
        life: .45 + Math.random() * .25,
        size: 3 + Math.random() * 4
      });
    }
  }

  function physicsStep(dt) {
    for (const ball of balls) {
      ball.age += dt;
      ball.vy += GRAVITY * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.vx *= .9992;
      ball.spin = ball.vx / Math.max(ball.r, 1);
      ball.angle += ball.spin * dt;
      resolveWalls(ball);
    }

    const claimed = new Set();
    const merges = [];
    for (let pass = 0; pass < 5; pass++) {
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const a = balls[i];
          const b = balls[j];
          if (claimed.has(a.id) || claimed.has(b.id)) continue;
          const touching = Math.hypot(b.x - a.x, b.y - a.y) < a.r + b.r;
          if (touching && a.tier === b.tier) {
            claimed.add(a.id);
            claimed.add(b.id);
            merges.push([a, b]);
            continue;
          }
          resolvePair(a, b);
        }
      }
      for (const ball of balls) resolveWalls(ball);
    }

    if (merges.length) {
      const removed = new Set();
      for (const [a, b] of merges) {
        removed.add(a.id);
        removed.add(b.id);
        const x = (a.x + b.x) / 2;
        const y = (a.y + b.y) / 2;
        burst(x, y, a.tier);
        if (a.tier === RADII.length - 1) {
          setScore(score + 300);
          tone(720, .17, .05);
        } else {
          const tier = a.tier + 1;
          const merged = spawn(tier, x, y, (a.vx + b.vx) / 2, (a.vy + b.vy) / 2 - 55);
          merged.age = .25;
          balls.push(merged);
          setScore(score + POINTS[tier]);
          tone(300 + tier * 55, .085, .035);
        }
      }
      balls = balls.filter(ball => !removed.has(ball.id));
    }

    for (const ball of balls) {
      const slow = Math.hypot(ball.vx, ball.vy) < 68;
      const overLine = ball.y - ball.r < DANGER_Y;
      if (ball.age > .7 && slow && overLine) ball.danger += dt;
      else ball.danger = Math.max(0, ball.danger - dt * 2.2);
      if (ball.danger > 1.45) endGame();
    }
  }

  function updateParticles(dt) {
    for (const particle of particles) {
      particle.life -= dt;
      particle.vy += 420 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
    particles = particles.filter(particle => particle.life > 0);
  }

  function drawOrb(x, y, r, tier, angle = 0, alpha = 1) {
    const [c1, c2, mark] = LOOKS[tier];
    const image = ORB_IMAGES[tier];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.shadowColor = "rgba(75, 46, 55, .18)";
    ctx.shadowBlur = Math.max(6, r * .18);
    ctx.shadowOffsetY = Math.max(3, r * .08);
    if (image.complete && image.naturalWidth > 0) {
      const scale = Math.min(r * 2 / image.naturalWidth, r * 2 / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
      ctx.restore();
      return;
    }
    const gradient = ctx.createRadialGradient(-r * .35, -r * .42, r * .08, 0, 0, r * 1.05);
    gradient.addColorStop(0, c1);
    gradient.addColorStop(1, c2);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(255,255,255,.72)";
    ctx.lineWidth = Math.max(2, r * .055);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,.93)";
    ctx.font = `800 ${Math.max(12, r * .52)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(mark, 0, 1);

    const eyeY = -r * .25;
    const eyeX = r * .31;
    ctx.fillStyle = "rgba(67,48,57,.78)";
    ctx.beginPath();
    ctx.arc(-eyeX, eyeY, Math.max(1.5, r * .052), 0, Math.PI * 2);
    ctx.arc(eyeX, eyeY, Math.max(1.5, r * .052), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render(now) {
    ctx.clearRect(0, 0, W, H);
    const background = ctx.createLinearGradient(0, 0, 0, H);
    background.addColorStop(0, "#fffaf0");
    background.addColorStop(1, "#fff1e2");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(255,255,255,.38)";
    for (let y = 175; y < H; y += 54) {
      for (let x = 35 + (y % 108 ? 22 : 0); x < W; x += 70) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = "rgba(224, 98, 105, .5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WALL + 6, DANGER_Y);
    ctx.lineTo(W - WALL - 6, DANGER_Y);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "rgba(190, 78, 88, .72)";
    ctx.font = "700 12px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("警戒线", 22, DANGER_Y - 10);

    const currentR = RADII[currentTier];
    ctx.save();
    ctx.setLineDash([5, 8]);
    ctx.strokeStyle = "rgba(108, 87, 95, .2)";
    ctx.beginPath();
    ctx.moveTo(aimX, DROP_Y + currentR + 9);
    ctx.lineTo(aimX, H - 25);
    ctx.stroke();
    ctx.restore();
    drawOrb(aimX, DROP_Y, currentR, currentTier, 0, now < dropReadyAt ? .38 : .96);

    for (const ball of balls) {
      drawOrb(ball.x, ball.y, ball.r, ball.tier, ball.angle);
      if (ball.danger > 0) {
        ctx.strokeStyle = `rgba(224, 71, 75, ${.2 + ball.danger / 2})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ball.danger / 1.45);
        ctx.stroke();
      }
    }

    for (const particle of particles) {
      ctx.globalAlpha = clamp(particle.life * 2, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function endGame() {
    if (!running) return;
    running = false;
    finalScoreEl.textContent = score;
    gameOverEl.hidden = false;
    tone(135, .28, .045);
  }

  function reset() {
    balls = [];
    particles = [];
    currentTier = randomTier();
    nextTier = randomTier();
    aimX = W / 2;
    running = true;
    dragging = false;
    dropReadyAt = 0;
    gameOverEl.hidden = true;
    setScore(0);
    lastTime = performance.now();
    accumulator = 0;
  }

  function setAim(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * W;
    const r = RADII[currentTier];
    aimX = clamp(x, WALL + r, W - WALL - r);
  }

  canvas.addEventListener("pointerdown", event => {
    dragging = true;
    setAim(event);
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (dragging || event.pointerType === "mouse") setAim(event);
  });
  canvas.addEventListener("pointerup", event => {
    if (!dragging) return;
    setAim(event);
    dragging = false;
    drop();
  });
  canvas.addEventListener("pointercancel", () => { dragging = false; });

  window.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const r = RADII[currentTier];
      aimX = clamp(aimX + direction * 15, WALL + r, W - WALL - r);
    } else if (event.code === "Space" || event.key === "Enter") {
      event.preventDefault();
      drop();
    } else if (event.key.toLowerCase() === "r") {
      reset();
    }
  });

  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    localStorage.setItem("merge-pals.sound", soundOn ? "on" : "off");
    if (soundOn) tone(420);
    updateHud();
  });
  restartButton.addEventListener("click", reset);
  againButton.addEventListener("click", reset);
  window.addEventListener("resize", resizeCanvas);

  function frame(now) {
    const elapsed = Math.min((now - lastTime) / 1000, .035);
    lastTime = now;
    if (running) {
      accumulator += elapsed;
      while (accumulator >= STEP) {
        physicsStep(STEP);
        accumulator -= STEP;
      }
    }
    updateParticles(elapsed);
    render(now);
    requestAnimationFrame(frame);
  }

  resizeCanvas();
  updateHud();
  requestAnimationFrame(frame);
})();
