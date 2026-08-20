"""provision_id + path(레포 내 파일 경로) → 조문 추출 + 원문(content)이 같은 버전끼리 그룹핑.

버전 이력은 GitHub 커밋 이력(파일 경로 기준)에서 가져온다. 커밋 하나 = 그 시점의
payload 스냅샷이고, README대로 "커밋 날짜 = 시행일"이므로 Postgres document_version을
순회하던 기존 로직을 커밋 목록 순회로 그대로 옮길 수 있다.

content_hash를 신뢰하지 않고 article의 content 문자열을 애플리케이션에서 직접 해시해
비교하는 것도 기존과 동일하다(admrul 수집 경로에서 해당 컬럼이 비어있던 문제였는데,
지금은 애초에 그 컬럼 자체가 없으므로 더 확실히 유효한 이유가 된다).
"""
import hashlib
from typing import Any, Optional

from .github_source import (
    ProvisionSourceError,
    derive_appendix_path,
    derive_relation_path,
    fetch_commit_history,
    fetch_raw_json,
    raw_file_url,
    resolve_repo,
)


def _find_article(payload: dict, provision_id: str) -> Optional[dict]:
    """이 provision_id에 해당하는 조문을 찾는다.

    - body.articles[] 안에서 provision_id가 일치하는 항목을 우선 찾는다
      (전문(#DOC)형 문서는 조문이 1개뿐이고 그 조문의 provision_id가 곧 #DOC다).
    - 다중 조문 문서에서 top-level provision_id(문서 전체 참조)만 있고 해당하는
      개별 조문을 못 찾은 경우에는 문서 메타 기반의 폴백을 돌려준다.
    """
    for article in ((payload.get("body") or {}).get("articles") or []):
        if article.get("provision_id") == provision_id:
            return article
    if payload.get("provision_id") == provision_id:
        return {
            "provision_id": provision_id,
            "article_no": "(문서 전체)",
            "article_title": payload.get("law_name", ""),
            "chapter": "",
            "content": payload.get("revision_reason") or payload.get("amendment_text") or "",
            "relations": [],
            "images": [],
        }
    return None


def _content_hash(content: str) -> str:
    return hashlib.sha256((content or "").encode("utf-8")).hexdigest()


def _version_meta(entry: dict) -> dict:
    return {
        "version_uid": entry["version_uid"],
        "enforcement_date": entry["enforcement_date"],
        "promulgation_date": entry["promulgation_date"],
        "revision_type": entry["revision_type"],
        "is_current": entry["is_current"],
        "is_future": entry["is_future"],
    }


def _find_appendix(appendices: list[dict], kind: Optional[str], no: Optional[str]) -> Optional[dict]:
    """관련조항의 appendix_kind/appendix_no로 payload 최상위 appendices[]에서 실제 항목을 찾는다.

    no 표기가 "1"/"0001"처럼 서로 다를 수 있어 숫자로 정규화해 비교한다.
    """
    def norm(n):
        try:
            return int(n)
        except (TypeError, ValueError):
            return n

    target_no = norm(no)
    for entry in appendices:
        if entry.get("kind") == kind and norm(entry.get("no")) == target_no:
            return entry
    return None


def _with_resolved_relations(
    article: dict, doc_path: str, appendices: list[dict], owner: str, repo: str, sha: str
) -> dict:
    relations = []
    for rel in article.get("relations", []):
        rel_out = dict(rel)
        if rel.get("relation_type") == "appendix_ref":
            appendix = _find_appendix(appendices, rel.get("appendix_kind"), rel.get("appendix_no"))
            if appendix and appendix.get("filename"):
                attachment_path = derive_appendix_path(doc_path, appendix["kind"], appendix["filename"])
                rel_out["download_filename"] = appendix["filename"]
                rel_out["download_url"] = raw_file_url(owner, repo, sha, attachment_path)
        else:
            reference_id = rel.get("reference_id")
            target_law_name = rel.get("target_law_name")
            if reference_id and target_law_name:
                try:
                    rel_out["resolved_path"] = derive_relation_path(reference_id, target_law_name)
                except ProvisionSourceError:
                    rel_out["resolved_path"] = None
        relations.append(rel_out)
    return {**article, "relations": relations}


def get_provision(provision_id: str, path: str) -> Optional[dict[str, Any]]:
    owner, repo = resolve_repo(provision_id)
    commits = fetch_commit_history(owner, repo, path)
    if not commits:
        return None

    doc_prefix = provision_id.split(":", 1)[0]
    doc_meta = None
    entries = []
    for commit in commits:
        sha = commit["sha"]
        try:
            payload = fetch_raw_json(owner, repo, sha, path)
        except ProvisionSourceError:
            continue
        article = _find_article(payload, provision_id)
        if article is None:
            continue
        entries.append({
            "version_uid": sha,
            "enforcement_date": payload.get("enforcement_date"),
            "promulgation_date": payload.get("promulgation_date"),
            "revision_type": payload.get("revision_type"),
            "is_current": payload.get("is_current", False),
            "is_future": payload.get("is_future", False),
            "article": _with_resolved_relations(
                article, path, payload.get("appendices") or [], owner, repo, sha
            ),
            "hash": _content_hash(article.get("content", "")),
            "law_name": payload.get("law_name"),
            "law_type": payload.get("law_type"),
            "mst": payload.get("mst"),
        })

    if not entries:
        return None

    latest = entries[-1]
    doc_meta = {
        "name": latest["law_name"],
        "doc_target": doc_prefix,
        "doc_type": latest["law_type"],
        "doc_domain": doc_prefix,
        "is_active": any(e["is_current"] for e in entries),
        "mst": latest["mst"],
    }

    groups: list[dict] = []
    for entry in entries:
        if groups and groups[-1]["_hash"] == entry["hash"]:
            groups[-1]["versions"].append(_version_meta(entry))
            groups[-1]["last_enforcement_date"] = entry["enforcement_date"]
            continue
        article = entry["article"]
        groups.append({
            "_hash": entry["hash"],
            "content": article.get("content", ""),
            "article_no": article.get("article_no", ""),
            "article_title": article.get("article_title", ""),
            "chapter": article.get("chapter", ""),
            "relations": article.get("relations", []),
            "images": article.get("images", []),
            "first_enforcement_date": entry["enforcement_date"],
            "last_enforcement_date": entry["enforcement_date"],
            "versions": [_version_meta(entry)],
        })

    for group in groups:
        del group["_hash"]

    return {"provision_id": provision_id, "path": path, "doc": doc_meta, "groups": groups}
