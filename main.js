/* DECISIONES: Canvas 2D (rinde con muchas entidades); bucle con dt fijo máximo;
   entidades con registro de especies (SPECIES) para añadir nuevas sin tocar el motor;
   FSM por animal (wander/seek|chase/eat|attack/dead); rejilla espacial para percepción;
   muertos se desvanecen y se purgan de la lista; todo parámetro vive en CONFIG.
   Mejora: el herbívoro come hasta saciarse o agotar la planta. */

// ===== CONFIG =====
const CONFIG={
 world:{width:1000,height:640,margin:30},
 sim:{speed:1},
 day:{enabled:true,length:120},
 sound:{enabled:true,volume:.5},
 grid:{cell:60},
 anim:{sizeEase:4,deathTime:.5},
 plant:{initial:60,spawnInterval:.25,max:220,hp0:2,hpMax:20,growth:1.5,rMin:3,rMax:11,kinds:[
  {name:'hierba',shape:'grass',color:'#5faa3c',weight:5,hpMax:12,rMax:9,growthMul:1.6,nutrition:.8},
  {name:'arbusto',shape:'bush',color:'#2f7d3a',weight:3,hpMax:24,rMax:12,growthMul:1,nutrition:1},
  {name:'flor',shape:'flower',color:'#e8639a',weight:1.5,hpMax:16,rMax:9,growthMul:.8,nutrition:1.8},
  {name:'seta',shape:'mushroom',color:'#c8372d',weight:1,hpMax:30,rMax:10,growthMul:.6,nutrition:2.4}]},
 herbivore:{initial:30,speed:55,turnRate:3,hp0:40,hpMax:80,perception:90,moveCost:.03,eatRate:10,eatGain:1.6,rMin:5,rMax:11,foodToBreed:5,layEggs:true,huntBelow:.4,huntMul:1.5,attackTime:.8,huntGain:50,minPopulation:14,refillInterval:2,max:140,color:'#c99a5b',kinds:[
  {name:'ciervo',color:'#c99a5b',weight:4,size:1,hp:1,spd:1,per:1},
  {name:'conejo',color:'#d8d2c4',weight:3,size:.7,hp:.6,spd:1.3,per:1.3},
  {name:'bisonte',color:'#6b4a32',weight:1.5,size:1.35,hp:1.6,spd:.75,per:.85}]},
 egg:{initial:0,hatchTime:8,hp0:1,hpMax:1,rMin:4,rMax:4,color:'#f1e8d0'},
 carnivore:{initial:7,speed:60,chaseMul:1.6,turnRate:3.5,hp0:100,hpMax:180,perception:180,fov:45,moveCost:.03,attackTime:.9,attackGain:60,rMin:7,rMax:15,foodToBreed:5,max:40,color:'#8b8f98',kinds:[
  {name:'lobo',color:'#8b8f98',weight:4,size:1,hp:1,spd:1,per:1},
  {name:'zorro',color:'#d9803a',weight:3,size:.75,hp:.7,spd:1.2,per:1.1},
  {name:'oso',color:'#5a3d2b',weight:1.5,size:1.4,hp:1.7,spd:.85,per:.9}]},
 player:{initial:0,speed:125,turnRate:12,hp0:200,hpMax:300,perception:0,moveCost:.01,eatRate:28,eatGain:1.8,rMin:11,rMax:20,foodToBreed:3,layEggs:true,huntGain:60,maxKills:7,shotSpeed:320,shotDamage:45,shotCooldown:.35,reach:14,dashMul:2.5,dashTime:.4,dashCooldown:3,immune:true,color:'#4aa3e8'}
};

// ===== Utilidades matemáticas =====
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const rand=(a,b)=>a+Math.random()*(b-a);
const angleDiff=(a,b)=>{let d=(a-b+Math.PI)%(2*Math.PI);if(d<0)d+=2*Math.PI;return d-Math.PI};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
// Vida -> tamaño visual (configurable y acotado)
const sizeFromHp=(hp,c)=>lerp(c.rMin,c.rMax,clamp(hp/c.hpMax,0,1));

// ===== Sonido: sintetizado con Web Audio (sin archivos), con paneo según la posición =====
const Sound={
 ctx:null,last:{},
 gaps:{crunch:.07,chomp:.12,gulp:.15,pop:.1,plop:.1,zap:.06,whoosh:.3},
 init(){
  if(!this.ctx){try{
   const C=window.AudioContext||window.webkitAudioContext;this.ctx=new C();this.master=this.ctx.createGain();this.master.connect(this.ctx.destination);
   const n=this.ctx.sampleRate*.4,b=this.ctx.createBuffer(1,n,this.ctx.sampleRate),d=b.getChannelData(0);
   for(let i=0;i<n;i++)d[i]=Math.random()*2-1;this.noise=b;
  }catch(e){this.ctx=null}}
  if(this.ctx&&this.ctx.state==='suspended')this.ctx.resume();
 },
 out(x){
  const c=this.ctx,g=c.createGain();
  if(c.createStereoPanner){const p=c.createStereoPanner();p.pan.value=clamp((x/CONFIG.world.width*2-1)*.8,-1,1);g.connect(p);p.connect(this.master)}
  else g.connect(this.master);
  return g;
 },
 tone(g,t,type,f0,f1,dur,vol){
  const c=this.ctx,o=c.createOscillator(),e=c.createGain();o.type=type;
  o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+dur);
  e.gain.setValueAtTime(vol,t);e.gain.exponentialRampToValueAtTime(.001,t+dur);
  o.connect(e);e.connect(g);o.start(t);o.stop(t+dur+.02);
 },
 burst(g,t,ftype,freq,q,dur,vol,f1){
  const c=this.ctx,s=c.createBufferSource(),f=c.createBiquadFilter(),e=c.createGain();
  s.buffer=this.noise;f.type=ftype;f.frequency.setValueAtTime(freq,t);if(f1)f.frequency.exponentialRampToValueAtTime(f1,t+dur);f.Q.value=q;
  e.gain.setValueAtTime(vol,t);e.gain.exponentialRampToValueAtTime(.001,t+dur);
  s.connect(f);f.connect(e);e.connect(g);s.start(t,Math.random()*.2);s.stop(t+dur+.02);
 },
 play(name,x=500){
  const S=CONFIG.sound;if(!S.enabled||!this.ctx)return;
  const t=this.ctx.currentTime;
  if(t-(this.last[name]||0)<this.gaps[name])return;this.last[name]=t;
  this.master.gain.value=S.volume;const g=this.out(x);
  switch(name){
  case'crunch':this.burst(g,t,'bandpass',rand(1800,3200),2.5,.05,.9);this.burst(g,t+.07,'bandpass',rand(1500,2800),2.5,.05,.7);this.tone(g,t,'triangle',rand(500,700),200,.06,.15);break;
  case'chomp':this.burst(g,t,'lowpass',900,1,.14,.9,200);this.tone(g,t,'sine',200,55,.18,.7);this.burst(g,t+.1,'bandpass',2200,3,.04,.4);break;
  case'gulp':this.tone(g,t,'sine',320,120,.14,.5);break;
  case'pop':this.tone(g,t,'sine',380,1100,.09,.5);this.tone(g,t+.07,'sine',700,1500,.08,.3);break;
  case'plop':this.tone(g,t,'sine',420,160,.1,.4);break;
  case'zap':this.tone(g,t,'square',1000,180,.09,.12);break;
  case'whoosh':this.burst(g,t,'bandpass',400,1.2,.3,.6,2500);break;
  }
 }
};

// ===== Rejilla espacial =====
class Grid{
 constructor(cell){this.c=cell;this.m=new Map()}
 clear(){this.m.clear()}
 add(e){const k=(e.x/this.c|0)+','+(e.y/this.c|0);let a=this.m.get(k);if(!a)this.m.set(k,a=[]);a.push(e)}
 query(x,y,r,fn){const c=this.c;
  for(let i=(x-r)/c|0;i<=(x+r)/c|0;i++)for(let j=(y-r)/c|0;j<=(y+r)/c|0;j++){
   const a=this.m.get(i+','+j);if(a)for(const e of a)fn(e)}}
}

// ===== Entidades =====
class Entity{
 constructor(world,x,y,cfg,hp){
  this.w=world;this.cfg=cfg;this.x=x;this.y=y;this.hp=hp;
  this.state='spawn';this.alive=true;this.gone=false;this.t=0;this.deathT=0;
  this.r=sizeFromHp(hp,cfg);
 }
 targetR(){return sizeFromHp(this.hp,this.cfg)}
 update(dt){
  this.t+=dt;
  this.r+=(this.targetR()-this.r)*Math.min(1,CONFIG.anim.sizeEase*dt);
  if(!this.alive){this.deathT+=dt;if(this.deathT>=CONFIG.anim.deathTime)this.gone=true;return}
  this.think(dt);
 }
 die(cause){
  if(!this.alive)return;
  this.alive=false;this.state='dead';this.hp=Math.max(this.hp,0);
  this.w.stats.dead++;if(cause)this.w.stats[cause]++;
  this.w.puff(this.x,this.y,this.cfg.color,10);
 }
}

const pickKind=(ks=CONFIG.plant.kinds)=>{let t=rand(0,ks.reduce((a,k)=>a+k.weight,0));for(const k of ks)if((t-=k.weight)<=0)return k;return ks[0]};
class Plant extends Entity{
 static type='plant';
 constructor(w,x,y){const k=pickKind();super(w,x,y,{...CONFIG.plant,hpMax:k.hpMax,rMax:k.rMax},CONFIG.plant.hp0);this.kind=k;this.ph=rand(0,7);this.state='grow';this.r=CONFIG.plant.rMin*.4}
 think(dt){this.hp=Math.min(this.cfg.hpMax,this.hp+CONFIG.plant.growth*this.kind.growthMul*dt)}
 bite(amount){const taken=Math.min(amount,this.hp);this.hp-=taken;if(this.hp<=0.001)this.die();return taken*this.kind.nutrition}
}

class Animal extends Entity{
 constructor(w,x,y,cfg){
  super(w,x,y,cfg,cfg.hp0);
  this.heading=rand(0,Math.PI*2);this.wanderT=0;this.wanderTo=this.heading;
  this.target=null;this.senseT=Math.random()*.2;this.state='wander';this.moving=false;this.food=0;
 }
 validTarget(){return this.target&&this.target.alive}
 turnTo(angle,dt){
  const d=angleDiff(angle,this.heading),m=this.cfg.turnRate*dt;
  this.heading+=clamp(d,-m,m);
 }
 steerWander(dt){
  const W=CONFIG.world,m=W.margin;
  if(this.x<m||this.y<m||this.x>W.width-m||this.y>W.height-m){
   this.wanderTo=Math.atan2(W.height/2-this.y,W.width/2-this.x);this.wanderT=.5;
  }else if((this.wanderT-=dt)<=0){
   this.wanderTo=this.heading+rand(-1.2,1.2);this.wanderT=rand(.6,1.6);
  }
  this.turnTo(this.wanderTo,dt);
 }
 move(dt,speed){
  const W=CONFIG.world,px=this.x,py=this.y;
  this.x=clamp(px+Math.cos(this.heading)*speed*dt,0,W.width);
  this.y=clamp(py+Math.sin(this.heading)*speed*dt,0,W.height);
  this.moving=true;
  this.hp-=Math.hypot(this.x-px,this.y-py)*this.cfg.moveCost; // coste por distancia
  if(this.hp<=0)this.die('starved');
 }
 loseTarget(){this.target=null;this.state='wander'}
 spawnHerbivore(){ // nace un herbívoro nuevo por cada carnívoro comido
  const w=this.w,W=CONFIG.world;
  if(w.counts.herbivore+w.counts.egg>=CONFIG.herbivore.max)return;
  w.spawn('herbivore',clamp(this.x+rand(-14,14),0,W.width),clamp(this.y+rand(-14,14),0,W.height));w.counts.herbivore++;
 }
 eatFood(){if(++this.food>=this.cfg.foodToBreed){this.food=0;this.breed()}}
 breed(){ // nace una cría de la misma especie (límite de población en CONFIG)
  const W=CONFIG.world,t=this.constructor.type,w=this.w;
  if(w.counts[t]+(this.cfg.layEggs?w.counts.egg:0)>=CONFIG[t].max)return;
  const x=clamp(this.x+rand(-14,14),0,W.width),y=clamp(this.y+rand(-14,14),0,W.height);
  if(this.cfg.layEggs){w.spawn('egg',x,y);w.counts.egg++;Sound.play('plop',x)}else{w.spawn(t,x,y);w.counts[t]++}
 }
}

// Config de una variante: hereda de la base (los sliders siguen funcionando) y escala sus rasgos
function speciesCfg(base,k){
 const c=Object.create(base);c.color=k.color;c.rMin=base.rMin*k.size;c.rMax=base.rMax*k.size;c.hpMax=base.hpMax*k.hp;c.hp0=base.hp0*k.hp;
 Object.defineProperty(c,'speed',{get:()=>base.speed*k.spd});Object.defineProperty(c,'perception',{get:()=>base.perception*k.per});
 return c;
}
class Herbivore extends Animal{
 static type='herbivore';
 constructor(w,x,y){const k=pickKind(CONFIG.herbivore.kinds);super(w,x,y,speciesCfg(CONFIG.herbivore,k));this.kind=k}
 findCarnivore(){ // solo ataca carnívoros débiles (poca vida)
  let best=null,bd=1e9;const c=this.cfg;
  this.w.grids.carnivore.query(this.x,this.y,c.perception,k=>{
   if(!k.alive||k.hp>k.cfg.hpMax*c.huntBelow)return;
   const d=dist(this,k);if(d<=c.perception&&d<bd){bd=d;best=k}});
  return best;
 }
 findPlant(){
  let best=null,bd=1e9;
  this.w.grids.plant.query(this.x,this.y,this.cfg.perception,p=>{
   if(!p.alive)return;const d=dist(this,p);
   if(d<=this.cfg.perception&&d<bd){bd=d;best=p}});
  return best;
 }
 think(dt){
  this.moving=false;const c=this.cfg;
  switch(this.state){
  case'wander':
   this.steerWander(dt);this.move(dt,c.speed);
   if((this.senseT-=dt)<=0){this.senseT=.2;const k=this.findCarnivore();if(k){this.target=k;this.state='hunt'}else{const p=this.findPlant();if(p){this.target=p;this.state='seek'}}}
   break;
  case'seek':
   if(!this.validTarget())return this.loseTarget();
   this.turnTo(Math.atan2(this.target.y-this.y,this.target.x-this.x),dt);
   this.move(dt,c.speed);
   if(dist(this,this.target)<=this.r+this.target.r*.8)this.state='eat';
   break;
  case'hunt':
   if(!this.validTarget()||dist(this,this.target)>c.perception*1.4)return this.loseTarget();
   this.turnTo(Math.atan2(this.target.y-this.y,this.target.x-this.x),dt);
   this.move(dt,c.speed*c.huntMul);
   if(dist(this,this.target)<=this.r+this.target.r){this.state='attack';this.attackT=0;this.target.die('eaten');Sound.play('chomp',this.x)}
   break;
  case'attack':
   this.attackT+=dt;
   if(this.attackT>=c.attackTime){this.hp=Math.min(c.hpMax,this.hp+c.huntGain);Sound.play('gulp',this.x);this.spawnHerbivore();this.loseTarget()}
   break;
  case'eat': // quieto: sin coste de movimiento
   if(!this.validTarget()||this.hp>=c.hpMax)return this.loseTarget();
   if((this.biteT=(this.biteT||0)-dt)<=0){this.biteT=.28;Sound.play('crunch',this.x)} // mordisco
   this.hp=Math.min(c.hpMax,this.hp+this.target.bite(c.eatRate*dt)*c.eatGain);
   if(!this.target.alive){this.eatFood();this.loseTarget()}
   break;
  }
 }
}

class Carnivore extends Animal{
 static type='carnivore';
 constructor(w,x,y){const k=pickKind(CONFIG.carnivore.kinds);super(w,x,y,speciesCfg(CONFIG.carnivore,k));this.kind=k;this.attackT=0}
 findPrey(){ // cono: distancia + ángulo mediante producto escalar
  const c=this.cfg,cosHalf=Math.cos(c.fov*Math.PI/360),hx=Math.cos(this.heading),hy=Math.sin(this.heading);
  let best=null,bd=1e9;
  this.w.grids.herbivore.query(this.x,this.y,c.perception,h=>{
   if(!h.alive||h.cfg.immune)return;
   const dx=h.x-this.x,dy=h.y-this.y,d=Math.hypot(dx,dy);
   if(d>c.perception||d<1e-6)return;
   if((dx*hx+dy*hy)/d>=cosHalf&&d<bd){bd=d;best=h}});
  return best;
 }
 think(dt){
  this.moving=false;const c=this.cfg;
  switch(this.state){
  case'wander':
   this.steerWander(dt);this.move(dt,c.speed);
   if((this.senseT-=dt)<=0){this.senseT=.1;const p=this.findPrey();if(p){this.target=p;this.state='chase'}}
   break;
  case'chase':
   if(!this.validTarget()||dist(this,this.target)>c.perception*1.4)return this.loseTarget();
   this.turnTo(Math.atan2(this.target.y-this.y,this.target.x-this.x),dt);
   this.move(dt,c.speed*c.chaseMul);
   if(dist(this,this.target)<=this.r+this.target.r){
    this.state='attack';this.attackT=0;this.target.die('eaten');Sound.play('chomp',this.x);
   }
   break;
  case'attack':
   this.attackT+=dt;
   if(this.attackT>=c.attackTime){this.hp=Math.min(c.hpMax,this.hp+c.attackGain);Sound.play('gulp',this.x);this.eatFood();this.loseTarget()}
   break;
  }
 }
}

// Huevo: eclosiona en un herbívoro tras CONFIG.egg.hatchTime segundos
class Egg extends Entity{
 static type='egg';
 constructor(w,x,y){super(w,x,y,CONFIG.egg,CONFIG.egg.hp0);this.state='incubating'}
 think(){if(this.t>=CONFIG.egg.hatchTime){this.alive=false;this.gone=true;this.w.puff(this.x,this.y,'#fff3c4',12);Sound.play('pop',this.x);this.w.spawn('herbivore',this.x,this.y)}}
}

// Herbívoro mejorado controlado por el usuario (teclado WASD/flechas o arrastrar sobre el escenario)
const KEYS={shoot:0,dash:0,up:0,down:0,left:0,right:0,pointer:null};
class Player extends Animal{
 static type='herbivore'; // comparte rejilla y conteo con los herbívoros: los carnívoros pueden cazarlo
 constructor(w,x,y){super(w,x,y,CONFIG.player);this.dashT=0;this.cool=0;this.kills=0;this.shotCool=0}
 targetR(){return sizeFromHp(this.hp,this.cfg)*(1+this.kills*.12)} // crece con cada presa
 think(dt){
  const c=this.cfg;this.moving=false;
  let ix=KEYS.right-KEYS.left,iy=KEYS.down-KEYS.up;
  if(KEYS.pointer&&!ix&&!iy){const dx=KEYS.pointer.x-this.x,dy=KEYS.pointer.y-this.y;if(Math.hypot(dx,dy)>8){ix=dx;iy=dy}}
  if(KEYS.dash&&this.cool<=0){this.dashT=c.dashTime;this.cool=c.dashCooldown;Sound.play('whoosh',this.x)}
  KEYS.dash=0;this.cool-=dt;this.dashT-=dt;this.shotCool-=dt;
  if(KEYS.shoot&&this.shotCool<=0){this.shotCool=c.shotCooldown;this.w.shoot(this.x,this.y,this.heading,this.r)}
  if(ix||iy)this.heading=Math.atan2(iy,ix);
  if(ix||iy||this.dashT>0)this.move(dt,c.speed*(this.dashT>0?c.dashMul:1));
  if(!this.alive)return;
  let eating=false;
  this.w.grids.plant.query(this.x,this.y,this.r+CONFIG.plant.rMax+c.reach,p=>{
   if(!p.alive||dist(this,p)>this.r+p.r+c.reach)return;
   eating=true;this.hp=Math.min(c.hpMax,this.hp+p.bite(c.eatRate*dt)*c.eatGain);
   if(!p.alive)this.eatFood();
  });
  if(eating&&(this.biteT=(this.biteT||0)-dt)<=0){this.biteT=.25;Sound.play('crunch',this.x)}
  this.w.grids.carnivore.query(this.x,this.y,this.r+CONFIG.carnivore.rMax+c.reach,k=>{
   if(!this.alive||!k.alive||dist(this,k)>this.r+k.r+c.reach)return;
   k.die('eaten');Sound.play('chomp',this.x);this.hp=Math.min(c.hpMax,this.hp+c.huntGain);this.spawnHerbivore();
   if(++this.kills>=c.maxKills)this.die(); // muere al cazar demasiados
  });
  this.state=eating?'eat':this.moving?'move':'idle';
 }
}

// Registro de especies: añadir una nueva = registrar su clase aquí
const SPECIES={plant:Plant,herbivore:Herbivore,carnivore:Carnivore,player:Player,egg:Egg};

// ===== Mundo =====
class World{
 constructor(){this.grids={};for(const k in SPECIES)this.grids[k]=new Grid(CONFIG.grid.cell);this.reset()}
 reset(){
  this.list=[];this.parts=[];this.shots=[];this.clock=0;this.spawnT=0;this.refillT=0;this.stats={dead:0,starved:0,eaten:0};this.counts={plant:0,herbivore:0,carnivore:0};
  for(const k in SPECIES)for(let i=0;i<CONFIG[k].initial;i++)this.spawn(k);
  for(const e of this.list)if(e instanceof Plant){e.hp=rand(CONFIG.plant.hp0,e.cfg.hpMax*.6);e.r=sizeFromHp(e.hp,e.cfg)}
 }
 spawn(type,x=rand(10,CONFIG.world.width-10),y=rand(10,CONFIG.world.height-10)){
  const e=new SPECIES[type](this,x,y);this.list.push(e);return e;
 }
 puff(x,y,col,n=8){ // partículas
  for(let i=0;i<n;i++){const a=rand(0,7),v=rand(10,40);this.parts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-10,life:0,max:rand(.5,.9),col,r:rand(1.2,3)})}
 }
 shoot(x,y,a,r){const v=CONFIG.player.shotSpeed;Sound.play('zap',x);this.shots.push({x:x+Math.cos(a)*r*1.4,y:y+Math.sin(a)*r*1.4,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:0})}
 night(){const d=CONFIG.day;return d.enabled?clamp(.5-.65*Math.cos(this.clock/d.length*2*Math.PI),0,1):0}
 update(dt){
  for(const k in this.grids){this.grids[k].clear();this.counts[k]=0}
  for(const e of this.list)if(e.alive){const k=e.constructor.type;this.grids[k].add(e);this.counts[k]++}
  const H=CONFIG.herbivore; // población mínima: si hay menos, llegan herbívoros nuevos
  if(this.counts.herbivore+this.counts.egg<H.minPopulation&&(this.refillT-=dt)<=0){this.refillT=H.refillInterval;this.spawn('herbivore');this.counts.herbivore++}
  this.spawnT+=dt;
  while(this.spawnT>=CONFIG.plant.spawnInterval){
   this.spawnT-=CONFIG.plant.spawnInterval;
   if(this.counts.plant<CONFIG.plant.max){this.spawn('plant');this.counts.plant++}
  }
  for(const e of this.list)e.update(dt);
  this.clock+=dt;
  const W=CONFIG.world;
  for(const b of this.shots){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life+=dt;
   this.grids.carnivore.query(b.x,b.y,24,k=>{
    if(b.life>5||!k.alive||dist(b,k)>k.r+4)return;
    k.hp-=CONFIG.player.shotDamage;this.puff(b.x,b.y,'#9fe0ff',6);b.life=99;if(k.hp<=0)k.die();
   })}
  this.shots=this.shots.filter(b=>b.life<1.4&&b.x>0&&b.x<W.width&&b.y>0&&b.y<W.height);
  for(const p of this.parts){p.life+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt}
  this.parts=this.parts.filter(p=>p.life<p.max);
  this.list=this.list.filter(e=>!e.gone); // purga de muertos
 }
}

// ===== Renderizado =====
class Renderer{
 constructor(canvas){this.cv=canvas;this.ctx=canvas.getContext('2d');this.makeBg();this.natureBg=this.bg;this.resize()}
 makeBg(){ // terreno procedural pre-renderizado
  const W=CONFIG.world,c=document.createElement('canvas');c.width=W.width;c.height=W.height;const g=c.getContext('2d');
  const base=g.createLinearGradient(0,0,0,W.height);base.addColorStop(0,'#7fa860');base.addColorStop(1,'#5e8a47');
  g.fillStyle=base;g.fillRect(0,0,W.width,W.height);
  for(let i=0;i<140;i++){const x=rand(0,W.width),y=rand(0,W.height),r=rand(30,110),q=Math.random(),
   col=q<.3?'150,120,70':q<.65?'60,110,50':'150,185,100',gr=g.createRadialGradient(x,y,0,x,y,r);
   gr.addColorStop(0,'rgba('+col+',.28)');gr.addColorStop(1,'rgba('+col+',0)');g.fillStyle=gr;g.fillRect(x-r,y-r,2*r,2*r)}
  g.strokeStyle='rgba(40,80,30,.35)';
  for(let i=0;i<1500;i++){const x=rand(0,W.width),y=rand(0,W.height);g.beginPath();g.moveTo(x,y);g.lineTo(x+rand(-2,2),y-rand(3,7));g.stroke()}
  g.lineCap='round'; // sendero
  for(const[w,col]of[[46,'rgba(165,135,85,.35)'],[28,'rgba(200,170,120,.3)']]){g.lineWidth=w;g.strokeStyle=col;g.beginPath();g.moveTo(-20,520);g.bezierCurveTo(250,380,420,600,620,420);g.bezierCurveTo(760,300,900,360,1020,200);g.stroke()}
  for(let i=0;i<220;i++){g.fillStyle=['#fff','#f7e26b','#c9a0ff','#ff9db8'][i%4];g.globalAlpha=.8;g.beginPath();g.arc(rand(0,W.width),rand(0,W.height),rand(.8,1.8),0,7);g.fill()}
  g.globalAlpha=1;
  for(let i=0;i<18;i++){const x=rand(20,W.width-20),y=rand(20,W.height-20),r=rand(6,15);
   g.fillStyle='rgba(0,0,0,.25)';g.beginPath();g.ellipse(x+r*.2,y+r*.5,r*1.2,r*.6,0,0,7);g.fill();
   const gr=g.createRadialGradient(x-r*.3,y-r*.4,1,x,y,r*1.1);gr.addColorStop(0,'#c5c8c0');gr.addColorStop(1,'#6d716b');
   g.fillStyle=gr;g.beginPath();g.ellipse(x,y,r*1.1,r*.8,.2,0,7);g.fill()}
  const v=document.createElement('canvas');v.width=W.width;v.height=W.height;const vg=v.getContext('2d'),vr=vg.createRadialGradient(W.width/2,W.height/2,W.height*.35,W.width/2,W.height/2,W.width*.62);
  vr.addColorStop(0,'rgba(0,0,0,0)');vr.addColorStop(1,'rgba(0,0,0,.35)');vg.fillStyle=vr;vg.fillRect(0,0,W.width,W.height);this.vig=v;
  this.bg=c;
 }
 resize(){
  const W=CONFIG.world,cssW=this.cv.parentElement.clientWidth,dpr=window.devicePixelRatio||1;
  this.cv.style.height=(cssW*W.height/W.width)+'px';
  this.cv.width=cssW*dpr;this.cv.height=cssW*W.height/W.width*dpr;this.k=cssW*dpr/W.width;
 }
 draw(world,debug){
  const g=this.ctx,k=this.k;g.setTransform(k,0,0,k,0,0);g.drawImage(this.bg,0,0);
  for(const e of world.list)this.drawEntity(g,e);
  for(const p of world.parts){const f=1-p.life/p.max;g.globalAlpha=f;g.fillStyle=p.col;g.beginPath();g.arc(p.x,p.y,p.r*(.5+f/2),0,7);g.fill()}
  for(const b of world.shots){g.shadowColor='#7fd4ff';g.shadowBlur=10;this.ball(g,b.x,b.y,4.5,'#9fe0ff')}
  g.shadowBlur=0;g.globalAlpha=1;
  const n=world.night();
  if(n>0){g.fillStyle='rgba(12,22,70,'+.5*n+')';g.fillRect(0,0,CONFIG.world.width,CONFIG.world.height)}
  g.drawImage(this.vig,0,0);
  if(debug)for(const e of world.list)if(e.alive&&e instanceof Animal)this.drawDebug(g,e);
 }
 setTheme(t){if(t==='war'){this.warBg=this.warBg||this.makeWar();this.bg=this.warBg}else this.bg=this.natureBg}
 makeWar(){ // mapa táctico original (vista cenital): arena, calles, edificios, cráteres, cajas y sacos
  const W=CONFIG.world,c=document.createElement('canvas');c.width=W.width;c.height=W.height;const g=c.getContext('2d');
  const sand=g.createLinearGradient(0,0,W.width,W.height);sand.addColorStop(0,'#bfae82');sand.addColorStop(1,'#a38f64');
  g.fillStyle=sand;g.fillRect(0,0,W.width,W.height);
  for(let i=0;i<3000;i++){g.fillStyle=Math.random()<.5?'rgba(80,60,30,.10)':'rgba(255,240,200,.10)';g.fillRect(rand(0,W.width),rand(0,W.height),rand(1,3),rand(1,3))}
  const road=(x,y,w,h)=>{g.fillStyle='#8f8b82';g.fillRect(x-8,y-8,w+16,h+16);g.fillStyle='#4a4d52';g.fillRect(x,y,w,h)};
  road(0,270,W.width,80);road(470,0,70,W.height);
  g.strokeStyle='#d8c76a';g.lineWidth=2;g.setLineDash([18,14]);g.beginPath();g.moveTo(0,310);g.lineTo(W.width,310);g.moveTo(505,0);g.lineTo(505,W.height);g.stroke();g.setLineDash([]);
  const placed=[],quads=[[20,20,430,235],[560,20,420,235],[20,365,440,255],[560,365,420,255]];
  for(const[qx,qy,qw,qh]of quads){let n=0;for(let t=0;t<60&&n<4;t++){
   const w=rand(70,150),h=rand(60,110),x=rand(qx,qx+qw-w),y=rand(qy,qy+qh-h);
   if(placed.some(b=>x<b.x+b.w+14&&x+w>b.x-14&&y<b.y+b.h+14&&y+h>b.y-14))continue;
   placed.push({x,y,w,h});n++;
   g.fillStyle='rgba(0,0,0,.3)';g.fillRect(x+7,y+8,w,h);
   g.fillStyle=['#7d7569','#6e675c','#8a8174'][n%3];g.fillRect(x,y,w,h);
   g.strokeStyle='rgba(0,0,0,.45)';g.lineWidth=3;g.strokeRect(x,y,w,h);
   g.fillStyle='rgba(0,0,0,.18)';g.fillRect(x+w*.15,y+h*.2,w*.18,h*.25);g.fillRect(x+w*.6,y+h*.5,w*.2,h*.22);
   if(Math.random()<.5){g.fillStyle='#a38f64';g.beginPath();g.moveTo(x+w,y);g.lineTo(x+w*.7,y);g.lineTo(x+w,y+h*.35);g.fill()}
  }}
  for(let i=0;i<10;i++){const x=rand(20,W.width-20),y=rand(20,W.height-20),r=rand(10,24),gr=g.createRadialGradient(x,y,1,x,y,r);
   gr.addColorStop(0,'rgba(40,30,20,.55)');gr.addColorStop(1,'rgba(40,30,20,0)');g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,7);g.fill()}
  for(let i=0;i<14;i++){const x=rand(20,W.width-30),y=rand(20,W.height-30),z=rand(12,20);
   g.fillStyle='rgba(0,0,0,.3)';g.fillRect(x+3,y+4,z,z);g.fillStyle='#5f6b45';g.fillRect(x,y,z,z);
   g.strokeStyle='#3f4830';g.lineWidth=1.5;g.strokeRect(x,y,z,z);g.beginPath();g.moveTo(x,y);g.lineTo(x+z,y+z);g.moveTo(x+z,y);g.lineTo(x,y+z);g.stroke()}
  g.fillStyle='#c9b88a';g.strokeStyle='#7a6a45';g.lineWidth=1;
  for(let i=0;i<12;i++){const x=rand(20,W.width-80),y=rand(20,W.height-30);for(let k=0;k<4;k++){g.beginPath();g.roundRect(x+k*18,y,18,10,4);g.fill();g.stroke()}}
  g.strokeStyle='rgba(255,255,255,.12)';g.lineWidth=1;g.fillStyle='rgba(255,255,255,.4)';g.font='11px monospace';
  for(let i=0;i<10;i++){if(i){g.beginPath();g.moveTo(i*100,0);g.lineTo(i*100,W.height);g.stroke()}g.fillText('ABCDEFGHIJ'[i],i*100+6,12)}
  for(let j=0;j<7;j++){if(j){g.beginPath();g.moveTo(0,j*100);g.lineTo(W.width,j*100);g.stroke()}g.fillText(j+1,4,j*100+24)}
  return c;
 }
 ball(g,x,y,r,col){ // esfera con luz y sombra
  g.fillStyle=col;g.beginPath();g.arc(x,y,r,0,7);g.fill();
  const gr=g.createRadialGradient(x-r*.35,y-r*.4,r*.1,x,y,r);
  gr.addColorStop(0,'rgba(255,255,255,.5)');gr.addColorStop(.45,'rgba(255,255,255,0)');gr.addColorStop(1,'rgba(0,0,0,.45)');
  g.fillStyle=gr;g.fill();
 }
 drawEntity(g,e){
  const alpha=e.alive?1:1-e.deathT/CONFIG.anim.deathTime;
  let r=e.r*(e.alive?1:alpha),x=e.x,y=e.y;
  if(e.state==='attack'){x+=rand(-1.5,1.5);y+=rand(-1.5,1.5);
   const p=e.attackT/e.cfg.attackTime;g.strokeStyle='rgba(217,83,79,'+(1-p)+')';g.lineWidth=2;
   g.beginPath();g.arc(x,y,e.r*(1.2+p*1.8),0,7);g.stroke()}
  g.globalAlpha=Math.max(alpha,0);r=Math.max(r,.5);
  g.fillStyle='rgba(0,0,0,.22)';g.beginPath();g.ellipse(x+r*.2,y+r*.5,r*1.1,r*.55,0,0,7);g.fill();
  if(e instanceof Plant)this.drawPlant(g,e,x,y,r);else if(e instanceof Egg)this.drawEgg(g,e,x,y,r);else this.drawAnimal(g,e,x,y,r);
  g.globalAlpha=1;
 }
 drawEgg(g,e,x,y,r){
  const w=CONFIG.egg.hatchTime-e.t<1.5?Math.sin(e.t*30)*.15:0; // se agita al eclosionar
  g.save();g.translate(x,y);g.rotate(w);g.scale(.8,1);this.ball(g,0,0,r*1.3,e.cfg.color);
  g.fillStyle='rgba(120,90,50,.35)';for(const[dx,dy]of[[-.3,-.2],[.35,.2],[0,.45]]){g.beginPath();g.arc(dx*r,dy*r,r*.15,0,7);g.fill()}
  g.restore();
 }
 drawAnimal(g,e,x,y,r){
  const col=e.cfg.color,carn=e instanceof Carnivore,sup=e instanceof Player,sw=e.moving?Math.sin(e.t*12):0;
  if(e.state==='eat')r*=1+.08*Math.sin(e.t*22);
  g.save();g.translate(x,y);g.rotate(e.heading);
  if(sup){g.fillStyle='#e03a3a';g.beginPath();g.moveTo(-r*.2,-r*.7);g.lineTo(-r*(1.7+.2*sw),-r*.9);
   g.lineTo(-r*(1.9+.2*sw),0);g.lineTo(-r*(1.7-.2*sw),r*.9);g.lineTo(-r*.2,r*.7);g.fill()}
  g.fillStyle='rgba(0,0,0,.6)'; // patas
  for(const s of[-1,1])for(const f of[-1,1]){g.beginPath();g.ellipse(f*r*.55+s*f*sw*r*.22,s*r*.85,r*.26,r*.15,0,0,7);g.fill()}
  if(sup){g.shadowColor='#7fd4ff';g.shadowBlur=r*.8}
  g.save();g.scale(1.25,1);this.ball(g,0,0,r,col);g.restore();
  g.shadowBlur=0;
  this.ball(g,-r*1.4,0,r*.2,carn?'#6d7078':'#efe6d2'); // cola
  for(const s of[-1,1]){ // orejas
   if(carn){g.fillStyle='#60636b';g.beginPath();g.moveTo(r*.95,s*r*.35);g.lineTo(r*.75,s*r*.95);g.lineTo(r*1.3,s*r*.5);g.fill()}
   else this.ball(g,r*.95,s*r*.55,r*.22,col)}
  this.ball(g,r*1.15,0,r*.6,col);
  if(carn){this.ball(g,r*1.7,0,r*.3,'#6d7078');g.fillStyle='#111';g.beginPath();g.arc(r*1.95,0,r*.08,0,7);g.fill()}
  for(const s of[-1,1]){this.ball(g,r*1.45,s*r*.28,r*.15,carn?'#ffd54a':'#fff');
   g.fillStyle='#111';g.beginPath();g.arc(r*1.5,s*r*.28,r*.07,0,7);g.fill()}
  g.restore();
 }
 drawPlant(g,e,x,y,r){
  const k=e.kind,sw=Math.sin(e.t*1.5+e.ph)*r*.12;
  if(k.shape==='grass'){
   g.lineCap='round';
   for(let i=0;i<7;i++){const a=(i-3)*.28,h=r*(1.5+.25*Math.sin(i*2.1));
    g.strokeStyle=i%2?k.color:'#3f8a2b';g.lineWidth=Math.max(1,r*.16);
    g.beginPath();g.moveTo(x+(i-3)*r*.12,y+r*.5);g.quadraticCurveTo(x+Math.sin(a)*r*.6,y-h*.5,x+Math.sin(a)*r*1.1+sw,y+r*.5-h);g.stroke()}
  }else if(k.shape==='bush'){
   for(const[dx,dy,sz]of[[-.6,.3,.7],[.6,.3,.7],[0,-.3,.8],[0,.4,.75]])this.ball(g,x+dx*r+sw*.3,y+dy*r,r*sz,k.color);
   g.fillStyle='#d6453d';for(let i=0;i<4;i++){g.beginPath();g.arc(x+Math.cos(i*1.9)*r*.5,y+Math.sin(i*2.7)*r*.4,Math.max(.8,r*.1),0,7);g.fill()}
  }else if(k.shape==='flower'){
   g.strokeStyle='#3f8a2b';g.lineWidth=Math.max(1,r*.15);g.beginPath();g.moveTo(x,y+r*.9);g.quadraticCurveTo(x+sw,y+r*.2,x+sw,y-r*.2);g.stroke();
   for(let i=0;i<6;i++){const a=i*Math.PI/3;this.ball(g,x+sw+Math.cos(a)*r*.55,y-r*.2+Math.sin(a)*r*.55,r*.38,k.color)}
   this.ball(g,x+sw,y-r*.2,r*.3,'#f5d442');
  }else{
   g.fillStyle='#efe4cc';g.beginPath();g.roundRect(x-r*.28,y-r*.1,r*.56,r*.9,r*.2);g.fill();
   g.fillStyle=k.color;g.beginPath();g.ellipse(x,y,r,r*.75,0,Math.PI,2*Math.PI);g.closePath();g.fill();
   g.fillStyle='rgba(255,255,255,.2)';g.beginPath();g.ellipse(x-r*.25,y-r*.35,r*.4,r*.18,-.4,0,7);g.fill();
   g.fillStyle='#fff';for(const[dx,dy]of[[-.45,-.25],[.1,-.5],[.5,-.2]]){g.beginPath();g.arc(x+dx*r,y+dy*r,r*.12,0,7);g.fill()}
  }
 }
 drawDebug(g,e){
  const c=e.cfg;g.lineWidth=1;
  if(e instanceof Carnivore){
   const h=e.heading,f=c.fov*Math.PI/360;g.fillStyle='rgba(217,83,79,.12)';g.strokeStyle='rgba(217,83,79,.6)';
   g.beginPath();g.moveTo(e.x,e.y);g.arc(e.x,e.y,c.perception,h-f,h+f);g.closePath();g.fill();g.stroke();
  }else{g.strokeStyle='rgba(224,166,58,.6)';g.setLineDash([4,4]);g.beginPath();g.arc(e.x,e.y,c.perception,0,7);g.stroke();g.setLineDash([])}
  if(e.target&&e.target.alive){g.strokeStyle='rgba(120,120,120,.8)';g.beginPath();g.moveTo(e.x,e.y);g.lineTo(e.target.x,e.target.y);g.stroke()}
  g.fillStyle=getComputedStyle(document.body).color;g.font='10px sans-serif';
  g.fillText(e.state+' '+Math.round(e.hp),e.x+e.r+3,e.y-e.r);
 }
}

// ===== Interfaz =====
const world=new World(),renderer=new Renderer(document.getElementById('cv'));
let paused=false,debug=false,fps=60;
const SLIDERS=[
 ['sim.speed','Velocidad de simulación',.25,4,.25],
 ['plant.spawnInterval','Intervalo aparición plantas (s)',.05,2,.05],
 ['plant.max','Máximo de plantas',10,400,10],
 ['plant.growth','Crecimiento de plantas',.2,5,.1],
 ['herbivore.initial','Herbívoros iniciales (al reiniciar)',0,60,1],
 ['carnivore.initial','Carnívoros iniciales (al reiniciar)',0,15,1],
 ['herbivore.speed','Velocidad herbívoros',20,120,5],
 ['carnivore.speed','Velocidad carnívoros',20,120,5],
 ['herbivore.perception','Radio percepción herbívoros',30,200,5],
 ['carnivore.perception','Distancia visión carnívoros',60,350,10],
 ['carnivore.fov','Ángulo de visión carnívoros (°)',15,180,5],
 ['herbivore.moveCost','Coste energético herbívoros',0,.1,.005],
 ['carnivore.moveCost','Coste energético carnívoros',0,.1,.005],
 ['herbivore.eatGain','Energía por alimentarse (herb.)',.5,4,.1],
 ['carnivore.attackGain','Energía por presa (carn.)',10,150,5],
 ['herbivore.huntBelow','Carnívoro cazable por herbívoros (fracción de vida)',0,1,.05],
 ['herbivore.minPopulation','Población mínima de herbívoros',0,40,1],
 ['sound.volume','Volumen',0,1,.05],
 ['day.length','Duración del día completo (s)',30,300,10],
 ['egg.hatchTime','Tiempo de eclosión del huevo (s)',2,30,1],
 ['herbivore.foodToBreed','Plantas para reproducirse (herb.)',1,15,1],
 ['carnivore.foodToBreed','Presas para reproducirse (carn.)',1,10,1]
];
const ref=p=>{const [a,b]=p.split('.');return[CONFIG[a],b]};
const ctl=document.getElementById('ctl');
for(const [p,label,min,max,step] of SLIDERS){
 const [o,k]=ref(p),l=document.createElement('label'),v=document.createElement('b');
 const i=Object.assign(document.createElement('input'),{type:'range',min,max,step,value:o[k]});
 const show=()=>v.textContent=o[k];show();
 i.oninput=()=>{o[k]=+i.value;show()};
 l.append(label+': ',v,i);ctl.append(l);
}
const $=id=>document.getElementById(id);
$('play').onclick=()=>{paused=!paused;$('play').textContent=paused?'Reanudar':'Pausa'};
$('reset').onclick=()=>world.reset();
$('addH').onclick=()=>world.spawn('herbivore');
$('addC').onclick=()=>world.spawn('carnivore');
$('theme').onchange=e=>renderer.setTheme(e.target.value);
$('snd').onchange=e=>{CONFIG.sound.enabled=e.target.checked;Sound.init()};
['pointerdown','keydown'].forEach(ev=>addEventListener(ev,()=>Sound.init())); // el navegador exige un gesto para activar el audio
$('day').onchange=e=>CONFIG.day.enabled=e.target.checked;
$('dbg').onchange=e=>debug=e.target.checked;
addEventListener('resize',()=>renderer.resize());
$('dash').onclick=()=>{KEYS.dash=1};
const sb=$('shoot');sb.onpointerdown=()=>{KEYS.shoot=1};sb.onpointerup=sb.onpointerleave=()=>{KEYS.shoot=0};
$('addP').onclick=()=>{if(!world.list.some(e=>e instanceof Player&&e.alive))world.spawn('player')};
const KMAP={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',' ':'dash',f:'shoot',F:'shoot'};
addEventListener('keydown',e=>{const k=KMAP[e.key];if(k){KEYS[k]=1;if(e.target.tagName!=='INPUT')e.preventDefault()}});
addEventListener('keyup',e=>{const k=KMAP[e.key];if(k)KEYS[k]=0});
const cv=$('cv'),setPtr=e=>{const r=cv.getBoundingClientRect();KEYS.pointer={x:(e.clientX-r.left)/r.width*CONFIG.world.width,y:(e.clientY-r.top)/r.height*CONFIG.world.height}};
cv.style.touchAction='none';
cv.addEventListener('pointerdown',e=>{setPtr(e);cv.setPointerCapture(e.pointerId)});
cv.addEventListener('pointermove',e=>{if(KEYS.pointer)setPtr(e)});
const endPtr=()=>{KEYS.pointer=null};cv.addEventListener('pointerup',endPtr);cv.addEventListener('pointercancel',endPtr);
const stats=$('stats');
function updateStats(){
 const c=world.counts,s=world.stats,pl=world.list.find(e=>e instanceof Player&&e.alive);
 stats.innerHTML=`<span>🌿 Plantas <b>${c.plant}</b></span><span>🐇 Herbívoros <b>${c.herbivore}</b></span><span>🥚 Huevos <b>${c.egg||0}</b></span><span>🐺 Carnívoros <b>${c.carnivore}</b></span><span title="hambre ${s.starved}, cazados ${s.eaten}">💀 Muertos <b>${s.dead}</b></span><span>${world.night()>.5?'🌙':'☀️'} <b>${fps|0}</b> FPS</span>${pl?`<span>🦸 Presas <b>${pl.kills}/${CONFIG.player.maxKills}</b></span>`:''}`;
}
// ===== Bucle =====
let last=performance.now(),acc=0;
function frame(now){
 const raw=Math.min((now-last)/1000,.1);last=now;fps=lerp(fps,1/Math.max(raw,1e-3),.1);
 if(!paused)world.update(raw*CONFIG.sim.speed);
 renderer.draw(world,debug);
 if((acc+=raw)>.25){acc=0;updateStats()}
 requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
