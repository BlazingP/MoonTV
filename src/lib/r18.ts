// R18 内容开关：仅保存在当前浏览器，默认关闭。
// 视频源名称含 "R18" 或 🔞 时视为成人源，开关关闭时不参与搜索。

export const R18_STORAGE_KEY = 'showR18';

const R18_SOURCE_PATTERN = /r18|🔞/i;

export function isR18Source(name: string): boolean {
  return R18_SOURCE_PATTERN.test(name);
}

export function readShowR18(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(R18_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeShowR18(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(R18_STORAGE_KEY, String(value));
  } catch {
    // 隐私模式等场景下写入失败，忽略即可
  }
}

// 供拼接到 /api/search 请求地址后使用
export function r18Query(): string {
  return readShowR18() ? '&r18=1' : '';
}
