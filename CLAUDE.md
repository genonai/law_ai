# CLAUDE.md — law_ai (수집 → 산출 → 임베딩 → RAG) 상위 지침

> 이 저장소는 **여러 독립 하위 repo** 로 이뤄진다: 수집기(`temporal_law`) → 산출물(`data/`) → 임베딩기(`law_embedding`) → RAG 에이전트(`law_agent`) + 이력 툴(`git_history`).
> 각 하위 프로젝트에 자체 문서가 있으니 그걸 우선한다.
> - 수집기 상세: [`temporal_law/CLAUDE.md`](temporal_law/CLAUDE.md) → `temporal_law/README.md` → `temporal_law/docs/`
> - 수집 데이터 흐름: [`temporal_law/flow.md`](temporal_law/flow.md)
> - 임베딩기 상세: [`law_embedding/README.md`](law_embedding/README.md)
> - RAG 에이전트 상세: [`law_agent/README.md`](law_agent/README.md) · 이력 툴: [`git_history/README.md`](git_history/README.md)

## 0. 사용자 지침 (무조건 먼저 지켜라)

- **혼자 일반화/스코프 확장 금지.** 애매하거나 범위를 넓히는 결정(스키마 변경, 대량 재적재, "이 데이터는 항상 이렇다" 단정)은 **표본 1개로 단정하지 말고 먼저 물어봐라.** (수집기 쪽에서 과거 여러 번 표본 하나로 틀림.)
- **커밋에 Claude/AI 이름·트레일러 넣지 마라.** (`Co-Authored-By` 등 금지)
- **OC 인증키 `genosAPItestKey` 절대 커밋 금지** (수집기 쪽). 문서/샘플엔 `test` 로 마스킹.
- **코드 바꾸면 워커 재시작** (Temporal 은 워커가 가진 코드로 실행 — 수집기).
- **`law_embedding` 은 사용자가 직접 짜지 않은 코드다. 아직 정리·수정이 필요하다** (§4 알려진 격차). 손대기 전에 무엇을 바꿀지 확인.

## 1. 전체 구조 / 데이터 흐름

```
law.go.kr OpenAPI
      │  (temporal_law: 수집·파싱·payload 생성)
      ▼
Postgres lawdb  ─┐
                 ├─ (git export)
      ▼          ▼
data/            data/               ← 수집기가 매일 커밋·push 하는 "미러"
  law_data/        {법령명}/{법률|시행령|시행규칙}/{문서명}.json + .md + 별지/*.hwp …
  admrul_data/     {문서종}/{문서명}/{문서명}.json + .md + 별표/별지/첨부파일/…
      │
      │  (law_embedding: data 의 JSON 을 조문/부칙/별표 단위로 임베딩)
      ▼
Weaviate (로컬)  ← RAG 검색용 벡터 DB (컬렉션 LegalProvisionIndex)
      │
      │  (law_agent: 질문 → 검색 → 필요시 git_history 툴 → LLM 답변)
      ▼
답변 + 근거 조문 (+ 개정 이력)
      ▲
      │  git_history 툴이 data/ 의 git 이력·diff 를 읽음(연혁 질문일 때)
```

- **경계가 명확하다.** 수집기는 `data/` 에 **쓰기**, 임베딩기·RAG 는 `data/`·Weaviate 를 **읽기 전용**으로만 소비한다. `data/` 는 손으로 편집하지 않는다(수집기가 덮어씀).
- **첨부파일(hwp/pdf/hwpx) 은 임베딩기가 파싱하지 않는다.** 별도 **전처리 API** 로 텍스트 청크를 뽑은 뒤, 그 결과 JSON 을 `index-attachment-chunks` 로 따로 적재한다(§3-B).
- **각 조각은 독립 git repo** 다: `temporal_law`, `law_embedding`(origin sehunpark-genon), `law_agent`(origin sehunpark-genon/law_RAG — repo명 개명 예정), `git_history`(origin sehunpark-genon), `data/law_data`·`data/admrul_data`(genonai). 루트 `law_ai` 는 git 아님.

## 2. `temporal_law` — 수집기 (요약)

법제처 OpenAPI 로 현행 시행 법령(법률/시행령/시행규칙) + 행정규칙류(고시/훈령/학칙/공단정관/공공기관) 본문·하이퍼링크·별표를 뽑아 Postgres 에 적재하고, 매일 바뀐 것만 갱신하며 `data/` 로 git-export 한다.

- 자동화: Temporal (discover → backfill → sync), 워커 상주. Temporal UI = http://localhost:8080
- 인프라: `temporal_law/docker-compose.yml` (temporal / temporal-ui / lawdb:5544)
- **추적=법(law_id) 단위, 저장=버전 단위.** 변경감지 = 전체 버전 `(MST,시행일)` 집합 해시.
- 자세한 도메인 지식(인용 파싱·별표·target 구분 등)은 반드시 [`temporal_law/CLAUDE.md`](temporal_law/CLAUDE.md) 를 읽어라. 여기 요약만 보고 판단하지 말 것.

## 3. `law_embedding` (`law_indexer`) — 임베딩기

수집기 산출 JSON 을 읽어 **조문(ARTICLE)/부칙(ADDENDUM)/별표·별지(APPENDIX) 단위**로 임베딩하고 로컬 Weaviate 에 적재·검색한다. 수집도 파일 파싱도 하지 않으며 원본을 수정하지 않는다.

### 3-A. 코드 지도 (`src/law_indexer/`)
- `config.py` — `.env` 로딩(Weaviate 접속·모델·배치·`INPUT_DATA_PATH`=data 루트 기본 `../data`).
- `models.py` — `LegalProvision` 데이터클래스 = Weaviate 한 객체(=한 조문/청크). `properties()` 는 None 값 생략.
- `mapper.py` — 수집 JSON → `LegalProvision[]`.
  - `load_law_json` / `map_law_data`: 법령 JSON 매핑(진입점). `body.articles[]` + `addenda[]` + `appendices[]`.
  - `load_attachment_json` / `map_attachment_data`: 전처리된 **첨부 청크** JSON 매핑.
  - `stable_id` / `object_uuid`(uuid5): 같은 `chunk_id` → 같은 UUID → 재적재 시 교체(멱등).
- `embedder.py` — `ArcticEmbedder` (SentenceTransformers, document/query API 분리, L2 정규화). 기본 `Snowflake/snowflake-arctic-embed-m-v2.0`.
- `weaviate_store.py` — 컬렉션 생성/upsert/search/health. self-provided vector(내부 vectorizer OFF). 컬렉션당 **모델·차원 1종만** 허용(적재 직전 검증).
- `preprocess.py` — **첨부파일 전처리 목업.** 파일 경로 → 청크 dict. 상위 문서 JSON 에서 메타 회수 + 별표 provision_id best-effort 매칭. **실제 API 는 `preprocess_file` 만 교체**(그 외 재사용).
- `pipeline.py` — `discover`(확장자/스킵) · `index_paths`(조문 JSON) · `index_attachment_files`(첨부→전처리→적재). 공통 `_run` 루프, 파일 실패는 건너뛰고 계속.
- `cli.py` — `health` / `create-collection [--recreate]` / `index`(생략 시 data 전체) / `index-files`(첨부 목업) / `index-attachment-chunks` / `search`.

### 3-B. 실행 (로컬, uv)
```bash
cd law_embedding
uv sync && cp .env.example .env            # uv 로 .venv+의존성 구성 (pip/venv 아님)
docker compose up -d                       # 로컬 Weaviate (익명·127.0.0.1 전용, HTTP 8081·gRPC 50051)
uv run python -m law_indexer health
uv run python -m law_indexer create-collection

# 본문 JSON 적재 — --input 생략 시 data 전체(law_data+admrul_data) 재귀 순회
uv run python -m law_indexer index
uv run python -m law_indexer index --input ../data/law_data --recursive --limit 6   # 일부만

# 첨부파일(목업 전처리) / 외부 전처리 청크 JSON
uv run python -m law_indexer index-files
uv run python -m law_indexer index-attachment-chunks --input <청크JSON>

uv run python -m law_indexer search --query "..." --limit 5
```
- **Weaviate 포트 8081** (host 8080 은 temporal-ui 점유). `.env` WEAVIATE_HTTP_PORT=8081.
- 첫 실행은 HF 에서 arctic 임베딩 모델 다운로드(네트워크·디스크 필요), 모델은 프로세스당 1회 로드.
- 모델 바꾸면 컬렉션 혼용 불가 → `create-collection --recreate` 후 재색인.

## 4. `law_embedding` 상태 (develop 브랜치)

> 사용자가 직접 짠 코드가 아니라 자유롭게 고쳐도 되는 영역. 작업은 **`develop` 브랜치**에서(origin=sehunpark-genon/law_embedding). 커밋 신원 = 본인, AI 트레일러 금지.

**정리 완료 (develop `4b6647b`)**
1. ✅ **경로 정정.** `INPUT_DATA_PATH` 기본값을 `../data` 로. `index`/`index-files` 는 `--input` 생략 시 data 루트를 재귀 순회하고 `_manifest.json` 은 스킵. (README·.env.example 갱신, `law_api` 참조 제거)
2. ✅ **README 조사수치 갱신** (옛 2,771/18,707 삭제).
3. ✅ **`INPUT_DATA_PATH` 실사용.** `index`/`index-files` 기본 입력으로 연결.
4. ✅ **`data/` 순회 러너.** `index`(조문) + `index-files`(첨부) 로 law_data/admrul_data 재귀 순회.
5. ✅ **전처리 목업 배선.** 첨부파일 순회 → `preprocess.preprocess_file`(목업) → `map_attachment_data` → 적재. **실제 전처리 API 연결은 다른 담당자**가 `preprocess_file` 만 교체.

**남은 것**
- **admrul(행정규칙류) 매핑 미검증.** mapper 는 법령 JSON 기준으로만 검증됨. `admrul_data` 는 현재 비어 있어 실제 JSON 으로 shape 대조 못 함(채워지면 확인 필요).
- **전처리 실연결.** 목업 → 실제 파싱/OCR API. `preprocess_file` 입출력 계약은 `preprocess.py` docstring 참고.
- **파일→별표 provision_id 매칭 정확도.** 로컬 파일명이 원본과 달라 일부만 매칭됨(안 되면 일반 첨부로 적재). 정확한 연결은 전처리기 몫.
- Weaviate 실적재 스모크는 미실행(모델 다운로드 필요) — 매핑·순회·목업은 실데이터로 검증됨.

## 4-B. `law_agent` — RAG 에이전트 (+ `git_history` 툴)

> 별도 repo(origin `sehunpark-genon/law_RAG`, **repo명 law_agent 로 개명 예정**, develop 브랜치). 로컬 디렉터리·패키지는 `law_agent`(`python -m law_agent`). 사용자가 세션 밖에서 크게 확장한 코드.

Weaviate 에 적재된 조문을 검색해 **Groq LLM(OpenAI 호환)** 으로 답하는 **LangGraph 에이전트**. 색인·적재는 안 하고 Weaviate/`data/` 를 읽기 전용으로 소비한다.

- **그래프**: `retrieve → route_history → (lookup_history) → answer` (`src/law_agent/graph.py`).
  - `route_history`: **LLM tool-router** 가 "연혁·개정·과거 시점" 질문인지 JSON 으로 판단(실패 시 키워드 규칙 폴백, `history.py`).
  - `lookup_history`: 검색 hit 의 **`git_path`(원본 JSON 파일)** 기준으로 `git_history` 툴이 그 파일의 commit timeline·개정문·diff 를 읽어 컨텍스트로 붙임. (synthetic provision_id 에 의존 안 함 → 부칙처럼 id 없는 단위도 처리)
- **명령**: `retrieve`(LLM 없이 검색/프롬프트) · `ask`(검색+답변). 옵션 `--trace/--show-history/--show-prompt/--history-date/--no-history`.
- **`git_history` 는 독립 툴 repo**(범용, 표준 라이브러리만, 자체 테스트 `test_core.py`). law_agent 는 이걸 **정식 의존성**으로 씀 — `pyproject [tool.uv.sources] git-history = { path = "../git_history", editable = true }`. (예전 `sys.path` sibling 해킹은 제거됨.) 진입점 `git_history.core.get_legal_documents_history_at_date()`.
- **전제**: law_embedding 쪽 Weaviate(8081) 가 떠 있고 적재돼 있어야 함. 쿼리 임베딩 모델은 **색인과 동일(arctic)**. 이력 조회는 `data/law_data`·`data/admrul_data` 가 git repo 여야 함.
- **Groq 주의**: Cloudflare 가 urllib 을 막아(403/1010) `httpx` 로 호출. `GROQ_API_KEY` 는 `.env`(gitignore)만, 커밋 금지.

## 4-C. 배포 / 도커화 (엄브렐라 + 2 compose 스택)

> `law_ai` 루트 = **엄브렐라 git repo**(origin `genonai/law_ai`, main). 코드 조각은 **서브모듈**, 런타임/외부는 제외.

- **서브모듈(코드) 4개**: `temporal_law` · `law_embedding` · `law_agent` · `git_history` (각자 원격·develop). clone 은 `git clone --recursive` (또는 clone 후 `git submodule update --init`).
- **엄브렐라 추적 제외**(.gitignore): `data/`(런타임 미러, 배포 시 clone/볼륨) · `doc_parser/`(전처리기=레지스트리 이미지) · `.env`/`.venv`.
- **전처리기 = 레지스트리 이미지** `192.168.74.164:30500/mnc/doc-parser-preprocessor:2.2.3` (genonai/doc_parser=docling 포크. 로컬 빌드 안 함). compose 에서 `preprocessor` 서비스로 `image:` 참조. law_embedding 이 첨부파일을 이 API 로 HTTP 호출(현재는 목업).
- **2 compose 스택** (독립 배포, `data/` git repo 로 느슨히 연결 = 수집 push / RAG pull):
  - **수집 스택**: temporal-db · temporal · temporal-ui · lawdb · worker(+headless Chrome). sync 는 **Temporal 스케줄**(`starter schedule` 1회 → cron 자동 발화). worker 는 상주.
  - **RAG 스택**: weaviate(8081) · law_embedding(색인 잡) · law_agent(API, git_history 라이브러리 내장) · preprocessor(이미지). 공유: `./data` 볼륨(RO, `.git` 포함) + arctic 모델캐시 볼륨.
- **`git_history` 는 컨테이너 아님** — law_agent 가 import 하는 라이브러리라 law_agent 이미지에 포함(빌드 컨텍스트에 git_history 필요).
- **STORAGE_MODE**: 운영은 `both`(DB+git) 사용 예정. → VM 수집 스택엔 lawdb 필요, 최초 1회 **pg_dump/restore 로 DB 이관**(both/db 모드는 catalog 가 postgres 상태라 필요. git 모드였다면 `_manifest.json` 만으로 됐음).
- **재색인 트리거**: 수집이 data push → RAG 쪽이 `git pull` 후 `law_indexer index`(nightly cron 등). 아직 미구현.

## 5. 자주 헷갈리는 것

- **JSON 구조는 수집기 payload 스키마를 따른다.** 임베딩기 매핑을 고치기 전에 수집기 payload 정의(`temporal_law/docs/`, `docs/desc/`)를 확인해 shape 를 맞춰라. 임베딩기가 기대하는 필드: 최상위 `law_id/mst/version_uid/law_name/law_type/...`, `body.articles[]`, `addenda[]`, `appendices[]`, `source.source_url`.
- **`data/` 는 임베딩 관점에선 읽기 전용.** 실측을 원하면 수집기를 돌려 새로 채우되(§0 확인), `data/` 를 손으로 고치지 말 것.
- **Weaviate 는 로컬 개발 전용 설정**(익명 접근·127.0.0.1). 운영 인증으로 쓰지 말 것.
