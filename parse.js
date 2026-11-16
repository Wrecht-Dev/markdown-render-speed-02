// Fast dependency-free Markdown renderer matching marked 18.1.3 default output.
// Written from the CommonMark 0.31.2 + GFM 0.29 specifications, tuned so the
// emitted HTML matches marked byte for byte (including marked's departures).

const ESCAPABLE = '\\!"#$%&\'()*+,-./:;<=>?@[]^_`{|}~';

// ---------- entity handling ----------
const NAMED_ENTITIES = {
  AElig: 'Æ', AMP: '&', Aacute: 'Á', Acirc: 'Â', Agrave: 'À', Alpha: 'Α',
  Aring: 'Å', Atilde: 'Ã', Auml: 'Ä', Beta: 'Β', Ccedil: 'Ç', Chi: 'Χ',
  Dagger: '‡', Delta: 'Δ', ETH: 'Ð', Eacute: 'É', Ecirc: 'Ê', Egrave: 'È',
  Epsilon: 'Ε', Eta: 'Η', Euml: 'Ë', GT: '>', Gamma: 'Γ', Iacute: 'Í',
  Icirc: 'Î', Igrave: 'Ì', Iota: 'Ι', Iuml: 'Ï', Kappa: 'Κ', LT: '<',
  Lambda: 'Λ', Mu: 'Μ', Ntilde: 'Ñ', Nu: 'Ν', Oacute: 'Ó', Ocirc: 'Ô',
  Ograve: 'Ò', Omega: 'Ω', Omicron: 'Ο', Oslash: 'Ø', Otilde: 'Õ', Ouml: 'Ö',
  Phi: 'Φ', Pi: 'Π', Prime: '″', Psi: 'Ψ', QUOT: '"', Rho: 'Ρ', Sigma: 'Σ',
  THORN: 'Þ', Tau: 'Τ', Theta: 'Θ', Uacute: 'Ú', Ucirc: 'Û', Ugrave: 'Ù',
  Upsilon: 'Υ', Uuml: 'Ü', Xi: 'Ξ', Yacute: 'Ý', Zeta: 'Ζ', aacute: 'á',
  acirc: 'â', acute: '´', aelig: 'æ', agrave: 'à', alefsym: 'ℵ', alpha: 'α',
  amp: '&', and: '∧', ang: '∠', apos: "'", aring: 'å', asymp: '≈',
  atilde: 'ã', auml: 'ä', bdquo: '„', beta: 'β', brvbar: '¦', bull: '•',
  cap: '∩', ccedil: 'ç', cedil: '¸', cent: '¢', chi: 'χ', circ: 'ˆ',
  clubs: '♣', cong: '≅', copy: '©', crarr: '↵', cup: '∪', curren: '¤',
  dagger: '†', darr: '↓', deg: '°', delta: 'δ', diams: '♦', divide: '÷',
  eacute: 'é', ecirc: 'ê', egrave: 'è', empty: '∅', emsp: ' ', ensp: ' ',
  epsilon: 'ε', equiv: '≡', eta: 'η', eth: 'ð', euml: 'ë', euro: '€',
  exists: '∃', fnof: 'ƒ', forall: '∀', frac12: '½', frac14: '¼', frac34: '¾',
  frasl: '⁄', gamma: 'γ', ge: '≥', gt: '>', hearts: '♥', hellip: '…',
  iacute: 'í', icirc: 'î', iexcl: '¡', igrave: 'ì', image: 'ℑ', infin: '∞',
  int: '∫', iota: 'ι', iquest: '¿', isin: '∈', iuml: 'ï', kappa: 'κ',
  lambda: 'λ', lang: '⟨', laquo: '«', larr: '←', lceil: '⌈', ldquo: '“',
  le: '≤', lfloor: '⌊', lowast: '∗', loz: '◊', lrm: '\u200e', lsquo: '‘',
  lsquo_: '‘', lt: '<', macr: '¯', mdash: '—', micro: 'µ', middot: '·',
  minus: '−', mu: 'μ', nabla: '∇', nbsp: ' ', ndash: '–', ne: '≠',
  ni: '∋', not: '¬', notin: '∉', nsub: '⊄', ntilde: 'ñ', nu: 'ν',
  oacute: 'ó', ocirc: 'ô', ograve: 'ò', oline: '‾', omega: 'ω', omicron: 'ο',
  oplus: '⊕', or: '∨', ordf: 'ª', ordm: 'º', oslash: 'ø', otilde: 'õ',
  otimes: '⊗', ouml: 'ö', para: '¶', part: '∂', permil: '‰', perp: '⊥',
  phi: 'φ', pi: 'π', piv: 'ϖ', plusmn: '±', pound: '£', prime: '′',
  prod: '∏', prop: '∝', psi: 'ψ', quot: '"', radic: '√', rang: '⟩',
  raquo: '»', rarr: '→', rceil: '⌉', rdquo: '”', real: 'ℜ', reg: '®',
  rfloor: '⌋', rho: 'ρ', rlm: '\u200f', rsquo: '’', sbquo: '‚', scaron: 'Š',
  sdquo: '„', sect: '§', shy: '­', sigma: 'σ', sigmaf: 'ς', sim: '∼',
  spades: '♠', sub: '⊂', sube: '⊆', sum: '∑', sup: '⊃', sup1: '¹',
  sup2: '²', sup3: '³', supe: '⊇', szlig: 'ß', tau: 'τ', there4: '∴',
  theta: 'θ', thetasym: 'ϑ', thinsp: ' ', thorn: 'þ', tilde: '˜', times: '×',
  trade: '™', uacute: 'ú', uarr: '↑', ucirc: 'û', ugrave: 'ù', uml: '¨',
  upsih: 'ϒ', upsilon: 'υ', uml_: '¨', uuml: 'ü', weierp: '℘', xi: 'ξ',
  yacute: 'ý', yen: '¥', yuml: 'ÿ', zeta: 'ζ', zwj: '\u200d', zwnj: '\u200c',
  Tab: '\t', NewLine: '\n', colon: ':', comma: ',', period: '.', sol: '/',
  excl: '!', quest: '?', semi: ';', lpar: '(', rpar: ')', lsqb: '[',
  rsqb: ']', lcub: '{', rcub: '}', ast: '*', plus: '+', equals: '=',
  dash: '-', num: '#', dollar: '$', percnt: '%', commat: '@', bsol: '\\',
  grave: '`', hat: '^', lowbar: '_', verbar: '|', gt_: '>', lt_: '<',
  fjlig: 'fj', 'DoubleDot': '¨', CounterClockwiseContourIntegral: '∳',
};

function decodeEntityBody(body) {
  // body includes leading & and trailing ; already validated by caller shape
  if (body[1] === '#') {
    let cp;
    if (body[2] === 'x' || body[2] === 'X') {
      const hex = body.slice(3, -1);
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return null;
      cp = parseInt(hex, 16);
    } else {
      const dec = body.slice(2, -1);
      if (!/^[0-9]{1,7}$/.test(dec)) return null;
      cp = parseInt(dec, 10);
    }
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\uFFFD';
    return String.fromCodePoint(cp);
  }
  const name = body.slice(1, -1);
  if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)) return NAMED_ENTITIES[name];
  return null;
}

const ENTITY_RE = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g;

function decodeEntities(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(ENTITY_RE, (m) => {
    const d = decodeEntityBody(m);
    return d === null ? m : d;
  });
}

const ESC_AMP = '\uE000'; // sentinel: a literal & that came from a backslash escape
function escapeHtml(s, encode) {
  // For ordinary text: entity-shaped &...; sequences pass through untouched,
  // other & become &amp;. Quotes and apostrophes are escaped too.
  let out = s.replace(/&(?!(?:[A-Za-z][A-Za-z0-9]*;|#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};))/g, '&amp;');
  out = out.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  out = out.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  if (out.indexOf(ESC_AMP) !== -1) out = out.split(ESC_AMP).join('&amp;');
  return out;
}
function escapeCode(s) {
  // In code, every & is escaped; there is no entity passthrough.
  let out = s.replace(/&/g, '&amp;');
  out = out.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  out = out.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return out;
}
function escapeHref(href) {
  let out;
  try { out = encodeURI(href); } catch { out = href; }
  out = out.replace(/%25/g, '%');
  out = out.replace(/&(?!(?:[A-Za-z][A-Za-z0-9]*|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});)/g, '&amp;').replace(/"/g, '&quot;');
  return out;
}

// ---------- unicode punctuation / whitespace helpers ----------
function isPunct(ch) {
  if (!ch) return false;
  const c = ch.codePointAt(0);
  // ASCII punctuation
  if (c < 128) return ESCAPABLE.includes(ch) || ch === ' ';
  return /[\p{P}\p{S}]/u.test(ch);
}
function isUnicodeWs(ch) {
  if (!ch) return false;
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || /\s/.test(ch);
}

// ---------- line utilities (tab expansion to columns) ----------
// Expand tabs in a line prefix-aware way: returns string with tabs expanded
// relative to a starting column.
function expandTabsPartial(s, startCol) {
  let out = '';
  let col = startCol;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\t') {
      const n = 4 - (col % 4);
      out += ' '.repeat(n);
      col += n;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
}
// Count columns consumed by prefix of s up to char index n (tabs count to next multiple of 4)
function colOf(s, n, startCol) {
  let col = startCol;
  for (let i = 0; i < n; i++) {
    if (s[i] === '\t') col += 4 - (col % 4);
    else col++;
  }
  return col;
}
// Remove up to `cols` columns of indentation from start of s (may split a tab,
// leaving a remainder represented by spaces). Returns {text, removed} or null
// if fewer than cols of indentation present (counting a partial tab as enough).
function removeIndent(s, cols, startCol) {
  // Remove up to `cols` columns of indentation, character by character: a
  // tab that straddles the boundary is partially consumed and leaves its
  // remaining width as spaces; a tab at or beyond the boundary is kept.
  let col = startCol;
  let i = 0;
  let removed = 0;
  while (i < s.length && removed < cols) {
    const ch = s[i];
    if (ch === ' ') { i++; col++; removed++; }
    else if (ch === '\t') {
      const w = 4 - (col % 4);
      if (removed + w <= cols) { i++; col += w; removed += w; }
      else {
        const left = w - (cols - removed);
        return { text: ' '.repeat(left) + s.slice(i + 1), removed: cols };
      }
    } else break;
  }
  if (removed < cols) return null;
  return { text: s.slice(i), removed };
}

function stripCols(s, cols, startCol) {
  // Remove up to `cols` columns of leading indentation: spaces and tabs
  // are consumed while they fit; a tab that straddles the boundary is
  // consumed whole (leaving nothing); a tab at or beyond the boundary is
  // kept.
  let col = startCol;
  let i = 0;
  let removed = 0;
  while (i < s.length && removed < cols) {
    const ch = s[i];
    if (ch === ' ') { i++; col++; removed++; }
    else if (ch === '\t') {
      const w = 4 - (col % 4);
      i++;
      if (removed + w <= cols) { col += w; removed += w; }
      else break;
    } else break;
  }
  return s.slice(i);
}

function removeIndentItem(s, cols, startCol) {
  // List item matching: like removeIndent, except that a tab sitting
  // exactly at the indent boundary is expanded to spaces (its width at
  // that column), as marked's item capture does.
  const r = removeIndent(s, cols, startCol);
  if (r === null) return null;
  if (r.text[0] === '\t') {
    const w = 4 - ((startCol + cols) % 4);
    return { text: ' '.repeat(w) + r.text.slice(1), removed: cols };
  }
  return r;
}
function leadingIndentCols(s, startCol) {
  let col = startCol;
  let i = 0;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
    if (s[i] === '\t') col += 4 - (col % 4); else col++;
    i++;
  }
  return { cols: col - startCol, chars: i };
}
function isBlank(s) { return /^[ \t]*$/.test(s); }

// ---------- HTML block tag data ----------
const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul').split(' '));
const RAW_TAGS_6 = BLOCK_TAGS; // type 6 uses same list
const DISALLOWED_TAGS = new Set(['title', 'textarea', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'script', 'plaintext']);

const TAG_NAME_RE = '[A-Za-z][A-Za-z0-9-]*';
const ATTR_RE = '(?:\\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\\s*=\\s*(?:[^ \\t\\n"\'=<>`]+|\'[^\']*\'|\\"[^\\"]*\\"))?)';
const OPEN_TAG_RE = new RegExp('^<(' + TAG_NAME_RE + ')' + ATTR_RE + '*\\s*/?>');
const CLOSE_TAG_RE = new RegExp('^</(' + TAG_NAME_RE + ')\\s*>');

function matchHtmlTag(s, pos) {
  const rest = s.slice(pos);
  let m = OPEN_TAG_RE.exec(rest);
  if (m) return { raw: m[0], name: m[1].toLowerCase(), closing: false };
  m = CLOSE_TAG_RE.exec(rest);
  if (m) return { raw: m[0], name: m[1].toLowerCase(), closing: true };
  return null;
}

// ---------- link reference definitions ----------
function normalizeLabel(s) {
  // marked compares labels as raw text (no backslash unescaping), folded
  return s.replace(/[ \t\n\r]+/g, ' ').replace(/^ | $/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ');
}

// Parse a link destination starting at index i of string s (s is a single
// logical string, may contain newlines). Returns {href, end} or null.
function parseLinkDest(s, i) {
  if (s[i] === '<') {
    let j = i + 1;
    let out = '';
    while (j < s.length) {
      const c = s[j];
      if (c === '>') return { href: out, end: j + 1 };
      if (c === '\n' || c === '<') return null;
      if (c === '\\' && j + 1 < s.length && ESCAPABLE.includes(s[j + 1])) { out += s[j + 1]; j += 2; continue; }
      out += c; j++;
    }
    return null;
  }
  let depth = 0;
  let out = '';
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') break;
    if (c < ' ') return null;
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.includes(s[j + 1])) { out += s[j + 1]; j += 2; continue; }
    if (c === '(') { depth++; if (depth > 32) return null; }
    else if (c === ')') { if (depth === 0) break; depth--; }
    out += c; j++;
  }
  if (depth !== 0) return null;
  return { href: out, end: j };
}
// Parse optional title at i (after skipping whitespace incl newlines).
// Returns {title, end}, {title:null, end} when no title is present, or null
// when a title-like opener appears without separating whitespace (invalid).
function parseLinkTitle(s, i) {
  let j = i;
  while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++;
  if (j >= s.length) return { title: null, end: j };
  const q = s[j];
  if ((q === '"' || q === "'" || q === '(') && j === i) return null;
  if (q !== '"' && q !== "'" && q !== '(') return { title: null, end: i };
  let out = '';
  if (q === '(') {
    let k = j + 1;
    while (k < s.length) {
      const c = s[k];
      if (c === ')') return { title: out, end: k + 1 };
      if (c === '(' || c === '\n' && s[k + 1] === '\n') return null;
      if (c === '\\' && k + 1 < s.length && ESCAPABLE.includes(s[k + 1])) { out += s[k + 1]; k += 2; continue; }
      out += c; k++;
    }
    return null;
  }
  let k = j + 1;
  while (k < s.length) {
    const c = s[k];
    if (c === q) return { title: out, end: k + 1 };
    if (c === '\\' && k + 1 < s.length && ESCAPABLE.includes(s[k + 1])) { out += s[k + 1]; k += 2; continue; }
    out += c; k++;
  }
  return null;
}

// ---------- block parsing ----------
function newNode(type, extra) {
  return Object.assign({ type, children: [], text: '', lines: null }, extra || {});
}

const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/;
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const QUOTE_RE = /^ {0,3}>[ \t]?/;

function matchListMarker(s) {
  // s: line remainder (tabs not yet expanded, but leading indent <=3 handled by caller via cols)
  let m = /^ {0,3}([-+*])(?=[ \t]|$)/.exec(s);
  if (m) {
    return finishMarker(s, m[0].length, m[1], null, m[0].replace(/^ +/, '').length);
  }
  m = /^ {0,3}(\d{1,9})([.)])(?=[ \t]|$)/.exec(s);
  if (m) {
    return finishMarker(s, m[0].length, m[2], parseInt(m[1], 10), m[0].replace(/^ +/, '').length);
  }
  return null;
}
function finishMarker(s, matchLen, bulletOrDelim, num, markerWidth) {
  // After marker: spaces/tabs to content. Compute content indent in columns
  // relative to line start (including leading spaces already in matchLen? matchLen
  // counts chars; leading spaces are plain spaces so chars == cols here).
  const leadSpaces = matchLen - markerWidth;
  let i = matchLen;
  let spaces = 0;
  let col = matchLen; // column after marker (leading spaces are 1 col each)
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
    if (s[i] === '\t') { const w = 4 - (col % 4); spaces += w; col += w; }
    else { spaces++; col++; }
    i++;
  }
  const restBlank = i >= s.length;
  let contentIndent;
  if (restBlank || spaces > 4) contentIndent = leadSpaces + markerWidth + 1;
  else contentIndent = leadSpaces + markerWidth + spaces;
  let firstRest;
  if (restBlank) firstRest = '';
  else if (spaces > 4) firstRest = ' '.repeat(spaces - 1) + s.slice(i);
  else firstRest = s.slice(i);
  return {
    bullet: num === null ? bulletOrDelim : null,
    delim: num === null ? null : bulletOrDelim,
    num, ordered: num !== null,
    contentIndent, restStart: i, restBlank,
    spacesAfter: spaces, firstRest,
  };
}

// Try to parse a link reference definition at the start of text (which may span
// multiple lines). Returns {label, href, title, end} or null.
function tryParseDef(text) {
  let i = 0;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  if (i > 3 || text[i] !== '[') return null;
  // label: up to ] with no unescaped [ ; may span lines
  let j = i + 1;
  let label = '';
  let closed = false;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\' && j + 1 < text.length && ESCAPABLE.includes(text[j + 1])) { label += text[j] + text[j + 1]; j += 2; continue; }
    if (c === '[') return null;
    if (c === ']') { closed = true; break; }
    label += c; j++;
  }
  if (!closed || label.length > 999) return null;
  if (normalizeLabel(label) === '') return null;
  if (text[j + 1] !== ':') return null;
  let k = j + 2;
  // skip whitespace incl at most one newline
  let nl = 0;
  while (k < text.length && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n' || text[k] === '\r')) {
    if (text[k] === '\n') { nl++; if (nl > 1) return null; }
    k++;
  }
  const dest = parseLinkDest(text, k);
  if (!dest) return null;
  if (dest.href === '' && text[k] !== '<') return null;
  // end of the destination's own line: only blanks may follow the dest there
  let dl = dest.end;
  while (dl < text.length && (text[dl] === ' ' || text[dl] === '\t' || text[dl] === '\r')) dl++;
  const destLineClean = dl >= text.length || text[dl] === '\n';
  const destLineEnd = dl < text.length ? dl + 1 : dl;
  // optional title (may sit on the following line)
  const t = parseLinkTitle(text, dest.end);
  if (t && t.title !== null) {
    let q = t.end;
    while (q < text.length && (text[q] === ' ' || text[q] === '\t' || text[q] === '\r')) q++;
    if (q >= text.length || text[q] === '\n') {
      return { label: normalizeLabel(label), href: dest.href, title: t.title, end: q < text.length ? q + 1 : q };
    }
    // a title not followed by end-of-line is not part of the definition:
    // fall back to a title-less definition ending at the destination line
  }
  if (!destLineClean) return null;
  return { label: normalizeLabel(label), href: dest.href, title: null, end: destLineEnd };
}

function htmlBlockStart(s, interruptPara) {
  // s starts at first non-space char (indent <=3 verified by caller).
  // Returns 0, or a condition number; condition 1 also needs the tag name,
  // which the caller re-derives with htmlBlockTag1.
  if (s[0] !== '<') return 0;
  const m1 = /^<(pre|script|style|textarea)(?=[\s>]|$)/i.exec(s);
  if (m1) return 1;
  if (s.startsWith('<!--')) return 2;
  if (s.startsWith('<?')) return 3;
  if (/^<![A-Za-z]/.test(s)) return 4;
  if (s.startsWith('<![CDATA[')) return 5;
  if (interruptPara) return 0;
  const m6 = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s>]|\/>|$)/.exec(s);
  if (m6 && BLOCK_TAGS.has(m6[1].toLowerCase())) return 6;
  const tag = matchHtmlTag(s, 0);
  if (tag && /^[ \t]*$/.test(s.slice(tag.raw.length))) return 7;
  return 0;
}
function htmlBlockTag1(s) {
  const m = /^<(pre|script|style|textarea)(?=[\s>]|$)/i.exec(s);
  return m ? m[1].toLowerCase() : null;
}
function htmlBlockEnd(node, line) {
  switch (node.cond) {
    case 1: return line.toLowerCase().includes('</' + node.tag1 + '>');
    case 2: return line.includes('-->');
    case 3: return line.includes('?>');
    case 4: return line.includes('>');
    case 5: return line.includes(']]>');
    default: return isBlank(line);
  }
}

function splitTableRow(line) {
  // marked splits rows on every unescaped pipe (no code-span tracking)
  const cells = [];
  let cur = '';
  let i = 0;
  const s = line.trim();
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      // \| becomes a literal pipe in the cell text; other escapes stay for
      // the inline parser
      if (s[i + 1] === '|') { cur += '|'; i += 2; continue; }
      cur += c + s[i + 1]; i += 2; continue;
    }
    if (c === '|') { cells.push(cur); cur = ''; i++; continue; }
    cur += c; i++;
  }
  cells.push(cur);
  // drop empty first/last from leading/trailing pipes
  if (cells.length && cells[0].trim() === '' ) cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}
function tableRowContinues(line) {
  // a table's body rows end at a line that starts another block
  const ind = leadingIndentCols(line, 0);
  if (ind.cols > 3) return true;
  const body = line.slice(ind.chars);
  if (body[0] === '>') return false;
  if (ATX_RE.test(line) || FENCE_RE.test(line) || HR_RE.test(line)) return false;
  if (body[0] === '<' && htmlBlockStart(body, false)) return false;
  if (matchListMarker(line)) return false;
  return true;
}
function parseDelimiterRow(line) {
  if (!line.includes('-')) return null;
  const cells = splitTableRow(line);
  if (!cells.length) return null;
  const aligns = [];
  for (const c of cells) {
    if (!/^:?-+:?$/.test(c)) return null;
    const l = c.startsWith(':'), r = c.endsWith(':');
    aligns.push(l && r ? 'center' : r ? 'right' : l ? 'left' : null);
  }
  return aligns;
}

function parseBlocks(src, refs) {
  const doc = newNode('doc');
  doc.srcEndsNL = src.endsWith('\n');
  const stack = [doc];
  let leaf = null; // open leaf node (para/code/html/table)
  let consecutiveBlanks = 0;

  const top = () => stack[stack.length - 1];

  function stripDefs(text) {
    // extract leading link reference definitions from paragraph text
    let stripped = false;
    for (;;) {
      const d = tryParseDef(text);
      if (!d) break;
      if (!refs.has(d.label) && d.label !== '') refs.set(d.label, { href: d.href, title: d.title });
      text = text.slice(d.end);
      stripped = true;
      if (text.trim() === '') { text = ''; break; }
    }
    return { text: text.replace(/^\n+/, ''), stripped };
  }
  function finalizePara(node) {
    const sd = stripDefs(node.lines.join('\n'));
    node.text = sd.text;
    node.empty = node.text.trim() === '';
  }
  function closeLeaf() {
    if (!leaf) return;
    if (leaf.type === 'para') {
      finalizePara(leaf);
      if (leaf.empty) {
        const parent = leaf.parent;
        parent.children.splice(parent.children.indexOf(leaf), 1);
      }
    }
    if (leaf.type === 'code' && leaf.indented) {
      // trim trailing blank lines
      while (leaf.lines.length && isBlank(leaf.lines[leaf.lines.length - 1])) leaf.lines.pop();
    }
    leaf = null;
  }
  function truncateStack(idx) {
    // close everything from idx onward (stack[idx] removed)
    if (leaf) {
      // if leaf is inside the part being closed, close it
      let p = leaf.parent;
      let inside = false;
      while (p) { if (stack.indexOf(p) >= idx) { inside = true; break; } p = p.parent; }
      if (inside || stack.indexOf(leaf.parent) >= idx - 1) closeLeaf();
    }
    stack.length = idx;
  }
  let blankSinceContent = false;
  let blankRaw = false;
  function addChild(parent, node) {
    node.parent = parent;
    parent.children.push(node);
    if (parent.type === 'item' && parent.children.length > 1) {
      const p = parent.parent;
      if (p && p.type === 'list' && (blankSinceContent || p._sepBlank)) p.loose = true;
    }
    if (node.type !== 'item') {
      blankSinceContent = false;
      blankRaw = false;
      if (parent.type === 'item' && parent.parent && parent.parent.type === 'list') parent.parent._sepBlank = false;
    }
    return node;
  }
  function addLeaf(node) {
    addChild(top(), node);
    leaf = node;
    return node;
  }

  let pendingHtml = null; // html block that ended at its terminator line

  const lines = src.split('\n');
  // A trailing newline produces a final '' element; drop exactly one artifact:
  // lines are logical lines; content after last \n is a real (empty) line only
  // if src doesn't end with \n. split handles: "a\n" -> ['a','']; treat last ''
  // as no line.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  for (let li = 0; li < lines.length; li++) {
    let rest = lines[li];
    let absCol = 0;
    if (pendingHtml) {
      // a terminator-closed html block loses its trailing newline only
      // when a truly empty line follows it
      if (rest === '') pendingHtml.termEnd = false;
      pendingHtml = null;
    }

    // ---- phase 1: match open containers ----
    let idx = 1;
    let matchedAll = true;
    for (; idx < stack.length; idx++) {
      const c = stack[idx];
      if (c.type === 'blockquote') {
        const ind = leadingIndentCols(rest, absCol);
        if (ind.cols <= 3 && rest[ind.chars] === '>') {
          let consumed = ind.chars + 1;
          absCol += ind.cols + 1;
          rest = rest.slice(consumed);
          if (rest[0] === ' ') {
            rest = rest.slice(1); absCol += 1;
            // a tab right after the marker's space is expanded by its
            // width within this marker segment
            if (rest[0] === '\t') {
              const segCol = ind.chars + 2;
              rest = ' '.repeat(4 - (segCol % 4)) + rest.slice(1);
            }
          }
          else if (rest[0] === '\t') {
            const w = 4 - (absCol % 4);
            rest = ' '.repeat(Math.max(0, w - 1)) + rest.slice(1);
            absCol += 1;
          }
        } else { matchedAll = false; break; }
      } else if (c.type === 'item') {
        if (isBlank(rest)) {
          // blank line matches any item
        } else if (c._emptyBlank) {
          // an item that was still empty at a blank line takes no more content
          matchedAll = false; break;
        } else {
          const r = removeIndentItem(rest, c.contentIndent, absCol);
          if (r === null) { matchedAll = false; break; }
          rest = r.text; absCol += c.contentIndent;
        }
      }
      // list and doc consume nothing
    }
    const matchedDepth = idx; // first unmatched index (== stack.length if all)

    if (!matchedAll) {
      // sibling list item? check if stack[matchedDepth-1] chain top after
      // truncation is a list whose next item starts here
      let handled = false;
      // find: truncate to matchedDepth; if top is list, try marker
      // (do tentative check before mutating)
      const candStackTop = stack[matchedDepth - 1];
      if (candStackTop && candStackTop.type === 'list' && leaf && leaf.type === 'para') {
        // handled below in generic flow (para leaf may be interrupted)
      }
      void handled; void candStackTop;
    }

    const blank = isBlank(rest) && matchedAll ? isBlank(rest) : isBlank(lines[li]);

    if (!isBlank(lines[li])) consecutiveBlanks = 0;

    // ---- phase 2: open leaf handling ----
    if (leaf && !matchedAll && leaf.type !== 'para' && !(leaf.type === 'code' && leaf.fenced && !isBlank(lines[li]) && leaf.parent && leaf.parent.type === 'item' && leaf._armed)) {
      // a non-paragraph leaf cannot be a lazy continuation: it ends where
      // its containers end (a fenced block directly inside a list item,
      // though, keeps consuming non-blank lines that leave the item once
      // it has consumed a line inside the item, as marked's item capture
      // does)
      closeLeaf();
      truncateStack(matchedDepth);
    }
    if (leaf) {
      if (leaf.type === 'code' && leaf.fenced) {
        const ind = leadingIndentCols(rest, absCol);
        let cm = /^(`{3,}|~{3,})[ \t]*$/.exec(rest.slice(ind.chars));
        if (!cm && !matchedAll) {
          const ind2 = leadingIndentCols(lines[li], 0);
          if (ind2.cols <= 3) cm = /^(`{3,}|~{3,})[ \t]*$/.exec(lines[li].slice(ind2.chars));
        }
        if (ind.cols <= 3 && cm && cm[1][0] === leaf.fenceChar && cm[1].length >= leaf.fenceLen) {
          // marked's fence capture drops one trailing blank line before
          // the closing fence
          if (leaf.lines.length >= 1 && leaf.lines[leaf.lines.length - 1] === '') leaf.lines.pop();
          closeLeaf();
          continue;
        }
        let content = rest;
        if (leaf.indentCols > 0) {
          // strip up to the fence's indent, measured in columns: a tab
          // that straddles the boundary is consumed whole
          content = stripCols(rest, leaf.indentCols, absCol);
        }
        if (matchedAll) leaf._armed = true;
        leaf.lines.push(content);
        continue;
      }
      if (leaf.type === 'html') {
        if ((leaf.cond === 6 || leaf.cond === 7) && isBlank(rest)) {
          closeLeaf();
          // fall through to blank handling
        } else {
          leaf.lines.push(rest);
          if (htmlBlockEnd(leaf, rest)) { if (leaf.cond <= 5) { leaf.termEnd = true; pendingHtml = leaf; } closeLeaf(); }
          continue;
        }
      } else if (leaf.type === 'code' && leaf.indented) {
        if (isBlank(rest)) {
          const rb = removeIndent(rest, 4, absCol);
          leaf.lines.push(rb ? rb.text : '');
          continue;
        }
        const r = removeIndent(rest, 4, absCol);
        if (r) { leaf.lines.push(r.text); continue; }
        closeLeaf();
        // fall through
      } else if (leaf.type === 'table') {
        // a whitespace-only line containing a tab is still a row (of
        // empty cells) in marked; a spaces-only (or empty) line ends it
        if (rest === '' || (isBlank(rest) && !rest.includes('\t')) || (!isBlank(rest) && !tableRowContinues(rest))) { closeLeaf(); }
        else {
          leaf.rows.push(splitTableRow(rest));
          continue;
        }
      } else if (leaf.type === 'para') {
        if (isBlank(rest)) {
          // marked keeps a whitespace-only line as the paragraph's last
          // line when it arrives through a blockquote marker
          if (matchedAll && rest.length > 0 && stack.some((n) => n.type === 'blockquote')) leaf.lines.push(rest);
          closeLeaf();
          // fall through to blank handling
        } else {
          // if containers were unmatched, decide lazy vs close
          if (!matchedAll) {
            // marked quirk: a lazy setext underline inside a blockquote is
            // kept as paragraph text, indented by four spaces (unless the
            // line is a thematic break, which still interrupts)
            if (SETEXT_RE.test(rest) && !HR_RE.test(rest) && stack.some((n) => n.type === 'blockquote')) {
              leaf.lines.push('    ' + rest.replace(/^[ \t]+/, ''));
              continue;
            }
            // check sibling item / interrupting starts on `rest`
            const sib = trySiblingOrInterrupt(rest, absCol);
            if (!sib) {
              // lazy continuation: a heavily indented lazy line loses
              // four columns; a lightly indented one keeps its spaces
              const li3 = leadingIndentCols(rest, absCol);
              if (li3.cols >= 4) {
                const rr = removeIndent(rest, 4, absCol);
                leaf.lines.push(rr ? rr.text : rest);
              } else {
                leaf.lines.push(rest);
              }
              continue;
            }
            closeLeaf();
            truncateStack(matchedDepth);
            if (sib.sibling) {
              startSiblingItem(sib.marker, rest, absCol);
              rest = lastItemRest.text;
              absCol = lastItemRest.absCol;
              startBlocks();
              continue;
            }
            // generic interrupt: fall through to startBlocks with rest
            startBlocks();
            continue;
          }
          // a link reference definition at the paragraph's start may span
          // lines: a line that completes one, or that is its title line,
          // stays in the paragraph
          if (/^[ \t]{0,3}\[/.test(leaf.lines[0])) {
            const joined = leaf.lines.join('\n');
            const d0 = tryParseDef(joined);
            if (!d0) {
              // the incoming line may complete a definition in progress
              const dFull = tryParseDef(joined + '\n' + rest);
              if (dFull) { leaf.lines.push(rest); continue; }
            } else if (d0.end === joined.length && d0.title === null) {
              // a finished destination line may still gain a title line
              const tt = parseLinkTitle('\n' + rest, 0);
              if (tt && tt.title !== null) { leaf.lines.push(rest); continue; }
            }
          }
          // table conversion?
          const aligns = parseDelimiterRow(rest);
          if (aligns) {
            // definitions at the paragraph's start come off first
            const sd0 = stripDefs(leaf.lines.join('\n'));
            if (sd0.stripped) {
              if (sd0.text.trim() === '') {
                const parent = leaf.parent;
                parent.children.splice(parent.children.indexOf(leaf), 1);
                leaf = null;
                startBlocks();
                continue;
              }
              leaf.lines = sd0.text.split('\n');
            }
            const headerLine = leaf.lines[leaf.lines.length - 1];
            const headerCells = splitTableRow(headerLine);
            if (headerCells.length === aligns.length && headerLine.includes('|')) {
              leaf.lines.pop();
              const keepPara = leaf.lines.length > 0;
              const paraNode = leaf;
              closeLeafParaOnly();
              if (!keepPara && paraNode.parent) {
                const ix = paraNode.parent.children.indexOf(paraNode);
                if (ix >= 0) paraNode.parent.children.splice(ix, 1);
              }
              const tbl = newNode('table', { aligns, header: headerCells, rows: [] });
              addLeaf(tbl);
              continue;
            }
          }
          // setext heading?
          const sm = SETEXT_RE.exec(rest);
          if (sm) {
            // definitions at the paragraph's start come off first; if they
            // were the whole paragraph the underline is just a new line
            const sd1 = stripDefs(leaf.lines.join('\n'));
            if (sd1.stripped && sd1.text.trim() === '') {
              const parent = leaf.parent;
              parent.children.splice(parent.children.indexOf(leaf), 1);
              leaf = null;
              startBlocks();
              continue;
            }
            if (sd1.stripped) leaf.lines = sd1.text.split('\n');
            const lvl = sm[1][0] === '=' ? 1 : 2;
            const para = leaf;
            leaf = null;
            para.type = 'heading';
            para.level = lvl;
            para.text = para.lines.join('\n').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
            para.lines = null;
            continue;
          }
          // interrupting block starts?
          const inter = checkInterrupt(rest, absCol);
          if (inter) {
            closeLeaf();
            startBlocks();
            continue;
          }
          leaf.lines.push(rest);
          continue;
        }
      }
    }

    // ---- blank line bookkeeping ----
    if (isBlank(lines[li]) || (leaf === null && matchedAll && isBlank(rest))) {
      if (isBlank(lines[li])) {
        // a blank line that does not carry the containers' markers closes
        // the containers it failed to match (marked ends a blockquote there)
        if (!matchedAll) truncateStack(matchedDepth);
        consecutiveBlanks++;
        blankSinceContent = true;
        blankRaw = true;
        for (const n of stack) {
          if (n.type === 'item' && !n.children.length) n._emptyBlank = true;
        }
      } else {
        // a line blank only after its container markers (e.g. ">"): it
        // separates blocks for the innermost item it sits in
        const t = stack[stack.length - 1];
        if (t && t.type === 'item' && t.parent && t.parent.type === 'list') t.parent._sepBlank = true;
      }
      continue;
    }

    // truncate unmatched containers (non-lazy path)
    if (!matchedAll) {
      truncateStack(matchedDepth);
    }

    startBlocks();
    continue;

    // ===== helpers used above (hoisted function declarations) =====
    function closeLeafParaOnly() {
      // like closeLeaf but keeps node even if it becomes empty (table split)
      if (!leaf) return;
      if (leaf.type === 'para') finalizePara(leaf);
      leaf = null;
    }
    function listCompatible(list, mk) {
      if (list.ordered !== mk.ordered) return false;
      if (list.ordered) return list.delim === mk.delim;
      return list.bullet === mk.bullet;
    }
    function checkInterrupt(s, col) {
      const ind = leadingIndentCols(s, col);
      const body = s.slice(ind.chars);
      if (ind.cols > 3) return false;
      if (QUOTE_RE.test(s)) return 'quote';
      if (ATX_RE.test(s)) return 'atx';
      if (FENCE_RE.test(s)) {
        const fm = FENCE_RE.exec(s);
        if (!(fm[1][0] === '`' && fm[2].includes('`'))) return 'fence';
      }
      if (HR_RE.test(s)) return 'hr';
      const hb = htmlBlockStart(body, false);
      if (hb >= 1 && hb <= 5) return 'html';
      if (hb === 6 || hb === 7) {
        // marked: a block-tag line interrupts a paragraph, except a closing
        // tag of a raw-text element (</pre> and friends stay inline), and a
        // lone non-block tag (type 7) never interrupts
        if (hb === 6 && !/^<\/(pre|script|style|textarea)(?=[\s>]|$)/i.test(body)) return 'html';
      }
      const mk = matchListMarker(s);
      if (mk) {
        if (mk.restBlank) return false;
        // an ordered list not starting at 1 interrupts a paragraph only
        // inside a list item (marked's list splitting works that way)
        if (mk.ordered && mk.num !== 1 && !stack.some((n) => n.type === 'item')) return false;
        return 'list';
      }
      return false;
    }
    function trySiblingOrInterrupt(s, col) {
      if (HR_RE.test(s)) return { sibling: false };
      // sibling: is there a list at the truncation boundary?
      const sibTop = stack[matchedDepth - 1];
      if (sibTop && sibTop.type === 'list') {
        const mk = matchListMarker(s);
        if (mk && listCompatible(sibTop, mk)) {
          return { sibling: true, marker: mk, restAfter: null, absColAfter: col };
        }
        if (mk) return { sibling: false }; // a different list begins here
      }
      if (checkInterrupt(s, col)) return { sibling: false };
      return null;
    }
    var lastItemRest = { text: '', absCol: 0 };
    function startSiblingItem(mk, s, col) {
      const list = top();
      if ((blankRaw || list._sepBlank) && list.children.length >= 1) list.loose = true;
      const item = newNode('item', { contentIndent: mk.contentIndent });
      addChild(list, item);
      stack.push(item);
      lastItemRest = { text: mk.firstRest, absCol: col + mk.contentIndent };
    }
    function startBlocks() {
      // loop consuming block starts from `rest`
      for (;;) {
        if (isBlank(rest)) return;
        // at list level: a compatible marker starts the next item, a thematic
        // break ends the list, anything else closes the list first
        if (top().type === 'list') {
          const lst = top();
          if (HR_RE.test(rest)) { stack.pop(); continue; }
          const mk = matchListMarker(rest);
          if (mk && listCompatible(lst, mk)) {
            if ((blankRaw || lst._sepBlank) && lst.children.length >= 1) lst.loose = true;
            const item = newNode('item', { contentIndent: mk.contentIndent });
            addChild(lst, item);
            stack.push(item);
            rest = mk.firstRest;
            absCol += mk.contentIndent;
            if (isBlank(rest)) return;
            continue;
          }
          stack.pop();
          continue;
        }
        const ind = leadingIndentCols(rest, absCol);
        const body = rest.slice(ind.chars);
        // blockquote
        if (ind.cols <= 3 && body[0] === '>') {
          const bq = newNode('blockquote');
          addChild(top(), bq);
          stack.push(bq);
          let consumed = ind.chars + 1;
          absCol += ind.cols + 1;
          rest = rest.slice(consumed);
          if (rest[0] === ' ') { rest = rest.slice(1); absCol += 1; }
          else if (rest[0] === '\t') {
            const w = 4 - (absCol % 4);
            rest = ' '.repeat(Math.max(0, w - 1)) + rest.slice(1);
            absCol += 1;
          }
          continue;
        }
        // fenced code
        if (ind.cols <= 3) {
          const fm = FENCE_RE.exec(rest);
          if (fm && !(fm[1][0] === '`' && fm[2].includes('`'))) {
            const info = fm[2].trim();
            const code = newNode('code', {
              fenced: true, fenceChar: fm[1][0], fenceLen: fm[1].length,
              indentCols: ind.cols, info, lines: [],
            });
            addLeaf(code);
            return;
          }
        }
        // ATX heading
        if (ind.cols <= 3) {
          const am = ATX_RE.exec(rest);
          if (am) {
            let content = am[2] || '';
            content = content.replace(/[ \t]+$/, '');
            if (/^#+$/.test(content)) content = '';
            else content = content.replace(/[ \t]+#+$/, '');
            content = content.replace(/^[ \t]+/, '');
            const h = newNode('heading', { level: am[1].length, text: content });
            addChild(top(), h);
            return;
          }
        }
        // thematic break
        if (ind.cols <= 3 && HR_RE.test(rest)) {
          addChild(top(), newNode('hr'));
          return;
        }
        // HTML block
        if (ind.cols <= 3 && body[0] === '<') {
          const cond = htmlBlockStart(body, false);
          if (cond) {
            const h = newNode('html', { cond, lines: [rest] });
            if (cond === 1) h.tag1 = htmlBlockTag1(body);
            addLeaf(h);
            if (cond <= 5 && htmlBlockEnd(h, rest)) { h.termEnd = true; pendingHtml = h; closeLeaf(); }
            return;
          }
        }
        // list
        if (ind.cols <= 3) {
          const mk = matchListMarker(rest);
          if (mk) {
            const list = newNode('list', {
              ordered: mk.ordered, bullet: mk.bullet, delim: mk.delim,
              start: mk.num, loose: false,
            });
            addChild(top(), list);
            stack.push(list);
            const item = newNode('item', { contentIndent: mk.contentIndent });
            addChild(list, item);
            stack.push(item);
            rest = mk.firstRest;
            absCol += mk.contentIndent;
            if (isBlank(rest)) return;
            continue;
          }
        }
        // indented code
        if (ind.cols >= 4) {
          const r = removeIndent(rest, 4, absCol);
          const code = newNode('code', { indented: true, lines: [r ? r.text : ''] });
          addLeaf(code);
          return;
        }
        // paragraph (marked keeps the line's leading spaces in the text)
        const para = newNode('para', { lines: [rest] });
        addLeaf(para);
        return;
      }
    }
  }

  if (leaf && leaf.type === 'html') leaf.eofEnd = doc.srcEndsNL;
  closeLeaf();
  return doc;
}

// ---------- inline parsing ----------
const AUTOLINK_SCHEME_RE = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*)>/;
const AUTOLINK_EMAIL_RE = /^<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)>/;
const HTML_COMMENT_RE = /^<!--(?:>|->|[\s\S]*?-->)/;
const EMAIL_AUTOLINK_RE = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/;

// marked's link label matching never forms a link when the label
// contains a code span whose content itself contains a backtick and
// further label text follows that span
function labelCodeSpanBlocked(s) {
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === '`') {
      let n = 0; while (s[i + n] === '`') n++;
      let j = i + n;
      let close = -1;
      while (j < s.length) {
        if (s[j] === '`') {
          let m = 0; while (s[j + m] === '`') m++;
          if (m === n) { close = j; break; }
          j += m;
        } else j++;
      }
      if (close === -1) return false;
      if (s.slice(i + n, close).includes('`') && /\S/.test(s.slice(close + n))) return true;
      i = close + n; continue;
    }
    i++;
  }
  return false;
}

// marked does not autolink inside link text: when a link or image forms,
// any autolink nodes among its children revert to plain text
function stripAutoLinks(nodes) {
  let changed = false;
  for (const nd of nodes) if (nd.auto || nd.children) { changed = true; break; }
  if (!changed) return nodes;
  const out = [];
  for (const nd of nodes) {
    if (nd.kind === 'link' && nd.auto) {
      out.push({ kind: 'text', text: nd.children.map((ch) => ch.text || '').join('') });
      continue;
    }
    if (nd.children) nd.children = stripAutoLinks(nd.children);
    out.push(nd);
  }
  return out;
}

function renderNodes(nodes) {
  let out = '';
  for (const n of nodes) {
    switch (n.kind) {
      case 'text': out += escapeHtml(n.text, false); break;
      case 'code': out += '<code>' + escapeCode(n.text) + '</code>'; break;
      case 'html': out += n.text; break;
      case 'break': out += '<br>'; break;
      case 'em': out += '<em>' + renderNodes(n.children) + '</em>'; break;
      case 'strong': out += '<strong>' + renderNodes(n.children) + '</strong>'; break;
      case 'del': out += '<del>' + renderNodes(n.children) + '</del>'; break;
      case 'link': {
        out += '<a href="' + escapeHref(n.href) + '"';
        if (n.title !== null && n.title !== undefined) out += ' title="' + escapeHtml(n.title, true) + '"';
        out += '>' + renderNodes(n.children) + '</a>';
        break;
      }
      case 'image': {
        out += '<img src="' + escapeHref(n.href) + '" alt="' + escapeHtml(plainText(n.children), true) + '"';
        if (n.title !== null && n.title !== undefined) out += ' title="' + escapeHtml(n.title, true) + '"';
        out += '>';
        break;
      }
      case 'delim': out += n.char.repeat(n.len); break;
      default: break;
    }
  }
  return out;
}
function plainText(nodes) {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'text' || n.kind === 'code' || n.kind === 'html') out += n.text;
    else if (n.kind === 'break') out += '\n';
    else if (n.kind === 'delim') out += n.char.repeat(n.len);
    else if (n.children) out += plainText(n.children);
  }
  return out;
}

// Find end of a link label starting after '[' at index i (i points just past '[').
// Returns index of matching ']' or -1. Handles escapes and code spans loosely.
function findBracketEnd(s, i) {
  let depth = 1;
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length) { j += 2; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return j; }
    j++;
  }
  return -1;
}

function parseInline(text, refs) {
  const nodes = [];
  const delims = []; // {node, char, len, canOpen, canClose}
  const brackets = []; // {nodeIndex, isImage, inactive, textStartNode}
  let buf = '';
  let i = 0;
  const n = text.length;

  function flushBuf() {
    if (buf) { nodes.push({ kind: 'text', text: buf }); buf = ''; }
  }
  function prevChar() {
    if (buf) return buf[buf.length - 1];
    // look at last node
    for (let k = nodes.length - 1; k >= 0; k--) {
      const nd = nodes[k];
      if (nd.kind === 'text') return nd.text[nd.text.length - 1];
      if (nd.kind === 'delim') return nd.char;
      if (nd.kind === 'code') return '`';
      return 'x'; // other nodes count as normal char
    }
    return '';
  }

  while (i < n) {
    const c = text[i];

    if (c === '\\') {
      const nx = text[i + 1];
      if (nx === '\n') {
        flushBuf(); nodes.push({ kind: 'break' }); i += 2;
        while (text[i] === ' ' || text[i] === '\t') i++; // marked skips indentation after a hard break
        continue;
      }
      if (nx !== undefined && ESCAPABLE.includes(nx)) { buf += nx === '&' ? ESC_AMP : nx; i += 2; continue; }
      buf += '\\'; i++; continue;
    }

    if (c === '\n') {
      // hard break if buf (plus prior text node) ends with 2+ spaces
      let trailing = 0;
      for (let k = buf.length - 1; k >= 0 && buf[k] === ' '; k--) trailing++;
      if (trailing >= 2) {
        buf = buf.slice(0, buf.length - trailing);
        flushBuf();
        nodes.push({ kind: 'break' });
        i++;
        while (text[i] === ' ' || text[i] === '\t') i++; // indentation after a hard break is skipped
        continue;
      }
      buf += '\n'; i++; continue;
    }

    if (c === '`') {
      let run = 0; while (text[i + run] === '`') run++;
      // find matching run
      let j = i + run;
      let found = -1; let foundEnd = -1;
      while (j < n) {
        if (text[j] === '`') {
          let r2 = 0; while (text[j + r2] === '`') r2++;
          if (r2 === run) { found = j; foundEnd = j + r2; break; }
          j += r2;
        } else j++;
      }
      // Inside a link label, marked's label matching decides the fate of
      // a run whose pair lies past the label's closing bracket: only the
      // first in-label-unclosed run is decisive, and only when its pair
      // lies on the rest of the line — then the span really forms and
      // swallows the bracket. Any other crossing run stays literal so
      // the bracket can close the label.
      const top = brackets[brackets.length - 1];
      if (top) {
        let bracketEnd = i + run;
        while (bracketEnd < n && text[bracketEnd] !== ']') {
          if (text[bracketEnd] === '\\') bracketEnd++;
          bracketEnd++;
        }
        if (found === -1 || found > bracketEnd) {
          if (top.spanDone) { buf += '`'.repeat(run); i += run; continue; }
          top.spanDone = true;
          if (found === -1) { buf += '`'.repeat(run); i += run; continue; }
          let lineEnd = bracketEnd;
          while (lineEnd < n && text[lineEnd] !== '\n') lineEnd++;
          if (found > lineEnd) { buf += '`'.repeat(run); i += run; continue; }
        }
      }
      if (found === -1) { buf += '`'.repeat(run); i += run; continue; }
      let content = text.slice(i + run, found).replace(/\n/g, ' ');
      if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && content.trim() !== '') {
        content = content.slice(1, -1);
      }
      flushBuf();
      nodes.push({ kind: 'code', text: content });
      i = foundEnd; continue;
    }

    if (c === '&') {
      // numeric character references are decoded; named references pass
      // through verbatim (marked does not decode them)
      const m = /^&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|[A-Za-z][A-Za-z0-9]*);/.exec(text.slice(i, i + 36));
      if (m) {
        if (m[1] !== undefined || m[2] !== undefined) {
          let cp = m[1] !== undefined ? parseInt(m[1], 10) : parseInt(m[2], 16);
          if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) buf += '\uFFFD';
          else if (cp === 38) buf += ESC_AMP;
          else buf += String.fromCodePoint(cp);
        } else {
          buf += m[0];
        }
        i += m[0].length; continue;
      }
      buf += '&'; i++; continue;
    }

    if (c === '<') {
      const rest = text.slice(i);
      let m = AUTOLINK_SCHEME_RE.exec(rest);
      if (m) {
        flushBuf();
        nodes.push({ kind: 'link', href: m[1], title: null, children: [{ kind: 'text', text: m[1] }] });
        i += m[0].length; continue;
      }
      m = AUTOLINK_EMAIL_RE.exec(rest);
      if (m) {
        flushBuf();
        nodes.push({ kind: 'link', href: 'mailto:' + m[1], title: null, children: [{ kind: 'text', text: m[1] }] });
        i += m[0].length; continue;
      }
      // raw html pieces
      let html = null;
      if (rest.startsWith('<!--')) { const hm = HTML_COMMENT_RE.exec(rest); if (hm) html = hm[0]; }
      else if (rest.startsWith('<?')) { const e = rest.indexOf('?>'); if (e !== -1) html = rest.slice(0, e + 2); }
      else if (rest.startsWith('<![CDATA[')) { const e = rest.indexOf(']]>'); if (e !== -1) html = rest.slice(0, e + 3); }
      else if (/^<![A-Za-z]/.test(rest)) { const e = rest.indexOf('>'); if (e !== -1) html = rest.slice(0, e + 1); }
      else {
        const tag = matchHtmlTag(rest, 0);
        if (tag) html = tag.raw;
      }
      if (html !== null) { flushBuf(); nodes.push({ kind: 'html', text: html }); i += html.length; continue; }
      buf += '<'; i++; continue;
    }

    if (c === '!' && text[i + 1] === '[') {
      flushBuf();
      const nodeIndex = nodes.length;
      nodes.push({ kind: 'text', text: '![' });
      brackets.push({ nodeIndex, isImage: true, inactive: false, srcIndex: i });
      i += 2; continue;
    }

    if (c === '[') {
      flushBuf();
      const nodeIndex = nodes.length;
      nodes.push({ kind: 'text', text: '[' });
      brackets.push({ nodeIndex, isImage: false, inactive: false, srcIndex: i });
      i++; continue;
    }

    if (c === ']') {
      flushBuf();
      // only the nearest bracket opener can match this ']': an inactive
      // opener blocks the ones below it and is discarded
      const bi = brackets.length - 1;
      if (bi === -1) { buf += ']'; i++; continue; }
      const opener = brackets[bi];
      if (opener.inactive) { brackets.pop(); buf += ']'; i++; continue; }
      const link = tryParseLinkAt(text, i, opener, refs, nodes);
      if (link && !labelCodeSpanBlocked(text.slice(opener.srcIndex + (opener.isImage ? 2 : 1), i))) {
        // remove the '[' text node at opener.nodeIndex: nodes after it are children
        const children = stripAutoLinks(nodes.splice(opener.nodeIndex + 1));
        nodes.pop(); // the '[' or '![' text node
        const node = { kind: opener.isImage ? 'image' : 'link', href: link.href, title: link.title, children };
        nodes.push(node);
        brackets.length = bi;
        if (!opener.isImage) {
          for (const b of brackets) if (!b.isImage) b.inactive = true;
        }
        i = link.end;
        continue;
      }
      // not a link: opener is dead
      brackets.splice(bi, 1);
      buf += ']'; i++; continue;
    }

    if (c === '*' || c === '_' || c === '~') {
      let run = 0; while (text[i + run] === c) run++;
      if (c === '~' && run >= 3) { buf += '~'.repeat(run); i += run; continue; }
      const before = i === 0 ? '\n' : text[i - 1];
      const afterCh = i + run < n ? text[i + run] : '\n';
      const leftFlank = !isUnicodeWs(afterCh) && (!isPunct(afterCh) || isUnicodeWs(before) || isPunct(before));
      const rightFlank = !isUnicodeWs(before) && (!isPunct(before) || isUnicodeWs(afterCh) || isPunct(afterCh));
      let canOpen, canClose;
      if (c === '*') { canOpen = leftFlank; canClose = rightFlank; }
      else if (c === '_') {
        canOpen = leftFlank && (!rightFlank || isPunct(before));
        canClose = rightFlank && (!leftFlank || isPunct(afterCh));
      } else { canOpen = leftFlank; canClose = rightFlank; }
      flushBuf();
      const node = { kind: 'delim', char: c, len: run, canOpen, canClose };
      nodes.push(node);
      delims.push({ node, char: c, len: run, canOpen, canClose });
      i += run; continue;
    }

    // extended autolinks: www. / http(s):// / bare emails in plain text
    if ((i === 0 || isUnicodeWs(text[i - 1]) || isPunct(text[i - 1])) && /[A-Za-z0-9]/.test(c)) {
      const rest = text.slice(i);
      if (c === 'w' || c === 'h' || c === 'H') {
        // the scheme is case-insensitive; the www. form is not
        const m = (c === 'w' ? /^www\.[^\s<]+/ : /^https?:\/\/[^\s<]+/i).exec(rest);
        if (m) {
          let url = m[0];
          // inside a pending bracket, an autolink may not swallow the ']'
          if (brackets.length > 0) {
            const cut = url.indexOf(']');
            if (cut !== -1) url = url.slice(0, cut);
          }
          url = trimAutolink(url);
          if (url.length > (rest.startsWith('www.') ? 4 : 8)) {
            flushBuf();
            const href = url.startsWith('www.') ? 'http://' + url : url;
            nodes.push({ kind: 'link', href: href, title: null, auto: true, children: [{ kind: 'text', text: url }] });
            i += url.length; continue;
          }
        }
      }
      // mailto:/xmpp: prefixed addresses link as a whole
      const sm = /^(?:mailto|xmpp):/.exec(rest);
      if (sm) {
        const em2 = EMAIL_AUTOLINK_RE.exec(rest.slice(sm[0].length));
        if (em2) {
          let full = sm[0] + em2[0];
          if (sm[0] === 'xmpp:') {
            const seg = /^\/[^\s/<]+/.exec(rest.slice(full.length));
            if (seg && seg[0].indexOf('/', 1) === -1) full += seg[0];
          }
          const after = text[i + full.length];
          if (after !== '-' && after !== '_') {
            flushBuf();
            nodes.push({ kind: 'link', href: full, title: null, auto: true, children: [{ kind: 'text', text: full }] });
            i += full.length; continue;
          }
        }
      }
      const em = EMAIL_AUTOLINK_RE.exec(rest);
      if (em && text[i + em[0].length] !== '@') {
        const after = text[i + em[0].length];
        if (after !== '-' && after !== '_') {
          flushBuf();
          nodes.push({ kind: 'link', href: 'mailto:' + em[0], title: null, auto: true, children: [{ kind: 'text', text: em[0] }] });
          i += em[0].length; continue;
        }
      }
    }

    buf += c; i++;
  }
  flushBuf();
  processAllEmphasis(nodes);
  return nodes;
}

// Emphasis is matched within each node list separately: delimiters inside a
// link's text cannot pair with delimiters outside it, and vice versa.
function processAllEmphasis(nodes) {
  const delims = [];
  for (const nd of nodes) {
    if (nd.kind === 'delim') delims.push({ node: nd, char: nd.char, canOpen: nd.canOpen, canClose: nd.canClose, olen: nd.len });
  }
  if (delims.length) processEmphasis(nodes, delims, null);
  for (const nd of nodes) {
    if (nd.children) processAllEmphasis(nd.children);
  }
}

function trimAutolink(url) {
  // GFM extended autolink trimming
  for (;;) {
    const before = url;
    while (/[?!.,:*_~]$/.test(url)) {
      // '?' '!' '.' ',' ':' '*' '_' '~' trimmed from end (with rules)
      const last = url[url.length - 1];
      if (last === '?') { url = url.slice(0, -1); continue; }
      break;
    }
    // simpler: apply char-by-char rules below instead
    url = before;
    break;
  }
  let changed = true;
  while (changed && url.length) {
    changed = false;
    const last = url[url.length - 1];
    if ('?!.,:*_~'.includes(last)) { url = url.slice(0, -1); changed = true; continue; }
    if (last === ';') {
      // an entity-shaped tail is excluded from the link wholesale
      const m = /&[A-Za-z0-9]+;$/.exec(url);
      if (m) { url = url.slice(0, url.length - m[0].length); changed = true; continue; }
      url = url.slice(0, -1); changed = true; continue;
    }
    if (last === ')') {
      const opens = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      if (closes > opens) { url = url.slice(0, -1); changed = true; continue; }
    }
    if (last === ']') {
      const opens = (url.match(/\[/g) || []).length;
      const closes = (url.match(/\]/g) || []).length;
      if (closes > opens) { url = url.slice(0, -1); changed = true; continue; }
    }
    if (last === '}') {
      const opens = (url.match(/\{/g) || []).length;
      const closes = (url.match(/\}/g) || []).length;
      if (closes > opens) { url = url.slice(0, -1); changed = true; continue; }
    }
  }
  return url;
}

// At text[i] === ']', opener is the bracket stack entry; nodes holds parsed
// inline content after the '['. Try inline link / full ref / collapsed / shortcut.
function tryParseLinkAt(text, i, opener, refs, nodes) {
  let j = i + 1;
  // inline link
  if (text[j] === '(') {
    let k = j + 1;
    while (k < text.length && /\s/.test(text[k])) k++;
    const dest = parseLinkDest(text, k);
    if (dest) {
      const t = parseLinkTitle(text, dest.end);
      if (t) {
        let e = t.end;
        while (e < text.length && /\s/.test(text[e])) e++;
        if (text[e] === ')') {
          // ensure dest was followed by ws or title or ) (no junk)
          if (t.title !== null || e === dest.end || /\s/.test(text[dest.end] || ' ')) {
            return { href: dest.href, title: t.title, end: e + 1 };
          }
        }
      }
    }
    // inline failed: could still be shortcut reference using bracket text
  }
  // full / collapsed reference
  if (text[j] === '[') {
    const endLbl = findBracketEnd(text, j + 1);
    if (endLbl !== -1) {
      const rawLabel = text.slice(j + 1, endLbl);
      // collapsed form: the label is the bracket's raw source text
      let label = rawLabel;
      if (label === '') {
        label = text.slice(opener.srcIndex + (opener.isImage ? 2 : 1), i);
      }
      const ref = refs.get(normalizeLabel(label));
      if (ref) return { href: ref.href, title: ref.title, end: endLbl + 1 };
      return null; // explicit label that misses: not a shortcut
    }
  }
  // shortcut reference: label is the bracket's raw source text
  const labelText = text.slice(opener.srcIndex + (opener.isImage ? 2 : 1), i);
  const ref = refs.get(normalizeLabel(labelText));
  if (ref) return { href: ref.href, title: ref.title, end: i + 1 };
  return null;
}

function processEmphasis(nodes, delims, stackBottom) {
  // delims: array of entries {node,...} in document order for this node list.
  // We process closers in order.
  let di = 0;
  // Build working list referencing node objects; matching wraps nodes in `nodes`.
  while (di < delims.length) {
    const closer = delims[di];
    if (!closer.node || closer.node.len === 0) { di++; continue; }
    if (!closer.canClose) { di++; continue; }
    // find nearest opener below
    let oi = di - 1;
    let opener = null;
    while (oi >= 0) {
      const cand = delims[oi];
      if (cand.char === closer.char && cand.node.len > 0 && cand.canOpen) {
        // pairs rejected by the span rule stay rejected in later passes
        // over child node lists
        if (closer.node._blk && closer.node._blk.has(cand.node)) { oi--; continue; }
        // odd-match rule
        const bothFlank = (cand.canClose || closer.canOpen);
        if (bothFlank && (cand.node.len + closer.node.len) % 3 === 0 && !(cand.node.len % 3 === 0 && closer.node.len % 3 === 0)) {
          oi--; continue;
        }
        // marked: a single-character match that would partially consume a
        // longer opener run does not form if another pair of the same
        // character already formed between them
        if (cand.olen >= 2 && cand.node.len === cand.olen && !(cand.node.len >= 2 && closer.node.len >= 2)) {
          let formed = false;
          for (let k = oi + 1; k < di; k++) {
            const mid = delims[k];
            if (mid.char === closer.char && mid.node.len < mid.olen) { formed = true; break; }
          }
          if (formed) { oi--; continue; }
        }
        // marked: a single-character pair does not span a matched strong
        // pair whose closing run is intraword (can both open and close)
        if ((closer.char === '*' || closer.char === '_') && !(cand.node.len >= 2 && closer.node.len >= 2)) {
          let blocked = false;
          let partner = false;
          let bothRun = false;
          for (let k = oi + 1; k < di; k++) {
            const mid = delims[k];
            if (mid.char === closer.char && mid.olen >= 2) {
              if (mid.canOpen && mid.canClose) bothRun = true;
              else if (mid.canOpen) partner = true;
            }
          }
          blocked = bothRun && partner;
          if (blocked) {
            (closer.node._blk = closer.node._blk || new Set()).add(cand.node);
            oi--; continue;
          }
        }
        opener = cand; break;
      }
      oi--;
    }
    if (!opener) { di++; continue; }
    const use = opener.node.len >= 2 && closer.node.len >= 2 ? 2 : 1;
    opener.node.len -= use;
    closer.node.len -= use;
    // wrap nodes between opener.node and closer.node in `nodes`
    const a = nodes.indexOf(opener.node);
    const b = nodes.indexOf(closer.node);
    if (a === -1 || b === -1 || b <= a) { di++; continue; }
    const inner = nodes.splice(a + 1, b - a - 1);
    const wrap = { kind: closer.char === '~' ? 'del' : use === 2 ? 'strong' : 'em', children: inner };
    nodes.splice(a + 1, 0, wrap);
    // remove delim entries strictly between opener and closer
    for (let k = di - 1; k > oi; k--) delims.splice(k, 1);
    di = delims.indexOf(closer);
    if (closer.node.len === 0) { di++; }
    // if opener exhausted, loop continues; closer may match earlier opener
    if (opener.node.len === 0 && closer.node.len === 0) continue;
  }
  // leftover delim nodes render as literal text via renderNodes 'delim' case
}

// ---------- block rendering ----------
function renderBlocks(node, refs, out) {
  for (const child of node.children) renderBlock(child, refs, out);
}
function renderInlineText(text, refs) {
  return renderNodes(parseInline(text, refs));
}
function renderBlock(node, refs, out) {
  switch (node.type) {
    case 'para':
      out.push('<p>' + renderInlineText(node.text, refs) + '</p>\n');
      break;
    case 'heading':
      out.push('<h' + node.level + '>' + renderInlineText(node.text, refs) + '</h' + node.level + '>\n');
      break;
    case 'hr':
      out.push('<hr>\n');
      break;
    case 'code': {
      const content = node.lines.length ? node.lines.join('\n') + '\n' : '';
      let cls = '';
      if (node.fenced && node.info) {
        let lang = node.info.split(/\s+/)[0];
        lang = lang.replace(/\\([!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~])/g, '$1');
        if (lang) cls = ' class="language-' + escapeHtml(lang, true) + '"';
      }
      out.push('<pre><code' + cls + '>' + escapeCode(content) + '</code></pre>\n');
      break;
    }
    case 'html':
      out.push(node.lines.join('\n') + ((node.termEnd || node.eofEnd) ? '\n' : ''));
      break;
    case 'blockquote': {
      const inner = [];
      renderBlocks(node, refs, inner);
      out.push('<blockquote>\n' + inner.join('') + '</blockquote>\n');
      break;
    }
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      let open = '<' + tag;
      if (node.ordered && node.start !== null && node.start !== 1) open += ' start="' + node.start + '"';
      open += '>\n';
      const inner = [];
      for (const item of node.children) {
        inner.push(renderItem(item, node, refs));
      }
      out.push(open + inner.join('') + '</' + tag + '>\n');
      break;
    }
    case 'table': {
      let s = '<table>\n<thead>\n<tr>\n';
      node.header.forEach((cell, ix) => {
        const al = node.aligns[ix];
        s += '<th' + (al ? ' align="' + al + '"' : '') + '>' + renderInlineText(cell, refs) + '</th>\n';
      });
      s += '</tr>\n</thead>\n';
      if (node.rows.length) {
        s += '<tbody>';
        for (const row of node.rows) {
          s += '<tr>\n';
          for (let ix = 0; ix < node.header.length; ix++) {
            const al = node.aligns[ix];
            const cell = row[ix] !== undefined ? row[ix] : '';
            s += '<td' + (al ? ' align="' + al + '"' : '') + '>' + renderInlineText(cell, refs) + '</td>\n';
          }
          s += '</tr>\n';
        }
        s += '</tbody>';
      }
      s += '</table>\n';
      out.push(s);
      break;
    }
    default: break;
  }
}
function renderItem(item, list, refs) {
  const parts = [];
  let taskBox = null;
  const kids = item.children;
  // task list checkbox: first paragraph starts with [ ] / [x]
  let firstParaAdjusted = null;
  if (kids.length && kids[0].type === 'para') {
    const m = /^\[([ xX])\](?:[ \t]+|$)/.exec(kids[0].text);
    if (m) {
      taskBox = m[1].toLowerCase() === 'x';
      firstParaAdjusted = kids[0].text.slice(m[0].length);
    }
  }
  kids.forEach((child, ci) => {
    if (!list.loose && child.type === 'para') {
      let t = child.text;
      if (ci === 0 && firstParaAdjusted !== null) t = firstParaAdjusted;
      let html = renderInlineText(t, refs);
      if (ci === 0 && taskBox !== null) {
        html = '<input ' + (taskBox ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ' + html;
      }
      parts.push(html);
    } else {
      if (ci === 0 && taskBox !== null && child.type === 'para') {
        // loose list with task: checkbox goes inside the <p>
        const inner = [];
        const copy = Object.assign({}, child, { text: firstParaAdjusted });
        renderBlock(copy, refs, inner);
        let html = inner.join('');
        html = html.replace('<p>', '<p><input ' + (taskBox ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ');
        parts.push(html);
      } else {
        renderBlock(child, refs, parts);
      }
    }
  });
  if (!kids.length) return '<li></li>\n';
  let body = parts.join('');
  // tight item ending in a paragraph: no newline before </li>; ending in any
  // other block: that block's own trailing newline separates them
  return '<li>' + body + '</li>\n';
}

export function parse(markdown) {
  const src = String(markdown).replace(/\r\n?/g, '\n');
  const refs = new Map();
  const doc = parseBlocks(src, refs);
  const out = [];
  renderBlocks(doc, refs, out);
  return out.join('');
}
export default parse;
