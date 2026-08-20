import type { ProvisionGroup } from "./api";
import { formatDate, isCurrentGroup, primaryPromulgationDate } from "./provisionUtils";

export function ArticleHeader({ group, totalVersions }: { group: ProvisionGroup; totalVersions: number }) {
  return (
    <header className="article-header">
      <div className="article-header-top">
        {isCurrentGroup(group) && <span className="badge-current">현행</span>}
        <h1 className="article-no">{group.article_no}</h1>
      </div>
      {group.article_title && <p className="article-title">{group.article_title}</p>}
      <p className="article-meta">
        최종 개정일 {formatDate(primaryPromulgationDate(group))} · 버전 {totalVersions}개
      </p>
    </header>
  );
}
