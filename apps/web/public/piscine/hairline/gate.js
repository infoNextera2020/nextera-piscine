/* global HL, hairline, URLSearchParams, location */
const {
  Cam,
  fit,
  proj,
  facing,
  rings,
  prism,
  solid,
  put,
  mk,
  seg,
  spring,
  stepS,
  pointer,
  register,
  disposer,
  clamp,
} = HL;
function mount({ stage, svg, read }, value) {
  const bag = disposer();
  const state =
    new URLSearchParams(location.search).get('state') || stage.dataset.state || 'locked';
  const passed = state === 'passed';
  let reach = value;
  const C = Cam(45, 0.5, 1.72);
  fit(
    C,
    [
      [-74, -50, 0],
      [74, -50, 0],
      [-74, 70, 0],
      [74, 70, 0],
      [-48, 0, 76],
      [48, 0, 76],
    ],
    200,
    166,
  );
  const P = proj(C),
    front = facing(C),
    group = mk('g', {}, svg);
  const part = (x0, y0, x1, y1, z0, z1, bright = false, project = P) => {
    const [ring, inner] = rings(x0, y0, x1, y1, 2, 0.7);
    const el = solid(group);
    put(el, prism(project, front, ring, inner, z0, z1));
    el.sil.classList.toggle('hi', bright);
    return el;
  };
  part(-68, -20, 68, 70, 0, 3);
  part(-57, -6, -44, 8, 3, 70);
  // Four separate task channels converge physically at one closed gate.
  for (let i = 0; i < 4; i++) {
    const x = -49 + i * 29;
    mk('path', { d: seg(P(x, 49, 4), P(x, 10, 4)), class: 'nf lo' }, group);
    part(x - 10, 46 + (i % 2) * 3, x + 10, 62 + (i % 2) * 3, 3, 7);
  }
  const angle = passed ? -Math.PI / 2.6 : 0;
  const hinge = (x, y, z) =>
    P(
      -44 + (x + 44) * Math.cos(angle) - y * Math.sin(angle),
      (x + 44) * Math.sin(angle) + y * Math.cos(angle),
      z,
    );
  part(-44, -2, 45, 5, 47, 58, false, hinge);
  part(-44, -2, 45, 5, 22, 28, false, hinge);
  part(-30, -2, -24, 5, 28, 47, false, hinge);
  part(-3, -2, 3, 5, 28, 47, false, hinge);
  part(24, -2, 30, 5, 28, 47, false, hinge);
  part(45, -6, 58, 8, 3, 70);
  const latch = solid(group),
    shift = spring(1);
  latch.sil.classList.add('hi');
  const [ring, inner] = rings(30, -5, 46, 3, 1.5, 0.6);
  let last = null;
  function draw(v) {
    if (v === last) return;
    last = v;
    const project = (x, y, z) => hinge(x + v, y, z);
    put(latch, prism(project, front, ring, inner, 38, 43));
  }
  draw(shift.x);
  read.textContent = 'rest';
  const loop = register(stage, (dt) => {
    const moving = stepS(shift, dt);
    draw(shift.x);
    return moving;
  });
  bag.add(loop.unregister);
  const point = P(38, 0, 42);
  bag.add(
    pointer(stage, {
      move: (p) => {
        const distance = Math.hypot(p[0] - point[0], p[1] - point[1]);
        shift.t = 1 + clamp(1 - distance / 72, 0, 1) * reach;
        read.textContent = distance < 72 ? 'latch' : 'rest';
        loop.wake();
      },
      leave: () => {
        shift.t = 1;
        read.textContent = 'rest';
        loop.wake();
      },
    }),
  );
  bag.add(() => svg.replaceChildren());
  return {
    set: (v) => {
      reach = v;
    },
    destroy: bag.dispose,
  };
}
hairline({
  name: 'gate',
  means:
    'Four task channels meet one gate. The pointer nudges only the latch; a stored PASS alone opens the gate.',
  rules: [1, 3, 5, 7, 8, 9, 10],
  range: [1, 2, 3],
  tour: [[170, 140], [240, 160], [210, 190], null],
  mount,
});
