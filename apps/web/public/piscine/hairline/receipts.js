/* global HL, hairline, performance */
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
  tween,
  tset,
  tval,
  tdone,
  pointer,
  register,
  disposer,
} = HL;
function mount({ stage, svg, read }, value) {
  const bag = disposer(),
    C = Cam(45, 0.5, 1.9);
  fit(
    C,
    [
      [-62, -42, 0],
      [62, 70, 0],
      [-62, -42, 40],
      [62, 70, 40],
    ],
    200,
    166,
  );
  const P = proj(C),
    front = facing(C),
    g = mk('g', {}, svg),
    parts = [];
  let intensity = value,
    selected = -1;
  const base = rings(-68, -46, 68, 74, 3, 1);
  put(solid(g), prism(P, front, ...base, 0, 3));
  for (let i = 0; i < 3; i++) {
    const x = -32 + i * 23,
      y = -24 + i * 30;
    if (i < 2)
      mk('path', { d: seg(P(x + 10, y + 25, 4), P(x + 26, y + 39, 4)), class: 'nf lo' }, g);
    const el = solid(g),
      seam = mk('path', { class: 'nf lo' }, g),
      punch = mk('path', { class: 'nf lo' }, g);
    const rest = 5 + i * 2;
    const shape = rings(x - 25, y - 18, x + 25, y + 18, 3, 1);
    const pose = (z) => {
      put(el, prism(P, front, ...shape, z, z + 2));
      seam.setAttribute('d', seg(P(x - 16, y - 7, z + 2), P(x + 16, y - 7, z + 2)));
      punch.setAttribute('d', seg(P(x - 16, y + 1, z + 2), P(x + 9, y + 1, z + 2)));
    };
    pose(rest);
    el.sil.classList.toggle('hi', i === 1);
    parts.push({ el, pose, rest, z: tween(rest), point: P(x, y, rest + 2), last: rest });
  }
  read.textContent = 'rest';
  const loop = register(stage, (_dt, now) => {
    let moving = false;
    parts.forEach((p) => {
      const z = tval(p.z, now);
      if (z !== p.last) {
        p.pose(z);
        p.last = z;
      }
      if (!tdone(p.z, now)) moving = true;
    });
    return moving;
  });
  bag.add(loop.unregister);
  function choose(index) {
    if (index === selected) return;
    const origin = index < 0 ? selected : index;
    selected = index;
    parts.forEach((p, i) => {
      tset(
        p.z,
        p.rest + (index === i ? intensity : 0),
        performance.now(),
        Math.abs(i - origin) * 35,
      );
      p.el.sil.classList.toggle('hi', index < 0 ? i === 1 : i === index);
    });
    read.textContent = index < 0 ? 'rest' : 'receipt ' + (index + 1);
    loop.wake();
  }
  bag.add(
    pointer(stage, {
      move: (p) => {
        const distances = parts.map((t) => Math.hypot(p[0] - t.point[0], p[1] - t.point[1]));
        const min = Math.min(...distances);
        choose(min < 40 ? distances.indexOf(min) : -1);
      },
      leave: () => choose(-1),
    }),
  );
  bag.add(() => svg.replaceChildren());
  return {
    set: (v) => {
      intensity = v;
    },
    destroy: bag.dispose,
  };
}
hairline({
  name: 'receipts',
  means:
    'Three linked receipt plates form a durable record. The pointer gently lifts one; adjacent text supplies the actual evidence.',
  rules: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  range: [2, 4, 6],
  tour: [[160, 130], [200, 160], [240, 190], null],
  mount,
});
