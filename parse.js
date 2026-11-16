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

const TAG_RE = /^<(?:([a-zA-Z][a-zA-Z0-9-]*)(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:[^"'=<>`\s]+|'[^']*'|"[^"]*"))?)*\s*\/?>|(\/[a-zA-Z][a-zA-Z0-9-]*)\s*>|!--(?:[^-]|-(?!->))*-->|!\?(?:[^?]|\?(?!>))*\?>|!\[CDATA\[(?:[^\]]|\](?!\]>))*\]\]>|!([a-zA-Z]+)(?:[^>]*)>|\?(?:[^?]|\?(?!>))*\?>)/;
const SCHEME_AUTOLINK_RE = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*)>/;
const EMAIL_AUTOLINK_RE = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)>/;
const BARE_URL_RE = /^(?:https?:\/\/|www\.)[^\s<>\[\]]*/;
const BARE_EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?)+/;

// Find the index just past the bracket matching src[start] === '['.
function scanBracket(src, start) {
  let depth = 0, i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      let n = 0; while (src[i + n] === '`') n++;
      const close = findCodeClose(src, i + n, n);
      if (close >= 0) { i = close + n; continue; }
      i += n; continue;
    }
    if (c === '<') {
      const am = SCHEME_AUTOLINK_RE.exec(src.slice(i, i + 300)) || EMAIL_AUTOLINK_RE.exec(src.slice(i));
      if (am) { i += am[0].length; continue; }
      const tm = TAG_RE.exec(src.slice(i));
      if (tm) { i += tm[0].length; continue; }
      i++; continue;
    }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return i; }
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
  if (end < 0 && src[after] === '[') {
    const rclose = scanBracket(src, after);
    if (rclose >= 0) {
      let ref = src.slice(after + 1, rclose);
      if (ref === '') ref = label;
      const def = st.defs.get(normLabel(ref));
      if (def) { href = def.href; title = def.title; end = rclose + 1; }
    }
  }
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
  const inner = parseInline(r.label, { defs: st.defs, inLink: true, inA: st.inA });
  return { html: `<a href="${encodeHref(r.href)}"${r.title !== null ? ` title="${escAttrNE(r.title)}"` : ''}>${inner}</a>`, end: r.end };
}

function trimAutolink(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/[?!.,:*_~']+$/, '');
    // unbalanced close parens
    let open = 0, close = 0;
    for (const ch of s) { if (ch === '(') open++; else if (ch === ')') close++; }
    while (s.endsWith(')') && close > open) { s = s.slice(0, -1); close--; }
    if (s.endsWith(';')) {
      const m = /&[a-zA-Z0-9]+;$/.exec(s);
      if (m) s = s.slice(0, -1);
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
  while (i < n) {
    const c = src[i];
    if (c === '\\') {
      const d = src[i + 1];
      if (d === '\n') { pushHtml(st.plain ? '\n' : '<br>'); i += 2; continue; }
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
        if (tm[1] && name === 'a' && !raw.endsWith('/>')) st.inA = true;
        if (tm[2] && name === 'a') st.inA = false;
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
        }
      }
      txt += '['; i++; continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let run = 0; while (src[i + run] === c) run++;
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
    if (!st.inLink && !st.inA && (c === 'w' || c === 'h' || c === 'm' || c === 'x' || /[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]/.test(c))) {
      const prev = i > 0 ? src[i - 1] : undefined;
      const prevBad = prev !== undefined && /[a-zA-Z0-9_/.-]/.test(prev);
      if (!prevBad) {
        const rest = src.slice(i);
        let m = null, href = null, text = null;
        if (rest.startsWith('www.') || /^https?:\/\//.test(rest)) {
          m = BARE_URL_RE.exec(rest);
          if (m) {
            let cand = m[0];
            // cap at link-forming '[' (BARE_URL_RE already excludes brackets)
            cand = trimAutolink(cand);
            if (cand.length >= (rest.startsWith('www.') ? 5 : 8)) { text = cand; href = cand.startsWith('www.') ? 'http://' + cand : cand; }
            else m = null;
          }
        }
        if (!text && (rest.startsWith('mailto:') || rest.startsWith('xmpp:'))) {
          const mm = /^(?:mailto:|xmpp:)([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?)+)/.exec(rest);
          if (mm) { text = rest.slice(0, mm[0].length); href = text; }
        }
        if (!text) {
          const mm = BARE_EMAIL_RE.exec(rest);
          if (mm) {
            let cand = mm[0];
            // email must not be immediately followed by more domain chars
            text = cand; href = 'mailto:' + cand;
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
      opener = a; oi = j; break;
    }
    if (!opener) { ci++; continue; }
    const use = (opener.len >= 2 && closer.len >= 2) ? 2 : 1;
    opener.len -= use; closer.len -= use;
    const tag = closer.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
    const plainMode = atoms.plainMode;
    atoms.splice(ci, 0, { k: 'h', s: plainMode ? '' : `</${tag}>` });
    atoms.splice(oi + 1, 0, { k: 'h', s: plainMode ? '' : `<${tag}>` });
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
  return parseInline(src, { defs: st.defs, inLink: false, inA: false, plain: true });
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
  const cells = [];
  let cur = '', i = 0, codeRun = 0;
  if (s.startsWith('|')) { i = 1; }
  let endedWithPipe = false;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i += 2; endedWithPipe = false; continue; }
    if (c === '`') {
      let run = 0; while (s[i + run] === '`') run++;
      if (codeRun === 0) codeRun = run;
      else if (run === codeRun) codeRun = 0;
      cur += '`'.repeat(run); i += run; endedWithPipe = false; continue;
    }
    if (c === '|' && codeRun === 0) { cells.push(cur); cur = ''; i++; endedWithPipe = true; continue; }
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

// Strip one blockquote marker; returns content line (tabs expanded) or null.
function stripQuote(l) {
  let i = 0, col = 0;
  while (i < l.length && col < 4 && (l[i] === ' ' || l[i] === '\t')) {
    if (l[i] === ' ') { if (col >= 3) break; col++; i++; }
    else { col += 4 - (col % 4); i++; }
    if (col > 3 && l[i - 1] === ' ') break;
  }
  if (col > 3) return null;
  if (l[i] !== '>') return null;
  i++; col++;
  let rest = l.slice(i);
  if (rest.startsWith(' ')) { rest = rest.slice(1); col++; }
  else if (rest.startsWith('\t')) { rest = expandTabs(rest, col); rest = rest.slice(1); }
  return expandTabs(rest, col);
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
  else if (type7ok && (m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:[^"'=<>`\s]+|'[^']*'|"[^"]*"))?)*\s*\/?>[ \t]*$/.exec(s)) && !BLOCK_TAGS.has(m[2].toLowerCase())) type = 7;
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
  return { text: lines.slice(i, j).join('\n'), consumed: j - i };
}

function startsInterruptBlock(lines, j, defs) {
  const l = lines[j];
  if (matchFenceStart(l)) return true;
  if (matchATX(l)) return true;
  if (isHr(l)) return true;
  if (stripQuote(l) !== null) return true;
  if (tryHtmlBlock(lines, j, false)) return true;
  const lm = matchListMarker(l);
  if (lm && !lm.blankAfter) {
    // list interrupts paragraph only if content non-empty; ordered must start at 1
    if (!lm.ordered || lm.num === 1) {
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
  let cur = null; // {lines: [], }
  const sameKind = (mk) => first.ordered ? (mk.ordered && mk.delim === first.delim) : (!mk.ordered && mk.bullet === first.bullet);
  let pendingBlanks = 0;
  let inFence = null; // {ch, len}
  const finishItem = () => {
    if (cur) {
      while (cur.lines.length && isBlank(cur.lines[cur.lines.length - 1])) cur.lines.pop();
      items.push(cur);
      cur = null;
    }
  };
  while (j < lines.length) {
    const l = lines[j];
    if (cur === null) {
      const mk = matchListMarker(l);
      if (!mk || !sameKind(mk) || j === i && false) break;
      cur = { lines: [mk.blankAfter ? '' : dedentLine(lines[j].slice(mk.afterIdx), mk.contentIndent - mk.ind - mk.mlen, mk.ind + mk.mlen)], contentIndent: mk.contentIndent, startLine: j };
      pendingBlanks = 0; inFence = null;
      const f = matchFenceStart(mk.firstContent);
      if (f) inFence = f;
      j++;
      continue;
    }
    if (isBlank(l)) {
      // look ahead
      let k = j + 1;
      if (k >= lines.length) { j = k; break; }
      const nl = lines[k];
      if (isBlank(nl)) { j = k; break; } // two blanks end the list
      const nmk = matchListMarker(nl);
      const nind = leadCols(nl);
      if ((nmk && sameKind(nmk) && nind < cur.contentIndent) || nind >= cur.contentIndent || inFence) {
        pendingBlanks++;
        cur.lines.push('');
        j++;
        continue;
      }
      break; // blank then unrelated content: list ends
    }
    const ind = leadCols(l);
    if (inFence) {
      cur.lines.push(ind >= cur.contentIndent ? dedentLine(l, cur.contentIndent, 0) : l);
      if (isFenceClose(l, inFence.ch, inFence.len)) inFence = null;
      if (pendingBlanks) { loose = true; pendingBlanks = 0; }
      j++; continue;
    }
    if (ind >= cur.contentIndent) {
      if (pendingBlanks) { loose = true; pendingBlanks = 0; }
      const content = dedentLine(l, cur.contentIndent, 0);
      cur.lines.push(content);
      const f = matchFenceStart(content);
      if (f) inFence = f;
      j++; continue;
    }
    if (isHr(l)) break;
    const mk = matchListMarker(l);
    if (mk && sameKind(mk)) {
      if (pendingBlanks) loose = true;
      finishItem();
      continue; // reprocess line as new item
    }
    // lazy continuation: paragraph continuation text
    if (pendingBlanks === 0 && cur.lines.length && !isBlank(cur.lines[cur.lines.length - 1]) && !startsInterruptBlock(lines, j, defs)) {
      cur.lines.push(l);
      j++; continue;
    }
    break;
  }
  finishItem();
  if (!items.length) return null;
  // item separated by blank lines at its end counts toward looseness when
  // the blank was between this item's content and the next item
  return { token: { t: 'list', ordered: first.ordered, start: first.num, loose, items: items.map(it => ({ lines: it.lines })) }, next: j };
}

function lexBlocks(lines, defs, endsNl = false) {
  const tokens = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) { i++; continue; }
    // fenced code
    const fence = matchFenceStart(l);
    if (fence) {
      const content = [];
      let j = i + 1;
      while (j < lines.length && !isFenceClose(lines[j], fence.ch, fence.len)) {
        content.push(consumeCols(lines[j], Math.min(fence.indent, leadCols(lines[j]))));
        j++;
      }
      if (j < lines.length) j++; // closing fence
      const text = content.length ? content.join('\n') + '\n' : '';
      const lang = fence.info ? unescapeStr(fence.info.split(/\s+/)[0]) : '';
      tokens.push({ t: 'code', text, lang, fenced: true });
      i = j; continue;
    }
    // ATX heading
    const atx = matchATX(l);
    if (atx) { tokens.push({ t: 'heading', depth: atx.depth, text: atx.text }); i++; continue; }
    // thematic break
    if (isHr(l)) { tokens.push({ t: 'hr' }); i++; continue; }
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
      tokens.push({ t: 'code', text: content.join('\n') + '\n', lang: '', fenced: false });
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
        if (!isBlank(cl) && inner.length && !isBlank(inner[inner.length - 1]) && !startsInterruptBlock(lines, j, defs)) {
          inner.push(cl); j++; continue;
        }
        break;
      }
      tokens.push({ t: 'quote', lines: inner });
      i = j; continue;
    }
    // list
    if (matchListMarker(l)) {
      const r = parseList(lines, i, defs);
      if (r) { tokens.push(r.token); i = r.next; continue; }
    }
    // html block
    const hb = tryHtmlBlock(lines, i, true);
    if (hb) {
      const nx = i + hb.consumed;
      const addNl = nx < lines.length ? !isBlank(lines[nx]) : endsNl;
      tokens.push({ t: 'html', text: hb.text + (addNl ? '\n' : '') });
      i += hb.consumed; continue;
    }
    // link reference definition
    const def = tryDef(lines, i, defs);
    if (def) {
      const key = normLabel(def.label);
      if (!defs.has(key)) defs.set(key, { href: def.href, title: def.title });
      i += def.consumed; continue;
    }
    // paragraph (with setext + table detection)
    const plines = [];
    let j = i;
    let heading = null, table = null;
    while (j < lines.length) {
      const cl = lines[j];
      if (isBlank(cl)) break;
      if (plines.length) {
        // setext underline?
        if (leadCols(cl) <= 3) {
          const s = cl.slice(leadIdx(cl));
          if (/^=+[ \t]*$/.test(s)) { heading = { depth: 1 }; j++; break; }
          if (/^-+[ \t]*$/.test(s)) { heading = { depth: 2 }; j++; break; }
        }
        if (startsInterruptBlock(lines, j, defs)) break;
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
      if (plines.length) tokens.push({ t: 'para', text: plines.join('\n') });
      const rows = [];
      let rj = table.startLine + 2;
      while (rj < lines.length && !isBlank(lines[rj]) && !startsInterruptBlock(lines, rj, defs)) {
        rows.push(splitRow(lines[rj]));
        rj++;
      }
      tokens.push({ t: 'table', header: table.header, aligns: table.aligns, rows });
      i = rj; continue;
    }
    if (heading) { tokens.push({ t: 'heading', depth: heading.depth, text: plines.join('\n').trim() }); i = j; continue; }
    if (plines.length) { tokens.push({ t: 'para', text: plines.join('\n') }); i = j; continue; }
    i++; // safety
  }
  return tokens;
}

function renderTokens(tokens, defs) {
  let out = '';
  for (const tok of tokens) out += renderToken(tok, defs, false);
  return out;
}

function renderToken(tok, defs, tight) {
  switch (tok.t) {
    case 'heading':
      return `<h${tok.depth}>${parseInline(tok.text, { defs, inLink: false, inA: false })}</h${tok.depth}>\n`;
    case 'para': {
      const inner = parseInline(tok.text, { defs, inLink: false, inA: false });
      return tight ? inner : `<p>${inner}</p>\n`;
    }
    case 'code':
      return `<pre><code${tok.lang ? ` class="language-${escAttrNE(tok.lang)}"` : ''}>${escCode(tok.text)}</code></pre>\n`;
    case 'hr': return '<hr>\n';
    case 'html': return tok.text;
    case 'quote': {
      const inner = lexBlocks(tok.lines, defs);
      return `<blockquote>\n${renderTokens(inner, defs)}</blockquote>\n`;
    }
    case 'list': {
      const tag = tok.ordered ? 'ol' : 'ul';
      const startAttr = tok.ordered && tok.start !== 1 ? ` start="${tok.start}"` : '';
      let out = `<${tag}${startAttr}>\n`;
      for (const item of tok.items) out += renderListItem(item, tok, defs);
      out += `</${tag}>\n`;
      return out;
    }
    case 'table': {
      let out = '<table>\n<thead>\n<tr>\n';
      tok.header.forEach((cell, k) => {
        out += `<th${tok.aligns[k] ? ` align="${tok.aligns[k]}"` : ''}>${parseInline(cell, { defs, inLink: false, inA: false })}</th>\n`;
      });
      out += '</tr>\n</thead>\n';
      if (tok.rows.length) {
        out += '<tbody>';
        for (const row of tok.rows) {
          out += '<tr>\n';
          for (let k = 0; k < tok.header.length; k++) {
            const cell = row[k] ?? '';
            out += `<td${tok.aligns[k] ? ` align="${tok.aligns[k]}"` : ''}>${parseInline(cell, { defs, inLink: false, inA: false })}</td>\n`;
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

function renderListItem(item, list, defs) {
  const tokens = lexBlocks(item.lines, defs);
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
    let r = renderToken(tok, defs, !list.loose);
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
  return renderTokens(tokens, defs);
}
