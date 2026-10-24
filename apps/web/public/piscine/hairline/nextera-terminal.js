/** NextEra Piscine: three working surfaces, one quiet engineering workstation.
 * Editor: an inset gutter and indented source rows. Terminal: sparse command
 * history and a caret. Result: a rendered page with a sidebar and content.
 * The letters live only in the read-out; this is decorative, never Judge data.
 */
const {
  Cam, clamp, facing, fit, hull, open, poly, prism, proj, ringAt, rings, rrect, run, seg,
  spring, stepS, tween, tset, tval, tdone, disposer, mk, solid, put, pointer, register,
} = HL;

function mount({ stage, svg, read }, value) {
  const bag = disposer(), C = Cam(45, 0.5, 1.6);
  const W = 96, H = 62, names = ["EDIT", "RUN", "RESULT"];
  const rest = [[-6, 28, 18], [5, 10, 27], [16, -8, 36]];
  const bounds = [[0, -12, -3], [110, -12, -3], [0, 84, -3], [110, 84, -3]];
  rest.forEach(([x, y, z], i) => {
    for (const gap of [0, 28]) for (const u of [0, W]) for (const v of [0, H]) {
      bounds.push([x + u + (i - 1) * gap * .85,
        y - v * .26 - (i - 1) * gap * 1.15, z + v * .966 + i * gap * .45 + 6]);
    }
  });
  fit(C, bounds, 200, 166);
  const P = proj(C), front = facing(C), g = mk("g", {}, svg);
  const block = (x0, y0, x1, y1, radius, z0, z1) => {
    const [ring, inner] = rings(x0, y0, x1, y1, radius, 1.2);
    const s = solid(g); put(s, prism(P, front, ring, inner, z0, z1)); return s;
  };
  block(0, -12, 110, 84, 6, -3, 1);
  block(14, 9, 96, 31, 4, 1, 10);
  block(20, 15, 90, 24, 3, 10, 17);
  const deck = (ring) => poly(ringAt(P, ring, 1.2));
  mk("path", { d: deck(rrect(15, 36, 95, 60, 3, 5)), class: "nf lo" }, g);
  let keys = "";
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
    const x = 21 + col * 14, y = 41 + row * 7;
    keys += seg(P(x, y, 1.3), P(x + 8, y, 1.3));
  }
  mk("path", { d: keys, class: "nf lo" }, g);
  mk("path", { d: deck(rrect(42, 66, 72, 78, 2.6, 5)), class: "nf lo" }, g);

  // The rear plate is painted first; opaque faces keep every overlap honest.
  const plates = [], ring = rrect(0, 0, W, H, 3.6, 6);
  const inner = rrect(1.1, 1.1, W - 1.1, H - 1.1, 2.5, 6);
  for (let i = 2; i >= 0; i--) {
    const group = mk("g", {}, g), body = solid(group);
    const head = mk("path", { class: "nf lo" }, group);
    const detail = mk("path", { class: "nf lo" }, group);
    plates[i] = { body, head, detail, spread: tween(0), pick: tween(0), last: "" };
  }
  let limit = clamp(value, 8, 28), active = -1, lastPoint = null;
  const reach = spring(.6);

  function draw(i, gap, selected) {
    const plate = plates[i], stamp = [gap, selected].join(",");
    if (stamp === plate.last) return;
    plate.last = stamp;
    const [x, y, z] = rest[i];
    const Q = (u, v, depth = 0) => P(x + u + (i - 1) * gap * .85,
      y - v * .26 - (i - 1) * gap * 1.15 - depth * .966,
      z + v * .966 + i * gap * .45 + selected * 6 - depth * .26);
    const face = ring.map(({u, v}) => Q(u, v));
    const back = ring.map(({u, v}) => Q(u, v, 1.4));
    put(plate.body, { sil: poly(hull(face.concat(back))),
      crease: open(run(inner, ({v}) => v < H / 2).map(({u, v}) => Q(u, v))) });
    plate.head.setAttribute("d", seg(Q(6, H - 10), Q(W - 6, H - 10)));
    let d = "";
    const line = (a, b, c, e) => { d += seg(Q(a, b), Q(c, e)); };
    const rect = (a, b, c, e, r) => {
      d += poly(rrect(a, b, c, e, r, 5).map(({u, v}) => Q(u, v)));
    };
    // Three short tab seams belong to the window chrome, not to a logo.
    line(7, H - 5, 16, H - 5); line(20, H - 5, 27, H - 5);
    if (i === 0) {
      line(17, 9, 17, 45);
      [[25,43,60],[31,35,77],[31,27,65],[25,19,72],[25,11,48]].forEach(([a,b,c]) => line(a,b,c,b));
      line(80, 27, 87, 27);
    } else if (i === 1) {
      [[39,43,85],[39,30,78],[39,17,70]].forEach(([a,b,c]) => {
        line(a,b,a+4,b); line(a+12,b,c,b);
      });
      line(79, 14, 79, 21);
    } else {
      rect(8, 8, 88, 45, 2.2); line(27, 8, 27, 45);
      line(35, 36, 77, 36); line(35, 29, 64, 29);
      rect(35, 15, 52, 22, 1.2); rect(58, 15, 78, 22, 1.2);
    }
    plate.detail.setAttribute("d", d);
  }

  // Test the three fixed rest faces, front first, with a small edge allowance.
  const ex0 = P(0,0,0), ex1 = P(1,0,0);
  const ex = [ex1[0]-ex0[0], ex1[1]-ex0[1]];
  const ev1 = P(0,-.26,.966), ev = [ev1[0]-ex0[0],ev1[1]-ex0[1]];
  const faceDet = ex[0]*ev[1]-ex[1]*ev[0];
  const feet = rest.map(([x,y,z]) => P(x,y,z));
  function hit([x,y]) {
    for (let i=0;i<3;i++) {
      const dx=x-feet[i][0], ddy=y-feet[i][1];
      const u=(dx*ev[1]-ddy*ev[0])/faceDet, v=(ex[0]*ddy-ex[1]*dx)/faceDet;
      if (u >= -2 && u <= W+2 && v >= -2 && v <= H+2) return i;
    }
    return -1;
  }
  const B = register(stage, (dt, now) => {
    let moving = stepS(reach, dt);
    plates.forEach((plate,i) => {
      const spread = tval(plate.spread,now), selected = tval(plate.pick,now);
      draw(i, clamp(reach.x,0,1) * limit * spread, selected);
      if (!tdone(plate.spread,now) || !tdone(plate.pick,now)) moving = true;
    });
    return moving;
  });
  bag.add(B.unregister);

  function respond(p) {
    lastPoint = p;
    const a = p ? hit(p) : -1;
    reach.t = p ? clamp((p[0]-80)/220,.24,1) : .6;
    if (a !== active) {
      const from = a < 0 ? active : a, now = performance.now();
      active = a;
      plates.forEach((plate,i) => {
        const delay = Math.abs(i-from)*45;
        tset(plate.spread, a < 0 ? 0 : 1-Math.abs(i-a)*.18, now, delay);
        tset(plate.pick, i === a ? 1 : 0, now, delay);
        plate.body.sil.classList.toggle("hi", i === (a < 0 ? 0 : a));
      });
      read.textContent = a < 0 ? "rest" : names[a];
    }
    B.wake();
  }
  plates.forEach((plate,i) => { draw(i,0,0); plate.body.sil.classList.toggle("hi",i===0); });
  read.textContent = "rest";
  bag.add(pointer(stage,{ move: respond, leave: () => respond(null) }));
  bag.add(() => svg.replaceChildren());
  return {
    set: (v) => { limit = clamp(v,8,28); respond(lastPoint); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "nextera-terminal",
  means: "NextEra Piscine: a decorative workstation unfolds from source to command to rendered output.",
  rules: [1, 2, 4, 5, 8, 9, 10],
  range: [8, 18, 28],
  tour: [[174, 140], [207, 119], [241, 97], null],
  mount,
});
