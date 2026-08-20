"""provision-viewer-backend — provision_id + path(GitHub 레포 내 파일 경로)로 조문을 조회하는 read-only API.

Postgres(lawdb)를 읽는 대신 genonai/law_data, genonai/admrul_data GitHub 저장소를
"DB"처럼 직접 읽는다. clone은 받지 않고 매 요청 GitHub REST API(커밋 이력) +
raw.githubusercontent.com(특정 커밋 시점 파일 내용)만 호출한다.

실행: uv run uvicorn app.main:app --reload --port 8000
"""
from fastapi import FastAPI, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from . import provisions
from .github_source import ProvisionSourceError, check_reachable

app = FastAPI(title="provision-viewer-backend", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],  # React(Vite) dev
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    await run_in_threadpool(check_reachable)
    return {"ok": True}


@app.get("/api/provisions")
async def get_provision(
    provision_id: str = Query(..., description='예: law:1인창조기업육성에관한법률#JO0001'),
    path: str = Query(..., description="레포 내 파일 경로, 예: 1인 창조기업 육성에 관한 법률/법률/1인 창조기업 육성에 관한 법률.json"),
):
    try:
        result = await run_in_threadpool(provisions.get_provision, provision_id, path)
    except ProvisionSourceError as e:
        raise HTTPException(400, str(e))
    if result is None:
        raise HTTPException(404, f"provision_id를 찾을 수 없습니다: {provision_id} (path: {path})")
    return result
