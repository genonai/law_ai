import { useState } from "react";
import { DiffView } from "./DiffView";
import { formatDate, type Transition } from "./provisionUtils";

/** 개정 비교 섹션 — 접지 않고 항상 펼쳐진 상태로, 인접한 버전 쌍 사이를 화살표로 넘겨본다. */
export function RevisionCompare({ transitions }: { transitions: Transition[] }) {
  const [index, setIndex] = useState(transitions.length - 1);

  return (
    <section className="revision-section">
      <div className="revision-head">
        <h2 className="section-title">개정 내용 비교</h2>
        {transitions.length > 0 && (
          <div className="revision-nav">
            <button
              type="button"
              className="revision-nav-btn"
              onClick={() => setIndex((i) => i - 1)}
              disabled={index <= 0}
              aria-label="이전 개정 보기"
            >
              ‹
            </button>
            <span className="revision-range">
              {formatDate(transitions[index].prevDate)} → {formatDate(transitions[index].newDate)}
              {transitions[index].revisionType ? ` · ${transitions[index].revisionType}` : ""}
            </span>
            <button
              type="button"
              className="revision-nav-btn"
              onClick={() => setIndex((i) => i + 1)}
              disabled={index >= transitions.length - 1}
              aria-label="다음 개정 보기"
            >
              ›
            </button>
          </div>
        )}
      </div>

      {transitions.length === 0 ? (
        <p className="revision-empty">최초 제정 이후 개정 이력이 없습니다.</p>
      ) : (
        <DiffView
          oldContent={transitions[index].prevContent}
          newContent={transitions[index].newContent}
          oldMeta={formatDate(transitions[index].prevDate)}
          newMeta={
            transitions[index].revisionType
              ? `${formatDate(transitions[index].newDate)} · ${transitions[index].revisionType}`
              : formatDate(transitions[index].newDate)
          }
        />
      )}
    </section>
  );
}
