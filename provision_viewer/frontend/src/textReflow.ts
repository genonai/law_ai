/**
 * 법제처/행정규칙 원문 content는 원본 수집 과정에서 줄바꿈이 사라져
 * "① 사용자가…② 제1항의…" / "Ⅰ. 결산 개요1. 의 의세입세출결산은…" 처럼
 * 계층 구조 마커가 그대로 붙어버린다.
 * 마커 앞에 줄바꿈을 넣고 마커 종류로 들여쓰기 단계를 매겨 다시 계층처럼 보여준다.
 * (원본 데이터를 바꾸는 게 아니라 화면에 보여줄 때만 적용하는 순수 표시 변환.)
 */

const HANGUL_ITEMS = "가나다라마바사아자차카타파하";
/** 항 마커 ①~⑳ (U+2460–U+2473) */
export const CIRCLED_NUMBERS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

export interface ContentLine {
  text: string;
  level: number; // 0=마커 없음/항, 1=로마숫자, 2=숫자, 3=가/나/다, 4=(숫자), 5=(가/나/다)
}

const LEVEL_PATTERNS: [RegExp, number][] = [
  [/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]\./, 1],
  [/^\d{1,2}\./, 2],
  [new RegExp(`^[${HANGUL_ITEMS}]\\.`), 3],
  [/^\(\d{1,2}\)/, 4],
  [new RegExp(`^\\([${HANGUL_ITEMS}]\\)`), 5],
];

export function splitContentIntoLines(content: string): ContentLine[] {
  if (!content) return [];

  const withBreaks = content
    .replace(new RegExp(`([${CIRCLED_NUMBERS}])`, "g"), "\n$1")
    .replace(/([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]\.)/g, "\n$1")
    .replace(/(?<!\d)(\d{1,2}\.)(?=\s)/g, "\n$1")
    .replace(new RegExp(`(?<![가-힣])([${HANGUL_ITEMS}])\\.(?=\\s)`, "g"), "\n$1.")
    .replace(/(\(\d{1,2}\))/g, "\n$1")
    .replace(new RegExp(`(\\([${HANGUL_ITEMS}]\\))`, "g"), "\n$1");

  return withBreaks
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const level = LEVEL_PATTERNS.find(([re]) => re.test(line))?.[1] ?? 0;
      return { text: line, level };
    });
}

export interface Clause {
  /** 항 번호(①…). 조 머리(제목 부분)처럼 항 마커가 없는 블록이면 "" */
  marker: string;
  /** marker를 제외한 본문 */
  text: string;
}

/** 조문 content를 항(①②③) 단위로 나눈다. 항 마커가 없으면 전체가 하나의 블록. */
export function splitIntoClauses(content: string): Clause[] {
  const src = (content ?? "").trim();
  if (!src) return [];

  const re = new RegExp(`[${CIRCLED_NUMBERS}]`, "g");
  const clauses: Clause[] = [];
  let lastIndex = 0;
  let lastMarker = "";
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    const chunk = src.slice(lastIndex, m.index).trim();
    if (chunk || lastMarker) clauses.push({ marker: lastMarker, text: chunk });
    lastMarker = m[0];
    lastIndex = m.index + m[0].length;
  }

  const tail = src.slice(lastIndex).trim();
  if (tail || lastMarker) clauses.push({ marker: lastMarker, text: tail });
  return clauses;
}

/**
 * 문장 단위로 나눈다. 마침표가 한글/닫는괄호 뒤에 오고 공백이나 끝이 따라올 때만 문장
 * 경계로 본다 — "2010.6.4" 나 "제2조5의제4호" 처럼 숫자 뒤 마침표는 문장 끝이 아니다.
 */
export function splitIntoSentences(text: string): string[] {
  const src = (text ?? "").trim();
  if (!src) return [];

  const re = /(?<=[가-힣)\]"”』」])\.(?=\s|$)/g;
  const out: string[] = [];
  let start = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    const end = m.index + 1; // 마침표까지 포함
    const piece = src.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
  }

  const tail = src.slice(start).trim();
  if (tail) out.push(tail);
  return out.length ? out : [src];
}
