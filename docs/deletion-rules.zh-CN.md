# 删除规则与目录说明

本文档说明 `dsh-session-delete` 在 Host 端真正删除一个会话时执行的规则，方便审查“它删除什么、不删除什么”。

## 删除规则（Host 端，按执行顺序）

入口只有一个：`POST /api/session-delete`，JSON body `{"sessionId": "..."}`。
会话在 UI 里的操作流程是：菜单最后一行“删除会话” → 确认框 → 归档 → 删盘 → 刷新列表。

1. **参数校验**：`sessionId` 必须是 1–200 字符的非空字符串，否则返回 `bad-request`，不碰任何数据。
2. **先归档（安全网）**：调用 `workspaceRegistry.archiveSession(id, { stopActivity: true })`。
   - 取消正在生成的回答；
   - 立即从会话列表隐藏并清空当前选中；
   - 已归档的会话这一步直接成功。
3. **等待 Agent 停止**：每 100ms 检查一次，最多 3 秒。
   - 3 秒后仍在运行 → 返回 `busy`，**不删任何文件**（避免删完又被写回）。
   - 请求被取消 → 返回 `cancelled`。
4. **确认会话存在**：`persistence.stat(id)`。
   - 查不到 → 返回 `{deleted:false, reason:"not-found"}`（幂等，不报错）。
5. **定位日志文件**：
   - 有 `persistence.findLog(id)` 时用后端精确查找（会扫描 project 目录，处理多版本日志）；
   - 没写过盘的 pending 会话回退到 `persistence.locate(header).path`；
   - 取 `dirname(logPath)` 作为会话目录。
6. **路径校验（核心安全规则）**：`isOwnedSessionDirectory(root, dir)`
   - `dir` 相对 `persistence.root` 必须**正好 2 段**：`<project>/<session-id>`；
   - 每段非空，且不能是 `.` 或 `..`；
   - 不能是 root 本身、不能绝对路径、不能越界；
   - 不满足 → 返回 `refused`，**不动磁盘**。
7. **收尾**：关闭该会话的写句柄（先写完缓冲区并释放锁）→ 清 `tracker.pending` → 从 live registry `detachEntered`（列表立刻不再返回它）。
8. **删除**：只对第 6 步通过的目录执行 `rm(dir, { recursive: true, force: true, maxRetries: 2 })`。
9. **返回**：成功 `{ok:true, value:{deleted:true}}`；失败带错误码
   `bad-request | busy | refused | delete-failed | cancelled`。

## 指定的目录

- 持久化根：`$DSH_HOME/sessions`（本机为 `/data/dsh/sessions`）。
  运行时取自 `persistence.root`，**不是写死的**。
  来源：`dsh-base/cordis.patch.yml` 中 `session-persistence-jsonl` 的 `root: !!js dshHomePath('sessions')`。
- 实际被删的目录：`<root>/<项目目录>/<session-id>/`
  例：`/data/dsh/sessions/--workspace--/session-b6bc4b3c-2eda-427e-be43-72e7c3fd7d92/`
- 该目录内通常只有会话自己的文件：
  - `session.jsonl.zstd`（或 `session.vN.jsonl.zstd`）
  - `session.lock`
  整个目录随会话一起删除。
- **不会删**：
  - 根目录 `$DSH_HOME/sessions` 本身；
  - 项目目录（可能因此变成空目录，但不会删）；
  - 其他会话目录；
  - 会话工作目录（cwd）里的任何项目文件；
  - workspace 本身（workspace 的删除是 DSH 自带功能）。
- 如果持久化后端不是 JSONL（没有 `root` / `locate`），路径校验会失败并返回 `refused`，不会盲删。

## 代码位置

文件：`index.js`

| 行 | 内容 |
| --- | --- |
| 29 | `SETTLE_LIMIT_MS = 3000`（等待 Agent 停止的上限） |
| 73 | `deleteSession()` 主流程 |
| 91 | 归档安全网 `archiveSession(..., {stopActivity:true})` |
| 98–110 | 等待 Agent 停止；仍在运行则 `busy` |
| 114 | `persistence.stat(sessionId)` |
| 120–126 | `findLog` 精确路径，`locate` 兜底 |
| 129 | 路径校验 `isOwnedSessionDirectory` |
| 137–143 | 关闭写句柄 |
| 151 | 从 live registry detach |
| 158 | `rm(dir, {recursive:true, force:true, maxRetries:2})` |
| 171 | `isOwnedSessionDirectory()` 实现 |
