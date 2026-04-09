/**
 * 送交模型的正文长度预算：避免单次请求过大导致失败或费用过高。
 * 使用 UTF-16 码元长度（与 String.length 一致），与预览页的「字符」统计口径一致。
 */

/** 需求 + 测试合并后的单次评审输入上限（字符） */
export const MAX_COMBINED_REVIEW_CHARS = 100_000;

export interface PreparedReviewTexts {
  requirementText: string | null;
  testText: string | null;
  /** 截断时供界面展示的说明 */
  warnings: string[];
}

/**
 * 在合并长度超过上限时按比例截断两侧正文，并生成可读警告文案。
 */
export function prepareTextsForModel(
  requirement: string | null,
  test: string | null,
): PreparedReviewTexts {
  const r = requirement != null && requirement.length > 0 ? requirement : null;
  const t = test != null && test.length > 0 ? test : null;

  if (!r && !t) {
    return { requirementText: null, testText: null, warnings: [] };
  }

  if (!r && t) {
    if (t.length <= MAX_COMBINED_REVIEW_CHARS) {
      return { requirementText: null, testText: t, warnings: [] };
    }
    const cut = t.slice(0, MAX_COMBINED_REVIEW_CHARS);
    return {
      requirementText: null,
      testText: cut,
      warnings: [
        `测试文档过长（约 ${t.length.toLocaleString()} 字），已截断至前 ${MAX_COMBINED_REVIEW_CHARS.toLocaleString()} 字再送交模型。`,
      ],
    };
  }

  if (r && !t) {
    if (r.length <= MAX_COMBINED_REVIEW_CHARS) {
      return { requirementText: r, testText: null, warnings: [] };
    }
    const cut = r.slice(0, MAX_COMBINED_REVIEW_CHARS);
    return {
      requirementText: cut,
      testText: null,
      warnings: [
        `需求文档过长（约 ${r.length.toLocaleString()} 字），已截断至前 ${MAX_COMBINED_REVIEW_CHARS.toLocaleString()} 字再送交模型。`,
      ],
    };
  }

  const rLen = r!.length;
  const tLen = t!.length;
  const total = rLen + tLen;
  if (total <= MAX_COMBINED_REVIEW_CHARS) {
    return { requirementText: r, testText: t, warnings: [] };
  }

  const max = MAX_COMBINED_REVIEW_CHARS;
  let rShare = Math.floor((max * rLen) / total);
  let tShare = max - rShare;
  // 极端比例下 floor 可能使一侧份额为 0，但两侧均有正文时非空侧至少保留 1 字（在总额度允许时）
  if (rLen > 0 && rShare === 0) {
    rShare = Math.min(1, rLen);
    tShare = max - rShare;
  }
  if (tLen > 0 && tShare === 0) {
    tShare = Math.min(1, tLen);
    rShare = max - tShare;
  }
  const rOut = r!.slice(0, Math.min(rLen, rShare));
  const tOut = t!.slice(0, Math.min(tLen, tShare));

  return {
    requirementText: rOut,
    testText: tOut,
    warnings: [
      `需求与测试合计约 ${total.toLocaleString()} 字，超过单次建议上限（约 ${max.toLocaleString()} 字），已按比例截断后送交模型（需求保留前 ${rOut.length.toLocaleString()} 字，测试保留前 ${tOut.length.toLocaleString()} 字）。`,
    ],
  };
}
