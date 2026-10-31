// 启用 Kazumi 桥接时，按规则文件自动生成 kazumi_* 源。
// 线上直接使用仓库里的 config.json，不再需要单独的本地配置副本。

export interface KazumiRule {
  key: string;
  name?: string;
}

export interface KazumiSite {
  key: string;
  api: string;
  name: string;
}

// 与适配服务的 /vod/<key> 路由及 isKazumiApi 的校验保持一致
const RULE_KEY_PATTERN = /^[a-z0-9_-]+$/;

export function buildKazumiSites(
  bridgeUrl: string,
  rules: KazumiRule[]
): Record<string, KazumiSite> {
  const base = bridgeUrl.replace(/\/$/, '');
  return Object.fromEntries(
    rules
      .filter((rule) => RULE_KEY_PATTERN.test(rule.key))
      .map((rule) => {
        const key = `kazumi_${rule.key}`;
        return [
          key,
          {
            key,
            api: `${base}/vod/${rule.key}`,
            name: `Kazumi · ${rule.name || rule.key}`,
          },
        ];
      })
  );
}
