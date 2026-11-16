// Dependency-free Markdown renderer matching marked 18.1.3 (default options:
// gfm true, breaks false, pedantic false). Written from scratch.

const PUNCT = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
function isWs(ch) { return ch === undefined || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === ' ' || ch === ' ' || (ch >= ' ' && ch <= ' ') || ch === ' ' || ch === ' ' || ch === ' ' || ch === ' ' || ch === '　' || ch === '﻿'; }
const PUNCT_RE = /^[\p{P}\p{S}]$/u;
function isPunct(ch) { return ch !== undefined && PUNCT_RE.test(ch); }

function escText(s) {
  return s.replace(/&(?!(?:#\d{1,7}|#[Xx][0-9a-fA-F]{1,6}|\w+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escCode(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escAttrNE(s) {
  return s.replace(/&(?!(?:#\d{1,7}|#[Xx][0-9a-fA-F]{1,6}|\w+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function encodeHref(h) {
  let out;
  try { out = encodeURI(h).replace(/%25/g, '%'); } catch { out = h; }
  return escAttrNE(out);
}
function decodeNumRef(cp) {
  if (!cp || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '�';
  return String.fromCodePoint(cp);
}
function unescapeStr(s) {
  return s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])/g, '$1');
}
function normLabel(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss');
}

// ---------------- inline ----------------

const TAG_RE = /^<(?:([a-zA-Z][a-zA-Z0-9-]*)(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:[^"'=<>`\s]+|'[^']*'|"[^"]*"))?)*\s*\/?>|(\/[a-zA-Z][a-zA-Z0-9-]*)\s*>|!--(?:-?>|(?:[^-]|-(?!->))*-->)|!\?(?:[^?]|\?(?!>))*\?>|!\[CDATA\[(?:[^\]]|\](?!\]>))*\]\]>|!([a-zA-Z]+)(?:[^>]*)>|\?(?:[^?]|\?(?!>))*\?>)/;
const SCHEME_AUTOLINK_RE = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*)>/;
const EMAIL_AUTOLINK_RE = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)>/;
const BARE_URL_RE = /^(?:https?:\/\/|www\.)[^\s<>]*/i;
const BARE_EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?)+/;

// Find the index just past the bracket matching src[start] === '['.
function scanBracket(src, start) {
  let depth = 0, i = start, inSpan = false, spansClosed = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      let n = 0; while (src[i + n] === '`') n++;
      if (inSpan) spansClosed++;
      inSpan = !inSpan;
      i += n; continue;
    }
    if (!inSpan && c === '<') {
      const am = SCHEME_AUTOLINK_RE.exec(src.slice(i, i + 300)) || EMAIL_AUTOLINK_RE.exec(src.slice(i));
      if (am) { i += am[0].length; continue; }
      const tm = TAG_RE.exec(src.slice(i));
      if (tm) { i += tm[0].length; continue; }
      i++; continue;
    }
    if (!inSpan && c === '[') depth++;
    else if (c === ']') {
      if (inSpan) { if (src[i - 1] === '`' && depth === 1 && spansClosed >= 1) return i; }
      else { depth--; if (depth === 0) return i; }
    }
    i++;
  }
  return -1;
}
function findCodeClose(src, from, n) {
  let i = from;
  while (i < src.length) {
    if (src[i] === '`') {
      let m = 0; while (src[i + m] === '`') m++;
      if (m === n) return i;
      i += m;
    } else i++;
  }
  return -1;
}

// Parse "(dest title)" starting at src[pos] === '('. Returns {href,title,end} or null.
function parseLinkDest(src, pos) {
  let i = pos + 1;
  const skipWs = () => { while (i < src.length && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n')) i++; };
  skipWs();
  let href = '';
  if (src[i] === '<') {
    i++;
    let closed = false;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\' && PUNCT.has(src[i + 1])) { href += src[i + 1]; i += 2; continue; }
      if (c === '>') { closed = true; i++; break; }
      if (c === '\n' || c === '<') return null;
      href += c; i++;
    }
    if (!closed) return null;
  } else {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\' && PUNCT.has(src[i + 1])) { href += src[i + 1]; i += 2; continue; }
      if (c === '(') { depth++; href += c; i++; continue; }
      if (c === ')') { if (depth === 0) break; depth--; href += c; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\n' || c < ' ') break;
      href += c; i++;
    }
    if (depth !== 0) return null;
  }
  let title = null;
  const wsStart = i;
  skipWs();
  if (src[i] !== ')') {
    if (i === wsStart) return null; // title must be whitespace-separated
    const q = src[i];
    if (q === '"' || q === "'") {
      i++; let t = '', closed = false;
      while (i < src.length) {
        const c = src[i];
        if (c === '\\' && PUNCT.has(src[i + 1])) { t += src[i + 1]; i += 2; continue; }
        if (c === q) { closed = true; i++; break; }
        t += c; i++;
      }
      if (!closed) return null;
      title = t;
    } else if (q === '(') {
      i++; let t = '', closed = false;
      while (i < src.length) {
        const c = src[i];
        if (c === '\\' && PUNCT.has(src[i + 1])) { t += src[i + 1]; i += 2; continue; }
        if (c === '(') return null;
        if (c === ')') { closed = true; i++; break; }
        t += c; i++;
      }
      if (!closed) return null;
      title = t;
    } else return null;
    skipWs();
  }
  if (src[i] !== ')') return null;
  return { href, title, end: i + 1 };
}

// Does this link label contain a construct that would itself form a link?
function labelHasLink(src, st) {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      let run = 0; while (src[i + run] === '`') run++;
      const close = findCodeClose(src, i + run, run);
      if (close >= 0) { i = close + run; continue; }
      i += run; continue;
    }
    if (c === '!' && src[i + 1] === '[') {
      const close = scanBracket(src, i + 1);
      if (close < 0) return false;
      i = close + 1;
      if (src[i] === '(') { const d = parseLinkDest(src, i); if (d) i = d.end; }
      else if (src[i] === '[') { const rc = scanBracket(src, i); if (rc >= 0) i = rc + 1; }
      continue;
    }
    if (c === '[') {
      if (linkFormsAt(src, i, st)) return true;
      i++; continue;
    }
    i++;
  }
  return false;
}

// Structural link parse: returns {label, href, title, end} or null.
// When a label fails the span-aware scan because a completed code span is
// followed by an unclosed backtick run before the ], and a valid inline
// destination follows, marked emits the label with emphasis disabled.
function failedLabel(src, bracket, st) {
  if (scanBracket(src, bracket) >= 0) return null;
  let depth = 0, i = bracket, inSpan = false, spansClosed = 0, close = -1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      let n = 0; while (src[i + n] === '`') n++;
      if (inSpan) spansClosed++;
      inSpan = !inSpan;
      i += n; continue;
    }
    if (!inSpan && c === '<') {
      const am = SCHEME_AUTOLINK_RE.exec(src.slice(i, i + 300)) || EMAIL_AUTOLINK_RE.exec(src.slice(i));
      if (am) { i += am[0].length; continue; }
      const tm = TAG_RE.exec(src.slice(i));
      if (tm) { i += tm[0].length; continue; }
      i++; continue;
    }
    if (!inSpan && c === '[') depth++;
    else if (c === ']') {
      if (inSpan) { if (depth === 1 && spansClosed >= 1) { close = i; break; } }
      else { depth--; if (depth === 0) break; }
    }
    i++;
  }
  if (close < 0 || src[close + 1] !== '(') return null;
  if (!parseLinkDest(src, close + 1)) return null;
  return { label: src.slice(bracket + 1, close), end: close + 1 };
}

function tryLinkParse(src, bracket, st, isImage) {
  const close = scanBracket(src, bracket);
  if (close < 0) return null;
  const label = src.slice(bracket + 1, close);
  const after = close + 1;
  let href = null, title = null, end = -1;
  if (src[after] === '(') {
    const d = parseLinkDest(src, after);
    if (d) { href = d.href; title = d.title; end = d.end; }
  }
  let refAttempted = false;
  if (end < 0 && src[after] === '[') {
    const rclose = scanBracket(src, after);
    if (rclose >= 0) {
      refAttempted = true;
      let ref = src.slice(after + 1, rclose);
      if (ref === '') ref = label;
      const def = st.defs.get(normLabel(ref));
      if (def) { href = def.href; title = def.title; end = rclose + 1; }
    }
  }
  if (end < 0 && refAttempted) return null;
  if (end < 0) {
    const def = st.defs.get(normLabel(label));
    if (def) { href = def.href; title = def.title; end = after; }
  }
  if (end < 0) return null;
  if (!isImage && labelHasLink(label, st)) return null;
  return { label, href, title, end };
}
function tryLink(src, bracket, st, isImage) {
  const r = tryLinkParse(src, bracket, st, isImage);
  if (!r) return null;
  if (isImage) {
    const alt = plainText(r.label, st);
    return { html: `<img src="${encodeHref(r.href)}" alt="${escAttrNE(alt)}"${r.title !== null ? ` title="${escAttrNE(r.title)}"` : ''}>`, end: r.end };
  }
  const inner = parseInline(r.label, { defs: st.defs, inLink: true, doc: st.doc });
  return { html: `<a href="${encodeHref(r.href)}"${r.title !== null ? ` title="${escAttrNE(r.title)}"` : ''}>${inner}</a>`, end: r.end };
}

function trimAutolink(s) {
  let prev;
  do {
    prev = s;
    if (s.endsWith(';')) {
      const em = /&[a-zA-Z0-9]+;$/.exec(s);
      if (em) { s = s.slice(0, s.length - em[0].length); continue; }
    }
    s = s.replace(/[?!.,:*_~';]+$/, '');
    // trailing ')' that are unmatched under stack matching are dropped
    for (;;) {
      if (!s.endsWith(')')) break;
      let depth = 0, unmatched = false;
      for (let k = 0; k < s.length; k++) {
        if (s[k] === '(') depth++;
        else if (s[k] === ')') { if (depth === 0) { if (k === s.length - 1) unmatched = true; } else depth--; }
      }
      if (!unmatched) break;
      s = s.slice(0, -1);
    }
  } while (s !== prev);
  return s;
}

// Would a link form starting at src[idx] === '['? Used to cap autolinks/code spans.
function linkFormsAt(src, idx, st) {
  const close = scanBracket(src, idx);
  if (close < 0) return false;
  const after = close + 1;
  if (src[after] === '(') return parseLinkDest(src, after) !== null;
  const label = src.slice(idx + 1, close);
  if (src[after] === '[') {
    const rc = scanBracket(src, after);
    if (rc >= 0) {
      let ref = src.slice(after + 1, rc);
      if (ref === '') ref = label;
      if (st.defs.has(normLabel(ref))) return true;
    }
  }
  return st.defs.has(normLabel(label));
}

function parseInline(src, st) {
  const atoms = [];
  const et = st.plain ? (x) => x : escText;
  let txt = '';
  const flush = () => { if (txt) { atoms.push({ k: 'h', s: txt }); txt = ''; } };
  const pushHtml = (s) => { flush(); atoms.push({ k: 'h', s }); };
  let i = 0;
  const n = src.length;
  let skipLeadWs = false;
  while (i < n) {
    const c = src[i];
    if (skipLeadWs) {
      if (c === ' ' || c === '\t') { i++; continue; }
      skipLeadWs = false;
    }
    if (c === '\\') {
      const d = src[i + 1];
      if (d === '\n') { pushHtml(st.plain ? '\n' : '<br>'); skipLeadWs = true; i += 2; continue; }
      if (d !== undefined && PUNCT.has(d)) { txt += et(d); i += 2; continue; }
      txt += '\\'; i++; continue;
    }
    if (c === '`') {
      let run = 0; while (src[i + run] === '`') run++;
      const close = findCodeClose(src, i + run, run);
      if (close >= 0) {
        let content = src.slice(i + run, close).replace(/\n/g, ' ');
        if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && /[^ ]/.test(content)) content = content.slice(1, -1);
        pushHtml(st.plain ? content : '<code>' + escCode(content) + '</code>');
        i = close + run; continue;
      }
      txt += '`'.repeat(run); i += run; continue;
    }
    if (c === '&') {
      const rest = src.slice(i, i + 40);
      let m = /^&#(\d{1,7});/.exec(rest);
      if (m) { txt += et(decodeNumRef(parseInt(m[1], 10))); i += m[0].length; continue; }
      m = /^&#[Xx]([0-9a-fA-F]{1,6});/.exec(rest);
      if (m) { txt += et(decodeNumRef(parseInt(m[1], 16))); i += m[0].length; continue; }
      m = /^&[a-zA-Z][a-zA-Z0-9]*;/.exec(rest);
      if (m) { txt += m[0]; i += m[0].length; continue; }
      txt += '&amp;'; i++; continue;
    }
    if (c === '<') {
      if (!st.inLink || true) {
        let m = SCHEME_AUTOLINK_RE.exec(src.slice(i, i + 300));
        if (m) { pushHtml(st.plain ? m[1] : `<a href="${encodeHref(m[1])}">${escText(m[1])}</a>`); i += m[0].length; continue; }
        m = EMAIL_AUTOLINK_RE.exec(src.slice(i));
        if (m) { pushHtml(st.plain ? m[1] : `<a href="mailto:${encodeHref(m[1])}">${escText(m[1])}</a>`); i += m[0].length; continue; }
      }
      const tm = TAG_RE.exec(src.slice(i));
      if (tm) {
        const raw = tm[0];
        if (!st.plain) pushHtml(raw); else flush();
        const name = (tm[1] || (tm[2] ? tm[2].slice(1) : '') || '').toLowerCase();
        if (tm[1] && name === 'a' && /^<a\s+[^>]/i.test(raw)) st.doc.inA = true;
        if (tm[2] && name === 'a') st.doc.inA = false;
        i += raw.length; continue;
      }
      txt += '&lt;'; i++; continue;
    }
    if (c === '!' && src[i + 1] === '[') {
      if (st.plain) {
        const r = tryLinkParse(src, i + 1, st, true);
        if (r) { pushHtml(plainText(r.label, st)); i = r.end; continue; }
      } else {
        const r = tryLink(src, i + 1, st, true);
        if (r) { pushHtml(r.html); i = r.end; continue; }
        const f = failedLabel(src, i + 1, st);
        if (f) { pushHtml('![' + parseInline(f.label, { defs: st.defs, inLink: true, doc: st.doc, noEm: true }) + ']'); i = f.end; continue; }
      }
      txt += '!'; i++; continue;
    }
    if (c === '[') {
      if (!st.inLink) {
        if (st.plain) {
          const r = tryLinkParse(src, i, st, false);
          if (r) { pushHtml(plainText(r.label, st)); i = r.end; continue; }
        } else {
          const r = tryLink(src, i, st, false);
          if (r) { pushHtml(r.html); i = r.end; continue; }
          const f = failedLabel(src, i, st);
          if (f) { pushHtml('[' + parseInline(f.label, { defs: st.defs, inLink: true, doc: st.doc, noEm: true }) + ']'); i = f.end; continue; }
        }
      }
      txt += '['; i++; continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let run = 0; while (src[i + run] === c) run++;
      if (st.noEm) { txt += src.slice(i, i + run); i += run; continue; }
      if (c === '~' && run > 2) { txt += '~'.repeat(run); i += run; continue; }
      flush();
      const prev = i > 0 ? src[i - 1] : undefined;
      const next = i + run < n ? src[i + run] : undefined;
      const prevWs = isWs(prev), nextWs = isWs(next);
      const prevP = isPunct(prev), nextP = isPunct(next);
      const leftFlank = !nextWs && (!nextP || prevWs || prevP);
      const rightFlank = !prevWs && (!prevP || nextWs || nextP);
      let canOpen, canClose;
      if (c === '_') {
        canOpen = leftFlank && (!rightFlank || prevP);
        canClose = rightFlank && (!leftFlank || nextP);
      } else {
        canOpen = leftFlank; canClose = rightFlank;
      }
      atoms.push({ k: 'd', ch: c, len: run, olen: run, canOpen, canClose });
      i += run; continue;
    }
    if (!st.inLink && !st.doc.inA && (c === 'w' || c === 'h' || c === 'm' || c === 'x' || /[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]/.test(c))) {
      const prev = i > 0 ? src[i - 1] : undefined;
      const prevBad = prev !== undefined && /[a-zA-Z0-9_/.-]/.test(prev);
      if (!prevBad) {
        const rest = src.slice(i);
        let m = null, href = null, text = null;
        if (/^www\./.test(rest) || /^https?:\/\//i.test(rest)) {
          m = BARE_URL_RE.exec(rest);
          if (m) {
            let cand = m[0];
            // the match ends before the first '(' whose group never closes
            {
              let depth = 0, cut = -1;
              for (let k = 0; k < cand.length; k++) {
                if (cand[k] === '(') { if (depth === 0 && cut < 0) cut = k; depth++; }
                else if (cand[k] === ')') { if (depth > 0) { depth--; if (depth === 0) cut = -1; } }
              }
              if (cut >= 0) cand = cand.slice(0, cut);
            }
            cand = trimAutolink(cand);
            if (cand.length >= (/^www\./.test(cand) ? 5 : 8)) { text = cand; href = /^www\./.test(cand) ? 'http://' + cand : cand; }
            else m = null;
          }
        }
        if (!text && (rest.startsWith('mailto:') || rest.startsWith('xmpp:'))) {
          const mm = /^(?:mailto:|xmpp:)([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?)+)/.exec(rest);
          if (mm) {
            let cand = rest.slice(0, mm[0].length);
            const after = rest[mm[0].length];
            if (after === '-' || after === '_') { /* invalid: address continues badly */ }
            else {
              if (rest.startsWith('xmpp:') && after === '/') {
                const seg = /^\/[^\s/]+/.exec(rest.slice(mm[0].length));
                if (seg) cand += seg[0];
              }
              text = cand; href = cand;
            }
          }
        }
        if (!text) {
          const mm = BARE_EMAIL_RE.exec(rest);
          if (mm) {
            const after = rest[mm[0].length];
            // a trailing _ is fine when it closes a pending _ emphasis
            const uscoreOk = after === '_' && atoms.some(a => a.k === 'd' && a.ch === '_' && a.len > 0 && a.canOpen);
            if ((after !== '-' && after !== '_') || uscoreOk) { text = mm[0]; href = 'mailto:' + mm[0]; }
          }
        }
        if (text) { pushHtml(st.plain ? text : `<a href="${encodeHref(href)}">${escText(text)}</a>`); i += text.length; continue; }
      }
    }
    if (c === '\n') {
      // hard break: 2+ spaces before newline
      let sp = 0; while (src[i - 1 - sp] === ' ') sp++;
      if (sp >= 2) {
        txt = txt.replace(/ +$/, '');
        pushHtml(st.plain ? '\n' : '<br>');
        skipLeadWs = true;
        i++; continue;
      }
      txt += '\n'; i++; continue;
    }
    if (c === '>') { txt += '&gt;'; i++; continue; }
    if (c === '"') { txt += '&quot;'; i++; continue; }
    if (c === "'") { txt += '&#39;'; i++; continue; }
    txt += c; i++;
  }
  flush();
  atoms.plainMode = !!st.plain;
  processDelims(atoms);
  let out = '';
  for (const a of atoms) {
    if (a.k === 'h') out += a.s;
    else if (a.k === 'd') out += a.ch.repeat(a.len);
  }
  return out;
}

// marked rejects a single-* emphasis whose content contains a strong pair
// whose closing run is immediately followed by a word character, unless that
// word run is itself immediately followed by a ** run followed by a non-word.
function emPoisoned(atoms, oi, ci) {
  let pseudo = '';
  for (let j = oi + 1; j < ci; j++) {
    const a = atoms[j];
    if (a.k === 'h') pseudo += a.s.replace(/<strong>/g, '\u0001').replace(/<\/strong>/g, '\u0002').replace(/<[^>]*>/g, '');
    else if (a.k === 'd') pseudo += a.ch.repeat(a.len);
  }
  const re = /\u0001(?:[^\u0001\u0002]|\u0002[^\u0001])*?\u0002([\p{L}\p{N}]+)(\*\*)?/gu;
  let m;
  while ((m = re.exec(pseudo)) !== null) {
    const before = m.index > 0 ? pseudo[m.index - 1] : '';
    if (!/\s/.test(before)) continue;
    if (m[2]) {
      const after = pseudo[re.lastIndex];
      if (after === undefined || !/[\p{L}\p{N}]/u.test(after)) continue;
    }
    return true;
  }
  return false;
}

// A single-* closer glued (through a word-only text atom) to a just-closed
// <em> does not match a ** opener in marked.
function emGlued(atoms, ci) {
  const prev = atoms[ci - 1];
  if (!prev || prev.k !== 'h' || !/^[\p{L}\p{N}]+$/u.test(prev.s)) return false;
  let j = ci - 2;
  while (j >= 0 && atoms[j].k === 'd' && atoms[j].len === 0) j--;
  return j >= 0 && atoms[j].k === 'h' && atoms[j].s === '</em>';
}

function processDelims(atoms) {
  // CommonMark-style delimiter processing.
  let ci = 0;
  while (ci < atoms.length) {
    const closer = atoms[ci];
    if (closer.k !== 'd' || !closer.canClose || closer.len === 0) { ci++; continue; }
    // search backwards for a matching opener; rule-of-3 failures keep searching
    let opener = null, oi = -1;
    for (let j = ci - 1; j >= 0; j--) {
      const a = atoms[j];
      if (a.k !== 'd' || a.ch !== closer.ch || !a.canOpen || a.len === 0) continue;
      if ((closer.canOpen || a.canClose) && (a.olen + closer.olen) % 3 === 0 && (a.olen % 3 !== 0 || closer.olen % 3 !== 0)) continue;
      const u = (a.len >= 2 && closer.len >= 2) ? 2 : 1;
      if (u === 1 && closer.ch === '*' && emPoisoned(atoms, j, ci)) continue;
      if (u === 1 && closer.ch === '*' && a.len >= 2 && emGlued(atoms, ci)) continue;
      opener = a; oi = j; break;
    }
    if (!opener) { ci++; continue; }
    const use = (opener.len >= 2 && closer.len >= 2) ? 2 : 1;
    // marked keeps a lone leftover * of a *** closer inside the strong when
    // the content ends with an emphasis glued to the final word
    const moveIn = use === 2 && closer.ch === '*' && closer.len === 3 && emGlued(atoms, ci);
    opener.len -= use; closer.len -= use;
    if (moveIn) closer.len = 0;
    const tag = closer.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
    const plainMode = atoms.plainMode;
    atoms.splice(ci, 0, { k: 'h', s: plainMode ? '' : `</${tag}>` });
    atoms.splice(oi + 1, 0, { k: 'h', s: plainMode ? '' : `<${tag}>` });
    if (moveIn) atoms.splice(ci + 1, 0, { k: 'h', s: plainMode ? '*' : '*' });
    // delimiters between the pair can no longer match: they become literal text
    for (let j = ci; j >= oi + 2; j--) {
      if (atoms[j].k === 'd') atoms[j] = { k: 'h', s: atoms[j].ch.repeat(atoms[j].len) };
    }
    ci = atoms.indexOf(closer);
    if (closer.len === 0) ci++;
  }
  for (let j = 0; j < atoms.length; j++) {
    const a = atoms[j];
    if (a.k === 'd') atoms[j] = { k: 'h', s: a.ch.repeat(a.len) };
  }
}

// Plain-text rendering of inline source (for image alt text).
function plainText(src, st) {
  return parseInline(src, { defs: st.defs, inLink: false, plain: true, doc: st.doc });
}

// ---------------- block ----------------

function isBlank(l) { return /^[ \t]*$/.test(l); }
// columns of leading whitespace (tab = advance to next multiple of 4)
function leadCols(l) {
  let col = 0;
  for (let i = 0; i < l.length; i++) {
    if (l[i] === ' ') col++;
    else if (l[i] === '\t') col += 4 - (col % 4);
    else break;
  }
  return col;
}
function leadIdx(l) { let i = 0; while (l[i] === ' ' || l[i] === '\t') i++; return i; }
// remove the first n columns of indentation; a straddling tab leaves spaces
function consumeCols(l, n, basis = 0) {
  let col = basis, i = 0;
  const target = basis + n;
  while (i < l.length && col < target) {
    if (l[i] === ' ') { col++; i++; }
    else if (l[i] === '\t') { const w = 4 - (col % 4); if (col + w <= target) { col += w; i++; } else { return ' '.repeat(col + w - target) + l.slice(i + 1); } }
    else break;
  }
  return l.slice(i);
}
function expandTabs(s, basis) {
  let out = '', col = basis;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\t') { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; }
    else { out += s[i]; col++; }
  }
  return out;
}

// Remove n columns of indentation (basis = column the line starts at), then
// expand tabs in the leading-whitespace region relative to the new basis.
function dedentLine(l, n, basis) {
  const s = consumeCols(l, n, basis);
  const nb = basis + n;
  let out = '', col = nb, i = 0;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
    if (s[i] === ' ') { out += ' '; col++; i++; }
    else { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; i++; }
  }
  return out + s.slice(i);
}

const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul').split(' '));

function splitRow(line) {
  let s = line.trim();
  // find code span ranges (pipes inside them do not split)
  const spans = [];
  {
    let i = 0;
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === '`') {
        let run = 0; while (s[i + run] === '`') run++;
        const close = findCodeClose(s, i + run, run);
        if (close >= 0) { spans.push([i, close + run]); i = close + run; continue; }
        const nxt = s.indexOf('`', i + run);
        if (nxt >= 0) { let m = 0; while (s[nxt + m] === '`') m++; spans.push([i, nxt + m]); i = nxt + m; continue; }
        i += run; continue;
      }
      i++;
    }
  }
  const inSpan = (pos) => spans.some(([a, b]) => pos >= a && pos < b);
  const cells = [];
  let cur = '', i = 0;
  if (s.startsWith('|')) i = 1;
  let endedWithPipe = false;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { cur += s[i + 1] === '|' ? '|' : c + s[i + 1]; i += 2; endedWithPipe = false; continue; }
    if (c === '|' && !inSpan(i)) { cells.push(cur); cur = ''; i++; endedWithPipe = true; continue; }
    cur += c; i++; endedWithPipe = false;
  }
  cells.push(cur);
  if (endedWithPipe) cells.pop();
  return cells.map(c => c.trim());
}
function delimAlign(line) {
  if (!line.includes('|')) return null;
  const cells = splitRow(line);
  if (!cells.length) return null;
  const aligns = [];
  for (const c of cells) {
    if (!/^:?-+:?$/.test(c)) return null;
    aligns.push(c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null);
  }
  return aligns;
}

function matchATX(l) {
  const ind = leadCols(l);
  if (ind > 3) return null;
  const s = l.slice(leadIdx(l));
  const m = /^(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(s);
  if (!m) return null;
  let text = m[2] || '';
  text = text.replace(/[ \t]+#+[ \t]*$/, '').replace(/[ \t]+$/, '');
  if (/^#+$/.test(text)) text = '';
  return { depth: m[1].length, text };
}
function isHr(l) {
  const ind = leadCols(l);
  if (ind > 3) return false;
  const s = l.slice(leadIdx(l)).replace(/[ \t]/g, '');
  return /^([-*_])\1{2,}$/.test(s);
}
function matchFenceStart(l) {
  const ind = leadCols(l);
  if (ind > 3) return null;
  const s = l.slice(leadIdx(l));
  const m = /^(`{3,}|~{3,})(.*)$/.exec(s);
  if (!m) return null;
  if (m[1][0] === '`' && m[2].includes('`')) return null;
  return { ch: m[1][0], len: m[1].length, info: m[2].trim(), indent: ind };
}
function isFenceClose(l, ch, len) {
  const ind = leadCols(l);
  if (ind > 3) return false;
  const s = l.slice(leadIdx(l));
  const m = /^(`{3,}|~{3,})[ \t]*$/.exec(s);
  return !!m && m[1][0] === ch && m[1].length >= len;
}

// Strip one blockquote marker; returns content line or null. Leading
// whitespace of the content is expanded to spaces in the original line's
// column frame; a tab serving as the marker's whitespace loses one column.
function stripQuote(l) {
  let i = 0, col = 0;
  while (i < l.length && col < 3 && (l[i] === ' ' || l[i] === '\t')) {
    if (l[i] === ' ') { col++; i++; }
    else { col += 4 - (col % 4); i++; }
  }
  if (col > 3 || l[i] !== '>') return null;
  i++; col++;
  let out = '';
  if (l[i] === ' ') { i++; col++; }
  else if (l[i] === '\t') { const w = 4 - (col % 4); out += ' '.repeat(w - 1); col += w; i++; }
  while (i < l.length && (l[i] === ' ' || l[i] === '\t')) {
    if (l[i] === ' ') { out += ' '; col++; i++; }
    else { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; i++; }
  }
  return out + l.slice(i);
}

// Parse a list marker at line start. Returns null or marker info.
function matchListMarker(l) {
  const ind = leadCols(l);
  if (ind > 3) return null;
  const s = l.slice(leadIdx(l));
  let m = /^([-+*])(?=$|[ \t])/.exec(s);
  let ordered = false, bullet = null, num = 0, delim = null, mlen = 0;
  if (m) { bullet = m[1]; mlen = 1; }
  else {
    m = /^(\d{1,9})([.)])(?=$|[ \t])/.exec(s);
    if (!m) return null;
    ordered = true; num = parseInt(m[1], 10); delim = m[2]; mlen = m[1].length + 1;
  }
  const afterIdx = leadIdx(l) + mlen;
  const rest = l.slice(afterIdx);
  // columns of whitespace after marker
  let wcol = 0, wi = 0;
  while (wi < rest.length && (rest[wi] === ' ' || rest[wi] === '\t')) {
    if (rest[wi] === ' ') wcol++; else wcol += 4 - ((ind + mlen + wcol) % 4);
    wi++;
  }
  const blankAfter = wi >= rest.length;
  let contentIndent, contentStart;
  if (blankAfter) { contentIndent = ind + mlen + 1; contentStart = l.length; }
  else if (wcol >= 5) { contentIndent = ind + mlen + 1; contentStart = afterIdx + 1; }
  else { contentIndent = ind + mlen + wcol; contentStart = afterIdx + wi; }
  return { ind, ordered, bullet, num, delim, mlen, contentIndent, contentStart, blankAfter, afterIdx, firstContent: l.slice(contentStart) };
}

// Try a link reference definition starting at lines[i]. Returns {label,href,title,consumed} or null.
function tryDef(lines, i, defs) {
  const l = lines[i];
  if (leadCols(l) > 3) return null;
  const text = lines.slice(i, i + 8).join('\n');
  let p = 0;
  while (text[p] === ' ' && p < 3) p++;
  if (text[p] !== '[') return null;
  const close = scanBracket(text, p);
  if (close < 0) return null;
  const label = text.slice(p + 1, close);
  if (/\n[ \t]*\n/.test(label)) return null;
  { let bad = false; for (let k = 0; k < label.length; k++) { if (label[k] === '\\') k++; else if (label[k] === '[' || label[k] === ']') { bad = true; break; } } if (bad) return null; }
  if (normLabel(label) === '') return null;
  p = close + 1;
  if (text[p] !== ':') return null;
  p++;
  // gap to destination: whitespace with at most one newline, no blank line
  {
    let nl = 0;
    while (p < text.length && (text[p] === ' ' || text[p] === '\t' || text[p] === '\n')) { if (text[p] === '\n') nl++; p++; }
    if (nl > 1) return null;
  }
  let href = '';
  if (text[p] === '<') {
    p++; let closed = false;
    while (p < text.length) {
      const c = text[p];
      if (c === '\\' && PUNCT.has(text[p + 1])) { href += text[p + 1]; p += 2; continue; }
      if (c === '>') { closed = true; p++; break; }
      if (c === '\n' || c === '<') return null;
      href += c; p++;
    }
    if (!closed) return null;
  } else {
    let depth = 0, any = false;
    while (p < text.length) {
      const c = text[p];
      if (c === '\\' && PUNCT.has(text[p + 1])) { href += text[p + 1]; p += 2; any = true; continue; }
      if (c === '(') depth++;
      if (c === ')') { if (depth === 0) break; depth--; }
      if (c === ' ' || c === '\t' || c === '\n' || c < ' ') break;
      href += c; p++; any = true;
    }
    if (!any || depth !== 0) return null;
  }
  const destEnd = p;
  // Phase A: optional title (may start after spaces/tabs or one newline)
  {
    let q = p;
    while (text[q] === ' ' || text[q] === '\t') q++;
    if (text[q] === '\n') { q++; while (text[q] === ' ' || text[q] === '\t') q++; }
    const qc = text[q];
    if (q > destEnd && (qc === '"' || qc === "'" || qc === '(')) {
      const closeC = qc === '(' ? ')' : qc;
      q++; let t = '', closed = false;
      while (q < text.length) {
        const c = text[q];
        if (c === '\\' && PUNCT.has(text[q + 1])) { t += text[q + 1]; q += 2; continue; }
        if (qc === '(' && c === '(') { closed = false; break; }
        if (c === closeC) { closed = true; q++; break; }
        t += c; q++;
      }
      if (closed && !/\n[ \t]*\n/.test(t)) {
        while (text[q] === ' ' || text[q] === '\t') q++;
        if (q >= text.length || text[q] === '\n') {
          return { label, href, title: t, consumed: text.slice(0, q).split('\n').length };
        }
      }
    }
  }
  // Phase B: no title — rest of destination's line must be blank
  {
    let q = destEnd;
    while (text[q] === ' ' || text[q] === '\t') q++;
    if (q >= text.length || text[q] === '\n') {
      return { label, href, title: null, consumed: text.slice(0, q).split('\n').length };
    }
  }
  return null;
}

// HTML block starting at lines[i]. Returns {text, consumed} or null. type7ok: allow type 7.
const ATTR_SRC = "[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\\s*=\\s*(?:[^\"'=<>`\\s]+|'[^']*'|\"[^\"]*\"))?";
const TYPE7_OPEN_RE = new RegExp('^<([a-zA-Z][a-zA-Z0-9-]*)(?:\\s+' + ATTR_SRC + ')*\\s*/?>[ \\t]*$');
const TYPE7_CLOSE_RE = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>[ \t]*$/;
function isType7Line(s) {
  let m = TYPE7_OPEN_RE.exec(s);
  if (m) return !BLOCK_TAGS.has(m[1].toLowerCase());
  m = TYPE7_CLOSE_RE.exec(s);
  if (m) return !BLOCK_TAGS.has(m[1].toLowerCase());
  return false;
}
function tryHtmlBlock(lines, i, type7ok) {
  const l = lines[i];
  if (leadCols(l) > 3) return null;
  const s = l.slice(leadIdx(l));
  let type = 0, closePat = null;
  let m;
  if ((m = /^<(script|pre|style|textarea)(?=[\s>]|$)/i.exec(s))) { type = 1; closePat = new RegExp('</' + m[1] + '\\s*>', 'i'); }
  else if (s.startsWith('<!--')) { type = 2; closePat = /-->/; }
  else if (s.startsWith('<?')) { type = 3; closePat = /\?>/; }
  else if (/^<![A-Z]/.test(s)) { type = 4; closePat = />/; }
  else if (s.startsWith('<![CDATA[')) { type = 5; closePat = /\]\]>/; }
  else if ((m = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>]|$)/.exec(s)) && BLOCK_TAGS.has(m[1].toLowerCase())) type = 6;
  else if (type7ok && isType7Line(s)) type = 7;
  if (!type) return null;
  let j = i;
  if (type <= 5) {
    while (j < lines.length) {
      if (closePat.test(lines[j])) { j++; break; }
      j++;
    }
  } else {
    while (j < lines.length && !isBlank(lines[j])) j++;
  }
  return { text: lines.slice(i, j).join('\n'), consumed: j - i, type };
}

function startsInterruptBlock(lines, j, defs, top = true) {
  const l = lines[j];
  if (matchFenceStart(l)) return true;
  if (matchATX(l)) return true;
  if (isHr(l)) return true;
  if (stripQuote(l) !== null) return true;
  if (tryHtmlBlock(lines, j, false)) return true;
  const lm = matchListMarker(l);
  if (lm && !lm.blankAfter) {
    // at top level an ordered list interrupts only if it starts at 1;
    // inside containers (list items, quotes) any list can interrupt
    if (!top || !lm.ordered || lm.num === 1) {
      if (lm.firstContent.trim() !== '') return true;
    }
  }
  return false;
}

function parseList(lines, i, defs) {
  const first = matchListMarker(lines[i]);
  if (!first) return null;
  const items = [];
  let loose = false;
  let j = i;
  let cur = null;
  const sameKind = (mk) => first.ordered ? (mk.ordered && mk.delim === first.delim) : (!mk.ordered && mk.bullet === first.bullet);
  let pendingBlanks = 0;
  let inFence = null;
  let fenceContent = 0;
  const finishItem = (followedByItem) => {
    if (cur) {
      if (followedByItem && pendingBlanks > 0) loose = true;
      while (cur.lines.length && isBlank(cur.lines[cur.lines.length - 1])) cur.lines.pop();
      const tokens = lexBlocks(cur.lines, defs, false, false);
      for (let k = 1; k < tokens.length; k++) if (tokens[k].sep) loose = true;
      items.push({ tokens });
      cur = null;
    }
  };
  while (j < lines.length) {
    const l = lines[j];
    if (cur === null) {
      const mk = matchListMarker(l);
      if (!mk || !sameKind(mk) || mk.ind - first.ind > 3) break;
      cur = { lines: [mk.blankAfter ? '' : dedentLine(lines[j].slice(mk.afterIdx), mk.contentIndent - mk.ind - mk.mlen, mk.ind + mk.mlen)], contentIndent: mk.contentIndent, startLine: j };
      pendingBlanks = 0; inFence = null; fenceContent = 0;
      const f = matchFenceStart(cur.lines[0]);
      if (f) inFence = f;
      j++;
      continue;
    }
    if (isBlank(l)) {
      let k = j;
      while (k < lines.length && isBlank(lines[k])) k++;
      if (k >= lines.length) { j = k; break; }
      const hasContent = cur.lines.some(x => !isBlank(x));
      const nl = lines[k];
      const nmk = matchListMarker(nl);
      const nind = leadCols(nl);
      const nextIsItem = nmk && sameKind(nmk) && nmk.ind - first.ind <= 3 && nind < cur.contentIndent;
      if (!hasContent && !inFence && !nextIsItem) break; // item that starts blank is empty; list ends
      if (nextIsItem || nind >= cur.contentIndent || (inFence && fenceContent > 0) || (inFence && nind >= cur.contentIndent)) {
        for (let b = j; b < k; b++) cur.lines.push('');
        pendingBlanks += k - j;
        j = k;
        continue;
      }
      break; // blanks then unrelated content: list ends
    }
    const ind = leadCols(l);
    if (inFence) {
      if (ind < cur.contentIndent && fenceContent === 0) {
        // fence gathered no content line: it closes empty, the item ends,
        // and this line is reprocessed outside the item
        finishItem(false);
        continue;
      } else {
        const content = ind >= cur.contentIndent ? dedentLine(l, cur.contentIndent, 0) : l;
        cur.lines.push(content);
        fenceContent++;
        if (isFenceClose(content, inFence.ch, inFence.len)) inFence = null;
        pendingBlanks = 0;
        j++; continue;
      }
    }
    if (ind >= cur.contentIndent) {
      pendingBlanks = 0;
      const content = dedentLine(l, cur.contentIndent, 0);
      cur.lines.push(content);
      const f = matchFenceStart(content);
      if (f) { inFence = f; fenceContent = 0; }
      j++; continue;
    }
    if (isHr(l)) break;
    const mk = matchListMarker(l);
    if (mk && sameKind(mk)) {
      finishItem(true);
      continue; // reprocess line as new item
    }
    if (mk && mk.ind - first.ind <= 3) break; // a different list marker ends this list
    // lazy continuation: glue onto the previous content line
    if (pendingBlanks === 0 && cur.lines.length && !isBlank(cur.lines[cur.lines.length - 1]) && !startsInterruptBlock(lines, j, defs)) {
      const t = leadCols(l) >= 4 ? consumeCols(l, 4) : l;
      cur.lines[cur.lines.length - 1] += '\n' + t;
      j++; continue;
    }
    break;
  }
  finishItem(false);
  if (!items.length) return null;
  return { token: { t: 'list', ordered: first.ordered, start: first.num, loose, items }, next: j };
}

// Can a lazy (unmarked) line continue this content? True when the innermost
// open block is a paragraph.
function canLazyTokens(tokens) {
  if (!tokens.length) return false;
  const last = tokens[tokens.length - 1];
  if (last.t === 'para') return true;
  if (last.t === 'quote') return canLazyTokens(last.tokens);
  if (last.t === 'list') return last.items.length ? canLazyTokens(last.items[last.items.length - 1].tokens) : false;
  return false;
}

function lexBlocks(lines, defs, endsNl = false, top = true) {
  const tokens = [];
  let i = 0;
  let blankBefore = false;
  const push = (tok) => { tok.sep = blankBefore && tokens.length > 0; blankBefore = false; tokens.push(tok); };
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) { blankBefore = true; i++; continue; }
    // fenced code
    const fence = matchFenceStart(l);
    if (fence) {
      const content = [];
      let j = i + 1;
      while (j < lines.length && !isFenceClose(lines[j], fence.ch, fence.len)) {
        content.push(fence.ch === '`' ? consumeCols(lines[j], Math.min(fence.indent, leadCols(lines[j]))) : lines[j]);
        j++;
      }
      const closed = j < lines.length;
      if (closed) j++; // closing fence
      let text = content.map(x => x + '\n').join('');
      if (closed && text.endsWith('\n')) text = text.slice(0, -1);
      if (text && !text.endsWith('\n')) text += '\n';
      const lang = fence.info ? unescapeStr(fence.info.split(/\s+/)[0]) : '';
      push({ t: 'code', text, lang, fenced: true });
      i = j; continue;
    }
    // ATX heading
    const atx = matchATX(l);
    if (atx) { push({ t: 'heading', depth: atx.depth, text: atx.text }); i++; continue; }
    // thematic break
    if (isHr(l)) { push({ t: 'hr' }); i++; continue; }
    // indented code
    if (leadCols(l) >= 4) {
      const content = [];
      let j = i;
      while (j < lines.length) {
        const cl = lines[j];
        if (isBlank(cl)) {
          // include only if a later line is indented code
          let k = j + 1;
          while (k < lines.length && isBlank(lines[k])) k++;
          if (k < lines.length && leadCols(lines[k]) >= 4) { content.push(consumeCols(cl, 4)); j++; continue; }
          break;
        }
        if (leadCols(cl) < 4) break;
        content.push(consumeCols(cl, 4));
        j++;
      }
      while (content.length && content[content.length - 1] === '') content.pop();
      push({ t: 'code', text: content.join('\n') + '\n', lang: '', fenced: false });
      i = j; continue;
    }
    // blockquote
    if (stripQuote(l) !== null) {
      const inner = [];
      let j = i;
      while (j < lines.length) {
        const q = stripQuote(lines[j]);
        if (q !== null) { inner.push(q); j++; continue; }
        const cl = lines[j];
        if (!isBlank(cl) && inner.length && !isBlank(inner[inner.length - 1]) && canLazyTokens(lexBlocks(inner, defs, false, true)) && !startsInterruptBlock(lines, j, defs)) {
          if (/^ {0,3}(=+|-+)[ \t]*$/.test(cl)) {
            let chunkStart = 0;
            for (let k = inner.length - 1; k >= 0; k--) { if (isBlank(inner[k])) { chunkStart = k + 1; break; } }
            const chunkLen = inner.slice(chunkStart).reduce((a, x) => a + x.split('\n').length, 0);
            inner[inner.length - 1] += '\n' + (chunkLen >= 2 ? '    ' + cl.trim() : cl);
          } else {
            inner[inner.length - 1] += '\n' + (leadCols(cl) >= 4 ? consumeCols(cl, 4) : cl);
          }
          j++; continue;
        }
        break;
      }
      push({ t: 'quote', tokens: lexBlocks(inner, defs, false, true) });
      i = j; continue;
    }
    // list
    if (matchListMarker(l)) {
      const r = parseList(lines, i, defs);
      if (r) { push(r.token); i = r.next; continue; }
    }
    // html block
    const hb = tryHtmlBlock(lines, i, true);
    if (hb) {
      const nx = i + hb.consumed;
      const addNl = nx < lines.length
        ? (hb.type <= 5 ? lines[nx].length > 0 : !isBlank(lines[nx]))
        : endsNl;
      push({ t: 'html', text: hb.text + (addNl ? '\n' : '') });
      i += hb.consumed; continue;
    }
    // link reference definition
    const def = tryDef(lines, i, defs);
    if (def) {
      const key = normLabel(def.label);
      if (!defs.has(key)) defs.set(key, { href: def.href, title: def.title });
      push({ t: 'def' });
      i += def.consumed; continue;
    }
    // paragraph (with setext + table detection)
    const plines = [];
    let j = i;
    let heading = null, table = null;
    while (j < lines.length) {
      const cl = lines[j];
      if (isBlank(cl)) {
        if (plines.length && j === lines.length - 1 && !endsNl && cl.length) { plines.push(cl); j++; }
        break;
      }
      if (plines.length) {
        // setext underline?
        if (leadCols(cl) <= 3) {
          const s = cl.slice(leadIdx(cl));
          if (/^=+[ \t]*$/.test(s)) { heading = { depth: 1 }; j++; break; }
          if (/^-+[ \t]*$/.test(s)) { heading = { depth: 2 }; j++; break; }
        }
        if (startsInterruptBlock(lines, j, defs, top)) break;
      }
      // table: this line is header, next line is delimiter
      if (j + 1 < lines.length) {
        const aligns = delimAlign(lines[j + 1]);
        if (aligns) {
          const header = splitRow(cl);
          if (header.length === aligns.length) {
            table = { header, aligns, startLine: j };
            break;
          }
        }
      }
      plines.push(cl);
      j++;
    }
    if (table) {
      if (plines.length) push({ t: 'para', text: plines.join('\n') });
      const rows = [];
      let rj = table.startLine + 2;
      while (rj < lines.length) {
        if (lines[rj] === '\t') { rows.push(['']); rj++; continue; }
        if (isBlank(lines[rj]) || startsInterruptBlock(lines, rj, defs)) break;
        rows.push(splitRow(lines[rj]));
        rj++;
      }
      push({ t: 'table', header: table.header, aligns: table.aligns, rows });
      i = rj; continue;
    }
    if (heading) { push({ t: 'heading', depth: heading.depth, text: plines.join('\n').trim() }); i = j; continue; }
    if (plines.length) { push({ t: 'para', text: plines.join('\n') }); i = j; continue; }
    i++; // safety
  }
  return tokens;
}

function renderTokens(tokens, defs, doc) {
  let out = '';
  for (const tok of tokens) out += renderToken(tok, defs, false, doc);
  return out;
}

function renderToken(tok, defs, tight, doc) {
  switch (tok.t) {
    case 'heading':
      return `<h${tok.depth}>${parseInline(tok.text, { defs, inLink: false, doc })}</h${tok.depth}>\n`;
    case 'para': {
      const inner = parseInline(tok.text, { defs, inLink: false, doc });
      return tight ? inner : `<p>${inner}</p>\n`;
    }
    case 'code':
      return `<pre><code${tok.lang ? ` class="language-${escAttrNE(tok.lang)}"` : ''}>${escCode(tok.text)}</code></pre>\n`;
    case 'hr': return '<hr>\n';
    case 'def': return '';
    case 'html': return tok.text;
    case 'quote':
      return `<blockquote>\n${renderTokens(tok.tokens, defs, doc)}</blockquote>\n`;
    case 'list': {
      const tag = tok.ordered ? 'ol' : 'ul';
      const startAttr = tok.ordered && tok.start !== 1 ? ` start="${tok.start}"` : '';
      let out = `<${tag}${startAttr}>\n`;
      for (const item of tok.items) out += renderListItem(item, tok, defs, doc);
      out += `</${tag}>\n`;
      return out;
    }
    case 'table': {
      let out = '<table>\n<thead>\n<tr>\n';
      tok.header.forEach((cell, k) => {
        out += `<th${tok.aligns[k] ? ` align="${tok.aligns[k]}"` : ''}>${parseInline(cell, { defs, inLink: false, doc })}</th>\n`;
      });
      out += '</tr>\n</thead>\n';
      if (tok.rows.length) {
        out += '<tbody>';
        for (const row of tok.rows) {
          out += '<tr>\n';
          for (let k = 0; k < tok.header.length; k++) {
            const cell = row[k] ?? '';
            out += `<td${tok.aligns[k] ? ` align="${tok.aligns[k]}"` : ''}>${parseInline(cell, { defs, inLink: false, doc })}</td>\n`;
          }
          out += '</tr>\n';
        }
        out += '</tbody>';
      }
      out += '</table>\n';
      return out;
    }
  }
  return '';
}

function renderListItem(item, list, defs, doc) {
  const tokens = item.tokens;
  let task = null;
  if (tokens.length && tokens[0].t === 'para') {
    const m = /^\[([ xX])\](?:[ \t]|$)/.exec(tokens[0].text) || /^\[([ xX])\]$/.exec(tokens[0].text.trimEnd());
    if (m) {
      task = m[1] !== ' ';
      tokens[0] = { ...tokens[0], text: tokens[0].text.replace(/^\[([ xX])\][ \t]?/, '') };
    }
  }
  let content = '';
  tokens.forEach((tok, idx) => {
    let r = renderToken(tok, defs, !list.loose, doc);
    if (idx === 0 && task !== null) {
      const box = `<input ${task ? 'checked="" ' : ''}disabled="" type="checkbox"> `;
      if (!list.loose && tok.t === 'para') r = box + r;
      else if (tok.t === 'para') r = '<p>' + box + r.slice(3);
    }
    content += r;
  });
  return `<li>${content}</li>\n`;
}

export function parse(markdown) {
  let src = String(markdown).replace(/\r\n?/g, '\n');
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);
  const defs = new Map();
  const endsNl = src.endsWith('\n');
  const lines = src.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const tokens = lexBlocks(lines, defs, endsNl);
  return renderTokens(tokens, defs, { inA: false });
}
