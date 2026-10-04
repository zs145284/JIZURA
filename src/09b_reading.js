/* Optional intact reading foreground. Native cuts, timings, choices and motion
   remain the auxiliary image. Nothing is drawn when this presentation option is off. */
(() => {
'use strict';
const mainDraw = J.mainDraw;
const canonical = text => Array.from(text || '').filter(ch => !/\s/u.test(ch)).join('');
const identity = () => [1, 0, 0, 1, 0, 0];
const boundsOf = (bb, m) => {
  const p = [[bb.x0,bb.y0],[bb.x1,bb.y0],[bb.x1,bb.y1],[bb.x0,bb.y1]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);
  return [Math.min(...p.map(p=>p[0])),Math.min(...p.map(p=>p[1])),Math.max(...p.map(p=>p[0])),Math.max(...p.map(p=>p[1]))];
};
const clean = it => {
  // A native layout supplies the face and composition, but deformation belongs
  // to the original animation. Keep source identity; never turn this into an echo.
  const out = {};
  for (const k of ['text','font','size','x','y','align','vertical','track','lead','color','mi','plain']) if (it[k] !== undefined) out[k] = it[k];
  return Object.assign(out,{sx:1,sy:1,rot:0,alpha:1,fill:true,textRole:'primary',noWeight:true});
};
const carrierAt = (ctx, bb, m, fallback) => {
  const b = boundsOf(bb,m),counts=new Map();
  // Read carrier before painting the captured text. A small regular grid avoids
  // choosing a thin underline or border as the carrier colour.
  for(let y=1;y<8;y++)for(let x=1;x<12;x++){
    const px=Math.round(b[0]+(b[2]-b[0])*x/12),py=Math.round(b[1]+(b[3]-b[1])*y/8);
    if(px<0||py<0||px>=ctx.canvas.width||py>=ctx.canvas.height)continue;
    const v=ctx.getImageData(px,py,1,1).data;if(v[3]<250)continue;
    const col='#'+Array.from(v.slice(0,3),v=>v.toString(16).padStart(2,'0')).join('');counts.set(col,(counts.get(col)||0)+1);
  }
  return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0] || fallback;
};
J.mainDraw = (env,it) => {
  if(!env.readingCapture)return mainDraw(env,it);
  it=clean(it);if(J.bindLyricItem)J.bindLyricItem(env,it);
  const T=env.ctx.getTransform(),m=[T.a,T.b,T.c,T.d,T.e,T.f];
  // drawItem's own bbox is obtained without polluting the layout's carrier probe.
  const cv=document.createElement('canvas');cv.width=env.W;cv.height=env.H;
  const bb=J.drawItem({...env,ctx:cv.getContext('2d'),glyphLog:null},it);
  if(bb)env.readingCapture.push({it,m,bb,carrier:carrierAt(env.ctx,bb,m,env.sc.bg)});
  return J.drawItem(env,it);
};
const wrap = (text, max=12) => {
  if(/\s/u.test(text)) {
    const lines=[''];for(const word of text.trim().split(/\s+/u)) {const i=lines.length-1;if(lines[i]&&(lines[i]+' '+word).length>max)lines.push(word);else lines[i]+=(lines[i]?' ':'')+word;}return lines.join('\n');
  }
  const chars=Array.from(text),lines=[];for(let i=0;i<chars.length;i+=max)lines.push(chars.slice(i,i+max).join(''));return lines.join('\n');
};
const templates=new WeakMap();
J.readingTemplate = (renderer,plan,cut) => {
  let cache=templates.get(plan);if(!cache){cache=new Map();templates.set(plan,cache);}if(cache.has(cut))return cache.get(cut);
  const W=plan.W,H=plan.H,sc=plan.style.schemes[cut.scheme%plan.style.schemes.length],cv=document.createElement('canvas');cv.width=W;cv.height=H;
  const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.fillStyle=sc.bg;ctx.fillRect(0,0,W,H);
  // Freeze one mature layout pose. No camera, ghost, entrance, exit or post effect.
  const lt=Math.max(cut.inDur,cut.dur*.65),env=renderer.makeEnv(ctx,plan,cut,sc,{pass:'main',t:cut.start+lt,audioT:cut.start+lt,lt,ltb:lt,pIn:1,pOut:0,step:0,scale:1,allowFilter:false,energy:0,beat:{pulse:0,phase:0},readingCapture:[],lyricLayout:true});
  const mature={...cut,wordTiming:false};env.cut=mature;
  (J.LAYOUTS[cut.layout]||J.LAYOUTS.center).render(env);
  // Repetitions may offer several whole copies: choose the first intact copy.
  // Split, procedural or scattered lettering has no single intact geometry;
  // compose its same source phrase using the native face in a safe reading area.
  const safe = a => {
    const b=boundsOf(a.bb,a.m);return b[0]>=W*.045&&b[1]>=H*.045&&b[2]<=W*.955&&b[3]<=H*.955&&b[2]-b[0]<=W*.87&&b[3]-b[1]<=H*.65;
  };
  let items=env.readingCapture.filter(a=>canonical(a.it.text)===canonical(cut.text)&&safe(a)).slice(0,1);
  if(!items.length){
    const parts=env.readingCapture.filter(a=>a.it.fill!==false);
    const intact=canonical(parts.map(a=>a.it.text).join(''))===canonical(cut.text);
    const composed=parts.some(a=>canonical(a.it.text).length>1);
    const overlap=parts.some((a,i)=>parts.slice(i+1).some(b=>{
      const A=boundsOf(a.bb,a.m),B=boundsOf(b.bb,b.m);
      return Math.min(A[2],B[2])-Math.max(A[0],B[0])>0&&Math.min(A[3],B[3])-Math.max(A[1],B[1])>0;
    }));
    const ordered=parts.every((a,i)=>!i||(()=>{const A=boundsOf(parts[i-1].bb,parts[i-1].m),B=boundsOf(a.bb,a.m);return B[1]>A[1]+H*.15||B[0]>=A[0]-W*.03;})());
    if(intact&&composed&&ordered&&parts.every(safe)&&!overlap)items=parts;
  }
  if(!items.length){
    const font=env.readingCapture[0]?.it.font||cut.params.font||plan.fonts?.display||'gothic',text=wrap(cut.text),size=Math.min(H*.22,J.fitSize(text,font,W*.78,H*.42,{lead:1.15,track:.04}));
    const it={text,font,size,x:W/2,y:H/2,track:.04,lead:1.15,color:sc.fg,sx:1,sy:1,alpha:1,fill:true,textRole:'primary',noWeight:true};
    items=[{it,m:identity(),bb:J.drawItem({...env,ctx,cut:mature},it),carrier:sc.bg,fallback:true}];
  }
  items=items.map(a=>{
    const nativeColors=[a.it.color,sc.fg,sc.accent,sc.bg].filter(c=>typeof c==='string'&&/^#[0-9a-f]{3,8}$/i.test(c));
    const color=nativeColors.find(c=>J.contrast(c,a.carrier)>=4.5)||[...nativeColors,'#000000','#ffffff'].sort((a0,b)=>J.contrast(b,a.carrier)-J.contrast(a0,a.carrier))[0];
    return {...a,it:{...a.it,color},contrast:J.contrast(color,a.carrier)};
  });
  cache.set(cut,items);return items;
};
const frame = J.Renderer.prototype.frame;
J.Renderer.prototype.frame = function(ctx,plan,t,opt={}) {
  this.readingDepth=(this.readingDepth||0)+1;
  try {
    frame.call(this,ctx,plan,t,opt);
    if(this.readingDepth!==1||plan.readingLayer?.mode!=='stable'||opt.layer==='back'||opt.transparent||plan.keyBg)return;
    const p=J.presentationPlan(plan),cut=J.cutAt(p,t);
    if(!cut||cut.instrumental||cut.sourceRole==='credit'||p.lines[cut.line]?.interlude||!cut.text?.trim())return;
    // Explicit editorial flashes retain their native full-frame result.
    if(!opt.noPost&&p.events.some(ev=>['whiteFrame','blackFrame','flash','strobe'].includes(ev.type)&&t>=ev.t&&t<ev.t+Math.max(ev.dur,1/p.fps)))return;
    const items=J.readingTemplate(this,p,cut),s=opt.scale||1,boxes=[];
    const env=this.makeEnv(ctx,p,cut,p.style.schemes[cut.scheme%p.style.schemes.length],{pass:'main',t,audioT:t,lt:t-cut.start,ltb:t-cut.start,step:0,scale:s,allowFilter:false,energy:0,lyricLayout:true,glyphLog:opt.readingGlyphLog||null});
    for(const a of items){
      const pad=a.it.size*.1,b=boundsOf(a.bb,a.m);boxes.push(b);
      ctx.save();ctx.setTransform(s,0,0,s,0,0);ctx.filter='none';ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
      // Clear only the reading footprint, matching its selected native carrier.
      // The carrier outside this region, its frame, and auxiliary motion survive.
      ctx.fillStyle=a.carrier;ctx.fillRect(b[0]-pad,b[1]-pad,b[2]-b[0]+2*pad,b[3]-b[1]+2*pad);
      ctx.transform(...a.m);const it={...a.it};delete it.lyricIndices;J.bindLyricItem(env,it);J.drawItem(env,it);ctx.restore();
    }
    const b=[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
    if(opt.readingLog)opt.readingLog.push({text:cut.text,sourceLineId:cut.sourceLineId,layout:cut.layout,font:items[0].it.font,bounds:b.map(v=>v*s),color:items.map(a=>a.it.color),carrier:items.map(a=>a.carrier),contrast:Math.min(...items.map(a=>a.contrast)),fallback:items.some(a=>a.fallback)});
  } finally {this.readingDepth--;}
};
})();
