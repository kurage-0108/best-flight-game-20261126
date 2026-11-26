// The DOM HUD shown in both views: big altitude / speed / heading readouts,
// vertical speed and throttle, fuel and damage bars, wind, ring progress and
// distance, a steering arrow, the centre message line and warnings.

import { UNITS } from './config.js';
import { headingOf } from './terrain.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    root: $('hud'), speed: $('hud-speed'), heading: $('hud-heading'), alt: $('hud-alt'),
    vs: $('hud-vs'), throttle: $('hud-throttle'), gear: $('hud-gear'),
    fuel: $('hud-fuel'), damage: $('hud-damage'), wind: $('hud-wind'),
    mission: $('hud-mission'), rings: $('hud-rings'), next: $('hud-next'), time: $('hud-time'),
    pointer: $('hud-pointer'), arrow: $('hud-pointer-arrow'), msg: $('hud-msg'), warn: $('hud-warn'), help: $('hud-help'),
  };
  const cache = new Map();
  let message = null; // { text, tone, left }

  /** Writes text or a class/style only when it changed, so the DOM is touched rarely. */
  function put(node, value, key = node.id) {
    if (cache.get(key) === value) return false;
    cache.set(key, value);
    node.textContent = value;
    return true;
  }
  function setClass(node, cls, on) {
    const key = `${node.id}.${cls}`;
    if (cache.get(key) === on) return;
    cache.set(key, on);
    node.classList.toggle(cls, on);
  }
  function setWidth(node, pct) {
    const v = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
    if (cache.get(node.id + '.w') === v) return;
    cache.set(node.id + '.w', v);
    node.style.width = v;
  }

  function showLine(text, tone) {
    put(el.msg, text, 'msg');
    setClass(el.msg, 'show', !!text);
    setClass(el.msg, 'good', tone === 'good');
    setClass(el.msg, 'bad', tone === 'bad');
  }

  return {
    setVisible(v) {
      setClass(el.root, 'hidden', !v);
    },
    setHelpVisible(v) {
      setClass(el.help, 'hidden', !v);
    },
    /** Mission name and wind text, set once per sortie. */
    setMission(name, wind) {
      put(el.mission, name.toUpperCase());
      put(el.wind, wind);
      message = null;
      showLine('', '');
    },
    /** A transient centre message, e.g. RING 3/6 or CRASHED. */
    flash(text, tone = '', seconds = 2) {
      message = { text, tone, left: seconds };
      showLine(text, tone);
    },
    /**
     * Refreshes every readout. info: { counter, next, target {x,z}, time, hint, hintTone }.
     */
    update(dt, s, info) {
      put(el.speed, String(Math.round(s.airspeed * UNITS.MS_TO_KT)));
      put(el.alt, String(Math.round((s.altitude * UNITS.M_TO_FT) / 5) * 5));
      put(el.heading, String(Math.round(s.heading) % 360).padStart(3, '0'));
      const fpm = Math.round((s.verticalSpeed * UNITS.MS_TO_FPM) / 10) * 10;
      put(el.vs, `VS ${fpm >= 0 ? '+' : ''}${fpm} fpm`);
      put(el.throttle, `THR ${Math.round(s.throttle * 100)}%${s.engineOn ? '' : ' · ENGINE OUT'}`);
      put(el.gear, s.brake ? 'BRAKE' : s.onGround ? 'WHEELS ON' : 'AIRBORNE');
      setClass(el.gear, 'on', s.brake);
      setWidth(el.fuel, s.fuel);
      setClass(el.fuel, 'low', s.fuel < 20);
      setWidth(el.damage, s.damage);

      put(el.rings, info.counter);
      put(el.next, info.next);
      put(el.time, info.time);
      if (info.target && !s.crashed) {
        let rel = headingOf(info.target.x - s.position.x, info.target.z - s.position.z) - s.heading;
        rel = ((rel % 360) + 540) % 360 - 180;
        el.arrow.style.transform = `rotate(${rel.toFixed(1)}deg)`;
        setClass(el.pointer, 'hidden', false);
      } else setClass(el.pointer, 'hidden', true);

      let warn = '';
      if (s.crashed) warn = '';
      else if (s.stalled) warn = 'STALL';
      else if (s.stallWarning) warn = 'STALL WARNING';
      else if (!s.engineOn) warn = 'ENGINE OUT';
      else if (s.fuel < 15) warn = 'LOW FUEL';
      else if (s.damage >= 60) warn = 'HEAVY DAMAGE';
      put(el.warn, warn);
      setClass(el.warn, 'blink', warn === 'STALL' || warn === 'ENGINE OUT');

      if (message) {
        message.left -= dt;
        if (message.left <= 0) message = null;
      }
      if (!message) showLine(info.hint || '', info.hintTone || '');
    },
  };
}
