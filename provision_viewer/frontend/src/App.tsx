import { useState, type FormEvent } from "react";
import "./App.css";
import { fetchProvision, ProvisionNotFoundError, type ProvisionResponse } from "./api";
import { ArticleHeader } from "./ArticleHeader";
import { RevisionCompare } from "./RevisionCompare";
import { AttachmentsList } from "./AttachmentsList";
import { splitContentIntoLines } from "./textReflow";
import { buildTransitions, isCurrentGroup } from "./provisionUtils";

function App() {
  const [input, setInput] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [provisionId, setProvisionId] = useState<string | null>(null);
  const [data, setData] = useState<ProvisionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(pid: string, path: string) {
    const trimmedPid = pid.trim();
    const trimmedPath = path.trim();
    if (!trimmedPid || !trimmedPath) return;
    setLoading(true);
    setError(null);
    setData(null);
    setProvisionId(trimmedPid);
    try {
      const result = await fetchProvision(trimmedPid, trimmedPath);
      setData(result);
    } catch (e) {
      if (e instanceof ProvisionNotFoundError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "알 수 없는 오류");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    search(input, pathInput);
  }

  const currentGroup = data ? (data.groups.find(isCurrentGroup) ?? data.groups[data.groups.length - 1]) : null;
  const totalVersions = data ? data.groups.reduce((sum, g) => sum + g.versions.length, 0) : 0;
  const transitions = data ? buildTransitions(data.groups) : [];

  return (
    <div className="page">
      <div className="shell">
        <form className="search-form" onSubmit={handleSubmit}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="provision_id — 예: law:1인창조기업육성에관한법률#JO0001"
            spellCheck={false}
          />
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="path — 예: 1인 창조기업 육성에 관한 법률/법률/1인 창조기업 육성에 관한 법률.json"
            spellCheck={false}
          />
          <button type="submit" disabled={loading}>
            {loading ? "조회 중…" : "조회"}
          </button>
        </form>

        {error && <div className="error">{error}</div>}

        {data && currentGroup && (
          <article className="doc-view">
            <p className="doc-meta-line">
              {data.doc.name} · {data.doc.doc_type}
              {!data.doc.is_active && <span className="doc-inactive-flag">폐지/비활성</span>}
            </p>

            <ArticleHeader group={currentGroup} totalVersions={totalVersions} />

            <div className="current-content">
              {splitContentIntoLines(currentGroup.content).map((line, i) => (
                <p className={`content-line level-${line.level}`} key={i}>
                  {line.text}
                </p>
              ))}
            </div>

            <RevisionCompare transitions={transitions} key={`${provisionId}|${data.path}`} />

            <AttachmentsList relations={currentGroup.relations} />
          </article>
        )}
      </div>
    </div>
  );
}

export default App;
