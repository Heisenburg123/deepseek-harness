# Agent Note: final response presentation boundary

Status: implemented

[English](2026-09-02-final-response-presentation-boundary.md) | 中文

## Problem

规范 assistant message 同时承担三项职责：持久 Session truth、后续模型历史和面向用户的输出。需要在推理后改变表达的应用若重写这条 message，就会同时改变历史；而观察 `session/event` 已来不及阻止 Web 展示原始 chunk。system-prompt persona 发生在推理之前，transport 专属 wrapper 又无法为 Web 与 Headless 建立同一条不变量。

## Decision

宿主平面提供可选的 `@deepseek-ai/dsh-final-response-presentation` 服务。它在终止 `turn/end` 后提取一条已完成的纯文本 assistant candidate，分离并冻结窄数据，再调用 Agent-scoped transformer。transformer 只能返回文本。状态为带 epoch、abort controller、JSON config 和短暂 annotation 的 `WeakMap<Agent, RuntimeState>`；switch、disable 和 Agent dispose 都会中止旧工作并清除 annotation。

Session 日志保持规范且不增加事件类型。API Proxy 的未启用路径仍然直接发送；启用路径把候选 assistant 事件缓冲到完成态，再在未修改的 wire event 旁发出可选 `presentation` annotation。Web 抑制带标记的源 chunk，并显示最终 annotation 文本。Headless 在选择 presented stdout 之前先 flush 持久化。异常、超时、畸形输出、不适用和过期 epoch 全部回退到规范交付。

## Guarantee boundary

服务机械拥有阶段顺序、规范内容不变、仅纯文本准入、没有工具／控制输出权限、进程内隔离和中性回退。callback 尽管显式输入很窄，仍然是同进程受信任代码。DSH 不声称能够证明任意自然语言改写语义等价；应用负责自己的 semantic envelope、eligibility policy 和 eval。

## Alternatives considered

**在持久化前重写 `assistant/message`。** 拒绝，因为改写后的表达会成为模型历史和持久 truth，让规范语义与显示再次合并。

**增加持久 presentation Session event。** 拒绝，因为显示状态必须在重启后消失，也不能仅因用户看见过就自动成为模型、持久化、transcript 或 evidence 输入。

**在 Web 与 Headless 中各自变换。** 拒绝，因为这会复制策略、允许 transport 漂移，并且仍无法解决 Web 原始 chunk 泄漏。

**流式输出变换后的 token。** 暂缓，因为原始 token 抵达时尚不存在最终语义结果。V1 只在 Agent 显式启用时，以首 token 显示延迟换取严格的完成后边界。

## Consequences

禁用状态的 profile 保留现有交付和 streaming。启用的纯文本回复需要轮次大小的缓冲和一次有界 transform，随后在不改变 Session 字节或后续模型请求的前提下显示。tool-call、mixed、未完成和应用判定不适用的输出全部 bypass。只要 Agent 仍存活，live history 可以携带当前 annotation；restart／resume 不重建 presentation state。应用可以在自身 guard 内安全增加表达，但不能只凭这一原语就声称自然语言语义不变。
