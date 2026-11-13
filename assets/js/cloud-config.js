/* ===========================================================
   cloud-config.js —— 同步配置
   -----------------------------------------------------------
   SYNC_MODE:
     'mqtt'  → 自动同步（公开 MQTT broker 中转，免账号）
     'cloud' → WorkBuddy 云（已停用，整站有 sharecode 门禁，换域名即 403）
     'local' → 纯本机，不联网
   -----------------------------------------------------------
   MQTT 方案说明：
   · 用公开 broker 的「保留消息」当存储：发布后 broker 长期保留，
     另一台设备连上来立刻就能收到最新一份。
   · 免账号、免服务器；电脑关机不影响，只要设备能上网。
   · 主题名 = zjxc/v2/<同步码>，同步码是随机 10 位，等于一把共享钥匙：
     知道码就能读写这一份数据。练习记录不含敏感信息，故不额外加密。
   · 载荷 gzip 压缩后 base64（实测压缩比约 1/6），控制在 broker 上限内。
   =========================================================== */
window.SYNC_MODE = 'mqtt';

/* 预置同步码：首次启动直接用它，省得在平板上手输 10 位码。
   留空字符串则每台设备各自生成。改这里或跑 tools/preset-code.js。 */
window.PRESET_SYNC_CODE = 'CXEC3NUNYV';

window.MQTT_SYNC = {
  brokers: [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ],
  topicPrefix: 'zjxc/v2/',
  /* 实测（2026-11-13，tools/probe_payload.js）：emqx 单条 1MB 可发布、1.5MB 超时；
     hivemq 4MB 仍可。留足余量取 400KB——30 条带逐题用时的记录 gzip 后约 60KB，
     以前卡在 78000 会导致超限时把历史裁到 8 条，用户旧记录凭空消失。 */
  maxPayload: 400000,
  pullInterval: 240000   // 每 4 分钟拉一次
};

/* 内容热更新：题目/解析的补丁走同一个 broker 的另一个主题（所有设备共用） */
window.CONTENT_SYNC = {
  topic: 'zjxc/content/v1',
  maxPayload: 78000
};

/* WorkBuddy 云：保留配置但关闭（enabled:false） */
window.CLOUD_CONFIG = {
  enabled: false,
  resourceId: 'wbcs_52hNPIGQitpp1MF2NYzDLP',
  endpoint: 'https://zhekao-xingce.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_GdjxnAvMXMALmZkZqWXRX0_XoJc6myjqOIUUW1yt81QvZSMt7F0e9hw'
};
