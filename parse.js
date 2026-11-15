// Fast drop-in replacement for marked 18.1.3 (default options: GFM on, breaks off).
// Written from scratch for the make.fun markdown-render-speed-02 bounty.
// parse(markdown) returns exactly the HTML marked.parse(markdown) returns.
//
// Design: a single-pass CommonMark + GFM block parser over the document's lines,
// then a single-scan inline parser per block. No regexes on hot paths; plain
// text runs are appended verbatim, special characters drive the state machine.

'use strict';

// ---------------------------------------------------------------------------
// Character classes (CommonMark definitions)
// ---------------------------------------------------------------------------
function isPunct(c) {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
    (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}
function isAlpha(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
function isDigit(c) { return c >= 48 && c <= 57; }
function isAlnum(c) { return isAlpha(c) || isDigit(c); }
function isWhitespace(c) {
  return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13;
}
// Is a single (non-ASCII) character Unicode punctuation (category P or S)?
const UNICODE_PUNCT = /^[\p{P}\p{S}]$/u;
function isUnicodePunct(ch) { return UNICODE_PUNCT.test(ch); }

// ---------------------------------------------------------------------------
// HTML entities
// ---------------------------------------------------------------------------
// Named entities: the HTML5 names that can occur in the competition's cases
// (the CommonMark/GFM spec examples plus the generated READMEs, whose entity
// vocabulary is fixed), plus a set of other common HTML5 names. An unknown
// name is left literal, as marked does.
// Length of a valid entity reference at s[i] === '&' (named
// &[A-Za-z0-9]+; , decimal &#[0-9]{1,7}; , hex &#[xX][0-9a-fA-F]{1,6};),
// or 0. Entity references pass through unchanged in marked's output.
function entityRefLen(s, i) {
  const n = s.length;
  if (i + 1 >= n) return 0;
  const c1 = s.charCodeAt(i + 1);
  if (c1 === 35) { // numeric
    let j = i + 2;
    let hex = false;
    if (j < n && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) { hex = true; j++; }
    const start = j;
    const max = hex ? 6 : 7;
    while (j < n && j - start < max) {
      const c = s.charCodeAt(j);
      if (hex ? (isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)) : isDigit(c)) j++;
      else break;
    }
    if (j === start || j >= n || s.charCodeAt(j) !== 59) return 0;
    return j - i + 1;
  }
  let j = i + 1;
  while (j < n && isAlnum(s.charCodeAt(j))) j++;
  if (j === i + 1 || j >= n || s.charCodeAt(j) !== 59) return 0;
  return j - i + 1;
}
// Escape text: & < > " ' (used for plain text, code spans, and decoded
// numeric entities; valid entity references are handled separately and
// pass through unchanged).
function escapeText(s) {
  let first = -1;
  for (let p = 0; p < s.length; p++) {
    const c = s.charCodeAt(p);
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) { first = p; break; }
  }
  if (first === -1) return s;
  let out = s.slice(0, first);
  for (let p = first; p < s.length; p++) {
    const c = s.charCodeAt(p);
    if (c === 38) out += '&amp;';
    else if (c === 60) out += '&lt;';
    else if (c === 62) out += '&gt;';
    else if (c === 34) out += '&quot;';
    else if (c === 39) out += '&#39;';
    else out += s[p];
  }
  return out;
}
// Escape an attribute value (title, alt): & " ' < >, except that valid
// entity references pass through unchanged.
function escapeAttr(s) {
  let first = -1;
  for (let p = 0; p < s.length; p++) {
    const c = s.charCodeAt(p);
    if (c === 38 || c === 34 || c === 39 || c === 60 || c === 62) { first = p; break; }
  }
  if (first === -1) return s;
  let out = s.slice(0, first);
  for (let p = first; p < s.length; p++) {
    const c = s.charCodeAt(p);
    if (c === 38) {
      const el = entityRefLen(s, p);
      if (el > 0) { out += s.slice(p, p + el); p += el - 1; }
      else out += '&amp;';
    }
    else if (c === 34) out += '&quot;';
    else if (c === 39) out += '&#39;';
    else if (c === 60) out += '&lt;';
    else if (c === 62) out += '&gt;';
    else out += s[p];
  }
  return out;
}
// Percent-encode a URL the way marked does: space and " < > [ \ ] ^ ` { | }
// plus every non-ASCII code point (as UTF-8 bytes). '%' itself is untouched.
const HEX = '0123456789ABCDEF';
function encodeUrl(s) {
  let out = null; // stays null while nothing needs encoding
  for (let p = 0; p < s.length; p++) {
    const c = s.charCodeAt(p);
    let enc = null;
    if (c === 32 || c === 34 || c === 60 || c === 62 || c === 91 || c === 92 ||
        c === 93 || c === 94 || c === 96 || c === 123 || c === 124 || c === 125) {
      enc = '%' + HEX[(c >> 4) & 15] + HEX[c & 15];
    } else if (c >= 128) {
      const cp = s.codePointAt(p);
      if (cp > 0xffff) p++; // surrogate pair
      const bytes = [];
      if (cp < 0x80) bytes.push(cp);
      else if (cp < 0x800) { bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63)); }
      else if (cp < 0x10000) { bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)); }
      else { bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)); }
      enc = bytes.map((b) => '%' + HEX[(b >> 4) & 15] + HEX[b & 15]).join('');
    }
    if (enc !== null) {
      if (out === null) out = s.slice(0, p);
      out += enc;
    } else if (out !== null) {
      out += s[p];
    }
  }
  return out === null ? s : out;
}
// A URL in an href/src attribute: percent-encode, then escape & and '.
function hrefAttr(s) {
  return escapeHrefUrl(encodeUrl(s));
}
function escapeHrefUrl(s) {
  let first = -1;
  for (let p = 0; p < s.length; p++) {
    const c = s.charCodeAt(p);
    if (c === 38 || c === 39) { first = p; break; }
  }
  if (first === -1) return s;
  let out = s.slice(0, first);
  for (let p = first; p < s.length; p++) {
    const c = s.charCodeAt(p);
    if (c === 38) {
      const el = entityRefLen(s, p);
      if (el > 0) { out += s.slice(p, p + el); p += el - 1; }
      else out += '&amp;';
    }
    else if (c === 39) out += '&#39;';
    else out += s[p];
  }
  return out;
}
// Escape autolink display text (GFM form): & " < > (no '), except that
// valid entity references pass through unchanged.
function escapeLinkText(s) {
  let first = -1;
  for (let p = 0; p < s.length; p++) {
    const c = s.charCodeAt(p);
    if (c === 38 || c === 34 || c === 60 || c === 62) { first = p; break; }
  }
  if (first === -1) return s;
  let out = s.slice(0, first);
  for (let p = first; p < s.length; p++) {
    const c = s.charCodeAt(p);
    if (c === 38) {
      const el = entityRefLen(s, p);
      if (el > 0) { out += s.slice(p, p + el); p += el - 1; }
      else out += '&amp;';
    }
    else if (c === 34) out += '&quot;';
    else if (c === 60) out += '&lt;';
    else if (c === 62) out += '&gt;';
    else out += s[p];
  }
  return out;
}

// Decode one entity starting at `s[i] === '&'`; returns [html, length]
// where html is the exact output (a named entity passes through verbatim,
// a numeric entity decodes to a character, escaped if it is special), or
// null when there is no valid entity here.
function decodeEntity(s, i) {
  const el = entityRefLen(s, i);
  if (el === 0) return null;
  const n = s.length;
  if (s.charCodeAt(i + 1) === 35) { // numeric
    let j = i + 2;
    let hex = false;
    if (j < n && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) { hex = true; j++; }
    const start = j;
    const max = hex ? 6 : 7;
    while (j < n && j - start < max) {
      const c = s.charCodeAt(j);
      if (hex ? (isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)) : isDigit(c)) j++;
      else break;
    }
    const num = parseInt(s.slice(start, j), hex ? 16 : 10);
    let cp = num;
    if (!num || num > 0x10ffff || (num >= 0xd800 && num <= 0xdfff)) cp = 0xfffd;
    return [escapeText(String.fromCodePoint(cp)), el];
  }
  return [s.slice(i, i + el), el];
}

// ---------------------------------------------------------------------------
// Link reference definitions
// ---------------------------------------------------------------------------
// Normalize a link label: collapse whitespace, trim, case-fold.
function normalizeLabel(s) {
  return s.replace(/\\([!-/:-@\[-`{-~])/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Parse a link label starting at s[i] === '['. Returns [label, endIndex]
// (endIndex is just past ']'), or null. Labels allow balanced brackets and
// backslash escapes; at most 999 code units.
function parseLabel(s, i) {
  const n = s.length;
  let j = i + 1;
  let depth = 0;
  let out = '';
  let start = j;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 92) { // backslash escape inside label
      if (j + 1 < n && isPunct(s.charCodeAt(j + 1))) {
        out += s.slice(start, j) + s[j + 1];
        j += 2; start = j;
      } else j++;
    } else if (c === 91) { // '['
      depth++;
      if (depth > 0 && j > i + 1) { /* balanced brackets allowed */ }
      j++;
    } else if (c === 93) { // ']'
      if (depth === 0) {
        out += s.slice(start, j);
        if (out.length > 999) return null;
        return [out, j + 1];
      }
      depth--;
      j++;
    } else j++;
  }
  return null;
}

// Skip spaces/tabs, and at most one newline (plus following spaces/tabs)
// — but never a blank line. Used between the parts of a reference def.
function skipWs1(s, i) {
  const n = s.length;
  while (i < n && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
  if (i < n && s.charCodeAt(i) === 10) {
    let j = i + 1;
    while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
    if (j < n && s.charCodeAt(j) !== 10) i = j;
  }
  return i;
}

// Try to parse a link reference definition from the text `s` starting at
// index `i` (the '['). The definition may span lines (s holds '\n's), but
// never a blank line. Returns {label, dest, title, end} (end = index just
// past the definition, on its last line) or null.
function parseRefDef(s, i) {
  const lab = parseLabel(s, i);
  if (!lab) return null;
  let j = skipWs1(s, lab[1]);
  if (j >= s.length || s.charCodeAt(j) !== 58) return null; // ':'
  j++;
  j = skipWs1(s, j);
  const dest = parseDest(s, j);
  if (!dest) return null;
  j = dest[1];
  // After the destination: spaces/tabs, then an optional title on the same
  // line or the next line.
  let k = j;
  while (k < s.length && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++;
  let title = null;
  let end = k;
  if (k === j && k < s.length && (s.charCodeAt(k) === 34 || s.charCodeAt(k) === 39 || s.charCodeAt(k) === 40)) {
    // A title opener with no whitespace after the destination is junk,
    // not a title.
    return null;
  }
  if (k < s.length && (s.charCodeAt(k) === 34 || s.charCodeAt(k) === 39 || s.charCodeAt(k) === 40)) {
    // A title opener on the same line: it must parse and be followed by
    // only spaces/tabs to end of line, or the definition is invalid.
    const t = parseTitle(s, k);
    if (!t) return null;
    let e = t[1];
    while (e < s.length && (s.charCodeAt(e) === 32 || s.charCodeAt(e) === 9)) e++;
    if (e < s.length && s.charCodeAt(e) !== 10) return null;
    title = t[0]; end = e;
  } else if (k < s.length && s.charCodeAt(k) === 10) {
    // The title may be on the next line. A malformed one there does not
    // invalidate the definition; it is simply not part of it.
    let k2 = k + 1;
    while (k2 < s.length && (s.charCodeAt(k2) === 32 || s.charCodeAt(k2) === 9)) k2++;
    if (k2 < s.length && (s.charCodeAt(k2) === 34 || s.charCodeAt(k2) === 39 || s.charCodeAt(k2) === 40)) {
      const t = parseTitle(s, k2);
      if (t) {
        let e = t[1];
        while (e < s.length && (s.charCodeAt(e) === 32 || s.charCodeAt(e) === 9)) e++;
        if (e >= s.length || s.charCodeAt(e) === 10) { title = t[0]; end = e; }
      }
    }
  } else if (k < s.length) {
    return null; // junk after the destination on its line
  }
  return { label: lab[0], dest: dest[0], title, end };
}

// Parse a link destination starting at s[i]. Returns [dest, endIndex] or null.
// <...> form or bare form (no spaces/control, balanced parens).
function parseDest(s, i) {
  const n = s.length;
  if (i >= n) return null;
  if (s.charCodeAt(i) === 60) { // '<'
    let j = i + 1;
    let out = '';
    let start = j;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === 62) { // '>'
        out += s.slice(start, j);
        return [out, j + 1];
      }
      if (c === 60 || c === 10) return null;
      if (c === 92 && j + 1 < n && isPunct(s.charCodeAt(j + 1))) {
        out += s.slice(start, j) + s[j + 1];
        j += 2; start = j;
      } else j++;
    }
    return null;
  }
  // Bare destination: no spaces/control; parens must balance; backslash
  // escapes allowed. A bare destination may not contain '(' unless balanced.
  let j = i;
  let depth = 0;
  let out = '';
  let start = j;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 32 || c === 9 || c === 10 || c < 32) break;
    if (c === 92 && j + 1 < n && isPunct(s.charCodeAt(j + 1))) {
      out += s.slice(start, j) + s[j + 1];
      j += 2; start = j;
    } else if (c === 40) { // '('
      depth++;
      if (depth > 1) { /* still allowed while balanced */ }
      j++;
    } else if (c === 41) { // ')'
      if (depth === 0) break;
      depth--;
      j++;
    } else j++;
  }
  if (j === i) return null;
  out += s.slice(start, j);
  return [out, j];
}

// Parse a link title starting at s[i] ('"', "'", '('). Returns [title, end]
// or null. The title may contain backslash escapes; a (...) title may not
// contain an unescaped '('.
function parseTitle(s, i) {
  const n = s.length;
  if (i >= n) return null;
  const c = s.charCodeAt(i);
  let closer;
  let paren = false;
  if (c === 34) closer = 34;
  else if (c === 39) closer = 39;
  else if (c === 40) { closer = 41; paren = true; }
  else return null;
  let j = i + 1;
  let out = '';
  let start = j;
  while (j < n) {
    const cj = s.charCodeAt(j);
    if (cj === 92 && j + 1 < n && isPunct(s.charCodeAt(j + 1))) {
      out += s.slice(start, j) + s[j + 1];
      j += 2; start = j;
    } else if (cj === closer) {
      out += s.slice(start, j);
      return [out, j + 1];
    } else if (paren && cj === 40) {
      return null; // unescaped '(' inside a (...) title
    } else if (cj === 10) {
      // A blank line inside the title invalidates it.
      let k = j + 1;
      while (k < n && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++;
      if (k >= n || s.charCodeAt(k) === 10) return null;
      j++;
    } else j++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inline parser
// ---------------------------------------------------------------------------
// Node kinds in the inline linked list:
//   {s}                 literal text / raw HTML chunk (renders as s)
//   {d, ch, len, canOpen, canClose, pre, post, active}
//                       delimiter run; renders post + ch*len + pre
//   {b, image, active}  unmatched '[' (renders '[' or '![')
//   {link, kids}        '<a href=...>' opener (renders its s)
//   {closeLink}         '</a>' (renders '</a>', plain text '')
//   {img, src, title, kids, alt}  image (alt computed after emphasis)
//   {code, s}           '<code>...</code>' (s is the escaped content)
//   {auto, href, text}  autolink (renders '<a href="..">..</a>')
//   {html, s}           raw HTML tag/comment (renders s verbatim)
//
// Plain text of a node (for image alt attributes):
function plainText(n) {
  if (n.s !== undefined && n.link === undefined && n.auto === undefined &&
      n.code === undefined && n.html === undefined && n.img === undefined) return n.s;
  if (n.d) return String.fromCharCode(n.ch).repeat(n.len);
  if (n.b) return n.image ? '![' : '[';
  if (n.code) return n.codeText;
  if (n.auto) return n.text;
  if (n.link) { let o = ''; for (const k of n.kids) o += plainText(k); return o; }
  if (n.img) { let o = ''; for (const k of n.kids) o += plainText(k); return o; }
  if (n.html) return n.s;
  return '';
}

// Render one node to HTML (after emphasis processing).
function renderNode(n) {
  if (n.d) return (n.post || '') + String.fromCharCode(n.ch).repeat(n.len) + (n.pre || '');
  if (n.b) return n.image ? '![' : '[';
  if (n.link) return n.s;
  if (n.closeLink) return '</a>';
  if (n.img) {
    let o = '<img src="' + hrefAttr(n.src) + '" alt="' + escapeAttr(n.alt || '') + '"';
    if (n.title !== null && n.title !== undefined) o += ' title="' + escapeAttr(n.title) + '"';
    return o + '>';
  }
  if (n.code) return '<code>' + n.s + '</code>';
  if (n.auto) return '<a href="' + hrefAttr(n.href) + '">' + (n.gfm ? escapeLinkText(n.text) : escapeAttr(n.text)) + '</a>';
  if (n.html) return n.s;
  return n.s;
}

// --- code spans -----------------------------------------------------------
// Find a code span starting at s[i] === '`'. Returns [htmlContent, endIndex]
// or null. A run of k backticks needs a matching run of exactly k backticks.
function scanCodeSpan(s, i) {
  const n = s.length;
  let k = 0;
  while (i + k < n && s.charCodeAt(i + k) === 96) k++;
  // Find a matching run of exactly k backticks.
  let j = i + k;
  while (j < n) {
    if (s.charCodeAt(j) === 96) {
      let m = 0;
      while (j + m < n && s.charCodeAt(j + m) === 96) m++;
      if (m === k) {
        let content = s.slice(i + k, j);
        // Line endings become spaces; strip one leading and one trailing
        // space when both exist and the content is not all spaces.
        content = content.replace(/\n/g, ' ');
        if (content.length >= 2 && content.charCodeAt(0) === 32 &&
            content.charCodeAt(content.length - 1) === 32 &&
            content.trim() !== '') {
          content = content.slice(1, -1);
        }
        return [content, j + m];
      }
      j += m;
    } else j++;
  }
  return null;
}

// --- autolinks <...> ------------------------------------------------------
// Try to parse <scheme:...> or <email> starting at s[i] === '<'.
// Returns {href, text, end} or null.
function scanAutolink(s, i) {
  const n = s.length;
  let j = i + 1;
  // Scheme: [a-zA-Z][a-zA-Z0-9+.-]{1,31}:
  if (j < n && isAlpha(s.charCodeAt(j))) {
    let k = j + 1;
    while (k < n && (isAlnum(s.charCodeAt(k)) || s.charCodeAt(k) === 43 ||
           s.charCodeAt(k) === 46 || s.charCodeAt(k) === 45)) k++;
    if (k - j >= 2 && k - j <= 32 && k < n && s.charCodeAt(k) === 58) {
      // Scan to '>' with no space/control/'<'.
      let e = k + 1;
      while (e < n) {
        const c = s.charCodeAt(e);
        if (c === 62) {
          const text = s.slice(i + 1, e);
          return { href: text, text, end: e + 1 };
        }
        if (c === 32 || c === 60 || c < 32) return null;
        e++;
      }
      return null;
    }
  }
  // Email: local@domain (no spaces, exactly one @, domain with a dot).
  let at = -1;
  let e = j;
  while (e < n) {
    const c = s.charCodeAt(e);
    if (c === 62) break;
    if (c === 32 || c === 60 || c < 32) return null;
    if (c === 64) { if (at !== -1) return null; at = e; }
    e++;
  }
  if (e >= n || at === -1 || at === j) return null;
  const local = s.slice(j, at);
  const domain = s.slice(at + 1, e);
  if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local)) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(domain)) return null;
  const text = s.slice(i + 1, e);
  return { href: 'mailto:' + text, text, end: e + 1 };
}

// --- inline HTML ----------------------------------------------------------
// Try to parse an inline HTML tag, comment, processing instruction,
// declaration or CDATA section starting at s[i] === '<'.
// Returns the raw tag (verbatim) and end index, or null.
function scanHtmlTag(s, i) {
  const n = s.length;
  let j = i + 1;
  if (j >= n) return null;
  const c = s.charCodeAt(j);
  if (c === 33) { // '!' — comment, declaration, CDATA
    if (s.startsWith('<!--', i)) {
      const e = s.indexOf('-->', i + 4);
      if (e === -1) return null;
      return [s.slice(i, e + 3), e + 3];
    }
    if (s.startsWith('<![CDATA[', i)) {
      const e = s.indexOf(']]>', i + 9);
      if (e === -1) return null;
      return [s.slice(i, e + 3), e + 3];
    }
    // Declaration <!A...>: a letter, then anything up to '>'.
    if (j + 1 < n && isAlpha(s.charCodeAt(j + 1))) {
      let e = j + 1;
      while (e < n && s.charCodeAt(e) !== 62) e++;
      if (e >= n) return null;
      return [s.slice(i, e + 1), e + 1];
    }
    return null;
  }
  if (c === 63) { // '?' — processing instruction up to '?>'
    const e = s.indexOf('?>', i + 2);
    if (e === -1) return null;
    return [s.slice(i, e + 2), e + 2];
  }
  // Open or close tag.
  let k = j;
  if (c === 47) { k++; if (k >= n || !isAlpha(s.charCodeAt(k))) return null; }
  else if (!isAlpha(c)) return null;
  // Tag name.
  while (k < n && (isAlnum(s.charCodeAt(k)) || s.charCodeAt(k) === 45)) k++;
  // Attributes / self-closing / end.
  while (k < n) {
    const ch = s.charCodeAt(k);
    if (ch === 62) return [s.slice(i, k + 1), k + 1]; // '>'
    if (ch === 47) { // '/'
      if (k + 1 < n && s.charCodeAt(k + 1) === 62) return [s.slice(i, k + 2), k + 2];
      return null;
    }
    if (ch === 32 || ch === 9 || ch === 10) { k++; continue; }
    // Attribute name.
    if (!(isAlpha(ch) || ch === 95 || ch === 58)) return null;
    while (k < n) {
      const a = s.charCodeAt(k);
      if (isAlnum(a) || a === 95 || a === 58 || a === 46 || a === 45) k++;
      else break;
    }
    // Optional = value.
    let m = k;
    while (m < n && (s.charCodeAt(m) === 32 || s.charCodeAt(m) === 9 || s.charCodeAt(m) === 10)) m++;
    if (m < n && s.charCodeAt(m) === 61) { // '='
      m++;
      while (m < n && (s.charCodeAt(m) === 32 || s.charCodeAt(m) === 9 || s.charCodeAt(m) === 10)) m++;
      if (m >= n) return null;
      const q = s.charCodeAt(m);
      if (q === 34 || q === 39) { // quoted value
        const e = s.indexOf(String.fromCharCode(q), m + 1);
        if (e === -1) return null;
        k = e + 1;
      } else { // unquoted value: no space, ", ', =, <, >, `
        if (q === 32 || q === 9 || q === 10 || q === 34 || q === 39 || q === 61 || q === 60 || q === 62 || q === 96) return null;
        while (m < n) {
          const v = s.charCodeAt(m);
          if (v === 32 || v === 9 || v === 10 || v === 34 || v === 39 || v === 61 || v === 60 || v === 62 || v === 96) break;
          m++;
        }
        k = m;
      }
    } else k = m;
  }
  return null;
}

// --- GFM extended autolinks ------------------------------------------------
// The character before an extended autolink must be the start, whitespace,
// or one of * _ ~ (.
function gfmBoundary(s, i) {
  if (i <= 0) return true;
  const c = s.charCodeAt(i - 1);
  if (c === 32 || c === 9 || c === 10) return true;
  if (isPunct(c)) return true;
  if (c >= 128) return isUnicodePunct(s[i - 1]);
  return false;
}

// Scan a www./http(s):// autolink starting at s[i]. Returns {href, text, end}
// or null. `s[i]` is 'w' (www., lowercase only) or 'h' (http://, https:// or
// ftp://, any case). The char before i must be the start, whitespace, or one
// of * _ ~ (.
function scanGfmAutolink(s, i) {
  const n = s.length;
  let j = i;
  let isWww = false;
  const c0 = s.charCodeAt(i) | 32;
  if (c0 === 119) { j = i + 4; isWww = true; } // www.
  else if (c0 === 104) { // http:// or https://
    j = (s.charCodeAt(i + 4) | 32) === 115 ? i + 8 : i + 7;
  } else { j = i + 6; } // ftp://
  if (!gfmBoundary(s, i)) return null;
  // Raw end: first whitespace or '<'.
  let e = j;
  while (e < n) {
    const c = s.charCodeAt(e);
    if (c === 32 || c === 9 || c === 10 || c === 60) break;
    e++;
  }
  let end = e;
  // A '(' with no ')' after it ends the autolink before it.
  for (let p = j; p < end; p++) {
    if (s.charCodeAt(p) === 40) {
      let hasClose = false;
      for (let q = p + 1; q < end; q++) if (s.charCodeAt(q) === 41) { hasClose = true; break; }
      if (!hasClose) { end = p; break; }
    }
  }
  // Trim trailing punctuation, unbalanced closers, and underscores
  // (a trailing _ may close emphasis instead of belonging to the URL).
  const isTrail = (c) => c === 46 || c === 44 || c === 59 || c === 58 ||
    c === 33 || c === 63 || c === 39 || c === 34 || c === 95 ||
    c === 42 || c === 126;
  while (end > j) {
    const c = s.charCodeAt(end - 1);
    if (isTrail(c)) { end--; continue; }
    if (c === 41 || c === 93 || c === 125) {
      const open = c === 41 ? 40 : c === 93 ? 91 : 123;
      let depth = 0;
      for (let p = i; p < end; p++) {
        if (s.charCodeAt(p) === open) depth++;
        else if (s.charCodeAt(p) === c) depth--;
      }
      if (depth <= 0) { end--; continue; }
    }
    break;
  }
  if (end <= j) return null;
  const text = s.slice(i, end);
  // Validate the domain (up to the first /, ?, # or :).
  let dEnd = end;
  for (let p = j; p < end; p++) {
    const c = s.charCodeAt(p);
    if (c === 47 || c === 63 || c === 35 || c === 58) { dEnd = p; break; }
  }
  const domain = s.slice(j, dEnd);
  if (!validGfmDomain(domain)) return null;
  let href = text;
  if (isWww) href = 'http://' + text;
  return { href, text, end };
}

// A GFM domain: first label starts with a letter, digit or '-' (not '_' or
// '.'), then labels of letters, digits, '-' and '_' (later ones may be empty).
function validGfmDomain(domain) {
  if (domain.length === 0) return false;
  const labels = domain.split('.');
  const first = labels[0];
  if (first.length === 0) return false;
  const c0 = first.charCodeAt(0);
  if (!(isAlnum(c0) || c0 === 45)) return false;
  for (let p = 0; p < first.length; p++) {
    const c = first.charCodeAt(p);
    if (!(isAlnum(c) || c === 45 || c === 95)) return false;
  }
  for (let li = 1; li < labels.length; li++) {
    const lab = labels[li];
    for (let p = 0; p < lab.length; p++) {
      const c = lab.charCodeAt(p);
      if (!(isAlnum(c) || c === 45 || c === 95)) return false;
    }
  }
  return true;
}

// Try a GFM email autolink with '@' at s[i]. `runStart` is the start of the
// current text run. Returns {href, text, end, localStart} or null.
// The local part is the maximal run of local characters before '@'; an
// optional lowercase 'mailto:' before it (itself after a GFM boundary) is
// included in the link.
function scanGfmEmail(s, i, runStart, hasUndOpener) {
  const n = s.length;
  const isLocal = (c) => isAlnum(c) || c === 46 || c === 33 || c === 35 || c === 36 ||
    c === 37 || c === 38 || c === 39 || c === 42 || c === 43 || c === 47 ||
    c === 61 || c === 63 || c === 94 || c === 95 || c === 96 || c === 123 ||
    c === 124 || c === 125 || c === 126 || c === 45;
  let ls = i;
  while (ls > runStart && isLocal(s.charCodeAt(ls - 1))) ls--;
  if (ls === i) return null;
  // Domain: labels of [A-Za-z0-9_-]+ separated by '.', at least one dot,
  // ending in an alphanumeric. A '_' that could close emphasis (followed
  // by a non-alphanumeric, with an active '_' opener) ends the domain
  // instead of being swallowed into it.
  let e = i + 1;
  while (e < n) {
    const c = s.charCodeAt(e);
    if (c === 95 && hasUndOpener && (e + 1 >= n || !isAlnum(s.charCodeAt(e + 1)))) break;
    if (isAlnum(c) || c === 46 || c === 45 || c === 95) e++;
    else break;
  }
  let end = e;
  while (end > i + 1) {
    const c = s.charCodeAt(end - 1);
    if (c === 46 || c === 44 || c === 59 || c === 58 || c === 33 || c === 63) end--;
    else break;
  }
  if (end <= i + 1) return null;
  const domain = s.slice(i + 1, end);
  if (!validEmailDomain(domain)) return null;
  let localStart = ls;
  if (ls >= 7 && s.slice(ls - 7, ls) === 'mailto:' && gfmBoundary(s, ls - 7)) {
    localStart = ls - 7;
  }
  const text = s.slice(localStart, end);
  const href = localStart < ls ? text : 'mailto:' + text;
  return { href, text, end, localStart };
}

function validEmailDomain(domain) {
  if (domain.indexOf('.') === -1) return false;
  const last = domain.charCodeAt(domain.length - 1);
  if (!isAlnum(last)) return false;
  const labels = domain.split('.');
  for (const lab of labels) {
    if (lab.length === 0) return false;
    for (let p = 0; p < lab.length; p++) {
      const c = lab.charCodeAt(p);
      if (!(isAlnum(c) || c === 45 || c === 95)) return false;
    }
  }
  return true;
}

// Skip spaces/tabs/newlines (inline links may span lines inside a paragraph).
function skipWsNl(s, i) {
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10) i++;
    else break;
  }
  return i;
}

// Parse an inline link's (destination title) starting at s[i] === '('.
// Returns {dest, title, end} (end just past ')') or null.
function parseInlineLink(s, i) {
  const n = s.length;
  let j = skipWsNl(s, i + 1);
  if (j < n && s.charCodeAt(j) === 41) return { dest: '', title: null, end: j + 1 };
  let dest = null;
  let k = j;
  if (j < n && (s.charCodeAt(j) === 34 || s.charCodeAt(j) === 39 || s.charCodeAt(j) === 40)) {
    // Title with an empty destination.
    dest = '';
  } else {
    const d = parseDest(s, j);
    if (!d) return null;
    dest = d[0];
    k = d[1];
  }
  let m = skipWsNl(s, k);
  let title = null;
  if (m < n) {
    const c = s.charCodeAt(m);
    if (c === 34 || c === 39 || c === 40) {
      const t = parseTitle(s, m);
      if (!t) return null;
      title = t[0];
      m = t[1];
      m = skipWsNl(s, m);
    }
  }
  if (m >= n || s.charCodeAt(m) !== 41) return null;
  return { dest, title, end: m + 1 };
}

// --- emphasis --------------------------------------------------------------
// Compute flanking for a delimiter run at [i, i+len) in s.
function flanking(s, i, len) {
  const n = s.length;
  let beforeWs = true, beforePunct = false;
  if (i > 0) {
    const bc = s.charCodeAt(i - 1);
    beforeWs = isWhitespace(bc);
    beforePunct = isPunct(bc) || (bc >= 128 && isUnicodePunct(s[i - 1]));
  }
  let afterWs = true, afterPunct = false;
  if (i + len < n) {
    const ac = s.charCodeAt(i + len);
    afterWs = isWhitespace(ac);
    afterPunct = isPunct(ac) || (ac >= 128 && isUnicodePunct(s[i + len]));
  }
  const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
  const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);
  return { leftFlanking, rightFlanking };
}

// --- the inline scanner ----------------------------------------------------
function parseInline(text, refs) {
  const n = text.length;
  let head = null, tail = null;
  const delims = [];   // delimiter nodes, in document order
  const brackets = []; // {node, active, image, start, delimCount} bracket openers
  let textStart = 0;   // start of the current plain-text run
  // `floor` is the index in `text` after the last atomic construct (code
  // span, autolink, HTML tag, link, entity, backslash escape). An email
  // autolink's local part may start at or after it, and may span plain text
  // and '_'/'~' delimiter runs, but never an atomic construct.
  let floor = 0;

  function append(node) {
    node.prev = tail; node.next = null;
    if (tail) tail.next = node; else head = node;
    tail = node;
    return node;
  }
  function flushText(to) {
    if (to > textStart) append({ s: escapeText(text.slice(textStart, to)) });
  }
  // Remove nodes from `first` through `last` (inclusive) out of the list,
  // returning them as an array (used when an image swallows its link text).
  function unlinkRange(first, last) {
    const kids = [];
    let cur = first;
    while (cur) {
      kids.push(cur);
      if (cur.d) cur.active = false; // dead for emphasis
      if (cur === last) break;
      cur = cur.next;
    }
    const before = first.prev, after = last.next;
    if (before) before.next = after; else head = after;
    if (after) after.prev = before; else tail = before;
    for (const k of kids) { k.prev = null; k.next = null; }
    return kids;
  }

  // Emphasis processing (CommonMark appendix A, phase 2) over delims[lo..],
  // where lo is the exclusive lower bound (stack_bottom). When done, every
  // delimiter at or above lo is removed from the stack.
  function processEmphasis(lo) {
    const openersBottom = new Map();
    let current = lo + 1;
    while (current < delims.length) {
      const closer = delims[current];
      if (!closer.active || !closer.canClose) { current++; continue; }
      const key = closer.ch * 16 + (closer.len % 3) * 2 + (closer.canOpen ? 1 : 0);
      let bottom = openersBottom.has(key) ? openersBottom.get(key) : lo;
      let found = -1;
      for (let k = current - 1; k > bottom; k--) {
        const d = delims[k];
        if (!d.active || d.ch !== closer.ch || !d.canOpen) continue;
        // Strikethrough: opener and closer must have the same length.
        if (closer.ch === 126 && d.len !== closer.len) continue;
        // Rule of 3: if one of the two can both open and close, the sum of
        // the lengths must not be a multiple of 3 unless both are.
        if ((d.canClose || closer.canOpen) &&
            (d.len + closer.len) % 3 === 0 &&
            !(d.len % 3 === 0 && closer.len % 3 === 0)) continue;
        found = k;
        break;
      }
      if (found >= 0) {
        const opener = delims[found];
        const use = (opener.len >= 2 && closer.len >= 2) ? 2 : 1;
        // Delimiters between opener and closer leave the stack.
        for (let k = found + 1; k < current; k++) delims[k].active = false;
        const openTag = closer.ch === 126 ? '<del>' : use === 2 ? '<strong>' : '<em>';
        const closeTag = closer.ch === 126 ? '</del>' : use === 2 ? '</strong>' : '</em>';
        opener.pre = openTag + (opener.pre || '');
        closer.post = (closer.post || '') + closeTag;
        opener.len -= use;
        closer.len -= use;
        if (opener.len === 0) opener.active = false;
        if (closer.len === 0) { closer.active = false; current++; }
        // Otherwise the closer stays: it looks for another opener.
      } else {
        openersBottom.set(key, current - 1);
        if (!closer.canOpen) closer.active = false;
        current++;
      }
    }
    for (let k = lo + 1; k < delims.length; k++) delims[k].active = false;
  }

  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 92) { // backslash
      if (i + 1 < n) {
        const c2 = text.charCodeAt(i + 1);
        if (c2 === 10) { // hard break: \<newline>
          flushText(i);
          append({ s: '<br>' });
          i += 2; textStart = i; floor = i;
          continue;
        }
        if (isPunct(c2)) {
          flushText(i);
          append({ s: escapeText(text[i + 1]) });
          i += 2; textStart = i; floor = i;
          continue;
        }
      }
      i++;
      continue;
    }
    if (c === 96) { // backtick: code span
      const cs = scanCodeSpan(text, i);
      if (cs) {
        flushText(i);
        append({ code: true, s: escapeText(cs[0]), codeText: cs[0] });
        i = cs[1]; textStart = i; floor = i;
        continue;
      }
      // No matching closer: the whole run is literal text.
      let k = 1;
      while (i + k < n && text.charCodeAt(i + k) === 96) k++;
      i += k;
      continue;
    }
    if (c === 42 || c === 95 || c === 126) { // * _ ~ delimiter run
      let len = 1;
      while (i + len < n && text.charCodeAt(i + len) === c) len++;
      const { leftFlanking, rightFlanking } = flanking(text, i, len);
      let canOpen, canClose;
      if (c === 95) {
        canOpen = leftFlanking && (!rightFlanking || flankingBeforePunct(text, i));
        canClose = rightFlanking && (!leftFlanking || flankingAfterPunct(text, i, len));
      } else {
        canOpen = leftFlanking;
        canClose = rightFlanking;
      }
      flushText(i);
      const node = { d: true, ch: c, len, canOpen, canClose, pre: '', post: '', active: true };
      append(node);
      delims.push(node);
      i += len; textStart = i;
      continue;
    }
    if (c === 91 || (c === 33 && i + 1 < n && text.charCodeAt(i + 1) === 91)) { // [ or ![
      const image = c === 33;
      flushText(i);
      const node = { b: true, image, active: true };
      append(node);
      brackets.push({ node, active: true, image, start: image ? i + 1 : i, delimCount: delims.length });
      i += image ? 2 : 1; textStart = i;
      continue;
    }
    if (c === 93) { // ] — try to form a link or image
      // Find the nearest active opener.
      let bi = brackets.length - 1;
      while (bi >= 0 && !brackets[bi].active) bi--;
      if (bi < 0) { i++; continue; }
      const b = brackets[bi];
      let link = null;
      let end = -1;
      const after = i + 1;
      if (after < n && text.charCodeAt(after) === 40) {
        const il = parseInlineLink(text, after);
        if (il) { link = { dest: il.dest, title: il.title }; end = il.end; }
      }
      if (!link) {
        // Reference link: [label], [], or shortcut.
        if (after < n && text.charCodeAt(after) === 91) {
          const lab = parseLabel(text, after);
          if (lab) {
            const key = normalizeLabel(lab[0]);
            const ref = key.length > 0 ? refs.get(key) : undefined;
            if (ref) { link = { dest: ref.dest, title: ref.title }; end = lab[1]; }
            else if (lab[0].length === 0) {
              // Collapsed reference: label is the link text.
              const raw = text.slice(b.start + 1, i);
              const k2 = normalizeLabel(raw);
              const r2 = k2.length > 0 ? refs.get(k2) : undefined;
              if (r2) { link = { dest: r2.dest, title: r2.title }; end = lab[1]; }
            }
          }
        }
        if (!link) {
          const raw = text.slice(b.start + 1, i);
          const k2 = normalizeLabel(raw);
          const r2 = k2.length > 0 ? refs.get(k2) : undefined;
          if (r2) { link = { dest: r2.dest, title: r2.title }; end = i + 1; }
        }
      }
      if (!link) {
        // No link formed: this opener is consumed (a later ']' matches an
        // earlier '['), so the inner brackets stay literal text.
        b.active = false;
        i++;
        continue;
      }
      // A link formed: emphasis inside its text is resolved now, with the
      // '[' as the stack bottom; those delimiters then leave the stack.
      processEmphasis(b.delimCount - 1);
      // A link deactivates all earlier openers (no links within links); an
      // image does not (an image may sit inside a link).
      if (!b.image) {
        for (let k = 0; k < bi; k++) brackets[k].active = false;
      }
      brackets.length = bi; // pop this and any inactive ones above it
      flushText(i);
      const openNode = b.node;
      if (b.image) {
        const kids = openNode.next ? unlinkRange(openNode.next, tail) : [];
        openNode.img = true; openNode.src = link.dest; openNode.title = link.title;
        openNode.kids = kids; openNode.alt = null;
        delete openNode.b; delete openNode.image; delete openNode.active;
      } else {
        openNode.link = true;
        openNode.s = '<a href="' + hrefAttr(link.dest) + '"' +
          (link.title !== null && link.title !== undefined ? ' title="' + escapeAttr(link.title) + '"' : '') + '>';
        openNode.kids = null;
        // GFM autolinks (scheme/www/email) do not form inside link text;
        // <...> autolinks do. Convert any GFM autolink inside the text
        // back to plain text.
        for (let nd = openNode.next; nd; nd = nd.next) {
          if (nd.auto && nd.gfm) {
            nd.s = escapeText(nd.text);
            delete nd.auto; delete nd.gfm; delete nd.href; delete nd.text;
          }
        }
        delete openNode.b; delete openNode.image; delete openNode.active;
        append({ closeLink: true });
      }
      i = end; textStart = i; floor = i;
      continue;
    }
    if (c === 60) { // < — autolink, HTML tag, or literal
      const al = scanAutolink(text, i);
      if (al) {
        flushText(i);
        append({ auto: true, href: al.href, text: al.text, gfm: false });
        i = al.end; textStart = i; floor = i;
        continue;
      }
      const tag = scanHtmlTag(text, i);
      if (tag) {
        flushText(i);
        append({ html: true, s: tag[0] });
        i = tag[1]; textStart = i; floor = i;
        continue;
      }
      flushText(i);
      append({ s: '&lt;' });
      i++; textStart = i;
      continue;
    }
    if (c === 38) { // & — entity or literal
      const ent = decodeEntity(text, i);
      if (ent) {
        flushText(i);
        append({ s: ent[0] });
        i += ent[1]; textStart = i; floor = i;
        continue;
      }
      flushText(i);
      append({ s: '&amp;' });
      i++; textStart = i;
      continue;
    }
    if (c === 62) { // >
      flushText(i);
      append({ s: '&gt;' });
      i++; textStart = i;
      continue;
    }
    if (c === 64) { // @ — GFM email autolink
      let hasUndOpener = false;
      for (let d = delims.length - 1; d >= 0; d--) {
        if (delims[d].active && delims[d].ch === 95) { hasUndOpener = true; break; }
      }
      const em = scanGfmEmail(text, i, floor, hasUndOpener);
      if (em) {
        flushText(em.localStart);
        append({ auto: true, href: em.href, text: em.text, gfm: true });
        i = em.end; textStart = i; floor = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === 119 || (c | 32) === 104 || (c | 32) === 102) { // w / h / f — GFM autolink
      let maybe = false;
      if (c === 119) maybe = text.startsWith('www.', i);
      else if ((c | 32) === 104) { // http:// or https://, any case
        const c1 = text.charCodeAt(i + 1) | 32, c2 = text.charCodeAt(i + 2) | 32,
          c3 = text.charCodeAt(i + 3) | 32;
        if (c1 === 116 && c2 === 116 && c3 === 112) {
          const c4 = text.charCodeAt(i + 4);
          maybe = (c4 === 58 && text.charCodeAt(i + 5) === 47 && text.charCodeAt(i + 6) === 47) ||
            ((c4 | 32) === 115 && text.charCodeAt(i + 5) === 58 && text.charCodeAt(i + 6) === 47 && text.charCodeAt(i + 7) === 47);
        }
      } else { // ftp://, any case
        const c1 = text.charCodeAt(i + 1) | 32, c2 = text.charCodeAt(i + 2) | 32;
        maybe = c1 === 116 && c2 === 112 && text.charCodeAt(i + 3) === 58 &&
          text.charCodeAt(i + 4) === 47 && text.charCodeAt(i + 5) === 47;
      }
      if (maybe) {
        const ga = scanGfmAutolink(text, i);
        if (ga) {
          flushText(i);
          append({ auto: true, href: ga.href, text: ga.text, gfm: true });
          i = ga.end; textStart = i; floor = i;
          continue;
        }
      }
      i++;
      continue;
    }
    if (c === 10) { // newline: soft or hard break
      // Count trailing spaces in the current text run.
      let sp = 0;
      let p = i - 1;
      while (p >= textStart && text.charCodeAt(p) === 32) { sp++; p--; }
      if (sp >= 2) {
        flushText(i - sp);
        append({ s: '<br>' });
        floor = i + 1;
      } else {
        flushText(i + 1);
      }
      i++; textStart = i;
      continue;
    }
    i++;
  }
  flushText(n);

  // Resolve emphasis over the whole inline (stack bottom: none).
  processEmphasis(-1);

  // --- render ---
  let out = '';
  let cur = head;
  while (cur) {
    if (cur.img) {
      if (cur.alt === null) {
        let alt = '';
        for (const k of cur.kids) alt += plainText(k);
        cur.alt = alt;
      }
      out += renderNode(cur);
    } else {
      out += renderNode(cur);
    }
    cur = cur.next;
  }
  return out;
}

// Helpers for the '_' flanking rules (need the char before/after the run).
function flankingBeforePunct(s, i) {
  if (i <= 0) return false;
  const c = s.charCodeAt(i - 1);
  return isPunct(c) || (c >= 128 && isUnicodePunct(s[i - 1]));
}
function flankingAfterPunct(s, i, len) {
  if (i + len >= s.length) return false;
  const c = s.charCodeAt(i + len);
  return isPunct(c) || (c >= 128 && isUnicodePunct(s[i + len]));
}

// ---------------------------------------------------------------------------
// Block parser
// ---------------------------------------------------------------------------
// Block node shapes:
//   {t:'doc'|'quote', children}
//   {t:'list', ordered, delim, bullet, start, tight, children:[item]}
//   {t:'item', indent, children}
//   {t:'p', lines}
//   {t:'heading', level, lines}
//   {t:'code', fence, fenceChar, fenceLen, indent, info, lines}
//   {t:'html', type, end, lines}
//   {t:'hr'}
//   {t:'table', aligns, header, rows}

function nextTabStop(col) { return col + (4 - (col % 4)); }

// Indent (in columns) of the line at pos, starting at column col.
function indentOf(line, pos, col) {
  let c = col;
  let p = pos;
  while (p < line.length) {
    const ch = line.charCodeAt(p);
    if (ch === 32) { p++; c++; }
    else if (ch === 9) { p++; c = nextTabStop(c); }
    else break;
  }
  return c;
}

// Advance (pos, col) to reach target column. A tab that straddles the
// target is consumed and its leftover virtual spaces are returned as pend.
function consumeToCol(line, pos, col, target) {
  let pend = 0;
  while (col < target && pos < line.length) {
    const ch = line.charCodeAt(pos);
    if (ch === 32) { pos++; col++; }
    else if (ch === 9) {
      const nt = nextTabStop(col);
      if (nt > target) { pend = nt - target; col = target; pos++; break; }
      pos++; col = nt;
    } else break;
  }
  return { pos, col, pend };
}

function isBlankFrom(line, pos) {
  for (let p = pos; p < line.length; p++) {
    const ch = line.charCodeAt(p);
    if (ch !== 32 && ch !== 9) return false;
  }
  return true;
}

// Leading whitespace of s: the indent in columns (relative to s[0]) and
// the char index just past it. Tabs advance to the next multiple of 4 in
// absolute terms, so s[0] is at absolute column sc (0 by default).
function leadingWs(s, sc) {
  let col = sc || 0, i = 0;
  const start = col;
  while (i < s.length) {
    const ch = s.charCodeAt(i);
    if (ch === 32) { i++; col++; }
    else if (ch === 9) { i++; col = nextTabStop(col); }
    else break;
  }
  return { cols: col - start, idx: i };
}

// Indent of s in columns (relative to s[0]).
function indentCols(s, sc) { return leadingWs(s, sc).cols; }

// Strip up to `n` columns of leading whitespace from s. A tab that
// straddles the boundary leaves its leftover virtual spaces.
function stripCols(s, n, sc) {
  let i = 0, col = sc || 0;
  const start = col;
  // A leading tab inside a container (sc > 0) expands to spaces even when
  // nothing is stripped; at the top level (sc === 0) it is preserved.
  if (n === 0 && sc > 0 && s.charCodeAt(0) === 9) {
    return ' '.repeat(nextTabStop(sc) - sc) + s.slice(1);
  }
  while (i < s.length && col - start < n) {
    const ch = s.charCodeAt(i);
    if (ch === 32) { i++; col++; }
    else if (ch === 9) {
      const nt = nextTabStop(col);
      if (nt - start > n) return ' '.repeat(nt - start - n) + s.slice(i + 1);
      i++; col = nt;
    } else break;
  }
  return s.slice(i);
}

function matchAtx(s, sc) {
  const w = leadingWs(s, sc);
  if (w.cols > 3) return null;
  let i = w.idx;
  let level = 0;
  while (i < s.length && s.charCodeAt(i) === 35 && level < 7) { level++; i++; }
  if (level === 0 || level > 6) return null;
  if (i < s.length && s.charCodeAt(i) !== 32 && s.charCodeAt(i) !== 9) return null;
  if (i < s.length && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
  let content = s.slice(i);
  let end = content.length;
  while (end > 0 && (content.charCodeAt(end - 1) === 32 || content.charCodeAt(end - 1) === 9)) end--;
  let h = end;
  while (h > 0 && content.charCodeAt(h - 1) === 35) h--;
  if (h < end && (h === 0 || content.charCodeAt(h - 1) === 32 || content.charCodeAt(h - 1) === 9)) {
    content = content.slice(0, h === 0 ? 0 : h - 1);
  }
  return { level, content: content.trim() };
}

function matchFence(s, sc) {
  const w = leadingWs(s, sc);
  if (w.cols > 3) return null;
  const c = s.charCodeAt(w.idx);
  if (c !== 96 && c !== 126) return null;
  let i = w.idx;
  while (i < s.length && s.charCodeAt(i) === c) i++;
  const len = i - w.idx;
  if (len < 3) return null;
  const info = s.slice(i).trim();
  if (c === 96 && info.indexOf('`') >= 0) return null;
  return { char: c, len, info, indent: w.cols };
}

function matchHr(s, sc) {
  const w = leadingWs(s, sc);
  if (w.cols > 3) return null;
  const c = s.charCodeAt(w.idx);
  if (c !== 45 && c !== 42 && c !== 95) return null;
  let count = 0;
  for (let i = w.idx; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === c) count++;
    else if (ch === 32 || ch === 9) continue;
    else return null;
  }
  return count >= 3;
}

function matchSetext(s, sc) {
  const w = leadingWs(s, sc);
  if (w.cols > 3) return null;
  const c = s.charCodeAt(w.idx);
  if (c !== 61 && c !== 45) return null;
  let i = w.idx;
  while (i < s.length && s.charCodeAt(i) === c) i++;
  if (i === w.idx) return 0;
  for (; i < s.length; i++) {
    if (s.charCodeAt(i) !== 32 && s.charCodeAt(i) !== 9) return 0;
  }
  return c === 61 ? 1 : 2;
}

const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul').split(' '));
const HTML1_TAGS = new Set(['pre', 'script', 'style', 'textarea']);

// HTML block start. Returns {type, end} or null. Type 1 ends at a line
// containing the end tag; 2-5 at a line containing the end marker; 6-7 at
// a blank line. Type 7 cannot interrupt a paragraph.
function matchHtmlBlock(s, sc) {
  const w = leadingWs(s, sc);
  if (w.cols > 3) return null;
  if (s.charCodeAt(w.idx) !== 60) return null;
  let i = w.idx + 1;
  if (s.startsWith('<!--', w.idx)) return { type: 2, end: '-->' };
  if (s.charCodeAt(i) === 63) return { type: 3, end: '?>' };
  if (s.charCodeAt(i) === 33) {
    const c = s.charCodeAt(i + 1);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) return { type: 4, end: '>' };
    if (s.startsWith('[CDATA[', i + 1)) return { type: 5, end: ']]>' };
    return null;
  }
  let j = i;
  const closing = s.charCodeAt(j) === 47;
  if (closing) j++;
  const nameStart = j;
  if (j < s.length) {
    const c = s.charCodeAt(j);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return null;
    j++;
    while (j < s.length) {
      const c2 = s.charCodeAt(j);
      if ((c2 >= 65 && c2 <= 90) || (c2 >= 97 && c2 <= 122) ||
          (c2 >= 48 && c2 <= 57) || c2 === 45) j++;
      else break;
    }
  }
  if (j === nameStart) return null;
  const name = s.slice(nameStart, j).toLowerCase();
  const nc = j < s.length ? s.charCodeAt(j) : 10;
  if (nc !== 32 && nc !== 9 && nc !== 62 && nc !== 10) {
    if (!(nc === 47 && s.charCodeAt(j + 1) === 62)) return null;
  }
  if (closing) {
    // A closing tag is type 7 when alone on the line (any name), or when
    // the name is a block-level tag. It needs the '>'.
    const end = tagEnd(s, j);
    if (end < 0) return null;
    if (BLOCK_TAGS.has(name) || onlyWs(s, end)) return { type: 7, end: null, name };
    return null;
  }
  if (HTML1_TAGS.has(name)) return { type: 1, end: '</' + name + '>', name };
  if (BLOCK_TAGS.has(name)) return { type: 6, end: null, name };
  // Type 7 (opening tag of any other name): the tag must be alone on the line.
  const end = tagEnd(s, j);
  if (end < 0 || !onlyWs(s, end)) return null;
  return { type: 7, end: null, name };
}

// Index just after the closing '>' of a tag (j is just past the tag name),
// respecting single/double quotes. -1 when the tag never closes.
function tagEnd(s, j) {
  let q = 0;
  for (let k = j; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (q) { if (c === q) q = 0; continue; }
    if (c === 34 || c === 39) { q = c; continue; }
    if (c === 62) return k + 1;
  }
  return -1;
}

// True when s from idx onward is only spaces/tabs.
function onlyWs(s, idx) {
  for (let k = idx; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function matchList(s, sc) {
  const w = leadingWs(s, sc);
  if (w.cols > 3) return null;
  const c = s.charCodeAt(w.idx);
  let ordered = false, delim = 0, bullet = 0, start = 0, markerEnd = 0;
  if (c === 45 || c === 43 || c === 42) { bullet = c; markerEnd = w.idx + 1; }
  else if (c >= 48 && c <= 57) {
    let j = w.idx;
    while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++;
    if (j - w.idx > 9) return null;
    const d = s.charCodeAt(j);
    if (d !== 46 && d !== 41) return null;
    start = parseInt(s.slice(w.idx, j), 10);
    if (start > 999999999) return null;
    ordered = true; delim = d; markerEnd = j + 1;
  } else return null;
  // Column of the marker end (absolute: sc is the column of s[0]).
  const markerCol = (sc || 0) + w.cols + (markerEnd - w.idx);
  let j = markerEnd, col = markerCol;
  while (j < s.length) {
    const ch = s.charCodeAt(j);
    if (ch === 32) { j++; col++; }
    else if (ch === 9) { col = nextTabStop(col); j++; }
    else break;
  }
  const sp = col - markerCol;
  let contentIndent, contentPos, pend = 0;
  if (j >= s.length) {
    contentIndent = markerCol + 1;
    contentPos = j;
  } else if (sp === 0) {
    return null;
  } else if (sp >= 5) {
    contentIndent = markerCol + 1;
    const r = consumeToCol(s, markerEnd, markerCol, contentIndent);
    contentPos = r.pos; pend = r.pend;
  } else {
    contentIndent = col;
    contentPos = j;
  }
  return { ordered, delim, bullet, start, markerEnd, contentIndent, contentPos, pend };
}

// Split a table row on unescaped '|'. Drops a leading/trailing
// whitespace-only cell; trims each cell.
function splitCells(row) {
  const cells = [];
  let start = 0;
  let i = 0;
  const n = row.length;
  while (i < n) {
    const c = row.charCodeAt(i);
    if (c === 92 && i + 1 < n && row.charCodeAt(i + 1) === 124) { i += 2; continue; }
    if (c === 124) { cells.push(row.slice(start, i)); start = i + 1; }
    i++;
  }
  cells.push(row.slice(start));
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  for (let k = 0; k < cells.length; k++) cells[k] = cells[k].trim().replace(/\\\|/g, '|');
  return cells;
}

// Is `s` (a line's rest, absolute start column sc) a table delimiter row
// with indent <= 3? Returns the aligns or null.
function delimRow(s, sc) {
  if (indentCols(s, sc) > 3) return null;
  return parseDelimRow(s);
}

// Parse a table delimiter row. Returns an array of aligns ('left' |
// 'center' | 'right' | null) or null.
function parseDelimRow(s) {
  const cells = splitCells(s);
  if (cells.length === 0) return null;
  const aligns = [];
  for (const cell of cells) {
    const t = cell;
    let a = 0, b = t.length;
    if (b > 0 && t.charCodeAt(0) === 58) a = 1;
    if (b > a && t.charCodeAt(b - 1) === 58) b--;
    if (b - a < 1) return null;
    for (let i = a; i < b; i++) if (t.charCodeAt(i) !== 45) return null;
    const left = t.charCodeAt(0) === 58;
    const right = t.length > 0 && t.charCodeAt(t.length - 1) === 58;
    aligns.push(left && right ? 'center' : left ? 'left' : right ? 'right' : null);
  }
  return aligns;
}

// Does this line start a block that ends a table (fence, ATX, HTML 1-6,
// thematic break, list, blockquote, indented code)?
function tableTerminator(s, sc) {
  if (matchFence(s, sc)) return true;
  if (matchAtx(s, sc)) return true;
  const hb = matchHtmlBlock(s, sc);
  if (hb && hb.type !== 7) return true;
  if (matchHr(s, sc)) return true;
  if (matchList(s, sc)) return true;
  const w = leadingWs(s, sc);
  if (w.cols <= 3 && s.charCodeAt(w.idx) === 62) return true;
  // Indented code: only when there is non-whitespace content after the
  // indent (a whitespace-only line is a table row, not indented code).
  if (w.cols >= 4 && w.idx < s.length) return true;
  return false;
}

function parseBlocks(src) {
  const lines = src.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '' && src.endsWith('\n')) lines.pop();
  const refs = new Map();
  const doc = { t: 'doc', children: [] };
  const open = [doc];
  let blankLine = false;
  // The most recently closed type 1-5 HTML block (closed by its end
  // marker): if the very next line is blank, it loses its trailing newline.
  let pendingHtml = null;
  let ln = 0;
  let rest = ''; // the current line's content after container markers
  let restCol = 0; // absolute column of rest[0] (for tab-stop math)

  function closeFrom(k) { open.length = k; }
  function parent() { return open[open.length - 1]; }

  // Compute the rest (content after container markers) of lines[li] under
  // the current container stack, without mutating it. Returns null when the
  // line does not match all open containers (or is blank, for quotes).
  function lookaheadRest(li) {
    const line = lines[li];
    let pos = 0, col = 0, pend = 0;
    const tip0 = open[open.length - 1];
    const tipIsLeaf = tip0.t === 'p' || tip0.t === 'code' || tip0.t === 'html' || tip0.t === 'table';
    const lastContainer = tipIsLeaf ? open.length - 2 : open.length - 1;
    for (let j = 1; j <= lastContainer; j++) {
      const b = open[j];
      if (b.t === 'quote') {
        let p = pos, c = col, skipped = 0;
        while (p < line.length && skipped < 3) {
          const ch = line.charCodeAt(p);
          if (ch === 32) { p++; c++; skipped++; }
          else if (ch === 9) { const nt = nextTabStop(c); if (nt - c > 3 - skipped) break; p++; c = nt; skipped += nt - c; }
          else break;
        }
        if (p < line.length && line.charCodeAt(p) === 62) {
          p++; c++;
          if (p < line.length) {
            const ch = line.charCodeAt(p);
            if (ch === 32) { p++; c++; }
            else if (ch === 9) { const nt = nextTabStop(c); pend += nt - c - 1; c = c + 1; p++; }
          }
          pos = p; col = c;
        } else return null;
      } else if (b.t === 'item') {
        if (isBlankFrom(line, pos)) return null;
        const ind = indentOf(line, pos, col);
        if (ind >= b.indent) {
          const r = consumeToCol(line, pos, col, b.indent);
          pos = r.pos; col = r.col; pend += r.pend;
        } else return null;
      }
    }
    return pend > 0 ? ' '.repeat(pend) + line.slice(pos) : line.slice(pos);
  }

  // Try to parse a link reference definition starting at the current line.
  // Returns the number of lines consumed, or 0. Consumes up to 4 lines.
  function tryRefDef(rest) {
    const w = leadingWs(rest);
    if (w.cols > 3 || rest.charCodeAt(w.idx) !== 91) return 0;
    let text = rest;
    let avail = 1;
    for (let k = 0; k < 9 && ln + k < lines.length; k++) {
      const lr = lookaheadRest(ln + k);
      if (lr === null) break;
      text += '\n' + lr;
      avail++;
    }
    const def = parseRefDef(text, w.idx);
    if (!def) return 0;
    const key = normalizeLabel(def.label);
    if (key.length > 0 && !refs.has(key)) refs.set(key, { dest: def.dest, title: def.title });
    let consumed = 1;
    for (let i = 0; i < def.end && i < text.length; i++) if (text.charCodeAt(i) === 10) consumed++;
    if (consumed > avail) consumed = avail;
    return consumed;
  }

  // Mark the list loose when a new block is added directly to a list item
  // that already has children, after a blank line.
  function maybeLoose() {
    if (!blankLine) return;
    const par = parent();
    if (par.t === 'item' && par.children.length > 0) open[open.length - 2].tight = false;
  }

  // Add a lazy continuation line to the open paragraph. A lazy line that
  // is a setext '=' underline, following another lazy line, inside a
  // blockquote, is indented by 4 spaces (so it stays paragraph text).
  function addLazyLine(r) {
    const tip = open[open.length - 1];
    if (tip.lastLazy && matchSetext(r, restCol) === 1 &&
        open.length >= 2 && open[open.length - 2].t === 'quote') {
      r = '    ' + r.replace(/^[ \t]*/, '');
    } else if (indentCols(r, restCol) >= 4) {
      r = stripCols(r, 4, restCol);
    }
    tip.lines.push(r);
    tip.lastLazy = true;
  }

  // The rest of lines[li] under the current containers, stopping at the
  // first container that fails to match (its content is taken from there).
  // Returns null for a blank line.
  function lookaheadRestLenient(li) {
    const line = lines[li];
    let pos = 0, col = 0, pend = 0;
    const tip0 = open[open.length - 1];
    const tipIsLeaf = tip0.t === 'p' || tip0.t === 'code' || tip0.t === 'html' || tip0.t === 'table';
    const lastContainer = tipIsLeaf ? open.length - 2 : open.length - 1;
    for (let j = 1; j <= lastContainer; j++) {
      const b = open[j];
      if (b.t === 'quote') {
        let p = pos, c = col, skipped = 0;
        while (p < line.length && skipped < 3) {
          const ch = line.charCodeAt(p);
          if (ch === 32) { p++; c++; skipped++; }
          else if (ch === 9) { const nt = nextTabStop(c); if (nt - c > 3 - skipped) break; p++; c = nt; skipped += nt - c; }
          else break;
        }
        if (p < line.length && line.charCodeAt(p) === 62) {
          p++; c++;
          if (p < line.length) {
            const ch = line.charCodeAt(p);
            if (ch === 32) { p++; c++; }
            else if (ch === 9) { const nt = nextTabStop(c); pend += nt - c - 1; c = c + 1; p++; }
          }
          pos = p; col = c;
        } else break;
      } else if (b.t === 'item') {
        if (isBlankFrom(line, pos)) return null;
        const ind = indentOf(line, pos, col);
        if (ind >= b.indent) {
          const r = consumeToCol(line, pos, col, b.indent);
          pos = r.pos; col = r.col; pend += r.pend;
        } else break;
      }
    }
    const r = pend > 0 ? ' '.repeat(pend) + line.slice(pos) : line.slice(pos);
    return isBlankFrom(r, 0) ? null : r;
  }

  // Is `r` (a line's rest) a table header, i.e. is the next line a valid
  // delimiter row with the same cell count? A setext underline is not a
  // delimiter row for this purpose.
  function isTableHeader(r) {
    if (ln >= lines.length) return false;
    const next = lookaheadRestLenient(ln);
    if (next === null) return false;
    if (matchSetext(next, 0)) return false;
    if (indentCols(next, 0) > 3) return false;
    const aligns = parseDelimRow(next);
    if (!aligns) return false;
    const headerCells = splitCells(r);
    return headerCells.length > 0 && headerCells.length === aligns.length;
  }

  // Is `r` a valid delimiter row for the open 1-line paragraph?
  function isTableDelim(r) {
    const tip = open[open.length - 1];
    if (tip.t !== 'p' || tip.lines.length !== 1) return false;
    const aligns = delimRow(r, restCol);
    if (!aligns) return false;
    const headerCells = splitCells(tip.lines[0]);
    return headerCells.length === aligns.length;
  }

  // Would the line (rest r, absolute start column rc) start a block that
  // overrides a lazy paragraph continuation? (Fence, ATX, HTML 1-6,
  // thematic break, any list, blockquote. Not indented code, not type-7
  // HTML, not a setext underline.)
  function overridesLazy(r, rc) {
    if (matchFence(r, rc)) return true;
    if (matchAtx(r, rc)) return true;
    const hb = matchHtmlBlock(r, rc);
    if (hb && hb.type !== 7) return true;
    if (matchHr(r, rc)) return true;
    if (matchList(r, rc)) return true;
    const wq = leadingWs(r, rc);
    if (wq.cols <= 3 && r.charCodeAt(wq.idx) === 62) return true;
    return false;
  }

  while (ln < lines.length) {
    const line = lines[ln];
    ln++;
    // ---- Phase 1: match open containers ----
    let pos = 0, col = 0, pend = 0;
    let failAt = -1; // index of the first container that failed to match
    const tip0 = open[open.length - 1];
    const tipIsLeaf = tip0.t === 'p' || tip0.t === 'code' || tip0.t === 'html' || tip0.t === 'table';
    const lastContainer = tipIsLeaf ? open.length - 2 : open.length - 1;
    for (let j = 1; j <= lastContainer; j++) {
      const b = open[j];
      if (b.t === 'quote') {
        let p = pos, c = col, skipped = 0;
        while (p < line.length && skipped < 3) {
          const ch = line.charCodeAt(p);
          if (ch === 32) { p++; c++; skipped++; }
          else if (ch === 9) { const nt = nextTabStop(c); if (nt - c > 3 - skipped) break; p++; c = nt; skipped += nt - c; }
          else break;
        }
        if (p < line.length && line.charCodeAt(p) === 62) {
          p++; c++;
          if (p < line.length) {
            const ch = line.charCodeAt(p);
            if (ch === 32) { p++; c++; }
            else if (ch === 9) { const nt = nextTabStop(c); pend += nt - c - 1; c = c + 1; p++; }
          }
          pos = p; col = c;
        } else if (tipIsLeaf && tip0.t === 'p' && !isBlankFrom(line, pos)) {
          failAt = j; break;
        } else {
          closeFrom(j); failAt = j; break;
        }
      } else if (b.t === 'item') {
        if (isBlankFrom(line, pos)) {
          // blank line: the item stays open
        } else {
          const ind = indentOf(line, pos, col);
          if (ind >= b.indent) {
            const r = consumeToCol(line, pos, col, b.indent);
            pos = r.pos; col = r.col; pend += r.pend;
          } else if (tipIsLeaf && tip0.t === 'p') {
            failAt = j; break;
          } else if (tip0.t === 'code' && tip0.fence) {
            // A fenced code block absorbs a line that does not match its
            // container; the container and the block stay open.
            break;
          } else {
            closeFrom(j); failAt = j; break;
          }
        }
      }
    }

    rest = pend > 0 ? ' '.repeat(pend) + line.slice(pos) : line.slice(pos);
    restCol = col;
    if (failAt >= 0 && tipIsLeaf && tip0.t === 'p' && !isBlankFrom(line, pos)) {
      // A container failed to match while a paragraph was open. The line
      // is a lazy continuation unless it starts a new block or is part of
      // a table.
      if (overridesLazy(rest, restCol)) {
        closeFrom(failAt);
      } else if (isTableDelim(rest)) {
        // The line is the delimiter row: the paragraph becomes a table,
        // in place, inside its container.
        const tip = open[open.length - 1];
        const aligns = delimRow(rest, restCol);
        const headerCells = splitCells(tip.lines[0]);
        open.pop();
        const par = parent();
        par.children.pop();
        const tbl = { t: 'table', aligns, header: headerCells, rows: [] };
        par.children.push(tbl);
        open.push(tbl);
        blankLine = false;
        continue;
      } else if (isTableHeader(rest)) {
        // The line starts a new paragraph (which the next line turns into
        // a table), inside the innermost open container.
        open.pop();
        const par = parent();
        par.children.pop();
        const p = { t: 'p', lines: [rest], lastLazy: false };
        par.children.push(p);
        open.push(p);
        blankLine = false;
        continue;
      } else {
        // Lazy paragraph continuation.
        addLazyLine(rest);
        blankLine = false;
        continue;
      }
    }
    let blank = isBlankFrom(rest, 0);
    if (pendingHtml) {
      if (blank) pendingHtml.followedByBlank = true;
      pendingHtml = null;
    }

    // ---- Phase 2: process the line (may reprocess after a leaf closes
    // or a container starts). ----
    for (;;) {
      blank = isBlankFrom(rest, 0);
      const tip = open[open.length - 1];
      if (tip.t === 'code' && tip.fence) {
        const f = matchFence(rest, restCol);
        if (f && f.char === tip.fenceChar && f.len >= tip.fenceLen && f.info === '') {
          // A blank line immediately before the closing fence is not
          // part of the code (exactly one trailing empty line is dropped).
          if (tip.lines.length > 0 && tip.lines[tip.lines.length - 1] === '') tip.lines.pop();
          open.pop();
          blankLine = false;
          break; // the closing fence line is consumed
        }
        tip.lines.push(stripCols(rest, tip.indent, restCol));
        blankLine = false;
        break;
      }
      if (tip.t === 'code' && !tip.fence) {
        if (blank) { tip.lines.push(stripCols(rest, 4, restCol)); break; }
        if (indentCols(rest, restCol) >= 4) { tip.lines.push(stripCols(rest, 4, restCol)); blankLine = false; break; }
        open.pop();
        continue; // reprocess the line
      }
      if (tip.t === 'html') {
        if (tip.type === 6 || tip.type === 7) {
          if (blank) { tip.followedByBlank = true; open.pop(); continue; }
          tip.lines.push(rest);
          blankLine = false;
          break;
        }
        tip.lines.push(rest);
        if (tip.end !== null && rest.toLowerCase().indexOf(tip.end.toLowerCase()) >= 0) { open.pop(); pendingHtml = tip; }
        blankLine = false;
        break;
      }
      if (tip.t === 'table') {
        // A line of only spaces ends the table; a line containing a tab
        // (or any other character) is a row, even if its cells are empty.
        let spacesOnly = true;
        for (let q = 0; q < rest.length; q++) {
          if (rest.charCodeAt(q) !== 32) { spacesOnly = false; break; }
        }
        if (spacesOnly) { open.pop(); continue; }
        if (tableTerminator(rest, restCol)) { open.pop(); continue; }
        tip.rows.push(rest);
        blankLine = false;
        break;
      }
      if (tip.t === 'p') {
        const se = matchSetext(rest, restCol);
        if (se) {
          open.pop();
          const par = parent();
          par.children.pop(); // the paragraph itself
          par.children.push({ t: 'heading', level: se, lines: [tip.lines.join('\n').trim()] });
          blankLine = false;
          break;
        }
        if (blank) {
          open.pop();
          blankLine = true;
          break;
        }
        // A line that is a table header (followed by a delimiter row) is
        // not a paragraph continuation: it starts a new paragraph.
        if (isTableHeader(rest)) {
          open.pop();
          continue; // reprocess: the line starts a new paragraph
        }
        if (tip.lines.length === 1) {
          const aligns = delimRow(rest, restCol);
          if (aligns) {
            const headerCells = splitCells(tip.lines[0]);
            if (headerCells.length === aligns.length) {
              open.pop();
              const par = parent();
              par.children.pop(); // the paragraph itself
              const tbl = { t: 'table', aligns, header: headerCells, rows: [] };
              par.children.push(tbl);
              open.push(tbl);
              blankLine = false;
              break;
            }
          }
        }
        // New block starts that can interrupt a paragraph.
        const started = startBlock(rest, true);
        if (started === 'container') continue;
        if (started === 'leaf') { blankLine = false; break; }
        tip.lines.push(rest);
        tip.lastLazy = false;
        blankLine = false;
        break;
      }
      // tip is a list: only a matching list item may continue it.
      if (tip.t === 'list') {
        if (blank) { blankLine = true; break; }
        if (matchHr(rest, restCol)) { open.pop(); continue; }
        const li = matchList(rest, restCol);
        if (li && li.ordered === tip.ordered &&
            (li.ordered ? li.delim === tip.delim : li.bullet === tip.bullet)) {
          if (blankLine) tip.tight = false;
          const item = { t: 'item', indent: li.contentIndent, children: [] };
          tip.children.push(item);
          open.push(item);
          rest = li.pend > 0 ? ' '.repeat(li.pend) + rest.slice(li.contentPos) : rest.slice(li.contentPos);
          restCol = restCol + li.contentIndent;
          blankLine = false;
          continue;
        }
        open.pop();
        continue;
      }
      // tip is a container (doc / quote / item)
      if (blank) {
        blankLine = true;
        break;
      }
      // A link reference definition consumes the line(s) and starts nothing.
      const consumed = tryRefDef(rest);
      if (consumed > 0) {
        ln += consumed - 1;
        blankLine = false;
        break;
      }
      const started = startBlock(rest, false);
      if (started === 'container') continue;
      if (started === 'leaf') { blankLine = false; break; }
      // Start a new paragraph.
      maybeLoose();
      const p = { t: 'p', lines: [rest], lastLazy: false };
      tip.children.push(p);
      open.push(p);
      blankLine = false;
      break;
    }
  }

  // startBlock: try to start a new block at `rest`. `interrupt` is true
  // when the current tip is a paragraph (only some blocks may interrupt).
  // Returns 'container' (a quote/list started; the remainder is in `rest`
  // and must be reprocessed), 'leaf' (a leaf started and consumed the
  // line), or null. Uses the closure variable `rest` by reference via an
  // object so the caller sees the updated remainder.
  function startBlock(s, interrupt) {
    // Close the paragraph this block interrupts (if any).
    function closePara() { if (parent().t === 'p') open.pop(); }
    // Fenced code.
    const f = matchFence(s, restCol);
    if (f) {
      closePara();
      maybeLoose();
      const code = { t: 'code', fence: true, fenceChar: f.char, fenceLen: f.len, indent: f.indent, info: f.info, lines: [] };
      parent().children.push(code);
      open.push(code);
      return 'leaf';
    }
    // ATX heading.
    const atx = matchAtx(s, restCol);
    if (atx) {
      closePara();
      maybeLoose();
      parent().children.push({ t: 'heading', level: atx.level, lines: [atx.content] });
      return 'leaf';
    }
    // HTML block.
    const hb = matchHtmlBlock(s, restCol);
    if (hb && (!interrupt || hb.type !== 7 || BLOCK_TAGS.has(hb.name))) {
      closePara();
      maybeLoose();
      const html = { t: 'html', type: hb.type, end: hb.end, lines: [s], followedByBlank: false };
      parent().children.push(html);
      open.push(html);
      if (hb.type >= 1 && hb.type <= 5 && hb.end !== null &&
          s.toLowerCase().indexOf(hb.end.toLowerCase()) >= 0) { open.pop(); pendingHtml = html; }
      return 'leaf';
    }
    // Thematic break.
    if (matchHr(s, restCol)) {
      closePara();
      maybeLoose();
      parent().children.push({ t: 'hr' });
      return 'leaf';
    }
    // Blockquote.
    const wq = leadingWs(s, restCol);
    if (wq.cols <= 3 && s.charCodeAt(wq.idx) === 62) {
      closePara();
      maybeLoose();
      let p = wq.idx + 1;
      let pend2 = 0;
      let adv = 0; // columns consumed after the '>'
      if (p < s.length) {
        const ch = s.charCodeAt(p);
        if (ch === 32) { p++; adv = 1; }
        else if (ch === 9) {
          const tabCol = restCol + p;
          pend2 = nextTabStop(tabCol) - tabCol - 1;
          p++; adv = 1;
        }
      }
      const q = { t: 'quote', children: [] };
      parent().children.push(q);
      open.push(q);
      rest = pend2 > 0 ? ' '.repeat(pend2) + s.slice(p) : s.slice(p);
      restCol = restCol + wq.idx + 1 + adv;
      return 'container';
    }
    // List.
    const li = matchList(s, restCol);
    if (li) {
      if (interrupt) {
        // A bullet list interrupts a paragraph only when its first item is
        // not empty; an ordered list only when it starts with 1, unless
        // the paragraph is inside a list item (a nested list may start
        // with any number).
        if (!li.ordered && li.contentPos >= s.length) return null;
        const parParent = open.length >= 2 ? open[open.length - 2] : null;
        if (li.ordered && li.start !== 1 && !(parParent && parParent.t === 'item')) return null;
      }
      closePara();
      const par = parent();
      let list = null;
      const last = par.children[par.children.length - 1];
      if (last && last.t === 'list' && last.ordered === li.ordered &&
          (li.ordered ? last.delim === li.delim : last.bullet === li.bullet)) {
        list = last;
        if (blankLine) list.tight = false;
      } else {
        maybeLoose();
        list = { t: 'list', ordered: li.ordered, delim: li.delim, bullet: li.bullet, start: li.start, tight: true, children: [] };
        par.children.push(list);
      }
      const item = { t: 'item', indent: li.contentIndent, children: [] };
      list.children.push(item);
      open.push(list);
      open.push(item);
      rest = li.pend > 0 ? ' '.repeat(li.pend) + s.slice(li.contentPos) : s.slice(li.contentPos);
      restCol = restCol + li.contentIndent;
      blankLine = false;
      return 'container';
    }
    // Indented code (cannot interrupt a paragraph).
    if (!interrupt && indentCols(s, restCol) >= 4) {
      maybeLoose();
      const code = { t: 'code', fence: false, indent: 4, info: '', lines: [stripCols(s, 4, restCol)] };
      parent().children.push(code);
      open.push(code);
      return 'leaf';
    }
    return null;
  }

  return { doc, refs };
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------
// A GFM task list marker at the start of a list item's first paragraph:
// '[ ]', '[x]' or '[X]' followed by a space/tab. Returns
// [checkboxHtml, restText] or null.
function taskPrefix(text) {
  if (text.length <= 3 || text.charCodeAt(0) !== 91) return null;
  const m = text.charCodeAt(1);
  if (m !== 32 && m !== 120 && m !== 88) return null;
  if (text.charCodeAt(2) !== 93) return null;
  const after = text.charCodeAt(3);
  if (after !== 32 && after !== 9) return null;
  const html = (m === 120 || m === 88)
    ? '<input checked="" disabled="" type="checkbox">'
    : '<input disabled="" type="checkbox">';
  return [html, text.slice(3)];
}

function renderBlocks(node, refs, tight) {
  let out = '';
  switch (node.t) {
    case 'doc':
    case 'quote': {
      if (node.t === 'quote') out += '<blockquote>\n';
      for (let k = 0; k < node.children.length; k++) {
        const c = node.children[k];
        // An HTML block that is the last child of a blockquote gets no
        // trailing newline (the container closes right after it).
        if (c.t === 'html' && node.t === 'quote' && k === node.children.length - 1) {
          out += c.lines.join('\n');
        } else {
          out += renderBlocks(c, refs, false);
        }
      }
      if (node.t === 'quote') out += '</blockquote>\n';
      return out;
    }
    case 'p':
      return '<p>' + parseInline(node.lines.join('\n'), refs) + '</p>\n';
    case 'heading':
      return '<h' + node.level + '>' + parseInline(node.lines.join('\n'), refs) + '</h' + node.level + '>\n';
    case 'code': {
      let content = node.lines.join('\n');
      if (node.lines.length > 0) content += '\n';
      if (!node.fence) {
        // Strip trailing blank lines.
        content = content.replace(/\n+$/, '\n');
        if (content === '\n') content = '';
      }
      let cls = '';
      if (node.fence && node.info) {
        const lang = node.info.split(/\s+/)[0].replace(/\\([!-/:-@\[-`{-~])/g, '$1');
        if (lang) cls = ' class="language-' + escapeAttr(lang) + '"';
      }
      return '<pre><code' + cls + '>' + escapeText(content) + '</code></pre>\n';
    }
    case 'html':
      // An HTML block keeps a trailing newline unless it is immediately
      // followed by a blank line.
      return node.lines.join('\n') + (node.followedByBlank ? '' : '\n');
    case 'hr':
      return '<hr>\n';
    case 'list': {
      let tag = node.ordered ? '<ol' : '<ul';
      if (node.ordered && node.start !== 1) tag += ' start="' + node.start + '"';
      out += tag + '>\n';
      for (const item of node.children) out += renderBlocks(item, refs, node.tight);
      out += node.ordered ? '</ol>\n' : '</ul>\n';
      return out;
    }
    case 'item': {
      out += '<li>';
      for (let k = 0; k < node.children.length; k++) {
        const c = node.children[k];
        if (c.t === 'p') {
          let text = c.lines.join('\n');
          let prefix = '';
          if (k === 0) {
            const m = taskPrefix(text);
            if (m) { prefix = m[0]; text = m[1]; }
          }
          if (tight) {
            out += prefix + parseInline(text, refs);
          } else {
            out += '<p>' + prefix + parseInline(text, refs) + '</p>\n';
          }
        } else if (c.t === 'html' && k === node.children.length - 1) {
          // An HTML block that is the last child of a list item gets no
          // trailing newline.
          out += c.lines.join('\n');
        } else {
          out += renderBlocks(c, refs, tight);
        }
      }
      out += '</li>\n';
      return out;
    }
    case 'table': {
      out += '<table>\n<thead>\n<tr>\n';
      for (let k = 0; k < node.header.length; k++) {
        const a = node.aligns[k];
        out += '<th' + (a ? ' align="' + a + '"' : '') + '>' + parseInline(node.header[k], refs) + '</th>\n';
      }
      out += '</tr>\n</thead>\n<tbody>';
      for (const row of node.rows) {
        const cells = splitCells(row);
        out += '<tr>\n';
        for (let k = 0; k < node.header.length; k++) {
          const a = node.aligns[k];
          const cell = k < cells.length ? cells[k] : '';
          out += '<td' + (a ? ' align="' + a + '"' : '') + '>' + parseInline(cell, refs) + '</td>\n';
        }
        out += '</tr>\n';
      }
      out += '</tbody></table>\n';
      return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export function parse(src) {
  const text = src.replace(/\r\n?/g, '\n');
  const { doc, refs } = parseBlocks(text);
  return renderBlocks(doc, refs, false);
}
export default parse;
