/* Fit the five rulings on each axis of a Neubauer corner square.
   Segment extents matter: separated squares can share a row without sharing a boundary. */
'use strict';
const ChamberGrid = (() => {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function validCorners(q, minSide) {
    if (q.length !== 4) return false;
    return q.every((a, i) => {
      const b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const cross = (b.x-a.x)*(c.y-b.y) - (b.y-a.y)*(c.x-b.x);
      return distance(a, b) >= minSide && cross > 0.38 * distance(a, b) * distance(b, c);
    });
  }
  function mergeRulings(parts, tolerance) {
    const lines = [];
    for (const p of parts.sort((a,b) => a.pos-b.pos)) {
      let line = lines.at(-1);
      if (!line || p.pos - line.pos > tolerance || Math.abs(line.slope-p.slope) > 0.095) {
        lines.push({ ...p, spans: [[p.lo,p.hi]] });
      } else {
        const w = p.weight / (p.weight + line.weight);
        line.pos += w*(p.pos-line.pos);
        line.slope += w*(p.slope-line.slope);
        line.weight += p.weight;
        line.spans.push([p.lo,p.hi]);
      }
    }
    for (const line of lines) {
      const spans = [];
      for (const [lo,hi] of line.spans.sort((a,b) => a[0]-b[0])) {
        const prev = spans.at(-1);
        if (prev && lo <= prev[1]+tolerance) prev[1] = Math.max(prev[1],hi);
        else spans.push([lo,hi]);
      }
      line.spans = spans;
    }
    return lines.sort((a,b) => b.weight-a.weight).slice(0,72).sort((a,b) => a.pos-b.pos);
  }
  function coverage(line, a, b) {
    let length = 0;
    for (const [lo,hi] of line.spans) length += Math.max(0,Math.min(b,hi)-Math.max(a,lo));
    return length/(b-a);
  }
  function sequences(lines, minSpan, maxSpan) {
    const result = [];
    for (let i=0; i<lines.length-4; i++) {
      for (let j=i+4; j<lines.length; j++) {
        const span = lines[j].pos-lines[i].pos;
        if (span > maxSpan) break;
        if (span < minSpan) continue;
        const group=[lines[i]], step=span/4;
        let error=0, k=i+1;
        for (let n=1; n<=3; n++) {
          const target=lines[i].pos+n*step;
          while (k+1<j && Math.abs(lines[k+1].pos-target)<Math.abs(lines[k].pos-target)) k++;
          const miss=Math.abs(lines[k].pos-target)/step;
          if (k>=j || miss>0.35) break;
          group.push(lines[k++]); error+=miss;
        }
        if (group.length!==4) continue;
        // A projective image of equally spaced lines has unequal gaps. Fit the
        // projective spacing using the middle ruling, then check the quarter points.
        const mid=(group[2].pos-group[0].pos)/span;
        const bend=(2*mid-1)/(1-mid);
        const expected=t=>(1+bend)*t/(1+bend*t);
        error=[1,3].reduce((sum,n)=>sum+4*Math.abs((group[n].pos-group[0].pos)/span-expected(n/4)),0);
        if (error<0.28) result.push({group:[...group,lines[j]], span, error,
          inside:lines.slice(i+1,j).filter(line=>!group.includes(line) &&
            group.concat(lines[j]).every(g=>Math.abs(g.pos-line.pos)>0.15*step))});
      }
    }
    return result.sort((a,b)=>a.error-b.error).slice(0,160);
  }
  function intersect(v,h) {
    const x = (v.pos+v.slope*h.pos)/(1-v.slope*h.slope);
    return {x,y:h.pos+h.slope*x};
  }
  function support(seq, cross, vertical) {
    const at = (l,o) => vertical ? intersect(l,o).y : intersect(o,l).x;
    let total=0, extending=0;
    for (const [index,line] of seq.group.entries()) {
      const a=at(line,cross.group[0]), b=at(line,cross.group[4]);
      const covers=coverage(line,a,b);
      if (covers < (index===0 || index===4 ? 0.63 : 0.56)) return 0;
      total+=covers;
      if (index>0 && index<4) {
        const step=(b-a)/4;
        if (coverage(line,a-step,a)>0.78 && coverage(line,b,b+step)>0.78) extending++;
      }
    }
    // An arbitrary four-interval window inside a finer, repeating grid is ambiguous.
    if (extending>=2 || seq.inside.some(l=>coverage(l,at(l,cross.group[0]),at(l,cross.group[4]))>0.52)) return 0;
    return total/5;
  }
  function fit(segments,width,height) {
    const out={corners:null,snaps:[],ambiguous:false};
    const edges = segments.map(([x,y,X,Y])=>({x,y,X,Y,len:Math.hypot(X-x,Y-y),angle:Math.atan2(Y-y,X-x)}));
    let cs=0,sn=0;
    for (const e of edges) { cs+=e.len*Math.cos(4*e.angle); sn+=e.len*Math.sin(4*e.angle); }
    const angle=Math.atan2(sn,cs)/4, c=Math.cos(angle), s=Math.sin(angle);
    const w=width/2,h=height/2;
    const toFrame=(x,y)=>({x:(x-w)*c+(y-h)*s,y:-(x-w)*s+(y-h)*c});
    const toPhoto=({x,y})=>({x:x*c-y*s+w,y:x*s+y*c+h});
    const buckets=[[],[]];
    for (const e of edges) {
      const a=toFrame(e.x,e.y),b=toFrame(e.X,e.Y);
      const vert=Math.abs(b.y-a.y)>Math.abs(b.x-a.x);
      const p=vert?a.y:a.x, q=vert?b.y:b.x, u=vert?a.x:a.y, v=vert?b.x:b.y;
      const slope=(v-u)/(q-p);
      if (Math.abs(slope)>0.32 || !Number.isFinite(slope)) continue;
      buckets[vert?0:1].push({pos:u-slope*p,slope,lo:Math.min(p,q),hi:Math.max(p,q),weight:e.len});
    }
    const small=Math.min(width,height), tolerance=Math.max(4,small*0.008);
    const [vs,hs]=buckets.map(b=>mergeRulings(b,tolerance));
    for (const v of vs) for (const h of hs) {
      const p=intersect(v,h);
      if (v.spans.some(([a,b])=>p.y>=a-tolerance && p.y<=b+tolerance) &&
          h.spans.some(([a,b])=>p.x>=a-tolerance && p.x<=b+tolerance)) out.snaps.push(toPhoto(p));
    }
    const groups=lines=>sequences(lines,Math.max(48,small*0.17),small*1.35);
    const vertical=groups(vs), horizontal=groups(hs), matches=[];
    for (const v of vertical) for (const h of horizontal) {
      const ratio=v.span/h.span;
      if (ratio<0.62 || ratio>1.61) continue;
      const vSupport=support(v,h,true);
      if (!vSupport) continue;
      const hSupport=support(h,v,false);
      if (!hSupport) continue;
      const box=[[0,0],[4,0],[4,4],[0,4]].map(([i,j])=>toPhoto(intersect(v.group[i],h.group[j])));
      if (box.some(p=>p.x<0 || p.x>width || p.y<0 || p.y>height) || !validCorners(box,30)) continue;
      const score=(hSupport+vSupport)/2-0.14*(v.error+h.error)-0.10*Math.abs(Math.log(ratio));
      if (score>=0.72) matches.push({box,score,span:v.span});
    }
    matches.sort((a,b)=>b.score-a.score);
    const best=matches[0];
    if (best) {
      out.ambiguous=matches.some(m=>m.score>=best.score-0.12 && distance(m.box[0],best.box[0])>best.span*0.19);
      if (!out.ambiguous) out.corners=best.box;
    }
    return out;
  }
  function detect(cv, rgba) {
    const gray=new cv.Mat(), contrast=new cv.Mat(), mask=new cv.Mat(), lines=new cv.Mat();
    const kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(17,17));
    try {
      cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);
      const side=Math.min(gray.cols,gray.rows);
      const results=[];
      for (const kind of [cv.MORPH_TOPHAT,cv.MORPH_BLACKHAT]) {
        cv.morphologyEx(gray,contrast,kind,kernel);
        const otsu=cv.threshold(contrast,mask,0,255,cv.THRESH_BINARY|cv.THRESH_OTSU);
        cv.threshold(contrast,mask,Math.max(10,otsu),255,cv.THRESH_BINARY);
        cv.HoughLinesP(mask,lines,1,Math.PI/720,Math.max(32,Math.round(side*0.14)),
          Math.max(30,Math.round(side*0.18)),Math.max(4,Math.round(side*0.012)));
        const data=lines.data32S, segments=[];
        for (let i=0; i<data.length; i+=4) segments.push([data[i],data[i+1],data[i+2],data[i+3]]);
        results.push(fit(segments,gray.cols,gray.rows));
      }
      if (results.some(r=>r.ambiguous) || (results.every(r=>r.corners) &&
          distance(results[0].corners[0],results[1].corners[0])>side*0.06)) {
        return {corners:null,ambiguous:true,snaps:results.flatMap(r=>r.snaps)};
      }
      return results.find(r=>r.corners) || results.sort((a,b)=>b.snaps.length-a.snaps.length)[0];
    } finally {
      [gray,contrast,mask,lines,kernel].forEach(m=>m.delete());
    }
  }
  return {fit,detect,validCorners};
})();
