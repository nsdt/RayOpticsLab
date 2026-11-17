// GPU7: conditional exact trajectories, Schur quadrature, and Hamiltonian RKF45.
// Numerical trajectories use the same metric as the CPU reference. Analytic
// derivatives avoid cancellation in f32; transverse momenta remain conserved.
var<private> pathTurned:bool;
struct Candidate {
  state:Path,
  valid:bool
}
fn anisotropicRhs(s:Path,mode:u32)->Path {
  if(cfg[0].w>=15) {
    return radialRhs(s,mode);
  }
  let m=localMaterial(1u,s.x);
  let v=kinv(s.p,m,mode);
  let kind=u32(cfg[0].w);
  let z=s.x.z;
  let g=cfg[2].w;
  let energy=dot(s.p,v);
  var force=0.;
  if(kind==2u) {
    force=-g/(1.+g*z)*energy;
  }
  if(kind==9u) {
    force=g*z/(1.+g*z*z)*energy;
  }
  if(kind==12u) {
    force=.5*g/(1.+g*z)*energy;
  }
  if(kind==14u) {
    force=cfg[21].z*z/(1.+cfg[21].z*z*z)*energy;
  }
  if(kind==10u && mode==1u) {
    let da=cfg[11].w*vec3f(-m.axis.y,m.axis.x,0);
    force=-(1./(m.no*m.no)-1./(m.ne*m.ne))*dot(m.axis,s.p)*dot(da,s.p);
  }
  if(kind==11u) {
    let n=1.+g*sin(z);
    force=g*cos(z)/n*select(s.p.z*s.p.z/(n*n),energy,mode==0u);
  }
  if(kind==13u) {
    let b=shearB(z);
    let db=1.5*cfg[12].w*z*vec2f(1,.45);
    force=(s.p.z-dot(b,s.p.xy))*dot(db,s.p.xy);
  }
  return Path(v,vec3f(0,0,force));
}
fn anisotropicRKF45(s:Path,h:f32,mode:u32)->Path {
  return rkf45(s,h,mode,0.);
}
// (dx/dz, dy/dz, pz, valid); h and D can both be negative.
fn schurSample(z:f32,k:vec2f,flow:f32,mode:u32)->vec4f {
  let G=opticalMetric(material(1u,z),mode);
  let det=G[0].x*G[1].y-G[1].x*G[0].y;
  if(abs(det)<2e-6) {
    return vec4f(0);
  }
  let M=mat2x2f(vec2f(G[1].y,-G[0].y),vec2f(-G[1].x,G[0].x))*(1./det);
  let B=G[2].xy;
  let mb=M*B;
  let mk=M*k;
  let h=G[2].z-dot(B,mb);
  let D=1.-dot(k,mk);
  if(!(h/D>0) || abs(D)<2e-5 || abs(h)<2e-5) {
    return vec4f(0);
  }
  return vec4f(flow*sqrt(h/D)*mk-mb,dot(B,mk)+flow*h*sqrt(D/h),1.);
}
fn anisotropicSchur(s:Path,z:f32,mode:u32)->Candidate {
  let v=kinv(s.p,localMaterial(1u,s.x),mode);
  if(abs(v.z)<1e-6) {
    return Candidate(s,false);
  }
  let flow=sign(v.z);
  let k=s.p.xy;
  let dz=z-s.x.z;
  let last=schurSample(z,k,flow,mode);
  if(last.w==0 || schurSample(s.x.z,k,flow,mode).w==0 || schurSample((s.x.z+z)*.5,k,flow,mode).w==0) {
    return Candidate(s,false);
  }
  let nodes=array<f32,4>(-.8611363115940526,-.3399810435848563,.3399810435848563,.8611363115940526);
  let weights=array<f32,4>(.3478548451374538,.6521451548625461,.6521451548625461,.3478548451374538);
  var q=vec2f(0);
  for(var j=0u;j<4u;j++) {
    let a=schurSample(s.x.z+dz*(1.+nodes[j])*.5,k,flow,mode);
    if(a.w==0) {
      return Candidate(s,false);
    }
    q+=a.xy*(dz*.5*weights[j]);
  }
  pixels[id].bulk.z++;
  return Candidate(Path(vec3f(s.x.xy+q,z),vec3f(k,last.z)),true);
}
fn closedAvailable(s:Path,z:f32,mode:u32)->bool {
  let kind=u32(cfg[0].w);
  let k=s.p.xy;
  let z0=s.x.z;
  let g=cfg[2].w;
  let v=kinv(s.p,localMaterial(1u,s.x),mode);
  if(abs(v.z)<1e-6) {
    return false;
  }
  if(kind==10u) {
    return (mode==0u && cfg[1].y*cfg[1].y-dot(k,k)>2e-5)||(mode==1u && dot(k,k)<1e-20);
  }
  if(kind==11u) {
    return (mode==0u && dot(k,k)<1e-20)||(mode==1u && 1.-dot(k,k)>2e-5);
  }
  if(kind==13u) {
    return 1.-dot(k,k)>2e-5;
  }
  if(kind==14u) {
    return mode==1u && abs(k.x*k.x-k.y*k.y)<1e-12;
  }
  if(kind==2u || kind==9u || kind==12u) {
    let b=blocks(opticalMetric(material(1u,0.),mode));
    let pi=dot(k,b.M*k);
    if(kind==2u) {
      let a=1.+g*z0;
      let c=1.+g*z;
      return min(a,c)>0 && min(1.-pi*a*a,1.-pi*c*c)>2e-5 && b.h>0;
    }
    if(kind==9u) {
      return g>=0 && 1.-pi>2e-5 && b.h>0;
    }
    let a=1.+g*z0;
    let c=1.+g*z;
    return min(a,c)>0 && min(pi-a,pi-c)>2e-5 && b.h< -2e-5;
  }
  return false;
}
fn anisotropicAdvance(s:Path,h:f32,mode:u32)->Path {
  if(cfg[0].w>=15) {
    return radialAdvance(s,h,mode);
  }
  let z=s.x.z+h*kinv(s.p,localMaterial(1u,s.x),mode).z;
  if(cfg[10].w==0 && closedAvailable(s,z,mode)) {
    return anisotropicClosed(s,z,mode);
  }
  if(cfg[10].w!=2 && cfg[39].w==0) {
    let q=anisotropicSchur(s,z,mode);
    if(q.valid) {
      return q.state;
    }
  }
  return anisotropicRKF45(s,h,mode);
}
fn anisotropicResidual(s:Path,mode:u32)->f32 {
  return abs(dot(s.p,kinv(s.p,localMaterial(1u,s.x),mode))-1.);
}
fn anisotropicSegment(s:Path,h:f32,anchor:Path,mode:u32,anchored:bool)->Path {
  if(cfg[0].w>=15) {
    return radialAdvance(s,h,mode);
  }
  let z=s.x.z+h*kinv(s.p,localMaterial(1u,s.x),mode).z;
  if(anchored && cfg[10].w==0 && closedAvailable(anchor,z,mode)) {
    return anisotropicClosed(anchor,z,mode);
  }
  return anisotropicAdvance(s,h,mode);
}
fn anisotropicTravel(r:Ray)->Path {
  let mode=u32(r.p.w);
  let anchor=Path(r.o.xyz,r.p.xyz);
  var s=anchor;
  let initial=sign(kinv(s.p,localMaterial(1u,s.x),mode).z);
  pathTurned=false;
  pixels[id].bulk.y++;
  anisotropicCheck(s,mode);
  for(var j=0u;j<3u*u32(cfg[8].y);j++) {
    if(pixels[id].aux.y>0u) {
      return s;
    }
    if(shapeValue(s.x)>5e-7) {
      fail(17u);
      return s;
    }
    let v=kinv(s.p,localMaterial(1u,s.x),mode);
    let speed=length(v);
    let distance=shapehit(s.x,v/speed,true);
    var maxStep=cfg[8].x;
    if(cfg[16].x==3) {
      maxStep=min(maxStep,.025);
    }
    if(cfg[0].w==10) {
      maxStep=min(maxStep,.1/(1.+abs(cfg[11].w)));
    }
    var h=min(maxStep,max(2e-5,1.05*select(maxStep,distance,distance>0)))/speed;
    var end=anisotropicSegment(s,h,anchor,mode,!pathTurned);
    var mid=anisotropicSegment(s,h*.5,anchor,mode,!pathTurned);
    for(var retry=0u;retry<12u;retry++) {
      let residual=max(anisotropicResidual(mid,mode),anisotropicResidual(end,mode));
      let bend=length(mid.x-(s.x+end.x)*.5);
      if(residual<2e-6 && bend<1e-4) {
        break;
      }
      h*=.5;
      mid=anisotropicSegment(s,h*.5,anchor,mode,!pathTurned);
      end=anisotropicSegment(s,h,anchor,mode,!pathTurned);
    }
    pixels[id].bulk.x++;
    if(pixels[id].aux.y>0u) {
      return s;
    }
    anisotropicCheck(mid,mode);
    anisotropicCheck(end,mode);
    if(initial*kinv(mid.p,localMaterial(1u,mid.x),mode).z<=1e-7 || initial*kinv(end.p,localMaterial(1u,end.x),mode).z<=1e-7) {
      pathTurned=true;
    }
    if(shapeValue(mid.x)>=0) {
      h*=.5;
      end=mid;
    }
    if(shapeValue(end.x)>=0) {
      let q=refineSurface(s,h,anchor,0.,mode,!pathTurned,false);
      if(pixels[id].aux.y>0u) {
        return q;
      }
      anisotropicCheck(q,mode);
      if(abs(shapeValue(q.x))>1e-6 || dot(normal(q.x),safeunit(kinv(q.p,localMaterial(1u,q.x),mode)))<.004) {
        fail(17u);
      }
      if(pathTurned && (cfg[16].x==1 || cfg[16].x==2)) {
        fail(17u);
      }
      return q;
    }
    if(length(end.x-s.x)<1e-8) {
      fail(17u);
      return s;
    }
    s=end;
  }
  fail(17u);
  return s;
}
fn anisotropicZRhs(s:Path,mode:u32,flow:f32)->Path {
  let a=anisotropicRhs(s,mode);
  if(flow*a.x.z<=1e-7) {
    fail(17u);
    return Path();
  }
  return Path(a.x/a.x.z,a.p/a.x.z);
}
// z-parameter integration is used only by an explicitly monotone modal pair.
fn anisotropicAtZ(s:Path,z:f32,mode:u32)->Path {
  if(z==s.x.z) {
    return s;
  }
  if(cfg[10].w==0 && closedAvailable(s,z,mode)) {
    return anisotropicClosed(s,z,mode);
  }
  let v=kinv(s.p,localMaterial(1u,s.x),mode);
  let flow=sign(v.z);
  if(abs(v.z)<1e-7 || flow*(z-s.x.z)<-1e-7) {
    fail(17u);
    return s;
  }
  let rot=select(0.,abs(cfg[11].w),cfg[0].w==10);
  let count=u32(max(1.,ceil(abs(z-s.x.z)/min(cfg[8].x,.1/(1.+rot)))));
  if(count>4096u) {
    fail(17u);
    return s;
  }
  let h=(z-s.x.z)/f32(count);
  var q=s;
  for(var i=0u;i<count;i++) {
    let destination=s.x.z+(z-s.x.z)*f32(i+1u)/f32(count);
    if(cfg[10].w!=2 && cfg[39].w==0) {
      let candidate=anisotropicSchur(q,destination,mode);
      if(candidate.valid) {
        q=candidate.state;
        continue;
      }
    }
    q=rkf45(q,destination-q.x.z,mode,flow);
    q.x.z=destination;
    if(pixels[id].aux.y>0u) {
      return q;
    }
  }
  anisotropicCheck(q,mode);
  return q;
}
// Fehlberg six-stage 4(5). Use the difference of increments, not rounded
// endpoint subtraction. cfg[18]: relative, position absolute, momentum absolute,
// trial limit. Accepted order-5 states are never projected onto H=1/2.
fn odeRhs(s:Path,mode:u32,zFlow:f32)->Path {
  pixels[id].odeCounts.z++;
  if(zFlow!=0) {
    return anisotropicZRhs(s,mode,zFlow);
  }
  if(isGrin()) {
    return grinRhs(s);
  }
  return anisotropicRhs(s,mode);
}
fn rkf45(s:Path,interval:f32,mode:u32,zFlow:f32)->Path {
  if(interval==0) {
    return s;
  }
  let direction=sign(interval);
  let total=abs(interval);
  var traveled=0.;
  var dt=total;
  var y=s;
  let controls=cfg[18];
  for(var trial=0u;trial<u32(controls.w);trial++) {
    dt=min(dt,total-traveled);
    if(!(dt>0) || traveled+dt==traveled) {
      pixels[id].odeCounts.w++;
      fail(18u);
      return y;
    }
    let h=direction*dt;
    let a=odeRhs(y,mode,zFlow);
    let b=odeRhs(pathAdd(y,a,h/4.),mode,zFlow);
    let c=odeRhs(Path(y.x+h*(3./32.*a.x+9./32.*b.x),y.p+h*(3./32.*a.p+9./32.*b.p)),mode,zFlow);
    let d=odeRhs(Path(y.x+h*(1932./2197.*a.x-7200./2197.*b.x+7296./2197.*c.x),y.p+h*(1932./2197.*a.p-7200./2197.*b.p+7296./2197.*c.p)),mode,zFlow);
    let e=odeRhs(Path(y.x+h*(439./216.*a.x-8.*b.x+3680./513.*c.x-845./4104.*d.x),y.p+h*(439./216.*a.p-8.*b.p+3680./513.*c.p-845./4104.*d.p)),mode,zFlow);
    let f=odeRhs(Path(y.x+h*(-8./27.*a.x+2.*b.x-3544./2565.*c.x+1859./4104.*d.x-11./40.*e.x),y.p+h*(-8./27.*a.p+2.*b.p-3544./2565.*c.p+1859./4104.*d.p-11./40.*e.p)),mode,zFlow);
    if(pixels[id].aux.y>0u) {
      pixels[id].odeCounts.w++;
      return y;
    }
    let end=Path(y.x+h*(16./135.*a.x+6656./12825.*c.x+28561./56430.*d.x-9./50.*e.x+2./55.*f.x),y.p+h*(16./135.*a.p+6656./12825.*c.p+28561./56430.*d.p-9./50.*e.p+2./55.*f.p));
    let dx=abs(h*(a.x/360.-128./4275.*c.x-2197./75240.*d.x+e.x/50.+2./55.*f.x));
    let dp=abs(h*(a.p/360.-128./4275.*c.p-2197./75240.*d.p+e.p/50.+2./55.*f.p));
    let ex=dx/(vec3f(controls.y)+controls.x*max(abs(y.x),abs(end.x)));
    let ep=dp/(vec3f(controls.z)+controls.x*max(abs(y.p),abs(end.p)));
    let error=max(max(ex.x,max(ex.y,ex.z)),max(ep.x,max(ep.y,ep.z)));
    if(!(error>=0 && error<1e30) || any(abs(end.x)>vec3f(1e20)) || any(abs(end.p)>vec3f(1e20))) {
      pixels[id].odeCounts.w++;
      fail(18u);
      return y;
    }
    if(error<=1) {
      y=end;
      traveled=select(traveled+dt,total,dt==total-traveled);
      pixels[id].odeCounts.x++;
      pixels[id].bulk.w++;
      pixels[id].odeControl.x=max(pixels[id].odeControl.x,error);
      pixels[id].odeControl.y=select(min(pixels[id].odeControl.y,dt),dt,pixels[id].odeControl.y==0);
      pixels[id].odeControl.z=max(pixels[id].odeControl.z,dt);
      if(traveled==total) {
        return y;
      }
    }
    else {
      pixels[id].odeCounts.y++;
    }
    var factor=5.;
    if(error>0) {
      factor=clamp(.9*pow(error,-.2),.1,select(.5,5.,error<=1));
    }
    dt*=factor;
  }
  pixels[id].odeCounts.w++;
  fail(18u);
  return y;
}
// Curved exit refinement (2011 Sec. 4 principle). A secant parameter is only
// a proposal: every candidate recomputes x and p on the original trajectory.
fn exitDistance(x:vec3f)->f32 {
  if(cfg[9].y==4) {
    return asphereValue(x);
  }
  if(cfg[9].y==3) {
    return abs(x.z)-1.;
  }
  if(cfg[9].y==1) {
    return length(x)-1.;
  }
  if(cfg[9].y==2) {
    return length(vec2f(length(x.xz)-.72,x.y))-.29;
  }
  let a=abs(x)-vec3f(1);
  return length(max(a,vec3f(0)))+min(max(a.x,max(a.y,a.z)),0.);
}
fn exitSample(start:Path,t:f32,anchor:Path,tau:f32,mode:u32,anchored:bool,isotropic:bool)->Path {
  if(t==0) {
    return start;
  }
  if(isotropic) {
    return grinSegment(start,t,anchor,tau);
  }
  return anisotropicSegment(start,t,anchor,mode,anchored);
}
fn exitVelocity(s:Path,mode:u32,isotropic:bool)->vec3f {
  if(isotropic) {
    return s.p/grinN2(s.x);
  }
  return kinv(s.p,localMaterial(1u,s.x),mode);
}
fn refineSurface(start:Path,limit:f32,anchor:Path,tau:f32,mode:u32,anchored:bool,isotropic:bool)->Path {
  var lo=0.;
  var hi=limit;
  var a=start;
  var b=exitSample(start,hi,anchor,tau,mode,anchored,isotropic);
  var fa=exitDistance(a.x);
  var fb=exitDistance(b.x);
  if(!(fa<=0 && fb>=0)) {
    fail(19u);
    return b;
  }
  // Eight f32 ulps leave room for anchored closed-form evaluation roundoff.
  let tolerance=9.5367431640625e-7*max(1.,max(length(a.x),length(b.x)));
  let initialSpeed=length(exitVelocity(start,mode,isotropic));
  for(var iteration=0u;iteration<48u;iteration++) {
    if(pixels[id].aux.y>0u) {
      return b;
    }
    let span=max(length(b.x-a.x),(hi-lo)*initialSpeed);
    let directionSpan=length(safeunit(exitVelocity(b,mode,isotropic))-safeunit(exitVelocity(a,mode,isotropic)));
    let momentumSpan=length(b.p-a.p)/max(1.,max(length(a.p),length(b.p)));
    if(span<=tolerance && directionSpan<=9.5367431640625e-7 && momentumSpan<=9.5367431640625e-7) {
      var q=exitSample(start,(lo+hi)*.5,anchor,tau,mode,anchored,isotropic);
      if(abs(fa)<abs(exitDistance(q.x))) {
        q=a;
      }
      if(abs(fb)<abs(exitDistance(q.x))) {
        q=b;
      }
      let residual=abs(exitDistance(q.x));
      if(!(residual<=tolerance)) {
        fail(19u);
      }
      pixels[id].phaseExtra.w=max(pixels[id].phaseExtra.w,residual);
      return q;
    }
    var fraction=.5;
    if(iteration%3u!=2u && fb!=fa) {
      fraction=clamp(-fa/(fb-fa),.25,.75);
    }
    let t=lo+(hi-lo)*fraction;
    if(!(t>lo && t<hi)) {
      fail(19u);
      return b;
    }
    let q=exitSample(start,t,anchor,tau,mode,anchored,isotropic);
    let f=exitDistance(q.x);
    if(f<0) {
      lo=t;
      a=q;
      fa=f;
    }
    else {
      hi=t;
      b=q;
      fb=f;
    }
  }
  fail(19u);
  return b;
}
// Three-dimensional radial media. The covector is pulled back from a
// straight virtual ray for transformation media; radial ordinary rays use RKF45.
fn radialRhs(s:Path,mode:u32)->Path {
  let r=s.x-cfg[20].xyz;
  let v=kinv(s.p,localMaterial(1u,s.x),mode);
  if(cfg[0].w==15) {
    let b=1./(cfg[20].w*cfg[20].w);
    let u=b*dot(r,r);
    let q=dot(r,s.p);
    let A=dot(s.p,s.p)-b*q*q;
    if(mode==0u) {
      return Path(v,2.*b*(1.-u)*dot(s.p,s.p)*r);
    }
    return Path(v,b*A*r+b*(1.-u)*q*s.p);
  }
  let a=mapAxes(r);
  let rho=length(a);
  let w=mapJ(s.x,true)*s.p;
  let vv=mapAxes(v);
  let ww=mapAxes(w);
  let C=mapScale()*cfg[21].x;
  let force=C/(rho*rho*rho)*(ww*dot(a,vv)+vv*dot(ww,a)+a*dot(ww,vv)-3.*a*dot(ww,a)*dot(a,vv)/(rho*rho));
  return Path(v,force);
}
fn radialAdvance(s:Path,h:f32,mode:u32)->Path {
  if(cfg[10].w==2 || (cfg[0].w==15 && mode==0u)) {
    return rkf45(s,h,mode,0.);
  }
  pixels[id].aux.z++;
  if(cfg[0].w==15) {
    let v=kinv(s.p,localMaterial(1u,s.x),mode);
    let x=s.x+h*v;
    let d=safeunit(v);
    let gd=opticalMetric(localMaterial(1u,x),mode)*d;
    return Path(x,gd/sqrt(dot(d,gd)));
  }
  let pv=mapJ(s.x,true)*s.p;
  let X=mapForward(s.x)+h*pv;
  let x=mapInverse(X);
  return Path(x,mapJ(x,false)*pv);
}
