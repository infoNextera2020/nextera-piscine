/** Three sculpted keycaps on one low tray; the nearest cap lifts slightly. */
const {
  Cam, clamp, disposer, facing, fit, hull, mk, open, pointer, poly, prism,
  proj, put, register, ringAt, rings, rrect, run, solid, tdone, tset, tval, tween, unproj,
} = HL;

function mount({ stage, svg, read }, value) {
  const bag = disposer(), C = Cam(45, 0.5, 1.84), H = 23;
  let lift = value, active = -1;
  fit(C, [[-82,-34,0],[-82,34,0],[82,-34,0],[82,34,0],[-72,-24,49],[72,24,49]],200,172);
  const P = proj(C), front = facing(C), group = mk("g", {}, svg);
  const [base, inset] = rings(-82,-34,82,34,7,1.5);
  put(solid(group), prism(P,front,base,inset,1,6));
  const caps = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 52, [ring, inner] = rings(x-20,-25,x+20,25,6,1.6);
    const body = solid(group), z = tween(0);
    const samples = ring => ring.flatMap((q,j) => {
      const r = ring[(j+1)%ring.length];
      return Array.from({length:5},(_,k) => ({u:q.u+(r.u-q.u)*k/5,v:q.v+(r.v-q.v)*k/5,nu:q.nu,nv:q.nv}));
    });
    const depth = i === 0 ? -11 : i === 2 ? 11 : 0;
    const height = (u) => H + depth*(1-Math.pow((u-x)/20,2));
    caps.push({x,ring:samples(ring),inner:samples(inner),height,body,z,last:NaN,center:P(x,0,height(x))});
  }

  function draw(i, amount) {
    const cap = caps[i];
    if (cap.last === amount) return;
    cap.last = amount;
    const top = r => r.map(q => P(q.u,q.v,cap.height(q.u)+amount));
    const foot = ringAt(P,cap.ring,8+amount);
    const leftRight = pts => pts[0][0] < pts.at(-1)[0] ? pts : pts.slice().reverse();
    // Preserve the recessed profile: a hull would falsely fill its concavity.
    const far = leftRight(top(run(cap.ring,q => !front(q))));
    const near = leftRight(ringAt(P,run(cap.ring,front),8+amount));
    const sil = i === 0 ? poly([...far,...near.reverse()]) : poly(hull([...foot,...top(cap.ring)]));
    const crease = open(top(run(cap.inner,front)));
    put(cap.body,{sil,crease});
  }

  const loop = register(stage, (_dt,now) => {
    let moving = false;
    caps.forEach((cap,i) => {
      draw(i,tval(cap.z,now));
      if (!tdone(cap.z,now)) moving = true;
    });
    return moving;
  });
  bag.add(loop.unregister);

  // Hit-test only the static footprint and rest centres, never moving paths.
  function hit([sx,sy]) {
    const [x,y] = unproj(C,sx,sy,H);
    if (x < -84 || x > 84 || y < -39 || y > 39) return -1;
    let nearest = -1, distance = Infinity;
    caps.forEach((cap,i) => {
      const d = Math.hypot(sx-cap.center[0],sy-cap.center[1]);
      if (d < distance) { nearest = i; distance = d; }
    });
    return nearest;
  }

  function choose(next,force=false) {
    if (next === active && !force) return;
    active = next;
    const now = performance.now();
    caps.forEach((cap,i) => {
      tset(cap.z,i === active ? clamp(lift,3,7) : 0,now,0);
      cap.body.sil.classList.toggle("hi",i === (active < 0 ? 1 : active));
    });
    read.textContent = active < 0 ? "rest" : ["left","centre","right"][active];
    loop.wake();
  }
  bag.add(pointer(stage,{move:p => choose(hit(p)),leave:() => choose(-1)}));
  bag.add(() => svg.replaceChildren());
  caps.forEach((cap,i) => { draw(i,0); cap.body.sil.classList.toggle("hi",i === 1); });
  read.textContent = "rest";
  return {set:v => {lift=v;choose(active,true);},destroy:bag.dispose};
}

hairline({
  name: "q02-sign-label",
  means: "Three sculpted surfaces share one base; the nearest rises slightly, then settles when the pointer leaves.",
  rules: [1,3,4,5,6,7,8,9,10],
  range: [3,5,7],
  tour: [[135,145],[200,165],[265,185],null],
  mount,
});
