/* Geometrical optics kernels. Dimensionless coordinates, real lossless modes. */
(function(root){
if(!root.Polynomial&&typeof require==='function')root.Polynomial=require('./polynomial.js');
if(!root.LandmarkTarget&&typeof require==='function')root.LandmarkTarget=require('./landmark-target.js');
if(!root.Asphere&&typeof require==='function')root.Asphere=require('./asphere.js');
if(!root.LiteratureMedia&&typeof require==='function')root.LiteratureMedia=require('./literature-media.js');
const add=(a,b)=>a.map((v,i)=>v+b[i]), mul=(a,s)=>a.map(v=>v*s), dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0), norm=a=>Math.sqrt(dot(a,a)), unit=a=>mul(a,1/norm(a)), cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const mv=(A,p)=>A.map(r=>dot(r,p)), diag=d=>d.map((v,i)=>d.map((_,j)=>i===j?v:0));
function inv(A){let [a,b,c]=A[0],[d,e,f]=A[1],[g,h,i]=A[2],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);if(Math.abs(det)<1e-12)throw Error('計量が退化しています');return [[e*i-f*h,c*h-b*i,b*f-c*e],[f*g-d*i,a*i-c*g,c*d-a*f],[d*h-e*g,b*g-a*h,a*e-b*d]].map(r=>r.map(x=>x/det));}
function axes(c,z=0){let t=c.tilt*Math.PI/180,ph=c.azimuth*Math.PI/180+(c.material==='heliconical'?c.twist*z:0),A=[Math.cos(t)*Math.cos(ph),Math.cos(t)*Math.sin(ph),-Math.sin(t)],B=[-Math.sin(ph),Math.cos(ph),0],D=[Math.sin(t)*Math.cos(ph),Math.sin(t)*Math.sin(ph),Math.cos(t)];if(c.material!=='biaxial')return [A,B,D];const r=(c.roll??0)*Math.PI/180;return [add(mul(A,Math.cos(r)),mul(B,Math.sin(r))),add(mul(A,-Math.sin(r)),mul(B,Math.cos(r))),D];}
function rotated(d,c,z){let R=axes(c,z);return [0,1,2].map(i=>[0,1,2].map(j=>d.reduce((s,v,k)=>s+v*R[k][i]*R[k][j],0)));}
function metric(x,c,mode){if(root.LiteratureMedia?.supported(c.material))return root.LiteratureMedia.metric(x,c,mode);let z=x[2],n=c.n,g=c.gradient,m=c.material;
 if(['sphericalSquared','radialSquared','axialSquared'].includes(m)){let nn=n*n+(m==='axialSquared'?g*z:-g*(x[0]*x[0]+x[1]*x[1]+(m==='sphericalSquared'?z*z:0)));if(nn<=.0025)throw Error('n²が非正または設定範囲外');return diag([nn,nn,nn]);}
 if(m==='isotropic')return diag([n*n,n*n,n*n]);
 if(m==='axial'||m==='radial'){let r=m==='axial'?z:dot(x,x),nn=n+g*r;if(nn<=.05)throw Error('屈折率が非正');return diag([nn*nn,nn*nn,nn*nn]);}
 if(m==='axial2013'||m==='axial2013Uniaxial'){let b=1+g*Math.sin(z);if(m==='axial2013Uniaxial'&&b<=0)throw Error('2013 axialの一軸実現には1+g sin z > 0が必要です');return diag(m==='axial2013Uniaxial'&&mode===0?[b*b,b*b,b*b]:[1,1,b*b]);}
 if(m==='eng2013'||m==='eng2013Magnetic'){let a=(c.engStrength??1)*z*z+1;return diag(m==='eng2013Magnetic'&&mode===0?[-a,-a,-.25*a]:[a,-a,.25*a]);}
 if(m==='molded2013'||m==='moldedApprox'||m==='molded2013Transform')return diag([c.n*c.n-g*x[0]*x[0],c.n*c.n-g*x[1]*x[1],(1+.2*z)**2]);
 if(m==='shear'){let t=(z+1)/2,b=-c.shift*3*t*(1-t);return [[1,0,b],[0,1,b*.45],[b,b*.45,1+b*b*1.2025]];}
 let scale=m==='common'?1/(1+g*z)**2:m==='quadratic'?1+g*z*z:m==='hyperbolic'?1+g*z:1;
 if(!(scale>0)||m==='common'&&1+g*z<=0)throw Error('scaleの条件外');
 let no=c.no,ne=c.ne;
 if(m==='hyperbolic'||c.negativeOrdinary)return mode===0?diag([-no*no*scale,-no*no*scale,-no*no*scale]):rotated([ne*ne*scale,ne*ne*scale,-no*no*scale],c,z);
 if(mode===0)return diag([no*no*scale,no*no*scale,no*no*scale]);
 return rotated([ne*ne*scale,ne*ne*scale,no*no*scale],c,z);
}
function H(x,p,c,mode){if(c.material!=='biaxial')return .5*dot(p,mv(inv(metric(x,c,mode)),p));
 // Maxwell: eigenvalues of |p|^2 P epsilon^-1 P on the plane perpendicular to p.
 let q=norm(p);if(q<1e-12)return 0;let d=mul(p,1/q),u=unit(cross(d,Math.abs(d[2])<.9?[0,0,1]:[0,1,0])),v=cross(d,u),E=rotated([1/c.nx**2,1/c.ny**2,1/c.nz**2],c,0),a=dot(u,mv(E,u)),b=dot(u,mv(E,v)),e=dot(v,mv(E,v));return .25*q*q*(a+e+(mode?1:-1)*Math.hypot(a-e,2*b));}
function velocity(x,p,c,mode){if(c.material!=='biaxial')return mv(inv(metric(x,c,mode)),p);return [0,1,2].map(i=>{let a=p.slice(),b=p.slice(),e=1e-5;a[i]+=e;b[i]-=e;return (H(x,a,c,mode)-H(x,b,c,mode))/(2*e);});}
function biaxialTensor(c){return rotated([c.nx**2,c.ny**2,c.nz**2],c,0);}
// det(epsilon + p p^T - (p.p) I), p = tang + q N, in ascending powers of q.
function biaxialPolynomial(tang,N,c){const E=biaxialTensor(c),Et=mv(E,tang),En=mv(E,N),a=[dot(tang,Et),2*dot(N,Et),dot(N,En)],b=[dot(tang,tang),2*dot(tang,N),dot(N,N)],tr=c.nx**2+c.ny**2+c.nz**2,ee=[dot(Et,Et),2*dot(En,Et),dot(En,En)],poly=[0,0,0,0,0];for(let i=0;i<3;i++){for(let j=0;j<3;j++)poly[i+j]+=a[i]*b[j];poly[i]+=ee[i]-tr*a[i];}poly[0]+=c.nx**2*c.ny**2*c.nz**2;return poly;}
function boundary(x,p,N,c,mode,inward=true){let tang=add(p,mul(N,-dot(p,N))),roots=[];
 if(c.material!=='biaxial'){let K=inv(metric(x,c,mode)),a=dot(N,mv(K,N)),b=2*dot(N,mv(K,tang)),cc=dot(tang,mv(K,tang))-1,d=b*b-4*a*cc;if(d<0)return null;if(Math.abs(a)<1e-12){if(Math.abs(b)>1e-12)roots=[-cc/b];}else roots=[(-b+Math.sqrt(d))/(2*a),(-b-Math.sqrt(d))/(2*a)];}
 else {roots=root.Polynomial.solve(biaxialPolynomial(tang,N,c)).real;}
 for(let r of roots){let q=add(tang,mul(N,r));if(c.material==='biaxial'&&Math.abs(2*H(x,q,c,mode)-1)>2e-7)continue;let vn=dot(velocity(x,q,c,mode),N);if(inward?vn< -1e-8:vn>1e-8)return q;}return null;}
function sdf(p,shape){if(root.Asphere.is(shape))return root.Asphere.residual(p,shape);if(shape==='slab')return Math.abs(p[2])-1;if(shape==='sphere')return norm(p)-1;if(shape==='cube'){let q=p.map(v=>Math.abs(v)-1);return norm(q.map(v=>Math.max(v,0)))+Math.min(Math.max(...q),0);}return Math.hypot(Math.hypot(p[0],p[2])-.72,p[1])-.29;}
function normal(p,shape){if(root.Asphere.is(shape))return root.Asphere.normal(p,shape);if(shape==='sphere')return unit(p);if(shape==='slab')return [0,0,Math.sign(p[2])];if(shape==='torus'){const rho=Math.hypot(p[0],p[2]);return unit([p[0]*(1-.72/rho),p[1],p[2]*(1-.72/rho)]);}let e=1e-5;return unit([0,1,2].map(i=>{let a=p.slice(),b=p.slice();a[i]+=e;b[i]-=e;return sdf(a,shape)-sdf(b,shape);}));}

// Exit refinement follows the principle of Nishidate et al. (2011), Sec. 4:
// cancel an overshooting step and re-evaluate the curved ray near the surface.
// Our analytic implicit shapes permit a bracketed curve/surface solve instead
// of Algorithm 1's line/Nagata-patch iterations. Interpolation predicts only a
// parameter; neither the final position nor momentum is linearly interpolated.
function resetExitStats(){return root.Optics.exitStats={calls:0,iterations:0,failures:0,maxResidual:0,maxPositionSpan:0,maxDirectionSpan:0,maxMomentumSpan:0};}
function refineExit(initial,h,c,mode,evaluate){
 const O=root.Optics,stats=O.exitStats||resetExitStats();stats.calls++;
 try{
  if(!(h>0)||!Number.isFinite(h))throw Error('出口探索の区間が不正です');
  const advance=evaluate||((t)=>O.advance(initial,t,c,mode));
  const sample=t=>{const q=t===0?initial.slice():advance(t);if(!q||!q.every(Number.isFinite))throw Error('出口探索で非有限な軌道を検出しました');return q;};
  const velocity=q=>O.velocity(q.slice(0,3),q.slice(3),c,mode);
  let lo=0,hi=h,a=sample(0),b=sample(h),fa=sdf(a.slice(0,3),c.shape),fb=sdf(b.slice(0,3),c.shape);
  if(!(fa<=0&&fb>=0))throw Error('出口を挟む内外の区間を確認できません');
  const scale=Math.max(1,norm(a.slice(0,3)),norm(b.slice(0,3))),positionTolerance=1e-10*scale,directionTolerance=1e-10,momentumTolerance=1e-10;
  const initialSpeed=norm(velocity(a));
  for(let iteration=1;iteration<=80;iteration++){
   stats.iterations++;
   const va=velocity(a),vb=velocity(b),positionSpan=Math.max(norm(add(b.slice(0,3),mul(a.slice(0,3),-1))),(hi-lo)*initialSpeed),directionSpan=norm(add(unit(vb),mul(unit(va),-1))),momentumSpan=norm(add(b.slice(3),mul(a.slice(3),-1)))/Math.max(1,norm(a.slice(3)),norm(b.slice(3)));
   if(positionSpan<=positionTolerance&&directionSpan<=directionTolerance&&momentumSpan<=momentumTolerance){
    const t=(lo+hi)/2,q=sample(t),residual=Math.abs(sdf(q.slice(0,3),c.shape));
    if(residual>positionTolerance)throw Error('出口位置の表面残差が許容値を超えました');
    stats.maxResidual=Math.max(stats.maxResidual,residual);stats.maxPositionSpan=Math.max(stats.maxPositionSpan,positionSpan);stats.maxDirectionSpan=Math.max(stats.maxDirectionSpan,directionSpan);stats.maxMomentumSpan=Math.max(stats.maxMomentumSpan,momentumSpan);
    return {state:q,t,residual,positionSpan,directionSpan,momentumSpan,iterations:iteration};
   }
   // Safeguarded secant; a periodic midpoint prevents one-sided stagnation.
   const fraction=iteration%3===0?.5:Math.max(.25,Math.min(.75,-fa/(fb-fa))),t=lo+(hi-lo)*fraction;
   if(!(t>lo&&t<hi))throw Error('出口探索が丸め精度に達しました');
   const q=sample(t),f=sdf(q.slice(0,3),c.shape);
   if(f<0){lo=t;a=q;fa=f;}else{hi=t;b=q;fb=f;}
  }
  throw Error('出口位置と出射方向の収束を確認できません');
 }catch(e){stats.failures++;throw e;}
}

function torusRoots(o,d){const R=.72,r=.29,a=dot(o,o)+R*R-r*r,b=2*dot(o,d),cc=dot(d,d),t=4*R*R;return root.Polynomial.solve([a*a-t*(o[0]**2+o[2]**2),2*a*b-2*t*(o[0]*d[0]+o[2]*d[2]),b*b+2*a*cc-t*(d[0]**2+d[2]**2),2*b*cc,cc*cc]).real;}
function hit(o,d,shape){
 if(root.Asphere.is(shape))return root.Asphere.hit(o,d,shape,false);
 if(shape==='slab'){if(Math.abs(d[2])<1e-14)return null;const t=(-Math.sign(d[2])-o[2])/d[2];return t>1e-7?add(o,mul(d,t)):null;}
 // Exact exterior intersections avoid treating an outgoing grazing ray as a new entrance.
 if(shape==='sphere'){const b=dot(o,d),cc=dot(o,o)-1,disc=b*b-cc;if(disc<0)return null;const t=-b-Math.sqrt(disc);return t>1e-7?add(o,mul(d,t)):null;}
 if(shape==='cube'){let near=-Infinity,far=Infinity;for(let i=0;i<3;i++){if(Math.abs(d[i])<1e-14){if(Math.abs(o[i])>1)return null;continue;}const a=(-1-o[i])/d[i],b=(1-o[i])/d[i];near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));}return near<=far&&near>1e-7?add(o,mul(d,near)):null;}
 for(let t of torusRoots(o,d)){if(t<=1e-7)continue;let p=add(o,mul(d,t));if(dot(normal(p,shape),d)<-1e-9)return p;}return null;}
function cameraFrame(c){
 const yaw=c.yaw*Math.PI/180,pitch=c.pitch*Math.PI/180,side=c.cameraSide==='negative'?-1:1;
 const eye=[4*Math.sin(yaw)*Math.cos(pitch),4*Math.sin(pitch),side*4*Math.cos(yaw)*Math.cos(pitch)],forward=unit(mul(eye,-1)),right=unit(cross(forward,[0,1,0])),up=cross(right,forward);
 return {eye,forward,right,up};
}
function backgroundDistance(o,d,c){if(Math.abs(d[2])<1e-7)return Infinity;const t=(c.backgroundZ-o[2])/d[2];return t>0?t:Infinity;}
function axisHalfWidth(c){
 // Display guide: keep the infinite axis bands visible when a 64 px grid misses their centre.
 // This is a minimum display width, not a fixed-width radiometric calibration target.
 const footprint=(c.projection==='ortho'?3.4:2*(4+Math.abs(c.backgroundZ))*Math.tan((c.fov??46)*Math.PI/360))/(c.resolution??128);
 const obliquity=Math.max(.25,Math.cos((c.yaw??0)*Math.PI/180)*Math.cos((c.pitch??0)*Math.PI/180));
 return Math.max(.025,.75*footprint/obliquity);
}
function bg(o,d,c){if(c.background==='white')return [255,255,255];let t=backgroundDistance(o,d,c);if(!Number.isFinite(t))return c.spectralSample?Array(3).fill(255*(1.055*.05**(1/2.4)-.055)):[25,34,52];let p=add(o,mul(d,t)),x=p[0],y=p[1];if(c.background==='spectralLandmarks'&&root.LandmarkTarget)return root.LandmarkTarget.sample(x,y,c.wavelengthNm);if(c.background==='grid'&&root.LandmarkTarget)return root.LandmarkTarget.sample(x,y);if(c.background==='spectralChecker')return (((Math.floor(x*2)+Math.floor(y*2))%2+2)%2)?[255,255,255]:[64,64,64];if(c.background==='spectralSmooth'){const v=.5+.45*Math.sin(3*x)*Math.sin(3*y),s=255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055);return [s,s,s];}if(c.background==='markers'){let dx=Math.abs(x-Math.round(x)),dy=Math.abs(y-Math.round(y));return dx<.025&&dy<.16||dy<.025&&dx<.16?[255,255,255]:[0,0,0];}if(c.background==='uv')return [128+100*Math.sin(x),128+100*Math.sin(y),150];const axisWidth=axisHalfWidth(c);if(Math.abs(y)<axisWidth)return [218,54,57];if(Math.abs(x)<axisWidth)return [32,145,80];
 const palette=x>=0?(y>=0?[230,240,250]:[250,244,224]):(y>=0?[250,231,236]:[239,232,250]);
 const colored=((Math.floor(x*2)+Math.floor(y*2))%2+2)%2;
 return colored?palette:[64,64,64];}
function outsideIndex(c){let n=c.outsideN??1;if(!Number.isFinite(n)||n<=0)throw Error('外部屈折率は正の有限値です');return n;}
function exitDirection(p,N,c){const n=outsideIndex(c),tang=add(p,mul(N,-dot(p,N))),r=n*n-dot(tang,tang);return r<0?null:unit(add(tang,mul(N,Math.sqrt(r))));}

function trace(o,d,c,mode){let rayO=o.slice(),rayD=d.slice(),segments=0,drift=0;
 while(segments++<6){let entry=hit(rayO,rayD,c.shape);if(!entry)return {color:bg(rayO,rayD,c),status:'ok',drift};let N=normal(entry,c.shape),p=boundary(entry,mul(rayD,outsideIndex(c)),N,c,mode,true);if(!p)return {color:[110,44,116],status:'no-mode',drift};let x=add(entry,mul(unit(velocity(entry,p,c,mode)),1e-4)),s=[...x,...p],exited=false;
 for(let k=0;k<c.maxSteps;k++){let v=velocity(s.slice(0,3),s.slice(3),c,mode),dt=c.step/Math.max(norm(v),.05),next=root.Optics.advance(s,dt,c,mode);if(!next.every(Number.isFinite))throw Error('非有限値');drift=Math.max(drift,Math.abs(2*H(next.slice(0,3),next.slice(3),c,mode)-1));if(sdf(next.slice(0,3),c.shape)>=0){s=refineExit(s,dt,c,mode).state;x=s.slice(0,3);p=s.slice(3);N=normal(x,c.shape);let out=exitDirection(p,N,c);if(!out)return {color:[47,57,83],status:'tir',drift};rayD=out;rayO=add(x,mul(rayD,2e-4));exited=true;break;}s=next;}
 if(!exited)return {color:[225,151,35],status:'limit',drift};
 }return {color:[225,151,35],status:'limit',drift};}
const defaults={shape:'sphere',material:'isotropic',n:1.5,outsideN:1,preset:'custom',no:1.658,ne:1.486,nx:1.7404,ny:1.7479,nz:1.8296,gradient:.2,engStrength:1,radialRadius:7,transformInner:.7,transformOuter:5,tilt:0,azimuth:0,roll:0,twist:3.14,shift:.5,step:.035,maxSteps:650,backgroundZ:-3,cameraSide:'positive',background:'grid',mode:1,yaw:0,pitch:0,fov:46,projection:'perspective',resolution:128,solver:'rkf45'};
root.Optics={refineExit,resetExitStats,biaxialTensor,biaxialPolynomial,principalAxes:axes,cameraFrame,backgroundDistance,axisHalfWidth,torusRoots,outsideIndex,exitDirection,add,mul,dot,norm,unit,cross,mv,inv,metric,H,velocity,boundary,sdf,normal,hit,bg,trace,defaults};root.Optics.evaluations={closed:0,quadrature:0,ode:0,approximate:0};root.Optics.recordStep=kind=>root.Optics.evaluations[kind]++;if(typeof module!=='undefined'){module.exports=root.Optics;require('./rkf45.js');}
})(globalThis);



