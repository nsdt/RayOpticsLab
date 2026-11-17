/* Fehlberg 4(5), NASA TR R-315 (1969): accept order 5, estimate error with
 * the embedded difference. Integrate requested intervals with adaptive inner
 * steps; geometry/event brackets are independent. No image-error guarantee. */
(function(O){
'use strict';
const defaults={odeRtol:1e-6,odeAtolPosition:1e-7,odeAtolMomentum:1e-7,odeMaxSteps:256};
Object.assign(O.defaults,defaults);
function settings(c){
 const s={};for(const [k,v] of Object.entries(defaults))s[k]=c[k]??v;
 for(const k of ['odeRtol','odeAtolPosition','odeAtolMomentum'])if(!Number.isFinite(s[k])||s[k]<1e-12||s[k]>.01)throw Error('ODEの許容誤差は1e-12〜0.01で指定してください');
 if(!Number.isInteger(s.odeMaxSteps)||s.odeMaxSteps<1||s.odeMaxSteps>4096)throw Error('ODEの試行回数上限は1〜4096です');return s;
}
function reset(){O.odeStats={accepted:0,rejected:0,evaluations:0,failures:0,maxAcceptedError:0,minStep:0,maxStep:0};}
reset();
const A=[[],[1/4],[3/32,9/32],[1932/2197,-7200/2197,7296/2197],[439/216,-8,3680/513,-845/4104],[-8/27,2,-3544/2565,1859/4104,-11/40]];
const B=[16/135,0,6656/12825,28561/56430,-9/50,2/55],D=[1/360,0,-128/4275,-2197/75240,1/50,2/55];
function integrate(initial,interval,c,mode,derivative){
 const control=settings(c),stats=O.odeStats;
 if(initial.length!==6||!initial.every(Number.isFinite)||!Number.isFinite(interval))throw Error('RKF45の初期状態・区間が不正です');
 if(interval===0)return initial.slice();
 const f=derivative||((s)=>O.rhs(s,c,mode)),direction=Math.sign(interval),length=Math.abs(interval);
 let y=initial.slice(),position=0,step=length;
 for(let attempt=0;attempt<control.odeMaxSteps;attempt++){
  step=Math.min(step,length-position);
  if(!(step>0)||position+step===position){stats.failures++;throw Error('RKF45の刻みが丸め精度に達しました');}
  const h=direction*step,k=[];let next=null,error=Infinity,stageError=null;
  try{
   for(let j=0;j<6;j++){
    const s=y.map((v,i)=>v+h*A[j].reduce((sum,a,l)=>sum+a*k[l][i],0));
    stats.evaluations++;const d=f(s);if(!d.every(Number.isFinite))throw Error('RKF45の右辺が非有限値です');k.push(d);
   }
   next=y.map((v,i)=>v+h*B.reduce((sum,b,j)=>sum+b*k[j][i],0));
   error=Math.max(...y.map((v,i)=>Math.abs(h*D.reduce((sum,d,j)=>sum+d*k[j][i],0))/((i<3?control.odeAtolPosition:control.odeAtolMomentum)+control.odeRtol*Math.max(Math.abs(v),Math.abs(next[i])))));
   if(!next.every(Number.isFinite)||!Number.isFinite(error))error=Infinity;
  }catch(e){stageError=e;}
  if(error<=1){
   y=next;position=step===length-position?length:position+step;stats.accepted++;stats.maxAcceptedError=Math.max(stats.maxAcceptedError,error);
   stats.minStep=stats.minStep?Math.min(stats.minStep,step):step;stats.maxStep=Math.max(stats.maxStep,step);if(position===length)return y;
  }else stats.rejected++;
  step*=error===0?5:Math.max(.1,Math.min(error<=1?5:.5,.9*Math.pow(error,-.2)));
  if(stageError&&step<length*1e-14){stats.failures++;throw Error('RKF45の段階評価が成立しません: '+stageError.message);}
 }
 stats.failures++;throw Error('RKF45が試行回数上限に達しました。許容誤差・最大刻み・媒質の定義域を確認してください');
}
// Analytic derivatives of H, including off-shell embedded stages. Never
// substitute p.G^-1.p=1 in the force. Homogeneous media have zero force.
function rhs(s,c,mode){
 if(globalThis.LiteratureMedia?.supported(c.material))return globalThis.LiteratureMedia.rhs(s,c,mode);
 const x=s.slice(0,3),p=s.slice(3),v=O.velocity(x,p,c,mode),m=c.material,g=c.gradient,z=x[2],energy=O.dot(p,v);let force=[0,0,0];
 if(['sphericalSquared','radialSquared','axialSquared','radial','axial'].includes(m)){
  const n2=O.metric(x,c,mode)[0][0];let grad;
  if(m==='sphericalSquared')grad=O.mul(x,-2*g);
  else if(m==='radialSquared')grad=[-2*g*x[0],-2*g*x[1],0];
  else if(m==='axialSquared')grad=[0,0,g];
  else if(m==='radial')grad=O.mul(x,4*g*(c.n+g*O.dot(x,x)));
  else grad=[0,0,2*g*(c.n+g*z)];
  force=O.mul(grad,.5*O.dot(p,p)/(n2*n2));
 }else if(m==='common')force[2]=-g/(1+g*z)*energy;
 else if(m==='quadratic')force[2]=g*z/(1+g*z*z)*energy;
 else if(m==='hyperbolic')force[2]=.5*g/(1+g*z)*energy;
 else if(m==='eng2013'||m==='eng2013Magnetic')force[2]=(c.engStrength??1)*z/(1+(c.engStrength??1)*z*z)*energy;
 else if(m==='axial2013'||m==='axial2013Uniaxial'){
  const b=1+g*Math.sin(z);force[2]=g*Math.cos(z)/b*(m==='axial2013Uniaxial'&&mode===0?energy:p[2]*p[2]/(b*b));
 }else if(m==='heliconical'&&mode===1){
  const a=O.principalAxes(c,z)[2],da=O.mul([-a[1],a[0],0],c.twist);force[2]=-(1/c.no**2-1/c.ne**2)*O.dot(a,p)*O.dot(da,p);
 }else if(m==='shear'){
  const t=(z+1)/2,b=-c.shift*3*t*(1-t),db=1.5*c.shift*z;force[2]=(p[2]-b*(p[0]+.45*p[1]))*db*(p[0]+.45*p[1]);
 }else if(['molded2013','moldedApprox','molded2013Transform'].includes(m))force=[-g*x[0]*v[0]*v[0],-g*x[1]*v[1]*v[1],.2*(1+.2*z)*v[2]*v[2]];
 return [...v,...force];
}
O.rhs=rhs;O.rkf45=integrate;O.odeSettings=settings;O.resetODEStats=reset;
})(globalThis.Optics);
