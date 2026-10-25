/** Original NextEra UI object drawn using Hairline Create. Static UI exports keep this figure's rest geometry. */
const {Cam,fit,proj,facing,rings,prism,ringAt,run,hull,poly,open,solid,put,mk,spring,stepS,clamp,disposer,pointer,register}=HL;
function box(x,y,w,d,z,h,r){const [ring,inner]=rings(x,y,x+w,y+d,r,Math.min(1.1,r*.4));return {ring,inner,z,z1:z+h};}
function parts(a){return [box(-4,-2,88,28,0,5,3),box(0,0,10,20,5,60,3),box(70,0,10,20,5,60,3),box(0,0,80,20,65,7,3),box(16+a,19,48,5,38,5,2)];}
function mount({stage,svg,read},value){
 const bag=disposer(),C=Cam(45,.5,2.75),rest=parts(0),extreme=parts(12);
 const points=rest.concat(extreme).flatMap(p=>p.ring.flatMap(q=>[[q.u,q.v,p.z],[q.u,q.v,p.z1]]));
 fit(C,points,200,166);const P=proj(C),front=facing(C),group=mk('g',{},svg);
 const pieces=rest.map(()=>solid(group)),centres=rest.map(p=>{const x=p.ring.reduce((s,q)=>s+q.u,0)/p.ring.length,y=p.ring.reduce((s,q)=>s+q.v,0)/p.ring.length;return P(x,y,p.z1);});
 const response=spring(0);let strength=value,selected=-1,last=NaN;
 function draw(a){
  const shapes=parts(a);shapes.forEach((p,i)=>{const q=p.top?{sil:poly(hull(ringAt(P,p.ring,p.z).concat(ringAt(P,p.top,p.z1)))),crease:open(ringAt(P,run(p.inner,front),p.z1))}:prism(P,front,p.ring,p.inner,p.z,p.z1);put(pieces[i],q);pieces[i].sil.classList.toggle('hi',i===(selected<0?pieces.length-1:selected));});
  last=a;
 }
 draw(0);read.textContent='rest';
 const loop=register(stage,dt=>{const moving=stepS(response,dt);if(!Number.isFinite(last)||Math.abs(response.x-last)>.0001)draw(response.x);return moving;});bag.add(loop.unregister);
 function choose(p){const distances=centres.map(c=>Math.hypot(c[0]-p[0],c[1]-p[1])),distance=Math.min(...distances);selected=distance<80?distances.indexOf(distance):-1;response.t=selected<0?0:clamp((1-distance/80)*strength,0,12);read.textContent=selected<0?'rest':'part '+(selected+1);draw(response.x);loop.wake();}
 bag.add(pointer(stage,{move:choose,leave:()=>{selected=-1;response.t=0;read.textContent='rest';draw(response.x);loop.wake();}}));bag.add(()=>svg.replaceChildren());
 return {set:v=>{strength=v;},destroy:bag.dispose};
}
hairline({name:'checkpoint',means:'A checkpoint gate: the latch slides across its fixed frame.',rules:[1,3,4,5,6,7,8,9,10],range:[0,6.0,12],tour:[[150,170],[210,130],[250,180],null],mount});
