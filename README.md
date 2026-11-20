# WeCollect

在 Windows x64 或 macOS（Intel 和 Apple Silicon）上搜索导出的 AI 工作记录、预览正文、复制周报素材。请从本仓库的 Releases 下载对应平台的试用包。文件夹选择功能需要桌面版 Chrome 或 Edge。

选择工具，填写项目，选取只存放该项目工作记录的文件夹。WeCollect 只读取该文件夹第一层的支持文件。每份文件上限为 1 MiB，超限会显示原因。WorkBuddy、Claude Code、Cursor、Codex 可读取本工具识别的会话 JSONL。以上工具以及豆包工作、千问工作都可以使用 Markdown 或 TXT 导出。

## 周报、任务交接与签到提醒

按文件修改时间筛选本周或上周（本地时间，周一开始），也可以搜索文件名或正文。勾选记录后可下载 Markdown 周报素材或任务交接单。文档按时间附上勾选记录的完整预览正文，成果、待办和交接目标留给成员填写。切换筛选会保留已勾选记录，导出范围以「共勾选」为准。请将导出的文档保存到同步文件夹之外，以免作为新的工作记录重复导入。

在「WorkBuddy 签到提醒」中选择时间，下载并导入 .ics 文件。系统日历负责按本地时间每天提醒，实际签到在 WorkBuddy 内完成。提醒能否弹出取决于日历客户端的通知设置。

## 同步到 WeManage

桌面启动器在本机预览。管理员安装接收端后，成员可以从启动器打开公司工作台，登录后重新选择项目和资料夹。同步默认关闭。成员确认后，窗口每 20 秒检查一次文件夹，将工具名、项目名、文件名和预览中的完整正文上传到公司 WeManage。勾选记录用于复制和导出。暂停同步或关闭窗口可停止后续上传。已归档的记录会保留，可在工作台查询。

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
