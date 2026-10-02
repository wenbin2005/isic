/* 大氣、水面、光束、粒子與材質修補著色器。
   1. 霧：改為「距離＋高度衰減」的指數霧，並朝太陽方向帶入暖色散射；遠山半透於霧中，地平線不再露出地板盡頭。
   2. 天空：程序化漸層、雲層、太陽光暈；地平線收斂到霧色，與遠景無縫銜接，並作為環境光貼圖來源。
   3. three.js 於 sRGB 轉換「之後」才混霧，fogColor 也是輸出空間值；天空的霧化因此同樣在顯示空間完成。 */
import * as THREE from './vendor/three.module.js';

THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogWorldPosition;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogWorldPosition = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );\n#endif';
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	uniform vec3 fogSunDirection;
	uniform vec3 fogSunColor;
	uniform vec3 fogHeight;
	varying float vFogDepth;
	varying vec3 vFogWorldPosition;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
// fogHeight：x 霧底高度、y 高度衰減（0 為均勻霧）、z 太陽方向散射強度；未掛上時三者為 0，退化成一般指數霧。
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
	vec3 fogRay = vFogWorldPosition - cameraPosition;
	float fogDistance = max( length( fogRay ), 1e-4 );
	#ifdef FOG_EXP2
		float fogSpan = fogDistance;
		float fogDensity0 = fogDensity;
	#else
		float fogSpan = max( fogDistance - fogNear, 0.0 );
		float fogDensity0 = 1.0 / max( fogFar, 1.0 );
	#endif
	float fogRise = fogHeight.y * fogRay.y * fogSpan / fogDistance;
	float fogLayer = abs( fogRise ) > 1e-3 ? ( 1.0 - exp( - fogRise ) ) / fogRise : 1.0 - 0.5 * fogRise;
	float fogFactor = 1.0 - exp( - fogDensity0 * fogSpan * exp( - fogHeight.y * ( cameraPosition.y - fogHeight.x ) ) * fogLayer );
	float fogSun = pow( max( dot( fogRay / fogDistance, fogSunDirection ), 0.0 ), 6.0 ) * fogHeight.z;
	gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( fogColor, fogSunColor, clamp( fogSun, 0.0, 1.0 ) ), fogFactor );
#endif`;

/** 每個探索器一組共用 uniform；所有材質在編譯時掛上同一批物件，切景只改數值。 */
export function createAtmosphere() {
  return {
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    sunLight: { value: new THREE.Color() },      // 線性：直射光色×強度
    skyZenith: { value: new THREE.Color() },     // 以下為 sRGB 顯示值
    skyHorizon: { value: new THREE.Color() },
    skyGlow: { value: new THREE.Color() },
    skyGround: { value: new THREE.Color() },
    hazeColor: { value: new THREE.Color() },
    fogSunColor: { value: new THREE.Color() },
    fogHeight: { value: new THREE.Vector3() },
    cloudCover: { value: 0.3 },
    time: { value: 0 },
    wind: { value: 1 },
    envPass: { value: 0 },
    pointScale: { value: 400 },
  };
}

export function addAtmosphere(shader, atmo) {
  shader.uniforms.fogSunDirection = atmo.sunDirection;
  shader.uniforms.fogSunColor = atmo.fogSunColor;
  shader.uniforms.fogHeight = atmo.fogHeight;
}

function skyUniforms(atmo) {
  return {
    sunDirection: atmo.sunDirection, skyZenith: atmo.skyZenith, skyHorizon: atmo.skyHorizon, skyGlow: atmo.skyGlow,
    skyHaze: atmo.hazeColor, skyHazeSun: atmo.fogSunColor, skyHeight: atmo.fogHeight, skyCloud: atmo.cloudCover, skyTime: atmo.time,
  };
}
function fogUniforms(atmo) {
  return { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), fogSunDirection: atmo.sunDirection, fogSunColor: atmo.fogSunColor, fogHeight: atmo.fogHeight };
}

export const NOISE_GLSL = `
float nHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float nValue( vec2 p ) {
	vec2 i = floor( p ), f = fract( p ), u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( nHash( i ), nHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( nHash( i + vec2( 0.0, 1.0 ) ), nHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float nFbm( vec2 p ) { float v = 0.0, a = 0.5; for ( int i = 0; i < 5; i ++ ) { v += a * nValue( p ); p = mat2( 1.6, 1.2, - 1.2, 1.6 ) * p + 7.31; a *= 0.5; } return v / 0.97; }
float nFbm3( vec2 p ) { float v = 0.0, a = 0.5; for ( int i = 0; i < 3; i ++ ) { v += a * nValue( p ); p = mat2( 1.6, 1.2, - 1.2, 1.6 ) * p + 7.31; a *= 0.5; } return v / 0.875; }
`;

// 與 engine.js 的 pathX／creekX／shoreline／terrainHeight('ocean') 相同的公式。
const TRAIL_GLSL = `
float trailX( float z ) { return sin( z * 0.075 ) * 3.1 + sin( z * 0.041 ) * 1.5; }
float creekX( float z ) { return trailX( z ) + 8.4 + sin( z * 0.13 ) * 0.8; }
float oceanShore( float z ) { return 5.2 + sin( z * 0.095 ) * 1.3; }
float oceanBed( vec2 p ) { float edge = oceanShore( p.y ); return 0.74 + ( edge - p.x ) * 0.033 - max( 0.0, p.x - edge + 6.0 ) * 0.125 + sin( p.y * 0.065 ) * sin( p.x * 0.07 ) * 0.1; }
`;

const SKY_GLSL = `
uniform vec3 sunDirection;
uniform vec3 skyZenith;
uniform vec3 skyHorizon;
uniform vec3 skyGlow;
uniform vec3 skyHaze;
uniform vec3 skyHazeSun;
uniform vec3 skyHeight;
uniform float skyCloud;
uniform float skyTime;
vec3 skyToLinear( vec3 c ) { return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) ); }
vec3 skyHazeColor( vec3 d ) {
	float mu = max( dot( d, sunDirection ), 0.0 );
	return mix( skyHaze, skyHazeSun, clamp( pow( mu, 6.0 ) * skyHeight.z, 0.0, 1.0 ) );
}
vec4 skyClouds( vec3 d ) {
	vec2 p = d.xz / ( max( d.y, 0.0 ) + 0.1 ) * 0.62 + vec2( skyTime * 0.006, skyTime * 0.0025 );
	float base = nFbm( p * 1.15 );
	float cover = smoothstep( 1.0 - skyCloud - 0.1, 1.0 - skyCloud + 0.3, base );
	float toward = nFbm( p * 1.15 + sunDirection.xz * 0.12 );
	float light = clamp( 0.62 + ( base - toward ) * 4.5, 0.0, 1.0 );
	vec3 shade = mix( skyHorizon, skyZenith, 0.45 ) * 0.72 + 0.1;
	vec3 lit = mix( vec3( 0.98, 0.97, 0.95 ), skyGlow, 0.3 );
	vec3 color = mix( shade, lit, light ) + skyGlow * pow( max( dot( d, sunDirection ), 0.0 ), 10.0 ) * 0.5;
	return vec4( color, cover * smoothstep( 0.0, 0.14, d.y ) );
}
vec3 skyColor( vec3 d, float disk, float cloudy ) {
	float h = max( d.y, 0.0 );
	float mu = max( dot( d, sunDirection ), 0.0 );
	vec3 color = mix( skyHorizon, skyZenith, pow( h, 0.5 ) );
	color += skyGlow * ( 0.14 * pow( mu, 4.0 ) + 0.3 * pow( mu, 32.0 ) + 0.55 * pow( mu, 420.0 ) );
	if ( cloudy > 0.0 ) {
		vec4 cloud = skyClouds( d );
		color = mix( color, cloud.rgb, cloud.a * cloudy );
		disk *= 1.0 - cloud.a;
	}
	color += vec3( 1.0, 0.97, 0.9 ) * smoothstep( 0.99985, 0.99994, mu ) * disk;
	return mix( color, skyHazeColor( d ), exp( - h * 9.0 ) );
}
`;

/** 天空穹頂：深度固定在遠平面，永遠包住相機；envPass=1 時輸出線性值供環境光貼圖使用。 */
export function skyMaterial(atmo) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false,
    uniforms: { ...skyUniforms(atmo), skyGround: atmo.skyGround, envPass: atmo.envPass },
    vertexShader: `varying vec3 vSkyDirection;
void main() {
	vSkyDirection = position;
	vec4 clip = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
	gl_Position = vec4( clip.xy, clip.w * 0.9999995, clip.w );
}`,
    fragmentShader: `varying vec3 vSkyDirection;
uniform vec3 skyGround;
uniform float envPass;
${NOISE_GLSL}
${SKY_GLSL}
void main() {
	vec3 d = normalize( vSkyDirection );
	vec3 color;
	if ( envPass > 0.5 ) {
		color = d.y >= 0.0 ? skyColor( d, 0.0, 0.7 ) : mix( skyHazeColor( d ), skyGround, smoothstep( 0.0, - 0.22, d.y ) );
		color = skyToLinear( color );
	} else {
		color = d.y >= 0.0 ? skyColor( d, 1.0, 1.0 ) : skyHazeColor( d );
		color += ( nHash( gl_FragCoord.xy ) - 0.5 ) / 255.0;
	}
	gl_FragColor = vec4( color, 1.0 );
}`,
  });
}

/** 林間溪水：依水深半透明，反射天空與兩岸樹影，順流的細紋與日光閃點。 */
export function creekMaterial(atmo, { shallow, deep, bank }) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: { ...fogUniforms(atmo), ...skyUniforms(atmo), sunLight: atmo.sunLight, shallowColor: { value: new THREE.Color(shallow) }, deepColor: { value: new THREE.Color(deep) }, bankColor: { value: new THREE.Color(bank) } },
    vertexShader: `attribute float depth;
varying vec3 vWorld;
varying float vDepth;
#include <fog_pars_vertex>
void main() {
	vec4 world = modelMatrix * vec4( position, 1.0 );
	vWorld = world.xyz; vDepth = depth;
	vec4 mvPosition = viewMatrix * world;
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}`,
    fragmentShader: `uniform vec3 sunLight;
uniform vec3 shallowColor;
uniform vec3 deepColor;
uniform vec3 bankColor;
varying vec3 vWorld;
varying float vDepth;
${NOISE_GLSL}
${SKY_GLSL}
#include <fog_pars_fragment>
void main() {
	if ( vDepth < - 0.005 ) discard;
	vec2 flow = vec2( vWorld.x * 1.6, ( vWorld.z - skyTime * 0.55 ) * 0.9 );
	vec2 fine = vec2( vWorld.x * 3.1 + 4.0, ( vWorld.z - skyTime * 0.85 ) * 2.3 );
	float e = 0.06;
	float h = nFbm3( flow ), f = nValue( fine );
	vec3 n = normalize( vec3( ( h - nFbm3( flow + vec2( e, 0.0 ) ) ) * 2.0 + ( f - nValue( fine + vec2( e, 0.0 ) ) ) * 0.9, 1.0,
		( h - nFbm3( flow + vec2( 0.0, e ) ) ) * 2.0 + ( f - nValue( fine + vec2( 0.0, e ) ) ) * 0.9 ) );
	vec3 V = normalize( cameraPosition - vWorld );
	float fresnel = 0.02 + 0.98 * pow( 1.0 - max( dot( V, n ), 0.0 ), 5.0 );
	vec3 R = reflect( - V, n );
	vec3 sky = skyToLinear( skyColor( normalize( vec3( R.x, max( R.y, 0.02 ), R.z ) ), 0.0, 0.6 ) );
	vec3 reflection = mix( bankColor, sky, smoothstep( 0.03, 0.4, R.y ) );
	float deep = smoothstep( 0.02, 0.3, vDepth );
	vec3 color = mix( mix( shallowColor, deepColor, deep ), reflection, fresnel );
	color += sunLight * ( pow( max( dot( R, sunDirection ), 0.0 ), 260.0 ) * 4.0 + pow( max( dot( R, sunDirection ), 0.0 ), 40.0 ) * 0.12 );
	float alpha = smoothstep( - 0.005, 0.06, vDepth ) * clamp( mix( 0.5, 0.9, deep ) + fresnel * 0.6, 0.0, 1.0 );
	gl_FragColor = vec4( color, alpha );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,
  });
}

const OCEAN_GLSL = `
const float OCEAN_LEVEL = -0.17;
const vec4 OCEAN_WAVES[ 4 ] = vec4[ 4 ]( vec4( - 0.96, - 0.28, 17.0, 0.21 ), vec4( - 0.99, 0.12, 29.0, 0.16 ), vec4( - 0.82, 0.57, 9.5, 0.075 ), vec4( - 0.62, - 0.78, 5.6, 0.035 ) );
float oceanPhase( vec4 w, vec2 p, out float k ) { k = 6.2831853 / w.z; return k * ( dot( w.xy, p ) - sqrt( 9.8 / k ) * 0.62 * skyTime ); }
vec3 oceanDisplace( vec2 p, float fade ) {
	vec3 o = vec3( 0.0 );
	for ( int i = 0; i < 4; i ++ ) {
		vec4 w = OCEAN_WAVES[ i ]; float k; float f = oceanPhase( w, p, k ); float a = w.w * fade;
		o.xz += 0.55 / ( k * w.w * 4.0 ) * a * w.xy * cos( f );
		o.y += a * sin( f );
	}
	return o;
}
vec3 oceanNormal( vec2 p, float fade ) {
	vec3 n = vec3( 0.0, 1.0, 0.0 );
	for ( int i = 0; i < 4; i ++ ) {
		vec4 w = OCEAN_WAVES[ i ]; float k; float f = oceanPhase( w, p, k ); float a = w.w * fade;
		n.xz -= w.xy * k * a * cos( f );
		n.y -= 0.55 / ( 4.0 * w.w ) * a * sin( f );
	}
	return normalize( n );
}
float oceanFade( vec2 p ) {
	float depth = max( OCEAN_LEVEL - oceanBed( p ), 0.0 );
	return smoothstep( 0.05, 2.2, depth ) * ( 1.0 - smoothstep( 160.0, 520.0, length( p - cameraPosition.xz ) ) );
}
`;

/** 大西洋：Gerstner 湧浪、淺灘透出沙色、天空與夕照反射、碎浪與沖刷泡沫。 */
export function oceanMaterial(atmo, { shallow, deep, foam }) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: true, fog: true,
    uniforms: { ...fogUniforms(atmo), ...skyUniforms(atmo), sunLight: atmo.sunLight, shallowColor: { value: new THREE.Color(shallow) }, deepColor: { value: new THREE.Color(deep) }, foamColor: { value: new THREE.Color(foam) } },
    vertexShader: `uniform float skyTime;
varying vec3 vWorld;
varying vec2 vBase;
varying float vCrest;
${TRAIL_GLSL}
${OCEAN_GLSL}
#include <fog_pars_vertex>
void main() {
	vec4 world = modelMatrix * vec4( position, 1.0 );
	vec2 p = world.xz;
	vec3 offset = oceanDisplace( p, oceanFade( p ) );
	world.xyz += offset;
	vBase = p; vCrest = offset.y; vWorld = world.xyz;
	vec4 mvPosition = viewMatrix * world;
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}`,
    fragmentShader: `uniform vec3 sunLight;
uniform vec3 shallowColor;
uniform vec3 deepColor;
uniform vec3 foamColor;
varying vec3 vWorld;
varying vec2 vBase;
varying float vCrest;
${NOISE_GLSL}
${SKY_GLSL}
${TRAIL_GLSL}
${OCEAN_GLSL}
#include <fog_pars_fragment>
vec2 oceanRipples( vec2 p ) {
	vec2 slope = vec2( 0.0 );
	for ( int i = 0; i < 6; i ++ ) {
		float fi = float( i ), angle = - 2.6 + fi * 0.95 + sin( fi * 3.7 ) * 0.4;
		vec2 dir = vec2( cos( angle ), sin( angle ) );
		float k = 6.2831853 / ( 0.55 + fi * 0.38 );
		slope += dir * k * ( 0.006 + fi * 0.002 ) * cos( k * dot( dir, p ) - sqrt( 9.8 * k ) * skyTime + fi * 1.7 );
	}
	return slope;
}
void main() {
	vec2 p = vWorld.xz;
	float dist = length( cameraPosition - vWorld );
	vec3 V = ( cameraPosition - vWorld ) / dist;
	vec2 slope = oceanRipples( vBase ) / ( 1.0 + dist * 0.035 );
	vec3 n = normalize( oceanNormal( vBase, oceanFade( vBase ) ) + vec3( - slope.x, 0.0, - slope.y ) );
	float depth = max( vWorld.y - oceanBed( p ), 0.0 );
	float fresnel = 0.02 + 0.98 * pow( 1.0 - max( dot( n, V ), 0.0 ), 5.0 );
	vec3 R = reflect( - V, n );
	R.y = abs( R.y );
	vec3 sky = skyToLinear( skyColor( normalize( R ), 0.0, 0.6 ) );
	vec3 body = mix( shallowColor, deepColor, smoothstep( 0.0, 4.5, depth ) );
	float back = pow( max( dot( - V, sunDirection ), 0.0 ), 2.0 );
	body += shallowColor * max( vCrest, 0.0 ) * ( 0.25 + back * 0.9 );
	vec3 color = mix( body, sky, fresnel );
	float sunDot = max( dot( R, sunDirection ), 0.0 );
	color += sunLight * ( pow( sunDot, 900.0 ) * 40.0 + pow( sunDot, 90.0 ) * 0.5 );
	float shoreDistance = p.x - oceanShore( p.y );
	float grain = nFbm3( p * vec2( 1.7, 0.9 ) + vec2( skyTime * 0.06, 0.0 ) );
	float swash = 0.16 + 0.12 * sin( skyTime * 0.5 + p.y * 0.035 );
	float foamShore = ( 1.0 - smoothstep( swash * 0.4, swash, depth ) ) * smoothstep( 0.3, 0.62, grain + 0.18 );
	float wave = fract( shoreDistance / 11.0 + skyTime * 0.085 );
	float foamBreak = smoothstep( 0.0, 0.035, wave ) * ( 1.0 - smoothstep( 0.035, 0.17, wave ) ) * smoothstep( 0.35, 1.3, depth ) * ( 1.0 - smoothstep( 2.4, 4.6, depth ) ) * smoothstep( 0.42, 0.68, grain );
	float foamCrest = smoothstep( 0.22, 0.36, vCrest ) * smoothstep( 0.55, 0.8, nValue( p * 0.7 + skyTime * 0.1 ) ) * ( 1.0 - smoothstep( 60.0, 220.0, dist ) );
	float foam = clamp( foamShore + foamBreak + foamCrest, 0.0, 1.0 );
	vec3 ambient = mix( skyToLinear( skyHorizon ), skyToLinear( skyZenith ), 0.4 ) * 0.75;
	color = mix( color, foamColor * ( ambient + sunLight * max( dot( n, sunDirection ), 0.0 ) * 0.22 ), foam * 0.92 );
	float alpha = clamp( smoothstep( 0.0, 0.75, depth ) + fresnel * 0.6 + foam, 0.0, 1.0 );
	gl_FragColor = vec4( color, alpha );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,
  });
}

/** 林間光束：沿太陽方向延伸、以光束軸為中心朝向相機的加亮薄片；迎光時最明顯。 */
export function shaftMaterial(atmo, color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, side: THREE.DoubleSide,
    uniforms: { sunDirection: atmo.sunDirection, shaftTime: atmo.time, shaftColor: { value: new THREE.Color(color) } },
    vertexShader: `attribute vec2 corner;
attribute vec3 base;
attribute vec3 shaft;
uniform vec3 sunDirection;
varying vec2 vCorner;
varying float vSeed;
varying float vFade;
varying vec3 vWorld;
void main() {
	vec3 p = base + sunDirection * corner.y * shaft.y;
	vec3 toCamera = cameraPosition - p;
	float dist = length( toCamera );
	vec3 side = cross( sunDirection, toCamera / max( dist, 1e-3 ) );
	float spread = length( side );
	side = spread > 1e-4 ? side / spread : vec3( 1.0, 0.0, 0.0 );
	p += side * corner.x * shaft.x;
	vCorner = corner; vSeed = shaft.z; vWorld = p;
	vFade = smoothstep( 0.08, 0.4, spread ) * smoothstep( 2.0, 8.0, dist ) * ( 1.0 - smoothstep( 48.0, 80.0, dist ) );
	gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
}`,
    fragmentShader: `uniform vec3 sunDirection;
uniform vec3 shaftColor;
uniform float shaftTime;
varying vec2 vCorner;
varying float vSeed;
varying float vFade;
varying vec3 vWorld;
void main() {
	float across = exp( - vCorner.x * vCorner.x * 3.4 );
	float along = smoothstep( 0.0, 0.14, vCorner.y ) * ( 1.0 - smoothstep( 0.5, 1.0, vCorner.y ) );
	float flicker = 0.72 + 0.28 * sin( shaftTime * 0.55 + vSeed * 6.283 ) * sin( shaftTime * 0.21 + vSeed * 3.1 );
	float phase = 0.25 + 0.75 * pow( max( dot( normalize( vWorld - cameraPosition ), sunDirection ), 0.0 ), 2.0 );
	gl_FragColor = vec4( shaftColor * across * along * flicker * phase * vFade, 1.0 );
}`,
  });
}

const PARTICLE_VERTEX_HEAD = `attribute vec4 seed;
uniform float particleTime;
uniform float pointScale;
uniform vec3 boxSize;
uniform float particleSize;
vec3 particleWorld( vec3 drift ) {
	vec3 rel = mod( seed.xyz * boxSize + drift - cameraPosition, boxSize ) - boxSize * 0.5;
	return cameraPosition + rel;
}`;

/** 陽光中的浮塵：環繞相機的粒子場，GPU 端計算漂移，迎光時閃爍。 */
export function moteMaterial(atmo, { color, box, size }) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    uniforms: { particleTime: atmo.time, pointScale: atmo.pointScale, sunDirection: atmo.sunDirection, boxSize: { value: new THREE.Vector3(...box) }, particleSize: { value: size }, moteColor: { value: new THREE.Color(color) } },
    vertexShader: `${PARTICLE_VERTEX_HEAD}
uniform vec3 sunDirection;
varying float vAlpha;
void main() {
	vec3 drift = vec3( sin( particleTime * 0.13 + seed.w * 6.28 ), sin( particleTime * 0.21 + seed.w * 4.0 ) * 0.6, cos( particleTime * 0.11 + seed.w * 5.0 ) ) * 0.9;
	vec3 world = particleWorld( drift );
	vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	float dist = - mvPosition.z;
	gl_PointSize = clamp( particleSize * ( 0.6 + seed.w ) * pointScale / max( dist, 0.1 ), 1.0, 5.0 );
	float twinkle = 0.45 + 0.55 * sin( particleTime * ( 1.1 + seed.w * 2.3 ) + seed.w * 40.0 );
	float phase = pow( max( dot( normalize( world - cameraPosition ), sunDirection ), 0.0 ), 3.0 );
	vAlpha = twinkle * ( 0.18 + 0.82 * phase ) * smoothstep( 0.6, 2.2, dist ) * ( 1.0 - smoothstep( boxSize.x * 0.32, boxSize.x * 0.5, length( world.xz - cameraPosition.xz ) ) );
}`,
    fragmentShader: `uniform vec3 moteColor;
varying float vAlpha;
void main() {
	float r = length( gl_PointCoord - 0.5 );
	if ( r > 0.5 ) discard;
	gl_FragColor = vec4( moteColor * smoothstep( 0.5, 0.0, r ) * vAlpha, 1.0 );
}`,
  });
}

/** 飄雪：環繞相機、無 CPU 更新的落雪粒子場。 */
export function snowMaterial(atmo, { color, box, size }) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: { ...fogUniforms(atmo), particleTime: atmo.time, pointScale: atmo.pointScale, boxSize: { value: new THREE.Vector3(...box) }, particleSize: { value: size }, particleColor: { value: new THREE.Color(color) } },
    vertexShader: `${PARTICLE_VERTEX_HEAD}
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
	vec3 drift = vec3( sin( particleTime * ( 0.45 + seed.w * 0.5 ) + seed.w * 31.0 ) * 0.7, - particleTime * ( 0.5 + seed.w * 0.65 ), cos( particleTime * ( 0.37 + seed.w * 0.4 ) + seed.w * 17.0 ) * 0.7 );
	vec3 world = particleWorld( drift );
	vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	float dist = - mvPosition.z;
	gl_PointSize = clamp( particleSize * ( 0.5 + seed.w * 0.9 ) * pointScale / max( dist, 0.1 ), 1.0, 26.0 );
	vAlpha = smoothstep( 0.25, 1.1, dist ) * ( 1.0 - smoothstep( boxSize.x * 0.36, boxSize.x * 0.5, length( world.xz - cameraPosition.xz ) ) );
	#include <fog_vertex>
}`,
    fragmentShader: `uniform vec3 particleColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
	float r = length( gl_PointCoord - 0.5 );
	if ( r > 0.5 ) discard;
	gl_FragColor = vec4( particleColor, smoothstep( 0.5, 0.1, r ) * vAlpha * 0.92 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,
  });
}

/** 秋葉飄落：每片葉子各自翻轉、旋轉與左右擺盪。 */
export function fallingLeafMaterial(atmo, { box, size }) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: { ...fogUniforms(atmo), particleTime: atmo.time, pointScale: atmo.pointScale, boxSize: { value: new THREE.Vector3(...box) }, particleSize: { value: size } },
    vertexShader: `${PARTICLE_VERTEX_HEAD}
attribute vec3 leafColor;
varying vec3 vColor;
varying float vSpin;
#include <fog_pars_vertex>
void main() {
	float t = particleTime;
	vec3 drift = vec3( sin( t * ( 0.6 + seed.w * 0.5 ) + seed.w * 21.0 ) * 1.6 + t * 0.35, - t * ( 0.7 + seed.w * 0.6 ), cos( t * ( 0.5 + seed.w * 0.4 ) + seed.w * 13.0 ) * 1.2 );
	vec3 world = particleWorld( drift );
	vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	gl_PointSize = clamp( particleSize * ( 0.7 + seed.w * 0.6 ) * pointScale / max( - mvPosition.z, 0.1 ), 1.0, 40.0 );
	vColor = leafColor; vSpin = t * ( 1.3 + seed.w * 2.2 ) + seed.w * 40.0;
	#include <fog_vertex>
}`,
    fragmentShader: `varying vec3 vColor;
varying float vSpin;
#include <fog_pars_fragment>
void main() {
	vec2 p = gl_PointCoord - 0.5;
	float c = cos( vSpin ), s = sin( vSpin ), turn = cos( vSpin * 0.7 );
	p = mat2( c, - s, s, c ) * p;
	p.x /= max( abs( turn ), 0.22 );
	if ( length( p * vec2( 1.0, 1.85 ) ) > 0.46 ) discard;
	gl_FragColor = vec4( vColor * ( 0.7 + 0.3 * turn ), 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,
  });
}

/** 海鷗：盤旋路徑與振翅全在頂點著色器計算。 */
export function birdMaterial(atmo, color) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: true,
    uniforms: { ...fogUniforms(atmo), particleTime: atmo.time, birdColor: { value: new THREE.Color(color) } },
    vertexShader: `attribute vec4 flight;
attribute vec2 flightExtra;
uniform float particleTime;
#include <fog_pars_vertex>
void main() {
	float t = particleTime;
	float angle = flightExtra.y + t * flight.w / flight.z;
	float flap = sin( t * 7.5 + flightExtra.y * 9.0 ) * smoothstep( - 0.2, 0.6, sin( t * 0.5 + flightExtra.y * 3.0 ) );
	vec3 local = position;
	local.y += abs( local.x ) * flap * 0.55;
	vec3 center = vec3( flight.x, flightExtra.x + sin( t * 0.31 + flightExtra.y ) * 2.5, flight.y );
	vec3 radial = vec3( cos( angle ), 0.0, sin( angle ) );
	vec3 forward = normalize( vec3( - sin( angle ), 0.0, cos( angle ) ) * sign( flight.w ) );
	vec3 right = normalize( cross( forward, vec3( 0.0, 1.0, 0.0 ) ) );
	vec3 up = cross( right, forward );
	float bank = 0.35 * sign( flight.w );
	vec3 world = center + radial * flight.z + ( right * cos( bank ) + up * sin( bank ) ) * local.x + ( up * cos( bank ) - right * sin( bank ) ) * local.y + forward * local.z;
	vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}`,
    fragmentShader: `uniform vec3 birdColor;
#include <fog_pars_fragment>
void main() {
	gl_FragColor = vec4( birdColor, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,
  });
}

/* ───── 內建材質修補（onBeforeCompile）───── */

const KEEP_BACKFACE_NORMAL = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');

/** 植被：微風擺動、背面不翻轉法線；crown=true 時改用樹冠球面法線，並加上逆光透葉。 */
export function patchFoliage(shader, atmo, { weight, crown = false, upNormal = false, translucency = 0 }) {
  addAtmosphere(shader, atmo);
  Object.assign(shader.uniforms, { windTime: atmo.time, windStrength: atmo.wind, sunDirection: atmo.sunDirection, sunLight: atmo.sunLight });
  let vertex = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float windTime;\nuniform float windStrength;\n${crown ? 'attribute vec3 crownNormal;' : ''}`);
  if (crown) vertex = vertex.replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalMatrix * crownNormal;');
  else if (upNormal) vertex = vertex.replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalMatrix * vec3( 0.0, 1.0, 0.0 );');
  shader.vertexShader = vertex.replace('#include <project_vertex>', `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelMatrix * mvPosition;
{
	float windWeight = ${weight};
	float gust = 0.55 + 0.45 * sin( windTime * 0.37 + mvPosition.x * 0.021 + mvPosition.z * 0.017 );
	float sway = sin( windTime * 1.6 + mvPosition.x * 0.23 + mvPosition.z * 0.19 ) + 0.45 * sin( windTime * 2.7 + mvPosition.x * 0.61 - mvPosition.z * 0.47 );
	mvPosition.xyz += vec3( 0.8, 0.15, 0.5 ) * sway * gust * windWeight * windStrength;
}
mvPosition = viewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
  let fragment = shader.fragmentShader.replace('#include <normal_fragment_begin>', KEEP_BACKFACE_NORMAL);
  if (translucency) {
    fragment = fragment.replace('#include <common>', '#include <common>\nuniform vec3 sunDirection;\nuniform vec3 sunLight;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
	vec3 sunView = normalize( ( viewMatrix * vec4( sunDirection, 0.0 ) ).xyz );
	float behind = pow( max( dot( - geometryViewDir, sunView ), 0.0 ), 3.0 );
	reflectedLight.directDiffuse += diffuseColor.rgb * sunLight * behind * ${translucency.toFixed(3)};
}`);
  }
  shader.fragmentShader = fragment;
}

/** 樹皮：根部壓暗；森林苔蘚、雪林迎風面積雪。 */
export function patchBark(shader, atmo) {
  addAtmosphere(shader, atmo);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vBarkHeight;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBarkHeight = position.y + 0.5;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying float vBarkHeight;\n${NOISE_GLSL}`).replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= mix( 0.45, 1.0, smoothstep( 0.0, 0.08, vBarkHeight ) );
#ifdef SCENE_FOREST
	float barkMoss = 1.0 - smoothstep( 0.02, 0.14 + nValue( vec2( vBarkHeight * 60.0, gl_FrontFacing ? 1.0 : 2.0 ) ) * 0.1, vBarkHeight );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.11, 0.16, 0.05 ), barkMoss * 0.7 );
#endif`);
}

/** 岩石：頂面依場景覆上苔蘚、地衣或積雪；海岸潮線以下較深較濕。 */
export function patchRock(shader, atmo) {
  addAtmosphere(shader, atmo);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRockNormal;\nvarying vec3 vRockWorld;').replace('#include <begin_vertex>', `#include <begin_vertex>
{
	mat4 rockMatrix = modelMatrix;
	#ifdef USE_INSTANCING
		rockMatrix = modelMatrix * instanceMatrix;
	#endif
	vRockNormal = normalize( mat3( rockMatrix ) * normal );
	vRockWorld = ( rockMatrix * vec4( transformed, 1.0 ) ).xyz;
}`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vRockNormal;\nvarying vec3 vRockWorld;\n${NOISE_GLSL}`).replace('#include <color_fragment>', `#include <color_fragment>
float rockTop = smoothstep( 0.2, 0.7, normalize( vRockNormal ).y + ( nValue( vRockWorld.xz * 2.6 + vRockWorld.y ) - 0.5 ) * 0.45 );
#ifdef SCENE_FOREST
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.1, 0.16, 0.04 ) * ( 0.8 + nValue( vRockWorld.xz * 9.0 ) * 0.5 ), rockTop * 0.82 );
#endif
#ifdef SCENE_AUTUMN
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.24, 0.2, 0.07 ), rockTop * 0.55 );
#endif
#ifdef SCENE_SNOW
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.93, 0.95, 0.97 ), smoothstep( 0.15, 0.45, rockTop ) );
#endif
#ifdef SCENE_OCEAN
	diffuseColor.rgb *= mix( 0.55, 1.0, smoothstep( 0.05, 0.55, vRockWorld.y ) );
#endif`);
}

/** 地表：去重複的大尺度色彩變化、軟邊步道、溪岸濕土與苔蘚、濕沙、遠山林相與雪線、雪地閃光。 */
export function patchGround(shader, atmo, pathMap) {
  addAtmosphere(shader, atmo);
  Object.assign(shader.uniforms, { pathMap: { value: pathMap }, sunDirection: atmo.sunDirection });
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vGroundWorld;\nuniform sampler2D pathMap;\nuniform vec3 sunDirection;\n${NOISE_GLSL}\n${TRAIL_GLSL}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
vec2 gp = vGroundWorld.xz;
float groundMacro = nFbm3( gp * 0.045 );
float groundFine = nValue( gp * 0.6 );
float groundWet = 0.0;
float inWorld = 1.0 - smoothstep( 58.0, 64.0, abs( gp.y ) );
vec3 groundNormalW = normalize( ( vec4( vNormal, 0.0 ) * viewMatrix ).xyz );
#ifdef USE_MAP
	vec3 groundAlt = texture2D( map, vMapUv * 0.37 + vec2( 0.31, 0.67 ) ).rgb * diffuse;
	#ifdef USE_COLOR
		groundAlt *= vColor.rgb;
	#endif
	diffuseColor.rgb = mix( diffuseColor.rgb, groundAlt, smoothstep( 0.3, 0.7, nValue( gp * 0.07 + 11.0 ) ) * 0.55 );
#endif
diffuseColor.rgb *= mix( 0.8, 1.16, groundMacro );
#ifdef USE_AOMAP
	vec4 groundDetail = texture2D( aoMap, vAoMapUv );
#else
	vec4 groundDetail = vec4( 1.0, 0.0, 0.0, 1.0 );
#endif
float trailHalf = 1.64 + sin( gp.y * 0.17 ) * 0.17;
float groundTrail = ( 1.0 - smoothstep( trailHalf * 0.5, trailHalf * 1.05, abs( gp.x - trailX( gp.y ) ) + ( nValue( gp * 0.85 ) - 0.5 ) * 0.7 ) ) * inWorld;
#ifdef SCENE_FOREST
	float creekBank = ( 1.0 - smoothstep( 1.0, 2.7, abs( gp.x - creekX( gp.y ) ) + ( groundFine - 0.5 ) * 0.6 ) ) * inWorld;
	float groundMoss = clamp( smoothstep( 0.6, 0.82, nFbm3( gp * 0.12 + 3.1 ) ) + groundDetail.g * 0.8 + creekBank * 0.3, 0.0, 1.0 ) * ( 1.0 - groundTrail );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.15, 0.2, 0.07 ) * ( 0.75 + groundFine * 0.5 ), groundMoss * 0.5 );
	diffuseColor.rgb *= mix( 1.0, 0.56, creekBank );
	groundWet = creekBank * 0.85;
#endif
#ifdef SCENE_AUTUMN
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.25, 0.95, 0.62 ), smoothstep( 0.35, 0.75, groundMacro ) * 0.5 + groundDetail.b * 0.35 );
#endif
#ifdef SCENE_SNOW
	diffuseColor.rgb *= mix( vec3( 0.93, 0.95, 1.0 ), vec3( 1.0 ), groundFine );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.84, 0.87, 0.92 ) * ( 0.88 + 0.24 * nValue( gp * 3.2 ) ), groundTrail * 0.85 );
#endif
#ifdef SCENE_OCEAN
	float wetSand = smoothstep( oceanShore( gp.y ) - 3.2, oceanShore( gp.y ) + 0.6, gp.x + ( groundFine - 0.5 ) * 0.8 );
	diffuseColor.rgb *= mix( 1.0, 0.64, wetSand );
	groundWet = wetSand;
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.84, 0.9, 0.66 ), smoothstep( - 8.0, - 30.0, gp.x ) * smoothstep( 0.4, 0.7, groundMacro ) * 0.6 );
#endif
#if defined( SCENE_FOREST ) || defined( SCENE_AUTUMN )
	vec3 groundDirt = texture2D( pathMap, gp * 0.19 ).rgb * TRAIL_TINT * ( 0.85 + groundFine * 0.3 );
	diffuseColor.rgb = mix( diffuseColor.rgb, groundDirt, groundTrail * 0.9 );
#endif
float farRing = max( abs( gp.x ), abs( gp.y ) ) - 64.0;
float farMask = smoothstep( 0.0, 130.0, farRing );
#ifdef SCENE_OCEAN
	farMask = max( smoothstep( - 40.0, - 140.0, gp.x ), smoothstep( 3.0, 16.0, vGroundWorld.y ) ) * farMask;
#endif
vec3 groundCanopy = mix( CANOPY_DARK, CANOPY_LIGHT, nFbm3( gp * 0.018 ) ) * ( 0.74 + 0.5 * nValue( gp * 0.11 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, groundCanopy, farMask * CANOPY_AMOUNT );
float groundSteep = 1.0 - smoothstep( 0.62, 0.86, groundNormalW.y );
diffuseColor.rgb = mix( diffuseColor.rgb, ROCK_TINT * ( 0.8 + 0.4 * groundFine ), clamp( groundSteep * farMask + smoothstep( 130.0, 240.0, vGroundWorld.y ) * 0.7, 0.0, 1.0 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.9, 0.93, 0.96 ), smoothstep( PEAK_SNOW, PEAK_SNOW + 50.0, vGroundWorld.y + ( groundMacro - 0.5 ) * 70.0 ) * ( 1.0 - groundSteep * 0.55 ) );`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.45, groundWet );')
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#ifdef SCENE_SNOW
{
	vec3 sparkleView = normalize( cameraPosition - vGroundWorld );
	vec2 cell = floor( vGroundWorld.xz * 26.0 );
	vec3 facet = normalize( vec3( nHash( cell + 3.1 ) - 0.5, 0.55, nHash( cell + 7.7 ) - 0.5 ) );
	float glint = step( 0.8, nHash( cell ) ) * pow( max( dot( reflect( - sunDirection, facet ), sparkleView ), 0.0 ), 90.0 );
	float near = 1.0 - smoothstep( 6.0, 26.0, length( cameraPosition - vGroundWorld ) );
	reflectedLight.directSpecular += vec3( 1.0, 0.97, 0.92 ) * glint * near * 9.0 * clamp( dot( reflectedLight.directDiffuse, vec3( 0.6 ) ), 0.0, 1.0 );
}
#endif`);
}
