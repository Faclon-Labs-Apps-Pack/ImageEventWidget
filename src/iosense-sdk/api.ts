import { BindingEntry, SeriesPayload, SeriesMeta, SeriesSlot } from './types';

const STAGING_BASE = 'https://appserver.iosense.io/api';
const GRAPH = 'iosense_test_uns';

function isRawSeriesItem(item: Record<string, unknown>): boolean {
  return Array.isArray(item.slots);
}

export async function validateSSOToken(ssoToken: string): Promise<string> {
  const res = await fetch(`${STAGING_BASE}/account/validateSSO`, {
    method: 'GET',
    headers: { token: ssoToken },
  });
  const json = await res.json();
  if (!json.success || !json.token) throw new Error('SSO validation failed');
  return json.token;
}

export async function resolveAndCompute(
  authentication: string,
  config: Array<BindingEntry>,
  startTime: number,
  endTime: number,
): Promise<Array<{ key: string; value: string | number | null | SeriesPayload }>> {
  const res = await fetch(`${STAGING_BASE}/account/uns/resolveAndCompute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authentication}`,
    },
    body: JSON.stringify({ graph: GRAPH, config, startTime, endTime }),
  });
  const json = await res.json();
  const rawItems: Record<string, unknown>[] = json?.data ?? [];
  return rawItems.map((item) => {
    if (isRawSeriesItem(item)) {
      return {
        key: item.key as string,
        value: {
          __type: 'series' as const,
          path: item.path as string,
          meta: item.meta as SeriesMeta,
          range: item.range as { from: number; to: number },
          slots: item.slots as SeriesSlot[],
        } satisfies SeriesPayload,
      };
    }
    return { key: item.key as string, value: item.value as string | number | null };
  });
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'application/json': 'json',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return map[mimeType] ?? 'jpg';
}

export async function getS3SignedUrl(
  authentication: string,
  file: File,
): Promise<{ signedUrl: string; publicUrl: string }> {
  const ext = mimeToExt(file.type);
  const filename = `IoLens-${Date.now()}.${ext}`;
  const res = await fetch(`${STAGING_BASE}/account/s3/signedUrl`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authentication}`,
    },
    body: JSON.stringify({ folderName: 'IOLens', filename, contentType: file.type }),
  });
  const json = await res.json();
  if (!json.success) throw new Error('Failed to get S3 signed URL');
  const signedUrl = json.data as string;
  const publicUrl = signedUrl.split('?')[0];
  return { signedUrl, publicUrl };
}

export async function uploadFileToS3(signedUrl: string, file: File): Promise<void> {
  await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
}

export async function uploadImageToS3(authentication: string, file: File): Promise<string> {
  const { signedUrl, publicUrl } = await getS3SignedUrl(authentication, file);
  await uploadFileToS3(signedUrl, file);
  return publicUrl;
}

export async function fetchUNSNodes(
  authentication: string,
  graph: string,
  label?: string,
  limit = 100,
  expandPostfix = false,
): Promise<Array<{ id: string; type: string; name?: string; path: string | null; parentId: string | null }>> {
  const params = new URLSearchParams({ graph, limit: String(limit) });
  if (label) params.set('label', label);
  if (expandPostfix) params.set('expandPostfix', 'true');
  const res = await fetch(`${STAGING_BASE}/account/uns/nodes?${params}`, {
    headers: { Authorization: `Bearer ${authentication}` },
  });
  const json = await res.json();
  return (json?.data?.data ?? []) as Array<{
    id: string; type: string; name?: string; path: string | null; parentId: string | null;
  }>;
}
