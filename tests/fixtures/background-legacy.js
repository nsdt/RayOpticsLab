/* Previous grid background retained only for the persistent HTTP-cache regression. */
const add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,s)=>a.map(v=>v*s);
function bg(o,d,c){if(d[2]<1e-7)return [25,34,52];let t=(c.backgroundZ-o[2])/d[2];if(t<0)return [25,34,52];let p=add(o,mul(d,t)),x=p[0],y=p[1];if(c.background==='uv')return [128+100*Math.sin(x),128+100*Math.sin(y),150];let checker=((Math.floor(x*2)+Math.floor(y*2))%2+2)%2,base=checker?[225,232,237]:[55,80,100];if(Math.abs(x)<.025)return [244,109,71];if(Math.abs(y)<.025)return [54,199,193];let r=Math.hypot(x-.7,y-.6);if(r<.35&&r>.27)return [251,187,56];return base;}
globalThis.Optics={bg};
