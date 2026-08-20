# provision-viewer-backend

`provision_id` + `path`(레포 내 파일 경로)로 조문을 조회하는 read-only API.
Postgres(lawdb) 대신 `genonai/law_data`, `genonai/admrul_data` GitHub 저장소를 직접 읽는다.
clone은 받지 않고, 매 요청 GitHub REST API(커밋 이력)와 raw.githubusercontent.com
(특정 커밋 시점 파일 내용)만 호출한다.

## 실행

```bash
cp .env.example .env   # 필요 시 GITHUB_TOKEN 설정(선택 — 없으면 60회/시간으로 제한)
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

## API

- `GET /health` — GitHub API 연결 확인
- `GET /api/provisions?provision_id=...&path=...` — 해당 provision_id의 조문을,
  원문이 같은 버전끼리 묶어서 반환
  - `provision_id`: 예) `law:1인창조기업육성에관한법률#JO0001`
  - `path`: 레포 내 실제 파일 경로(공백 포함), 예) `1인 창조기업 육성에 관한 법률/법률/1인 창조기업 육성에 관한 법률.json`
  - repo는 `provision_id`의 prefix로 정해진다: `law:` → law_data, 그 외(`admrul:`/`school:`/`pi:`/`public:`) → admrul_data
  - 응답의 각 relation에는 `resolved_path`가 함께 내려간다(관련조항의 `target_law_name`으로
    같은 규칙을 적용해 계산한 값) — 클릭 이동 시 별도 조회 없이 바로 사용 가능
