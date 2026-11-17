// Descriptions for the free-scene material controls. The paper catalog keeps
// its own descriptions because its settings and historical engine are frozen.
(function (root) {
  'use strict';
  const notes = {
    isotropic: '均質等方性：G=n²I。内部は直線、界面で屈折。',
    radial: 'Spherical gradient（球対称）：n(x)=n₀+g(x²+y²+z²)。全光線をHamiltonian RKF45で追跡。',
    axial: 'Axial：n(z)=n₀+gz。本実装ではSchur積分表示を数値求積。閉形式の追加は未実装。',
    uniaxial: '一軸結晶：εの主値=(nₒ²,nₒ²,nₑ²)。ordinaryとextraordinaryの二次分散を個別に追跡。',
    biaxial:
      '二軸結晶：εの主値=(nₓ²,nᵧ²,n𝓏²)。Maxwell Fresnel分散の二根を使用。±は固有値の大小順で、ordinary/extraordinaryという名称は適用しません。',
    axial2013:
      '2013 axial：G=diag(1,1,(1+g sin z)²)。閉形式を使用可能。現在の単一光学計量の像で、一般的な二軸誘電体の両偏光像ではありません。',
    eng2013:
      '2013 ENG：G=diag(z²+1,−(z²+1),0.25(z²+1))。原典の閉形式は特殊な横傾きのみ。一般視野は数値積分。実在誘電体の偏光・透過率を再現するモデルではありません。',
    moldedApprox:
      '2013 molded small-slope：近似方程式(25)–(28)の解を評価。元の光線方程式の厳密解ではありません。|dx/dz|または|dy/dz|>0.25で追跡を停止します（経験的ガードで精度保証ではありません）。立方体・小さな視野角でfull ODEと比較してください。',
    molded2013:
      '2013 molded：G=diag(n²−gx²,n²−gy²,(1+0.2z)²)。原典のsmall-slope近似式ではなく、近似前の計量の光線を数値積分します。応力から誘電率を復元するモデルは含みません。',
    common:
      'G=ηG₀、η=(1+gz)⁻²。固定した傾斜軸。閉形式の条件が成立する区間で解析評価、turning近傍はRKF45。',
    quadratic: 'G=ηG₀、η=1+gz²。g≥0かつΠ<1で閉形式、条件外は数値求積またはRKF45。',
    hyperbolic:
      'εₒ<0、εₑ>0、η=1+gz。extraordinaryのみ。条件を満たす場合に線形scale閉形式、条件外は数値求積またはRKF45。単射性の正定値定理は適用外。',
    heliconical:
      '光学軸がzに沿って回転。横運動量p⊥=0でのみ螺旋閉形式。その他の画素はSchur積分を数値求積。立方体・正面平行投影でκ=0を試せます。',
    shear:
      'X=x+f(z), Y=y+0.45f(z), f=−Δx(3t²−2t³), t=(z+1)/2。ε=μ=G⁻¹の変換媒質。閉形式評価。立方体のz=±1面は外部屈折率1のとき整合。',
  };
  Object.assign(notes, {
    eng2013Magnetic:
      '2013 ENGの磁気異方性による実現：a=1+z²、ε=diag(−a/2,a/2,−2a)、μ=diag(1/2,1/2,2)。Gₑ=diag(a,−a,a/4)が元のENG計量と一致します。ordinaryは非伝播。元論文の材料に磁気異方性を仮定した別の構成で、特殊な横運動量で閉形式、一般光線は数値求積またはODE。',
    molded2013Transform:
      '2013 moldedの変換媒質による実現：ε=μ=√det(G) G⁻¹。元のmolded計量Gで軌道をRKF45積分し、座標変換で偏光を輸送します。二偏光は同じ光線を進みます。通常の成形ガラスの誘電率と同一ではなく、small-slope近似も使いません。',
    axial2013Uniaxial:
      '2013 axialの一軸実現：b(z)=1+g sin z、ε=diag(b²,b²,1)、μ=1、光学軸z固定。Gₑ=diag(1,1,b²)は元のaxial計量、Gₒ=b²Iは追加したordinary。eは閉形式、oはSchur数値求積またはRKF45。原典だけから分配率を得たものではなく、この誘電率の仮定で表面分配を計算します。',
    sphericalSquared:
      'n²=n₀²−g(x²+y²+z²)。n₀=√2、g=1、半径1の球、外部n=1が標準Luneburgレンズ。三次元の楕円軌道を補助パラメータで閉形式評価。形状全域でn²>0が必要です。',
    radialSquared:
      'Radial gradient（円柱対称）：ρ²=x²+y²、n²=n₀²−gρ²。Marchand (1978) §5.3、式(5.34)の特殊なradial gradient。g>0では横座標が三角関数、g<0では双曲線関数で表されます。補助パラメータではzが直線的に変化しますが、三次元の光線全体は曲線です。近軸近似は使いません。',
    axialSquared:
      'n²=n₀²+gz。補助パラメータに対する位置は二次式、運動量は一次式。zの折り返しを含む軌道を閉形式評価。',
  });
  root.MaterialNotes = notes;
})(globalThis);
