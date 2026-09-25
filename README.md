# 跨境吴老师 亚马逊 FBA 备货 Skill

本 Skill 分两阶段完成亚马逊 FBA 备货：先创建或更新本周在线参数表，供运营填写；再读取本周参数、重新拉取 LingXing MCP 数据，生成单文件离线 HTML 备货 BI 看板。

仓库：[kuajing-wulaoshi-amazon-fba-replenishment-skill](https://github.com/defway888-design/kuajing-wulaoshi-amazon-fba-replenishment-skill)。当前为公开仓库，安装时无需提交 GitHub 用户名或接受私有仓库邀请。

## 首次安装

1. 在 Codex 中发出安装指令：`请从 https://github.com/defway888-design/kuajing-wulaoshi-amazon-fba-replenishment-skill 安装跨境吴老师 亚马逊 FBA 备货 Skill。`
2. 按 Codex 提示完成安装；若客户端要求 GitHub 授权，按客户端流程操作，不要在聊天中发送密码或访问令牌。
3. 安装完成后，关闭并重新打开 Codex，使 Skill 生效。
4. 在实际运行业务前，在**自己的运行环境**配置可用的 LingXing MCP 和可读写的在线表格连接。首次运行第一阶段时，提供一个完全空白、可编辑的在线表格直接链接；成功绑定后，独立再次运行会复用当前用户的绑定。

## 使用方式

- 输入“使用跨境吴老师亚马逊 FBA 备货 Skill，生成／更新本周参数表”：只运行第一阶段，得到在线表格链接及本期待填提示。运营填写黄色单元格；字段名带 `*` 的项目必填。
- 运营填完后，另行输入“使用跨境吴老师亚马逊 FBA 备货 Skill，生成本周备货 BI 看板”：运行第二阶段，重新核验在线参数并拉取最新 Listing、FBA 库存及 30／14／7 天销量。全部通过才交付一个可下载的单文件离线 HTML 看板。
- 输入“查看绑定”“更换绑定”或“解绑文档”可管理当前用户的在线文档绑定。每次运行仍须先通过 LingXing MCP 启动检查。

第一阶段不会自动触发第二阶段；第二阶段不把库存、销量、建议补货量或动作结果写回在线表格。核心数据缺失、匹配不确定或模板校验失败时停止，不用模拟值替代正式结果。

## 仓库文件

- [`SKILL.md`](SKILL.md)：Skill 入口、两阶段路由与跨境吴老师品牌执行提示。
- [`references/fba-two-stage-rules.md`](references/fba-two-stage-rules.md)：完整固定业务规则、在线四表契约、计算口径与 HTML V6 看板要求。
- [`agents/openai.yaml`](agents/openai.yaml)：Codex 显示名称与默认启动提示。
- [`template_manifest.json`](template_manifest.json)：品牌、所有权和模板版本标识。

本仓库不包含 LingXing 登录信息、在线表格绑定、运营真实数据或生成的正式看板。请勿将凭证、访问令牌或客户数据提交到此公开仓库。
