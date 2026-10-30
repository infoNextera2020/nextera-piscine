import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Callback = () => void;
class FigureElement {
  attrs: Record<string, string> = {};
  children: FigureElement[] = [];
  events = new Map<string, Set<(event: unknown) => void>>();
  ownerDocument: { activeElement: unknown } = { activeElement: null };
  constructor(readonly tag: string) {}
  setAttribute(key: string, value: unknown) {
    this.attrs[key] = String(value);
  }
  appendChild(child: FigureElement) {
    this.children.push(child);
    return child;
  }
  replaceChildren() {
    this.children = [];
  }
  addEventListener(name: string, callback: (event: unknown) => void) {
    const set = this.events.get(name) ?? new Set();
    set.add(callback);
    this.events.set(name, set);
  }
  removeEventListener(name: string, callback: (event: unknown) => void) {
    this.events.get(name)?.delete(callback);
  }
  contains(value: unknown) {
    return this.children.includes(value as FigureElement);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 400, height: 320 };
  }
  classList = {
    toggle: (name: string, on: boolean) => {
      const values = new Set((this.attrs.class ?? '').split(' ').filter(Boolean));
      if (on) values.add(name);
      else values.delete(name);
      this.attrs.class = [...values].join(' ');
    },
  };
  emit(name: string, event: unknown) {
    for (const fn of this.events.get(name) ?? []) fn(event);
  }
}
function scene(legacyCollision = false) {
  let clock = 0,
    id = 0;
  const frames = new Map<number, Callback>(),
    timers = new Map<number, { at: number; fn: Callback }>();
  const events = new Map<string, Set<Callback>>(),
    motionListeners = new Set<Callback>();
  const stage = new FigureElement('div');
  const on = (name: string, fn: Callback) => {
    const set = events.get(name) ?? new Set();
    set.add(fn);
    events.set(name, set);
  };
  const doc = {
    visibilityState: 'visible',
    activeElement: null,
    getElementById: () => stage,
    addEventListener: on,
    createElementNS: (_: string, tag: string) => {
      const el = new FigureElement(tag);
      el.ownerDocument = doc;
      return el;
    },
  };
  stage.ownerDocument = doc;
  const reduced = {
    matches: false,
    addEventListener: (_: string, fn: Callback) => motionListeners.add(fn),
    removeEventListener: (_: string, fn: Callback) => motionListeners.delete(fn),
  };
  const setTimer = (fn: Callback, ms: number) => {
    timers.set(++id, { at: clock + ms, fn });
    return id;
  };
  const context = createContext({
    document: doc,
    window: {
      addEventListener: on,
      setTimeout: setTimer,
      clearTimeout: (key: number) => timers.delete(key),
    },
    matchMedia: () => reduced,
    performance: { now: () => clock },
    requestAnimationFrame: (fn: Callback) => {
      frames.set(++id, fn);
      return id;
    },
    cancelAnimationFrame: (key: number) => frames.delete(key),
    setTimeout: setTimer,
    clearTimeout: (key: number) => timers.delete(key),
    IntersectionObserver: class {
      constructor(
        readonly callback: (entries: { target: FigureElement; isIntersecting: boolean }[]) => void,
      ) {}
      observe(target: FigureElement) {
        this.callback([{ target, isIntersecting: true }]);
      }
      unobserve() {}
      disconnect() {}
    },
  });
  const html = readFileSync('apps/web/public/piscine/hairline/greeting-card/figure.html', 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
  runInContext(scripts[0]!, context, { timeout: 1000 });
  // Only browser stylesheet installation is stubbed; geometry, scheduler, spring, hit testing and tour are original.
  runInContext('HL = {...HL, inject(){}};', context, { timeout: 1000 });
  const bridge = legacyCollision ? scripts[1]!.replace(/\breset\b/g, 'mount') : scripts[1]!;
  runInContext(bridge, context, { timeout: 1000 });
  runInContext('var hairline = window.hairline;', context, { timeout: 1000 });
  runInContext(scripts[2]!, context, { timeout: 1000 });
  function advance(ms: number) {
    for (let n = 0; n < Math.ceil(ms / 16); n++) {
      clock += 16;
      for (const [key, timer] of [...timers])
        if (timer.at <= clock) {
          timers.delete(key);
          timer.fn();
        }
      const batch = [...frames.values()];
      frames.clear();
      for (const fn of batch) fn();
    }
  }
  function snapshot() {
    const paths: string[] = [];
    const visit = (el: FigureElement) => {
      if (el.attrs.d) paths.push(el.attrs.d);
      el.children.forEach(visit);
    };
    visit(stage);
    return paths.join('|');
  }
  return {
    stage,
    frames,
    advance,
    snapshot,
    pointer: () => stage.emit('pointermove', { clientX: 280, clientY: 205, pointerType: 'mouse' }),
    leave: () => stage.emit('pointerleave', { pointerType: 'mouse' }),
    hide: () => {
      doc.visibilityState = 'hidden';
      for (const fn of events.get('visibilitychange') ?? []) fn();
    },
    show: () => {
      doc.visibilityState = 'visible';
      for (const fn of events.get('visibilitychange') ?? []) fn();
    },
    reduce: () => {
      reduced.matches = true;
      for (const fn of [...motionListeners]) fn();
    },
    destroy: () => {
      for (const fn of events.get('pagehide') ?? []) fn();
    },
  };
}
describe('Original GreetingCard engine deterministic lifecycle — not browser evidence', () => {
  it('detects the former host/figure global mount collision as a negative control', () => {
    expect(() => scene(true)).toThrow(/undefined|destructure/i);
  });
  it('changes actual SVG path geometry automatically over time without a pointer', () => {
    const s = scene(),
      samples = new Set([s.snapshot()]);
    expect(s.stage.attrs['data-hairline']).toBe('greeting-heart');
    for (let n = 0; n < 7; n++) {
      s.advance(1800);
      samples.add(s.snapshot());
    }
    expect(samples.size).toBeGreaterThan(2);
    expect(s.stage.children).toHaveLength(1);
    s.destroy();
    expect(s.frames.size).toBe(0);
  });
  it('yields to a simulated pointer position, holds it, then resumes the tour after leaving', () => {
    const s = scene(),
      rest = s.snapshot();
    s.advance(5000);
    s.pointer();
    s.advance(2400);
    const held = s.snapshot();
    expect(held).not.toBe(rest);
    s.advance(3000);
    expect(s.snapshot()).toBe(held);
    s.leave();
    s.advance(300);
    const left = s.snapshot();
    s.advance(4000);
    expect(s.snapshot()).not.toBe(left);
    s.destroy();
  });
  it('stops while hidden, resumes visibly, and leaves reduced motion at the static rest geometry', () => {
    const s = scene(),
      rest = s.snapshot();
    s.advance(3500);
    s.hide();
    expect(s.frames.size).toBe(0);
    expect(s.stage.children).toHaveLength(0);
    s.advance(4000);
    expect(s.stage.children).toHaveLength(0);
    s.show();
    s.advance(3500);
    expect(s.snapshot()).not.toBe(rest);
    s.reduce();
    s.advance(200);
    expect(s.snapshot()).toBe(rest);
    expect(s.frames.size).toBe(0);
    s.destroy();
  });
});
