// Just enough YAML highlighting for workflow files: keys, strings, `${{ }}` expressions, comments and scalars.
// Line by line, no real parser, so it never fails on odd input; worst case a token is shown as plain text.

export type TokenKind = 'key' | 'string' | 'expr' | 'comment' | 'literal' | 'punct' | 'plain'
export interface Token {
  text: string
  kind: TokenKind
}

/** Where a `#` comment starts (outside quotes, at the start or after whitespace), or -1. */
function commentStart(line: string): number {
  let quote = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"') i++
    } else if (c === '"' || c === "'") quote = c
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return i
  }
  return -1
}

const LITERAL = /^(true|false|null|~|yes|no|on|off|-?\d+(\.\d+)?)$/i
const VALUE = /(\$\{\{[\s\S]*?\}\})|("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')/g

function value(text: string, out: Token[]): void {
  if (!text) return
  const trimmed = text.trim()
  if (LITERAL.test(trimmed) || trimmed === '|' || trimmed === '>' || /^[|>][-+]?$/.test(trimmed)) {
    const lead = text.length - text.trimStart().length
    if (lead) out.push({ text: text.slice(0, lead), kind: 'plain' })
    out.push({ text: text.slice(lead, lead + trimmed.length), kind: /^[|>]/.test(trimmed) ? 'punct' : 'literal' })
    if (lead + trimmed.length < text.length) out.push({ text: text.slice(lead + trimmed.length), kind: 'plain' })
    return
  }
  let last = 0
  for (const m of text.matchAll(VALUE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), kind: 'plain' })
    if (m[1]) out.push({ text: m[0], kind: 'expr' })
    // Expressions inside a quoted string are still expressions.
    else for (const part of m[0].split(/(\$\{\{[\s\S]*?\}\})/)) if (part) out.push({ text: part, kind: part.startsWith('${{') ? 'expr' : 'string' })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'plain' })
}

const KEY = /^(\s*)(-\s+)?((?:"[^"]*"|'[^']*'|[^\s#'"{[][^:#]*?))(:)(?=\s|$)/

export function highlightLine(line: string): Token[] {
  const out: Token[] = []
  const hash = commentStart(line)
  const code = hash < 0 ? line : line.slice(0, hash)
  const k = code.match(KEY)
  if (k) {
    if (k[1]) out.push({ text: k[1], kind: 'plain' })
    if (k[2]) out.push({ text: k[2], kind: 'punct' })
    out.push({ text: k[3], kind: 'key' }, { text: k[4], kind: 'punct' })
    value(code.slice(k[0].length), out)
  } else {
    const dash = code.match(/^(\s*)(-)(\s|$)/)
    if (dash) {
      if (dash[1]) out.push({ text: dash[1], kind: 'plain' })
      out.push({ text: '-', kind: 'punct' })
      value(code.slice(dash[1].length + 1), out)
    } else value(code, out)
  }
  if (hash >= 0) out.push({ text: line.slice(hash), kind: 'comment' })
  return out
}
