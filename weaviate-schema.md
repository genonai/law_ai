# Weaviate Schema

`law_embedding`이 생성/적재하는 Weaviate 컬렉션 정리 문서다.

현재 컬렉션은 법령류와 행정규칙류를 분리하지만, 두 컬렉션은 같은 property schema를 공유한다.

## Collections

| 구분 | 기본 컬렉션명 | 설정 키 | 입력 repo |
|---|---|---|---|
| 법령류 | `LegalProvisionIndex` | `LAW_COLLECTION` 또는 기존 `WEAVIATE_COLLECTION` | `data/law_data` |
| 행정규칙류 | `AdmrulProvisionIndex` | `ADMRUL_COLLECTION` | `data/admrul_data` |

## Vector

- Weaviate 내장 vectorizer는 사용하지 않는다.
- `law_embedding`이 직접 만든 vector를 self-provided vector로 넣는다.
- 기본 임베딩 모델은 `Snowflake/snowflake-arctic-embed-m-v2.0`.
- 같은 컬렉션에는 하나의 임베딩 모델/차원만 들어가야 한다.
- 모델을 바꾸면 컬렉션을 재생성하고 다시 적재한다.

## Object 단위

Weaviate object는 법령/행정규칙 문서 전체가 아니라 검색 가능한 단위 chunk다.

- JSON 본문: 조문, 부칙, 별표/별지 단위
- 첨부파일: 전처리 API가 반환한 파일 chunk 단위

`law_Agent`는 원문 폴더를 직접 RAG 입력으로 보지 않고, 기본적으로 Weaviate 검색 결과를 사용한다.

## Common Schema

### 식별자

| 필드 | 타입 | 설명 |
|---|---|---|
| `chunk_id` | `TEXT` | Weaviate object의 논리 ID. 재적재 시 같은 chunk는 같은 UUID로 교체된다. |
| `provision_id` | `TEXT` | 조문/부칙/별표 단위 식별자. 첨부 일반 chunk는 없을 수 있다. |
| `parent_provision_id` | `TEXT` | 상위 조문/단위 식별자. 명시 근거가 없으면 비운다. |
| `reference_ids` | `TEXT_ARRAY` | 조문 relation에서 추출한 참조 provision id 목록. |
| `file_id` | `TEXT` | 첨부파일 chunk 묶음 식별자. JSON 본문 chunk는 보통 없음. |
| `law_id` | `TEXT` | 법령/행정규칙 ID. |
| `mst` | `TEXT` | 법제처 MST. |
| `version_uid` | `TEXT` | 버전 식별자. 행정규칙류는 없는 경우 합성값을 사용한다. |
| `adm_uid` | `TEXT` | 행정규칙류 저장 키. 법령류에는 보통 없음. |

### 법령 메타

| 필드 | 타입 | 설명 |
|---|---|---|
| `law_name` | `TEXT` | 법령/행정규칙명. |
| `law_abbr` | `TEXT` | 약칭. |
| `law_type` | `TEXT` | 법률, 대통령령, 총리령, 행정규칙 등 문서 유형. |
| `collection_type` | `TEXT` | 컬렉션 소속 구분. 값은 `law` 또는 `admrul`. |
| `source_repository` | `TEXT` | 입력 Git 저장소 URL 또는 저장소 식별자. |
| `source_url` | `TEXT` | 법제처 등 원천 API/페이지 URL. |
| `git_path` | `TEXT` | JSON 본문 파일 경로. Git history 조회 시 기준 경로로 사용할 수 있다. |
| `git_commit` | `TEXT` | 수집/export 시점 Git commit. |
| `source_file_path` | `TEXT` | 전처리기에 넘긴 실제 첨부파일 로컬 경로. JSON 본문 경로는 `git_path`가 담당한다. |
| `source_relative_path` | `TEXT` | Git 저장소 기준 첨부파일 상대 경로. 서버가 바뀌어도 재현 가능한 경로. |

### 단위 메타

| 필드 | 타입 | 설명 |
|---|---|---|
| `unit_type` | `TEXT` | chunk 단위. 예: `ARTICLE`, `ADDENDUM`, `APPENDIX`, `ATTACHMENT`. |
| `unit_no` | `TEXT` | 제1조, 부칙 key, 별표 번호 등 단위 번호. |
| `unit_title` | `TEXT` | 조문 제목, 별표 제목, 첨부파일 제목. |
| `chapter` | `TEXT` | 장/편 등 조문 계층 정보. |
| `source_type` | `TEXT` | 입력 출처 구분. 예: `JSON`, `FILE`. |
| `is_file_only` | `BOOL` | 별표/별지 등이 본문 텍스트가 아니라 파일만 가진 경우. |
| `file_name` | `TEXT` | 첨부파일명. |
| `file_url` | `TEXT` | 원천 첨부파일 URL. |
| `file_hash` | `TEXT` | 원본 첨부파일 자체의 hash. |

### 본문 / 검색 텍스트

| 필드 | 타입 | 설명 |
|---|---|---|
| `content` | `TEXT` | 원문 chunk 내용. JSON 본문 또는 전처리 결과 텍스트. |
| `search_text` | `TEXT` | 임베딩에 사용하는 텍스트. 법령명, 유형, 조문번호, 제목, 본문 등을 결합한다. |
| `content_hash` | `TEXT` | `content` 기준 hash. 재처리/변경 감지에 사용 가능. |

### 날짜 / 버전 상태

| 필드 | 타입 | 설명 |
|---|---|---|
| `promulgation_date` | `DATE` | 공포일자. |
| `enforcement_date` | `DATE` | 시행일자. |
| `revision_date` | `DATE` | 제개정일자. |
| `revision_type` | `TEXT` | 제정, 일부개정, 타법개정 등. |
| `is_current` | `BOOL` | 현행 여부. |
| `is_future` | `BOOL` | 미래 시행 예정 여부. |
| `effective_from` | `DATE` | 조문 단위 유효 시작일 후보 필드. 현재는 근거가 있을 때만 사용. |
| `effective_to_exclusive` | `DATE` | 조문 단위 유효 종료일 후보 필드. 현재는 근거가 있을 때만 사용. |

### Chunk / Page 메타

| 필드 | 타입 | 설명 |
|---|---|---|
| `page_no` | `INT` | 단일 페이지 번호. |
| `start_page` | `INT` | 전처리 결과 chunk 시작 페이지. |
| `end_page` | `INT` | 전처리 결과 chunk 끝 페이지. |
| `chunk_index` | `INT` | 파일/문서 내 chunk 순서. |
| `chunk_count` | `INT` | 같은 파일/문서의 전체 chunk 수. |
| `n_char` | `INT` | 전처리 결과 문자 수. |
| `n_word` | `INT` | 전처리 결과 단어 수. |
| `n_line` | `INT` | 전처리 결과 줄 수. |
| `parser_reg_date` | `TEXT` | 전처리기 응답 등록/처리 시각. |

### 전처리 부가 메타

전처리기 응답 중 구조화된 값은 문자열로 직렬화해 저장한다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `chunk_bboxes` | `TEXT` | chunk bounding box 정보. JSON 문자열. |
| `media_files` | `TEXT` | 전처리 중 생성/참조된 미디어 파일 정보. JSON 문자열. |
| `guardrail_categories` | `TEXT` | 전처리기 guardrail 분류 결과. JSON 문자열. |
| `image_urls` | `TEXT` | 조문 본문 인라인 이미지 URL 목록. JSON 문자열. |

### 임베딩 메타

| 필드 | 타입 | 설명 |
|---|---|---|
| `embedding_model` | `TEXT` | object에 들어간 임베딩 모델명. |
| `embedding_dimension` | `INT` | vector 차원. |

## 운영 메모

- 법령류와 행정규칙류는 컬렉션을 분리한다.
- 두 컬렉션은 같은 schema를 사용한다.
- `law_embedding create-collection`은 두 컬렉션을 모두 만들 수 있다.
- `law_embedding index --source law|admrul|both`로 적재 대상을 선택한다.
- `.md`는 사람용 문서라 임베딩 대상에서 제외한다.
- `_manifest.json`은 적재 대상에서 제외한다.
- `law_Agent`는 기본적으로 Weaviate만 검색한다.
- Git history 기능을 계속 쓰려면 `data/law_data`, `data/admrul_data`의 `.git` 이력이 보존되어야 한다.
- DB 기반 history tool로 전환할 경우 `git_history` 대신 SQL tool 연동이 필요하다.
