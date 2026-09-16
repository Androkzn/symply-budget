/**
 * Safe, redacted HTTP response summaries for E2E console lines — no bodies, tokens, or PII.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function pushUnique(parts: string[], fragment: string): void {
  if (!parts.includes(fragment)) parts.push(fragment);
}

/** Summarize axios / fetch JSON for `[E2E-NET] … detail=…` suffix. */
export function summarizeHttpResponseBody(
  data: unknown,
  options?: { isError?: boolean },
): string | undefined {
  const parts: string[] = [];

  if (options?.isError && isRecord(data)) {
    const nestedError = isRecord(data.error) ? data.error : undefined;
    const code =
      (typeof data.code === 'string' && data.code) ||
      (typeof data.error_code === 'string' && data.error_code) ||
      (nestedError && typeof nestedError.code === 'string' ? nestedError.code : undefined);
    if (code) pushUnique(parts, `errorCode=${code}`);
    return parts.length > 0 ? parts.join(' ') : 'error';
  }

  let payload = data;
  if (isRecord(data) && 'data' in data && data.data !== undefined) {
    payload = data.data;
  }

  if (Array.isArray(payload)) {
    pushUnique(parts, `count=${payload.length}`);
  } else if (isRecord(payload)) {
    if (typeof payload.id === 'string') pushUnique(parts, 'hasId');
    if (typeof payload.image_key === 'string') pushUnique(parts, 'hasImageKey');
    if (typeof payload.photo_key === 'string') pushUnique(parts, 'hasPhotoKey');
    if (typeof payload.report_id === 'string') pushUnique(parts, 'hasReportId');
    if (typeof payload.floor_plan_id === 'string') pushUnique(parts, 'hasFloorPlanId');
    if (typeof payload.success === 'boolean') pushUnique(parts, `success=${payload.success}`);
    for (const [key, value] of Object.entries(payload)) {
      if (Array.isArray(value) && key.length <= 24) {
        pushUnique(parts, `${key}=${value.length}`);
        break;
      }
    }
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}

/** Summarize Language fetch JSON (unwrapped body). */
export function summarizeLanguageResponseBody(parsed: unknown, isError: boolean): string | undefined {
  return summarizeHttpResponseBody(parsed, { isError });
}
