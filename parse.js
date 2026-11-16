// A from-scratch Markdown renderer that mirrors the HTML output of
// marked 18.1.3 with default options (gfm: true, breaks: false,
// pedantic: false), written as an original two-phase parser:
// block structure first (container stack over lines), then inline
// parsing with a delimiter stack. No dependencies.

// ---------------------------------------------------------------- helpers

const ASCII_PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

function isPunct(ch) {
  return ch !== undefined && ASCII_PUNCT.indexOf(ch) !== -1;
}
function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' ||
    ch === '\f' || ch === '\v' || ch === ' ' || ch === '\uFEFF';
}
function isAlnum(ch) {
  if (ch === undefined) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c > 127;
}

// Escape text-node content the way an HTML serializer for marked does:
// ampersands that do not begin a character reference are escaped by the
// inline layer before this is called on plain runs; here we escape < > &.
function escText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escAttr(s) {
  return s.replace(/&(?!(?:#[0-9]+|#[xX][0-9a-fA-F]+|[0-9a-zA-Z]+);)/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escCode(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Decode one numeric character reference body (the part between &# and ;).
// Returns the decoded string, or null when the body is not numeric.
function decodeNumeric(body) {
  let cp;
  if (body[1] === 'x' || body[1] === 'X') {
    if (!/^[0-9a-fA-F]+$/.test(body.slice(2))) return null;
    cp = parseInt(body.slice(2), 16);
  } else {
    if (!/^[0-9]+$/.test(body.slice(1))) return null;
    cp = parseInt(body.slice(1), 10);
  }
  if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '�';
  return String.fromCodePoint(cp);
}

// Try to read a character reference at s[i] === '&'.
// Returns {len, out} where out is the HTML to emit, or null.
// Marked passes named references through untouched, decodes numeric ones,
// and leaves a bare '&' to be escaped by the caller.
function charRef(s, i) {
  let j = i + 1;
  if (s[j] === '#') {
    j++;
    if (s[j] === 'x' || s[j] === 'X') {
      j++;
      const st = j;
      while (j < s.length && /[0-9a-fA-F]/.test(s[j])) j++;
      if (j === st || j - st > 6 || s[j] !== ';') return null;
      const cp = parseInt(s.slice(st, j), 16);
      const out = (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF))
        ? '�' : String.fromCodePoint(cp);
      return { len: j - i + 1, out: out === '"' ? '&quot;' : out === '&' ? '&amp;' : out === '<' ? '&lt;' : out === '>' ? '&gt;' : out };
    }
    const st = j;
    while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
    if (j === st || j - st > 7 || s[j] !== ';') return null;
    const cp = parseInt(s.slice(st, j), 10);
    const out = (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF))
      ? '�' : String.fromCodePoint(cp);
    return { len: j - i + 1, out: out === '"' ? '&quot;' : out === '&' ? '&amp;' : out === '<' ? '&lt;' : out === '>' ? '&gt;' : out };
  }
  // named reference: letters/digits then ';' — emitted verbatim.
  const st = j;
  while (j < s.length && /[0-9a-zA-Z]/.test(s[j])) j++;
  if (j > st && s[j] === ';') return { len: j - i + 1, out: s.slice(i, j + 1) };
  return null;
}

// Decode character references inside a link destination or title (raw,
// unescaped result; the caller re-escapes for the attribute context).
function decodeRefsRaw(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '&') {
      const r = charRef(s, i);
      if (r) {
        // undo the HTML escaping charRef applied for text context
        out += r.out === '&quot;' ? '"' : r.out === '&amp;' ? '&'
          : r.out === '&lt;' ? '<' : r.out === '&gt;' ? '>' : r.out;
        i += r.len;
        continue;
      }
    }
    out += s[i];
    i++;
  }
  return out;
}

// Marked cleans a link destination: it percent-encodes a small set of
// characters and leaves the rest alone.
function cleanUrl(href) {
  try {
    href = encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
  return href;
}

function normalizeLabel(s) {
  return s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
    .replace(/[\t\n\v\f\r ]+/g, ' ').replace(/^ | $/g, '').toLowerCase();
}

// ---------------------------------------------------------------- inline

// Inline node kinds:
//  {k:'text', s}       raw source text (escaped at render)
//  {k:'raw', s}        finished HTML (code spans, html, autolinks, breaks)
//  {k:'delim', ch, n, canOpen, canClose, active}  emphasis/bracket run
//  {k:'wrap', tag, children, href, title}         emph/strong/del/link/image

const TAG_NAME = '[A-Za-z][A-Za-z0-9-]*';
const ATTR = '(?:\\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\\s*=\\s*(?:[^ \'"=<>`]+|\'[^\']*\'|"[^"]*"))?)';
const OPEN_TAG = new RegExp('^<' + TAG_NAME + ATTR + '*\\s*/?>');
const CLOSE_TAG = new RegExp('^</' + TAG_NAME + '\\s*>');
const AUTOLINK_RE = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^ <>\x00-\x20]*)>/;
const EMAILLINK_RE = /^<([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;

// GFM extended autolink pieces (used while scanning plain text).
const WWW_RE = /^www\.[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?:[^\s<]*)?/;
const HTTP_RE = /^https?:\/\/[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*(?:[^\s<]*)?/;
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/;

// Trim an extended autolink per GFM rules: drop trailing punctuation,
// drop a trailing ')' when parens are unbalanced, stop before '<',
// drop trailing '&word;' entity-looking tail.
function trimAutolink(url) {
  for (;;) {
    if (url.length === 0) return url;
    const last = url[url.length - 1];
    if ('?!.,:*_~'.includes(last)) { url = url.slice(0, -1); continue; }
    if (last === ';') {
      const m = /&[0-9a-zA-Z]+;$/.exec(url);
      if (m) { url = url.slice(0, url.length - m[0].length); continue; }
      url = url.slice(0, -1); continue;
    }
    if (last === ')') {
      let open = 0, close = 0;
      for (const c of url) { if (c === '(') open++; else if (c === ')') close++; }
      if (close > open) { url = url.slice(0, -1); continue; }
    }
    if (last === ']') {
      let open = 0, close = 0;
      for (const c of url) { if (c === '[') open++; else if (c === ']') close++; }
      if (close > open) { url = url.slice(0, -1); continue; }
    }
    return url;
  }
}

// Can an extended autolink start at this point? GFM: the character before
// must be start-of-text, whitespace, or one of * _ ~ ( [ { " ' etc. — in
// practice: not alphanumeric and not part of a preceding word/email.
function autolinkBoundary(s, i) {
  if (i === 0) return true;
  const p = s[i - 1];
  return !isAlnum(p) && p !== '@' && p !== '.' && p !== '-' && p !== '_' && p !== '/' && p !== '#';
}

class InlineParser {
  constructor(refs) {
    this.refs = refs; // Map normalized label -> {href, title}
  }

  parse(src) {
    this.s = src;
    this.n = src.length;
    this.pos = 0;
    this.nodes = [];
    this.delims = []; // stack of delim nodes (subset of nodes)
    this.text = '';   // pending raw text buffer
    this.parseLoop();
    this.flushText();
    this.processEmphasis(null);
    return renderNodes(this.nodes);
  }

  flushText() {
    if (this.text) {
      this.nodes.push({ k: 'text', s: this.text });
      this.text = '';
    }
  }
  pushRaw(html) {
    this.flushText();
    this.nodes.push({ k: 'raw', s: html });
  }

  parseLoop() {
    const s = this.s;
    while (this.pos < this.n) {
      const i = this.pos;
      const c = s[i];
      if (c === '\\') { this.doBackslash(); continue; }
      if (c === '`') { this.doCodeSpan(); continue; }
      if (c === '<') { if (this.doAngle()) continue; this.text += '<'; this.pos++; continue; }
      if (c === '&') {
        const r = charRef(s, i);
        if (r) { this.pushRaw(r.out); this.pos += r.len; continue; }
        this.text += '&'; this.pos++; continue;
      }
      if (c === '!') {
        if (s[i + 1] === '[') { this.pushBracket(true); this.pos += 2; continue; }
        this.text += '!'; this.pos++; continue;
      }
      if (c === '[') { this.pushBracket(false); this.pos++; continue; }
      if (c === ']') { if (this.doCloseBracket()) continue; this.text += ']'; this.pos++; continue; }
      if (c === '*' || c === '_' || c === '~') { this.doDelimRun(c); continue; }
      if (c === '\n') {
        // hard break: two spaces or more before the newline
        let sp = 0;
        let t = this.text;
        while (sp < t.length && t[t.length - 1 - sp] === ' ') sp++;
        if (sp >= 2) {
          this.text = t.slice(0, t.length - sp);
          this.pushRaw('<br>');
        } else {
          this.pushRaw('\n');
        }
        this.pos++;
        continue;
      }
      // plain text run: consume until the next special character, watching
      // for extended autolinks that begin mid-run.
      this.doTextRun();
    }
  }

  doTextRun() {
    const s = this.s, n = this.n;
    let i = this.pos;
    let buf = '';
    while (i < n) {
      const c = s[i];
      if (c === '\\' || c === '`' || c === '<' || c === '&' || c === '!' ||
          c === '[' || c === ']' || c === '*' || c === '_' || c === '~' || c === '\n') break;
      // extended autolink candidates inside text
      if ((c === 'w' || c === 'h' || isAlnum(c) || c === '.' || c === '+' || c === '-') &&
          autolinkBoundary(s, i)) {
        const link = this.tryExtendedAutolink(i);
        if (link) {
          this.text += buf;
          this.pushRaw(link.html);
          this.pos = i + link.len;
          // any text consumed by the match beyond the url (none) — done
          return;
        }
      }
      buf += c;
      i++;
    }
    this.text += buf;
    this.pos = i;
  }

  // Returns {len, html} for an extended autolink at position i, or null.
  tryExtendedAutolink(i) {
    const s = this.s;
    const rest = s.slice(i, Math.min(this.n, i + 500));
    let m = null, href = null, isWww = false;
    if (rest.startsWith('www.')) { m = WWW_RE.exec(rest); isWww = true; }
    else if (rest.startsWith('http://') || rest.startsWith('https://')) m = HTTP_RE.exec(rest);
    if (m) {
      let url = trimAutolink(m[0]);
      if (url === 'www.' || url.endsWith('://')) return null;
      href = isWww ? 'http://' + url : url;
      const clean = cleanUrl(href);
      if (clean === null) return null;
      return { len: url.length, html: '<a href="' + escAttr(clean) + '">' + escText(url) + '</a>' };
    }
    m = EMAIL_RE.exec(rest);
    if (m) {
      const url = m[0];
      const after = rest[url.length];
      // a domain that continues with - or _ is not a valid email autolink
      if (after === '-' || after === '_') return null;
      const clean = cleanUrl('mailto:' + url);
      if (clean === null) return null;
      return { len: url.length, html: '<a href="' + escAttr(clean) + '">' + escText(url) + '</a>' };
    }
    // mailto: / xmpp: style — whole "scheme:local@domain" as one link
    m = /^(?:mailto|xmpp):/.exec(rest);
    if (m) {
      const inner = EMAIL_RE.exec(rest.slice(m[0].length));
      if (inner) {
        let url = m[0] + inner[0];
        let after = rest[url.length];
        if (after === '-' || after === '_') return null;
        // xmpp may carry one /resource segment (no second slash)
        if (m[0] === 'xmpp:' && after === '/') {
          const seg = /^\/[^\s</]+/.exec(rest.slice(url.length));
          if (seg) {
            let cand = url + trimAutolink(seg[0].slice(1)).replace(/^/, '/');
            // resource keeps everything up to the next slash; trimAutolink
            // on the segment alone handles trailing punctuation
            url = cand;
            after = rest[url.length];
            if (after === '/') { /* a second slash ends the link here */ }
          }
        }
        const clean = cleanUrl(url);
        if (clean === null) return null;
        return { len: url.length, html: '<a href="' + escAttr(clean) + '">' + escText(url) + '</a>' };
      }
    }
    return null;
  }

  doBackslash() {
    const s = this.s, i = this.pos;
    const nx = s[i + 1];
    if (nx === '\n') { this.pushRaw('<br>'); this.pos += 2; return; }
    if (nx !== undefined && isPunct(nx)) { this.text += nx; this.pos += 2; return; }
    this.text += '\\'; this.pos++;
  }

  doCodeSpan() {
    const s = this.s, n = this.n;
    let i = this.pos;
    let run = 0;
    while (s[i + run] === '`') run++;
    // find a matching run of exactly `run` backticks
    let j = i + run;
    while (j < n) {
      if (s[j] === '`') {
        let r2 = 0;
        while (s[j + r2] === '`') r2++;
        if (r2 === run) {
          let code = s.slice(i + run, j).replace(/\n/g, ' ');
          if (code.length >= 2 && code[0] === ' ' && code[code.length - 1] === ' ' &&
              code.trim() !== '') {
            code = code.slice(1, -1);
          }
          this.pushRaw('<code>' + escCode(code) + '</code>');
          this.pos = j + run;
          return;
        }
        j += r2;
      } else j++;
    }
    this.text += s.slice(i, i + run);
    this.pos = i + run;
  }

  // '<' constructs: autolink, html tag/comment/etc. Returns true if handled.
  doAngle() {
    const s = this.s, i = this.pos;
    const rest = s.slice(i);
    let m = AUTOLINK_RE.exec(rest);
    if (m) {
      const clean = cleanUrl(m[1]);
      if (clean !== null) {
        this.pushRaw('<a href="' + escAttr(clean) + '">' + escText(m[1]) + '</a>');
        this.pos += m[0].length;
        return true;
      }
    }
    m = EMAILLINK_RE.exec(rest);
    if (m) {
      const clean = cleanUrl('mailto:' + m[1]);
      if (clean !== null) {
        this.pushRaw('<a href="' + escAttr(clean) + '">' + escText(m[1]) + '</a>');
        this.pos += m[0].length;
        return true;
      }
    }
    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->', 4);
      if (end !== -1) { this.pushRaw(rest.slice(0, end + 3)); this.pos += end + 3; return true; }
    }
    if (rest.startsWith('<?')) {
      const end = rest.indexOf('?>', 2);
      if (end !== -1) { this.pushRaw(rest.slice(0, end + 2)); this.pos += end + 2; return true; }
    }
    if (rest.startsWith('<![CDATA[')) {
      const end = rest.indexOf(']]>', 9);
      if (end !== -1) { this.pushRaw(rest.slice(0, end + 3)); this.pos += end + 3; return true; }
    }
    if (/^<![A-Z]/.test(rest)) {
      const end = rest.indexOf('>', 2);
      if (end !== -1) { this.pushRaw(rest.slice(0, end + 1)); this.pos += end + 1; return true; }
    }
    m = OPEN_TAG.exec(rest) || CLOSE_TAG.exec(rest);
    if (m) { this.pushRaw(m[0]); this.pos += m[0].length; return true; }
    return false;
  }

  pushBracket(isImage) {
    this.flushText();
    const node = { k: 'delim', ch: '[', n: 1, canOpen: true, canClose: false, active: true, image: isImage, srcPos: this.pos };
    this.nodes.push(node);
    this.delims.push(node);
  }

  // ']' at this.pos. Try to form a link or image. Returns true if consumed.
  doCloseBracket() {
    const s = this.s;
    // find nearest active '[' opener
    let oi = -1;
    for (let d = this.delims.length - 1; d >= 0; d--) {
      const dl = this.delims[d];
      if (dl.ch === '[' && dl.active) { oi = d; break; }
    }
    if (oi === -1) return false;
    const opener = this.delims[oi];
    const nodeIdx = this.nodes.indexOf(opener);
    const after = this.pos + 1; // just past ']'
    const linkTextEnd = this.pos;
    let dest = null, title = null, endPos = -1, refLabel = null;

    const tail = this.parseLinkTail(after);
    if (tail) {
      dest = tail.href; title = tail.title; endPos = tail.end;
    } else {
      // reference forms: [label] or shortcut
      if (s[after] === '[') {
        const lab = this.parseLinkLabel(after);
        if (lab) {
          refLabel = lab.label === '' ? null : lab.label;
          endPos = lab.end;
          if (lab.label === '') refLabel = null; // collapsed: use link text
        }
      }
      if (endPos === -1) { endPos = after; refLabel = null; }
      const labelText = refLabel !== null ? refLabel
        : this.sourceTextBetween(opener, linkTextEnd);
      const ref = this.refs.get(normalizeLabel(labelText));
      if (!ref) {
        // not a link: deactivate opener, leave ']' as text
        opener.active = false;
        if (!opener.image) {
          // a plain '[' that fails stays; nothing else changes
        }
        return false;
      }
      dest = ref.href; title = ref.title;
    }

    // success: first settle emphasis inside the bracket text, then wrap
    this.flushText();
    this.processEmphasis(opener);
    const nIdx2 = this.nodes.indexOf(opener);
    const inner = this.nodes.splice(nIdx2 + 1);
    this.nodes.splice(nIdx2, 1); // remove opener
    // delim entries above the opener now live inside the link; retire them
    const oiNow = this.delims.indexOf(opener);
    this.delims = this.delims.filter((d, ix) => ix < oiNow);
    let node;
    if (opener.image) {
      const alt = renderPlainText(inner);
      const clean = cleanUrl(dest);
      node = { k: 'raw', s: '<img src="' + escAttr(clean === null ? dest : clean) + '" alt="' + escAttr(alt) + '"' +
        (title !== null ? ' title="' + escAttr(title) + '"' : '') + '>' };
      this.nodes.push(node);
    } else {
      const clean = cleanUrl(dest);
      node = { k: 'wrap', tag: 'a', href: clean === null ? dest : clean, title, children: inner };
      this.nodes.push(node);
      // deactivate earlier '[' openers (links cannot contain links)
      for (const d of this.delims) if (d.ch === '[' && !d.image) d.active = false;
    }
    this.pos = endPos;
    return true;
  }

  // The raw source text between the opener '[' and position end (used as a
  // reference label for shortcut/collapsed references). The opener node was
  // pushed when pos pointed just after '['; we stored it on the node.
  sourceTextBetween(opener, end) {
    return this.s.slice(opener.srcPos + (opener.image ? 2 : 1), end);
  }

  // Parse [label] starting at s[i] === '['. Returns {label, end} or null.
  parseLinkLabel(i) {
    const s = this.s, n = this.n;
    let j = i + 1, depth = 1, label = '';
    while (j < n) {
      const c = s[j];
      if (c === '\\' && isPunct(s[j + 1])) { label += s.slice(j, j + 2); j += 2; continue; }
      if (c === '[') { depth++; if (depth > 1) return null; label += c; j++; continue; }
      if (c === ']') {
        depth--;
        if (depth === 0) {
          if (label.length > 999) return null;
          return { label, end: j + 1 };
        }
        label += c; j++; continue;
      }
      label += c; j++;
      if (j - i > 1000) return null;
    }
    return null;
  }

  // Parse "( dest "title" )" starting at s[i] === '('. Returns
  // {href, title, end} or null.
  parseLinkTail(i) {
    const s = this.s, n = this.n;
    if (s[i] !== '(') return null;
    let j = i + 1;
    while (j < n && isSpace(s[j])) j++;
    let href = '';
    if (s[j] === '<') {
      // angle destination: no newlines, no unescaped < >
      let k = j + 1, ok = false;
      while (k < n) {
        const c = s[k];
        if (c === '\\' && isPunct(s[k + 1])) { href += s[k + 1]; k += 2; continue; }
        if (c === '>') { ok = true; break; }
        if (c === '<' || c === '\n') return null;
        href += c; k++;
      }
      if (!ok) return null;
      j = k + 1;
    } else {
      // bare destination: balanced parens, no spaces/controls
      let depth = 0;
      while (j < n) {
        const c = s[j];
        if (c === '\\' && isPunct(s[j + 1])) { href += s[j + 1]; j += 2; continue; }
        if (c === '(') { depth++; href += c; j++; continue; }
        if (c === ')') {
          if (depth === 0) break;
          depth--; href += c; j++; continue;
        }
        if (isSpace(c) || c === '\x00') break;
        if (c.charCodeAt(0) < 0x20) break;
        href += c; j++;
      }
      if (depth > 0) return null;
    }
    href = decodeRefsRaw(href);
    // optional title, separated by whitespace
    let k = j;
    let sawSpace = false;
    while (k < n && isSpace(s[k])) { sawSpace = true; k++; }
    let title = null;
    if (sawSpace && (s[k] === '"' || s[k] === "'" || s[k] === '(')) {
      const open = s[k];
      const close = open === '(' ? ')' : open;
      let t = '', q = k + 1, ok = false;
      while (q < n) {
        const c = s[q];
        if (c === '\\' && isPunct(s[q + 1])) { t += s[q + 1]; q += 2; continue; }
        if (open === '(' && c === '(') return null;
        if (c === close) { ok = true; break; }
        t += c; q++;
      }
      if (!ok) return null;
      title = decodeRefsRaw(t);
      k = q + 1;
      while (k < n && isSpace(s[k])) k++;
    } else {
      k = j;
      while (k < n && isSpace(s[k])) k++;
    }
    if (s[k] !== ')') return null;
    return { href, title, end: k + 1 };
  }

  doDelimRun(c) {
    const s = this.s, n = this.n;
    let i = this.pos;
    let run = 0;
    while (s[i + run] === c) run++;
    const before = i === 0 ? '\n' : s[i - 1];
    const after = i + run >= n ? '\n' : s[i + run];
    const beforePunct = isPunct(before), afterPunct = isPunct(after);
    const beforeSpace = isSpace(before), afterSpace = isSpace(after);
    const leftFlank = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
    const rightFlank = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
    let canOpen, canClose;
    if (c === '_') {
      canOpen = leftFlank && (!rightFlank || beforePunct);
      canClose = rightFlank && (!leftFlank || afterPunct);
    } else {
      canOpen = leftFlank;
      canClose = rightFlank;
    }
    if (c === '~') {
      // strikethrough uses runs of 1 or 2 only in effect; keep the run but
      // only allow it to act when its length is 1 or 2.
      if (run > 2) { this.text += s.slice(i, i + run); this.pos = i + run; return; }
    }
    this.flushText();
    const node = { k: 'delim', ch: c, n: run, orig: run, canOpen, canClose, active: true };
    this.nodes.push(node);
    this.delims.push(node);
    this.pos = i + run;
  }

  // Standard delimiter-stack emphasis processing. `bottom` is the delim
  // node to stop at (exclusive), or null for the whole stack.
  processEmphasis(bottom) {
    let closerIdx = 0;
    // find first potential closer above bottom
    const stack = this.delims;
    let bi = bottom ? stack.indexOf(bottom) : -1;
    let ci = bi + 1;
    while (ci < stack.length) {
      const closer = stack[ci];
      if (closer.k !== 'delim' || closer.ch === '[' || !closer.canClose || closer.n === 0) { ci++; continue; }
      // find nearest matching opener below closer, above bottom
      let oi = ci - 1, opener = null;
      while (oi > bi) {
        const cand = stack[oi];
        if (cand.ch === closer.ch && cand.canOpen && cand.n > 0) {
          // rule of three
          if (!((closer.canOpen || cand.canClose) &&
                (cand.orig + closer.orig) % 3 === 0 &&
                !(cand.orig % 3 === 0 && closer.orig % 3 === 0))) {
            opener = cand;
            break;
          }
        }
        oi--;
      }
      if (!opener) { ci++; continue; }
      // determine strength: strikethrough takes what it takes
      let use;
      if (closer.ch === '~') use = Math.min(opener.n, closer.n);
      else use = (opener.n >= 2 && closer.n >= 2) ? 2 : 1;
      // wrap nodes between opener and closer
      const ni = this.nodes.indexOf(opener);
      const nj = this.nodes.indexOf(closer);
      const inner = this.nodes.slice(ni + 1, nj);
      const tag = closer.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
      const wrap = { k: 'wrap', tag, children: inner };
      this.nodes.splice(ni + 1, nj - ni - 1, wrap);
      // delims strictly between are discarded
      for (let d = oi + 1; d < ci; d++) stack[d].dead = true;
      opener.n -= use;
      closer.n -= use;
      if (opener.n === 0) { opener.dead = true; }
      if (closer.n === 0) { closer.dead = true; ci++; }
      // clean dead entries (keep indexes sane by rebuilding)
      for (let d = stack.length - 1; d > bi; d--) {
        if (stack[d].dead) {
          const nd = stack[d];
          if (nd.n === 0 && nd.ch !== '[') {
            const ix = this.nodes.indexOf(nd);
            if (ix !== -1) this.nodes.splice(ix, 1);
          }
          stack.splice(d, 1);
          if (d < ci) ci--;
        }
      }
      bi = bottom ? stack.indexOf(bottom) : -1;
    }
    // any leftover delims above bottom become plain text (handled at render)
    if (bottom === null) {
      this.delims = this.delims.filter(d => d.ch === '[');
    }
  }
}

function renderNodes(nodes) {
  let out = '';
  for (const nd of nodes) out += renderNode(nd);
  return out;
}
function renderNode(nd) {
  switch (nd.k) {
    case 'text': return escText(nd.s);
    case 'raw': return nd.s;
    case 'delim': return nd.ch.repeat(nd.n);
    case 'wrap': {
      const inner = renderNodes(nd.children);
      if (nd.tag === 'a') {
        return '<a href="' + escAttr(nd.href) + '"' +
          (nd.title !== null && nd.title !== undefined ? ' title="' + escAttr(nd.title) + '"' : '') +
          '>' + inner + '</a>';
      }
      return '<' + nd.tag + '>' + inner + '</' + nd.tag + '>';
    }
  }
  return '';
}
// Plain-text rendering for image alt text: strip markup, keep text.
function renderPlainText(nodes) {
  let out = '';
  for (const nd of nodes) {
    if (nd.k === 'text') out += nd.s;
    else if (nd.k === 'delim') out += nd.ch.repeat(nd.n);
    else if (nd.k === 'wrap') out += renderPlainText(nd.children);
    else if (nd.k === 'raw') {
      // code spans carry finished html; recover their text roughly
      const m = /^<code>([\s\S]*)<\/code>$/.exec(nd.s);
      if (m) out += m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }
  }
  return out;
}

// ---------------------------------------------------------------- blocks

// A cursor over one source line, tracking char offset and column with
// CommonMark tab semantics (tab advances to the next multiple of 4; a
// tab may be partially consumed, leaving virtual spaces).
function makeCursor(line) {
  return { line, off: 0, col: 0, partial: 0 };
}
function curPeek(cur) {
  if (cur.partial > 0) return ' ';
  return cur.off < cur.line.length ? cur.line[cur.off] : undefined;
}
function curRest(cur) {
  return ' '.repeat(cur.partial) + cur.line.slice(cur.off);
}
function curAdvance(cur, cols) {
  let n = cols;
  while (n > 0) {
    if (cur.partial > 0) {
      const take = Math.min(n, cur.partial);
      cur.partial -= take; cur.col += take; n -= take;
      continue;
    }
    if (cur.off >= cur.line.length) return;
    const ch = cur.line[cur.off];
    if (ch === '\t') {
      const w = 4 - (cur.col % 4);
      if (n >= w) { cur.off++; cur.col += w; n -= w; }
      else { cur.off++; cur.partial = w - n; cur.col += n; n = 0; }
    } else { cur.off++; cur.col++; n--; }
  }
}
function curIndent(cur) {
  // columns until the next non-space character (Infinity-ish if blank)
  let col = cur.col, partial = cur.partial, off = cur.off;
  const line = cur.line;
  if (partial > 0) { col += partial; partial = 0; }
  while (off < line.length) {
    const ch = line[off];
    if (ch === ' ') { col++; off++; }
    else if (ch === '\t') { col += 4 - (col % 4); off++; }
    else break;
  }
  return col - cur.col;
}
function curBlank(cur) {
  if (cur.partial > 0) return cur.line.slice(cur.off).trim() === '';
  return cur.line.slice(cur.off).trim() === '';
}
function curSkipSpaces(cur, maxCols) {
  let adv = 0;
  while (adv < maxCols) {
    const p = curPeek(cur);
    if (p !== ' ' && p !== '\t') break;
    // advancing one column at a time keeps tab math simple
    curAdvance(cur, 1);
    adv++;
  }
  return adv;
}

let BLOCK_ID = 0;
function newBlock(type, parent) {
  const b = { type, children: [], parent: parent || null, id: BLOCK_ID++,
    lastLineBlank: false, text: '', lines: null };
  if (parent) parent.children.push(b);
  return b;
}

const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param section source summary table tbody td tfoot th thead title tr track ul').split(' '));

// Try an HTML block start on the cursor's rest. Returns {type, endTag} or
// null. type 1..7 per CommonMark; endTag for type 1.
function htmlBlockStart(rest, inParagraph) {
  if (rest[0] !== '<') return null;
  let m;
  if ((m = /^<(pre|script|style|textarea)(?=[\s>]|\/>|$)/i.exec(rest))) {
    return { type: 1, endTag: '</' + m[1].toLowerCase() };
  }
  if (rest.startsWith('<!--')) return { type: 2 };
  if (rest.startsWith('<?')) return { type: 3 };
  if (/^<![A-Z]/.test(rest)) return { type: 4 };
  if (rest.startsWith('<![CDATA[')) return { type: 5 };
  if ((m = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s>]|\/>|$)/.exec(rest)) &&
      BLOCK_TAGS.has(m[1].toLowerCase())) {
    return { type: 6 };
  }
  if (!inParagraph) {
    if (OPEN_TAG.test(rest) || CLOSE_TAG.test(rest)) {
      // the rest of the line after the tag must be only whitespace
      const mm = (OPEN_TAG.exec(rest) || CLOSE_TAG.exec(rest));
      if (/^[ \t]*$/.test(rest.slice(mm[0].length))) return { type: 7 };
    }
  }
  return null;
}

// Parse a list marker at the cursor. Returns
// {bullet:char} or {ordered:true, num, delim} plus width in columns of the
// marker itself, or null.
function listMarker(cur) {
  const rest = curRest(cur);
  let m = /^([-+*])(?=[ \t]|$)/.exec(rest);
  if (m) return { bullet: m[1], width: 1 };
  m = /^([0-9]{1,9})([.)])(?=[ \t]|$)/.exec(rest);
  if (m) return { ordered: true, num: parseInt(m[1], 10), delim: m[2], width: m[1].length + 1 };
  return null;
}

class BlockParser {
  constructor() {
    this.refs = new Map();
  }

  parse(src) {
    this.doc = newBlock('doc', null);
    this.open = [this.doc];
    this.prevBlank = false;
    const lines = src.split('\n');
    const noFinalNl = src.length > 0 && src[src.length - 1] !== '\n';
    if (!noFinalNl && lines.length) lines.pop(); // trailing '' is the terminator, not a line
    for (let li = 0; li < lines.length; li++) {
      this.isFinalLine = noFinalNl && li === lines.length - 1;
      this.incorporateLine(lines[li], li === lines.length - 1);
    }
    // close everything
    this.closeDownTo(0);
    // extract link reference definitions from paragraphs (document order)
    this.extractDefs(this.doc);
    return this.doc;
  }

  deepest() { return this.open[this.open.length - 1]; }

  closeDownTo(idx) {
    while (this.open.length - 1 > idx) {
      const b = this.open.pop();
      this.finalize(b);
    }
  }

  finalize(b) {
    if (b.type === 'code') {
      // strip trailing blank lines of indented code
      if (!b.fenced) {
        b.text = b.text.replace(/\n+$/, '') ;
        if (b.text) b.text += '\n';
      }
    } else if (b.type === 'list') {
      b.loose = false;
      const items = b.children;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (i < items.length - 1 && endsBlank(item)) b.loose = true;
        for (let j = 0; j < item.children.length - 1; j++) {
          if (endsBlank(item.children[j])) b.loose = true;
        }
        // an item whose last child ends blank and item has a next sibling
        // is covered above; also a child ending blank followed by sibling
      }
      for (const item of items) item.parentList = b;
    }
  }

  incorporateLine(line, isLast) {
    const cur = makeCursor(line);
    const open = this.open;
    // ---- match open containers
    let matched = 0; // index into open of last matched container
    let i = 1;
    let containerFailed = false;
    for (; i < open.length; i++) {
      const b = open[i];
      if (b.type === 'quote') {
        const ind = curIndent(cur);
        if (ind <= 3 && curRest(cur)[ind === 0 ? 0 : 0] !== undefined) {
          // advance past indent then expect '>'
          const save = { ...cur };
          curSkipSpaces(cur, 3);
          if (curPeek(cur) === '>') {
            curAdvance(cur, 1);
            if (curPeek(cur) === ' ' || curPeek(cur) === '\t') curAdvance(cur, 1);
            matched = i;
            continue;
          }
          Object.assign(cur, save);
        }
        containerFailed = true;
        break;
      } else if (b.type === 'item') {
        if (curBlank(cur)) {
          // blank line: item matches, cursor to first non-space
          curSkipSpaces(cur, 99);
          matched = i;
          continue;
        }
        const ind = curIndent(cur);
        if (ind >= b.padding) {
          curAdvance(cur, b.padding);
          matched = i;
          continue;
        }
        containerFailed = true;
        break;
      } else if (b.type === 'list') {
        matched = i;
        continue;
      } else {
        // a leaf block is open; containers are done matching
        break;
      }
    }
    const blank = curBlank(cur);
    const deep = this.deepest();

    // ---- lazy paragraph continuation: only when the line would not
    // itself start a block that interrupts the paragraph. A lazy '='
    // setext underline never forms a heading; it stays literal text
    // (with a four-space prefix when the paragraph sits directly in a
    // blockquote and already has two or more lines).
    if (containerFailed && deep.type === 'para' && !blank) {
      const ind = curIndent(cur);
      const firstNon = curRest(cur).slice(ind);
      if (ind <= 3 && /^=+[ \t]*$/.test(firstNon)) {
        const prefix = deep.parent && deep.parent.type === 'quote' && deep.lines.length >= 2
          ? '    ' : '';
        deep.lines.push(prefix + firstNon.replace(/[ \t]+$/, ''));
        this.prevBlank = false;
        return;
      }
      if (!this.wouldInterrupt(cur, deep)) {
        deep.lines.push(curRest(cur).replace(/^[ \t]+/, ''));
        this.prevBlank = false;
        return;
      }
    }
    if (containerFailed) {
      // html blocks cut off by a failed container lose their last newline
      for (let x = matched + 1; x < this.open.length; x++) {
        const b = this.open[x];
        if (b.type === 'html') b.text = b.text.replace(/\n$/, '');
      }
      this.closeDownTo(matched);
    }

    // a whitespace-only line inside a blockquote whose remaining text is
    // non-empty continues the quote's paragraph with that whitespace
    if (blank && !containerFailed && deep.type === 'para' &&
        curRest(cur).length > 0 &&
        open.slice(1, matched + 1).some(b => b.type === 'quote')) {
      deep.lines.push(curRest(cur));
      this.prevBlank = false;
      return;
    }

    // ---- blank line handling
    if (blank) {
      // an html block closed by its end tag on the previous line drops
      // its trailing newline when a blank line follows
      if (this.pendingHtml) {
        this.pendingHtml.text = this.pendingHtml.text.replace(/\n$/, '');
        this.pendingHtml = null;
      }
      const d = this.deepest();
      if (d.type === 'code' && !d.fenced) {
        // indented code absorbs the blank line (may be interior); a line
        // indented 4+ contributes its excess spaces as content
        if (curIndent(cur) >= 4) {
          const c2 = { ...cur };
          curAdvance(c2, 4);
          d.text += curRest(c2) + '\n';
        } else {
          d.text += '\n';
        }
        this.prevBlank = true;
        return;
      }
      if (d.type === 'code' && d.fenced) {
        const c2 = { ...cur };
        curSkipSpaces(c2, d.fenceIndent);
        d.text += curRest(c2) + '\n';
        this.prevBlank = true;
        return;
      }
      if (d.type === 'html') {
        if (d.htmlType >= 6) {
          // a type 6/7 block closed by a blank line drops the newline of
          // its last content line
          d.text = d.text.replace(/\n$/, '');
          this.closeDownTo(this.open.length - 2);
          this.markBlank();
          this.prevBlank = true;
          return;
        }
        d.text += '\n';
        this.prevBlank = true;
        return;
      }
      if (d.type === 'table') {
        this.closeDownTo(this.open.length - 2);
        this.markBlank();
        this.prevBlank = true;
        return;
      }
      // an item that began with an empty line ends at the first blank
      // line before it gains any content
      for (let x = this.open.length - 1; x >= 1; x--) {
        const b = this.open[x];
        if (b.type === 'item' && b.emptyStart && b.children.length === 0) {
          this.closeDownTo(x - 1);
          break;
        }
        if (b.type !== 'list' && b.type !== 'item') break;
      }
      {
        const d2 = this.deepest();
        if (d2.type === 'para') {
          d2.lastLineBlank = true;
          this.closeDownTo(this.open.length - 2);
        }
        this.markBlank();
      }
      this.prevBlank = true;
      return;
    }

    this.pendingHtml = null;
    // ---- leaf continuations
    const d = this.deepest();
    if (d.type === 'code') {
      if (d.fenced) {
        // closing fence?
        const ind = curIndent(cur);
        const rest = curRest(cur);
        const m = ind <= 3 && /^(`{3,}|~{3,})[ \t]*$/.exec(rest.replace(/^[ \t]+/, ''));
        if (m && m[1][0] === d.fenceChar && m[1].length >= d.fenceLen) {
          this.closeDownTo(this.open.length - 2);
          this.prevBlank = false;
          return;
        }
        // strip up to fenceIndent columns
        let c2 = { ...cur };
        curSkipSpaces(c2, d.fenceIndent);
        d.text += curRest(c2) + '\n';
        this.prevBlank = false;
        return;
      }
      // indented code needs 4 more columns
      if (curIndent(cur) >= 4) {
        curAdvance(cur, 4);
        d.text += curRest(cur) + '\n';
        this.prevBlank = false;
        return;
      }
      this.closeDownTo(this.open.length - 2);
    } else if (d.type === 'html') {
      const done = htmlBlockEnded(d, line);
      d.text += curRest(cur) + (this.isFinalLine ? '' : '\n');
      if (done) {
        this.closeDownTo(this.open.length - 2);
        this.pendingHtml = d;
      }
      this.prevBlank = false;
      return;
    } else if (d.type === 'table') {
      // a table absorbs following lines as rows unless the line clearly
      // starts another block (quote, fence, heading, thematic break)
      const ind = curIndent(cur);
      const firstNon = curRest(cur).slice(ind);
      if (ind <= 3 && (firstNon[0] === '>' || /^(`{3,}|~{3,})/.test(firstNon) ||
          /^#{1,6}([ \t]|$)/.test(firstNon) ||
          /^([*\-_])(?:[ \t]*\1){2,}[ \t]*$/.test(firstNon))) {
        this.closeDownTo(this.open.length - 2);
      } else {
        const cells = splitCells(curRest(cur));
        while (cells.length < d.aligns.length) cells.push('');
        d.rows.push(cells.slice(0, d.aligns.length));
        this.prevBlank = false;
        return;
      }
    }

    // ---- new block starts / paragraph continuation
    this.startBlocks(cur, line);
    this.prevBlank = false;
  }

  // Would this line start a block that interrupts the open paragraph?
  // (Used to decide lazy continuation when containers fail to match.)
  wouldInterrupt(cur, para) {
    const indent = curIndent(cur);
    if (indent > 3) return false;
    const firstNon = curRest(cur).slice(indent);
    if (firstNon[0] === '>') return true;
    if (/^#{1,6}([ \t]|$)/.test(firstNon)) return true;
    if (/^(`{3,}|~{3,})/.test(firstNon)) return true;
    if (firstNon[0] === '<' && htmlBlockStart(firstNon, true)) return true;
    if (/^(=+|-+)[ \t]*$/.test(firstNon)) return true;
    if (/^([*\-_])(?:[ \t]*\1){2,}[ \t]*$/.test(firstNon)) return true;
    if (para.lines.length === 1 && tryTable(para.lines[0], firstNon)) return true;
    const lm = listMarkerAt(cur);
    if (lm) {
      // a marker that continues an enclosing list always interrupts
      for (let p = para.parent; p; p = p.parent) {
        if (p.type === 'list' && sameListType(p, lm)) return true;
        if (p.type === 'doc') break;
      }
      if (lm.contentNonEmpty && (!lm.ordered || lm.num === 1)) return true;
    }
    return false;
  }

  markBlank() {
    // record that the current deepest container chain saw a blank line
    for (let i = this.open.length - 1; i >= 1; i--) {
      const b = this.open[i];
      if (b.type === 'list' || b.type === 'item' || b.type === 'quote') {
        b.lastLineBlank = true;
      }
    }
  }

  // Process new block starts at the cursor until the line is consumed.
  startBlocks(cur, line) {
    for (;;) {
      const deep = this.deepest();
      if (curBlank(cur)) return; // nothing left on this line
      const inPara = deep.type === 'para';
      const indent = curIndent(cur);
      const rest = curRest(cur);
      const firstNon = rest.slice(indent);

      // a list on top of the stack only continues with a list item;
      // anything else closes it first (a thematic break beats a marker)
      if (deep.type === 'list' &&
          (/^([*\-_])(?:[ \t]*\1){2,}[ \t]*$/.test(firstNon) || !listMarkerAt(cur))) {
        this.closeDownTo(this.open.length - 2);
        continue;
      }

      // blockquote
      if (indent <= 3 && firstNon[0] === '>') {
        if (inPara) this.closeDownTo(this.open.length - 2);
        curSkipSpaces(cur, 3);
        curAdvance(cur, 1); // '>'
        if (curPeek(cur) === ' ' || curPeek(cur) === '\t') curAdvance(cur, 1);
        const q = newBlock('quote', this.deepestContainer());
        this.open.push(q);
        continue;
      }
      // ATX heading
      if (indent <= 3) {
        const m = /^(#{1,6})(?=[ \t]|$)/.exec(firstNon);
        if (m) {
          if (inPara) this.closeDownTo(this.open.length - 2);
          curSkipSpaces(cur, 3);
          curAdvance(cur, m[1].length);
          let content = curRest(cur);
          content = content.replace(/[ \t]+$/, '');
          content = content.replace(/[ \t]+#+$/, '');
          if (/^#+$/.test(content)) content = '';
          content = content.replace(/^[ \t]+/, '');
          const h = newBlock('heading', this.deepestContainer());
          h.level = m[1].length;
          h.text = content;
          return;
        }
      }
      // fenced code
      if (indent <= 3) {
        const m = /^(`{3,}|~{3,})(.*)$/.exec(firstNon);
        if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
          if (inPara) this.closeDownTo(this.open.length - 2);
          curSkipSpaces(cur, 3);
          const code = newBlock('code', this.deepestContainer());
          code.fenced = true;
          code.fenceChar = m[1][0];
          code.fenceLen = m[1].length;
          code.fenceIndent = indent;
          code.info = m[2].trim().replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
          code.text = '';
          this.open.push(code);
          return;
        }
      }
      // HTML block
      if (indent <= 3 && firstNon[0] === '<') {
        const hb = htmlBlockStart(firstNon, inPara);
        if (hb) {
          if (inPara) this.closeDownTo(this.open.length - 2);
          const h = newBlock('html', this.deepestContainer());
          h.htmlType = hb.type;
          h.endTag = hb.endTag;
          h.text = rest + (this.isFinalLine ? '' : '\n');
          this.open.push(h);
          if (htmlBlockEnded(h, h.text)) {
            this.closeDownTo(this.open.length - 2);
            this.pendingHtml = h;
          }
          return;
        }
      }
      // setext heading (paragraph open)
      if (inPara && indent <= 3) {
        const m = /^(=+|-+)[ \t]*$/.exec(firstNon);
        if (m) {
          // link reference definitions at the paragraph's start are
          // consumed first; only the remainder can become the heading
          const restText = extractDefsFromText(deep.lines.join('\n'), this.refs);
          if (restText === null) {
            // nothing but definitions: the underline line starts fresh
            const parent = deep.parent;
            parent.children.splice(parent.children.indexOf(deep), 1);
            this.open.pop();
            const p = newBlock('para', parent);
            p.lines = [firstNon.replace(/[ \t]+$/, '')];
            this.open.push(p);
            return;
          }
          deep.lines = [restText];
          const h = { type: 'heading', children: [], parent: deep.parent,
            id: BLOCK_ID++, lastLineBlank: false,
            text: deep.lines.join('\n').replace(/^[ \t\n]+/, '').replace(/[ \t]+$/, ''),
            lines: null, level: m[1][0] === '=' ? 1 : 2 };
          // replace paragraph with heading among siblings
          const sibs = deep.parent.children;
          sibs[sibs.indexOf(deep)] = h;
          this.open.pop();
          return;
        }
        // table conversion: paragraph has exactly one line, this line is
        // a delimiter row
        if (deep.lines.length === 1) {
          const tbl = tryTable(deep.lines[0], firstNon);
          if (tbl) {
            const sibs = deep.parent.children;
            sibs[sibs.indexOf(deep)] = tbl;
            tbl.parent = deep.parent;
            this.open[this.open.length - 1] = tbl;
            return;
          }
        }
      }
      // thematic break
      if (indent <= 3 && /^([*\-_])(?:[ \t]*\1){2,}[ \t]*$/.test(firstNon)) {
        if (inPara) this.closeDownTo(this.open.length - 2);
        newBlock('hr', this.deepestContainer());
        return;
      }
      // list item
      if (indent <= 3) {
        const lm = listMarkerAt(cur);
        if (lm) {
          const canInterrupt = !inPara || (lm.contentNonEmpty &&
            (!lm.ordered || lm.num === 1));
          if (canInterrupt) {
            if (inPara) this.closeDownTo(this.open.length - 2);
            this.startListItem(cur, lm);
            if (curBlank(cur)) return; // empty item: line done
            continue;
          }
        }
      }
      // indented code (not while a paragraph is open)
      if (!inPara && indent >= 4) {
        curAdvance(cur, 4);
        const code = newBlock('code', this.deepestContainer());
        code.fenced = false;
        code.text = curRest(cur) + '\n';
        this.open.push(code);
        return;
      }
      // table starting on this line (needs next line lookahead — handled
      // by the paragraph route: a one-line paragraph converts when the
      // delimiter line arrives)
      // paragraph
      if (inPara) {
        deep.lines.push(rest);
        return;
      }
      const p = newBlock('para', this.deepestContainer());
      p.lines = [rest];
      this.open.push(p);
      return;
    }
  }

  deepestContainer() {
    const d = this.deepest();
    return d.type === 'para' || d.type === 'code' || d.type === 'html' || d.type === 'heading' || d.type === 'table'
      ? d.parent : d;
  }

  startListItem(cur, lm) {
    // cursor is at the frame start for this item (indent ≤ 3 unconsumed)
    const parent = this.deepestContainer();
    const ind = curIndent(cur);
    curSkipSpaces(cur, 3);
    curAdvance(cur, lm.width);
    // measure spaces to content
    const afterMarker = { ...cur };
    let spaces = 0;
    {
      let c = { ...cur };
      while (curPeek(c) === ' ' || curPeek(c) === '\t') { curAdvance(c, 1); spaces++; if (spaces > 4) break; }
    }
    let contentIndent;
    if (lm.blankAfter || spaces > 4 || spaces === 0) {
      contentIndent = lm.width + 1;
      // consume exactly one space if present
      if (curPeek(cur) === ' ' || curPeek(cur) === '\t') curAdvance(cur, 1);
    } else {
      contentIndent = lm.width + spaces;
      curAdvance(cur, spaces);
    }
    // find or create the list
    let list = null;
    if (parent.type === 'list' && sameListType(parent, lm)) {
      list = parent;
    } else {
      if (parent.type === 'list') {
        // incompatible list: close it, new list under its parent
        this.closeDownTo(this.open.indexOf(parent) - 1);
      }
      list = newBlock('list', this.deepestContainer());
      list.ordered = !!lm.ordered;
      list.start = lm.ordered ? lm.num : null;
      list.bullet = lm.bullet || null;
      list.delim = lm.delim || null;
      this.open.push(list);
    }
    const item = newBlock('item', list);
    item.padding = ind + contentIndent;
    item.emptyStart = curBlank(cur);
    this.open.push(item);
  }

  extractDefs(root) {
    const walk = (b) => {
      for (let i = 0; i < b.children.length; i++) {
        const ch = b.children[i];
        if (ch.type === 'para') {
          const rest = extractDefsFromText(ch.lines.join('\n'), this.refs);
          if (rest === null) {
            // whole paragraph was definitions: remove it
            b.children.splice(i, 1);
            i--;
            continue;
          }
          ch.lines = [rest];
        } else {
          walk(ch);
        }
      }
    };
    walk(root);
  }
}

function endsBlank(b) {
  if (b.lastLineBlank) {
    if (b.type === 'list' || b.type === 'item') {
      const last = b.children[b.children.length - 1];
      return last ? endsBlank(last) : false;
    }
    return true;
  }
  return false;
}

function curRestAfter(cur, indent) {
  const c = { ...cur };
  curSkipSpaces(c, indent);
  return curRest(c);
}

// List marker at cursor with content info for paragraph interruption.
function listMarkerAt(cur) {
  const rest = curRest(cur);
  const indent = curIndent(cur);
  const s = rest.slice(indent);
  let m = /^([-+*])(?=[ \t]|$)/.exec(s);
  if (m) {
    const after = s.slice(1);
    return { bullet: m[1], width: 1, blankAfter: after.trim() === '',
      contentNonEmpty: after.trim() !== '' };
  }
  m = /^([0-9]{1,9})([.)])(?=[ \t]|$)/.exec(s);
  if (m) {
    const after = s.slice(m[0].length);
    return { ordered: true, num: parseInt(m[1], 10), delim: m[2],
      width: m[1].length + 1, blankAfter: after.trim() === '',
      contentNonEmpty: after.trim() !== '' };
  }
  return null;
}

function sameListType(list, lm) {
  if (lm.ordered) return list.ordered && list.delim === lm.delim;
  return !list.ordered && list.bullet === lm.bullet;
}

function htmlBlockEnded(h, line) {
  const t = h.htmlType;
  if (t === 1) return line.toLowerCase().includes(h.endTag);
  if (t === 2) return line.includes('-->');
  if (t === 3) return line.includes('?>');
  if (t === 4) return line.includes('>');
  if (t === 5) return line.includes(']]>');
  return false; // types 6/7 end on blank lines, handled by caller
}

// ---- link reference definitions at the start of a paragraph's text.
// Registers into refs; returns the remaining paragraph text, or null when
// nothing but definitions (and whitespace) remains.
function extractDefsFromText(text, refs) {
  let pos = 0;
  const n = text.length;
  let consumedAny = false;
  for (;;) {
    const d = parseOneDef(text, pos);
    if (!d) break;
    consumedAny = true;
    if (!refs.has(d.label)) refs.set(d.label, { href: d.href, title: d.title });
    pos = d.end;
  }
  if (!consumedAny) return text;
  const rest = text.slice(pos);
  if (rest.trim() === '') return null;
  return rest.replace(/^\n+/, '');
}

function parseOneDef(text, pos) {
  const n = text.length;
  let i = pos;
  // up to 3 leading spaces (we are at a line start inside the text)
  let sp = 0;
  while (text[i] === ' ' && sp < 3) { i++; sp++; }
  if (text[i] !== '[') return null;
  // label
  let j = i + 1, label = '', ok = false;
  while (j < n) {
    const c = text[j];
    if (c === '\\' && isPunct(text[j + 1])) { label += text[j + 1]; j += 2; continue; }
    if (c === '[') return null;
    if (c === ']') { ok = true; break; }
    label += c; j++;
    if (label.length > 999) return null;
  }
  if (!ok || label.trim() === '') return null;
  j++; // past ']'
  if (text[j] !== ':') return null;
  j++;
  // whitespace: spaces/tabs and at most one newline (twice: before dest)
  j = skipDefSpace(text, j);
  if (j === -1) return null;
  // destination
  let href = '';
  if (text[j] === '<') {
    let k = j + 1, okk = false;
    while (k < n) {
      const c = text[k];
      if (c === '\\' && isPunct(text[k + 1])) { href += text[k + 1]; k += 2; continue; }
      if (c === '>') { okk = true; break; }
      if (c === '<' || c === '\n') return null;
      href += c; k++;
    }
    if (!okk) return null;
    j = k + 1;
  } else {
    let depth = 0;
    const st = j;
    while (j < n) {
      const c = text[j];
      if (c === '\\' && isPunct(text[j + 1])) { href += text[j + 1]; j += 2; continue; }
      if (c === '(') { depth++; href += c; j++; continue; }
      if (c === ')') {
        if (depth === 0) break;
        depth--; href += c; j++; continue;
      }
      if (isSpace(c)) break;
      if (c.charCodeAt(0) < 0x20) break;
      href += c; j++;
    }
    if (j === st || depth !== 0) return null;
  }
  href = decodeRefsRaw(href);
  // fallback end: if a would-be title sits on a later line but is junk,
  // the definition still counts (without title) and ends at the
  // destination's line.
  let fallbackEnd = -1;
  {
    let e = j;
    while (text[e] === ' ' || text[e] === '\t') e++;
    if (text[e] === '\n') fallbackEnd = e + 1;
    else if (e >= n) fallbackEnd = n;
  }
  // optional title: must be preceded by whitespace (spaces/tabs and at
  // most one newline in total across the gap)
  let k = j, newlines = 0, sawWs = false;
  while (k < n && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n')) {
    if (text[k] === '\n') newlines++;
    sawWs = true; k++;
  }
  let title = null;
  if (sawWs && newlines <= 1 && (text[k] === '"' || text[k] === "'" || text[k] === '(')) {
    const open = text[k], close = open === '(' ? ')' : open;
    let t = '', q = k + 1, okk = false;
    while (q < n) {
      const c = text[q];
      if (c === '\\' && isPunct(text[q + 1])) { t += text[q + 1]; q += 2; continue; }
      if (open === '(' && c === '(') return null;
      if (c === close) { okk = true; break; }
      t += c; q++;
    }
    if (!okk) {
      if (newlines === 1 && fallbackEnd !== -1) {
        return { label: normalizeLabel(label), href, title: null, end: fallbackEnd };
      }
      return null;
    }
    title = decodeRefsRaw(t);
    k = q + 1;
    // after a title, only spaces/tabs until newline or end
    while (text[k] === ' ' || text[k] === '\t') k++;
    if (k < n && text[k] !== '\n') {
      if (newlines === 1 && fallbackEnd !== -1) {
        return { label: normalizeLabel(label), href, title: null, end: fallbackEnd };
      }
      return null;
    }
  } else {
    // no title: only spaces/tabs until newline or end
    k = j;
    while (text[k] === ' ' || text[k] === '\t') k++;
    if (k < n && text[k] !== '\n') return null;
  }
  if (text[k] === '\n') k++;
  return { label: normalizeLabel(label), href, title, end: k };
}

function skipDefSpace(text, j) {
  const n = text.length;
  let newlines = 0;
  while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) {
    if (text[j] === '\n') { newlines++; if (newlines > 1) return -1; }
    j++;
  }
  return j;
}

// ---- GFM tables -------------------------------------------------------

function splitCells(line) {
  // split on unescaped pipes that are not inside code spans
  const cells = [];
  let cur = '', i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === '\\' && line[i + 1] === '|') { cur += '|'; i += 2; continue; }
    if (c === '`') {
      let run = 0;
      while (line[i + run] === '`') run++;
      // find closing run
      let j = i + run, found = -1;
      while (j < n) {
        if (line[j] === '`') {
          let r2 = 0;
          while (line[j + r2] === '`') r2++;
          if (r2 === run) { found = j; break; }
          j += r2;
        } else j++;
      }
      if (found !== -1) { cur += line.slice(i, found + run); i = found + run; continue; }
      cur += line.slice(i, i + run); i += run; continue;
    }
    if (c === '|') { cells.push(cur); cur = ''; i++; continue; }
    cur += c; i++;
  }
  cells.push(cur);
  // drop empty edge cells produced by leading/trailing pipes
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map(c => c.trim());
}

function tryTable(headerLine, delimLine) {
  if (!headerLine.includes('|')) return null;
  const delimCells = splitCells(delimLine);
  if (delimCells.length === 0) return null;
  const aligns = [];
  for (const c of delimCells) {
    const m = /^(:?)-+(:?)$/.exec(c.replace(/ /g, ''));
    if (!m) return null;
    aligns.push(m[1] && m[2] ? 'center' : m[2] ? 'right' : m[1] ? 'left' : null);
  }
  const header = splitCells(headerLine);
  if (header.length !== aligns.length) return null;
  const t = { type: 'table', children: [], parent: null, id: BLOCK_ID++,
    lastLineBlank: false, header, aligns, rows: [], lines: null, text: '' };
  return t;
}

// ---------------------------------------------------------------- render

function renderBlocks(blocks, refs, inTightItem) {
  let out = '';
  for (const b of blocks) out += renderBlock(b, refs, inTightItem);
  return out;
}

function inlineOf(text, refs) {
  return new InlineParser(refs).parse(text);
}

function renderBlock(b, refs, inTightItem) {
  switch (b.type) {
    case 'doc':
      return renderBlocks(b.children, refs, false);
    case 'para': {
      const html = inlineOf(b.lines.join('\n'), refs);
      if (inTightItem) return html + '\n';
      return '<p>' + html + '</p>\n';
    }
    case 'heading':
      return '<h' + b.level + '>' + inlineOf(b.text, refs) + '</h' + b.level + '>\n';
    case 'hr':
      return '<hr>\n';
    case 'code': {
      let content = b.text;
      if (!content.endsWith('\n') && content !== '') content += '\n';
      let cls = '';
      if (b.fenced && b.info) {
        const lang = b.info.split(/\s+/)[0];
        if (lang) cls = ' class="language-' + escAttr(lang) + '"';
      }
      return '<pre><code' + cls + '>' + escCode(content) + '</code></pre>\n';
    }
    case 'html':
      return b.text;
    case 'quote':
      return '<blockquote>\n' + renderBlocks(b.children, refs, false) + '</blockquote>\n';
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const start = b.ordered && b.start !== 1 ? ' start="' + b.start + '"' : '';
      let out = '<' + tag + start + '>\n';
      for (const item of b.children) out += renderItem(item, b, refs);
      return out + '</' + tag + '>\n';
    }
    case 'table': {
      let out = '<table>\n<thead>\n<tr>\n';
      for (let i = 0; i < b.header.length; i++) {
        out += '<th' + (b.aligns[i] ? ' align="' + b.aligns[i] + '"' : '') + '>' +
          inlineOf(b.header[i], refs) + '</th>\n';
      }
      out += '</tr>\n</thead>\n';
      if (b.rows.length) {
        out += '<tbody>';
        for (const row of b.rows) {
          out += '<tr>\n';
          for (let i = 0; i < b.aligns.length; i++) {
            out += '<td' + (b.aligns[i] ? ' align="' + b.aligns[i] + '"' : '') + '>' +
              inlineOf(row[i] || '', refs) + '</td>\n';
          }
          out += '</tr>\n';
        }
        out += '</tbody>';
      }
      return out + '</table>\n';
    }
  }
  return '';
}

function renderItem(item, list, refs) {
  const tight = !list.loose;
  let inner = '';
  const kids = item.children;
  for (let i = 0; i < kids.length; i++) {
    const ch = kids[i];
    if (ch.type === 'para') {
      let text = ch.lines.join('\n');
      let prefix = '';
      if (i === 0 && !list.ordered) {
        const m = /^\[([ xX])\] /.exec(text);
        if (m) {
          prefix = m[1] === ' '
            ? '<input disabled="" type="checkbox"> '
            : '<input checked="" disabled="" type="checkbox"> ';
          text = text.slice(m[0].length);
        }
      }
      const html = prefix + inlineOf(text, refs);
      inner += tight ? html : '<p>' + html + '</p>\n';
    } else {
      inner += renderBlock(ch, refs, false);
    }
  }
  return '<li>' + inner + '</li>\n';
}

// ---------------------------------------------------------------- entry

export function parse(markdown) {
  if (typeof markdown !== 'string') markdown = String(markdown ?? '');
  let src = markdown.replace(/\r\n?/g, '\n');
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);
  src = src.replace(/\0/g, '�');
  const bp = new BlockParser();
  const doc = bp.parse(src);
  return renderBlock(doc, bp.refs, false);
}
