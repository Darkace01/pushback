/** One line of a unified diff patch, with the line numbers review comments are anchored to. */
export interface DiffLine {
  kind: 'hunk' | 'add' | 'del' | 'ctx' | 'meta'
  text: string
  /** Line in the old file (deleted and context lines). */
  oldLine?: number
  /** Line in the new file (added and context lines). */
  newLine?: number
}

/** Parses a file's `patch` from the PR files API (hunks only, no file headers). */
export function parsePatch(patch: string | undefined): DiffLine[] {
  if (!patch) return []
  const out: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  for (const text of patch.split('\n')) {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      out.push({ kind: 'hunk', text })
    } else if (text.startsWith('+')) out.push({ kind: 'add', text, newLine: newLine++ })
    else if (text.startsWith('-')) out.push({ kind: 'del', text, oldLine: oldLine++ })
    // "\ No newline at end of file" belongs to the line above and has no number of its own.
    else if (text.startsWith('\\')) out.push({ kind: 'meta', text })
    else out.push({ kind: 'ctx', text, oldLine: oldLine++, newLine: newLine++ })
  }
  return out
}

/**
 * Where a comment on this line goes: GitHub anchors comments to a line number on one side of the diff.
 * Deleted lines live on the old (LEFT) side; added and unchanged lines on the new (RIGHT) side.
 */
export function anchorOf(line: DiffLine): { line: number; side: 'LEFT' | 'RIGHT' } | null {
  if (line.kind === 'del' && line.oldLine) return { line: line.oldLine, side: 'LEFT' }
  if ((line.kind === 'add' || line.kind === 'ctx') && line.newLine) return { line: line.newLine, side: 'RIGHT' }
  return null
}

/** A ```suggestion block replacing the line, for the reviewer to edit. Only new-side lines can be suggested on. */
export function suggestionFor(line: DiffLine): string | null {
  if (line.kind !== 'add' && line.kind !== 'ctx') return null
  return '```suggestion\n' + line.text.slice(1) + '\n```'
}
