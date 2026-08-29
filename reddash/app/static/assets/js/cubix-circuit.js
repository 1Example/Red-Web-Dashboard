/*
 * Animated circuit-board background.
 *
 * Descended from https://codepen.io/alexandrix/pen/oQOvYp ("spipa" by Alex
 * Andrix), rewritten for use as a persistent site backdrop. Three things about
 * the original made it unsuitable, all fixed here:
 *
 *   1. Every grid cell was scored by distance to centre, peaking at r = 100, so
 *      all walkers climbed toward that one radius and the effect collapsed into
 *      a ring. There is no field at all now - routing comes from a per-walker
 *      heading, which spreads evenly over the whole viewport.
 *   2. Walkers were sprung toward a wandering attractor, which rounded every
 *      corner into a curve and let them double back into knots. They now step
 *      cell to cell at constant speed on a held heading that can turn 90 degrees
 *      but never reverse, giving long straight runs and hard corners.
 *   3. The canvas was faded with rgba(0,0,0,0.1) per frame, which cannot reach
 *      zero in 8-bit - round(3 * 0.9) === 3 - so every pixel a trace ever
 *      touched stayed lit at about rgb(1,1,1) forever, leaving grey ghosts of
 *      the whole history. Each frame now starts from a hard fillRect and the
 *      visible structure is rebuilt from bounded trails, so nothing persists.
 *
 * Also dropped the lodash dependency (the original deep-cloned the entire
 * particle array on every death) and bucketed the per-frame strokes by alpha,
 * so a frame is a couple of dozen stroke calls rather than thousands.
 *
 * Like the star field it replaced (cubix-stars.css, since deleted), this
 * deliberately does NOT honour prefers-reduced-motion: it is a decorative
 * background that was explicitly asked to be animated, and the opt-out silently
 * disabled it for anyone with Windows animation effects turned off. It does
 * stop on a hidden tab.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("cx-circuit");
  if (!canvas || !canvas.getContext) {
    return;
  }

  var CONFIG = {
    // palette - background matches --cx-bg so the layer is seamless
    background: "#101010",
    trace: "#8fe3ff", // bright pulse core
    glow: "#2fa8ff", // soft halo under the pulse
    board: "#12405c", // static etched traces
    pad: "#1d5d80", // solder pads / vias

    cell: 14, // grid pitch in px; everything snaps to this
    maxPop: 80, // live walkers - kept calm, this sits behind a UI
    popPerBirth: 4,
    lifespan: 420, // frames before a walker dies
    speed: 0.12, // cells advanced per frame
    trailCells: 24, // trail length in cells -> also the fade window
    straightBias: 8, // how strongly a walker prefers to carry straight on
    boardAlpha: 0.8, // opacity of the static PCB layer
    traceWidth: 1.4,
    buckets: 16 // alpha quantisation (perf: strokes per frame)
  };

  var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  var ctx = canvas.getContext("2d");
  var rgbTrace = hexToRgb(CONFIG.trace);
  var rgbGlow = hexToRgb(CONFIG.glow);

  var width = 0;
  var height = 0;
  var dpr = 1;
  var cols = 0;
  var rows = 0;
  var grid = [];
  var board = null;
  var particles = [];
  var stepCount = 0;
  var rafId = null;
  var resizeTimer = null;
  var ready = false;

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(c, a) {
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }

  /* Grid spans the whole viewport and carries no field - see note 1 above. */
  function buildGrid() {
    grid = new Array(cols * rows);
    for (var i = 0; i < grid.length; i++) {
      grid[i] = 0; // busyAge
    }
  }

  /* Static etched substrate, rendered once per resize onto its own canvas. */
  function buildBoard() {
    board = document.createElement("canvas");
    board.width = canvas.width;
    board.height = canvas.height;

    var c = board.getContext("2d");
    c.scale(dpr, dpr);
    c.lineCap = "square";
    c.lineJoin = "miter";

    // one seed per fixed area of screen -> even coverage, no clustering
    var seeds = Math.round((cols * rows) / 30);

    for (var s = 0; s < seeds; s++) {
      var gx = (Math.random() * cols) | 0;
      var gy = (Math.random() * rows) | 0;
      var d = (Math.random() * 4) | 0;
      var steps = 6 + ((Math.random() * 24) | 0);
      var pts = [[gx, gy]];

      for (var k = 0; k < steps; k++) {
        if (Math.random() < 0.2) {
          d = (d + (Math.random() < 0.5 ? 1 : 3)) & 3;
        }
        gx += DIRS[d][0];
        gy += DIRS[d][1];
        if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) break;
        pts.push([gx, gy]);
      }
      if (pts.length < 2) continue;

      c.strokeStyle = CONFIG.board;
      c.globalAlpha = 0.25 + Math.random() * 0.55;
      c.lineWidth = Math.random() < 0.18 ? 2.4 : 1;
      c.beginPath();
      c.moveTo(pts[0][0] * CONFIG.cell, pts[0][1] * CONFIG.cell);
      for (var j = 1; j < pts.length; j++) {
        c.lineTo(pts[j][0] * CONFIG.cell, pts[j][1] * CONFIG.cell);
      }
      c.stroke();

      c.fillStyle = CONFIG.pad;
      var ends = [pts[0], pts[pts.length - 1]];
      for (var e = 0; e < 2; e++) {
        c.beginPath();
        c.arc(ends[e][0] * CONFIG.cell, ends[e][1] * CONFIG.cell, 2.1, 0, 6.2832);
        c.fill();
      }
    }

    c.globalAlpha = 0.5;
    c.fillStyle = CONFIG.pad;
    var vias = Math.round((cols * rows) / 45);
    for (var v = 0; v < vias; v++) {
      c.beginPath();
      c.arc(
        ((Math.random() * cols) | 0) * CONFIG.cell,
        ((Math.random() * rows) | 0) * CONFIG.cell,
        1.4,
        0,
        6.2832
      );
      c.fill();
    }

    c.globalAlpha = 1;
  }

  function birth() {
    var xi = (Math.random() * cols) | 0;
    var yi = (Math.random() * rows) | 0;

    particles.push({
      xi: xi,
      yi: yi,
      dir: (Math.random() * 4) | 0,
      t: 0, // progress toward the next cell
      speed: CONFIG.speed * (0.6 + Math.random() * 0.9),
      age: 0,
      dead: false,
      hx: xi * CONFIG.cell, // interpolated head, in px
      hy: yi * CONFIG.cell,
      trail: [xi * CONFIG.cell, yi * CONFIG.cell] // committed cells, [x0,y0,...]
    });
  }

  /* Weighted pick of the next heading: mostly straight on, otherwise 90 deg. */
  function pickDir(p) {
    var order = Math.random() < 0.5 ? [0, 1, 3] : [0, 3, 1]; // ahead, then turns
    var weights = [CONFIG.straightBias, 1, 1];
    var r = Math.random() * (weights[0] + weights[1] + weights[2]);

    for (var i = 0; i < 3; i++) {
      r -= weights[i];
      if (r <= 0) return (p.dir + order[i]) & 3; // never index 2 -> never reverse
    }
    return p.dir;
  }

  function move() {
    var maxTrail = CONFIG.trailCells * 2;
    var cell = CONFIG.cell;

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.t += p.speed;

      while (p.t >= 1) {
        p.t -= 1;

        // commit the step we were interpolating along
        p.xi += DIRS[p.dir][0];
        p.yi += DIRS[p.dir][1];

        if (p.xi < 0 || p.yi < 0 || p.xi >= cols || p.yi >= rows) {
          p.dead = true;
          break;
        }

        p.trail.push(p.xi * cell, p.yi * cell);
        if (p.trail.length > maxTrail) {
          p.trail.splice(0, p.trail.length - maxTrail);
        }

        grid[p.xi * rows + p.yi] = 1;

        // choose the next heading, retrying if the target cell is still busy
        var chosen = -1;
        for (var attempt = 0; attempt < 4; attempt++) {
          var d = pickDir(p);
          var nx = p.xi + DIRS[d][0];
          var ny = p.yi + DIRS[d][1];

          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;

          var busyAge = grid[nx * rows + ny];
          if (busyAge === 0 || busyAge > 40) {
            chosen = d;
            break;
          }
        }

        if (chosen === -1) {
          p.dead = true; // boxed in
          break;
        }
        p.dir = chosen;
      }

      if (p.dead) continue;

      p.hx = (p.xi + DIRS[p.dir][0] * p.t) * cell;
      p.hy = (p.yi + DIRS[p.dir][1] * p.t) * cell;

      p.age++;
      if (p.age > CONFIG.lifespan) p.dead = true;
    }

    // sweep the dead in one pass (the original deep-cloned the whole array)
    var alive = [];
    for (var k = 0; k < particles.length; k++) {
      if (!particles[k].dead) alive.push(particles[k]);
    }
    particles = alive;
  }

  /* Hard clear every frame - see note 3 above. Nothing can persist. */
  function draw() {
    var B = CONFIG.buckets;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CONFIG.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    if (board && board.width > 0 && board.height > 0) {
      ctx.globalAlpha = CONFIG.boardAlpha;
      ctx.drawImage(board, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    // group segments into alpha buckets so a frame is a handful of strokes
    var paths = new Array(B);
    for (var b = 0; b < B; b++) {
      paths[b] = new Path2D();
    }
    var heads = new Path2D();
    var any = false;

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var t = p.trail;
      var n = t.length >> 1; // committed cell points
      if (n < 1) continue;
      any = true;

      // fade in on birth, out on death
      var life =
        Math.min(1, p.age / 25) * Math.min(1, (CONFIG.lifespan - p.age) / 60);

      // n segments: the committed ones, then the last cell out to the live head
      for (var s = 0; s < n; s++) {
        var f = (s + 1) / n; // 0 tail -> 1 head
        var a = f * f * life;
        if (a <= 0.02) continue;
        var bi = Math.min(B - 1, (a * B) | 0);
        paths[bi].moveTo(t[s * 2], t[s * 2 + 1]);
        if (s + 1 < n) paths[bi].lineTo(t[s * 2 + 2], t[s * 2 + 3]);
        else paths[bi].lineTo(p.hx, p.hy);
      }

      heads.moveTo(p.hx + 1.4, p.hy);
      heads.arc(p.hx, p.hy, 1.4, 0, 6.2832);
    }

    if (!any) return;

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // halo pass
    ctx.lineWidth = CONFIG.traceWidth * 3.4;
    for (var g1 = 0; g1 < B; g1++) {
      ctx.strokeStyle = rgba(rgbGlow, ((g1 + 1) / B) * 0.16);
      ctx.stroke(paths[g1]);
    }

    // core pass
    ctx.lineWidth = CONFIG.traceWidth;
    for (var g2 = 0; g2 < B; g2++) {
      ctx.strokeStyle = rgba(rgbTrace, ((g2 + 1) / B) * 0.9);
      ctx.stroke(paths[g2]);
    }

    ctx.fillStyle = rgba(rgbTrace, 0.95);
    ctx.fill(heads);

    ctx.globalCompositeOperation = "source-over";
  }

  function step() {
    // Re-arm first: a throw further down must not be able to kill the loop for
    // the life of the page.
    rafId = window.requestAnimationFrame(step);

    // The element can be laid out after this script parses, in which case the
    // first sizing pass found 0x0 and there is nothing to draw on yet. Keep
    // retrying - this is cheap, and it self-heals without needing a resize
    // event, which does not always arrive.
    if (!ready) {
      resize();
      return;
    }

    stepCount++;

    // age the busy marks so trails can be crossed again later
    for (var g = 0; g < grid.length; g++) {
      if (grid[g] > 0) grid[g]++;
    }

    if (particles.length + CONFIG.popPerBirth < CONFIG.maxPop) {
      for (var n = 0; n < CONFIG.popPerBirth; n++) birth();
    }

    move();
    draw();
  }

  function resize() {
    // Prefer the element's own box: it is fixed at 100%/100%, so this tracks the
    // viewport, but it is also correct before the window reports a size.
    var w = canvas.clientWidth || window.innerWidth || 0;
    var h = canvas.clientHeight || window.innerHeight || 0;
    var nextDpr = Math.min(window.devicePixelRatio || 1, 2);

    if (w === width && h === height && nextDpr === dpr && ready) {
      return; // nothing actually changed - rebuilding the board is not cheap
    }

    width = w;
    height = h;
    dpr = nextDpr;

    if (!width || !height) {
      ready = false; // not laid out yet; step() will retry
      return;
    }

    // Only the bitmap is set here. The stylesheet sizes the element at
    // 100%/100%; writing an inline px size would override that and pin the
    // element, and then the next measurement would read our own stale value
    // back instead of the viewport and never pick up a new size.
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    cols = Math.ceil(width / CONFIG.cell) + 1;
    rows = Math.ceil(height / CONFIG.cell) + 1;

    buildGrid();
    buildBoard();
    particles = [];
    ready = true;
  }

  function start() {
    if (rafId === null) {
      rafId = window.requestAnimationFrame(step);
    }
  }

  function stop() {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // Rebuilding the static board layer is not cheap, so don't do it for every
  // event in a drag-resize.
  function scheduleResize() {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      resizeTimer = null;
      resize();
    }, 150);
  }

  window.addEventListener("resize", scheduleResize);

  // A window resize event is not guaranteed for every size change the element
  // actually sees, so observe the element itself where that is available.
  if (typeof window.ResizeObserver === "function") {
    new window.ResizeObserver(scheduleResize).observe(canvas);
  }

  // Don't burn CPU on a background tab.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else start();
  });

  resize();
  start();
})();
