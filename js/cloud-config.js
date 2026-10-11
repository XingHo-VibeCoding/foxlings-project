/* ============================================================
   cloud-config.js — 云服务配置（页面启动时的唯一配置来源）

   【这两个值是什么】
   由云服务激活结果（publicConfig）给出，**是公开标识，不是密钥**：

     endpoint        本应用发布域名下的数据入口（服务端按「精确匹配 Origin」放行）
     publishableKey  只表明「哪个应用发来的请求」，本身不带任何权限

   所以它们可以进源码 —— 浏览器里本来就看得见。真正的凭据（资源 id、
   服务商密钥、数据库连接串）只存在服务端，永远不会下发到这里。
   （对照 AGENTS.md 第五节：密钥、.env、数据库连接串不进代码 —— 这两个不属于密钥。）

   【2026-10-11 起：先读环境，再回落到文件里的默认值】
   本项目是静态站、没有构建步骤，所以「环境变量」的落点是页面里的 window.__ENV__：
     · 部署 / 临时切换环境 → 由 js/env.local.js（`node env-to-js.js` 生成，已被忽略）注入；
     · 什么都不做       → 用下面 DEFAULTS 里的默认值，也就是线上那一套。
   优先级：window.__ENV__.WB_ENDPOINT > window.__ENV__.WB_SITE_ORIGIN > DEFAULTS.endpoint
   （.env.example 里写明了哪些键可以来、哪些键**永远不该**来。）

   ⚠️ endpoint 必须与「发布域名」一致：换应用、换域名之后，这里要同步改（或走 .env），
      否则服务端会因为 Origin 不匹配而拒绝请求。
   ⚠️ 配置坏了不静默：认不出来的网址会**回退到默认值并把原因写进 console**，
      而不是让后面每一个请求都报一个看不懂的错。
   ============================================================ */

(function () {
  var DEFAULTS = {
    endpoint: "https://rumor-check-12000.app.workbuddy.host",
    publishableKey: "wbpk_0VXBJtQxVqDiyV4xUOto06_TVtL7kQsS90mV9wwi1xmp2TDovYZI53X",
  };

  var env = (typeof window !== "undefined" && window.__ENV__) || {};

  var rawEndpoint = String(env.WB_ENDPOINT || env.WB_SITE_ORIGIN || DEFAULTS.endpoint || "");
  // 去掉结尾斜杠：拼接口路径时不会出现 `//`（有些网关对双斜杠的匹配不一样）
  var endpoint = rawEndpoint.replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(endpoint)) {
    console.error(
      "[cloud-config] 配的网址不合法：" + JSON.stringify(rawEndpoint) +
        "。已回退到默认值 " + DEFAULTS.endpoint + "（来源：.env 的 WB_ENDPOINT 或 js/env.local.js）"
    );
    endpoint = DEFAULTS.endpoint;
  }

  var publishableKey = String(env.WB_PUBLISHABLE_KEY || DEFAULTS.publishableKey || "");
  if (!publishableKey) {
    console.error("[cloud-config] 缺少 WB_PUBLISHABLE_KEY，云端请求会被拒。请检查 .env 或 js/env.local.js。");
  }

  window.CLOUD_CONFIG = { endpoint: endpoint, publishableKey: publishableKey };
})();
