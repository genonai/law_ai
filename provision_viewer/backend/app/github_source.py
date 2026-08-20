"""law_data/admrul_data GitHub 저장소를 read-only "DB"처럼 쓴다.

clone은 받지 않는다 — 매 요청 GitHub REST API(커밋 이력)와
raw.githubusercontent.com(특정 커밋 시점의 파일 내용)만 호출한다.
"""
import os
import time
import urllib.parse
from pathlib import Path
from typing import Any, Optional

import httpx

GITHUB_API = "https://api.github.com"
RAW_HOST = "https://raw.githubusercontent.com"

REPO_LAW = ("genonai", "law_data")
REPO_ADMRUL = ("genonai", "admrul_data")

# provision_id의 "prefix:" 부분(=payload의 doc_target)이 곧 admrul_data 안의
# 최상위 폴더명과 1:1로 대응한다(실측 확인: admrul/school/pi/public).
ADMRUL_FOLDERS = {
    "admrul": "행정규칙",
    "school": "학칙",
    "pi": "공단정관",
    "public": "공공기관",
}


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")


class ProvisionSourceError(Exception):
    """provision_id/path에 대응하는 저장소나 파일을 특정할 수 없을 때."""


def _prefix(provision_id: str) -> str:
    prefix, sep, _ = provision_id.partition(":")
    if not sep:
        raise ProvisionSourceError(f"provision_id 형식이 아닙니다: {provision_id}")
    return prefix


def resolve_repo(provision_id: str) -> tuple[str, str]:
    prefix = _prefix(provision_id)
    if prefix == "law":
        return REPO_LAW
    if prefix in ADMRUL_FOLDERS:
        return REPO_ADMRUL
    raise ProvisionSourceError(f"알 수 없는 provision_id prefix입니다: {prefix}")


def derive_relation_path(reference_id: str, target_law_name: str) -> Optional[str]:
    """관련조항 클릭 이동용 — reference_id/target_law_name만으로 파일 경로를 재구성한다.

    law_data: {법령명}/{법률|시행령|시행규칙}/{법령명}.json
    admrul_data: {문서종}/{문서명}/{문서명}.json
    두 구조 모두 실제 파일명이 곧 target_law_name이므로 캐시나 색인 없이 계산 가능
    (law_data 3,876개 파일 전수 대조로 검증됨).
    """
    if not target_law_name:
        return None
    prefix = _prefix(reference_id)
    name = target_law_name.strip()
    if prefix == "law":
        for suf, tier in ((" 시행규칙", "시행규칙"), (" 시행령", "시행령"),
                          ("시행규칙", "시행규칙"), ("시행령", "시행령")):
            if name.endswith(suf) and len(name) > len(suf):
                family = name[: -len(suf)].rstrip()
                return f"{family}/{tier}/{name}.json"
        return f"{name}/법률/{name}.json"
    folder = ADMRUL_FOLDERS.get(prefix)
    if folder is None:
        return None
    return f"{folder}/{name}/{name}.json"


def derive_appendix_path(doc_path: str, kind: str, filename: str) -> str:
    """별표/별지 등 첨부파일 경로 — 현재 문서(doc_path)와 같은 폴더 밑의
    {kind}/ 서브폴더에 들어있다(law_data/admrul_data 공통 구조).
    """
    folder = doc_path.rsplit("/", 1)[0]
    return f"{folder}/{kind}/{filename}"


def raw_file_url(owner: str, repo: str, ref: str, path: str) -> str:
    quoted = urllib.parse.quote(path)
    return f"{RAW_HOST}/{owner}/{repo}/{ref}/{quoted}"


def _headers() -> dict:
    headers = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


def _get(client: httpx.Client, url: str, **kwargs) -> httpx.Response:
    for attempt in range(3):
        resp = client.get(url, **kwargs)
        if resp.status_code == 403 and "rate limit" in resp.text.lower() and attempt < 2:
            time.sleep(1 + attempt)
            continue
        return resp
    return resp


def fetch_commit_history(owner: str, repo: str, path: str) -> list[dict]:
    """해당 파일 경로의 전체 커밋 이력을 오래된 순으로 반환한다."""
    commits: list[dict] = []
    url = f"{GITHUB_API}/repos/{owner}/{repo}/commits"
    params = {"path": path, "per_page": 100}
    with httpx.Client(timeout=30) as client:
        while url:
            resp = _get(client, url, params=params, headers=_headers())
            if resp.status_code == 404:
                return []
            resp.raise_for_status()
            commits.extend(resp.json())
            url = resp.links.get("next", {}).get("url")
            params = None  # next 링크에 이미 쿼리스트링이 포함되어 있음
    commits.reverse()  # oldest -> newest
    return commits


def fetch_raw_json(owner: str, repo: str, ref: str, path: str) -> dict[str, Any]:
    quoted = urllib.parse.quote(path)
    url = f"{RAW_HOST}/{owner}/{repo}/{ref}/{quoted}"
    with httpx.Client(timeout=30) as client:
        resp = client.get(url)
    if resp.status_code == 404:
        raise ProvisionSourceError(f"파일을 찾을 수 없습니다: {owner}/{repo}@{ref}:{path}")
    resp.raise_for_status()
    return resp.json()


def check_reachable() -> None:
    with httpx.Client(timeout=10) as client:
        resp = client.get(f"{GITHUB_API}/rate_limit", headers=_headers())
    resp.raise_for_status()
