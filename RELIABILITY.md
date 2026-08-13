# RELIABILITY.md — 재처리·복구(안정성) 지도

> "내가 없어도 돌아가게" — 크래시·전원차단·일시장애가 나도 **데이터가 조용히 유실/중복되지 않고
> 스스로 복구**되게 하는 장치들의 모음. 수집기(`temporal_law`) → 핸드오프(JSONL package) →
> 임베딩 소비자(`law_embedding`) 전 구간을 다룬다. (2026-08 안정성 강화 반영)

## 0. 기본 원리 3가지

1. **멱등(idempotent) + at-least-once**: 전송은 "최소 1번"(중복 가능), 소비는 결정적 `chunk_id`(uuid5)
   덕에 몇 번 처리해도 결과 동일. → 중복 전송/재처리가 오염을 만들지 않는다.
2. **self-heal(자가치유)**: "무엇을 성공했는지"를 durable 하게 기억하고, 아직 못 한 것만 다음 실행이
   다시 한다. 크래시/실패는 "다음 주기에 다시"로 흡수된다.
3. **fail-closed(안전쪽 실패)**: 애매하면 진행하지 않고 실패시킨다(예: 부분 목록으로 폐지 계산 금지).
   잘못 지우는 것보다 멈추고 재시도가 낫다.

---

## 1. 재처리·복구 메커니즘 한눈에

| 지점 | 트리거(무엇이 잘못됐을 때) | 어떻게 복구되나 | 상태 저장 위치 |
|---|---|---|---|
| **A. discover 부분목록** | 목록 페이징 중 429/5xx/타임아웃 | 페이지 백오프 재시도 → 그래도 실패면 **raise**(부분목록 반환 안 함) → Temporal 이 discover 재시도 | — |
| **B. 폐지 급감 게이트** | 목록이 이전 active 대비 <50% 로 급감 | **폐지 계산 보류**(로그) — 장애 의심분을 지우지 않음 | DB/manifest |
| **C. 수집 activity** | 워커·머신 크래시 | Temporal 이 워크플로 replay + activity 재시도(멱등: 버전행 통째 교체) | Temporal DB |
| **D. handoff self-heal** | emit 실패/크래시(수집됐는데 발송 못 함) | 다음 sync 가 `collected≠emitted` 를 다시 발송, sink 성공 후에만 `emitted` 마킹 | `document.emitted_signature` / manifest |
| **E. 원자적 package 쓰기** | 쓰다가 전원차단 | `.tmp`+fsync+rename → 최종명은 항상 완결본(반쯤 쓴 파일 소비 불가) | 파일시스템 |
| **F. 소비자 delete-after-upsert** | embed/upsert가 OOM·일시장애로 실패 | upsert **성공 후에만** 옛 청크 삭제 → 실패 시 옛 청크 살아 있어 그 법이 검색에서 안 사라짐 | Weaviate |
| **G. failed/ 자동 재시도** | Weaviate/전처리기 일시 다운 | transient 오류는 `failed/` 로 안 보내고 inbox 복귀 → 다음 sweep 재시도(MAX 후 격리) | `<pkg>.attempts` 사이드카 |
| **H. 소비자 파일 클레임** | 두 소비자 동시 실행 / 크래시 잔해 | 원자적 `.processing` rename 으로 1개만 잡음 + 시작 시 잔해 reclaim | 파일시스템 |
| **I. 외부 API 재시도** | 임베딩 서빙·DocParser 5xx/429/타임아웃 | 지수 백오프 재시도(4xx 는 결정적이라 즉시 중단) | — |
| **J. gitexport index.lock** | git 이 커밋 중 killed → lock 잔존 | add/commit 전 **오래된(>300s) lock 자동 제거** | 파일시스템 |

---

## 2. 지점별 상세

### A·B. discover — false-repeal 방지 (수집기)
- **문제**: 목록 API 페이징 중 한 페이지라도 못 받으면(스로틀 등) 예전엔 **부분목록으로 종료** →
  빠진 법들이 "목록에 없음 = 폐지"로 오판돼 대량 soft-delete → handoff delete → **VDB 에서 삭제**.
- **A**: `_fetch_all_laws`(law·admrul)가 페이지 실패 시 백오프 재시도 후, 그래도 실패면 **raise**.
  부분목록을 절대 정상 반환하지 않는다. discover 는 완전한 목록일 때만 성공한다.
- **B**: 그래도 뚫릴 경우 대비, `upsert_documents` 가 목록 급감(이전 active 대비 <50%)이면 폐지를
  **보류**한다(`repeal_skipped` + 경고 로그). 정상 폐지는 하루 몇 건이라 안 걸린다.

### C. 수집 activity 멱등
- `collect_and_store` 는 재시도해도 `store_versions` 가 버전행을 **통째 교체**(full_replace)라 중복/부분
  오염이 없다. DB 쓰기는 단일 트랜잭션(크래시 시 롤백 → 0버전 상태 안 생김).
- Temporal 워크플로는 durable — 워커만 다시 띄우면 이어받는다.

### D. handoff self-heal — `emitted_signature`
- 문서마다 지문 3개: `version_signature`(목록 최신) / `collected_signature`(수집완료) /
  **`emitted_signature`(발송성공)**.
- 규칙: `collected ≠ emitted` = "저장은 됐는데 아직 못 보낸 것" → 발송 대상.
  sink 전송이 성공하면 `emitted := collected`, **실패하면 안 올림 → 다음 sync 가 다시 발송**.
- 배치 스윕(`emit_changeset_package`)이 `store.list_unemitted` 를 직접 조회하므로, 지난 실패분·크래시로
  빠진 것까지 재발송된다. 스트리밍(수집 즉시 발송)은 빠른 길이고, 이 스윕이 안전망.
- 저장 위치: db/both = `document.emitted_signature` 컬럼 / git·manifest-only = `_manifest.json` 필드.
- 폐지 delete 는 발송 후 `emitted_signature="__repealed__"` 로 표시해 매 sync 재발송을 막는다.

### E. 원자적 package 쓰기
- `changeset.write_jsonl` = `<id>.jsonl.tmp` 에 전부 쓰고 `fsync`(전원차단 대비 디스크 확정) 후
  `os.replace` 로 최종명으로 rename. `*.jsonl` glob 은 항상 완결본만 본다.
- ⚠ 크로스머신 폴더 전달(rsync/NFS)도 **최종명 rename 방식**이어야 한다(spool/maildir 관행).

### F. 소비자 delete-after-upsert (임베딩기)
- **문제**: 예전엔 `delete_by_law_id` 로 옛 청크를 **먼저 지우고** 재적재 → embed/upsert 가 OOM·일시
  장애로 실패하면 옛 청크는 사라졌는데 새 청크는 안 들어가 **그 법이 검색에서 통째로 없어짐**.
- **수정**: 새 버전(새 `version_uid` → 새 UUID)을 **먼저 upsert** → 성공 후 `delete_stale_law_chunks`
  로 옛 version_uid 청크만 정리. upsert 실패면 옛 청크가 살아 있어 검색 유지 + package 는 `failed/`(G)
  로 재시도. 명시적 폐지(delete·내용 없음)만 전량 삭제.

### G·H. 소비자 self-heal — failed/ 자동 재시도 + 클레임
- **G(재시도)**: `consume_folder` 는 연결/서버/타임아웃/OOM 등 **transient** 오류를 `failed/` 로 보내지
  않고 원래 이름으로 되돌려 다음 sweep 이 재시도한다(`<pkg>.attempts` 로 횟수 추적, `_MAX_CONSUME_ATTEMPTS=5`
  초과 시 격리). **결정적**(파싱·source 미결정·계약 위반·footer 불일치)만 즉시 `failed/`.
  → 일시 outage 로 package 가 dead-letter 에 영구히 갇히지 않는다.
- **H(클레임)**: 소비 전에 `<pkg>.processing` 로 원자적 rename 해 잡는다 → 두 소비자가 같은 package 를
  동시에 집거나 이동(move)이 경합해 sweep 전체가 죽는 것을 막는다. 크래시로 남은 `.processing` 는
  다음 실행 시작에 원래 이름으로 되돌려(reclaim) 재소비.
- **dir 검증**: 없는/오타 폴더는 조용한 성공(0건)이 아니라 즉시 에러.
- **exit 코드**: 부분실패 시 CLI exit 2(모니터링이 "다 됨"과 "일부 failed/"를 구분).

### I. 외부 API 재시도
- **임베딩 서빙(RemoteEmbedder)**: 5xx/429/타임아웃/연결오류를 지수 백오프로 재시도. 응답 벡터 수 ≠
  입력 수면 **중단**(부분 응답으로 엉뚱한 벡터가 매칭되는 조용한 오염 방지). NaN/Inf/0 벡터는 적재 전 거부.
- **DocParser**: 5xx/429 는 재시도 대상(예전엔 영구실패로 오분류해 첨부/이미지 텍스트를 버렸음), 4xx 는
  결정적이라 즉시 중단. 재시도 간 백오프.

### J. gitexport index.lock
- git 이 커밋 중 killed/timeout 되면 `.git/index.lock` 이 남아 이후 모든 커밋이 영구 실패(stuck).
- add/commit 전에 **300초 넘은** index.lock 을 자동 제거(진짜 실행 중인 것은 age 가드로 보존).

---

## 3. 운영 노트

- **코드 바꾸면 워커 재시작** — Temporal 은 워커가 가진 코드로 실행. (수집기)
- **첫 sync 는 전량 발송** — 새 임베딩 타깃은 `emitted_signature=NULL` 이라 한 번은 전부 보낸다(정상).
- **failed/ 에 쌓인 것** — transient 재시도 소진 or 결정적 오류. `<pkg>.errors.json` 으로 원인 확인 후,
  고쳤으면 파일을 inbox 로 되돌리면 다시 소비된다(멱등).
- **튜닝 상수**: `_MAX_CONSUME_ATTEMPTS`(소비 재시도) · `_REPEAL_SANITY_FRACTION/FLOOR`(폐지 게이트) ·
  임베더/DocParser `max_retries` · gitexport index.lock `max_age_s`.
- **설정 충돌은 부팅 때 잡힌다** — `validate_handoff_config` 가 모순 조합(예: file_transfer 인데 stage
  디렉터리 없음)이면 워커를 아예 안 띄운다. `HANDOFF_ENABLED` 가 마스터 스위치.

## 4. 테스트로 고정한 계약
- 수집기(`temporal_law/tests/`): `test_discover_robustness`(부분목록 raise·폐지 게이트) ·
  `test_emit_durability`(self-heal·설정검증) · `test_gitexport_lock`(index.lock 해제).
- 임베딩기(`law_embedding/tests/`): `test_package`(upsert 실패 시 옛 청크 보존) ·
  `test_consume_folder`(transient 재시도·MAX 격리·reclaim·dir검증) · `test_robustness`(임베더 재시도·
  개수불일치·NaN/0 거부·DocParser 5xx) · `test_hardening`(cli exit·mapper 비정상원소 생존).
</content>
