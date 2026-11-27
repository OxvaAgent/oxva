/* The Oxva mark on the home page, in 3D and alive.
 *  - It turns by itself.
 *  - With a mouse, it turns to follow the pointer anywhere over the hero; click and drag to spin it.
 *  - On a phone, tap it to give it a spin, or swipe across it (page scrolling up and down still works).
 * One controller drives two renderers: the WebGL mark (three.js, src/assets/vendor/three-oxva.js, built by tools/three)
 * and, until that is ready or when the browser has no WebGL, a 2D canvas that fakes the same 3D turn (#engraving).
 * Add ?mark=debug to the URL to see which one is running and why, or ?mark=flat to force the 2D stand-in. */
(function () {
  'use strict';
  var fig = document.querySelector('.hero-art'), flatCv = document.getElementById('engraving'), frameEl = document.querySelector('.frame');
  if (!fig || !flatCv || !window.Path2D) return;
  var MARK = 'M506.5 597L608.1 395.9A160 160 0 0 1 750.9 308L931 308A110 110 0 0 1 1039.5 400L795.7 400A100 100 0 0 0 706.4 454.9L679.2 509ZM1040.8 425A110 110 0 0 1 1031.1 463.6L959.8 620.3A160 160 0 0 1 814.2 714L603 714A100 100 0 0 1 503.3 622.3L644.2 578.2L622.1 622L772 622A100 100 0 0 0 860 569.5L922.6 453.5Z';
  var VIEW = { x: 503, y: 308, w: 538, h: 406 };
  var reduce = false; // the owner wants the mark to move whatever the system motion setting
  var lite = document.documentElement.classList.contains('lite'); // still, unless turned by hand: ?lite=1, or no usable WebGL
  var small = window.matchMedia && matchMedia('(max-width: 900px)').matches;
  var debug = /[?&]mark=debug\b/.test(location.search), forceFlat = /[?&]mark=flat\b/.test(location.search);
  var TAU = Math.PI * 2, TILT = 0.16;
  var AUTO = reduce ? 0.16 : 0.5; // radians per second; gentler when the system asks for less motion

  /* ---------------------------------------------------------------- the controller */
  var S = { rotY: -0.5, rotX: TILT, velY: 0, velX: 0, dragging: false, moved: 0, lastX: 0, lastY: 0, lastT: 0, idleSince: 0, follow: null };

  function step(dt, now) {
    if (S.dragging) return;
    if (S.follow && now - S.follow.at < 2500) {
      // turn toward the pointer, by the shortest way round
      var target = S.follow.yaw, goal = target + Math.round((S.rotY - target) / TAU) * TAU, k = Math.min(1, dt * 5);
      S.rotY += (goal - S.rotY) * k;
      S.rotX += (S.follow.pitch - S.rotX) * k;
      S.velY = S.velX = 0;
      return;
    }
    S.rotY += S.velY; S.rotX += S.velX;
    S.velY *= 0.94; S.velX *= 0.88;
    if (!lite && Math.abs(S.velY) < 0.003 && now - S.idleSince > 500) S.rotY += AUTO * dt;
    S.rotX += (TILT - S.rotX) * Math.min(1, dt * 1.8);
  }

  fig.addEventListener('pointerdown', function (e) {
    S.dragging = true; S.moved = 0; S.lastX = e.clientX; S.lastY = e.clientY; S.lastT = performance.now(); S.velY = S.velX = 0; S.follow = null;
    try { fig.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ }
    fig.classList.add('grabbing'); hint(false);
  });
  fig.addEventListener('pointermove', function (e) {
    if (!S.dragging) return;
    var now = performance.now(), dt = Math.max(8, now - S.lastT);
    var dyaw = (e.clientX - S.lastX) * 0.01, dpitch = (e.clientY - S.lastY) * 0.006;
    S.moved += Math.abs(e.clientX - S.lastX) + Math.abs(e.clientY - S.lastY);
    S.rotY += dyaw; S.rotX = Math.max(-0.9, Math.min(0.9, S.rotX + dpitch));
    S.velY = dyaw * (16 / dt); S.velX = dpitch * (16 / dt);
    S.lastX = e.clientX; S.lastY = e.clientY; S.lastT = now;
  });
  function release() {
    if (!S.dragging) return;
    S.dragging = false; S.idleSince = performance.now(); fig.classList.remove('grabbing');
    if (S.moved < 6) S.velY += 0.22; // a tap or click: give it a spin
  }
  fig.addEventListener('pointerup', release);
  fig.addEventListener('pointercancel', release);
  fig.addEventListener('lostpointercapture', release);

  // with a mouse, the mark looks toward the pointer anywhere over the hero card
  (frameEl || fig).addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse' || S.dragging) return;
    var r = fig.getBoundingClientRect(), R = (frameEl || fig).getBoundingClientRect();
    var nx = (e.clientX - (r.left + r.width / 2)) / Math.max(200, R.width / 2);
    var ny = (e.clientY - (r.top + r.height / 2)) / Math.max(200, R.height / 2);
    nx = Math.max(-1, Math.min(1, nx)); ny = Math.max(-1, Math.min(1, ny));
    S.follow = { yaw: nx * 0.95, pitch: TILT + ny * 0.5, at: performance.now() };
  });
  (frameEl || fig).addEventListener('pointerleave', function () { S.follow = null; S.idleSince = performance.now(); });

  var tip = document.createElement('span');
  tip.className = 'drag-hint mono';
  tip.textContent = small ? 'Tap or swipe to turn' : 'Move the mouse or drag to turn';
  fig.appendChild(tip);
  function hint(on) { tip.classList.toggle('off', !on); }
  function why(text) { fig.setAttribute('data-mark', text); if (debug) tip.textContent = 'mark: ' + text; }

  /* ---------------------------------------------------------------- the 2D stand-in (fakes the 3D turn) */
  var flat = (function () {
    var ctx = flatCv.getContext('2d'), mark = new Path2D(MARK), size = 0, dpr = 1;
    var VCX = VIEW.x + VIEW.w / 2, VCY = VIEW.y + VIEW.h / 2, DEPTH = 80, N = 12;
    function fit() {
      var w = flatCv.getBoundingClientRect().width || 400;
      dpr = Math.min(1.25, window.devicePixelRatio || 1); // the stand-in runs on the CPU: keep it light
      size = Math.round(w * dpr); flatCv.width = size; flatCv.height = size;
    }
    fit(); window.addEventListener('resize', fit);
    function mix(a, b, t) { return Math.round(a + (b - a) * t); }
    return function draw(phase) {
      var s = size, c = s / 2;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, s, s);
      var glow = ctx.createRadialGradient(c, c, 0, c, c, s * 0.46);
      glow.addColorStop(0, 'rgba(63,214,160,0.22)'); glow.addColorStop(1, 'rgba(63,214,160,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, s, s);
      // the engraved rings
      ctx.lineWidth = Math.max(1, s / 900);
      for (var k = 0; k < 16; k++) {
        ctx.beginPath();
        for (var t = 0; t <= 360; t += 5) {
          var a = t * Math.PI / 180, r = s * (0.41 + 0.03 * Math.sin(7 * a + k * 0.2 + phase * 0.6));
          var x = c + r * Math.cos(a + k * 0.1), y = c + r * Math.sin(a + k * 0.1) * (0.92 + 0.08 * Math.cos(S.rotX));
          t ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath(); ctx.strokeStyle = 'rgba(63,214,160,' + (0.26 - k * 0.012) + ')'; ctx.stroke();
      }
      // the mark: slices from back to front give it depth; the face is scaled by the turn
      var cy0 = Math.cos(S.rotY), unit = (s * 0.6) / VIEW.w, cy = (cy0 < 0 ? -1 : 1) * Math.max(0.05, Math.abs(cy0)), sy = Math.sin(S.rotY), cx = Math.cos(S.rotX), sx = Math.sin(S.rotX);
      var front = cy >= 0, side = Math.abs(sy);
      for (var i = 0; i < N; i++) {
        var f = i / (N - 1), z = ((front ? f : 1 - f) - 0.5) * DEPTH;
        ctx.setTransform(cy * unit, 0, 0, cx * unit, c + z * sy * unit - VCX * cy * unit, c - z * sx * unit - VCY * cx * unit);
        var lum = 0.35 + 0.45 * f * (0.4 + 0.6 * side);
        ctx.fillStyle = 'rgb(' + mix(8, 40, lum) + ',' + mix(60, 190, lum) + ',' + mix(46, 140, lum) + ')';
        ctx.fill(mark);
      }
      var zf = (front ? 0.5 : -0.5) * DEPTH;
      ctx.setTransform(cy * unit, 0, 0, cx * unit, c + zf * sy * unit - VCX * cy * unit, c - zf * sx * unit - VCY * cx * unit);
      var g = ctx.createLinearGradient(VIEW.x, VIEW.y, VIEW.x + VIEW.w, VIEW.y + VIEW.h);
      if (front) { g.addColorStop(0, '#dcfff1'); g.addColorStop(0.42, '#46dba6'); g.addColorStop(1, '#0a5240'); }
      else { g.addColorStop(0, '#2c9c78'); g.addColorStop(1, '#06362a'); }
      ctx.fillStyle = g; ctx.fill(mark);
      ctx.save(); ctx.clip(mark);
      ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(3,26,19,0.45)';
      for (var y0 = VIEW.y - 6; y0 < VIEW.y + VIEW.h + 6; y0 += 7) {
        ctx.beginPath();
        for (var x1 = VIEW.x - 4; x1 <= VIEW.x + VIEW.w + 4; x1 += 12) {
          var yy = y0 + 3 * Math.sin((x1 - VIEW.x) / VIEW.w * Math.PI * 3 + phase + (y0 - VIEW.y) / VIEW.h * 2.2);
          x1 === VIEW.x - 4 ? ctx.moveTo(x1, yy) : ctx.lineTo(x1, yy);
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(205,255,236,0.85)'; ctx.stroke(mark);
    };
  })();

  /* ---------------------------------------------------------------- the WebGL mark */
  var gl3d = null; // set once three.js is running: function (dt, now) that renders a frame

  function start3d() {
    var T = window.OxvaTHREE; if (!T) { why('flat: three.js missing'); return; }
    var renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch (e) { why('flat: WebGL could not start (' + ((e && e.message) || e) + ')'); return; }
    try {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      var cv = renderer.domElement;
      cv.className = 'mark3d';
      cv.setAttribute('aria-hidden', 'true');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(30, 1, 10, 6000);
      camera.position.set(0, 0, 1640);
      var pmrem = new T.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;

      var svg = new T.SVGLoader().parse('<svg xmlns="http://www.w3.org/2000/svg"><g transform="scale(1,-1)"><path d="' + MARK + '"/></g></svg>');
      var shapes = [];
      svg.paths.forEach(function (p) { shapes = shapes.concat(T.SVGLoader.createShapes(p)); });
      if (!shapes.length) throw new Error('the logo path did not parse');
      var geo = new T.ExtrudeGeometry(shapes, { depth: 96, bevelEnabled: true, bevelThickness: 10, bevelSize: 7, bevelSegments: 4, curveSegments: 36 });
      geo.computeBoundingBox();
      var bb = geo.boundingBox, ox = (bb.min.x + bb.max.x) / 2, oy = (bb.min.y + bb.max.y) / 2, oz = (bb.min.z + bb.max.z) / 2;
      geo.translate(-ox, -oy, -oz);

      var markG = new T.Group();
      var back = new T.Mesh(geo, new T.MeshPhysicalMaterial({ color: 0x0b4436, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.6, side: T.BackSide, depthWrite: false }));
      var front = new T.Mesh(geo, new T.MeshPhysicalMaterial({
        color: 0x34cf98, emissive: 0x0b5a44, emissiveIntensity: 0.45, roughness: 0.08, metalness: 0.15,
        clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.5, transparent: true, opacity: 0.5, side: T.FrontSide, depthWrite: false
      }));
      var seg = [], zf = bb.max.z - oz, zb = bb.min.z - oz;
      shapes.forEach(function (sh) {
        var ex = sh.extractPoints(40);
        [ex.shape].concat(ex.holes).forEach(function (loop) {
          for (var i = 0; i < loop.length; i++) {
            var p = loop[i], q = loop[(i + 1) % loop.length];
            seg.push(p.x - ox, p.y - oy, zf, q.x - ox, q.y - oy, zf, p.x - ox, p.y - oy, zb, q.x - ox, q.y - oy, zb);
          }
        });
      });
      var eg = new T.BufferGeometry(); eg.setAttribute('position', new T.Float32BufferAttribute(seg, 3));
      var edges = new T.LineSegments(eg, new T.LineBasicMaterial({ color: 0xaaf7d8, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false }));
      back.renderOrder = 1; front.renderOrder = 2; edges.renderOrder = 3;
      markG.add(back, front, edges);
      scene.add(markG);

      var halo = new T.Group();
      var r1 = new T.Mesh(new T.TorusGeometry(395, 1.4, 8, 220), new T.MeshBasicMaterial({ color: 0x3fd6a0, transparent: true, opacity: 0.32, depthWrite: false }));
      var r2 = new T.Mesh(new T.TorusGeometry(432, 0.9, 8, 220), new T.MeshBasicMaterial({ color: 0x3fd6a0, transparent: true, opacity: 0.18, depthWrite: false }));
      r1.rotation.x = 1.25; r2.rotation.x = 1.05; r2.rotation.y = 0.35;
      var pts = [], n = small ? 70 : 120;
      for (var i = 0; i < n; i++) {
        var a = (i / n) * TAU + Math.random() * 0.05, rr = 340 + Math.random() * 100, zz = (Math.random() - 0.5) * 120;
        pts.push(Math.cos(a) * rr, Math.sin(a) * rr * 0.36, zz + Math.sin(a) * rr * 0.2);
      }
      var pg = new T.BufferGeometry(); pg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      var dust = new T.Points(pg, new T.PointsMaterial({ color: 0x7ff0c4, size: 5, sizeAttenuation: true, transparent: true, opacity: 0.75, blending: T.AdditiveBlending, depthWrite: false }));
      halo.add(r1, r2, dust);
      halo.rotation.z = -0.18;
      scene.add(halo);

      scene.add(new T.AmbientLight(0xffffff, 0.35));
      var key = new T.DirectionalLight(0xe8fff5, 2.2); key.position.set(500, 700, 1100); scene.add(key);
      var rim = new T.PointLight(0x3fd6a0, 3.2, 0, 0); rim.position.set(-700, -350, 500); scene.add(rim);
      var fill = new T.PointLight(0x9ff5d6, 1.4, 0, 0); fill.position.set(650, -200, -600); scene.add(fill);

      function fit() { var w = Math.max(1, Math.round(fig.getBoundingClientRect().width)); renderer.setSize(w, w, false); camera.aspect = 1; camera.updateProjectionMatrix(); }
      fit();
      if (window.ResizeObserver) new ResizeObserver(fit).observe(fig); else window.addEventListener('resize', fit);

      renderer.render(scene, camera); // a first frame here, so a broken context fails now and the stand-in stays
      fig.insertBefore(cv, tip);
      requestAnimationFrame(function () { cv.classList.add('on'); });
      setTimeout(function () { flatCv.hidden = true; }, 900);
      why('3d');
      gl3d = function (dt, now) {
        markG.rotation.set(S.rotX, S.rotY, 0);
        markG.position.y = reduce ? 0 : Math.sin(now / 1300) * 10;
        if (!reduce) { halo.rotation.y += dt * 0.12; dust.rotation.y -= dt * 0.05; }
        renderer.render(scene, camera);
      };
    } catch (e) {
      why('flat: ' + ((e && e.message) || e));
      try { renderer.dispose(); } catch (x) { /* ignore */ }
      if (renderer && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      gl3d = null;
    }
  }

  /* ---------------------------------------------------------------- one loop for both */
  var visible = true, prev = performance.now(), phase = 0, lastDraw = 0;
  if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(fig);
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) { prev = now; return; }
    var dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    step(dt, now);
    if (!reduce) phase += dt * 0.35;
    var busy = S.dragging || (S.follow && now - S.follow.at < 2500);
    if (lite && !busy && Math.abs(S.velY) < 0.003 && lastDraw) return; // light mode: draw only while it moves
    if (!busy && now - lastDraw < 33) return; // ~30 frames a second is plenty for a slow turn
    lastDraw = now;
    if (gl3d) gl3d(dt, now);
    if (!flatCv.hidden) flat(phase);
  }
  requestAnimationFrame(frame);

  // WebGL that runs on the CPU (no graphics card in use) is slower than the 2D stand-in, so it counts as none
  function webgl() {
    try {
      var c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl');
      if (!g) return 'off';
      var d = g.getExtension('WEBGL_debug_renderer_info'), r = d ? String(g.getParameter(d.UNMASKED_RENDERER_WEBGL)) : '';
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(r) ? 'software' : 'ok';
    } catch (e) { return 'off'; }
  }
  if (forceFlat) { why('flat: forced by ?mark=flat'); return; }
  if (lite) { why('flat: light mode (' + document.documentElement.getAttribute('data-lite') + ')'); return; }
  var gpu = webgl();
  // without WebGL there is no 3D scene: the 2D mark stays still (it still turns by hand)
  if (gpu === 'off') { lite = true; why('flat, still: this browser has WebGL turned off'); return; }
  if (gpu === 'software') { lite = true; why('flat, still: WebGL runs without a graphics card here'); return; }
  var s = document.createElement('script');
  s.src = '/assets/vendor/three-oxva.js'; s.async = true;
  s.onload = start3d;
  s.onerror = function () { why('flat: three.js did not load'); };
  document.head.appendChild(s);
})();
