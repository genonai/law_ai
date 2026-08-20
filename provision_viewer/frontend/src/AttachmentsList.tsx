import type { Relation } from "./api";
import { isAttachment } from "./provisionUtils";

export function AttachmentsList({ relations }: { relations: Relation[] }) {
  const attachments = relations.filter(isAttachment);
  if (attachments.length === 0) return null;

  return (
    <section className="attachments-section">
      <h2 className="section-title">첨부파일</h2>
      <ul className="attachments-list">
        {attachments.map((rel, i) => (
          <li className="attachments-row" key={i}>
            <span className="rel-type">{rel.appendix_kind}</span>
            <span className="attachments-name">
              {rel.target_article_title || rel.download_filename}
              {rel.target_article_no ? ` ${rel.target_article_no}` : ""}
            </span>
            <a className="rel-download" href={rel.download_url} download={rel.download_filename}>
              다운로드 ↓
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
