# Weaviate Schema — 법령 RAG 벡터 스키마

> 청크(=조문/부칙/별표/파일) 1개 = Weaviate 객체 1개. 벡터는 self-provided(내부 vectorizer off).
> 컬렉션은 `LegalProvisionIndex`(법령류) / `AdmrulProvisionIndex`(행정규칙류) **2개로 분리**하되 스키마는 동일.
>
> **구분:**
> - **필터** : top-level 프로퍼티, `indexFilterable:true` (`where` 로 거는 것)
> - **표시** : top-level 프로퍼티, 인덱스 OFF (반환·조회용)
> - **meta** : top-level 프로퍼티 **`meta`(text, JSON 문자열 1개)** 로 통합. 개별 키는 아래 "meta 내부 키" 표 참고. ⚠ JSON 문자열이라 `where` 필터 불가 — 조회/표시용.

## A. top-level 프로퍼티

| 필드 | 타입 | 구분 | 설명 |
|---|---|---|---|
| `chunk_id` | text | 필터 | 객체 UUID 근거(uuid5). 청크 단위 식별. |
| `provision_id` | text | 필터 | 조문/부칙/별표 단위 ID (`law:근로기준법#JO0061`). |
| `law_id` | text | 필터 | 문서 단위 ID. 삭제/재적재 기준. |
| `version_uid` | text | 필터 | 버전 식별자(개정 시 통째 교체). |
| `file_id` | text | 필터 | 첨부/원문 파일 단위 식별(파일 청크 그룹). |
| `unit_type` | text | 필터 | `ARTICLE`·`ADDENDUM`·`APPENDIX`·`AMENDMENT`·`FILE`. (AMENDMENT=개정문·개정이유 청크, FILE 세부는 meta.`file_kind`) |
| `is_current` | boolean | 필터 | 현행 여부. |
| `enforcement_date` | date | 필터 | 시행일(as-of 검색). |
| `reference_ids` | text[] | 필터 | 위임·인용 대상 provision_id 목록(관계 확장). |
| `parent_provision_id` | text | 필터 | 상위 조문/별표. |
| `ministry` | text | 필터 | 소관부처. 원본 `basic_info.소관부처.content` 에서 추출. 부처별 검색 facet. |
| `domain` | text | 표시 | `law` / `admrul`. 컬렉션 분리라 필터 아님, payload 구분용. |
| `law_name` | text | 표시 | 법령/행정규칙명. |
| `law_abbr` | text | 표시 | 약칭. |
| `law_type` | text | 표시 | 법률·대통령령·부령·고시·훈령·예규. |
| `unit_no` | text | 표시 | 조문번호/부칙키/별표번호. |
| `unit_title` | text | 표시 | 조문·부칙·별표 제목. |
| `chapter` | text | 표시 | 장/절. |
| `content` | text | 표시 | 청크 본문(표시 대상). |
| `search_text` | text | 표시 | 실제 임베딩되는 문자열(법령명·종류·장·조번호·제목 + 본문). 조문·첨부 모두 생성. 인덱스 off(벡터검색은 벡터로 하므로 저장은 디버깅·향후 hybrid/BM25용). |
| `source_type` | text | 표시 | `JSON` / `FILE`. |
| `source_url` | text | 표시 | law.go.kr URL. |
| `git_path` | text | 표시 | 원본 JSON 경로(연혁·추적). |
| `mst` | text | 표시 | 법제처 MST. 링크 해석은 이름(reference_id=provision_id 형식) 기반이라 필터 불필요. |
| `adm_uid` | text | 표시 | 행정규칙 저장키. |
| `file_name` | text | 표시 | 파일명. |
| `file_url` | text | 표시 | 파일 URL. |
| `page_no` | int | 표시 | 대표 페이지. |
| `chunk_index` | int | 표시 | 문서 내 청크 순번. |
| `chunk_count` | int | 표시 | 문서 내 청크 수. |
| `is_future` | boolean | 표시 | 미래 시행 예정(문서레벨 미래버전 구분). |
| `promulgation_date` | date | 표시 | 공포일. |
| `revision_date` | date | 표시 | 개정일. |
| `revision_type` | text | 표시 | 제정·일부개정·전부개정·타법개정. |
| `meta` | text (JSON) | meta 컨테이너 | 아래 "meta 내부 키" 전체를 JSON 문자열 1개로. 인덱스 off. |

## B. `meta` 내부 키 (top-level 아님 — `meta` JSON 안에 보관)

| 키 | 타입 | 설명 |
|---|---|---|
| `relation_refs` | array | 참조별 정보 `[{reference_id,target_mst,relation_type,source_clause,line_text,link_text,target_article_title,target_url,resolve_method}]`. 판단은 `reference_ids`(필터). `target_mst` 는 admrul·render·pop_text 참조면 null(링크는 이름 기반이라 무관). reference_id 로 파싱되는 값(target_law_name/target_unit/target_category)은 중복이라 제외. |
| `file_kind` | text | `FILE` 세부: 원문파일(document_file) / 첨부(attachment). |
| `image_urls` | array | 본문 인라인 이미지(article.images) `[{url,filename,...}]`. OCR 안 함 — URL·파일명만 보존(에이전트가 URL 로 접근). 첫 청크에만. |
| `n_char` / `n_word` / `n_line` | int | 전처리 통계. |
| `start_page` / `end_page` | int | 청크 시작/끝 페이지. |
| `page_count` | int | 문서 전체 페이지 수. |
| `chunk_index_on_page` / `chunk_count_on_page` | int | 페이지 내 청크 순번/수. |
| `chunk_bboxes` | array | 전처리 bounding box. |
| `media_files` | array | 전처리 미디어 파일. |
| `guardrail_categories` | array | guardrail 분류. |
| `parser_reg_date` | text | 전처리 결과 생성 시각. |
| `file_title` | text | 전처리기 `title`. |
| `file_created_date` | date/int | 전처리기 `created_date`. |
| `matched_appendix_filename` | text | 전처리기 `appendix`. |
| `source_file_path` | text | 전처리에 쓴 로컬 첨부 경로. |
| `source_relative_path` | text | Git 기준 첨부 상대경로. |
| `source_repository` | text | 원본 Git 저장소. |
| `git_commit` | text | 수집/export 시점 커밋. |
| `content_hash` | text | 본문 SHA-256. |
| `file_hash` | text | 첨부 원본 해시. |
| `promulgation_no` | text | 공포번호. |
| `future_enforcement_dates` | array | 미래 시행일 목록(문서레벨). |
| `scheduled` | array | 조문별 미래 시행 예고 `[{enforcement_date,change,content}]`. change=개정/신설/삭제. 현재조 청크에 붙어 "언제 어떻게 바뀐다"를 같이 냄(벡터엔 안 섞음). |
| `repealed` / `repeal_scheduled` | bool | 폐지됨 / 폐지예정(아직 현행). 문서레벨. |
| `repealed_at` | date | 폐지일. |

## C. 생략 (저장 안 함)

| 필드 | 이유 |
|---|---|
| `embedding_model` / `embedding_dimension` | 청크마다 반복 저장 불필요 → 컬렉션 단위 운영 메타로 관리. |

## 요약
- **top-level 프로퍼티 35개** = 필터 11 · 표시 23 · `meta` 컨테이너 1. (죽은/중복 3개 제거: is_file_only=source_type 중복, effective_from/to=미사용)
- **시간축**: 현행=VDB 본체(`is_current`) · 미래=`meta.scheduled`(언제 개정/신설/삭제) · 과거=git_history. 버전구간(effective_from/to) 불필요.
- **`meta` JSON 내부 키 ~26개** — top-level 아님, 조회/표시용(where 필터 불가).
- **관계**: `reference_ids`(배열=필터, 대상 판단용) + `meta.relation_refs`(인용/위임 문맥·확정정보). 링크 해석은 이름 기반(reference_id=provision_id 형식)이라 mst 없이도 됨(admrul 은 mst 항상 null).
- **컬렉션**: law/admrul 2개 분리. `domain` 은 payload 표시용(필터 아님).
- **search_text**: 임베딩 대상 문자열. 저장은 인덱스 off(디버깅·hybrid/BM25 여지).
- **unit_type 4값**: `ARTICLE/ADDENDUM/APPENDIX/FILE`. 원문파일 vs 첨부 구분은 `meta.file_kind`.
- **문서레벨 값**(개정문·개정이유·미래시행일)은 청크마다 복제하지 말고 `meta` 로.
- **두 입력 경로가 같은 스키마로 합류**: JSON 본문(`map_law_data`→ARTICLE/ADDENDUM/APPENDIX) · 전처리 첨부(DocParser→`map_appendix_file_chunks`→FILE). 둘 다 `search_text` 를 만들어 임베딩 → 같은 컬렉션·같은 벡터.

## FILE 전처리 응답 매핑

DocParser `/run` 응답(`{code:0, data:[{text, i_page, ...}]}`) → 내부 청크 → LegalProvision.

| 전처리기 응답 필드 | schema 필드 | 위치 |
|---|---|---|
| `text` | `content` | top-level(표시) |
| `i_chunk_on_doc` / `n_chunk_of_doc` | `chunk_index` / `chunk_count` | top-level(표시) |
| `i_page` | `page_no` | top-level(표시) |
| `n_char` / `n_word` / `n_line` | 동일 | meta |
| `i_page` / `e_page` | `start_page` / `end_page` | meta |
| `i_chunk_on_page` / `n_chunk_of_page` | `chunk_index_on_page` / `chunk_count_on_page` | meta |
| `n_page` | `page_count` | meta |
| `reg_date` | `parser_reg_date` | meta |
| `chunk_bboxes` / `media_files` / `guardrail_categories` | 동일 | meta |
| `title` / `created_date` / `appendix` | `file_title` / `file_created_date` / `matched_appendix_filename` | meta |

---
> 운영 정책(스키마 외 각주): 폐지 문서는 `is_current=false` 플래그로 남기기보다 `delete_by_law_id` 로 청크를 제거하는 편이 검색 오염이 적다.
