/* 獨立驗收：只讀正式檔案；瀏覽器測試鉤子不寫回網站程式。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/wenbin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.env.NATURE_URL || 'http://127.0.0.1:4174/';
const finalRun = process.env.NATURE_FINAL === '1';
const dist = path.join(__dirname, 'dist');
const evidence = path.resolve(__dirname, '../../work/v2/qa');
const results = [], errors = [], sceneEvidence = [];
fs.mkdirSync(evidence, { recursive:true });
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const read = file => fs.readFileSync(file, 'utf8');
const sourceHashes = Object.fromEntries(['app.js','adaptive.js','engine.js','index.html','style.css'].map(name => [name,sha(fs.readFileSync(path.join(dist,name)))]));
let browserVersion = '', driver = null;
function save() {
  fs.writeFileSync(path.join(evidence,'結果.json'), JSON.stringify({ time:new Date().toISOString(), base, browserVersion, driver, sourceHashes, results, errors, sceneEvidence }, null, 2));
}
async function check(name, action) {
  try { const detail = await action(); results.push({ name, pass:true, detail:detail ?? null }); process.stdout.write(`通過：${name}\n`); }
  catch (error) { results.push({ name, pass:false, error:error.message }); process.stdout.write(`失敗：${name}：${error.message}\n`); }
  save();
}
function between(source, start, end) {
  const a=source.indexOf(start), b=source.indexOf(end,a+start.length);
  assert(a>=0 && b>a, `找不到目前引擎的 ${start} 區段`);
  return source.slice(a,b);
}
async function fileChecks() {
  await check('原版 f0ba0bc 與新版 classic 八檔逐位元組相同', () => {
    const original=path.resolve(__dirname,'..');
    const names=execFileSync('git',['-C',original,'ls-tree','-r','--name-only','f0ba0bc','--','dist'],{encoding:'utf8'}).trim().split(/\r?\n/);
    assert.equal(names.length,8);
    return names.map(name=>{const data=execFileSync('git',['-C',original,'show',`f0ba0bc:${name}`],{maxBuffer:32*1024*1024}); const current=fs.readFileSync(path.join(original,name));const classic=fs.readFileSync(path.join(dist,'classic',name.slice(5)));assert(data.equals(current),`原版已改：${name}`);assert(data.equals(classic),`classic 不一致：${name}`);return {file:name,sha256:sha(data)};});
  });
  await check('十五個 PBR/HDR 素材的 SHA-256、MD5、大小與來源說明相符', () => {
    const folder=path.join(dist,'assets/pbr'), report=read(path.join(__dirname,'素材來源.md'));
    const files=fs.readdirSync(folder).filter(name=>!name.endsWith('.source.json'));
    assert.equal(files.length,15,'目前下載規格為十五原檔；新增素材須一併更新驗收');
    return files.map(name=>{const data=fs.readFileSync(path.join(folder,name)), meta=JSON.parse(read(path.join(folder,`${name}.source.json`)));assert.equal(meta.filename,name);assert.equal(data.length,meta.bytes);assert.equal(sha(data),meta.sha256);assert.equal(crypto.createHash('md5').update(data).digest('hex'),meta.md5);assert(report.includes(name)&&report.includes(meta.sha256),`來源文件漏列 ${name}`);assert(/^https:\/\/dl\.polyhaven\.org\//.test(meta.url));return {file:name,bytes:data.length,sha256:meta.sha256};});
  });
  await check('兩套掃描模型十檔：來源雜湊、glTF 相對引用、幾何與三角數完整', () => {
    const report=read(path.join(__dirname,'素材來源.md')), records=[];
    for(const name of ['tree_stump_01','rock_moss_set_01']){
      const folder=path.join(dist,'assets/models',name),manifest=JSON.parse(read(path.join(folder,'來源清單.json')));
      assert.equal(manifest.files.length,5);
      for(const meta of manifest.files){const bytes=fs.readFileSync(path.join(folder,meta.filename));assert.equal(bytes.length,meta.bytes);assert.equal(sha(bytes),meta.sha256);assert.equal(crypto.createHash('md5').update(bytes).digest('hex'),meta.md5);assert(report.includes(meta.sha256),`來源文件漏列 ${meta.filename}`);}
      const gltf=JSON.parse(read(path.join(folder,manifest.entry)));assert.equal(gltf.asset.version,'2.0');
      const references=[...gltf.buffers,...gltf.images].map(item=>item.uri);assert.equal(references.length,manifest.relativeReferences);
      for(const uri of references){assert(!/^(?:[a-z]+:|\/)/i.test(uri),`非本機相對 URI：${uri}`);const target=path.resolve(folder,decodeURIComponent(uri));assert(target.startsWith(folder+path.sep),`模型 URI 越界：${uri}`);assert(fs.existsSync(target));assert(manifest.files.some(item=>item.filename===uri));}
      for(const buffer of gltf.buffers)assert.equal(fs.statSync(path.join(folder,buffer.uri)).size,buffer.byteLength);
      const triangles=gltf.meshes.reduce((sum,mesh)=>sum+mesh.primitives.reduce((total,p)=>{assert.equal(p.mode??4,4);return total+gltf.accessors[p.indices??p.attributes.POSITION].count/3;},0),0);
      assert.equal(triangles,manifest.triangles);assert.equal(gltf.meshes.length,manifest.meshes);
      records.push({model:name,files:manifest.files.length,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),triangles,references});
    }
    assert.equal(records.reduce((n,m)=>n+m.files,0),10);assert(report.includes('25 個原檔'));
    return records;
  });
  await check('自有文件與程式維持可嚴格解碼的 UTF-8', () => {
    const decoder=new TextDecoder('utf-8',{fatal:true});
    const names=['dist/index.html','dist/app.js','dist/adaptive.js','dist/engine.js','dist/style.css','製作計畫.md','素材來源.md','驗證.cjs'];
    for(const name of names){const text=decoder.decode(fs.readFileSync(path.join(__dirname,name)));assert(!text.includes('\uFFFD'),name);}
    assert(read(path.join(dist,'vendor/THREE-LICENSE.txt')).includes('MIT License'));
    return {checked:names.length,license:'Three.js MIT 授權原文保留'};
  });
  await check('實際地形與移動演算法：四景、碰撞、四邊界、海岸、水平方向及地面高度', () => {
    const source=read(path.join(dist,'engine.js'));
    const functions=between(source,'function pathX','function disposeGroup')+between(source,'  function allowed','  function draw');
    const state={currentScene:'forest',collision:[],camera:{position:{x:0,y:0,z:0}},input:{forward:false,backward:false,left:false,right:false},yaw:0,distance:0,EYE_HEIGHT:1.65,sunlight:{target:{position:{x:0,z:0}}},updateShadow:()=>{}};
    vm.createContext(state);vm.runInContext(functions+'\nthis.testMove=move;this.testAllowed=allowed;this.testGround=terrainHeight;',state);
    const records=[];
    for(const scene of ['forest','ocean','autumn','snow']){
      state.currentScene=scene;state.collision=[];state.yaw=0;
      for(const [key,axis,sign] of [['forward','z',-1],['backward','z',1],['left','x',-1],['right','x',1]]){
        state.camera.position={x:-10,y:2,z:0};state.input={forward:false,backward:false,left:false,right:false,[key]:true};
        state.testMove(.05);const position=state.camera.position;
        assert(Math.abs(position[axis]-((axis==='x'?-10:0)+sign*.1025))<1e-9,`${scene}/${key}`);
        assert.equal(position.y,state.testGround(scene,position.x,position.z)+1.65);
      }
      for(const [x,z,key] of [[-54.99,0,'left'],[54.99,0,'right'],[-10,-54.99,'forward'],[-10,54.99,'backward']]){
        state.camera.position={x,y:2,z};state.input={forward:false,backward:false,left:false,right:false,[key]:true};for(let i=0;i<20;i++)state.testMove(.05);
        assert(state.camera.position.x>=-55&&state.camera.position.x<=55&&state.camera.position.z>=-55&&state.camera.position.z<=55);
      }
      state.collision=[{x:-10,z:0,r:1}];state.camera.position={x:-8.8,y:2,z:0};state.input={forward:false,backward:false,left:true,right:false};for(let i=0;i<100;i++)state.testMove(.05);
      const obstacleDistance=Math.hypot(state.camera.position.x+10,state.camera.position.z);
      assert(obstacleDistance>=1&&obstacleDistance<1.2,'未抵達碰撞圓或穿過碰撞圓');
      records.push({scene,collisionPosition:{...state.camera.position}});
    }
    state.currentScene='ocean';state.collision=[];assert(!state.testAllowed(5,0),'允許走入海面');assert(state.testAllowed(2,0));
    return records;
  });
  await check('低幀率門檻：暖機、兩視窗、先降畫質、持續過慢才 classic、強制與隱藏例外', async () => {
    const {createPerformanceGate}=await import(`data:text/javascript;base64,${Buffer.from(read(path.join(dist,'adaptive.js'))).toString('base64')}`);
    const gate=createPerformanceGate('high');gate.reset(0);
    assert.equal(gate.sample({fps:8,now:3000}),null);
    let now=4000;const feed=fps=>gate.sample({fps,now:now+=1000});
    assert.deepEqual(Array.from({length:6},()=>feed(8)),[null,null,null,null,null,'balanced']);
    assert.equal(gate.sample({fps:8,now:now+2000}),null);now+=4000;
    assert.deepEqual(Array.from({length:6},()=>feed(8)),[null,null,null,null,null,'classic']);
    for(const force of [false,true]){const other=createPerformanceGate('high',force);other.reset(0);for(let i=0;i<10;i++)assert.equal(other.sample({fps:8,now:10000+i*1000,visible:force}),null);}
    return {measuredFlow:'high → balanced → classic',warmupMs:4000};
  });
}
const state = page => page.evaluate(()=>window.__natureV2.getState());
const delta = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
async function ready3D(page) {
  await page.waitForFunction(()=>window.__natureV2&&window.__natureV2.getState().activeMode!=='loading',null,{timeout:90000});
  const s=await state(page);assert.equal(s.activeMode,'3d',s.reason);assert(s.engine.ready);assert(s.engine.drawCalls>0,'沒有真實 drawCalls');return s;
}
async function moveKey(page,key) {
  await page.locator('#stage').focus();const before=(await state(page)).engine.position;
  await page.keyboard.down(key);
  try {await page.waitForFunction(old=>{const p=window.__natureV2.getState().engine?.position;return p&&Math.hypot(p.x-old.x,p.z-old.z)>.02;},before,{timeout:25000});}
  finally {await page.keyboard.up(key);}
  return {before,after:(await state(page)).engine.position};
}
async function classicReady(page) {
  await page.waitForFunction(()=>window.__natureV2?.getState().activeMode==='classic',null,{timeout:90000});
  const frame=page.frameLocator('#classic-frame');await frame.locator('[data-scene="forest"]').waitFor({timeout:20000});
  assert((await page.locator('#classic-frame').getAttribute('src')).includes('classic/index.html'));
  return state(page);
}
function observe(page, label) {page.on('pageerror',error=>errors.push({label,message:error.message}));}
async function desktopChecks(browser) {
  const context=await browser.newContext({viewport:{width:640,height:480}}); const page=await context.newPage();observe(page,'桌面');
  await page.addInitScript(()=>{
    const get=HTMLCanvasElement.prototype.getContext, marked=new WeakSet();
    window.__qaGL={textures:new Set(),buffers:new Set(),programs:new Set()};
    HTMLCanvasElement.prototype.getContext=function(type,...args){const gl=get.call(this,type,...args);if(this.id==='world'&&gl&&type.startsWith('webgl')&&!marked.has(gl)){marked.add(gl);for(const [kind,make,remove] of [['textures','createTexture','deleteTexture'],['buffers','createBuffer','deleteBuffer'],['programs','createProgram','deleteProgram']]){const create=gl[make].bind(gl),drop=gl[remove].bind(gl);gl[make]=(...a)=>{const object=create(...a);if(object)window.__qaGL[kind].add(object);return object;};gl[remove]=object=>{window.__qaGL[kind].delete(object);return drop(object);};}}return gl;};
  });
  try {
    await page.goto(`${base}?mode=3d`);await ready3D(page);
    driver=await page.evaluate(()=>{const g=document.querySelector('#world').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return {version:g.getParameter(g.VERSION),renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)};});save();
    await check('初次自動載入 3D 不儲存版本偏好',async()=>assert.equal(await page.evaluate(()=>localStorage.getItem('nature-v2-mode')),null));
    await check('桌面起始狀態為真 3D，無鍵盤輸入時不自行行走',async()=>{const a=await state(page);await page.waitForTimeout(700);const b=await ready3D(page);assert.equal(delta(a.engine.position,b.engine.position),0);return b;});
    await page.locator('#enter').click();await page.locator('#quality').selectOption('balanced');
    for(const scene of ['forest','ocean','autumn','snow']){
      if(scene!=='forest'){await page.locator('#leave').click();await page.locator(`[data-scene="${scene}"]`).click();await page.waitForFunction(s=>window.__natureV2.getState().scene===s,scene);await page.locator('#enter').click();}
      await check(`${scene}：前後左右皆有實際相機位移且跟隨地面`,async()=>{const motions={};for(const key of ['w','s','a','d']){const moved=await moveKey(page,key);assert(delta(moved.before,moved.after)>.02);assert(Number.isFinite(moved.after.y));motions[key]=moved;}sceneEvidence.push({scene,state:await ready3D(page),motions});return motions;});
      await check(`${scene}：暫停與重新啟動，按鍵放開後停止`,async()=>{await page.locator('#walk-play').click();assert.equal((await state(page)).running,false);const before=(await state(page)).engine.position;await page.locator('#stage').focus();await page.keyboard.down('w');await page.waitForTimeout(600);await page.keyboard.up('w');assert.equal(delta(before,(await state(page)).engine.position),0);await page.locator('#walk-play').click();await moveKey(page,'w');await page.waitForTimeout(400);const stop=(await state(page)).engine.position;await page.waitForTimeout(600);assert.equal(delta(stop,(await state(page)).engine.position),0);});
      if(scene==='ocean')await check('海岸實際連續行走超過八十公尺，抵達邊界仍不穿出地形',async()=>{
        await page.locator('#recenter').click();const initial=(await state(page)).engine;
        await page.mouse.move(500,200);await page.mouse.down();await page.mouse.move(500+initial.rotation.yaw/.0022,200,{steps:8});await page.mouse.up();
        assert(Math.abs((await state(page)).engine.rotation.yaw)<.003);
        await page.locator('#stage').focus();await page.keyboard.down('w');
        try{await page.waitForFunction(()=>window.__natureV2.getState().engine.position.z< -54.95,null,{timeout:60000});await page.waitForTimeout(600);}
        finally{await page.keyboard.up('w');}
        const reached=(await ready3D(page)).engine;assert(reached.distance>80);assert(reached.position.z>=-55&&reached.position.z< -54.95);assert(delta(initial.position,reached.position)>80);
        return {start:initial.position,end:reached.position,distance:reached.distance};
      });
      await page.locator('#recenter').click();await page.locator('#walk-play').click();
      await page.screenshot({path:path.join(evidence,`${scene}-3d.png`)});
      await page.locator('#walk-play').click();
    }
    await check('四景確實不同：每景引擎狀態與幾何數各自存在',()=>{assert.equal(new Set(sceneEvidence.map(x=>x.scene)).size,4);assert(new Set(sceneEvidence.map(x=>x.state.engine.triangles)).size>=3);return sceneEvidence.map(x=>({scene:x.scene,drawCalls:x.state.engine.drawCalls,triangles:x.state.engine.triangles}));});
    await check('滑鼠拖曳會轉頭，blur 會清除行走輸入',async()=>{const before=(await state(page)).engine.rotation;await page.mouse.move(410,200);await page.mouse.down();await page.mouse.move(500,230,{steps:4});await page.mouse.up();const after=(await state(page)).engine.rotation;assert(Math.abs(after.yaw-before.yaw)>.05);await page.locator('#stage').focus();await page.keyboard.down('w');await page.waitForTimeout(200);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));const position=(await state(page)).engine.position;await page.waitForTimeout(800);await page.keyboard.up('w');assert.equal(delta(position,(await state(page)).engine.position),0);return {before,after};});
    await check('Space 暫停與繼續；Esc 返回後不再處於漫步狀態',async()=>{await page.locator('#stage').focus();await page.keyboard.press('Space');assert.equal((await state(page)).running,false);await page.keyboard.press('Space');assert.equal((await state(page)).running,true);await page.keyboard.press('Escape');assert.equal((await state(page)).exploring,false);});
    await check('桌面全螢幕進入／返回，stage 與控制列不殘留',async()=>{await page.locator('#expand').click();await page.waitForFunction(()=>Boolean(document.fullscreenElement),null,{timeout:5000});assert.equal((await state(page)).exploring,true);await page.locator('#leave').click();await page.waitForFunction(()=>!document.fullscreenElement&&!window.__natureV2.getState().exploring);assert.equal(await page.locator('#walking-controls').isVisible(),false);});
    await check('指南、來源與呼吸對話框可開關；呼吸結束清除動畫',async()=>{for(const [open,dialog] of [['guide-inline','guide-dialog'],['source-open','source-dialog'],['breath-open','breath-dialog']]){await page.locator(`#${open}`).click();assert(await page.locator(`#${dialog}`).isVisible());if(dialog==='breath-dialog'){await page.locator('#breath-start').click();await page.waitForTimeout(150);assert(await page.locator('.breath-visual').evaluate(el=>el.classList.contains('running')));}await page.locator(`#${dialog} .close-dialog`).click();await page.locator(`#${dialog}`).waitFor({state:'hidden'});}await page.waitForFunction(()=>!document.querySelector('.breath-visual').classList.contains('running'));assert.equal(await page.locator('.breath-visual').evaluate(el=>el.classList.contains('running')),false);});
    await check('音景依點擊啟用，暫停／靜音控制正常',async()=>{await page.locator('#sound').click();assert.equal(await page.locator('#sound').getAttribute('aria-pressed'),'true');await page.locator('#sound').click();assert.equal(await page.locator('#sound').getAttribute('aria-pressed'),'false');return '僅檢查 AudioContext 與控制狀態；未做人耳音質驗收';});
    await check('重複切景後 WebGL 材質資源不持續增加',async()=>{const cycle=async()=>{for(const scene of ['forest','ocean','autumn','snow','forest']){await page.locator(`[data-scene="${scene}"]`).click();await page.waitForFunction(s=>window.__natureV2.getState().scene===s,scene);await ready3D(page);}return page.evaluate(()=>Object.fromEntries(Object.entries(window.__qaGL).map(([key,set])=>[key,set.size])));};const first=await cycle(),second=await cycle();for(const key of ['textures','buffers','programs'])assert(second[key]<=first[key],`${key} ${first[key]} → ${second[key]}`);return {first,second};});
    await check('手動選擇保存 classic／3d，載入真實原版 iframe 並可返回 3D',async()=>{await page.locator('#choose-static').click();const fallback=await classicReady(page);assert.equal(fallback.engine,null);assert.equal(await page.evaluate(()=>localStorage.getItem('nature-v2-mode')),'classic');await page.locator('#try-three').click();assert.equal(await page.evaluate(()=>localStorage.getItem('nature-v2-mode')),'3d');return ready3D(page);});
    await check('pagehide／pageshow persisted 事件後可以重新建立 3D',async()=>{await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});const result=await ready3D(page);return {state:result,method:'獨立重播瀏覽器生命週期事件；不宣稱已覆蓋所有真實 bfcache 條件'};});
    await check('執行中 WebGL context lost 必須返回原版',async()=>{await page.evaluate(()=>document.querySelector('#world').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());return classicReady(page);});
  } finally {await context.close();}
}
async function mobileChecks(browser,width) {
  const context=await browser.newContext({viewport:{width,height:width===390?844:740},isMobile:true,hasTouch:true,deviceScaleFactor:1});const page=await context.newPage();observe(page,`手機${width}`);
  try {
    await page.goto(`${base}?mode=3d`);await ready3D(page);
    await check(`${width}px 手機：版面無橫向溢出，指南入口可點`,async()=>{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await page.evaluate(()=>navigator.maxTouchPoints>0&&matchMedia('(pointer: coarse)').matches));await page.locator('#guide-inline').tap();assert(await page.locator('#guide-dialog').isVisible());await page.locator('#guide-dialog .close-dialog').tap();});
    await page.locator('#enter').tap();await page.locator('#quality').selectOption('balanced');
    const cdp=await context.newCDPSession(page);
    const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
    await check(`${width}px 手機：四個方向鍵皆用真實 touch 輸入行走`,async()=>{const records={};for(const move of ['forward','backward','left','right']){const button=page.locator(`[data-move="${move}"]`),box=await button.boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width,JSON.stringify({move,box,width,state:await state(page),pointer:await page.evaluate(()=>({coarse:matchMedia('(pointer: coarse)').matches,touch:navigator.maxTouchPoints}))}));const before=(await state(page)).engine.position;await touch('touchStart',[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]);try{await page.waitForFunction(old=>{const p=window.__natureV2.getState().engine?.position;return p&&Math.hypot(p.x-old.x,p.z-old.z)>.02;},before,{timeout:25000});}finally{await touch('touchEnd',[]);}const after=(await state(page)).engine.position;assert(delta(before,after)>.02);records[move]={before,after,box};}return records;});
    await check(`${width}px 手機：拖曳轉頭；lostpointercapture 與 blur 不會卡住走路`,async()=>{const before=(await state(page)).engine.rotation;await touch('touchStart',[{x:width*.68,y:230,id:2}]);await touch('touchMove',[{x:width*.92,y:260,id:2}]);await touch('touchEnd',[]);assert(Math.abs((await state(page)).engine.rotation.yaw-before.yaw)>.03);const box=await page.locator('[data-move="forward"]').boundingBox();await touch('touchStart',[{x:box.x+22,y:box.y+22,id:3}]);await page.evaluate(()=>document.querySelector('[data-move="forward"]').dispatchEvent(new PointerEvent('lostpointercapture')));const lost=(await state(page)).engine.position;await page.waitForTimeout(800);assert.equal(delta(lost,(await state(page)).engine.position),0);await touch('touchEnd',[]);await touch('touchStart',[{x:box.x+22,y:box.y+22,id:4}]);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));const blurred=(await state(page)).engine.position;await page.waitForTimeout(800);assert.equal(delta(blurred,(await state(page)).engine.position),0);await touch('touchEnd',[]);});
    await page.locator('#walk-play').tap();await page.screenshot({path:path.join(evidence,`手機-${width}-3d.png`)});await page.locator('#leave').tap();assert.equal((await state(page)).exploring,false);
    /* 部分 Chrome/Playwright 全頁截圖會重置觸控模擬；只在觸控流程結束後拍全頁。 */
    await page.screenshot({path:path.join(evidence,`手機-${width}-首頁.png`),fullPage:true});
  } finally {await context.close();}
}
async function fallbackChecks(browser) {
  let context=await browser.newContext();let page=await context.newPage();observe(page,'無WebGL');
  try {
    await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:get.call(this,type,...args);};});
    await check('WebGL2 缺失時載入真實 classic iframe',async()=>{await page.goto(`${base}?mode=3d`);const fallback=await classicReady(page);assert.equal(fallback.engine,null);assert(fallback.reason.includes('WebGL2'));await page.screenshot({path:path.join(evidence,'WebGL-缺失降級.png')});return fallback;});
  } finally {await context.close();}
  context=await browser.newContext({viewport:{width:320,height:240},isMobile:true,hasTouch:true});page=await context.newPage();observe(page,'自動FPS降級');
  try {
    await page.addInitScript(()=>localStorage.setItem('nature-v2-mode','3d'));
    await page.addInitScript(()=>{const raf=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window),pending=new Map();let index=0;window.requestAnimationFrame=callback=>{const id=++index,timer=setTimeout(()=>{const native=raf(time=>{pending.delete(id);callback(time);});pending.set(id,{native});},120);pending.set(id,{timer});return id;};window.cancelAnimationFrame=id=>{const item=pending.get(id);if(!item)return;if(item.timer)clearTimeout(item.timer);if(item.native)cancel(item.native);pending.delete(id);};});
    await check('手機實測低FPS：high → balanced → 真實 classic，保留手動偏好',async()=>{await page.goto(base);const first=await ready3D(page);assert.equal(first.quality,'high');await page.locator('#enter').tap();await page.waitForFunction(()=>window.__natureV2.getState().quality==='balanced',null,{timeout:90000});const reduced=await state(page);assert.equal(reduced.activeMode,'3d');const classic=await classicReady(page);assert(classic.reason.includes('渲染較慢'));assert.equal(await page.evaluate(()=>localStorage.getItem('nature-v2-mode')),'3d');return {initial:first.quality,reduced:{quality:reduced.quality,fps:reduced.stats?.fps},final:classic.activeMode,method:'測試用 rAF 120ms 排程限制；門檻讀取引擎實際 FPS，未注入 FPS 數字'};});
  } finally {await context.close();}
  context=await browser.newContext({viewport:{width:320,height:240}});page=await context.newPage();observe(page,'初始化ContextLost');
  try {
    await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;let done=false;HTMLCanvasElement.prototype.getContext=function(type,...args){const gl=get.call(this,type,...args);if(this.id==='world'&&type==='webgl2'&&gl&&!done){done=true;setTimeout(()=>gl.getExtension('WEBGL_lose_context')?.loseContext(),50);}return gl;};});
    await check('初始化材質期間 context lost 也會降級',async()=>{await page.goto(`${base}?mode=3d`);return classicReady(page);});
  } finally {await context.close();}
}
async function loadingRace(browser,lastChoice) {
  const context=await browser.newContext({viewport:{width:640,height:480}}),page=await context.newPage();observe(page,`載入競態${lastChoice}`);
  let release;const barrier=new Promise(resolve=>{release=resolve;});
  const states=[];
  try{
    await page.route('**/assets/pbr/ground.jpg',async route=>{await barrier;await route.continue();});
    const requested=page.waitForRequest('**/assets/pbr/ground.jpg',{timeout:30000});
    await page.goto(`${base}?mode=3d`,{waitUntil:'domcontentloaded'});await requested;
    await page.waitForFunction(()=>window.__natureV2?.getState().activeMode==='loading');
    const record=async step=>states.push({step,state:await state(page),saved:await page.evaluate(()=>localStorage.getItem('nature-v2-mode'))});
    await record('貼圖載入暫停');await page.locator('#choose-static').click();await record('選擇靜態版');await page.locator('#try-three').click();await record('再次選3D');
    if(lastChoice==='classic'){await page.locator('#choose-static').click();await record('最後再次選靜態版');}
    release();
    if(lastChoice==='3d'){await page.waitForFunction(()=>window.__natureV2?.getState().activeMode==='3d',null,{timeout:90000});await ready3D(page);}
    else{await page.waitForLoadState('networkidle',{timeout:30000});await page.waitForTimeout(700);await classicReady(page);}
    await record('載入結束');assert.equal((await state(page)).activeMode,lastChoice);assert.equal(await page.evaluate(()=>localStorage.getItem('nature-v2-mode')),lastChoice);
    return states;
  } finally {release();await context.close();}
}
function report() {
  const failed=results.filter(item=>!item.pass),passed=results.length-failed.length;
  const rows=results.map(item=>'| '+item.name+' | '+(item.pass?'通過':'失敗')+' | '+(item.pass?'':item.error.replace(/[\r\n|]/g,' '))+' |').join('\n');
  const content=[
    '# 自然漫遊新版獨立驗收'+(finalRun?'':'（功能初驗，尚待最終版本）'),'',
    '[事實] 本次檢查於 '+new Date().toISOString()+'（UTC）執行，'+passed+' 項通過，'+failed.length+' 項失敗。狀態、位移、來源雜湊與逐項結果保存於本次工作區 work/v2/qa/結果.json。','',
    '[事實] 使用 Chrome '+browserVersion+' 與獨立 BrowserContext；圖形驅動為 '+(driver?.renderer||'尚未取得')+'。真正 3D 檢查使用 ?mode=3d，並斷言 activeMode=3d、engine.ready=true、drawCalls>0；靜態備援畫面不算 3D 通過。','',
    '## 可重跑方式','',
    '本機前提：本次工作區根為 new-chat，原版 Git 根為 outputs，且仍保留 f0ba0bc；驗證腳本使用已安裝的 Playwright 套件。先執行 node work/v2/preview.cjs，再執行 node outputs/nature-v2/驗證.cjs。最終定版驗收可在 PowerShell 設定 $env:NATURE_FINAL = \'1\' 後執行；此時另檢查審查前後來源雜湊一致。','',
    'NATURE_URL 可指定同一新版的既有預覽根網址；PLAYWRIGHT_PATH 可指定既有 Playwright 位置。預設嘗試硬體 GPU；NATURE_SOFTWARE=1 才使用測試專用 SwiftShader。這些指令以本次工作區配置為前提，單獨複製新版 Git 根不包含工作區的原版 repo 與 preview.cjs。','',
    '## 驗收結果','',
    '| 項目 | 結果 | 問題 |','|---|---|---|',rows,'',
    '## 修正與再驗證','',
    '- 初始化期間 context lost 不再被 loading 狀態忽略；未就緒引擎不可當成 3D 成功。',
    '- 手機與桌面都從細緻畫質開始，以實測 FPS 先降到流暢畫質，再視持續過慢情形使用原版。',
    '- 載入中手動切換版本，必須以最後一次選擇決定畫面與本機偏好；兩種順序都有回歸檢查。',
    '- 初次自動載入不保存偏好；自動 FPS 降級保留原有手動選擇。',
    '- 某些 Chrome／Playwright 全頁截圖會把觸控模擬重設為無觸控；全頁截圖移到真實觸控事件流程之後。',
    '- 呼吸對話框關閉的清理事件非同步；測試等待 close 處理完成再斷言。','',
    '## 證據與限制','',
    '- 原版八個 dist 檔案已與 f0ba0bc 及新版 classic 副本逐位元組核對；素材共二十五原檔，包含十五個 PBR/HDR 檔與十個模型相關檔。來源 SHA-256、MD5、大小、glTF 相對引用與二進位幾何均核對。',
    '- 四景截圖、手機版面與降級畫面保存在 work/v2/qa；來源版本雜湊記錄於結果.json。重複切景會核對 WebGL texture、buffer、program 的活躍數量，避免持續累積。',
    '- 邊界、碰撞、速度方向與地面高度用目前 engine.js 的實際函式檢查；瀏覽器另外驗證四景相機位移、海岸長距離行走與世界邊界。未宣稱逐一碰撞所有景物。',
    '- 低 FPS 情境對動畫排程加入 120ms 延遲；門檻仍讀取引擎量測幀率，沒有把固定 FPS 數字當裝置實測。',
    '- 手機為 320／390px Chrome 尺寸及觸控模擬，使用 CDP 真正輸入事件；並非真人手機的 GPU、觸控硬體、發熱、耗電或長時間穩定度驗收。',
    '- 音景只驗證啟用與靜音控制、AudioContext 使用狀態；未做人耳音質驗收。',
    '- pagehide／pageshow persisted 檢查為重播事件路徑；不能代表所有真實 bfcache 條件。',
    '- 寫實程度仍有 CGI、葉卡、光照及幾何上限；功能通過無法證明已達實拍品質。若美感判斷有爭議，應由使用者或外部真人給第二意見。','',
    '## 審查結果','',
    '| 嚴重度 | 數量 | 狀態 |','|---|---|---|',
    '| CRITICAL | 0 | 通過 |',
    '| HIGH | '+failed.length+' | '+(failed.length?'待修正或釐清':'通過')+' |',
    '| MEDIUM | 0 | 無新增確認問題 |',
    '| LOW | 0 | 無新增確認問題 |','',
    '結論：'+(failed.length?'尚未通過；需修正或釐清失敗項目並重驗。':finalRun?'本次可重跑功能與來源檢查通過；真實手機及實拍品質未經本測試證明。':'功能初驗通過；仍須對最終固定版本重跑。'),''
  ].join('\n');
  const file=path.join(__dirname,'驗收報告.md'),backups=path.resolve(evidence,'../backups');
  fs.mkdirSync(backups,{recursive:true});
  if(fs.existsSync(file))fs.copyFileSync(file,path.join(backups,'驗收報告.md.bak-'+Date.now()));
  fs.writeFileSync(file,content);save();
}
(async()=>{
  await fileChecks();
  const args=process.env.NATURE_SOFTWARE==='1'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[];
  const browser=await chromium.launch({channel:'chrome',headless:true,args});browserVersion=browser.version();
  try{await desktopChecks(browser);await mobileChecks(browser,390);await mobileChecks(browser,320);await fallbackChecks(browser);await check('載入中 classic → 重試3D：最後選擇為真3D且保存偏好',()=>loadingRace(browser,'3d'));await check('載入中 classic → 重試3D → classic：最後選擇與保存皆為classic',()=>loadingRace(browser,'classic'));await check('所有受測頁面沒有未處理的 JavaScript 錯誤',()=>assert.deepEqual(errors,[]));if(finalRun)await check('最終驗收前後來源版本雜湊一致',()=>{for(const [name,hash] of Object.entries(sourceHashes))assert.equal(sha(fs.readFileSync(path.join(dist,name))),hash,name);return sourceHashes;});}
  catch(error){results.push({name:'瀏覽器驗收流程完整執行',pass:false,error:error.message});}
  finally{await browser.close();report();process.exitCode=results.some(item=>!item.pass)?1:0;}
})().catch(error=>{process.stderr.write(`${error.stack}\n`);report();process.exitCode=1;});
