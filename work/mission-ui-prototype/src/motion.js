import { subscribeFrame } from "./HaneAvatar.jsx";
import { springStep } from "./garden-controller.js";
import { animate, stagger } from "animejs";

export const reduceMotion = () =>
  typeof window !== "undefined" &&
  (document.documentElement.dataset.haneMotion === "none" || document.documentElement.dataset.haneMotion === "subtle" || window.matchMedia("(prefers-reduced-motion: reduce)").matches);

const list = (targets) =>
  targets == null ? [] : targets instanceof Element ? [targets] : [...targets];

export function entrance(root) {
  if (!root || reduceMotion()) return [];
  const groups = [
    { sel: [".brand-row", ".search-box", ".new-chat", ".agent-nav", ".conversation-row", ".sidebar-footer button"], base: 0, step: 26, y: 8, duration: 320 },
    { sel: [".conversation-header", ".messages > *", ".settings-sheet > section"], base: 90, step: 42, y: 12, duration: 380 },
    { sel: [".right-panel > header", ".panel-section", ".approval-card"], base: 170, step: 55, y: 10, duration: 340 },
  ];
  const runs = [];
  for (const g of groups) {
    const targets = g.sel.flatMap((s) => [...root.querySelectorAll(s)]);
    if (!targets.length) continue;
    runs.push(animate(targets, {
      opacity: [0, 1],
      translateY: [g.y, 0],
      duration: g.duration,
      delay: (el, i) => g.base + i * g.step,
      ease: "outQuad",
    }));
  }
  return runs;
}

export function staggerIn(targets, { y = 8, step = 28, duration = 300, base = 0 } = {}) {
  const items = list(targets);
  if (!items.length || reduceMotion()) return null;
  return animate(items, {
    opacity: [0, 1],
    translateY: [y, 0],
    duration,
    delay: (el, i) => base + i * step,
    ease: "outQuad",
  });
}

export function rise(targets, { y = 10, duration = 340 } = {}) {
  const items = list(targets);
  if (!items.length || reduceMotion()) return null;
  return animate(items, { opacity: [0, 1], translateY: [y, 0], duration, ease: "outQuad" });
}

export function toastOut(el) {
  if (!el || reduceMotion()) return Promise.resolve();
  // anime.js 4.5 animations are thenable and have no `.finished`; Promise.resolve
  // adopts them, so the caller's `.then` always gets a real promise.
  return Promise.resolve(animate(el, { opacity: [1, 0], translateY: [0, 8], duration: 180, ease: "inQuad" }));
}

export function pop(el) {
  if (!el || reduceMotion()) return null;
  return animate(el, { scale: [1, 0.92, 1], duration: 260, ease: "outQuad" });
}

export function approvePop(el) {
  if (!el || reduceMotion()) return null;
  return animate(el, { scale: [1, 0.95, 1.04, 1], duration: 420, ease: "outQuad" });
}

export function slideKnob(el, on) {
  if (!el || reduceMotion()) return null;
  return animate(el, { translateX: on ? 13 : 0, duration: 220, ease: "outQuad" });
}

export function spinLoop(el) {
  if (!el || reduceMotion()) return null;
  return animate(el, { rotate: "1turn", duration: 1000, ease: "linear", loop: true });
}

export function pulseLoop(targets) {
  const items = list(targets);
  if (!items.length || reduceMotion()) return null;
  return animate(items, { scale: [1, 1.45], duration: 850, delay: stagger(170), ease: "inOutSine", loop: true, alternate: true });
}

export function growBar(el, width = "67%") {
  if (!el || reduceMotion()) return null;
  return animate(el, { width: ["0%", width], duration: 900, delay: 350, ease: "outQuart" });
}

export function flash(el) {
  if (!el || reduceMotion()) return null;
  return animate(el, { opacity: [0.25, 1], translateY: [-8, 0], duration: 520, ease: "outQuad" });
}

export function spinOnce(el) {
  if (!el || reduceMotion()) return null;
  return animate(el, { rotate: ["0turn", "1turn"], duration: 520, ease: "outQuart" });
}

// The existing Avatar Engine scheduler drives the entire stage without React frame renders.
export function driveGarden(root, controller, behaviour, reduced) {
  if (!root) return () => {};
  const orb=root.querySelector('.garden-orb'), mascot=root.querySelector('.garden-mascot'), ring=root.querySelector('.garden-orbit');
  const family=[...root.querySelectorAll('.garden-family-member')], caption=root.querySelector('.garden-family-caption');
  let bounds=root.getBoundingClientRect(), previous=performance.now(), elapsed=0, lastPaint=0;
  let x=257,y=178,vx=0,vy=0,mx=160,my=133,mvx=0,mvy=0,familyBlend=0,lastFamily=false;
  let pointerId=null,moved=false,origin=null,dragTarget=null,active=null,offset={x:0,y:0};
  let visible=true,closed=false,interval=null;
  const lowPower=navigator.hardwareConcurrency>0&&navigator.hardwareConcurrency<=4;
  const measure=()=>{bounds=root.getBoundingClientRect();};
  const coords=event=>({x:(event.clientX-bounds.left)*320/bounds.width,y:(event.clientY-bounds.top)*270/bounds.height});
  const activity=()=>controller.activity();
  const move=event=>{
    activity();
    if(pointerId===event.pointerId){
      const point=coords(event),main=active===mascot;
      dragTarget={x:Math.max(main?65:20,Math.min(main?255:300,point.x-offset.x)),y:Math.max(main?65:20,Math.min(main?195:245,point.y-offset.y))};
      moved ||= Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>6;
      controller.point((point.x-160)/30,(point.y-133)/30);
    }else{
      const dx=event.clientX-(bounds.left+bounds.width/2),dy=event.clientY-(bounds.top+bounds.height/2);
      controller.point(Math.hypot(dx,dy)<bounds.width*1.2?Math.max(-5,Math.min(5,dx/40)):null,Math.max(-3,Math.min(3,dy/45)));
    }
  };
  const start=event=>{
    if(event.button!==0||pointerId!=null)return;
    measure();origin={x:event.clientX,y:event.clientY};moved=false;active=event.currentTarget;
    const point=coords(event);offset={x:point.x-(active===mascot?mx:x),y:point.y-(active===mascot?my:y)};
    pointerId=event.pointerId;dragTarget=active===mascot?{x:mx,y:my}:{x,y};controller.drag(true);active.setPointerCapture(pointerId);
  };
  const end=event=>{
    if(event.pointerId!==pointerId)return;
    if(event.type!=='pointerup')moved=false;
    const id=pointerId,element=active;pointerId=null;dragTarget=null;active=null;controller.drag(false);controller.point(null);
    if(element.hasPointerCapture(id))element.releasePointerCapture(id);
    if(reduced)paint(performance.now());
  };
  const click=event=>{if(moved&&event.detail!==0){event.preventDefault();event.stopImmediatePropagation();moved=false;}};
  const leave=()=>{if(pointerId==null)controller.point(null);};
  const paint=now=>{
    if(closed||document.hidden||!visible){previous=now;return;}
    if(!reduced&&now-lastPaint<(lowPower?32:16))return;
    lastPaint=now;const dt=Math.min((now-previous)/1000,1/30);previous=now;if(!reduced)elapsed+=dt;
    const view=controller.snapshot();root.dataset.gardenState=view.state;root.dataset.feather=String(view.feather);root.dataset.family=String(view.family);
    if(view.family!==lastFamily){lastFamily=view.family;caption.textContent=view.family?'Até oito Hanes. Muitas possibilidades.':'';}
    behaviour.current={state:view.state,gazeX:view.pointer?.x||0,gazeY:view.pointer?.y||0,blink:view.blink};
    familyBlend=reduced?(view.family?1:0):familyBlend+((view.family?1:0)-familyBlend)*(1-Math.exp(-dt*5));
    const phase=elapsed*0.24+Math.sin(elapsed*0.19)*0.09;
    const target=active===orb?dragTarget:reduced?{x:257,y:178}:{x:160+Math.cos(phase+0.7)*125,y:133+Math.sin(phase+0.7)*65};
    if(active===orb||reduced){x=target.x;y=target.y;vx=0;vy=0;}else{const sx=springStep(x,vx,target.x,dt),sy=springStep(y,vy,target.y,dt);x=sx.position;y=sy.position;vx=sx.velocity;vy=sy.velocity;}
    const mainTarget=active===mascot?dragTarget:{x:160,y:133};
    if(active===mascot||reduced){mx=mainTarget.x;my=mainTarget.y;mvx=0;mvy=0;}else{const sx=springStep(mx,mvx,mainTarget.x,dt),sy=springStep(my,mvy,mainTarget.y,dt);mx=sx.position;my=sy.position;mvx=sx.velocity;mvy=sy.velocity;}
    const jump=reduced||active===mascot?0:Math.sin(Math.PI*view.jump)*32;
    const landing=reduced||view.jump<.75?0:Math.sin((view.jump-.75)*4*Math.PI)*.06;
    const mainScale=1-familyBlend*.35;
    mascot.style.transform='translate('+(mx-160)+'px,'+(my-133-jump)+'px) scale('+mainScale*(1+landing)+','+mainScale*(1-landing)+')';
    orb.style.transform='translate('+x+'px,'+y+'px) translate(-50%,-50%) scale('+(reduced?1:.9+(y/270)*.15+Math.sin(view.bump*Math.PI)*.12)+')';orb.style.zIndex=y<133?'1':'5';
    ring.style.transform='rotate('+(active===orb&&!reduced?(x-160)*.025:0)+'deg)';
    family.forEach((member,index)=>{
      const angle=-Math.PI/2+index*Math.PI*2/7,radius=75+31*familyBlend;
      const bob=reduced?0:Math.sin(elapsed*1.2+index)*2;
      member.style.transform='translate('+(160+Math.cos(angle)*radius)+'px,'+(133+Math.sin(angle)*radius+bob)+'px) translate(-50%,-50%) scale('+(0.7+0.3*familyBlend)+')';
      member.style.opacity=String(familyBlend);
    });
  };
  const visibility=()=>{root.dataset.paused=String(document.hidden);previous=performance.now();if(document.hidden){if(pointerId!=null)end({pointerId});}else{controller.activity();measure();paint(previous);}};
  const resize=new ResizeObserver(measure);resize.observe(root);
  const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;previous=performance.now();});intersection.observe(root);
  window.addEventListener('pointermove',move,{passive:true});window.addEventListener('pointerdown',activity,{passive:true});window.addEventListener('keydown',activity);window.addEventListener('scroll',measure,true);
  document.addEventListener('visibilitychange',visibility);document.documentElement.addEventListener('pointerleave',leave);
  for(const element of [orb,mascot]){element.addEventListener('pointerdown',start);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);element.addEventListener('lostpointercapture',end);element.addEventListener('click',click,true);}
  paint(previous);
  const unsubscribe=reduced?(()=>{interval=setInterval(()=>paint(performance.now()),100);return()=>clearInterval(interval);})():subscribeFrame(paint);
  return()=>{
    closed=true;unsubscribe();resize.disconnect();intersection.disconnect();if(pointerId!=null&&active?.hasPointerCapture(pointerId))active.releasePointerCapture(pointerId);
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerdown',activity);window.removeEventListener('keydown',activity);window.removeEventListener('scroll',measure,true);
    document.removeEventListener('visibilitychange',visibility);document.documentElement.removeEventListener('pointerleave',leave);
    for(const element of [orb,mascot]){element.removeEventListener('pointerdown',start);element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',end);element.removeEventListener('lostpointercapture',end);element.removeEventListener('click',click,true);element.style.removeProperty('transform');}
    orb.style.removeProperty('z-index');ring.style.removeProperty('transform');
    for(const member of family){member.style.removeProperty('transform');member.style.removeProperty('opacity');}
    caption.textContent='';
  };
}

// Personalization is visual only; callers revert on change/unmount (StrictMode).
export function avatarPersonalization(root,{shapeChanged,colorChanged}) {
 if(!root||reduceMotion())return [];
 const runs=[];const avatar=root.querySelector('.studio-avatar-motion');
 if(shapeChanged&&avatar)runs.push(animate(avatar,{rotateY:[-100,0],rotate:[-10,0],scale:[.78,1],opacity:[.35,1],duration:520,ease:'outCubic'}));
 if(colorChanged){const stars=root.querySelectorAll('.studio-avatar-glitter i');runs.push(animate(stars,{opacity:[0,1,0],scale:[.3,1.2,.6],translateY:[8,-14],duration:650,delay:stagger(45),ease:'outQuad'}));}
 return runs;
}
