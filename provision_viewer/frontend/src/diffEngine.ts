/**
 * 법령 개정 diff 계산 — 글자 단위가 아니라 "항 → 문장 → 구절" 순서로 비교한다.
 *
 * 주의: jsdiff의 diffWords/diffWordsWithSpace는 한글에 쓸 수 없다. JS 정규식의 `\w`에
 * 한글이 포함되지 않아 모든 한글 음절을 비단어 문자로 취급하고, 결과적으로 글자 단위
 * diff가 되어 조사("의", "으", "로")가 각각 따로 강조되는 문제가 생긴다. 그래서 여기서는
 * 공백 기준 어절 토큰을 만들어 diffArrays로 직접 비교한다.
 */
import { diffArrays } from "diff";
import {
  splitContentIntoLines,
  splitIntoClauses,
  splitIntoSentences,
  type ContentLine,
} from "./textReflow";

export interface Segment {
  text: string;
  changed: boolean;
}

export type LineStatus =
  | "same" // 양쪽 동일
  | "modified" // 일부 구절만 변경 (segments에 changed 구간이 있음)
  | "replaced" // 문장 대부분이 변경 — 구절 강조 대신 문장 전체를 옅게 표시
  | "added" // 이 문장이 신설됨
  | "removed"; // 이 문장이 삭제됨

export interface DiffLine {
  level: number;
  status: LineStatus;
  segments: Segment[];
}

export type ClauseKind = "same" | "modified" | "added" | "removed";

export interface ClauseCell {
  marker: string;
  /** 반대편 셀과 인덱스가 1:1로 대응한다. 대응하는 줄이 없으면 null. */
  lines: (DiffLine | null)[];
}

export interface ClauseRow {
  kind: ClauseKind;
  old: ClauseCell | null;
  new: ClauseCell | null;
}

/** 변경 구간 사이에 낀 "안 바뀐" 구간이 이 길이(공백 제외) 이하면 하나로 이어붙인다.
 * 한글 어절은 보통 3자 이상이라 2로 두면 공백과 "및"/"의" 같은 1~2자 연결어만 흡수된다. */
const MAX_GAP = 2;
/** 문장에서 변경 비중이 이 이상이면 구절 강조를 포기하고 문장 전체를 옅게 표시한다. */
const REPLACED_RATIO = 0.75;
/** 삭제/추가 문장을 "같은 문장의 수정"으로 짝지을 최소 유사도. */
const PAIR_SIMILARITY = 0.3;

/** 공백을 유지한 어절 토큰 — 이어붙이면 원문이 그대로 복원된다. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t !== "");
}

function visibleLength(text: string): number {
  return text.replace(/\s+/g, "").length;
}

/** 같은 changed 플래그가 연속된 구간을 하나로 합친다. */
function coalesce(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.changed === seg.changed) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

/** 강조 구간의 앞뒤 공백은 강조에서 빼내 배경이 단어에서 깔끔하게 끝나도록 한다. */
function trimHighlightEdges(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    if (!seg.changed) {
      out.push({ ...seg });
      continue;
    }
    const lead = /^\s+/.exec(seg.text)?.[0] ?? "";
    const trail = /\s+$/.exec(seg.text)?.[0] ?? "";
    const core = seg.text.slice(lead.length, seg.text.length - trail.length);
    if (lead) out.push({ text: lead, changed: false });
    if (core) out.push({ text: core, changed: true });
    if (trail) out.push({ text: trail, changed: false });
  }
  return coalesce(out);
}

/** 변경 구간 사이의 짧은 미변경 구간을 흡수해서 조각난 강조를 하나의 구절로 만든다. */
function absorbShortGaps(segments: Segment[]): Segment[] {
  let runs = coalesce(segments);
  for (;;) {
    const idx = runs.findIndex(
      (run, i) =>
        i > 0 &&
        i < runs.length - 1 &&
        !run.changed &&
        runs[i - 1].changed &&
        runs[i + 1].changed &&
        visibleLength(run.text) <= MAX_GAP
    );
    if (idx === -1) return runs;
    runs[idx].changed = true;
    runs = coalesce(runs);
  }
}

/** 어절 단위로 비교해서 한쪽 문장의 구절 강조 정보를 만든다. */
function diffPhrases(oldText: string, newText: string): { old: DiffLine["segments"]; new: DiffLine["segments"] } {
  const changes = diffArrays(tokenize(oldText), tokenize(newText));
  const oldSegs: Segment[] = [];
  const newSegs: Segment[] = [];

  for (const change of changes) {
    const text = change.value.join("");
    if (change.added) newSegs.push({ text, changed: true });
    else if (change.removed) oldSegs.push({ text, changed: true });
    else {
      oldSegs.push({ text, changed: false });
      newSegs.push({ text, changed: false });
    }
  }

  return {
    old: trimHighlightEdges(absorbShortGaps(oldSegs)),
    new: trimHighlightEdges(absorbShortGaps(newSegs)),
  };
}

function toLine(level: number, segments: Segment[]): DiffLine {
  const total = segments.reduce((n, s) => n + visibleLength(s.text), 0);
  const changed = segments.reduce((n, s) => (s.changed ? n + visibleLength(s.text) : n), 0);

  if (total > 0 && changed / total >= REPLACED_RATIO) {
    return { level, status: "replaced", segments: [{ text: segments.map((s) => s.text).join(""), changed: false }] };
  }
  if (changed === 0) {
    return { level, status: "same", segments };
  }
  return { level, status: "modified", segments };
}

function plainLine(level: number, text: string, status: LineStatus): DiffLine {
  return { level, status, segments: [{ text, changed: false }] };
}

function bigrams(text: string): string[] {
  const s = text.replace(/\s+/g, "");
  if (s.length < 2) return s ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** 두 문장을 "같은 문장의 수정"으로 볼지 판단한다.
 * 한글은 조사 하나만 달라도 어절이 통째로 달라지므로 어절 겹침이 아니라
 * 글자 bigram 겹침(Dice 계수)으로 본다. */
function similarity(a: string, b: string): number {
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (!aGrams.length || !bGrams.length) return 0;

  const pool = new Map<string, number>();
  for (const g of aGrams) pool.set(g, (pool.get(g) ?? 0) + 1);

  let hits = 0;
  for (const g of bGrams) {
    const left = pool.get(g) ?? 0;
    if (left > 0) {
      hits++;
      pool.set(g, left - 1);
    }
  }
  return (2 * hits) / (aGrams.length + bGrams.length);
}

interface Pair<T> {
  old: T | null;
  new: T | null;
  changed: boolean;
}

/** diffArrays 결과를 좌우 1:1 대응 목록으로 펼친다. */
function align<T extends { text: string }>(oldItems: T[], newItems: T[]): Pair<T>[] {
  const changes = diffArrays(
    oldItems.map((i) => i.text),
    newItems.map((i) => i.text)
  );
  const pairs: Pair<T>[] = [];
  let oi = 0;
  let ni = 0;
  let k = 0;

  while (k < changes.length) {
    const change = changes[k];
    const count = change.count ?? change.value.length;

    if (!change.added && !change.removed) {
      for (let j = 0; j < count; j++) pairs.push({ old: oldItems[oi++], new: newItems[ni++], changed: false });
      k++;
      continue;
    }

    let removed = 0;
    let added = 0;
    if (change.removed) {
      removed = count;
      k++;
    }
    if (k < changes.length && changes[k].added) {
      added = changes[k].count ?? changes[k].value.length;
      k++;
    }

    // 짝지을 수 있는 만큼은 "수정"으로 묶고, 남는 건 순수 삭제/추가로 둔다.
    const paired = Math.min(removed, added);
    for (let j = 0; j < paired; j++) pairs.push({ old: oldItems[oi + j], new: newItems[ni + j], changed: true });
    for (let j = paired; j < removed; j++) pairs.push({ old: oldItems[oi + j], new: null, changed: true });
    for (let j = paired; j < added; j++) pairs.push({ old: null, new: newItems[ni + j], changed: true });

    oi += removed;
    ni += added;
  }

  return pairs;
}

/** 항 본문을 비교 단위(구조 줄 → 문장)로 쪼갠다. */
function toUnits(text: string): ContentLine[] {
  const units: ContentLine[] = [];
  for (const line of splitContentIntoLines(text)) {
    for (const sentence of splitIntoSentences(line.text)) {
      units.push({ text: sentence, level: line.level });
    }
  }
  return units;
}

/** 양쪽에 다 있는 항 내부를 문장 단위로 정렬하고, 변경된 문장만 구절 단위로 비교한다. */
function buildClauseLines(oldText: string, newText: string): { old: (DiffLine | null)[]; new: (DiffLine | null)[] } {
  const pairs = align(toUnits(oldText), toUnits(newText));
  const oldLines: (DiffLine | null)[] = [];
  const newLines: (DiffLine | null)[] = [];

  const push = (o: DiffLine | null, n: DiffLine | null) => {
    oldLines.push(o);
    newLines.push(n);
  };

  for (const pair of pairs) {
    if (pair.old && pair.new) {
      if (!pair.changed) {
        push(plainLine(pair.old.level, pair.old.text, "same"), plainLine(pair.new.level, pair.new.text, "same"));
        continue;
      }
      // 서로 너무 다른 문장은 억지로 짝짓지 않고 삭제 + 신설로 분리한다.
      if (similarity(pair.old.text, pair.new.text) < PAIR_SIMILARITY) {
        push(plainLine(pair.old.level, pair.old.text, "removed"), null);
        push(null, plainLine(pair.new.level, pair.new.text, "added"));
        continue;
      }
      const phrases = diffPhrases(pair.old.text, pair.new.text);
      push(toLine(pair.old.level, phrases.old), toLine(pair.new.level, phrases.new));
      continue;
    }
    if (pair.old) push(plainLine(pair.old.level, pair.old.text, "removed"), null);
    else if (pair.new) push(null, plainLine(pair.new.level, pair.new.text, "added"));
  }

  return { old: oldLines, new: newLines };
}

/** 항 전체가 신설/삭제된 경우 — 항을 하나의 의미 단위로 보고 강조는 항 배경으로만 준다. */
function buildWholeClauseLines(text: string, status: LineStatus): (DiffLine | null)[] {
  return toUnits(text).map((unit) => plainLine(unit.level, unit.text, status));
}

/** 개정 전/후 조문 content를 항 단위로 정렬한 비교 행 목록으로 만든다. */
export function buildClauseRows(oldContent: string, newContent: string): ClauseRow[] {
  const oldClauses = splitIntoClauses(oldContent);
  const newClauses = splitIntoClauses(newContent);

  // 항 번호를 기준으로 정렬한다. 같은 조 안에서 항 마커는 유일하므로 마커 수열만 비교하면 된다.
  const pairs = align(
    oldClauses.map((c) => ({ ...c, text: c.marker })),
    newClauses.map((c) => ({ ...c, text: c.marker }))
  );

  const rows: ClauseRow[] = [];
  let oi = 0;
  let ni = 0;

  for (const pair of pairs) {
    const oldClause = pair.old ? oldClauses[oi++] : null;
    const newClause = pair.new ? newClauses[ni++] : null;

    if (oldClause && newClause) {
      if (oldClause.text === newClause.text) {
        const lines = toUnits(oldClause.text).map((u) => plainLine(u.level, u.text, "same"));
        rows.push({
          kind: "same",
          old: { marker: oldClause.marker, lines },
          new: { marker: newClause.marker, lines },
        });
        continue;
      }
      const built = buildClauseLines(oldClause.text, newClause.text);
      rows.push({
        kind: "modified",
        old: { marker: oldClause.marker, lines: built.old },
        new: { marker: newClause.marker, lines: built.new },
      });
      continue;
    }

    if (oldClause) {
      rows.push({
        kind: "removed",
        old: { marker: oldClause.marker, lines: buildWholeClauseLines(oldClause.text, "removed") },
        new: null,
      });
      continue;
    }
    if (newClause) {
      rows.push({
        kind: "added",
        old: null,
        new: { marker: newClause.marker, lines: buildWholeClauseLines(newClause.text, "added") },
      });
    }
  }

  return rows;
}
