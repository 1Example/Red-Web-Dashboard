/*
 * Animated "connecting dots" background.
 *
 * Adapted from https://codepen.io/caiquegaspar/pen/dPpLZGE (originally from
 * Patryk Zabielski's site). The original has two problems that make it unusable
 * as a persistent site background, both fixed here:
 *
 *   1. createDots() pushed `nb` brand-new dots into the array on EVERY frame,
 *      so the array grew without bound until the tab died. Dots are now built
 *      once, up front.
 *   2. The line pass was O(n^2) over 1000 dots (1,000,000 checks per frame at
 *      30fps). Dot count is way down and the inner loop starts at i+1 so each
 *      pair is tested once instead of twice.
 *
 * Also added: devicePixelRatio scaling, resize handling, pause when the tab is
 * hidden, and a reduced-motion opt-out.
 */
(function () {
  var canvas = document.getElementById("cx-bg-canvas");
  if (!canvas || !canvas.getContext) {
    return;
  }

  var prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var ctx = canvas.getContext("2d");
  var DOT_COLOR = "rgba(210, 218, 232, 0.55)";
  var LINE_COLOR = "rgba(150, 170, 200, 0.16)";
  var LINK_DISTANCE = 130;   // px between dots for a line to be drawn
  var CURSOR_RADIUS = 220;   // only link dots near the cursor
  var DENSITY = 14000;       // one dot per N css-pixels of viewport area

  var width = 0;
  var height = 0;
  var dots = [];
  var mouse = { x: -9999, y: -9999 };
  var rafId = null;

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildDots();
  }

  function buildDots() {
    // Built once per resize - never appended to per frame.
    var target = Math.min(160, Math.max(40, Math.round((width * height) / DENSITY)));
    dots = [];
    for (var i = 0; i < target; i++) {
      dots.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: -0.25 + Math.random() * 0.5,
        vy: -0.25 + Math.random() * 0.5,
        r: 0.6 + Math.random() * 1.1
      });
    }
  }

  function step() {
    ctx.clearRect(0, 0, width, height);

    var i, j, dot, other, dx, dy;

    // move + draw dots
    ctx.fillStyle = DOT_COLOR;
    for (i = 0; i < dots.length; i++) {
      dot = dots[i];
      dot.x += dot.vx;
      dot.y += dot.vy;
      if (dot.x < 0 || dot.x > width) dot.vx = -dot.vx;
      if (dot.y < 0 || dot.y > height) dot.vy = -dot.vy;

      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2, false);
      ctx.fill();
    }

    // link nearby dots, but only around the cursor
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 0.6;
    for (i = 0; i < dots.length; i++) {
      dot = dots[i];
      dx = dot.x - mouse.x;
      dy = dot.y - mouse.y;
      if (dx * dx + dy * dy > CURSOR_RADIUS * CURSOR_RADIUS) {
        continue;
      }
      for (j = i + 1; j < dots.length; j++) {
        other = dots[j];
        dx = dot.x - other.x;
        dy = dot.y - other.y;
        if (dx * dx + dy * dy < LINK_DISTANCE * LINK_DISTANCE) {
          ctx.beginPath();
          ctx.moveTo(dot.x, dot.y);
          ctx.lineTo(other.x, other.y);
          ctx.stroke();
        }
      }
    }

    rafId = window.requestAnimationFrame(step);
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

  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", function (event) {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
  });
  window.addEventListener("mouseout", function () {
    mouse.x = -9999;
    mouse.y = -9999;
  });
  // Don't burn CPU on a background tab.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stop();
    } else {
      start();
    }
  });

  resize();
  if (prefersReducedMotion) {
    // Draw a single static frame and leave it there.
    step();
    stop();
  } else {
    start();
  }
})();
