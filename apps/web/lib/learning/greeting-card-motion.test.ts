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
  replaceChildren(...children: FigureElement[]) {
    this.children = children;
  }
  cloneNode(deep: boolean): FigureElement {
    const clone = new FigureElement(this.tag);
    clone.attrs = { ...this.attrs };
    clone.ownerDocument = this.ownerDocument;
    if (deep) clone.children = this.children.map((child) => child.cloneNode(true));
    return clone;
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
    let stopped = false;
    const payload = {
      ...(event as Record<string, unknown>),
      stopImmediatePropagation() {
        stopped = true;
      },
    };
    for (const fn of [...(this.events.get(name) ?? [])]) {
      if (this.events.get(name)?.has(fn)) fn(payload);
      if (stopped) break;
    }
  }
}
function scene(kind: 'greeting-card' | 'sign-label' = 'greeting-card') {
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
  const html = readFileSync(`apps/web/public/piscine/hairline/${kind}/figure.html`, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
  runInContext(scripts[0]!, context, { timeout: 1000 });
  // Only browser stylesheet installation is stubbed; supplied geometry, scheduler, springs and hit testing execute.
  runInContext('HL = {...HL, inject(){}};', context, { timeout: 1000 });
  const bridge = scripts[1]!;
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
    pointer: (pointerType = 'mouse') =>
      stage.emit('pointermove', {
        clientX: kind === 'greeting-card' ? 280 : 200,
        clientY: kind === 'greeting-card' ? 205 : 165,
        pointerType,
      }),
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
describe.each(['greeting-card', 'sign-label'] as const)(
  'Supplied %s engine hover-only lifecycle — not browser evidence',
  (kind) => {
    it('keeps exact static rest without a pointer, then stops scheduling', () => {
      const s = scene(kind),
        rest = s.snapshot();
      expect(s.stage.attrs['data-hairline']).toBe(
        kind === 'greeting-card' ? 'greeting-heart' : 'q02-sign-label',
      );
      for (let n = 0; n < 7; n++) {
        s.advance(1800);
        expect(s.snapshot()).toBe(rest);
      }
      expect(s.frames.size).toBe(0);
      expect(s.stage.children).toHaveLength(1);
      s.destroy();
    });
    it('responds to mouse hover, holds the pointer pose and returns to rest on leave with no tour', () => {
      const s = scene(kind),
        rest = s.snapshot();
      s.advance(3000);
      s.pointer();
      s.advance(2400);
      const held = s.snapshot();
      expect(held).not.toBe(rest);
      s.advance(3000);
      expect(s.snapshot()).toBe(held);
      s.leave();
      expect(s.snapshot()).toBe(rest);
      for (let n = 0; n < 5; n++) {
        s.advance(1800);
        expect(s.snapshot()).toBe(rest);
      }
      expect(s.frames.size).toBe(0);
      s.destroy();
    });
    it('rejects touch interaction and suppresses all input/motion after the reduced-motion change', () => {
      const s = scene(kind),
        rest = s.snapshot();
      s.pointer('touch');
      s.advance(2000);
      expect(s.snapshot()).toBe(rest);
      s.pointer();
      s.advance(2400);
      expect(s.snapshot()).not.toBe(rest);
      s.reduce();
      expect(s.snapshot()).toBe(rest);
      expect(s.frames.size).toBe(0);
      s.pointer();
      s.advance(4000);
      expect(s.snapshot()).toBe(rest);
      expect(s.frames.size).toBe(0);
      s.destroy();
    });
    it('clears hidden work and returns visible at rest, without autonomous movement', () => {
      const s = scene(kind),
        rest = s.snapshot();
      s.pointer();
      s.advance(2400);
      s.hide();
      expect(s.stage.children).toHaveLength(0);
      expect(s.frames.size).toBe(0);
      s.advance(4000);
      s.show();
      s.advance(4000);
      expect(s.snapshot()).toBe(rest);
      expect(s.frames.size).toBe(0);
      s.destroy();
    });
  },
);
