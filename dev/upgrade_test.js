// Browser-independent regression checks for the v0.12 upstream/custom merge.
// Canvas metrics are deliberately approximate: this checks planning, not pixels.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const ctx = { measureText: s => ({width: [...s].length * 32, actualBoundingBoxAscent: 24, actualBoundingBoxDescent: 8}) };
const sandbox = { console, Intl, Float32Array, Uint8ClampedArray, window: {}, document: {createElement: () => ({getContext: () => ctx})} };
vm.createContext(sandbox);
for (const file of fs.readdirSync(path.join(root, 'src')).sort().filter(f => f.endsWith('.js') && !f.startsWith('12_'))) {
  vm.runInContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), sandbox, {filename: file});
}
const J = sandbox.window.J;
const arr = x => JSON.parse(JSON.stringify(x));
J.segLocale = () => 'zh-Hans';
for (const text of ['我们一起看着天空里的星星', '月光落在你的眼睛里', '你说「我们一起」走过漫长的夜', '他说（你好吗）我微笑']) {
  const chunks = J.chunkText(text);
  assert.equal(chunks.join(''), text);
  assert(chunks.every(c => !/[「『（“]$/.test(c)), text + ': dangling opener');
  assert(chunks.every(c => !/^[」』）”]/.test(c)), text + ': dangling closer');
  if (chunks.length > 1) assert([...chunks.at(-1)].filter(c => !J.isPunct(c)).length > 1);
}
assert.deepEqual(arr(J.chunkText('我们一起看着天空里的星星')), ['我们一起看着', '天空里的星星']);
J.segLocale = () => 'en';
assert.deepEqual(arr(J.chunkText('exactly! I know,')), ['exactly!', 'I know,']);
assert.equal(J.joinWords(J.chunkText('never-ending')), 'never-ending');
for (const text of ['Hello “bright world” again', 'A (quiet night) here']) {
 const chunks = J.chunkText(text); assert.equal(chunks.join('').replace(/\s/g,''),text.replace(/\s/g,''));
 assert(chunks.every(c => !/[“(]$/.test(c)));
}
assert.equal(J.defaultProject().extra2, false);
assert.equal(J.setOn({}, 'extra2'), false);
let count = 0;
for (const group of J.GROUP_KEYS) for (const key of J.order(group)) {
 const def = J.registry(group)[key]; if (!def.x2) continue; count++;
 assert.equal(J.randomOk({}, group, key), false, key);
 const on = {extra2:true,extra:true,wa:true,horror:true,typo:true,kinetic:true};
 assert.equal(J.randomOk(on, group, key), true, key);
 if (def.set !== 'extra2') assert.equal(J.randomOk({...on,[def.set]:false},group,key),false,key);
}
assert(count > 300, 'expected hundreds of registered v0.12 parts');
for (const aspect of ['16:9','9:16']) for (const seed of [1,7,42]) {
 const p = Object.assign(J.defaultProject(),{aspect,seed,lyrics:'Hello world again\n我们一起看星星'});
 const random = J.plan(p,null);
 for (const cut of random.cuts) for (const [group, field] of [['layout','layout'],['enter','enter'],['exit','exit'],['hold','hold'],['bg','bg'],['cam','cam'],['treat','treat'],['trans','trans']]) {
  if (cut[field]) assert(!J.registry(group)[cut[field]]?.x2, 'default random plan selected x2 '+cut[field]);
 }
}
const project = J.defaultProject();
project.lyrics = '我们一起看星星\n夜晚的风轻轻吹'; project.lang='zh-Hans';
project.timeline = {duration: 8, lines:[{start:1,end:4,text:'我们一起看星星'},{start:4,end:7,text:'夜晚的风轻轻吹'}]};
project.musicResponse = {mode:'instrumental'};
const plan = J.plan(project, {beats:[],energy:new Float32Array(400),energyRate:50,onset:new Float32Array(400),onsetRate:50});
assert.deepEqual(arr(plan.lines.map(l => [l.start,l.end])), [[1,4],[4,7]]);
assert.equal(plan.duration,8);
assert.equal(typeof J.presentationPlan, 'function');
assert.equal(J.presentationPlan(plan).duration, 8);
assert.equal(plan.musicOnsetRate,50);
assert.equal(plan.musicOnset.length,400);
const x2 = J.order('layout').find(k => J.registry('layout')[k].x2 && J.registry('layout')[k].set === 'extra2');
project.overrides = {0:{layout:x2,single:true}};
assert(J.plan(project,null).cuts.some(c => c.line===0 && c.layout===x2), 'explicit selection must bypass random gating');
console.log(`upgrade regression OK: Chinese/quotes/Latin, ${count} x2 parts, source timing, onset, explicit overrides`);
// Exercise the real analyzer return contract consumed by instrumental planning.
(async () => {
 const sr = 8000, samples = new Float32Array(sr * 2);
 for (let i = 0; i < samples.length; i++) samples[i] = i % 4000 < 600 ? Math.sin(i * 0.4) * 0.7 : 0;
 sandbox.window.AudioContext = class {
  async decodeAudioData() { return {sampleRate:sr,length:samples.length,numberOfChannels:1,duration:2,getChannelData:() => samples}; }
  close() {}
 };
 const audio = await J.analyzeAudio({name:'pulse.wav',arrayBuffer:async () => new ArrayBuffer(0)});
 assert.equal(audio.onsetRate,50); assert.equal(audio.onset.length,100);
 assert([...audio.onset].every(x => Number.isFinite(x) && x >= 0 && x <= 1));
 assert([...audio.onset].some(x => x > 0));
 console.log('real analyzeAudio normalized onset contract OK');
})().catch(err => {console.error(err);process.exitCode=1;});
