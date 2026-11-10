# dsh-session-delete 安装说明（中文）

给 DSH Web UI 的会话“…”菜单增加最后一行红色的 **删除会话**：确认后永久删除该会话（会话日志目录、磁盘文件），并把这一行从列表中移除。

## 适用环境

- DSH ≥ 0.2.1（在 0.2.1-rc.5 上测试通过），Node.js ≥ 20。
- 本机、Docker 部署都可以：插件装在 DSH profile 里，客户端通过 `api/session-delete`（相对地址）访问 Host，不需要额外配置端口或反向代理。
- 不需要额外依赖，tarball 可以离线安装。

## 安装步骤

插件源码与发布页：<https://github.com/ban-sky/dsh-session-delete>

1. 把 `dsh-session-delete-1.0.0.tgz` 拷贝到目标设备上一个**固定位置**，例如：

   ```
   /data/dsh/plugins/dsh-session-delete-1.0.0.tgz
   ```

   也可以直接下载：

   ```
   https://github.com/ban-sky/dsh-session-delete/raw/main/dist/dsh-session-delete-1.0.0.tgz
   ```

   并用同目录下的 `.sha256` 文件校验。

   > 该文件需要保留：profile 会记录对它的 `file:` 依赖，以后在 profile 里重装依赖还会用到它。放在挂载出来的 DSH 数据目录里最稳妥。

2. 在目标设备上安装（二选一）：

   ```bash
   dsh plugin --profile web add /data/dsh/plugins/dsh-session-delete-1.0.0.tgz
   ```

   或者在该设备的 DSH agent 里执行：

   ```
   plugin_manager action=install_bundle target=/data/dsh/plugins/dsh-session-delete-1.0.0.tgz
   ```

   安装结果里出现 `application: "restart-required"` 是正常的。

3. 重启一次 DSH Web 进程，然后刷新页面。会话“…”菜单的最后一行就是红色的 **删除会话**。

## 从 GitHub 仓库安装（clone 方式）

```bash
git clone https://github.com/ban-sky/dsh-session-delete /data/dsh/plugins/dsh-session-delete
dsh plugin --profile web add /data/dsh/plugins/dsh-session-delete
```

这种安装记录的是 `link:` 依赖，以后在该目录里 `git pull` 再重启 DSH 即可升级。

## 如果是升级

profile 里已经装了旧版时，直接安装会报 `already-installed`。先移除再安装：

```bash
dsh plugin --profile web remove dsh-session-delete
dsh plugin --profile web add /data/dsh/plugins/dsh-session-delete-1.0.0.tgz
```

或在 agent 中：

```
plugin_manager action=remove_bundle target=dsh-session-delete
plugin_manager action=install_bundle target=/data/dsh/plugins/dsh-session-delete-1.0.0.tgz
```

## 卸载

```bash
dsh plugin --profile web remove dsh-session-delete
```

## 验证安装成功

- `plugin_manager action=list_plugins` 里能看到 `include:session-delete`，状态 `active`。
- 会话菜单最后一行是红色“删除会话”。
- 确认框点击删除后，会话从列表消失；对应目录（`<持久化根>/<项目>/<会话ID>`）也被删除。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 点了删除提示“无法连接 Host” | 页面还在跑旧客户端包，或装完没重启 DSH。重启 DSH 后强制刷新页面。 |
| 菜单里没有这一行 | `include:session-delete` 不是 active，或浏览器控制台里 client bundle 加载失败。 |
| 安装时报 `already-installed` | 已装过旧版，按上面的“升级”先 remove 再 add。 |
| 提示“登录状态已失效” | 浏览器登录 cookie 过期，重新打开 DSH 地址再试。 |
| 提示“会话仍在运行” | 3 秒内没停下来，先手动停止该会话再删除。 |
| 提示“磁盘文件删除失败” | 会话已归档隐藏，但目录删不掉（权限/只读卷）。到持久化根目录下手动删除对应会话目录。 |
