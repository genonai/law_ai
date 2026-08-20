import type { ProvisionGroup, Relation } from "./api";

export function formatDate(d: string | null): string {
  if (!d || d.length !== 8) return d ?? "-";
  if (d.startsWith("9999")) return "미상"; // 법제처 API가 옛 이력에 넣는 플레이스홀더(현행 아님을 뜻하지 않음)
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}

const RELATION_TYPE_LABELS: Record<string, string> = {
  citation: "인용",
  delegation: "위임",
  appendix_ref: "별표 참조",
  internal_ref: "자기참조",
};

export function relationTypeLabel(type: string): string {
  return RELATION_TYPE_LABELS[type] ?? type;
}

export function isAttachment(rel: Relation): boolean {
  return rel.relation_type === "appendix_ref" && !!rel.download_url;
}

export function isCurrentGroup(group: ProvisionGroup): boolean {
  return group.versions.some((v) => v.is_current);
}

export function primaryPromulgationDate(group: ProvisionGroup): string | null {
  // versions는 promulgation_date 오름차순으로 온다 — 그룹의 첫 버전 기준 표시.
  return group.versions[0]?.promulgation_date ?? null;
}

export interface Transition {
  prevContent: string;
  prevDate: string | null;
  newContent: string;
  newDate: string | null;
  revisionType: string | null;
}

/** groups(시간순, 오래된 것부터)에서 인접한 두 버전씩 짝지어 "개정 하나"의 전/후 비교 단위를 만든다. */
export function buildTransitions(groups: ProvisionGroup[]): Transition[] {
  const transitions: Transition[] = [];
  for (let i = 1; i < groups.length; i++) {
    const prev = groups[i - 1];
    const cur = groups[i];
    transitions.push({
      prevContent: prev.content,
      prevDate: primaryPromulgationDate(prev),
      newContent: cur.content,
      newDate: primaryPromulgationDate(cur),
      revisionType: cur.versions[0]?.revision_type ?? null,
    });
  }
  return transitions;
}
