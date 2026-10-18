// On-screen controls for phones and tablets. A floating joystick on the left half of the
// screen (horizontal = walk, vertical = aim) and a fire button on the right.
// They write into input.touch, which the Input getters read like a gamepad.

export const isTouchDevice = () =>
  matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

const RADIUS = 55;

export function setupTouch(input) {
  if (!isTouchDevice()) return false;
  document.body.classList.add('touch');

  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div></div>
    <div class="fire-btn">FIRE</div>
    <div class="tbtn pause-btn" aria-label="Pause">II</div>
    <div class="tbtn mute-btn" aria-label="Mute">♪</div>`;
  document.body.appendChild(root);

  const zone = root.querySelector('.stick-zone');
  const base = root.querySelector('.stick-base');
  const knob = root.querySelector('.stick-knob');
  let stickId = null;
  let ox = 0, oy = 0;

  const restStick = () => {
    stickId = null;
    input.touch.x = input.touch.y = 0;
    base.classList.remove('active');
    base.style.left = base.style.top = '';
    knob.style.transform = '';
  };

  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    const r = zone.getBoundingClientRect();
    ox = e.clientX;
    oy = e.clientY;
    base.style.left = `${ox - r.left}px`;
    base.style.top = `${oy - r.top}px`;
    base.classList.add('active');
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx *= RADIUS / len;
      dy *= RADIUS / len;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.touch.x = dx / RADIUS;
    input.touch.y = dy / RADIUS;
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    zone.addEventListener(ev, (e) => {
      if (e.pointerId === stickId) restStick();
    });
  }

  const fire = root.querySelector('.fire-btn');
  let fireId = null;
  fire.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fireId = e.pointerId;
    fire.setPointerCapture(e.pointerId);
    input.touch.fire = true;
    input.pressed.add('TouchFire');
    fire.classList.add('down');
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    fire.addEventListener(ev, (e) => {
      if (e.pointerId !== fireId) return;
      fireId = null;
      input.touch.fire = false;
      fire.classList.remove('down');
    });
  }

  const tap = (sel, code) => {
    const el = root.querySelector(sel);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't count as "tap to start"
      input.pressed.add(code);
    });
  };
  tap('.pause-btn', 'KeyP');
  tap('.mute-btn', 'KeyM');

  // No long-press menus, text selection, double-tap zoom or pinch zoom. iOS Safari ignores
  // user-scalable=no, so the touch and gesture events themselves have to be cancelled.
  addEventListener('contextmenu', (e) => e.preventDefault());
  const block = (e) => e.preventDefault();
  for (const ev of ['touchstart', 'touchmove', 'touchend']) {
    document.addEventListener(ev, (e) => {
      if (e.touches.length > 1 || ev !== 'touchstart' || e.target.closest('#touch')) block(e);
    }, { passive: false });
  }
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) {
    document.addEventListener(ev, block, { passive: false });
  }
  addEventListener('blur', restStick);

  // Show the controls while the screen is being used, fade them out after 5 s without
  // a touch, and hide them as soon as a gamepad is used. Faded controls stay active,
  // so the first touch already walks or fires.
  const HIDE_AFTER = 5000;
  let touchedAt = performance.now();
  const show = () => {
    touchedAt = performance.now();
    document.body.classList.add('controls-on');
  };
  document.addEventListener('pointerdown', show, { capture: true, passive: true });
  document.addEventListener('touchstart', show, { capture: true, passive: true });
  setInterval(() => {
    const now = performance.now();
    const fingerDown = stickId !== null || fireId !== null;
    if (fingerDown) touchedAt = now;
    const padNewer = input.gpUsedAt > touchedAt;
    if (padNewer || now - touchedAt > HIDE_AFTER) document.body.classList.remove('controls-on');
  }, 200);
  show();
  return true;
}

// Fullscreen and landscape lock help a lot on phones; both are best effort.
export function goFullscreen() {
  const el = document.documentElement;
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' });
    p?.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } catch {
    /* not supported (e.g. iPhone Safari) */
  }
}
