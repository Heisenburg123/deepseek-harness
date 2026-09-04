# dsh-final-response-presentation

[English](README.md) | 中文

这是一个可选的宿主平面边界，把一条已经完成的规范 assistant 回复投影成仅供显示的文本。只有某个精确的活跃 Agent 被启用后，服务才离开中性状态；它不拥有 Session 事件词汇、序列化器、模型历史输入、工具表面或持久化路径。

## 契约

`present(agent, events)` 接受一段已完成的事件切片，查找后接 completed `turn/end` 的最终纯文本 assistant message，再把分离且冻结的 candidate 交给已选 transformer。candidate 只包含 session／turn／message 身份、规范文本、终止原因和捕获的 epoch；不携带 Agent、Session、工具注册表、inbox、Context 或持久化句柄。

transformer 唯一可接受的结果是非空、受大小限制的文本。异常、超时、畸形输出、不适用、取消和过期 epoch 都返回中性决策。中性意味着 transport 原样交付规范回复；本服务绝不重新生成回复或重试工具。

`activate(agent, selection)` 在进程内 `WeakMap` 中保存 `OFF | ACTIVE(transformer, config, epoch)`。切换和禁用会推进 epoch、中止旧工作并清除显示 annotation 缓存。Agent context 拥有清理动作，因此 dispose 会移除状态且不产生持久记录。

## Transport 集成

base bundle 挂载一条中性的服务配置。API Proxy 保持禁用路径同步；对于已启用的 Agent，它会把候选 assistant chunk 缓冲到轮次终止，向本服务取得决策，再把可选的 `presentation` annotation 放在未修改的规范事件旁边发出。Web conversation assembler 抑制带标记的源 chunk，并渲染最终 annotation 文本。只要 Agent 仍在当前进程中，history 可以重建当前 annotation；重启后它不再存在。

Headless 先 flush 规范持久化，再在可用时选择 presented 文本写入 stdout。它的 Session 和后续模型历史仍只包含规范 assistant message。

## 安全边界

transformer 是同进程受信任应用代码，不是沙箱。窄 candidate 从显式接口中移除了环境 Runtime capability；输出校验、deadline、abort 和 epoch 检查则约束常见失败路径。应用策略负责判断 eligibility，并且对无法安全呈现的 artifact 或语义必须 fail closed。

DSH 可以机械保证阶段顺序、规范日志不被修改、输出类型限制、无法生成工具／控制结果、短暂状态隔离和中性回退。它不能证明任意自然语言改写保持等义；应用若要作此声明，仍需自己的 semantic envelope、guard 和 adversarial eval。

## 模型体验

### 仅显示投影

#### 模型看到什么

模型看不到本包的任何内容。presentation 在模型与工具完成后运行；无论 presentation 关闭还是启用，`deriveMessages()` 返回的 prompt 历史和规范 assistant message 都相同。

#### Token 影响

模型输入与输出 token 都为零。transform callback 是应用代码，不是第二次模型请求。

#### KV Cache effect

无。presentation 位于每次模型请求的下游，不改变 cache key 或模型可见前缀。

## 已知限制与暂缓事项

- **启用 presentation 后按完成态缓冲。** 候选回复不会展示原始 token streaming；V1 不实现变换后流式输出。
- **V1 只呈现纯文本。** mixed content、tool-call message、tool result 以及未完成／中止轮次全部 bypass。
- **Annotation 属于活跃进程状态。** resume 和 restart 从中性或新的应用组装开始，不重建旧显示文本。
- **分类由应用拥有。** 通用服务不推断报告、代码、schema 或产品专属 artifact 语义。
