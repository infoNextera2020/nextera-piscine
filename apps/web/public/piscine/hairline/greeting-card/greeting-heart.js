/** A folded paper heart, carried by the opening of a rounded greeting card. */
const {
  Cam, clamp, disposer, facing, fillet, fit, hull, mk, open, pointer, poly, prism,
  proj, rad, register, rings, rrect, run, seg, solid, spring, stepS, put,
} = HL;

function mount({ stage, svg, read }, value) {
  const bag = disposer(), REST = 66, TK = 1.1, Z = 4;
  let reach = value, held = null, last = NaN;
  const angle = spring(REST), C = Cam(45, 0.5, 1.54);
  // Include the widest and highest cover poses; fit centres but never scales.
  const bounds = [];
  for (const a of [REST, 90, 112, 148]) for (const x of [0, 96]) for (const y of [-54, 54]) {
    bounds.push([x * Math.cos(rad(a)), y, Z + x * Math.sin(rad(a))]);
  }
  bounds.push([96, -54, 1], [96, 54, 1]);
  fit(C, bounds, 200, 180);
  const P = proj(C), front = facing(C), g = mk("g", {}, svg);
  const [baseRing, baseInner] = rings(0, -54, 96, 54, 5, 1.5);
  put(solid(g), prism(P, front, baseRing, baseInner, 1, Z));
  mk("path", { d: seg(P(1.5, -47, Z), P(1.5, 47, Z)), class: "nf lo" }, g);
  const cover = mk("g", {}, g);
  const coverBack = mk("path", { class: "lo" }, cover);
  const coverFace = mk("path", { class: "sil" }, cover);
  const coverCrease = mk("path", { class: "nf lo" }, cover);
  const tabBack = mk("path", { class: "sil" }, g);
  const tabFront = mk("path", { class: "sil" }, g);
  const tabFold = mk("path", { class: "nf lo" }, g);
  const heart = mk("g", {}, g), halves = [];
  // Each lobe is a physical paper panel with a rounded tip and centre fold.
  for (const side of [1, -1]) {
    const outline = [[0, 0], [25, 23], [28, 35], [23, 46], [12, 49], [0, 39]];
    const shape = fillet(outline.map(([u, v]) => [side * u, v]), [1.2, 5, 7, 7, 7, 1.1], 7);
    const back = mk("path", { class: "lo" }, heart);
    const face = mk("path", { class: "sil hi" }, heart);
    halves.push({ shape, back, face });
  }
  const heartFold = mk("path", { class: "nf lo" }, heart);
  const coverRing = rrect(0, -54, 96, 54, 5, 7);
  const coverInner = rrect(1.5, -52.5, 94.5, 52.5, 3.5, 7);

  function draw(a) {
    if (a === last) return;
    last = a;
    const t = clamp((a - REST) / (148 - REST), 0, 1), s = Math.sin(rad(a)), c = Math.cos(rad(a));
    const lid = (u, v, back = 0) => P(u * c - back * s, v, Z + u * s + back * c);
    coverBack.setAttribute("d", poly(coverRing.map((q) => lid(q.u, q.v, TK))));
    coverFace.setAttribute("d", poly(coverRing.map((q) => lid(q.u, q.v))));
    coverCrease.setAttribute("d", open(run(coverInner, (q) => q.nu > 0 || q.nv > 0).map((q) => lid(q.u, q.v))));
    const rootX = 39 - 14 * t, rootZ = 12 + 8 * t;
    const spread = 0.82 + 0.18 * t, fold = 0.32 - 0.22 * t;
    const paper = (u, v, back = 0) => P(rootX + u * 0.55 * spread + Math.abs(u) * 0.84 * fold - back,
      -u * 0.84 * spread + Math.abs(u) * 0.55 * fold, rootZ + v * (0.88 + 0.12 * t));
    const foot = (u) => P(rootX, u, rootZ + 2);
    const round = (pts) => poly(fillet(pts, pts.map(() => 1.1), 4));
    tabBack.setAttribute("d", round([lid(47, -7), lid(47, 7), foot(7), foot(-7)]));
    tabFront.setAttribute("d", round([foot(-7), foot(7), P(66, 7, Z), P(66, -7, Z)]));
    tabFold.setAttribute("d", seg(foot(-5), foot(5)));
    for (const h of halves) {
      h.back.setAttribute("d", poly(h.shape.map(([u, v]) => paper(u, v, 0.8))));
      h.face.setAttribute("d", poly(h.shape.map(([u, v]) => paper(u, v))));
    }
    heartFold.setAttribute("d", seg(paper(0, 2), paper(0, 37)));
  }

  const loop = register(stage, (dt) => {
    const moving = stepS(angle, dt);
    draw(angle.x);
    return moving;
  });
  bag.add(loop.unregister);
  // Pick against the fixed rest envelope, never the moving cover or heart.
  const restPoints = [];
  for (const x of [0, 96]) for (const y of [-54, 54]) {
    restPoints.push(P(x, y, Z), P(x * Math.cos(rad(REST)), y, Z + x * Math.sin(rad(REST))));
  }
  const hit = hull(restPoints), a0 = P(0, 0, Z);
  const winding = Math.sign(hit.reduce((sum, p, i) => {
    const q = hit[(i + 1) % hit.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0));
  function target(p) {
    let active = false, amount = 0;
    if (p) {
      const distance = Math.min(...hit.map((q, i) => {
        const r = hit[(i + 1) % hit.length], dx = r[0] - q[0], dy = r[1] - q[1];
        return winding * (dx * (p[1] - q[1]) - dy * (p[0] - q[0])) / Math.hypot(dx, dy);
      }));
      active = distance > -15;
      const outer = clamp((p[0] - (a0[0] - 62)) / 155, 0, 1);
      const edge = clamp((distance + 15) / 15, 0, 1);
      amount = outer * edge;
    }
    angle.t = REST + clamp(reach * amount, 0, 148 - REST);
    coverFace.classList.toggle("hi", active);
    for (const h of halves) h.face.classList.toggle("hi", !active);
    read.textContent = active ? "cover" : "rest";
    loop.wake();
  }
  bag.add(pointer(stage, { move: (p) => { held = p; target(p); }, leave: () => { held = null; target(null); } }));
  bag.add(() => svg.replaceChildren());
  read.textContent = "rest";
  draw(REST);
  return { set: (v) => { reach = v; target(held); }, destroy: bag.dispose };
}

hairline({
  name: "greeting-heart",
  means: "A folded paper heart rises between a greeting card's pages as the pointer gently opens its cover.",
  rules: [1, 3, 4, 5, 6, 8, 9, 10],
  range: [38, 62, 82],
  tour: [[170, 195], [235, 199], [280, 205], null],
  mount,
});
