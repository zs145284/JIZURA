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
    const start = words.length ? Math.min(...words.map(w => w.start)) : null;
    // Only the incoming first unit gets entrance preparation. Source tokens and
    // all later word deadlines remain on the audio clock.
    const lead = indices.includes(cut.lyricEntryIndex) ? cut.lyricEntryLead || 0 : 0;
    return {...r, indices, start: start == null ? null : start - lead, end: words.length ? Math.max(...words.map(w => w.end)) : null};
  });
};
// Render-only time view: source lines, tokens and audio stay immutable.
const presentationViews = new WeakMap();
J.presentationPlan = plan => {
  if (plan.presentationApplied) return plan;
  if (presentationViews.has(plan)) return presentationViews.get(plan);
  const shiftCut = c => {
    const dt = (c.lyricOffsetMs || 0) / 1000;
    return {...c, start:c.start+dt, end:c.end+dt, sourceStart:c.start, sourceEnd:c.end,
      lyricTokens:(c.lyricTokens || []).map(w => ({...w,start:w.start+dt,end:w.end+dt})),
      ...(c.companion && typeof c.companion === 'object' ? {companion:shiftCut(c.companion)} : {})};
  };
  const cuts = plan.cuts.map(shiftCut);
  let continued = false;
  // The native planner reserves interludes for gaps above 1.3s. Smaller
  // lyric-to-lyric pauses belong to the outgoing shot's release, not a new
  // music shot. Stretch its existing exit without replaying the entrance or
  // extending source tokens. The next source onset still owns the display.
  if (plan.sourceTimeline && plan.readingLayer?.mode !== 'stable') cuts.forEach((cut, i) => {
    const next = cuts[i + 1], rawNext = plan.cuts[i + 1];
    const sourceGap = rawNext ? rawNext.start - plan.cuts[i].end : 0;
    const gap = next ? next.start - cut.end : 0;
    if (cut.sourceRole !== 'lyric' || next?.sourceRole !== 'lyric' || cut.instrumental || next.instrumental ||
        cut.sourceLineId === next.sourceLineId || sourceGap <= 0 || sourceGap > 1.3 || gap <= 0 || gap > 1.3) return;
    cut.lyricPause = { start: cut.end, end: next.start };
    cut.end = next.start; cut.dur = cut.end - cut.start;
    if (cut.outDur > 0) cut.outDur = Math.max(cut.outDur, gap);
    continued = true;
  });
  // Work backward: a preceding release ends where the next native entrance
  // must begin, rather than waiting for the first sung word to start it.
  // Reverse order also finalizes duration-dependent layouts before probing.
  if (continued && J.prepareLyricEntry) for (let i = cuts.length - 2; i >= 0; i--) {
    const cut = cuts[i], next = cuts[i + 1];
    if (!cut.lyricPause) continue;
    const entry = J.prepareLyricEntry(plan, next, cut.lyricPause.start);
    if (!entry) continue;
    next.lyricEntry = entry;
    next.lyricEntryLead = entry.preparation; next.lyricEntryIndex = entry.index;
    next.start -= entry.lead; next.dur = next.end - next.start;
    if (entry.preparation > entry.lead) next.motionStart = next.start + entry.lead - entry.preparation;
    cut.end = next.start; cut.dur = cut.end - cut.start;
    cut.lyricPause.end = next.start;
    if (cut.outDur > 0) cut.outDur = Math.max(plan.cuts[i].outDur, cut.end - cut.lyricPause.start);
  }
  // Metadata is not sung text. A leading credit block shares the pre-vocal
  // window, independent of placeholder word intervals in an LRC/AWLRC file.
  let openingCredits = null, events = plan.events;
  if (plan.sourceTimeline) {
    const sourceCuts = cuts.filter(c => c.sourceLineId && !c.instrumental);
    const first = sourceCuts.find(c => c.sourceRole !== 'credit');
    const leading = first ? sourceCuts.slice(0,sourceCuts.indexOf(first)) : [];
    if (leading.length && first?.sourceRole === 'lyric') {
      const groups = [...new Set(leading.map(c => c.sourceLineId))];
      const entry = J.prepareLyricEntry?.(plan,first,0);
      const until = first.start - (entry?.lead || 0);
      openingCredits = {status:until*plan.fps < groups.length?'insufficient-frame-budget':'scheduled',start:0,end:until,onset:entry?.onset ?? first.start,count:groups.length};
      if (openingCredits.status === 'scheduled') {
        if (entry) {
          first.lyricEntry = entry; first.lyricEntryLead = entry.preparation; first.lyricEntryIndex = entry.index;
          first.start = until; first.dur = first.end-first.start;
          if (entry.preparation > entry.lead) first.motionStart = first.start+entry.lead-entry.preparation;
        }
        groups.forEach((id,i) => {
          const group = leading.filter(c => c.sourceLineId===id), slotStart=until*i/groups.length, slotEnd=until*(i+1)/groups.length;
          const weight = group.reduce((sum,c)=>sum+c.dur,0); let start=slotStart;
          group.forEach((cut,k) => {
            const end = k===group.length-1?slotEnd:start+(slotEnd-slotStart)*cut.dur/weight;
            cut.start=start; cut.end=end; cut.dur=end-start;
            [cut.inDur,cut.outDur] = J.cutMotionDurations(cut.dur,J.glyphCount(cut.text),cut.enter,cut.exit);
            cut.wordTiming=false; cut.wordHighlight=false;
            cut.creditPresentation={order:i,count:groups.length,slotStart,slotEnd};
            start=end;
          });
        });
        // Move only cut-owned accents, preserving native FX duration. Ownership
        // is serialized by the planner so exported plans and live plans agree.
        events=plan.events.map((ev,i) => {
          const ownerIndex=ev.sourceCutIndex ?? plan.evOwner?.get(ev)?.index;
          const raw=ownerIndex!=null?plan.cuts[ownerIndex]:plan.cuts.findLast(c=>c.start<=ev.t&&ev.t<c.end);
          const cut=raw && cuts.find(c=>c.index===raw.index);
          if (!cut?.creditPresentation) return ev;
          const t=cut.start+J.clamp((ev.t-raw.start)/raw.dur)*cut.dur;
          return {...ev,t,dur:Math.min(ev.dur,Math.max(0,cut.end-t))};
        }).sort((a,b)=>a.t-b.t);
      }
    }
  }
  if (!continued && !openingCredits && !plan.cuts.some(c => c.lyricOffsetMs)) return plan;
  const view = {...plan,presentationApplied:true,cuts,events,...(openingCredits?{openingCredits}:{})};
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
