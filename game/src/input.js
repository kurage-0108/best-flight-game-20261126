// Keyboard and mouse state: keys held, keys pressed since the last frame,
// and a gentle mouse "stick" that is live only while the left button is held.

const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyB', 'KeyC', 'KeyP', 'KeyR',
]);

const MOUSE_STICK_RANGE = 220; // pixels of drag for full deflection

export function createInput(target = window) {
  const held = new Set();
  const pressed = new Set();
  const pointer = { x: 0, y: 0, down: false, startX: 0, startY: 0 };

  target.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    held.add(e.code);
  });
  target.addEventListener('keyup', (e) => {
    held.delete(e.code);
  });
  target.addEventListener('blur', () => {
    held.clear();
    pointer.down = false;
  });

  target.addEventListener('mousemove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  });
  target.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest?.('button, .card')) return;
    pointer.down = true;
    pointer.startX = pointer.x = e.clientX;
    pointer.startY = pointer.y = e.clientY;
  });
  target.addEventListener('mouseup', (e) => {
    if (e.button === 0) pointer.down = false;
  });
  target.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    /** Whether a key (KeyboardEvent.code) is held right now. */
    isDown: (code) => held.has(code),
    /** Whether a key went down since the last endFrame(). */
    wasPressed: (code) => pressed.has(code),
    /** -1, 0 or +1 from a pair of keys (any of each list). */
    axis(negative, positive) {
      const neg = negative.some((c) => held.has(c)) ? 1 : 0;
      const pos = positive.some((c) => held.has(c)) ? 1 : 0;
      return pos - neg;
    },
    /** Mouse drag from where the left button went down, each axis in [-1, 1]; zero when released. */
    mouseStick() {
      if (!pointer.down) return { x: 0, y: 0 };
      const clamp = (v) => Math.max(-1, Math.min(1, v));
      return {
        x: clamp((pointer.x - pointer.startX) / MOUSE_STICK_RANGE),
        y: clamp((pointer.y - pointer.startY) / MOUSE_STICK_RANGE),
      };
    },
    /** Forget this frame's presses; call once per rendered frame. */
    endFrame: () => pressed.clear(),
    /** Drop everything (used when screens change). */
    reset() {
      held.clear();
      pressed.clear();
      pointer.down = false;
    },
  };
}
