const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export interface VersionMeta {
  version_uid: string;
  enforcement_date: string | null;
  promulgation_date: string | null;
  revision_type: string | null;
  is_current: boolean;
  is_future: boolean;
}

export interface RelationImage {
  url: string;
  type: string;
}

export interface Relation {
  relation_type: string;
  target_category?: string;
  target_law_name?: string;
  target_article_no?: string;
  target_article_title?: string;
  reference_id?: string;
  target_url?: string;
  link_text?: string;
  resolve_method?: string;
  /** reference_id/target_law_name으로 서버가 계산한 레포 내 파일 경로(클릭 이동용). 계산 불가 시 null. */
  resolved_path?: string | null;
  /** relation_type이 appendix_ref(별표/별지)일 때만 채워지는 첨부파일 정보. */
  appendix_kind?: string;
  appendix_no?: string;
  download_filename?: string;
  download_url?: string;
}

export interface ProvisionGroup {
  content: string;
  article_no: string;
  article_title: string;
  chapter: string;
  relations: Relation[];
  images: RelationImage[];
  first_enforcement_date: string | null;
  last_enforcement_date: string | null;
  versions: VersionMeta[];
}

export interface DocMeta {
  name: string;
  doc_target: string;
  doc_type: string;
  doc_domain: string;
  is_active: boolean;
  mst: string;
}

export interface ProvisionResponse {
  provision_id: string;
  path: string;
  doc: DocMeta;
  groups: ProvisionGroup[];
}

export class ProvisionNotFoundError extends Error {}

export async function fetchProvision(provisionId: string, path: string): Promise<ProvisionResponse> {
  const qs = new URLSearchParams({ provision_id: provisionId, path });
  const res = await fetch(`${API_BASE}/api/provisions?${qs.toString()}`);
  if (res.status === 404) {
    throw new ProvisionNotFoundError(`provision_id를 찾을 수 없습니다: ${provisionId}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `요청 실패 (${res.status})`);
  }
  return res.json();
}
