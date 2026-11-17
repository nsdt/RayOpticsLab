// WebGPU f32 transport: uniform, scalar GRIN and conditional anisotropic
// closed/numerical trajectories in the shapes allowed by gpu-support.js.
// Host ABI: gpu-transport.js packs 40 vec4f uniforms, 80 bytes per Ray,
// and 272 bytes per Pixel. Keep field order and numeric model IDs synchronized.
// Pixel.aux.x is completion and Pixel.aux.y is the CPU-retry reason code.
// Same lossless interface E/H matching as polarization.js; evanescent fields
// participate in matching but never enter the ray queue. Anisotropic bulk uses
// local adiabatic eigenfields, or the exact field pullback for coordinate shear.
// Unstable numerical/optical conditions retry the entire camera ray on CPU.
struct Ray {
  o:vec4f,
  p:vec4f,
  er:vec4f,
  ei:vec4f,
  flags:vec4u
}
struct Pixel {
  rgb:vec4f,
  cutoff:vec4f,
  more:vec4f,
  counts:vec4u,
  diag:vec4f,
  aux:vec4u,
  channels:vec4f,
  extra:vec4f,
  bulk:vec4u,
  internal:vec4u,
  polar:vec4u,
  phaseError:vec4f,
  phaseBoundary:vec4u,
  phaseExtra:vec4f,
  odeCounts:vec4u,
  odeControl:vec4f,
  backgroundError:vec4f
}
struct CV {
  re:vec3f,
  im:vec3f
}
struct Field {
  E:CV,
  H:CV,
  p:vec3f,
  flux:f32,
  prop:u32,
  mode:u32
}
struct Material {
  no:f32,
  ne:f32,
  iso:u32,
  axis:vec3f
}
struct Path {
  x:vec3f,
  p:vec3f
}
@group(0) @binding(0) var<uniform> cfg:array<vec4f,40>;
@group(0) @binding(1) var<storage,read_write> pixels:array<Pixel>;
@group(0) @binding(2) var<storage,read_write> queue:array<Ray>;
var<private> id:u32;
const CAP:u32=128u;
fn fail(code:u32) {
  if(pixels[id].aux.y==0u) {
    pixels[id].aux.y=code;
  }
}
fn safeunit(v:vec3f)->vec3f {
  let s=length(v);
  if(!(s>1e-12 && s<1e15)) {
    fail(2u);
    return vec3f(1,0,0);
  }
  return v/s;
}
fn ca(a:vec2f,b:vec2f)->vec2f {
  return a+b;
}
fn cm(a:vec2f,b:vec2f)->vec2f {
  return vec2f(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);
}
fn cd(a:vec2f,b:vec2f)->vec2f {
  let s=dot(b,b);
  if(!(s>1e-24)) {
    fail(3u);
    return vec2f(0);
  }
  return vec2f(dot(a,b),a.y*b.x-a.x*b.y)/s;
}
fn realv(v:vec3f)->CV {
  return CV(v,vec3f(0));
}
fn va(a:CV,b:CV)->CV {
  return CV(a.re+b.re,a.im+b.im);
}
fn vs(a:CV,b:vec2f)->CV {
  return CV(a.re*b.x-a.im*b.y,a.re*b.y+a.im*b.x);
}
fn vd(a:CV,b:CV)->vec2f {
  return vec2f(dot(a.re,b.re)-dot(a.im,b.im),dot(a.re,b.im)+dot(a.im,b.re));
}
fn vx(a:CV,b:CV)->CV {
  return CV(cross(a.re,b.re)-cross(a.im,b.im),cross(a.re,b.im)+cross(a.im,b.re));
}
fn vn(a:CV)->CV {
  let s=sqrt(dot(a.re,a.re)+dot(a.im,a.im));
  if(!(s>1e-12 && s<1e15)) {
    fail(2u);
    return realv(vec3f(1,0,0));
  }
  return CV(a.re/s,a.im/s);
}
fn basis(v:vec3f)->vec3f {
  return safeunit(cross(v,select(vec3f(0,1,0),vec3f(0,0,1),abs(v.z)<.85)));
}
fn flux(e:CV,h:CV,n:vec3f)->f32 {
  return .5*dot(cross(e.re,h.re)+cross(e.im,h.im),n);
}
// iso: 0 uniaxial, 1 isotropic, 2 biaxial, 3 signed uniaxial,
// 4 impedance-matched coordinate shear, 5 magnetic ENG realization.
fn shearB(z:f32)->vec2f {
  let t=(z+1.)*.5;
  let b=-cfg[12].w*3.*t*(1.-t);
  return vec2f(b,.45*b);
}
fn material(inside:u32,z:f32)->Material {
  if(inside==0u) {
    return Material(cfg[1].w,cfg[1].w,1u,cfg[2].xyz);
  }
  let kind=u32(cfg[0].w);
  if(kind==3u) {
    return Material(0.,0.,2u,cfg[2].xyz);
  }
  if(kind==0u) {
    return Material(cfg[1].x,cfg[1].x,1u,cfg[2].xyz);
  }
  if(kind==13u) {
    return Material(1.,1.,4u,vec3f(shearB(z),0));
  }
  if(kind==14u) {
    let n=sqrt(1.+cfg[21].z*z*z);
    return Material(n,n,5u,vec3f(0,1,0));
  }
  if(kind==11u) {
    let n=1.+cfg[2].w*sin(z);
    if(n<=0) {
      fail(13u);
    }
    return Material(n,1.,0u,vec3f(0,0,1));
  }
  var scale=1.;
  if(kind==2u) {
    let a=1.+cfg[2].w*z;
    if(a<=0) {
      fail(13u);
    }
    scale=1./a;
  }
  if(kind==9u || kind==12u) {
    let eta=1.+cfg[2].w*select(z*z,z,kind==12u);
    if(eta<=0) {
      fail(13u);
    }
    scale=sqrt(max(eta,1e-20));
  }
  let no=cfg[1].y*scale;
  let ne=cfg[1].z*scale;
  var axis=cfg[2].xyz;
  if(kind==10u) {
    let a=cfg[11].w*z;
    axis=vec3f(axis.x*cos(a)-axis.y*sin(a),axis.x*sin(a)+axis.y*cos(a),axis.z);
  }
  if(kind==12u) {
    return Material(no,ne,3u,axis);
  }
  return Material(no,ne,select(0u,1u,abs(no-ne)<1e-7*max(no,ne)),axis);
}
// Radial coordinate maps: J is symmetric, with radial and tangential
// eigenvalues scale and alpha. cfg[20]=(centre,R); cfg[21]=(a,b,ENG g,0).
fn mapAxes(v:vec3f)->vec3f {
  return select(v,vec3f(v.x,0,v.z),cfg[0].w==17);
}
fn mapScale()->f32 {
  return cfg[21].y/(cfg[21].y-cfg[21].x);
}
fn mapJ(x:vec3f,inverted:bool)->mat3x3f {
  let r=mapAxes(x-cfg[20].xyz);
  let rho=length(r);
  let a=cfg[21].x;
  let scale=mapScale();
  if(!(rho>a && scale>0)) {
    fail(13u);
    return mat3x3f();
  }
  let alpha=scale*(1.-a/rho);
  let n=r/rho;
  let radial=select(scale,1./scale,inverted);
  let tangent=select(alpha,1./alpha,inverted);
  var diagonal=vec3f(tangent);
  if(cfg[0].w==17) {
    diagonal.y=1.;
  }
  return mat3x3f(vec3f(diagonal.x,0,0)+(radial-tangent)*n.x*n,vec3f(0,diagonal.y,0)+(radial-tangent)*n.y*n,vec3f(0,0,diagonal.z)+(radial-tangent)*n.z*n);
}
fn mapDet(x:vec3f)->f32 {
  let alpha=mapScale()*(1.-cfg[21].x/length(mapAxes(x-cfg[20].xyz)));
  return mapScale()*select(alpha*alpha,alpha,cfg[0].w==17);
}
fn mapForward(x:vec3f)->vec3f {
  let r=x-cfg[20].xyz;
  let a=mapAxes(r);
  return r+(mapScale()*(1.-cfg[21].x/length(a))-1.)*a;
}
fn mapInverse(X:vec3f)->vec3f {
  let a=mapAxes(X);
  let rho=length(a);
  if(!(rho>1e-6)) {
    fail(13u);
  }
  return cfg[20].xyz+X+((cfg[21].x+rho/mapScale())/rho-1.)*a;
}
// GRIN material ids: 4 spherical n², 5 cylindrical n², 6 axial n²,
// 7 spherical n, 8 axial n. The material profile is sampled at each surface.
fn isGrin()->bool {
  return cfg[0].w>=4 && cfg[0].w<=8;
}
fn grinN2(x:vec3f)->f32 {
  let kind=u32(cfg[0].w);
  let n=cfg[1].x;
  let g=cfg[2].w;
  var value=n*n;
  if(kind==4u) {
    value-=g*dot(x,x);
  }
  else if(kind==5u) {
    value-=g*dot(x.xy,x.xy);
  }
  else if(kind==6u) {
    value+=g*x.z;
  }
  else {
    var nn=n+g*x.z;
    if(kind==7u) {
      nn=n+g*dot(x,x);
    }
    if(!(nn>.05)) {
      fail(11u);
    }
    value=nn*nn;
  }
  if(!(value>.0025 && value<1e12)) {
    fail(11u);
    return 1.;
  }
  return value;
}
fn localMaterial(inside:u32,x:vec3f)->Material {
  if(inside==1u && cfg[0].w==15) {
    let r=x-cfg[20].xyz;
    let u=dot(r,r)/(cfg[20].w*cfg[20].w);
    if(!(u<1. && dot(r,r)>1e-12)) {
      fail(13u);
      return Material();
    }
    return Material(1./(1.-u),inverseSqrt(1.-u),0u,safeunit(r));
  }
  if(inside==1u && (cfg[0].w==16 || cfg[0].w==17)) {
    return Material(mapDet(x),1.,6u,x);
  }
  if(inside==1u && isGrin()) {
    let n=sqrt(grinN2(x));
    return Material(n,n,1u,cfg[2].xyz);
  }
  return material(inside,x.z);
}
// Analytic derivatives avoid finite-difference cancellation in f32. They use
// the CPU Hamiltonian H=|p|²/(2n²), including off-shell RK stages.
fn grinGradN2(x:vec3f)->vec3f {
  let kind=u32(cfg[0].w);
  let g=cfg[2].w;
  if(kind==4u) {
    return -2.*g*x;
  }
  if(kind==5u) {
    return vec3f(-2.*g*x.xy,0);
  }
  if(kind==6u) {
    return vec3f(0,0,g);
  }
  if(kind==7u) {
    return 4.*g*(cfg[1].x+g*dot(x,x))*x;
  }
  return vec3f(0,0,2.*g*(cfg[1].x+g*x.z));
}
fn grinRhs(s:Path)->Path {
  let n2=grinN2(s.x);
  return Path(s.p/n2,.5*dot(s.p,s.p)/(n2*n2)*grinGradN2(s.x));
}
fn pathAdd(s:Path,k:Path,h:f32)->Path {
  return Path(s.x+h*k.x,s.p+h*k.p);
}
fn grinRKF45(s:Path,h:f32)->Path {
  return rkf45(s,h,0u,0.);
}
fn grinClosedTau(s:Path,tau:f32)->Path {
  let g=cfg[2].w;
  let kind=u32(cfg[0].w);
  pixels[id].aux.z++;
  if(kind==6u) {
    return Path(s.x+tau*s.p+vec3f(0,0,g*tau*tau*.25),s.p+vec3f(0,0,g*tau*.5));
  }
  var q=Path(s.x+tau*s.p,s.p);
  if(abs(g)<1e-14) {
    return q;
  }
  let w=sqrt(abs(g));
  let u=w*tau;
  var cs=cos(u);
  var sn=sin(u);
  if(g<0) {
    cs=cosh(u);
    sn=sinh(u);
  }
  let axes=select(2u,3u,kind==4u);
  for(var j=0u;j<axes;j++) {
    q.x[j]=s.x[j]*cs+s.p[j]*sn/w;
    q.p[j]=s.p[j]*cs-sign(g)*w*s.x[j]*sn;
  }
  return q;
}
// The isotropic Schur integrand simplifies to p_transverse / sqrt(n²-|p_t|²).
// Turning points use the same Hamiltonian RKF45 fallback as the CPU.
fn grinAdvance(s:Path,h:f32)->Path {
  let kind=u32(cfg[0].w);
  let solver=u32(cfg[10].w);
  if(solver==0u && kind<=6u) {
    return grinClosedTau(s,h/grinN2(s.x));
  }
  if(solver!=2u && (kind==6u || kind==8u)) {
    let n2=grinN2(s.x);
    let vz=s.p.z/n2;
    let dz=h*vz;
    let z=s.x.z+dz;
    let pt2=dot(s.p.xy,s.p.xy);
    let nend=grinN2(vec3f(s.x.xy,z));
    let start=n2-pt2;
    let end=nend-pt2;
    if(abs(vz)>=1e-6 && start>2e-5*n2 && end>2e-5*nend) {
      let nodes=array<f32,4>(-.8611363115940526,-.3399810435848563,.3399810435848563,.8611363115940526);
      let weights=array<f32,4>(.3478548451374538,.6521451548625461,.6521451548625461,.3478548451374538);
      var integral=0.;
      var valid=true;
      for(var j=0u;j<4u;j++) {
        let nz=grinN2(vec3f(s.x.xy,s.x.z+dz*(1.+nodes[j])*.5));
        let dd=nz-pt2;
        if(dd<=2e-5*nz) {
          valid=false;
          break;
        }
        integral+=dz*.5*weights[j]/sqrt(dd);
      }
      if(valid) {
        pixels[id].bulk.z++;
        return Path(vec3f(s.x.xy+sign(vz)*s.p.xy*integral,z),vec3f(s.p.xy,sign(vz)*sqrt(end)));
      }
    }
  }
  return grinRKF45(s,h);
}
fn grinResidual(s:Path)->f32 {
  return abs(dot(s.p,s.p)/grinN2(s.x)-1.);
}
fn grinCheck(s:Path) {
  let error=grinResidual(s);
  pixels[id].more.w=max(pixels[id].more.w,error);
  if(!(error<1e-5) || any(abs(s.x)>vec3f(1e8)) || any(abs(s.p)>vec3f(1e8))) {
    fail(11u);
  }
}
// Rotation-minimizing frame, as in CPU transportIsotropic: two algebraic
// reflections transport complex E. These do not add optical reflection rays.
fn grinTransport(e:CV,a:Path,b:Path)->CV {
  let t0=safeunit(a.p);
  let t1=safeunit(b.p);
  let v1=b.x-a.x;
  let c1=dot(v1,v1);
  if(c1<1e-20) {
    if(length(t1-t0)>1e-5) {
      fail(12u);
    }
    return e;
  }
  let el=va(e,vs(realv(v1),-2.*vd(realv(v1),e)/c1));
  let tl=t0-2.*v1*dot(v1,t0)/c1;
  let v2=t1-tl;
  let c2=dot(v2,v2);
  if(!(c2>1e-12)) {
    fail(12u);
    return e;
  }
  let out=vn(va(el,vs(realv(v2),-2.*vd(realv(v2),el)/c2)));
  if(length(vd(realv(t1),out))>3e-5) {
    fail(12u);
  }
  return out;
}
// Default lens: plane z=-1, radius 1, rear conic c=-1/0.6, k=-1.69.
// General polynomial departures remain on CPU. These equations match Asphere.
fn asphereSag(r:f32)->f32 {
  return 1.-(r*r/.6)/(1.+sqrt(1.+(.69/.36)*r*r));
}
fn asphereSlope(r:f32)->f32 {
  return -r/.6/sqrt(1.+(.69/.36)*r*r);
}
fn asphereValue(x:vec3f)->f32 {
  let r=length(x.xy);
  let rr=min(r,1.);
  return max(max(-1.-x.z,r-1.),(x.z-asphereSag(rr))/sqrt(1.+pow(asphereSlope(rr),2.)));
}
fn asphereNormal(x:vec3f)->vec3f {
  let r=length(x.xy);
  let dist=vec3f(abs(x.z+1.),abs(r-1.),abs(x.z-asphereSag(r)));
  if(min(abs(dist.x-dist.y),abs(dist.z-dist.y))<3e-5 && dist.y<3e-5) {
    fail(5u);
  }
  if(dist.x<=dist.y && dist.x<=dist.z) {
    return vec3f(0,0,-1);
  }
  if(dist.y<dist.z) {
    return vec3f(x.xy/max(r,1e-12),0);
  }
  let k=-1./.6/sqrt(1.+(.69/.36)*r*r);
  return safeunit(vec3f(-k*x.xy,1));
}
fn asphereRoots(a:f32,b:f32,c:f32)->vec2f {
  if(abs(a)<1e-7) {
    if(abs(b)<1e-7) {
      return vec2f(-1.);
    }
    return vec2f(-c/b,-1.);
  }
  let disc=b*b-4.*a*c;
  let tol=3e-6*max(1.,b*b+abs(4.*a*c));
  if(abs(disc)<tol) {
    fail(5u);
  }
  if(disc<0) {
    return vec2f(-1.);
  }
  let q=-.5*(b+select(-sqrt(disc),sqrt(disc),b>=0));
  if(abs(q)<1e-12) {
    return vec2f(-b/(2.*a));
  }
  return vec2f(q/a,c/q);
}
fn aspherehit(o:vec3f,d:vec3f,inside:bool)->f32 {
  var candidates:array<f32,5>;
  candidates[0]=-1.;
  if(abs(d.z)>1e-8) {
    candidates[0]=(-1.-o.z)/d.z;
  }
  let side=asphereRoots(dot(d.xy,d.xy),2.*dot(o.xy,d.xy),dot(o.xy,o.xy)-1.);
  candidates[1]=side.x;
  candidates[2]=side.y;
  let w=o.z-1.;
  let k=-.69;
  let invc=-.6;
  let rear=asphereRoots(dot(d.xy,d.xy)+k*d.z*d.z,2.*(dot(o.xy,d.xy)+k*w*d.z-invc*d.z),dot(o.xy,o.xy)+k*w*w-2.*w*invc);
  candidates[3]=rear.x;
  candidates[4]=rear.y;
  var best=1e20;
  for(var j=0u;j<5u;j++) {
    let t=candidates[j];
    if(t<=1e-7 || t>=best) {
      continue;
    }
    let x=o+t*d;
    let residual=abs(asphereValue(x));
    if(residual>2e-5) {
      continue;
    }
    let n=asphereNormal(x);
    let nd=dot(n,d);
    if(abs(nd)<.004 || residual>2e-6) {
      fail(5u);
    }
    if((inside && nd>0)||(!inside && nd<0)) {
      best=t;
    }
  }
  return select(best,-1.,best>=1e19);
}
fn shapeValue(x:vec3f)->f32 {
  if(cfg[9].y==4) {
    return asphereValue(x);
  }
  if(cfg[9].y==3) {
    return abs(x.z)-1.;
  }
  if(cfg[9].y==1) {
    return dot(x,x)-1.;
  }
  if(cfg[9].y==2) {
    return torusValue(x);
  }
  return max(abs(x.x),max(abs(x.y),abs(x.z)))-1.;
}
// Re-evaluate closed trajectories from the segment entrance instead of
// accumulating rounded positions at every step. The exact K parameter is
// additive even though the CPU's H step uses the local n² conversion.
fn grinSegment(s:Path,h:f32,anchor:Path,tau:f32)->Path {
  if(cfg[10].w==0 && cfg[0].w<=6) {
    return grinClosedTau(anchor,tau+h/grinN2(s.x));
  }
  return grinAdvance(s,h);
}
fn grinTravel(r:Ray)->Ray {
  var s=Path(r.o.xyz,r.p.xyz);
  var e=CV(r.er.xyz,r.ei.xyz);
  var out=r;
  let anchor=s;
  var tau=0.;
  pixels[id].bulk.y++;
  grinCheck(s);
  for(var j=0u;j<u32(cfg[8].y);j++) {
    if(pixels[id].aux.y>0u) {
      return out;
    }
    if(shapeValue(s.x)>5e-7) {
      fail(11u);
      return out;
    }
    let v=s.p/grinN2(s.x);
    let speed=length(v);
    let distance=shapehit(s.x,v/speed,true);
    var h=min(cfg[8].x,max(2e-5,1.05*select(cfg[8].x,distance,distance>0)))/speed;
    var end=grinSegment(s,h,anchor,tau);
    for(var retry=0u;retry<10u;retry++) {
      if(grinResidual(end)<=1e-6 && dot(safeunit(s.p),safeunit(end.p))>=.98) {
        break;
      }
      h*=.5;
      end=grinSegment(s,h,anchor,tau);
    }
    pixels[id].bulk.x++;
    let mid=grinSegment(s,h*.5,anchor,tau);
    grinCheck(mid);
    if(pixels[id].aux.y>0u) {
      return out;
    }
    if(shapeValue(mid.x)>=0) {
      h*=.5;
      end=mid;
    }
    if(shapeValue(end.x)>=0) {
      end=refineSurface(s,h,anchor,tau,0u,true,true);
      if(pixels[id].aux.y>0u) {
        return out;
      }
      grinCheck(end);
      e=grinTransport(e,s,end);
      let nn=normal(end.x);
      if(abs(shapeValue(end.x))>1e-6 || dot(nn,safeunit(end.p))<.004) {
        fail(11u);
      }
      out.o=vec4f(end.x,r.o.w);
      out.p=vec4f(end.p,r.p.w);
      out.er=vec4f(e.re,r.er.w);
      out.ei=vec4f(e.im,r.ei.w);
      return out;
    }
    grinCheck(end);
    e=grinTransport(e,s,end);
    tau+=h/grinN2(s.x);
    s=end;
  }
  fail(11u);
  return out;
}
fn shearMetric(v:CV,m:Material)->CV {
  let b=m.axis.xy;
  let g=mat3x3f(vec3f(1,0,b.x),vec3f(0,1,b.y),vec3f(b,1.+dot(b,b)));
  return CV(g*v.re,g*v.im);
}
fn magnetic(k:CV,e:CV,m:Material)->CV {
  let h=vx(k,e);
  if(m.iso==4u) {
    return shearMetric(h,m);
  }
  if(m.iso==6u) {
    let J=mapJ(m.axis,false);
    let G=J*J*(1./m.no);
    return CV(G*h.re,G*h.im);
  }
  if(m.iso==5u) {
    return CV(h.re*vec3f(2,2,.5),h.im*vec3f(2,2,.5));
  }
  return h;
}
fn coincident(m:Material)->bool {
  return m.iso==1u || m.iso==4u || m.iso==6u;
}
fn kinv(p:vec3f,m:Material,mode:u32)->vec3f {
  if(m.iso==6u) {
    let K=mapJ(m.axis,true);
    return K*(K*p);
  }
  if(m.iso==4u) {
    let q=p.z-dot(m.axis.xy,p.xy);
    return vec3f(p.xy-m.axis.xy*q,q);
  }
  if(m.iso==5u) {
    return p*select(vec3f(-1,-1,-4),vec3f(1,-1,4),mode==1u)/(m.no*m.no);
  }
  let no2=select(1.,-1.,m.iso==3u)*m.no*m.no;
  if(mode==0u || m.iso==1u) {
    return p/no2;
  }
  return p/(m.ne*m.ne)+m.axis*dot(m.axis,p)*(1./no2-1./(m.ne*m.ne));
}
fn uniaxialElectric(k:CV,m:Material,mode:u32)->CV {
  var e:CV;
  if(m.iso==1u) {
    var u=basis(safeunit(k.re));
    let s=cross(k.re,k.im);
    if(length(s)>1e-8) {
      u=safeunit(s);
    }
    if(mode==0u) {
      e=realv(u);
    }
    else {
      e=vx(k,realv(u));
    }
  }
  else {
    var eo=vx(realv(m.axis),k);
    if(dot(eo.re,eo.re)+dot(eo.im,eo.im)<1e-16) {
      eo=realv(basis(safeunit(select(k.im,k.re,length(k.re)>1e-12))));
    }
    if(mode==0u) {
      e=eo;
    }
    else {
      let d=vx(k,eo);
      let ad=vd(realv(m.axis),d);
      let no2=select(1.,-1.,m.iso==3u)*m.no*m.no;
      e=va(vs(d,vec2f(1./no2,0)),vs(realv(m.axis),ad*(1./(m.ne*m.ne)-1./no2)));
    }
  }
  return vn(e);
}
fn fields(k:CV,m:Material,mode:u32)->Field {
  var e:CV;
  if(m.iso==4u || m.iso==6u) {
    var pivot=0u;
    for(var j=1u;j<3u;j++) {
      if(length(vec2f(k.re[j],k.im[j]))>length(vec2f(k.re[pivot],k.im[pivot]))) {
        pivot=j;
      }
    }
    var indices:array<u32,2>;
    var count=0u;
    for(var j=0u;j<3u;j++) {
      if(j!=pivot) {
        indices[count]=j;
        count++;
      }
    }
    let j=indices[mode];
    var d=CV(vec3f(0),vec3f(0));
    d.re[j]=1.;
    let q=-cd(vec2f(k.re[j],k.im[j]),vec2f(k.re[pivot],k.im[pivot]));
    d.re[pivot]=q.x;
    d.im[pivot]=q.y;
    if(m.iso==4u) {
      e=vn(shearMetric(d,m));
    }
    else {
      let J=mapJ(m.axis,false);
      let G=J*J*(1./m.no);
      e=vn(CV(G*d.re,G*d.im));
    }
  }
  else if(m.iso==5u) {
    let kv=CV(k.re*vec3f(1,1,2),k.im*vec3f(1,1,2));
    let ev=uniaxialElectric(kv,Material(m.no,m.ne,3u,vec3f(0,1,0)),mode);
    e=vn(CV(ev.re*vec3f(1,1,.5),ev.im*vec3f(1,1,.5)));
  }
  else {
    e=uniaxialElectric(k,m,mode);
  }
  return Field(e,magnetic(k,e,m),k.re,0.,0u,mode);
}
fn modefield(m:Material,t:vec3f,n:vec3f,sign:f32,mode:u32)->Field {
  let a=dot(n,kinv(n,m,mode));
  let b=2.*dot(n,kinv(t,m,mode));
  let c=dot(t,kinv(t,m,mode))-1.;
  let disc=b*b-4.*a*c;
  if(abs(a)<1e-7) {
    fail(1u);
    return Field();
  }
  if(abs(disc)<2e-5*max(1.,b*b+abs(4.*a*c))) {
    fail(1u);
  }
  var roots:array<vec2f,2>;
  if(disc>=0) {
    let q=-.5*(b+select(-1.,1.,b>=0)*sqrt(max(0.,disc)));
    if(abs(q)>1e-12) {
      roots[0]=vec2f(q/a,0);
      roots[1]=vec2f(c/q,0);
    }
    else {
      roots[0]=vec2f(-b/(2.*a),0);
      roots[1]=roots[0];
    }
  }
  else {
    roots[0]=vec2f(-b,sqrt(-disc))/(2.*a);
    roots[1]=vec2f(-b,-sqrt(-disc))/(2.*a);
  }
  var chosen:Field;
  var found=false;
  for(var j=0u;j<2u;j++) {
    let q=roots[j];
    let k=CV(t+n*q.x,n*q.y);
    var f=fields(k,m,mode);
    f.flux=flux(f.E,f.H,n);
    f.prop=select(0u,1u,q.y==0);
    if((f.prop==1u && sign*f.flux>1e-7)||(f.prop==0u && sign*q.y>0)) {
      if(f.prop==1u) {
        // Near grazing emergence, the external root amplifies an otherwise small
        // trajectory error. A dispersion residual alone does not control its flux.
        let velocity=kinv(k.re,m,mode);
        if(abs(dot(n,velocity))<.03*length(velocity)) {
          fail(1u);
        }
        let drift=abs(dot(k.re,velocity)-1.);
        pixels[id].more.w=max(pixels[id].more.w,drift);
        if(drift>3e-5) {
          fail(1u);
        }
      }
      chosen=f;
      found=true;
      break;
    }
  }
  if(!found) {
    fail(2u);
  }
  return chosen;
}
// Homogeneous biaxial epsilon and its inverse, uploaded in world coordinates.
fn epsilon()->mat3x3f {
  return mat3x3f(cfg[10].xyz,cfg[11].xyz,cfg[12].xyz);
}
fn epsilonInverse()->mat3x3f {
  return mat3x3f(cfg[13].xyz,cfg[14].xyz,cfg[15].xyz);
}
fn csqrt(z:vec2f)->vec2f {
  let r=length(z);
  if(z.x>=0) {
    let u=sqrt(max(0.,.5*(r+z.x)));
    if(u>1e-15) {
      return vec2f(u,z.y/(2.*u));
    }
    return vec2f(0);
  }
  let v=sqrt(max(0.,.5*(r-z.x)))*select(1.,-1.,z.y<0);
  return vec2f(z.y/(2.*v),v);
}
fn cquad(b:f32,c:f32)->array<vec2f,2> {
  let q=-.5*(vec2f(b,0)+select(1.,-1.,b<0)*csqrt(vec2f(b*b-4.*c,0)));
  if(length(q)<1e-15) {
    return array<vec2f,2>(vec2f(0),vec2f(0));
  }
  return array<vec2f,2>(q,cd(vec2f(c,0),q));
}
fn largestCubic(b:f32,c:f32,d:f32)->f32 {
  let p=c-b*b/3.;
  let q=2.*b*b*b/27.-b*c/3.+d;
  let discriminant=q*q*.25+p*p*p/27.;
  if(discriminant>=0) {
    return cbrtReal(-q*.5+sqrt(discriminant))+cbrtReal(-q*.5-sqrt(discriminant))-b/3.;
  }
  let radius=2.*sqrt(-p/3.);
  let theta=acos(clamp(3.*q/(p*radius),-1.,1.))/3.;
  return radius*cos(theta)-b/3.;
}
fn ferrari(a:array<f32,5>)->array<vec2f,4> {
  let b=a[3]/a[4];
  let c=a[2]/a[4];
  let d=a[1]/a[4];
  let e=a[0]/a[4];
  let p=c-3.*b*b/8.;
  let q=b*b*b/8.-b*c*.5+d;
  let rr=-3.*b*b*b*b/256.+b*b*c/16.-b*d*.25+e;
  var z:array<vec2f,4>;
  if(abs(q)<1e-7*max(1.,abs(p)+abs(rr))) {
    let v=cquad(p,rr);
    let u=csqrt(v[0]);
    let w=csqrt(v[1]);
    z=array<vec2f,4>(u,-u,w,-w);
  }
  else {
    let m=largestCubic(2.*p,p*p-4.*rr,-q*q);
    if(!(m>1e-12)) {
      return z;
    }
    let t=sqrt(m);
    let u=(p+m-q/t)*.5;
    let v=(p+m+q/t)*.5;
    let r0=cquad(t,u);
    let r1=cquad(-t,v);
    z=array<vec2f,4>(r0[0],r0[1],r1[0],r1[1]);
  }
  for(var j=0u;j<4u;j++) {
    z[j]-=vec2f(b*.25,0);
  }
  return z;
}
fn maxwellRows(k:CV)->array<CV,3> {
  let e=epsilon();
  let kk=vd(k,k);
  var a:array<CV,3>;
  for(var i=0u;i<3u;i++) {
    var row=va(realv(e[i]),vs(k,vec2f(k.re[i],k.im[i])));
    row.re[i]-=kk.x;
    row.im[i]-=kk.y;
    a[i]=row;
  }
  return a;
}
fn detRows(a:array<CV,3>)->vec2f {
  return vd(a[0],vx(a[1],a[2]));
}
fn detDerivative(k:CV,n:vec3f,a:array<CV,3>)->vec2f {
  let kn=vd(k,realv(n));
  var da:array<CV,3>;
  for(var i=0u;i<3u;i++) {
    var row=va(vs(k,vec2f(n[i],0)),vs(realv(n),vec2f(k.re[i],k.im[i])));
    row.re[i]-=2.*kn.x;
    row.im[i]-=2.*kn.y;
    da[i]=row;
  }
  return vd(da[0],vx(a[1],a[2]))+vd(a[0],vx(da[1],a[2]))+vd(a[0],vx(a[1],da[2]));
}
fn polynomialResidual(a:array<f32,5>,q:vec2f)->f32 {
  var value=vec2f(a[4],0);
  var scale=abs(a[4]);
  for(var j=4u;j>0u;j--) {
    value=cm(value,q)+vec2f(a[j-1u],0);
    scale=scale*length(q)+abs(a[j-1u]);
  }
  return length(value)/max(1e-20,scale);
}
fn refineRoot(input:vec2f,t:vec3f,n:vec3f)->vec2f {
  var q=input;
  for(var j=0u;j<10u;j++) {
    let k=CV(t+n*q.x,n*q.y);
    let a=maxwellRows(k);
    let value=detRows(a);
    let derivative=detDerivative(k,n,a);
    if(length(derivative)<1e-9) {
      break;
    }
    let dq=cd(value,derivative);
    let next=q-dq;
    if(!(length(next)<1e4)) {
      break;
    }
    q=next;
    if(length(dq)<2e-7*max(1.,length(q))) {
      break;
    }
  }
  if(abs(q.y)<2e-6*max(1.,abs(q.x))) {
    q.y=0.;
  }
  return q;
}
fn biaxialPolynomial(t:vec3f,n:vec3f)->array<f32,5> {
  let e=epsilon();
  let et=e*t;
  let en=e*n;
  let a=vec3f(dot(t,et),2.*dot(n,et),dot(n,en));
  let b=vec3f(dot(t,t),2.*dot(t,n),dot(n,n));
  let ee=vec3f(dot(et,et),2.*dot(en,et),dot(en,en));
  let tr=e[0].x+e[1].y+e[2].z;
  var poly:array<f32,5>;
  for(var i=0u;i<3u;i++) {
    for(var j=0u;j<3u;j++) {
      poly[i+j]+=a[i]*b[j];
    }
    poly[i]+=ee[i]-tr*a[i];
  }
  poly[0]+=determinant(e);
  return poly;
}
fn biaxialH(p:vec3f)->vec2f {
  let q2=dot(p,p);
  let d=safeunit(p);
  let u=basis(d);
  let v=cross(d,u);
  let inv=epsilonInverse();
  let a=dot(u,inv*u);
  let b=dot(u,inv*v);
  let e=dot(v,inv*v);
  let gap=length(vec2f(a-e,2.*b));
  return .5*q2*vec2f(a+e-gap,a+e+gap);
}
fn maxwellField(k:CV)->Field {
  let rows=maxwellRows(k);
  let c0=vx(rows[0],rows[1]);
  let c1=vx(rows[0],rows[2]);
  let c2=vx(rows[1],rows[2]);
  var e=c0;
  var size=dot(e.re,e.re)+dot(e.im,e.im);
  for(var j=0u;j<2u;j++) {
    var v=c1;
    if(j==1u) {
      v=c2;
    }
    let s=dot(v.re,v.re)+dot(v.im,v.im);
    if(s>size) {
      size=s;
      e=v;
    }
  }
  var norm2=0.;
  for(var j=0u;j<3u;j++) {
    norm2+=dot(rows[j].re,rows[j].re)+dot(rows[j].im,rows[j].im);
  }
  if(sqrt(size)<2e-6*norm2) {
    fail(10u);
  }
  e=vn(e);
  var residual=0.;
  for(var j=0u;j<3u;j++) {
    let v=vd(rows[j],e);
    residual+=dot(v,v);
  }
  residual=sqrt(residual/max(1e-20,norm2));
  pixels[id].extra.z=max(pixels[id].extra.z,residual);
  if(!(residual<1e-5)) {
    fail(10u);
  }
  return Field(e,vx(k,e),k.re,0.,0u,2u);
}
fn biaxialModes(t:vec3f,n:vec3f,side:f32)->array<Field,2> {
  let a=biaxialPolynomial(t,n);
  var roots=ferrari(a);
  var reciprocal:array<vec2f,4>;
  let reversed=array<f32,5>(a[4],a[3],a[2],a[1],a[0]);
  var useReverse=abs(a[0])>1e-6;
  if(useReverse) {
    let reverse=ferrari(reversed);
    for(var j=0u;j<4u;j++) {
      if(length(reverse[j])<1e-10) {
        useReverse=false;
        break;
      }
      reciprocal[j]=cd(vec2f(1,0),reverse[j]);
    }
  }
  var quality=0.;
  var reverseQuality=0.;
  for(var j=0u;j<4u;j++) {
    quality=max(quality,polynomialResidual(a,roots[j]));
    if(useReverse) {
      reverseQuality=max(reverseQuality,polynomialResidual(a,reciprocal[j]));
    }
  }
  if(useReverse && reverseQuality<quality) {
    roots=reciprocal;
  }
  for(var j=0u;j<4u;j++) {
    roots[j]=refineRoot(roots[j],t,n);
  }
  var out:array<Field,2>;
  var count=0u;
  for(var j=0u;j<4u;j++) {
    let q=roots[j];
    let residual=polynomialResidual(a,q);
    pixels[id].extra.w=max(pixels[id].extra.w,residual);
    if(!(residual<2e-5)||!(length(q)<1e4)) {
      fail(9u);
      return out;
    }
    for(var k=0u;k<j;k++) {
      if(length(q-roots[k])<3e-4*max(1.,length(q))) {
        fail(9u);
        return out;
      }
    }
    let prop=q.y==0.;
    if(!prop && side*q.y<=0) {
      continue;
    }
    let k=CV(t+n*q.x,n*q.y);
    var f=maxwellField(k);
    f.prop=select(0u,1u,prop);
    f.flux=flux(f.E,f.H,n);
    if(prop) {
      if(side*f.flux<=1e-7) {
        continue;
      }
      let h=abs(biaxialH(k.re)-vec2f(1));
      f.mode=select(1u,0u,h.x<=h.y);
      let drift=min(h.x,h.y);
      pixels[id].more.w=max(pixels[id].more.w,drift);
      if(!(drift<3e-5)||abs(h.x-h.y)<2e-5) {
        fail(10u);
        return out;
      }
    }
    if(count>=2u) {
      fail(9u);
      return out;
    }
    out[count]=f;
    count++;
  }
  if(count!=2u) {
    fail(9u);
    return out;
  }
  if(out[1].mode<out[0].mode) {
    let swap=out[0];
    out[0]=out[1];
    out[1]=swap;
  }
  return out;
}
fn mediumModes(m:Material,t:vec3f,n:vec3f,side:f32)->array<Field,2> {
  if(m.iso==2u) {
    return biaxialModes(t,n,side);
  }
  return array<Field,2>(modefield(m,t,n,side,0u),modefield(m,t,n,side,1u));
}
fn packetDirection(r:Ray)->vec3f {
  if(r.flags.x==1u && cfg[0].w==3) {
    let e=CV(r.er.xyz,r.ei.xyz);
    let h=vx(realv(r.p.xyz),e);
    return safeunit(cross(e.re,h.re)+cross(e.im,h.im));
  }
  return safeunit(kinv(r.p.xyz,localMaterial(1u,r.o.xyz),u32(r.p.w)));
}
fn col(f:Field,t1:vec3f,t2:vec3f)->array<vec2f,4> {
  return array<vec2f,4>(vd(realv(t1),f.E),vd(realv(t2),f.E),vd(realv(t1),f.H),vd(realv(t2),f.H));
}
fn ahead(a:Ray,b:Ray)->bool {
  return a.o.w>b.o.w || (a.o.w==b.o.w && a.er.w<b.er.w);
}
fn push(input:Ray) {
  var r=input;
  if(!(r.o.w>=0 && r.o.w<1e4)) {
    fail(3u);
    return;
  }
  if(r.o.w==0) {
    return;
  }
  if(r.o.w<cfg[3].y) {
    pixels[id].cutoff.x+=r.o.w;
    return;
  }
  var size=pixels[id].counts.x;
  if(size>=CAP) {
    fail(4u);
    return;
  }
  r.er.w=f32(pixels[id].counts.w);
  pixels[id].counts.w++;
  let base=id*CAP;
  var i=size;
  loop {
    if(i==0u) {
      break;
    }
    let parent=(i-1u)/2u;
    if(!ahead(r,queue[base+parent])) {
      break;
    }
    queue[base+i]=queue[base+parent];
    i=parent;
  }
  queue[base+i]=r;
  size++;
  pixels[id].counts.x=size;
  pixels[id].counts.z=max(pixels[id].counts.z,size);
  pixels[id].more.x+=r.o.w;
}
fn pop()->Ray {
  let base=id*CAP;
  let first=queue[base];
  let size=pixels[id].counts.x-1u;
  let last=queue[base+size];
  pixels[id].counts.x=size;
  if(size>0u) {
    var i=0u;
    loop {
      var j=2u*i+1u;
      if(j>=size) {
        break;
      }
      if(j+1u<size && ahead(queue[base+j+1u],queue[base+j])) {
        j++;
      }
      if(!ahead(queue[base+j],last)) {
        break;
      }
      queue[base+i]=queue[base+j];
      i=j;
    }
    queue[base+i]=last;
  }
  pixels[id].more.x=max(0.,pixels[id].more.x-first.o.w);
  if(size==0u) {
    pixels[id].more.x=0.;
  }
  return first;
}
fn drain(reason:u32) {
  var sum=0.;
  for(var j=0u;j<pixels[id].counts.x;j++) {
    sum+=queue[id*CAP+j].o.w;
  }
  pixels[id].cutoff[reason]+=sum;
  pixels[id].counts.x=0u;
  pixels[id].more.x=0.;
  pixels[id].aux.x=1u;
}
fn cubehit(o:vec3f,d:vec3f,inside:bool)->f32 {
  var near=-1e20;
  var far=1e20;
  for(var j=0u;j<3u;j++) {
    if(abs(d[j])<1e-12) {
      if(abs(o[j])>1.) {
        return -1.;
      }
      continue;
    }
    let a=(-1.-o[j])/d[j];
    let b=(1.-o[j])/d[j];
    near=max(near,min(a,b));
    far=min(far,max(a,b));
  }
  if(inside) {
    if(far>1e-7) {
      return far;
    }
    return -1.;
  }
  if(near<=far && near>1e-7) {
    return near;
  }
  return -1.;
}
// All directions passed here are unit group-velocity directions. The torus has
// major radius .72, minor radius .29, and symmetry axis y, as on the CPU.
fn spherehit(o:vec3f,d:vec3f,inside:bool)->f32 {
  let center=-dot(o,d);
  let closest=o+center*d;
  let delta=1.-dot(closest,closest);
  if(abs(delta)<2e-5) {
    fail(5u);
    return -1.;
  }
  if(delta<0) {
    return -1.;
  }
  let t=center+select(-sqrt(delta),sqrt(delta),inside);
  if(t>1e-7) {
    return t;
  }
  return -1.;
}
fn torusValue(x:vec3f)->f32 {
  let v=length(x.xz)-.72;
  return v*v+x.y*x.y-.29*.29;
}
fn torusNormal(x:vec3f)->vec3f {
  let rho=length(x.xz);
  if(rho<1e-6) {
    fail(5u);
    return vec3f(0,1,0);
  }
  return safeunit(vec3f(x.x*(1.-.72/rho),x.y,x.z*(1.-.72/rho)));
}
fn cbrtReal(x:f32)->f32 {
  return sign(x)*pow(abs(x),1./3.);
}
fn torushit(o:vec3f,d:vec3f,inside:bool)->f32 {
  // Recenter the polynomial at the closest point on the line, avoiding the
  // cancellation from fourth powers of the camera distance. A bounding sphere
  // limits all four roots. Cubic derivative roots isolate monotone intervals.
  let center=-dot(o,d);
  let m=o+center*d;
  // A small outward margin keeps roots on the torus outer rim strictly
  // inside the bracket despite f32 rounding of the bounding sphere.
  let radius=1.01002;
  let bound=radius*radius-dot(m,m);
  if(bound< -2e-5) {
    return -1.;
  }
  if(abs(bound)<2e-5) {
    fail(5u);
    return -1.;
  }
  let half=sqrt(bound);
  if(center+half<=1e-7) {
    return -1.;
  }
  let a=dot(m,m)+.72*.72-.29*.29;
  let b=2.*dot(m,d);
  let dd=dot(d,d);
  let rr=4.*.72*.72;
  let cubic=2.*b/dd;
  let quadratic=(b*b+2.*a*dd-rr*dot(d.xz,d.xz))/(dd*dd);
  let linear=(2.*a*b-2.*rr*dot(m.xz,d.xz))/(dd*dd);
  let shift=cubic*.25;
  let pp=quadratic*.5-3.*shift*shift;
  let qq=2.*shift*shift*shift-shift*quadratic*.5+linear*.25;
  let disc=qq*qq*.25+pp*pp*pp/27.;
  var critical:array<f32,3>;
  var count=1u;
  if(abs(disc)<1e-9) {
    fail(5u);
    return -1.;
  }
  if(disc>0) {
    critical[0]=cbrtReal(-qq*.5+sqrt(disc))+cbrtReal(-qq*.5-sqrt(disc))-shift;
  }
  else {
    let scale=2.*sqrt(-pp/3.);
    let angle=acos(clamp((3.*qq/(2.*pp))*sqrt(-3./pp),-1.,1.))/3.;
    critical[0]=scale*cos(angle)-shift;
    critical[1]=scale*cos(angle+2.09439510239)-shift;
    critical[2]=scale*cos(angle+4.18879020479)-shift;
    count=3u;
    for(var j=0u;j<3u;j++) {
      for(var k=j+1u;k<3u;k++) {
        if(critical[k]<critical[j]) {
          let v=critical[j];
          critical[j]=critical[k];
          critical[k]=v;
        }
      }
    }
  }
  var ends:array<f32,5>;
  ends[0]=-half;
  var size=1u;
  for(var j=0u;j<count;j++) {
    let t=critical[j];
    if(t> -half && t<half) {
      ends[size]=t;
      size++;
      if(abs(torusValue(m+t*d))<2e-6 && center+t> -2e-5) {
        fail(5u);
        return -1.;
      }
    }
  }
  ends[size]=half;
  size++;
  for(var j=0u;j+1u<size;j++) {
    var lo=ends[j];
    var hi=ends[j+1u];
    if(center+hi<=1e-7) {
      continue;
    }
    let flo=torusValue(m+lo*d);
    let fhi=torusValue(m+hi*d);
    if(flo*fhi>0) {
      continue;
    }
    for(var k=0u;k<24u;k++) {
      let mid=.5*(lo+hi);
      let fm=torusValue(m+mid*d);
      if((fm<0)==(flo<0)) {
        lo=mid;
      }
      else {
        hi=mid;
      }
    }
    var root=.5*(lo+hi);
    for(var k=0u;k<2u;k++) {
      let x=m+root*d;
      let rho=length(x.xz);
      let deriv=2.*((rho-.72)*dot(x.xz,d.xz)/rho+x.y*d.y);
      if(abs(deriv)>1e-5) {
        let next=root-torusValue(x)/deriv;
        if(next>=ends[j] && next<=ends[j+1u]) {
          root=next;
        }
      }
    }
    let t=center+root;
    if(t<=1e-7) {
      continue;
    }
    let x=o+t*d;
    let n=torusNormal(x);
    let nd=dot(n,d);
    if(abs(torusValue(x))>4e-7 || abs(nd)<.004) {
      fail(5u);
      return -1.;
    }
    if((inside && nd>0)||(!inside && nd<0)) {
      return t;
    }
  }
  return -1.;
}
fn shapehit(o:vec3f,d:vec3f,inside:bool)->f32 {
  if(cfg[9].y==4) {
    return aspherehit(o,d,inside);
  }
  if(cfg[9].y==3) {
    if(abs(d.z)<1e-8) {
      return -1.;
    }
    let z=select(-sign(d.z),sign(d.z),inside);
    let t=(z-o.z)/d.z;
    return select(-1.,t,t>1e-7);
  }
  if(cfg[9].y==1) {
    return spherehit(o,d,inside);
  }
  if(cfg[9].y==2) {
    return torushit(o,d,inside);
  }
  return cubehit(o,d,inside);
}
fn normal(x:vec3f)->vec3f {
  if(cfg[9].y==4) {
    return asphereNormal(x);
  }
  if(cfg[9].y==3) {
    return vec3f(0,0,sign(x.z));
  }
  if(cfg[9].y==1) {
    return safeunit(x);
  }
  if(cfg[9].y==2) {
    return torusNormal(x);
  }
  let a=abs(x);
  var j=0u;
  if(a.y>a.x) {
    j=1u;
  }
  if(a.z>a[j]) {
    j=2u;
  }
  for(var k=0u;k<3u;k++) {
    if(k!=j && abs(a[k]-a[j])<2e-5) {
      fail(5u);
    }
  }
  var n=vec3f(0);
  n[j]=select(-1.,1.,x[j]>0);
  return n;
}
fn backgroundDistance(o:vec3f,d:vec3f)->f32 {
  if(abs(d.z)<1e-7) {
    return 1e20;
  }
  let t=(cfg[6].w-o.z)/d.z;
  return select(1e20,t,t>0);
}
fn decode(s:vec3f)->vec3f {
  return select(pow(max(s,vec3f(0))*.9478672986+vec3f(.0521327014),vec3f(2.4)),s/12.92,s<=vec3f(.04045));
}
// Region numbering and glyph geometry follow landmark-target.js.
// Colors are supplied as linear RGB (or integrated XYZ for the constant case).
fn targetGlyph(letter:u32,x:f32,y:f32,pitch:f32)->bool {
  let ix=i32(floor((x+2.5*pitch)/pitch));
  let iy=i32(floor((3.5*pitch-y)/pitch));
  if(ix<0 || ix>=5 || iy<0 || iy>6) {
    return false;
  }
  let font=array<u32,56>(17u,17u,17u,17u,17u,17u,14u,30u,17u,17u,17u,17u,17u,30u,16u,16u,16u,16u,16u,16u,31u,30u,17u,17u,30u,20u,18u,17u,4u,12u,4u,4u,4u,4u,14u,14u,17u,1u,2u,4u,8u,31u,30u,1u,1u,14u,1u,1u,30u,2u,6u,10u,18u,31u,2u,2u);
  return (font[letter*7u+u32(iy)]&(1u<<u32(4-ix)))!=0u;
}
fn targetRegion(x:f32,y:f32)->u32 {
  let marks=array<vec2f,4>(vec2f(0,.48),vec2f(0,-.48),vec2f(-.48,0),vec2f(.48,0));
  for(var j=0u;j<4u;j++) {
    let p=vec2f(x,y)-marks[j];
    if(any(abs(p)>vec2f(.29))) {
      continue;
    }
    var r=length(p);
    var radius=.195;
    if(j==1u) {
      r=(abs(p.x)+abs(p.y))/.99;
      radius=.255;
    }
    if(j==2u) {
      r=max(abs(p.x),abs(p.y));
    }
    if(j==3u) {
      r=max(abs(p.y),.866025403784*abs(p.x)+.5*abs(p.y));
    }
    if(r<=radius+.028) {
      if(r>radius || targetGlyph(j,p.x,p.y,.032)) {
        return 0u;
      }
      return 3u+j;
    }
  }
  let directions=array<vec2f,4>(vec2f(0,1),vec2f(0,-1),vec2f(-1,0),vec2f(1,0));
  for(var j=0u;j<4u;j++) {
    let d=directions[j];
    let p=vec2f(x,y)-1.75*d;
    if(any(abs(p)>vec2f(.25))) {
      continue;
    }
    let r=length(p);
    if(r<=.225) {
      if(r>=.197) {
        return 2u;
      }
      let l=dot(p,d);
      let t=abs(p.x*d.y-p.y*d.x);
      let ink=(l>=-.11 && l<=.015 && t<=.035)||(l>=-.015 && l<=.14 && t<=(.14-l)*.72);
      return select(0u,2u,ink);
    }
  }
  let xs=array<f32,4>(-1.75,-.75,.75,1.75);
  for(var row=0u;row<4u;row++) {
    for(var col=0u;col<4u;col++) {
      let p=vec2f(x-xs[col],y+xs[row]);
      if(abs(p.x)<=.205 && abs(p.y)<=.155) {
        if(abs(p.x)>.176 || abs(p.y)>.126) {
          return 2u;
        }
        // Two glyph centers separated by 6 pitches.
        return select(0u,2u,targetGlyph(4u+row,p.x+3.*.031,p.y,.031)||targetGlyph(4u+col,p.x-3.*.031,p.y,.031));
      }
    }
  }
  let a=abs(vec2f(x,y));
  if(all(a<vec2f(.10)) && (a.x<.052 || a.y<.052)) {
    return select(0u,2u,a.x<.025 || a.y<.025);
  }
  let k=i32(floor(x*2.)+floor(y*2.));
  return select(1u,0u,((k%2+2)%2)==1);
}
// An uncertain target sample carried by a very weak reflected ray may
// remain on GPU only within a cumulative absolute radiance budget.
// This is separate from discarded ray weight and is reported to the caller.
var<private> backgroundWeight:f32;
var<private> backgroundMarked:bool;
fn uncertainBackground() {
  if(backgroundMarked) {
    return;
  }
  backgroundMarked=true;
  let bound=backgroundWeight*cfg[21].w;
  if(pixels[id].backgroundError.x+bound<=1e-5) {
    pixels[id].backgroundError.x+=bound;
    pixels[id].backgroundError.y+=1.;
  }
  else {
    fail(6u);
  }
}
fn targetColor(p:vec2f,edge:f32)->vec3f {
  let region=targetRegion(p.x,p.y);
  // Reject discontinuities within the f32 intersection guard.
  for(var a=-1;a<=1;a++) {
    for(var b=-1;b<=1;b++) {
      if(targetRegion(p.x+f32(a)*edge,p.y+f32(b)*edge)!=region) {
        uncertainBackground();
      }
    }
  }
  return cfg[32u+region].xyz;
}
fn background(o:vec3f,d:vec3f,weight:f32)->vec3f {
  backgroundWeight=weight;
  backgroundMarked=false;
  if(cfg[7].w==3) {
    return vec3f(1);
  }
  // Curved surfaces can send light almost parallel to the background. A small
  // angular f32 error is then amplified by the plane intersection. Recompute
  // those pixels, and widen discontinuity guards by the projection condition.
  if(cfg[9].y>0 && abs(d.z)<.015) {
    uncertainBackground();
  }
  let t=backgroundDistance(o,d);
  if(t>=1e19) {
    if(cfg[7].w==6) {
      if(cfg[39].z==1) {
        return cfg[32].xyz*.05;
      }
      if(cfg[39].y==1) {
        return vec3f(.05);
      }
      return decode(vec3f(25,34,52)/255.);
    }
    if(cfg[7].w>=4) {
      return decode(vec3f(64)/255.);
    }
    return decode(vec3f(25,34,52)/255.);
  }
  if(t>1e4) {
    uncertainBackground();
  }
  var edge=3e-4;
  if(cfg[9].y>0) {
    if(t>100.) {
      uncertainBackground();
    }
    edge*=max(1.,t/4.)/max(.05,abs(d.z));
  }
  let p=o+t*d;
  let x=p.x;
  let y=p.y;
  if(cfg[7].w==6) {
    return targetColor(p.xy,edge);
  }
  if(cfg[7].w==5) {
    return vec3f(.5+.45*sin(3.*x)*sin(3.*y));
  }
  if(cfg[7].w==4) {
    if(min(abs(2.*x-round(2.*x)),abs(2.*y-round(2.*y)))<2.*edge) {
      uncertainBackground();
    }
    let k=i32(floor(x*2.)+floor(y*2.));
    return decode(vec3f(select(64.,255.,((k%2+2)%2)==1))/255.);
  }
  if(cfg[7].w==1) {
    return decode(vec3f(128.+100.*sin(x),128.+100.*sin(y),150.)/255.);
  }
  let aw=cfg[8].z;
  if(cfg[7].w==2) {
    let dx=abs(x-round(x));
    let dy=abs(y-round(y));
    if(min(abs(dx-.025),min(abs(dy-.025),min(abs(dx-.16),abs(dy-.16))))<edge) {
      uncertainBackground();
    }
    return vec3f(select(0.,1.,(dx<.025 && dy<.16)||(dy<.025 && dx<.16)));
  }
  if(min(abs(abs(y)-aw),abs(abs(x)-aw))<edge) {
    uncertainBackground();
  }
  if(abs(y)<aw) {
    return decode(vec3f(218,54,57)/255.);
  }
  if(abs(x)<aw) {
    return decode(vec3f(32,145,80)/255.);
  }
  if(min(abs(2.*x-round(2.*x)),abs(2.*y-round(2.*y)))<2.*edge) {
    uncertainBackground();
  }
  var palette=vec3f(239,232,250);
  if(x>=0) {
    palette=select(vec3f(250,244,224),vec3f(230,240,250),y>=0);
  }
  else if(y>=0) {
    palette=vec3f(250,231,236);
  }
  let k=i32(floor(x*2.)+floor(y*2.));
  return decode(select(vec3f(64),palette,((k%2+2)%2)==1)/255.);
}
fn isAnisotropicGradient()->bool {
  return cfg[0].w==2 || (cfg[0].w>=9 && cfg[0].w<=17);
}
fn anisotropicVarying()->bool {
  let kind=u32(cfg[0].w);
  if(kind>=14u) {
    return true;
  }
  if(kind==13u) {
    return abs(cfg[12].w)>1e-12;
  }
  if(kind==10u) {
    return abs(cfg[11].w*length(cfg[2].xy))>1e-12;
  }
  return abs(cfg[2].w)>1e-12;
}
fn opticalMetric(m:Material,mode:u32)->mat3x3f {
  if(m.iso==6u) {
    let J=mapJ(m.axis,false);
    return J*J;
  }
  if(m.iso==4u) {
    let b=m.axis.xy;
    return mat3x3f(vec3f(1,0,b.x),vec3f(0,1,b.y),vec3f(b,1.+dot(b,b)));
  }
  if(m.iso==5u) {
    let a=m.no*m.no;
    let d=select(vec3f(-a,-a,-.25*a),vec3f(a,-a,.25*a),mode==1u);
    return mat3x3f(vec3f(d.x,0,0),vec3f(0,d.y,0),vec3f(0,0,d.z));
  }
  let no2=select(1.,-1.,m.iso==3u)*m.no*m.no;
  var ne2=m.ne*m.ne;
  if(mode==0u || m.iso==1u) {
    ne2=no2;
  }
  let a=m.axis;
  let delta=no2-ne2;
  return mat3x3f(vec3f(ne2,0,0)+delta*a.x*a,vec3f(0,ne2,0)+delta*a.y*a,vec3f(0,0,ne2)+delta*a.z*a);
}
struct Schur {
  M:mat2x2f,
  B:vec2f,
  h:f32
}
fn blocks(g:mat3x3f)->Schur {
  let det=g[0].x*g[1].y-g[1].x*g[0].y;
  if(abs(det)<2e-6) {
    fail(13u);
    return Schur();
  }
  let M=mat2x2f(vec2f(g[1].y,-g[0].y),vec2f(-g[1].x,g[0].x))*(1./det);
  let B=g[2].xy;
  return Schur(M,B,g[2].z-dot(B,M*B));
}
fn atanhOver(x:f32)->f32 {
  let a=abs(x);
  if(a<.02) {
    let x2=x*x;
    return 1.+x2*(1./3.+x2*(1./5.+x2/7.));
  }
  return .5*log((1.+x)/(1.-x))/x;
}
fn asinhDifference(a:f32,b:f32)->f32 {
  let d=(a-b)/(sqrt(1.+a*a)+sqrt(1.+b*b));
  return 2.*d*atanhOver(d);
}
fn anisotropicCheck(s:Path,mode:u32) {
  let m=localMaterial(1u,s.x);
  let drift=abs(dot(s.p,kinv(s.p,m,mode))-1.);
  pixels[id].more.w=max(pixels[id].more.w,drift);
  if(!(drift<1e-5)) {
    fail(13u);
  }
  if(cfg[0].w!=11 && cfg[0].w!=13 && cfg[0].w!=14 && cfg[0].w<16 && length(cross(m.axis,safeunit(s.p)))<2e-5) {
    fail(2u);
  }
}
// Closed formulas are evaluated from the entrance state at each queried z.
// No homogeneous layers, artificial internal interfaces or numerical quadrature.
fn anisotropicClosed(anchor:Path,z:f32,mode:u32)->Path {
  let kind=u32(cfg[0].w);
  let z0=anchor.x.z;
  let dz=z-z0;
  let k=anchor.p.xy;
  let v=kinv(anchor.p,localMaterial(1u,anchor.x),mode);
  if(abs(v.z)<1e-6) {
    fail(13u);
    return anchor;
  }
  let dir=sign(v.z);
  var q=vec2f(0);
  if(kind==2u || kind==9u || kind==12u) {
    let b=blocks(opticalMetric(material(1u,0.),mode));
    let mk=b.M*k;
    let pi=dot(k,mk);
    let g=cfg[2].w;
    var integral=0.;
    if(kind==2u) {
      let a=1.+g*z0;
      let c=1.+g*z;
      let d0=1.-pi*a*a;
      let d1=1.-pi*c*c;
      if(min(a,c)<=0 || min(d0,d1)<2e-5 || b.h<=0) {
        fail(13u);
        return anchor;
      }
      integral=sqrt(b.h)*dz*(a+c)/(sqrt(d0)+sqrt(d1));
    }
    else if(kind==9u) {
      let base=1.-pi;
      if(g<0 || base<2e-5 || b.h<=0) {
        fail(13u);
        return anchor;
      }
      let r0=sqrt(base+g*z0*z0);
      let r1=sqrt(base+g*z*z);
      let u=sqrt(g)*dz/(r0+r1);
      integral=sqrt(b.h)*2.*dz/(r0+r1)*atanhOver(u);
    }
    else {
      let e0=1.+g*z0;
      let e1=1.+g*z;
      if(min(e0,e1)<=0 || min(pi-e0,pi-e1)<2e-5 || b.h>=-2e-5) {
        fail(13u);
        return anchor;
      }
      integral=sqrt(-b.h)*2.*dz/(sqrt(pi-e0)+sqrt(pi-e1));
    }
    q=dir*mk*integral-(b.M*b.B)*dz;
  }
  else if(kind==10u) {
    if(mode==0u) {
      let d=cfg[1].y*cfg[1].y-dot(k,k);
      if(d<2e-5) {
        fail(13u);
        return anchor;
      }
      q=dir*k*dz/sqrt(d);
    }
    else {
      if(dot(k,k)>=1e-20) {
        fail(13u);
        return anchor;
      }
      let axis=cfg[2].xyz;
      let delta=cfg[1].y*cfg[1].y-cfg[1].z*cfg[1].z;
      let w=delta*axis.z/(cfg[1].z*cfg[1].z+delta*dot(axis.xy,axis.xy));
      let om=cfg[11].w;
      // Integral of the rotated transverse axis: midpoint form avoids cancellation.
      let half=.5*om*dz;
      let sinc=select(1.,sin(half)/select(1.,half,half!=0),abs(half)>1e-7);
      let phase=om*(z+z0)*.5;
      let a=vec2f(axis.x*cos(phase)-axis.y*sin(phase),axis.x*sin(phase)+axis.y*cos(phase));
      q=-w*a*dz*sinc;
    }
  }
  else if(kind==11u) {
    if(mode==0u) {
      if(dot(k,k)>=1e-20) {
        fail(13u);
        return anchor;
      }
    }
    else {
      let d=1.-dot(k,k);
      if(d<2e-5) {
        fail(13u);
        return anchor;
      }
      let integral=dz+2.*cfg[2].w*sin((z+z0)*.5)*sin(dz*.5);
      q=dir*k*integral/sqrt(d);
    }
  }
  else if(kind==13u) {
    let d=1.-dot(k,k);
    if(d<2e-5) {
      fail(13u);
      return anchor;
    }
    let t0=(z0+1.)*.5;
    let t1=(z+1.)*.5;
    let df=-cfg[12].w*(t1-t0)*(3.*(t1+t0)-2.*(t1*t1+t1*t0+t0*t0));
    q=dir*k*dz/sqrt(d)-vec2f(df,.45*df);
  }
  else if(kind==14u) {
    if(mode==0u || abs(k.x*k.x-k.y*k.y)>=1e-12) {
      fail(13u);
      return anchor;
    }
    let g=cfg[21].z;
    let integral=select(dz,asinhDifference(sqrt(g)*z,sqrt(g)*z0)/sqrt(max(g,1e-20)),g>1e-12);
    q=.5*dir*integral*vec2f(k.x,-k.y);
  }
  else {
    fail(13u);
    return anchor;
  }
  let x=vec3f(anchor.x.xy+q,z);
  let b=blocks(opticalMetric(localMaterial(1u,x),mode));
  let mk=b.M*k;
  let d=1.-dot(k,mk);
  if(!(b.h/d>0) || abs(d)<2e-5 || abs(b.h)<2e-5) {
    fail(13u);
    return anchor;
  }
  let pz=dot(b.B,mk)+dir*b.h*sqrt(d/b.h);
  pixels[id].aux.z++;
  return Path(x,vec3f(k,pz));
}
fn bulkAnisotropicField(r:Ray,q:Path)->CV {
  let e=CV(r.er.xyz,r.ei.xyz);
  if(cfg[0].w==16 || cfg[0].w==17) {
    let J=mapJ(q.x,false)*mapJ(r.o.xyz,true);
    return vn(CV(J*e.re,J*e.im));
  }
  if(cfg[0].w==13) {
    let db=shearB(q.x.z)-shearB(r.o.z);
    return vn(CV(vec3f(e.re.xy,e.re.z+dot(db,e.re.xy)),vec3f(e.im.xy,e.im.z+dot(db,e.im.xy))));
  }
  return fields(realv(q.p),localMaterial(1u,q.x),u32(r.p.w)).E;
}
fn surfaceCovector(s:Path,mode:u32)->Path {
  let n=normal(s.x);
  let m=localMaterial(1u,s.x);
  let t=s.p-n*dot(n,s.p);
  let a=dot(n,kinv(n,m,mode));
  let b=2.*dot(n,kinv(t,m,mode));
  let c=dot(t,kinv(t,m,mode))-1.;
  let disc=b*b-4.*a*c;
  if(!(disc>2e-7 && abs(a)>1e-7)) {
    fail(19u);
    return s;
  }
  let q=(-b+sqrt(disc))/(2.*a);
  let p=t+n*q;
  if(dot(n,kinv(p,m,mode))<=0 || length(p-s.p)>1e-4*max(1.,length(s.p))) {
    fail(19u);
    return s;
  }
  return Path(s.x,p);
}
fn travel(r:Ray)->Path {
  pathTurned=false;
  if(isAnisotropicGradient() && anisotropicVarying()) {
    return surfaceCovector(anisotropicTravel(r),u32(r.p.w));
  }
  let s=Path(r.o.xyz,r.p.xyz);
  let d=packetDirection(r);
  let t=shapehit(s.x,d,true);
  if(t<0) {
    fail(5u);
  }
  pixels[id].aux.z++;
  return Path(s.x+max(0.,t)*d,s.p);
}
fn enqueueChild(v:Ray,x:vec3f,f:Field,e:CV,weight:f32,reflection:bool) {
  if(weight<=0) {
    return;
  }
  if(reflection && cfg[39].x==1) {
    pixels[id].odeControl.w+=weight;
    return;
  }
  if(weight<cfg[3].y) {
    pixels[id].cutoff.x+=weight;
    return;
  }
  let inside=select(1u-v.flags.x,v.flags.x,reflection);
  var q=Path(x,f.p);
  if(inside==1u) {
    var vel=vec3f(0);
    if(cfg[0].w==3) {
      vel=cross(e.re,f.H.re)+cross(e.im,f.H.im);
    }
    else {
      vel=kinv(q.p,localMaterial(1u,x),f.mode);
    }
    if(isGrin() && abs(cfg[2].w)>1e-12) {
      q=grinAdvance(q,2e-6/length(vel));
      grinCheck(q);
    }
    else if(isAnisotropicGradient() && anisotropicVarying()) {
      q=anisotropicAdvance(q,2e-6/length(vel),f.mode);
      anisotropicCheck(q,f.mode);
    }
    else {
      q.x+=2e-6*safeunit(vel);
    }
  }
  else {
    q.x+=2e-6*safeunit(f.p);
  }
  var tag=v.flags.z;
  if(v.flags.y==0u) {
    var label=f.mode;
    if(cfg[9].w==1 && cfg[0].w==1 && cfg[9].z==1) {
      label=1u-label;
    }
    tag=select(select(0u,1u+label,!coincident(localMaterial(1u,x))),3u,reflection);
  }
  var eout=e;
  if(inside==1u && isGrin() && abs(cfg[2].w)>1e-12) {
    eout=grinTransport(e,Path(x,f.p),q);
  }
  if(inside==1u && isAnisotropicGradient() && anisotropicVarying()) {
    let launch=Ray(vec4f(x,weight),vec4f(f.p,f32(f.mode)),vec4f(e.re,0),vec4f(e.im,0),vec4u(1,0,0,0));
    eout=bulkAnisotropicField(launch,q);
  }
  push(Ray(vec4f(q.x,weight),vec4f(q.p,f32(f.mode)),vec4f(eout.re,0),vec4f(eout.im,v.ei.w),vec4u(inside,v.flags.y+1u,tag,(v.flags.w&30u)|select(v.flags.w&1u,1u,reflection))));
}
fn scatter(v:Ray,x:vec3f,normalOut:vec3f) {
  let n=normalOut*select(-1.,1.,v.flags.x==1u);
  let mediumIn=localMaterial(v.flags.x,x);
  let to=localMaterial(1u-v.flags.x,x);
  let ei=CV(v.er.xyz,v.ei.xyz);
  let hi=magnetic(realv(v.p.xyz),ei,mediumIn);
  let fin=flux(ei,hi,n);
  if(!(fin>1e-7)) {
    fail(2u);
    return;
  }
  let t=v.p.xyz-n*dot(v.p.xyz,n);
  var f:array<Field,4>;
  let transmitted=mediumModes(to,t,n,1.);
  let reflected=mediumModes(mediumIn,t,n,-1.);
  f[0]=transmitted[0];
  f[1]=transmitted[1];
  f[2]=reflected[0];
  f[3]=reflected[1];
  if(pixels[id].aux.y>0u) {
    return;
  }
  let t1=basis(n);
  let t2=cross(n,t1);
  var columns:array<array<vec2f,4>,4>;
  for(var j=0u;j<4u;j++) {
    columns[j]=col(f[j],t1,t2);
    if(j>=2u) {
      for(var i=0u;i<4u;i++) {
        columns[j][i]*=-1.;
      }
    }
  }
  let bi=col(Field(ei,hi,v.p.xyz,fin,1u,0u),t1,t2);
  var a:array<vec2f,20>;
  var mat:array<vec2f,16>;
  for(var i=0u;i<4u;i++) {
    for(var j=0u;j<4u;j++) {
      a[i*5u+j]=columns[j][i];
      mat[i*4u+j]=columns[j][i];
    }
    a[i*5u+4u]=bi[i];
  }
  for(var k=0u;k<4u;k++) {
    var pivot=k;
    for(var i=k+1u;i<4u;i++) {
      if(dot(a[i*5u+k],a[i*5u+k])>dot(a[pivot*5u+k],a[pivot*5u+k])) {
        pivot=i;
      }
    }
    if(length(a[pivot*5u+k])<1e-6) {
      fail(3u);
      return;
    }
    for(var j=k;j<5u;j++) {
      let swap=a[k*5u+j];
      a[k*5u+j]=a[pivot*5u+j];
      a[pivot*5u+j]=swap;
    }
    for(var i=k+1u;i<4u;i++) {
      let factor=cd(a[i*5u+k],a[k*5u+k]);
      for(var j=k;j<5u;j++) {
        a[i*5u+j]-=cm(factor,a[k*5u+j]);
      }
    }
  }
  var coeff:array<vec2f,4>;
  for(var ii=4u;ii>0u;ii--) {
    let i=ii-1u;
    var sum=a[i*5u+4u];
    for(var j=i+1u;j<4u;j++) {
      sum-=cm(a[i*5u+j],coeff[j]);
    }
    coeff[i]=cd(sum,a[i*5u+i]);
  }
  var residual=0.;
  var bmax=0.;
  for(var i=0u;i<4u;i++) {
    var sum=vec2f(0);
    for(var j=0u;j<4u;j++) {
      sum+=cm(mat[i*4u+j],coeff[j]);
    }
    residual=max(residual,length(sum-bi[i]));
    bmax=max(bmax,length(bi[i]));
  }
  residual/=max(1e-9,bmax);
  pixels[id].more.z=max(pixels[id].more.z,residual);
  if(residual>3e-5) {
    fail(3u);
    return;
  }
  var weights:array<f32,4>;
  var es:array<CV,4>;
  for(var group=0u;group<2u;group++) {
    let off=2u*group;
    var m=to;
    if(group==1u) {
      m=mediumIn;
    }
    if(coincident(m)) {
      if(f[off].prop==1u) {
        let e=va(vs(f[off].E,coeff[off]),vs(f[off+1u].E,coeff[off+1u]));
        let h=magnetic(realv(f[off].p),e,m);
        weights[off]=abs(flux(e,h,n))/fin;
        if(weights[off]>1e-20) {
          es[off]=vn(e);
        }
        else {
          weights[off]=0.;
        }
      }
    }
    else {
      for(var j=0u;j<2u;j++) {
        let k=off+j;
        if(f[k].prop==1u) {
          weights[k]=dot(coeff[k],coeff[k])*abs(f[k].flux)/fin;
          es[k]=f[k].E;
        }
      }
    }
  }
  let total=weights[0]+weights[1]+weights[2]+weights[3];
  let error=abs(total-1.);
  pixels[id].more.y=max(pixels[id].more.y,error);
  if(!(error<5e-5)) {
    fail(3u);
    return;
  }
  pixels[id].diag.y+=1.;
  var branches=0u;
  for(var j=0u;j<4u;j++) {
    if(weights[j]>1e-20) {
      branches++;
      if(j>=2u) {
        pixels[id].diag.z+=1.;
      }
      enqueueChild(v,x,f[j],es[j],v.o.w*weights[j],j>=2u);
    }
  }
  if(branches>0u) {
    pixels[id].aux.w+=branches-1u;
  }
}
@compute @workgroup_size(32)
fn init(@builtin(global_invocation_id) gid:vec3u) {
  id=gid.x;
  if(id>=u32(cfg[9].x)) {
    return;
  }
  pixels[id]=Pixel();
  let n=cfg[0].x;
  let x=f32(id%u32(n));
  let y=f32(id/u32(n))+cfg[0].y;
  let offset=cfg[6].xyz*((x+.5-n*.5)/n*cfg[5].w)+cfg[7].xyz*((n*.5-y-.5)/n*cfg[5].w);
  var o=cfg[4].xyz;
  var d=cfg[5].xyz;
  if(cfg[4].w==1) {
    o+=offset;
  }
  else {
    d=safeunit(4.*d+offset);
  }
  let e0=basis(d);
  let e1=cross(d,e0);
  push(Ray(vec4f(o,.5),vec4f(d*cfg[1].w,0),vec4f(e0,0),vec4f(0),vec4u(0)));
  push(Ray(vec4f(o,.5),vec4f(d*cfg[1].w,0),vec4f(e1,0),vec4f(0),vec4u(0)));
}
@compute @workgroup_size(32)
fn step(@builtin(global_invocation_id) gid:vec3u) {
  id=gid.x;
  if(id>=u32(cfg[9].x) || pixels[id].aux.x==1u) {
    return;
  }
  for(var iter=0u;iter<8u;iter++) {
    if(pixels[id].aux.y>0u || pixels[id].counts.x==0u) {
      pixels[id].aux.x=1u;
      return;
    }
    let omitted=dot(pixels[id].cutoff,vec4f(1))+pixels[id].phaseError.x;
    if(cfg[3].w>0 && omitted+pixels[id].more.x<=cfg[3].w) {
      drain(3u);
      return;
    }
    if(pixels[id].counts.y>=u32(cfg[3].z)) {
      drain(2u);
      return;
    }
    var v=pop();
    pixels[id].counts.y++;
    pixels[id].diag.x=max(pixels[id].diag.x,f32(v.flags.y));
    if(v.flags.x==1u && v.flags.y>=u32(cfg[3].x)) {
      pixels[id].cutoff.y+=v.o.w;
      continue;
    }
    if(v.flags.x==1u && cfg[16].x==3 && (v.flags.w&32u)==0u) {
      coherentBulk(v);
      continue;
    }
    let dir=safeunit(v.p.xyz);
    var x:vec3f;
    if(v.flags.x==1u && (v.flags.w&32u)!=0u) {
      x=v.o.xyz;
    }
    else if(v.flags.x==1u) {
      if(isGrin() && abs(cfg[2].w)>1e-12) {
        v=grinTravel(v);
        x=v.o.xyz;
      }
      else {
        let q=travel(v);
        if(pixels[id].aux.y==0u && internalSplit(v,q)) {
          continue;
        }
        x=q.x;
        v.p=vec4f(q.p,v.p.w);
        if(isAnisotropicGradient() && anisotropicVarying()) {
          let e=bulkAnisotropicField(v,q);
          v.er=vec4f(e.re,v.er.w);
          v.ei=vec4f(e.im,0);
        }
      }
    }
    else {
      let t=shapehit(v.o.xyz,dir,false);
      if(t<0 || backgroundDistance(v.o.xyz,dir)<t) {
        if(cfg[16].x==3) {
          if((v.flags.w&1u)==0u) {
            pixels[id].phaseExtra.y+=v.o.w;
          }
          else {
            pixels[id].phaseExtra.z+=v.o.w;
          }
          if(sign(dir.z)==sign(cfg[5].z)) {
            pixels[id].phaseBoundary.w=bitcast<u32>(bitcast<f32>(pixels[id].phaseBoundary.w)+v.o.w);
          }
        }
        pixels[id].rgb.w+=v.o.w;
        pixels[id].diag.w+=1.;
        pixels[id].channels[v.flags.z]+=v.o.w;
        let view=u32(cfg[8].w);
        if(view==0u || (view==v.flags.z && view<3u)||(view==3u && (v.flags.w&1u)==1u)) {
          pixels[id].rgb=vec4f(pixels[id].rgb.xyz+v.o.w*background(v.o.xyz,dir,v.o.w),pixels[id].rgb.w);
        }
        continue;
      }
      x=v.o.xyz+t*dir;
      if(v.flags.y>0u) {
        pixels[id].extra.x+=1.;
      }
    }
    if(pixels[id].aux.y>0u) {
      pixels[id].aux.x=1u;
      return;
    }
    if(v.flags.y>=u32(cfg[3].x)) {
      pixels[id].cutoff.y+=v.o.w;
      continue;
    }
    pixels[id].extra.y+=1.;
    if(cfg[16].x==3) {
      pixels[id].phaseBoundary.z++;
      pixels[id].phaseExtra.w=max(pixels[id].phaseExtra.w,abs(shapeValue(x)));
    }
    scatter(v,x,normal(x));
  }
}
