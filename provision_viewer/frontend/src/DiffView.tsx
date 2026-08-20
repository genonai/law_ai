import { Fragment, type ReactNode } from "react";
import { buildClauseRows, type ClauseCell, type ClauseRow, type DiffLine } from "./diffEngine";

type Side = "old" | "new";

function LineView({
  line,
  side,
  prefix,
}: {
  line: DiffLine | null;
  side: Side;
  prefix?: ReactNode;
}) {
  if (!line) return <p className="diff-line diff-line-blank" aria-hidden="true" />;

  const phraseClass = side === "old" ? "diff-phrase-old" : "diff-phrase-new";
  return (
    <p className={`diff-line diff-line-${line.status} level-${line.level}`}>
      {prefix}
      {line.segments.map((seg, i) =>
        seg.changed ? (
          <span className={phraseClass} key={i}>
            {seg.text}
          </span>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        )
      )}
    </p>
  );
}

function badgeFor(kind: ClauseRow["kind"], side: Side): string | null {
  if (kind === "added" && side === "new") return "신설";
  if (kind === "removed" && side === "old") return "삭제";
  return null;
}

function ClauseView({ cell, kind, side }: { cell: ClauseCell | null; kind: ClauseRow["kind"]; side: Side }) {
  const colClass = side === "old" ? "diff-col-old" : "diff-col-new";
  if (!cell) return <div className={`diff-clause diff-clause-empty ${colClass}`} />;

  const badge = badgeFor(kind, side);
  // 항 번호와 신설/삭제 배지는 첫 줄 앞에 붙여서 한 줄을 따로 잡아먹지 않게 한다.
  const prefix =
    cell.marker || badge ? (
      <>
        {cell.marker && <span className="diff-marker">{cell.marker}</span>}
        {badge && <span className={`diff-badge diff-badge-${kind}`}>{badge}</span>}
      </>
    ) : null;

  const firstIdx = cell.lines.findIndex((line) => line !== null);

  return (
    <div className={`diff-clause diff-clause-${kind} ${colClass}`}>
      {firstIdx === -1 && prefix && <p className="diff-line">{prefix}</p>}
      {cell.lines.map((line, i) => (
        <LineView line={line} side={side} prefix={i === firstIdx ? prefix : undefined} key={i} />
      ))}
    </div>
  );
}

function ColHead({ label, meta, side }: { label: string; meta: string; side: Side }) {
  const colClass = side === "old" ? "diff-col-old" : "diff-col-new";
  return (
    <div className={`diff-col-head ${colClass}`}>
      <span className="diff-pane-label">{label}</span>
      <span className="diff-pane-meta">{meta}</span>
    </div>
  );
}

/** 좁은 화면에서는 좌우 정렬을 포기하고 개정 전 전체 → 현행 전체 순서로 쌓는다. */
function StackedPane({ label, meta, rows, side }: { label: string; meta: string; rows: ClauseRow[]; side: Side }) {
  return (
    <div className="diff-stack-pane">
      <div className="diff-col-head">
        <span className="diff-pane-label">{label}</span>
        <span className="diff-pane-meta">{meta}</span>
      </div>
      {rows.map((row, i) => {
        const cell = side === "old" ? row.old : row.new;
        if (!cell) return null;
        return <ClauseView cell={cell} kind={row.kind} side={side} key={i} />;
      })}
    </div>
  );
}

/**
 * 개정 전(왼쪽) / 현행(오른쪽)을 항 단위로 정렬해 나란히 보여준다.
 * 강조는 "변경된 문장 안의 구절" 수준까지만 내려가고, 항이 통째로 신설/삭제된 경우는
 * 항 전체를 하나의 단위로 표시한다.
 */
export function DiffView({
  oldContent,
  newContent,
  oldMeta,
  newMeta,
}: {
  oldContent: string;
  newContent: string;
  oldMeta: string;
  newMeta: string;
}) {
  const rows = buildClauseRows(oldContent, newContent);

  return (
    <div className="diff-view">
      <div className="diff-columns">
        <ColHead label="개정 전" meta={oldMeta} side="old" />
        <ColHead label="현행" meta={newMeta} side="new" />
        <div className="diff-divider" />
        {rows.map((row, i) => (
          <Fragment key={i}>
            <ClauseView cell={row.old} kind={row.kind} side="old" />
            <ClauseView cell={row.new} kind={row.kind} side="new" />
          </Fragment>
        ))}
      </div>

      <div className="diff-stack">
        <StackedPane label="개정 전" meta={oldMeta} rows={rows} side="old" />
        <StackedPane label="현행" meta={newMeta} rows={rows} side="new" />
      </div>
    </div>
  );
}
