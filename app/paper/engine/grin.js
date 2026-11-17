/* Exact trajectories for quadratic n², using K=(p²-n²)/2 on the same dispersion shell.
   tau is an auxiliary parameter, not the affine time of H=p²/(2n²).
   Formulae remain valid through z turning points. Boundary searches use the same tau map. */
(function(O){
function polynomialAdvance(s,t,c){
 const x=s.slice(0,3),p=s.slice(3),g=c.gradient;
 if(c.material==='axialSquared')return [x[0]+t*p[0],x[1]+t*p[1],x[2]+t*p[2]+g*t*t/4,p[0],p[1],p[2]+g*t/2];
 const end=x.slice(),q=p.slice(),axes=c.material==='sphericalSquared'?3:2;
 for(let i=0;i<3;i++){
  if(i>=axes||Math.abs(g)<1e-14){end[i]+=t*p[i];continue;}
  const w=Math.sqrt(Math.abs(g)),C=g>0?Math.cos(w*t):Math.cosh(w*t),S=g>0?Math.sin(w*t):Math.sinh(w*t);
  end[i]=x[i]*C+p[i]*S/w;q[i]=p[i]*C-Math.sign(g)*w*x[i]*S;
 }
 return [...end,...q];
}
O.polynomialAdvance=polynomialAdvance;
const previous=O.advance;O.advance=function(s,h,c,mode){
 if(c.solver==='auto'&&['sphericalSquared','radialSquared','axialSquared'].includes(c.material)){
  const n2=O.metric(s.slice(0,3),c,mode)[0][0],out=polynomialAdvance(s,h/n2,c);
  O.metric(out.slice(0,3),c,mode);O.recordStep('closed');return out;
 }
 return previous(s,h,c,mode);
};
})(globalThis.Optics);
