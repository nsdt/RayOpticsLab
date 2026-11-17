// Flux-normalized forward modes and SU(2) transfer on the original continuous
// medium. Derivatives are analytic to avoid f32 finite-difference cancellation.
struct ModeDerivative {
  e:vec3f,
  h:vec3f,
  de:vec3f,
  dh:vec3f,
  p:vec3f
}
fn modeDerivative(z:f32,k:vec2f,flow:f32,mode:u32)->ModeDerivative {
  let m=material(1u,z);
  let axis=m.axis;
  var da=vec3f(0);
  var dno=0.;
  var dne=0.;
  let kind=u32(cfg[0].w);
  let g=cfg[2].w;
  if(kind==2u) {
    let r=-g/(1.+g*z);
    dno=m.no*r;
    dne=m.ne*r;
  }
  if(kind==9u) {
    let r=g*z/(1.+g*z*z);
    dno=m.no*r;
    dne=m.ne*r;
  }
  if(kind==10u) {
    da=cfg[11].w*vec3f(-axis.y,axis.x,0);
  }
  if(kind==11u) {
    dno=g*cos(z);
  }
  let f=modefield(m,vec3f(k,0),vec3f(0,0,flow),1.,mode);
  if(f.prop==0u || f.flux<1e-6) {
    fail(14u);
    return ModeDerivative();
  }
  let p=f.p;
  let c=1./(m.no*m.no)-1./(m.ne*m.ne);
  let dc=-2.*dno/(m.no*m.no*m.no)+2.*dne/(m.ne*m.ne*m.ne);
  var dk=-2.*dne/(m.ne*m.ne*m.ne)*p+dc*axis*dot(axis,p)+c*(da*dot(axis,p)+axis*dot(da,p));
  if(mode==0u) {
    dk=-2.*dno/(m.no*m.no*m.no)*p;
  }
  let vz=kinv(p,m,mode).z;
  if(abs(vz)<1e-6) {
    fail(14u);
    return ModeDerivative();
  }
  let dp=vec3f(0,0,-dot(p,dk)/(2.*vz));
  var eo=cross(axis,p);
  var deo=cross(da,p)+cross(axis,dp);
  if(length(eo)<2e-5) {
    fail(14u);
    return ModeDerivative();
  }
  var e=eo;
  var de=deo;
  if(mode==1u) {
    let d=cross(p,eo);
    let dd=cross(dp,eo)+cross(p,deo);
    let ad=dot(axis,d);
    let dad=dot(da,d)+dot(axis,dd);
    e=d/(m.no*m.no)-c*axis*ad;
    de=dd/(m.no*m.no)-2.*dno/(m.no*m.no*m.no)*d-dc*axis*ad-c*(da*ad+axis*dad);
  }
  let h=cross(p,e);
  let dh=cross(dp,e)+cross(p,de);
  let flux0=flow*.5*cross(e,h).z;
  let df=flow*.5*(cross(de,h).z+cross(e,dh).z);
  if(!(flux0>1e-12)) {
    fail(14u);
    return ModeDerivative();
  }
  let scale=inverseSqrt(flux0);
  return ModeDerivative(e*scale,h*scale,(de-.5*df/flux0*e)*scale,(dh-.5*df/flux0*h)*scale,p);
}
fn modeInner(e:vec3f,h:vec3f,a:vec3f,b:vec3f,flow:f32)->f32 {
  return flow*.25*(cross(e,b).z+cross(a,h).z);
}
fn phaseCoefficients(z:f32,k:vec2f,flow:f32,withPhase:bool)->vec2f {
  let kind=u32(cfg[0].w);
  let k0=cfg[17].x;
  if(kind==11u) {
    let b=1.+cfg[2].w*sin(z);
    let k2=dot(k,k);
    if(min(b*b-k2,1.-k2)<2e-5) {
      fail(14u);
      return vec2f(0);
    }
    return vec2f(0,select(0.,.5*k0*flow*(sqrt(b*b-k2)-b*sqrt(1.-k2)),withPhase));
  }
  if(dot(k,k)<1e-20) {
    let no=cfg[1].y;
    let ne=cfg[1].z;
    let a=cfg[2].xyz;
    let neff=no*ne/sqrt(no*no*dot(a.xy,a.xy)+ne*ne*a.z*a.z);
    var coupling=0.;
    if(kind==10u) {
      coupling=flow*.5*(sqrt(no/neff)+sqrt(neff/no))*cfg[11].w;
    }
    var scale=1.;
    if(kind==2u) {
      scale=1./(1.+cfg[2].w*z);
    }
    if(kind==9u) {
      scale=sqrt(1.+cfg[2].w*z*z);
    }
    if(length(a.xy)<2e-5) {
      fail(14u);
    }
    return vec2f(coupling,select(0.,.5*k0*flow*(no-neff)*scale,withPhase));
  }
  let a=modeDerivative(z,k,flow,0u);
  let b=modeDerivative(z,k,flow,1u);
  let orth=abs(modeInner(a.e,a.h,b.e,b.h,flow));
  if(orth>2e-5) {
    fail(14u);
  }
  let coupling=.5*(modeInner(b.e,b.h,a.de,a.dh,flow)-modeInner(a.e,a.h,b.de,b.dh,flow));
  return vec2f(coupling,select(0.,k0*(a.p.z-b.p.z)*.5,withPhase));
}
// J=[[a,b],[-conj(b),conj(a)]] stores (Re a, Im a, Re b, Im b).
fn jIdentity()->vec4f {
  return vec4f(1,0,0,0);
}
fn conj(z:vec2f)->vec2f {
  return z*vec2f(1,-1);
}
fn jProduct(a:vec4f,b:vec4f)->vec4f {
  return vec4f(cm(a.xy,b.xy)-cm(a.zw,conj(b.zw)),cm(a.xy,b.zw)+cm(a.zw,conj(b.xy)));
}
fn jDifference(a:vec4f,b:vec4f)->f32 {
  return max(length(a.xy-b.xy),length(a.zw-b.zw));
}
fn jExponential(v:vec2f,h:f32)->vec4f {
  let r=length(v);
  let rh=r*h;
  let q=select(h,sin(rh)/max(r,1e-30),r>1e-20);
  return vec4f(cos(rh),v.y*q,v.x*q,0);
}
fn jStokes(j:vec4f,s:vec4f)->vec4f {
  let rho=vec2f(s.z,-s.w)*.5;
  let a=j.xy;
  let b=j.zw;
  let intensity=dot(j,j)*s.x;
  let r00=dot(a,a)*(s.x+s.y)*.5+dot(b,b)*(s.x-s.y)*.5+2.*cm(cm(a,rho),conj(b)).x;
  let r01=-cm(a,b)*s.y+cm(cm(a,a),rho)-cm(cm(b,b),conj(rho));
  return vec4f(intensity,2.*r00-intensity,2.*r01.x,-2.*r01.y);
}
fn phaseCF(a:f32,b:f32,k:vec2f,flow:f32,withPhase:bool)->vec4f {
  let h=b-a;
  let v=.28867513459481287;
  let ca=-.03867513459481287;
  let cb=.5386751345948129;
  let x=phaseCoefficients(a+(.5-v)*h,k,flow,withPhase);
  let y=phaseCoefficients(a+(.5+v)*h,k,flow,withPhase);
  return jProduct(jExponential(ca*x+cb*y,h),jExponential(cb*x+ca*y,h));
}
struct Transfer {
  j:vec4f,
  error:f32,
  closed:u32
}
fn phaseTransfer(z0:f32,z1:f32,k:vec2f,flow:f32,withPhase:bool)->Transfer {
  if(z0==z1) {
    return Transfer(jIdentity(),0.,1u);
  }
  if((cfg[0].w==10 && dot(k,k)<1e-20)||(!withPhase && (cfg[0].w==11 || dot(k,k)<1e-20))) {
    let v=phaseCoefficients((z0+z1)*.5,k,flow,withPhase);
    if(length(v)*abs(z1-z0)>128.) {
      fail(15u);
    }
    return Transfer(jExponential(v,z1-z0),0.,1u);
  }
  let rot=select(0.,abs(cfg[11].w),cfg[0].w==10);
  let parts=u32(max(select(1.,cfg[17].z,withPhase),ceil(abs(z1-z0)*rot/.2)));
  if(parts>512u) {
    fail(15u);
    return Transfer();
  }
  let tolerance=select(2e-6,cfg[17].w,withPhase);
  var result=jIdentity();
  var totalError=0.;
  var work=0u;
  for(var i=0u;i<parts;i++) {
    var pending:array<vec4f,20>;
    var size=1u;
    pending[0]=vec4f(z0+(z1-z0)*f32(i)/f32(parts),z0+(z1-z0)*f32(i+1u)/f32(parts),tolerance/f32(parts),0);
    loop {
      if(size==0u) {
        break;
      }
      size--;
      let item=pending[size];
      let a=item.x;
      let b=item.y;
      let mid=(a+b)*.5;
      work++;
      if(work>4096u || pixels[id].aux.y>0u) {
        fail(15u);
        return Transfer();
      }
      let fine=jProduct(phaseCF(mid,b,k,flow,withPhase),phaseCF(a,mid,k,flow,withPhase));
      let coarse=phaseCF(a,b,k,flow,withPhase);
      let error=jDifference(fine,coarse)/15.;
      let A=phaseCoefficients(a,k,flow,withPhase);
      let B=phaseCoefficients(mid,k,flow,withPhase);
      let D=phaseCoefficients(b,k,flow,withPhase);
      let beat=max(abs(A.y),max(abs(B.y),abs(D.y)))*abs(b-a);
      let uncoupled=max(abs(A.x),max(abs(B.x),abs(D.x)))<1e-14;
      if(error<=item.z && (beat<=1. || uncoupled)) {
        result=jProduct(fine,result);
        totalError+=error;
      }
      else {
        if(item.w>=18 || size+2u>20u || abs(b-a)<2e-6) {
          fail(15u);
          return Transfer();
        }
        pending[size]=vec4f(mid,b,item.z*.5,item.w+1.);
        pending[size+1u]=vec4f(a,mid,item.z*.5,item.w+1.);
        size+=2u;
      }
    }
  }
  if(abs(dot(result,result)-1.)>2e-5) {
    fail(15u);
  }
  return Transfer(result,totalError,0u);
}
fn internalDepth(r:Ray)->u32 {
  return (r.flags.w>>1u)&15u;
}
fn withInternalDepth(r:Ray,depth:u32)->vec4u {
  return vec4u(r.flags.xyz,(r.flags.w&1u)|(depth<<1u));
}
fn planeZ(i:u32)->f32 {
  return cfg[24u+i/4u][i%4u];
}
fn internalSplit(r:Ray,end:Path)->bool {
  let model=u32(cfg[16].x);
  if(model==0u || model==3u || internalDepth(r)>=u32(cfg[16].y)) {
    return false;
  }
  let flow=sign(end.x.z-r.o.z);
  if(flow==0) {
    return false;
  }
  let mode=u32(r.p.w);
  var selected=32u;
  var z=end.x.z;
  for(var i=0u;i<u32(cfg[16].z);i++) {
    let at=planeZ(i);
    if(model==1u) {
      if((bitcast<u32>(r.ei.w)&(1u<<i))!=0u) {
        continue;
      }
    }
    else if(abs(at-r.o.z)<2e-6) {
      if((r.flags.w>>6u)==i+1u) {
        continue;
      }
      fail(16u);
      return true;
    }
    if(flow*(at-r.o.z)<-1e-7) {
      continue;
    }
    if(abs(end.x.z-at)<2e-6) {
      fail(16u);
      return true;
    }
    if(flow*(end.x.z-at)<0) {
      continue;
    }
    if(selected==32u || flow*(at-z)<0) {
      selected=i;
      z=at;
    }
  }
  if(selected==32u) {
    return false;
  }
  let q=anisotropicAtZ(Path(r.o.xyz,r.p.xyz),z,mode);
  if(shapeValue(q.x)>=-2e-6) {
    fail(16u);
    return true;
  }
  var weights=vec2f(.5);
  if(model==2u) {
    let tr=phaseTransfer(r.o.z,z,r.p.xy,flow,false);
    let S=jStokes(tr.j,vec4f(1,select(-1.,1.,mode==0u),0,0));
    weights=vec2f(S.x+S.y,S.x-S.y)*.5;
    pixels[id].internal[select(3u,2u,tr.closed==1u)]++;
    pixels[id].phaseError.w=max(pixels[id].phaseError.w,tr.error);
    pixels[id].phaseExtra.x=max(pixels[id].phaseExtra.x,abs(weights.x+weights.y-1.));
  }
  if(pixels[id].aux.y>0u) {
    return true;
  }
  let depth=internalDepth(r)+1u;
  pixels[id].internal.x++;
  pixels[id].internal.y=max(pixels[id].internal.y,depth);
  pixels[id].aux.w++;
  let modes=mediumModes(localMaterial(1u,q.x),vec3f(q.p.xy,0),vec3f(0,0,flow),1.);
  for(var m=0u;m<2u;m++) {
    if(weights[m]<=1e-20) {
      continue;
    }
    if(modes[m].prop==0u) {
      fail(14u);
      continue;
    }
    let e=modes[m].E;
    push(Ray(vec4f(q.x,r.o.w*weights[m]),vec4f(modes[m].p,f32(m)),vec4f(e.re,0),vec4f(e.im,bitcast<f32>(bitcast<u32>(r.ei.w)|(1u<<selected))),vec4u(withInternalDepth(r,depth).xyz,withInternalDepth(r,depth).w|((selected+1u)<<6u))));
  }
  return true;
}
fn helicalSeparation(a:Path,b:Path,end:f32,flow:f32)->f32 {
  let start=a.x.z;
  let om=cfg[11].w;
  let limit=cfg[17].y;
  let delta=b.x.xy-a.x.xy;
  if(abs(om)<1e-14) {
    return end;
  }
  if(length(delta)>=limit) {
    return start;
  }
  let axis=cfg[2].xyz;
  let diff=cfg[1].y*cfg[1].y-cfg[1].z*cfg[1].z;
  let w=diff*length(axis.xy)*axis.z/(cfg[1].z*cfg[1].z+diff*dot(axis.xy,axis.xy));
  let radius=w/om;
  let phi=atan2(axis.y,axis.x)+om*start;
  let center=delta+radius*vec2f(sin(phi),-cos(phi));
  let A=-2.*radius*center.x;
  let B=2.*radius*center.y;
  let R=length(vec2f(A,B));
  if(R<1e-25) {
    return end;
  }
  let value=(limit*limit-dot(center,center)-radius*radius)/R;
  if(abs(abs(value)-1.)<2e-5) {
    fail(16u);
  }
  if(abs(value)>=1.) {
    return end;
  }
  let offset=atan2(B,A);
  let base=asin(value);
  let direction=sign(om*flow);
  var best=end;
  for(var j=0u;j<2u;j++) {
    let root=select(base,3.141592653589793-base,j==1u)-offset;
    var angle=direction*(root-phi);
    angle=angle-6.283185307179586*floor(angle/6.283185307179586);
    if(angle<1e-7) {
      angle+=6.283185307179586;
    }
    let z=start+flow*angle/abs(om);
    if(flow*(end-z)>1e-6 && flow*(z-best)<0) {
      best=z;
    }
  }
  return best;
}
fn pairSeparation(a:Path,b:Path,end:f32,flow:f32)->f32 {
  if(cfg[0].w==10 && dot(a.p.xy,a.p.xy)<1e-20) {
    return helicalSeparation(a,b,end,flow);
  }
  let limit=cfg[17].y;
  if(distance(a.x.xy,b.x.xy)>=limit) {
    return a.x.z;
  }
  let rot=select(0.,abs(cfg[11].w),cfg[0].w==10);
  let count=2u*u32(max(16.,ceil(abs(end-a.x.z)/min(.02,min(cfg[8].x,.08/(1.+rot))))));
  if(count>8192u) {
    fail(16u);
    return end;
  }
  var previous=a.x.z;
  var previousA=a;
  var previousB=b;
  for(var i=1u;i<=count;i++) {
    let z=a.x.z+(end-a.x.z)*f32(i)/f32(count);
    let x=anisotropicAtZ(previousA,z,0u);
    let y=anisotropicAtZ(previousB,z,1u);
    if(pixels[id].aux.y>0u) {
      return end;
    }
    if(distance(x.x.xy,y.x.xy)>=limit) {
      var lo=previous;
      var hi=z;
      for(var j=0u;j<24u;j++) {
        let mid=(lo+hi)*.5;
        let qa=anisotropicAtZ(previousA,mid,0u);
        let qb=anisotropicAtZ(previousB,mid,1u);
        if(distance(qa.x.xy,qb.x.xy)>=limit) {
          hi=mid;
        }
        else {
          lo=mid;
        }
      }
      let root=(lo+hi)*.5;
      return select(end,root,flow*(end-root)>1e-6);
    }
    previous=z;
    previousA=x;
    previousB=y;
  }
  return end;
}
fn coherentBulk(r:Ray) {
  let mode=u32(r.p.w);
  let own=travel(r);
  if(pathTurned) {
    fail(17u);
  }
  if(pixels[id].aux.y>0u) {
    return;
  }
  let flow=sign(kinv(r.p.xyz,localMaterial(1u,r.o.xyz),mode).z);
  let modes=mediumModes(localMaterial(1u,r.o.xyz),vec3f(r.p.xy,0),vec3f(0,0,flow),1.);
  if(modes[0].prop==0u || modes[1].prop==0u) {
    fail(14u);
    return;
  }
  var states:array<Path,2>;
  states[0]=Path(r.o.xyz,modes[0].p);
  states[1]=Path(r.o.xyz,modes[1].p);
  states[mode]=Path(r.o.xyz,r.p.xyz);
  let otherMode=1u-mode;
  let otherRay=Ray(vec4f(r.o.xyz,1),vec4f(states[otherMode].p,f32(otherMode)),vec4f(modes[otherMode].E.re,0),vec4f(modes[otherMode].E.im,0),r.flags);
  let other=travel(otherRay);
  if(pathTurned) {
    fail(17u);
  }
  if(pixels[id].aux.y>0u) {
    return;
  }
  var exits:array<Path,2>;
  exits[mode]=own;
  exits[otherMode]=other;
  let end=select(other.x.z,own.x.z,flow*(own.x.z-other.x.z)<0);
  if(flow*(end-r.o.z)<=1e-6) {
    fail(16u);
    return;
  }
  let z=pairSeparation(states[0],states[1],end,flow);
  let separated=flow*(end-z)>1e-6;
  let tr=phaseTransfer(r.o.z,z,r.p.xy,flow,true);
  let S=jStokes(tr.j,vec4f(1,select(-1.,1.,mode==0u),0,0));
  let weights=vec2f(S.x+S.y,S.x-S.y)*.5;
  if(pixels[id].aux.y>0u) {
    return;
  }
  pixels[id].polar.x++;
  pixels[id].polar[select(3u,2u,tr.closed==1u)]++;
  pixels[id].phaseError.y=max(pixels[id].phaseError.y,tr.error);
  pixels[id].phaseError.z=max(pixels[id].phaseError.z,abs(S.x-1.));
  if(separated) {
    pixels[id].polar.y++;
    pixels[id].internal.x++;
    pixels[id].internal.y=max(pixels[id].internal.y,internalDepth(r)+1u);
    if(internalDepth(r)>=u32(cfg[16].y)) {
      pixels[id].phaseError.x+=r.o.w;
      return;
    }
  }
  else {
    pixels[id].phaseBoundary.x++;
  }
  for(var m=0u;m<2u;m++) {
    var q=exits[m];
    if(separated) {
      q=anisotropicAtZ(states[m],z,m);
    }
    else if(abs(exits[m].x.z-z)>1e-6) {
      pixels[id].phaseBoundary.y++;
    }
    if(shapeValue(q.x)>2e-6) {
      fail(16u);
      return;
    }
    let e=fields(realv(q.p),localMaterial(1u,q.x),m).E;
    var flags=withInternalDepth(r,internalDepth(r)+select(0u,1u,separated));
    if(!separated) {
      flags.w|=32u;
    }
    push(Ray(vec4f(q.x,r.o.w*max(0.,weights[m])),vec4f(q.p,f32(m)),vec4f(e.re,0),vec4f(e.im,0),flags));
  }
}
