/* Real-coefficient polynomial roots.
 * Ferrari seeds in x AND 1/x, followed by simultaneous Durand–Kerner polishing.
 * Reciprocal evaluation follows Morita et al., Applied Optics 49, 3442–3451 (2010),
 * Section 3.B, Eqs. (18)–(21). It is not a universal stability guarantee.
 * Independently bracketed real roots safeguard failed/colliding algebraic seeds.
 */
(function(root){
'use strict';
const C={
 add:(a,b)=>[a[0]+b[0],a[1]+b[1]], sub:(a,b)=>[a[0]-b[0],a[1]-b[1]],
 mul:(a,b)=>[a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]],
 scale:(a,s)=>[a[0]*s,a[1]*s], conj:a=>[a[0],-a[1]], abs:a=>Math.hypot(...a),
 div:(a,b)=>{let s=Math.max(Math.abs(b[0]),Math.abs(b[1]));if(!s)return [NaN,NaN];let x=b[0]/s,y=b[1]/s,d=x*x+y*y;return [(a[0]/s*x+a[1]/s*y)/d,(a[1]/s*x-a[0]/s*y)/d];},
 sqrt:a=>{let r=Math.hypot(...a);if(a[0]>=0){let u=Math.sqrt((r+a[0])/2);return u?[u,a[1]/(2*u)]:[0,0];}let v=Math.sqrt((r-a[0])/2)*(a[1]<0?-1:1);return [a[1]/(2*v),v];}
};
function value(a,z){let y=[0,0];for(let i=a.length-1;i>=0;i--)y=C.add(C.mul(y,z),[a[i],0]);return y;}
function residual(a,z){let b=0,r=C.abs(z);for(let i=a.length-1;i>=0;i--)b=b*r+Math.abs(a[i]);return C.abs(value(a,z))/Math.max(b,Number.MIN_VALUE);}
function quad(a,b,c){if(a===0)return b===0?[]:[[-c/b,0]];let s=C.sqrt([b*b-4*a*c,0]),q=C.scale(C.add([b,0],C.scale(s,b<0?-1:1)),-.5);if(C.abs(q)===0)return [[0,0],[0,0]];return [C.scale(q,1/a),C.div([c,0],q)];}
function cubic(a){const b=a[2]/a[3],c=a[1]/a[3],d=a[0]/a[3],p=c-b*b/3,q=2*b*b*b/27-b*c/3+d,D=q*q/4+p*p*p/27;
 if(D>=0){let u=Math.cbrt(-q/2+Math.sqrt(D)),v=Math.cbrt(-q/2-Math.sqrt(D));return [u+v-b/3];}
 let r=2*Math.sqrt(-p/3),theta=Math.acos(Math.max(-1,Math.min(1,3*q/(p*r))))/3;return [0,1,2].map(i=>r*Math.cos(theta-2*Math.PI*i/3)-b/3);
}
function ferrari(a){let b=a[3]/a[4],c=a[2]/a[4],d=a[1]/a[4],e=a[0]/a[4],p=c-3*b*b/8,q=b*b*b/8-b*c/2+d,r=-3*b**4/256+b*b*c/16-b*d/4+e,z;
 if(q===0){z=quad(1,p,r).flatMap(v=>{let w=C.sqrt(v);return [w,C.scale(w,-1)];});}
 else {let m=Math.max(...cubic([-q*q,p*p-4*r,2*p,1]));if(!(m>0))return [];let t=Math.sqrt(m),u=(p+m-q/t)/2,v=(p+m+q/t)/2;z=[...quad(1,t,u),...quad(1,-t,v)];}
 return z.map(v=>C.sub(v,[b/4,0]));
}
function polish(a,seeds){let z=seeds.map(x=>x.slice());if(z.length!==a.length-1)return z;
 for(let it=0;it<12;it++){let next=z.map(x=>x.slice()),moved=false;
  for(let i=0;i<z.length;i++){let den=[a.at(-1),0];for(let j=0;j<z.length;j++)if(i!==j)den=C.mul(den,C.sub(z[i],z[j]));if(C.abs(den)<1e-28)continue;
   let step=C.div(value(a,z[i]),den),v=C.sub(z[i],step);
   if(v.every(Number.isFinite)&&residual(a,v)<residual(a,z[i])){next[i]=v;moved=true;}}
  z=next;if(!moved)break;
 }return z;
}
function realValue(a,x){return a.reduceRight((y,v)=>y*x+v,0);}
function brackets(a){let n=a.length-1;if(n===1)return [-a[0]/a[1]];if(n===2)return quad(a[2],a[1],a[0]).filter(z=>z[1]===0).map(z=>z[0]);
 let der=a.slice(1).map((v,i)=>(i+1)*v),critical=brackets(der).sort((a,b)=>a-b),bound=1+Math.max(...a.slice(0,-1).map(v=>Math.abs(v/a.at(-1)))),pts=[-bound,...critical.filter(x=>Math.abs(x)<bound),bound],roots=[];
 for(const x of critical)if(residual(a,[x,0])<5e-15)roots.push(x);
 for(let i=1;i<pts.length;i++){let l=pts[i-1],h=pts[i],fl=realValue(a,l),fh=realValue(a,h);if(fl*fh>=0)continue;
  for(let j=0;j<140;j++){let m=(l+h)/2,fm=realValue(a,m);if(fm===0){l=h=m;break;}if(fl*fm<0){h=m;fh=fm;}else{l=m;fl=fm;}if(h-l<=4*Number.EPSILON*Math.max(1e-100,Math.abs(m)))break;}roots.push((l+h)/2);
 }return roots;
}
function solve(coeff){let a=coeff.slice();while(a.length>1&&a.at(-1)===0)a.pop();if(a.length<2)return {real:[],complex:[],residual:0,fallback:false};
 let scale=Math.max(...a.map(Math.abs));a=a.map(x=>x/scale);let n=a.length-1,candidates=[];
 if(n===1)candidates=[[-a[0]/a[1],0]];
 else if(n===2)candidates=quad(a[2],a[1],a[0]);
 else if(n===3)candidates=cubic(a).map(x=>[x,0]);
 else if(n===4){candidates=polish(a,ferrari(a));
  if(a[0]!==0){const rev=a.slice().reverse();let inv=polish(rev,ferrari(rev)).map(z=>C.div([1,0],z)).filter(z=>z.every(Number.isFinite));candidates.push(...polish(a,inv));}
 }else throw Error('Polynomial degree > 4');
 let real=candidates.filter(z=>Math.abs(z[1])<2e-10*Math.max(1,Math.abs(z[0]))&&residual(a,[z[0],0])<2e-12).map(z=>z[0]);
 // Bracketing also verifies completeness (including tangencies) independently of Ferrari.
 const safe=brackets(a);let fallback=safe.some(x=>!real.some(y=>Math.abs(x-y)<2e-8*Math.max(1,Math.abs(x))));
 real.push(...safe);real=real.filter(Number.isFinite).sort((a,b)=>a-b);
 let unique=[];for(let x of real){let last=unique.at(-1);if(last===undefined||Math.abs(last-x)>1e-9*Math.max(1,Math.abs(x)))unique.push(x);else if(residual(a,[x,0])<residual(a,[last,0]))unique[unique.length-1]=x;}
 return {real:unique,complex:candidates,residual:Math.max(0,...unique.map(x=>residual(a,[x,0]))),fallback};
}
root.Polynomial={C,solve,quad,residual};
if(typeof module!=='undefined')module.exports=root.Polynomial;
})(globalThis);
