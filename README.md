# law_ai

법제처(law.go.kr) 데이터를 수집해서 벡터 DB에 넣고 RAG로 답하는 파이프라인. 이 저장소는 **엄브렐라**이고, 실제 코드는 서브모듈 4개에 들어 있다.

```
law_ai/
├── temporal_law/     수집기 — 법제처 API → payload JSON → Postgres + git 데이터레포
├── law_embedding/    임베딩기 — payload JSON → Weaviate 색인
├── law_agent/        RAG 에이전트 — 검색 + LLM 답변 (git_history 를 라이브러리로 씀)
├── git_history/      이력 조회 툴 — 데이터레포 git log/diff 로 개정 연혁
└── data/             수집 산출물(런타임 미러) — 이 저장소가 추적하지 않는다
```

작업 지침과 도메인 지식은 [`CLAUDE.md`](CLAUDE.md)에, 각 조각의 상세는 서브모듈 안 문서에 있다.

## 받기

```bash
git clone --recursive https://github.com/genonai/law_ai.git
cd law_ai
```

이미 받았는데 서브모듈이 비어 있으면:

```bash
git submodule update --init --recursive
```

서브모듈은 각자 `develop` 브랜치를 쓴다. 엄브렐라는 **커밋 SHA를 가리킬 뿐**이라 clone 직후에는 detached HEAD 상태다. 서브모듈에서 작업하려면 브랜치를 잡아라:

```bash
git submodule foreach 'git checkout develop && git pull'
```

## 데이터 레포 (선택)

수집 산출물은 코드와 분리된 **별도 저장소 3개**다. 엄브렐라는 이걸 추적하지 않는다(수십 GB).

| 레포 | 내용 |
| --- | --- |
| `genonai/LAW` | 법률·시행령·시행규칙 |
| `genonai/ADMRUL` | 고시·훈령·예규 |
| `genonai/SCHLPUBRUL` | 학칙·공단정관·공공기관 규정 |

수집기를 돌릴 거면 `data/` 아래에 clone 한다.

```bash
mkdir -p data && cd data
git clone https://github.com/genonai/LAW.git
git clone https://github.com/genonai/ADMRUL.git
git clone https://github.com/genonai/SCHLPUBRUL.git
```

임베딩·RAG만 쓸 거면 읽기 전용으로 받으면 된다. **`data/` 는 손으로 편집하지 않는다** — 수집기가 덮어쓴다.

## 돌리기

각 조각은 독립적으로 돈다. 자세한 건 서브모듈 문서를 봐라.

**수집기** — 자기 `.env` 가 필요하다(`temporal_law/.env.example` 참고). Temporal·Postgres 는 docker compose 로 띄운다.

```bash
cd temporal_law
uv sync && cp .env.example .env      # OC 인증키·데이터레포 경로를 채운다
docker compose up -d                  # temporal · temporal-ui(8080) · lawdb(5544)
uv run python -m pipeline.worker      # 워커 상주
uv run python -m pipeline.starter discover
uv run python -m pipeline.starter backfill
```

**임베딩기**

```bash
cd law_embedding
uv sync && cp .env.example .env
docker compose up -d                  # Weaviate (8081)
uv run python -m law_indexer health
uv run python -m law_indexer create-collection
uv run python -m law_indexer index
```

**RAG 스택 한 번에** — 루트의 compose 는 weaviate·임베딩·에이전트·전처리기를 묶는다.

```bash
cp .env.example .env                  # GROQ_API_KEY 등
docker compose -f docker-compose.rag.yml up -d
```

## 주의

- `.env` 는 어느 저장소에도 커밋하지 않는다. **법제처 OC 인증키는 특히 금지.**
- 서브모듈에서 작업하면 **서브모듈을 먼저 push** 한 뒤 엄브렐라의 포인터를 갱신·push 한다. 순서가 뒤바뀌면 clone 한 사람이 없는 커밋을 가리키게 된다.
- 수집기 코드를 바꾸면 **Temporal 워커를 재시작**해야 반영된다.
