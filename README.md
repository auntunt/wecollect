# WeCollect

打开 Windows x64 或 macOS（Intel / Apple Silicon）桌面端，WeCollect 会列出当前用户已有本地会话的工具和工作区。选择一个工作区即可读取对话、搜索正文或整理周报。窗口每 20 秒检查该工作区的新增和更新会话。切换到「选择工作区」可停止读取并清空当前预览。

| 产品 | 自动发现范围 |
|---|---|
| Claude Code | `~/.claude/projects/<项目>/<会话>.jsonl`，也支持绝对路径的 `CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex/sessions/年/月/日/rollout-*.jsonl`，也支持绝对路径的 `CODEX_HOME`。按会话元数据中的工作目录分组，跳过标记为 aiseat 的网关会话 |
| Cursor Agent | `~/.cursor/projects/<项目>/agent-transcripts/` 下直接保存或按会话 ID 分层的 JSONL |
| WorkBuddy | `~/.workbuddy/projects/<项目>/<会话>.jsonl` |
| 豆包工作、千问工作 | 保留 Markdown / TXT 资料夹导入，原生会话自动发现尚未适配 |

Windows 的 `~` 指当前用户配置目录。自动发现覆盖以上本地布局，Cursor 仅存在于 SQLite、CLI 独立聊天库或云端的会话尚未适配。只读取主会话中的提问和回复。工具载荷、思考块、子代理文件不会进入正文。本机可以读取大于 1 MiB 的原生文件；完整提取的正文超过公司接口的 1 MiB 上限时，会显示未同步数量并保留本机预览。

资料夹导入保留在「其他来源」中，适用于已有导出和其他工具。该入口通过桌面版 Chrome 或 Edge 读取所选目录第一层的支持文件，每份上限 1 MiB。可从本仓库 Releases 下载试用包。

## 周报、任务交接与签到提醒

按文件修改时间筛选本周或上周（本地时间，周一开始），也可以搜索文件名或正文。勾选记录后可下载 Markdown 周报素材或任务交接单。文档按时间附上勾选记录的完整预览正文，成果、待办和交接目标留给成员填写。切换筛选会保留已勾选记录，导出范围以「共勾选」为准。请将导出的文档保存到同步文件夹之外，以免作为新的工作记录重复导入。

在「WorkBuddy 签到提醒」中选择时间，下载并导入 .ics 文件。系统日历负责按本地时间每天提醒，实际签到在 WorkBuddy 内完成。提醒能否弹出取决于日历客户端的通知设置。

## 同步到 WeManage

选择本机工作区后，填写归档项目名，点击「连接公司工作台」。公司窗口会显示登录成员、工作区和接收项目。成员确认后，在两个窗口保持打开期间，所选工作区当前和后续会话的提问、回复、工具名、会话标题和项目名会提交给 WeManage。接收端返回回执，桌面端核对正文哈希。勾选和搜索仅作用于个人整理，上传范围以公司确认窗口为准。关闭窗口、断开同步或切换工作区会停止后续同步。同步默认关闭。

此流程要求公司工作台与桌面端均使用 Beta 3 或兼容版本，并已部署接收端。接收账号和 CSRF 令牌只在已登录的公司窗口中使用。公司工作台原有的资料夹同步入口继续可用。

## 构建试用包

在安装 Go 1.26 和 Xcode 命令行工具的 macOS 上运行：

```sh
./packaging/build-macos.sh
(cd dist && shasum -a 256 -c SHA256SUMS)
```

输出包括通用 macOS 应用 ZIP、Windows x64 EXE 和 SHA-256 清单。macOS 试用包采用本机临时签名，未经过 Apple 公证。Windows 试用包未签名。

## WeManage 接收端

配套补丁适用于 ai-seat-gateway 提交 `aa8457d207a67dd6db45fd2c99cdcce9bed28bbd`。在该版本的干净网关检出中，把下面的路径换成本仓库实际位置并运行：

```sh
wecollect_dir=/absolute/path/to/wecollect
git apply --check "$wecollect_dir/integration/wemanage/receiver.patch"
git apply "$wecollect_dir/integration/wemanage/receiver.patch"
cp -R "$wecollect_dir/internal/wecollectui" internal/
go build -o /tmp/wecollect-wemanage ./cmd/wemanage
```

补丁添加成员归档接口和数据库表，并将同一套界面挂载到 WeManage 下的 `/wecollect/`。上线需另外部署 WeManage。
