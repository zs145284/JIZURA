/* Source lyric identity and timing, shared by every layout. No display-time text matching by character alone. */
(() => {
'use strict';
const compact = text => [...String(text || '')].map((ch, i) => ({ch, i})).filter(g => !/\s/.test(g.ch));
J.lyricRanges = (source, texts) => {
  const src = compact(source); let cursor = 0;
  return texts.map(text => {
    const chars = compact(text), indices = []; let at = -1;
    for (let i = cursor; i <= src.length - chars.length && chars.length; i++) {
      if (chars.every((g, k) => g.ch.toLocaleLowerCase() === src[i + k].ch.toLocaleLowerCase())) { at = i; break; }
    }
    if (at >= 0) { for (let i = 0; i < chars.length; i++) indices.push(src[at + i].i); cursor = at + chars.length; }
    return {text: String(text), indices};
  });
};
J.lyricTokens = (text, words) => J.lyricRanges(text, words.map(w => w.text)).map((r, i) => ({...words[i], indices: r.indices}));
J.lyricUnitRanges = (cut, units) => {
  const ranges = J.lyricRanges(cut.text, units);
  return ranges.map(r => {
    const indices = r.indices.map(i => cut.lyricIndices?.[i]).filter(i => i != null);
    const words = (cut.lyricTokens || []).filter(w => w.indices.some(i => indices.includes(i)) && w.end > w.start);
    return {...r, indices, start: words.length ? Math.min(...words.map(w => w.start)) : null, end: words.length ? Math.max(...words.map(w => w.end)) : null};
  });
};
// Render-only time view: source lines, audio, credits and instrumental bounds stay immutable.
const presentationViews = new WeakMap();
J.presentationPlan = plan => {
  if (plan.presentationApplied || !plan.cuts.some(c => c.lyricOffsetMs)) return plan;
  if (presentationViews.has(plan)) return presentationViews.get(plan);
  const shiftCut = c => {
    const dt = (c.lyricOffsetMs || 0) / 1000;
    return {...c, start:c.start+dt, end:c.end+dt, sourceStart:c.start, sourceEnd:c.end,
      lyricTokens:(c.lyricTokens || []).map(w => ({...w,start:w.start+dt,end:w.end+dt})),
      ...(c.companion && typeof c.companion === 'object' ? {companion:shiftCut(c.companion)} : {})};
  };
  const view = {...plan,presentationApplied:true,cuts:plan.cuts.map(shiftCut)};
  presentationViews.set(plan,view); return view;
};
// Auxiliary source text is a presentation role, separate from primary lyrics and motion copies.
J.lyricContextVisible = env => env.plan?.lyricContext !== 'off';
J.sourceTextContext = (env, text) => {
  const norm = s => [...String(s || '')].filter(ch => /[\p{L}\p{N}]/u.test(ch)).join('').toLocaleLowerCase();
  const copy = norm(text), source = norm(env.cut?.lineText || env.cut?.text);
  return copy.length >= 3 && source.length >= 3 && (source.includes(copy) || copy.includes(source));
};
J.hideLyricContext = (env, it) => it.textRole === 'context' && !J.lyricContextVisible(env);
J.bindLyricItem = (env, it) => {
  if (!(env.cut?.sourceLineId && env.cut?.lyricIndices) || env.pass !== 'main' || env.bgOnly || env.lyricLayout === false || it.lyric === false || it.lyricCopy) return;
  const cut = env.cut, itemText = String(it.text).replace(/\n/g, ''), chars = compact(itemText), source = compact(cut.text);
  if (!chars.length) return;
  const used = env.lyricClaimed || (env.lyricClaimed = new Set());
  let explicit = null;
  if (Number.isInteger(it.lyricUnit) && env.lyricUnits?.[it.lyricUnit]) explicit = env.lyricUnits[it.lyricUnit].indices;
  if (Number.isInteger(it.lyricOffset)) explicit = source.slice(it.lyricOffset, it.lyricOffset + chars.length).map(g => cut.lyricIndices[g.i]);
  if (explicit?.length === chars.length && explicit.every(id => id != null)) {
    const map = Array.from({length: [...itemText].length}, () => null);
    chars.forEach((g, k) => { map[g.i] = explicit[k]; used.add(explicit[k]); });
    it.lyricIndices = map; return;
  }
  let candidates = [];
  for (let i = 0; i <= source.length - chars.length; i++) {
    const segment = source.slice(i, i + chars.length);
    if (chars.every((g, k) => g.ch.toLocaleLowerCase() === segment[k].ch.toLocaleLowerCase())) {
      const ids = segment.map(g => cut.lyricIndices[g.i]);
      if (ids.every(id => id != null && !used.has(id))) candidates.push({segment, ids});
    }
  }
  // A timed layout may show only the current unit, including repeated words.
  if (env.lyricUnits && candidates.length > 1) {
    const time = env.audioT ?? env.t;
    const active = env.lyricUnits.find(u => u.start != null && u.start <= time && time < u.end && compact(u.text).map(g => g.ch).join('') === chars.map(g => g.ch).join(''));
    if (active) candidates = candidates.filter(c => c.ids.every(id => active.indices.includes(id)));
  }
  const match = candidates[0]; if (!match) return;
  const map = Array.from({length: [...itemText].length}, () => null);
  chars.forEach((g, k) => { map[g.i] = match.ids[k]; used.add(match.ids[k]); });
  it.lyricIndices = map;
};
J.wordActive = (env, it, index) => {
  const id = it.lyricIndices?.[index], t = env.audioT ?? env.t;
  return id != null && env.pass === 'main' && !it.lyricCopy && env.cut?.wordHighlight &&
    env.cut.lyricTokens.some(w => w.start <= t && t < w.end && w.indices.includes(id));
};
J.wordEmphasisState = (env, it, index) => {
  const style = env.cut?.wordEmphasis || env.plan?.wordEmphasis || J.defaultProject().wordEmphasis;
  if (style.mode === 'off' || !J.wordActive(env, it, index)) return {active:false,mode:style.mode,amount:0};
  const t = env.audioT ?? env.t, id = it.lyricIndices[index];
  const token = env.cut.lyricTokens.find(w => w.start <= t && t < w.end && w.indices.includes(id));
  if (style.mode === 'accent') return {active:true,mode:'accent',amount:1};
  const span = token.end - token.start;
  const attack = Math.min(style.attack ?? 0.04, span * 0.35), release = Math.min(style.release ?? 0.08, span * 0.35);
  const smooth = x => { const k = J.clamp(x); return k * k * (3 - 2 * k); };
  const envelope = Math.min(attack ? smooth((t-token.start)/attack) : 1, release ? smooth((token.end-t)/release) : 1);
  return {active:true,mode:'soft',amount:J.clamp(style.strength ?? 0.18) * envelope};
};
J.emphasisColor = (normal, accent, state) => state.mode === 'accent' && state.active ? accent : state.amount > 0 && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(normal) ? J.mix(normal, accent, state.amount) : normal;
})();
