# GBD-10. [산출물] 수집기 개발 완료 및 수집 완료

## 1. 개요

법제처 OpenAPI와 law.go.kr 화면 정보를 기반으로 법령류와 행정규칙류를 구조화된 payload JSON으로 만드는 수집기 개발을 완료했다.

수집기는 단순히 본문 텍스트만 가져오는 코드가 아니라, 문서 메타데이터, 조문, 부칙, 별표/별지, 첨부파일 메타, 본문 이미지, relation 정보를 함께 정리한다. 여기서 relation은 조문이 다른 법령, 조문, 별표, 행정규칙, 조례 등을 가리키는 참조 관계를 뜻한다.

수집 결과로 만들어지는 payload는 이후 DB 저장, Git export, Markdown 생성, 임베딩 청킹, Git 이력 조회의 기준 데이터로 사용된다.

Temporal workflow, DB/Git 저장 방식, sync, 증분 package 생성, Weaviate 적재는 파이프라인 영역이므로 별도 이슈에서 다룬다. 이 이슈는 수집기 자체가 어떤 원천을 읽고 어떤 payload를 만드는지에 초점을 둔다.

상세 문서:

- 수집기 문서: https://github.com/sehunpark-genon/temporal_law/blob/develop/docs/collector.md
- 전체 흐름: https://github.com/sehunpark-genon/temporal_law/blob/develop/docs/flow.md
- README: https://github.com/sehunpark-genon/temporal_law/blob/develop/README.md

## 2. 수집 범위

현재 로컬 수집 산출물 기준 범위는 다음과 같다.

| 구분 | 대상 | 수집 JSON 수 |
| --- | --- | ---: |
| 법령류 | 법률 | 2,986 |
| 법령류 | 시행령 | 1,509 |
| 법령류 | 시행규칙 | 1,103 |
| 행정규칙류 | 행정규칙 | 22,427 |
| 행정규칙류 | 학칙 | 5,326 |
| 행정규칙류 | 공단정관 | 3,696 |
| 행정규칙류 | 공공기관 규정 | 3,558 |

합계:

- 법령류: 5,598건
- 행정규칙류: 35,007건

조례와 자치법규 본문은 현재 수집 대상에서 제외했다. 다만 법령 relation의 대상이나 위임자치법규 링크로 확인되는 경우에는 relation 메타로 보존한다. 조례 본문까지 수집하려면 자치법규 전용 목록/본문 수집 방식과 저장 구조가 별도로 필요하다.

## 3. 수집기 디렉터리 구조

```text
temporal_law/
├── collector/
│   ├── common.py        # 법령/행정규칙 공용 정규화, 조문/별표/부칙/인용 파서
│   ├── law.py           # 법령류 payload 생성 진입점
│   ├── admrul.py        # 행정규칙류 payload 생성 진입점
│   ├── render.py        # Chrome 렌더링 기반 링크 수집
│   ├── linkresolve.py   # 법령 본문 fncLsLawPop 팝업 호출로 링크 대상 확정
│   ├── mdexport.py      # payload -> Markdown/파일명 렌더링
│   └── verify.py        # 수집 결과와 화면 ground truth 대조
├── pipeline/            # 수집기를 대량/반복 실행하는 Temporal 운영 계층
├── api/                 # 관리 API 및 payload 조회 API
├── docs/                # 수집 방식, payload, relation, 운영 문서
└── samples/             # 수집 결과 예시 payload
```

이 이슈의 핵심 범위는 `collector/`다. `pipeline/`은 수집기를 언제, 어떤 단위로 실행하고 어디에 저장할지 관리하는 영역이다.

## 4. payload 구조

payload는 downstream에서 공통으로 사용하는 표준 JSON이다. 법령류와 행정규칙류는 원천 API 구조가 다르지만, 이후 임베딩/저장/이력 조회에서 같은 방식으로 다룰 수 있도록 최대한 비슷한 구조로 맞췄다.

주요 필드:

| 필드 | 설명 |
| --- | --- |
| `law_id` | 문서 식별자. 법령류는 법령ID, 행정규칙류는 행정규칙 ID 또는 일련번호 기반 값 |
| `mst` | 법제처 본문/화면 조회에 쓰는 일련번호 |
| `version_uid` | 법령류 버전 식별자. `law_id:mst:enforcement_date` 기준 |
| `adm_uid` | 행정규칙류 문서 저장 키. 예: `admrul:pi:12345` |
| `law_name`, `law_abbr` | 문서명과 약칭 |
| `law_type` | 법률, 대통령령, 부령, 고시, 훈령, 예규, 학칙, 공단정관 등 |
| `doc_target`, `doc_kind` | 행정규칙류 조회 target과 문서 종류 |
| `promulgation_date`, `enforcement_date`, `revision_date`, `revision_type` | 공포일, 시행일, 개정일, 제개정 구분 |
| `is_current`, `is_future` | 현행 여부, 시행예정 여부 |
| `basic_info` | 법제처 기본정보 원본 보존 영역 |
| `amendment_text`, `revision_reason` | 개정문과 제개정이유 |
| `body.articles[]` | 조문 목록. 조문번호, 제목, 장, 본문, relation, provision_id 포함 |
| `addenda[]` | 부칙 목록 |
| `appendices[]` | 별표, 별지, 서식, 부록 목록 |
| `attachments[]` | 행정규칙류 원문 파일 또는 첨부파일 메타 |
| `ordinance_delegations[]` | 위임자치법규/조례 relation 묶음 |
| `relation_stats` | relation 개수와 유형별 통계 |
| `provision_id` | 문서 자체를 가리키는 `#DOC` 식별자 |
| `source`, `sync` | 원문 URL, 수집 시각, 동기화 사유 등 운영 추적 정보 |

DB에는 payload JSON을 원형에 가깝게 저장한다. Git 미러로 export할 때는 매 수집마다 값이 바뀌어 diff를 어지럽히는 `sync`, `source.fetched_at` 같은 휘발성 필드는 제거한다.

## 5. 수집 흐름

### 5.1 법령류 수집 흐름

법령류는 법률, 시행령, 시행규칙을 대상으로 한다.

```text
목록 수집
  -> lawSearch.do target=eflaw, nw=3 호출
  -> 현행 법령 목록 수집
  -> lawSearch.do target=eflaw, nw=2 호출
  -> 시행예정 버전 수집
  -> (MST, 시행일) 집합으로 version_signature 생성
  -> 신규/변경/폐지 후보 판단
  -> 대상 법령 본문 수집
  -> lawService.do target=eflaw 호출
  -> 본문 조문/부칙/별표 파싱
  -> lawService.do target=lsDelegated 호출
  -> 위임 relation 생성
  -> 현행 법령이면 law.go.kr 렌더/팝업 링크 확인
  -> 인용, 자기참조, 별표참조 relation 생성
  -> payload 생성
```

주요 정책:

- 법령류는 `MST + 시행일자`를 버전 기준으로 사용한다.
- 현행 버전(`nw=3`)과 시행예정 버전(`nw=2`)을 함께 조회한다.
- 시행예정 조문은 현행 payload 안에 병합해 보존한다.
- 목록 수집 단계에서는 본문을 가져오지 않고 문서 존재 여부와 버전 지문만 계산한다.
- 조 번호가 없는 전문 텍스트는 `전문` 조문 1건으로 저장한다.
- 부칙은 `ADDENDUM`, 별표/별지는 `APPENDIX` 성격의 단위로 payload에 포함한다.

### 5.2 행정규칙류 수집 흐름

행정규칙류는 행정규칙, 학칙, 공단정관, 공공기관 규정을 대상으로 한다.

```text
target별 목록 수집
  -> lawSearch.do target=admrul/school/pi/public 호출
  -> 행정규칙 일련번호, 발령일, 시행일 수집
  -> 변경 감지용 지문 생성
  -> 대상 문서 본문 수집
  -> 조문내용 문자열을 제N조 패턴으로 재분리
  -> 별표/첨부파일 메타 수집
  -> 화면 링크 또는 렌더 결과로 relation 생성
  -> payload 생성
```

주요 정책:

- `admrul`, `school`, `pi`, `public` target을 하나의 행정규칙류 수집기로 처리한다.
- 행정규칙류 본문은 법령류처럼 계층형 조문 구조로 오지 않는 경우가 많아 `제N조(제목)` 패턴으로 다시 나눈다.
- 조문 텍스트가 없더라도 별표나 첨부파일이 있으면 파일 중심 payload로 살린다.
- 현행 1버전 중심으로 수집하며, 변경 감지는 행정규칙 일련번호와 시행일 정보를 기준으로 본다.
- target별로 목록/본문 화면과 링크 처리 방식이 다르므로 relation 생성 방식도 다르게 둔다.

## 6. relation 확정 방식

relation은 조문이 다른 법령/조문/별표/행정규칙/조례 등을 가리키는 참조 관계다.

수집기는 relation을 만들 때 법제처 구조화 API와 law.go.kr 화면에 실제로 생성된 링크를 우선 근거로 사용한다. 일반 텍스트만 보고 무리하게 relation을 만들면 약칭, 동법, 같은 법, 문장 범위 해석에서 오귀속 위험이 커지기 때문이다.

### 6.1 법령류 relation

법령류는 다음 relation을 만든다.

- 위임 relation: `lawService.do target=lsDelegated` 응답 기반
- 인용 relation: law.go.kr 현행 본문 화면 링크 + 팝업 호출 기반
- 자기참조 relation: 같은 법 내부 조문 참조
- 별표참조 relation: 본문에서 별표/별지를 참조하는 관계
- 위임조례/자치법규 relation: 조례 본문은 수집하지 않고 대상 메타만 보존

법령 본문 화면은 서버 HTML에 링크가 바로 들어 있지 않은 경우가 많다. 브라우저에서 JavaScript가 실행된 뒤에 DOM에 링크가 생기므로, 현행 법령은 headless Chrome으로 화면을 렌더링한 뒤 onclick 앵커를 추출한다.

처리하는 onclick:

| onclick | 의미 | 처리 |
| --- | --- | --- |
| `fncLsLawPop(...)` | 법령 인용, 자기 조문 참조, 별표 참조 | 팝업 호출로 대상 확정 |
| `fncLsPttnLinkPop(...)` | 시행령/시행규칙 위임 링크 | 처리 |
| `joDelegatePop(..., 010102, ...)` | 위임 행정규칙 | 처리 |
| `joDelegatePop(..., 010113, ...)` | 학칙공단/정관 등 | 처리 |
| `joDelegateOrdinPop(..., 010103, ...)` | 위임 자치법규/조례 | relation 메타로 보존 |

`fncLsLawPop`은 앵커 텍스트만 믿지 않고 팝업을 실제 호출한다. 팝업 응답에서 대상 법령명, MST, 대상 조문, 조문 제목을 서버 기준으로 다시 확정한다. 확정된 MST와 법령명이 자기 문서와 같으면 `internal_ref`, 다르면 `citation`으로 저장한다.

중요한 정책:

- `lsDelegated` API로 위임 relation을 먼저 만든다.
- 그 뒤 현행 본문 화면의 `fncLsLawPop` 앵커를 별도로 전수 확인한다.
- popup은 delegate 이후 누락분만 보강하는 단계가 아니라, 인용/자기참조/별표참조를 서버 팝업 기준으로 확정하는 별도 단계다.
- 과거 연혁 payload는 렌더/팝업을 호출하지 않는다. 과거 버전은 본문과 `lsDelegated` 위임 relation 중심으로 만든다.
- 법령류는 화면 링크가 없는 일반 텍스트 참조를 relation으로 새로 만들지 않는다.

### 6.2 행정규칙류 relation

행정규칙류는 문서 종류별로 링크 품질과 화면 구조가 달라 target별로 다르게 처리한다.

| target | 대상 | 링크 확인 방식 | 처리 |
| --- | --- | --- | --- |
| `admrul` | 고시, 훈령, 예규 | 본문 뷰어 HTML의 `fncLawPop` 앵커 | 처리 |
| `school` | 학칙 | 하이퍼링크가 거의 없고 노이즈가 많음 | relation 생성하지 않음 |
| `pi` | 공단정관 | Chrome 렌더 후 DOM 링크 확인 | 처리 |
| `public` | 공공기관 규정 | Chrome 렌더 후 DOM 링크 확인 | 처리 |

행정규칙류는 법령류처럼 구조화된 조문 단위 인용 API가 없다. 따라서 본문 뷰어에 실제로 그려지는 링크를 근거로 사용한다.

행정규칙류는 화면 링크가 부족한 경우가 있어 제한적으로 텍스트 보강을 사용한다. 다만 단순히 법령처럼 보이는 이름이 텍스트에 있다고 해서 모두 relation으로 만들지는 않는다. 자기참조이거나 명확한 외부 법령 인용으로 판단되는 경우에만 보강한다.

예시:

- `기준 중위소득 및 생계ㆍ의료급여 선정기준과 최저보장수준` 계열 고시에서 `국민기초생활 보장법 제2조제11호`처럼 외부 법령을 가리키는 문장이 자기 문서 링크처럼 내려오는 케이스가 있다.
- 이 경우 행정규칙류 수집기는 바로 앞 본문의 외부 법령명을 보고 `text_supplement` 방식으로 대상명을 교정한다.

### 6.3 relation 객체와 resolve_method

relation 객체는 각 조문의 `relations[]`에 붙는다.

주요 필드:

| 필드 | 설명 |
| --- | --- |
| `relation_type` | `delegation`, `citation`, `internal_ref`, `appendix_ref` 등 관계 유형 |
| `delegation_type` | 위임 관계일 때 시행령/시행규칙/위임행정규칙/위임자치법규/위임학칙공단 등 세부 유형 |
| `source_article_no`, `source_clause` | relation이 나온 출처 조문과 더 구체적인 항/호/목 위치 |
| `target_category` | 대상 문서 분류. 법령, 행정규칙, 학칙공단, 조례, 별표 등 |
| `target_law_name`, `target_article_no`, `target_article_title`, `target_mst` | 대상 문서명, 조문번호, 조문 제목, 대상 일련번호 |
| `link_text`, `line_text` | 화면 링크 텍스트와 relation이 나온 본문 문맥 |
| `target_url` | 사람이 확인할 수 있는 law.go.kr 대상 URL |
| `resolve_method` | relation을 어떤 근거로 확정했는지 나타내는 값 |
| `appendix_no`, `appendix_branch`, `appendix_kind`, `appendix_found` | 별표참조일 때 대상 별표/별지 번호와 실제 수집 여부 |
| `superseded_target` | 폐지본을 현행 대상으로 교정했을 때 교정 전 대상을 보존 |
| `source_provision_id`, `reference_id`, `target_ref_id` | payload 내부 조문/별표와 relation을 연결하기 위한 안정적인 참조 ID |

`resolve_method`는 relation의 신뢰도와 출처를 설명하는 값이다.

| 값 | 사용 위치 | 의미 |
| --- | --- | --- |
| `delegation` | 법령류 | `lsDelegated` API 응답으로 만든 위임 relation |
| `delegation+current` | 법령류 | `lsDelegated`가 폐지본을 가리킬 때 현행 문서로 교정한 relation |
| `pop` | 법령류 현행 | Chrome 렌더 후 `fncLsLawPop` 팝업을 실제 호출해 서버 기준으로 확정 |
| `pop_text` | 법령류 현행 | 팝업 호출/파싱 실패 앵커만 DOM 문맥으로 제한 보강 |
| `rendered_cite` | 법령류 비운영 | 팝업 없이 렌더 DOM 앵커만 읽어 근사. 운영 기본은 아님 |
| `render` | 법령류/행정규칙류 | JS 렌더 이후 DOM에 생기는 링크로 relation 생성 |
| `html` | 행정규칙류 | 서버 HTML에 직접 그려진 `fncLawPop` 앵커로 relation 생성 |
| `text_supplement` | 행정규칙류 | 화면 앵커가 잘못 물린 경우 주변 텍스트로 대상 법령명 교정 |
| `text_parse` | 행정규칙류 | 앵커가 없지만 자기참조/명확한 외부 법령 인용일 때 제한 생성 |
| `text_parse_external` | 희귀 케이스 | 외부 법령 별표/별지 참조로 해석되는 경우 |

## 7. 조문이 없거나 특수한 문서 처리

법제처 원문이 항상 번호 붙은 조문 목록으로 오는 것은 아니다.

전문만 있는 문서:

- 관할구역 변경법이나 폐지법처럼 번호 붙은 조문이 없고 본문이 전문 텍스트 한 덩어리인 문서가 있다.
- 이 경우 `article_no="전문"`인 조문 1건으로 저장한다.
- 이 조문의 `provision_id`는 문서 자체와 같은 `#DOC`를 사용한다.
- 법령류와 행정규칙류 공통 처리다.

파일에만 내용이 있는 문서:

- `한국표준산업분류`처럼 조문/본문 텍스트 없이 별표나 첨부파일에만 내용이 있는 고시가 있다.
- 행정규칙류에서는 조문이 0건이어도 별표나 첨부파일이 있으면 파일 중심 payload로 보존한다.
- 파일 viewer URL과 메타를 payload에 남긴다.
- 실제 파일 본문 텍스트화는 수집기가 직접 하지 않고 전처리기 연결로 처리한다.

법령류 현행 조문 0건:

- 법령류 현행 본문에서 조문이 0건이면 payload를 완료로 저장하지 않고 수집 실패로 처리한다.
- 법령류에는 행정규칙류처럼 file-only 예외를 두지 않는다.
- law.go.kr/API가 일시적으로 빈 응답을 준 것을 정상 수집으로 오판하지 않기 위한 방어다.

과거 연혁 껍데기:

- 오래된 과거 버전은 법제처가 본문을 `[자료 수집중]` 형태로만 주는 경우가 있다.
- 재시도 후에도 조문, 별표, 첨부, 전문이 모두 없으면 해당 과거 버전 하나만 건너뛰고 현행과 나머지 버전은 저장한다.

## 8. Temporal 및 파이프라인 경계

수집기는 payload를 만드는 코어 영역이다. 즉, 문서 1건을 가져와서 법령/행정규칙 payload JSON으로 정규화하는 책임을 가진다.

아래 항목은 수집기 자체가 아니라 수집기를 대량으로 실행하고 운영하는 파이프라인 영역이다.

- 초기 적재
- 전체 적재
- 매일 sync
- 실패 문서 재시도
- DB 저장
- Git export
- 변경분 JSONL package 생성
- 전처리기 호출 시점 결정
- 증분 임베딩
- Weaviate 적재

이 경계를 나눈 이유는 수집기 payload가 downstream의 공통 계약이기 때문이다. 저장소를 DB로 쓰든 Git으로 쓰든, 이후에 임베딩으로 넘기든 Git 이력 조회에 쓰든, 가장 먼저 안정적으로 맞춰야 하는 것은 payload 구조다.

따라서 이 이슈에서는 “어떤 API와 화면을 읽어 어떤 payload를 만들었는가”를 다루고, Temporal workflow, 저장 모드, handoff package, 증분 처리, Weaviate 적재는 별도 파이프라인 이슈에서 다룬다.

## 9. 한계

- 조례/자치법규 본문은 현재 수집하지 않는다.
- 법제처 본문이나 화면에서 링크가 잘못 걸려 있으면 수집기도 잘못된 대상 정보를 받을 수 있다.
- 예: `군인연금법` 제38조처럼 문장 안에서 제외/한정 범위가 섞인 경우, 화면 링크가 문맥을 정확히 반영하지 못하면 pop 결과도 그 잘못된 링크를 따라갈 수 있다.
- 법령류는 화면 링크가 없는 일반 텍스트 참조를 relation으로 만들지 않는다. 정확도보다 휴리스틱이 커지는 것을 피하기 위한 정책이다.
- 행정규칙류는 문서 구조 편차가 크고, 본문 없이 파일만 있는 문서가 존재한다.
- 행정규칙류의 형제 규정, 세칙, 지침처럼 대상이 불명확한 텍스트 참조는 relation에서 제외한다.
- 첨부파일 본문 텍스트화는 별도 전처리기 연결이 필요하다.
- relation 상세는 payload에 보존되지만, downstream에서 어떤 필드를 사용할지는 임베딩/Agent 파이프라인에서 별도로 정한다.

## 10. 산출물 원칙

- DB에는 payload JSON을 원형에 가깝게 저장한다.
- Git export는 payload를 읽어 문서별 폴더에 Markdown, JSON, 별표/첨부 파일을 만든다.
- 현행 payload에는 현행 조문과 시행예정 조문 정보가 함께 들어갈 수 있다.
- 과거 연혁 payload는 속도와 안정성을 위해 본문 중심으로 보존한다.
- relation은 가능한 한 법제처 구조화 API와 law.go.kr 화면 링크를 우선한다.
- 조 번호가 없는 본문도 텍스트가 있으면 `전문` 조문 1건으로 저장한다.
- 행정규칙류는 본문이 없어도 별표/첨부가 있으면 파일 중심 payload로 살린다.

## 11. 결과

- 법령류 Git 미러: https://github.com/genonai/law_data
- 행정규칙류 Git 미러: https://github.com/genonai/admrul_data
- 수집기: https://github.com/sehunpark-genon/temporal_law
