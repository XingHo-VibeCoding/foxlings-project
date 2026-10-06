/* ============================================================
   cloud-config.js — 云服务公开配置（Day 20 接入后端时写入）

   这两个值由云服务激活结果（publicConfig）给出，**是公开标识，不是密钥**：

     endpoint        本应用发布域名下的数据入口（服务端按「精确匹配 Origin」放行）
     publishableKey  只表明「哪个应用发来的请求」，本身不带任何权限

   所以它们可以进源码 —— 浏览器里本来就看得见。真正的凭据（资源 id、
   服务商密钥）只存在服务端，永远不会下发到这里。
   （对照 AGENTS.md 第五节：密钥、.env、数据库连接串不进代码 —— 这两个不属于密钥。）

   ⚠️ endpoint 必须与「发布域名」一致：换应用、换域名之后，这里要同步改，
      否则服务端会因为 Origin 不匹配而拒绝请求。
   ============================================================ */

window.CLOUD_CONFIG = {
  endpoint: "https://rumor-check-12000.app.workbuddy.host",
  publishableKey: "wbpk_0VXBJtQxVqDiyV4xUOto06_TVtL7kQsS90mV9wwi1xmp2TDovYZI53X",
};
