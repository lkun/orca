# 同步上游（stablyai/orca → lkun/orca）

触发语：`同步最新分支`、`同步上游`、`sync upstream`。

执行者：按本文件步骤自动执行，不要临时改用 `git merge upstream/main`。

## 前置

```bash
cd /Users/lvkun/occ
git status --porcelain -uno     # 必须为空
git remote -v                   # origin=lkfun/orca, upstream=stablyai/orca
```

- `origin`：可写 fork `https://github.com/lkun/orca.git`
- `upstream`：只读上游 `https://github.com/stablyai/orca.git`
- 代理：git 已配置 `http.proxy=http://127.0.0.1:7897`；代理挂了下换可用端口

## 自动步骤

1. 切到主分支并更新

```bash
git checkout rebrand/occ-full
git pull --ff-only
```

2. 取上游

```bash
git fetch upstream --tags
UPSTREAM_SHA=$(git rev-parse --short upstream/main)
UPSTREAM_VERSION=$(git show upstream/main:package.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version")
```

3. 决定 OCC revision

读 `VERSION` 第一行：

- 上游版本变了 → `OCC_REV=1`
- 上游版本没变（只多了提交）→ 上一次 `occ.N` 加 1

4. 生成同步分支

```bash
OCC_REV=<n> scripts/occ-sync.sh
```

产物：

- 分支 `sync/upstream-<version>-occ.<n>`
- 父提交 = 当前 `rebrand/occ-full`
- `VERSION` 已写入 `<upstream-version>-occ.<n>`
- 插件树哈希已刷新

5. 验证

```bash
git checkout sync/upstream-<version>-occ.<n>

export PATH="$HOME/.local/node24/bin:$PATH"
pnpm install
pnpm -C mobile install
pnpm tc
pnpm build:unpack
```

`pnpm install` 会更新两个 lockfile。必须把改动合并进同步提交：

```bash
git add pnpm-lock.yaml mobile/pnpm-lock.yaml
git commit --amend --no-edit
```

6. 推送 + 开 PR

```bash
git push -u origin "$(git branch --show-current)"

gh pr create \
  --repo lkun/orca \
  --base rebrand/occ-full \
  --head "$(git branch --show-current)" \
  --title "sync upstream ${UPSTREAM_SHA} as ${UPSTREAM_VERSION}-occ.<n>" \
  --body "Regenerated from upstream ${UPSTREAM_SHA} with scripts/occ-rebrand/apply.mjs. Verified: pnpm tc, pnpm build:unpack."
```

7. 回报

输出：上游 SHA、版本号、分支、PR 链接、typecheck/build 结果。

**到此停止。** 合并 PR 和打 tag 需要用户明确说“合并”。

8. 合并后（用户确认才做）

```bash
git checkout rebrand/occ-full
git pull --ff-only
git tag "v<upstream-version>-occ.<n>"
git push origin "v<upstream-version>-occ.<n>"
```

## 不要做的事

- 不要 `git merge upstream/main`：全量改名后会有几千处冲突
- 不要 `git rebase upstream/main`：四个改名提交无法重放
- 不要用 GitHub “Sync fork”：同上
- 不要 `git push --tags`：会带上游几千个 tag
- 不要跳过 `pnpm build:unpack`：插件树哈希和打包路径只有构建能验证

## 常见失败

| 现象 | 处理 |
|---|---|
| `packaged bytes do not match ...plugin` | 插件哈希没刷新；确认 `apply.mjs` 的 hash 刷新段执行，重跑同步 |
| `pnpm install` 改 lockfile | 正常，`git add` 后 amend 进同步提交 |
| git 报 `could not read Username` | 代理或认证问题；`gh auth status`，代理改 `7897` |
| `git worktree` 残留 | `git worktree prune`，再重跑 |
| 上游改了 relay 协议 | 检查 `scripts/occ-rebrand/apply.mjs` 的恢复常量列表，补新 wire 字符串 |

## 只拿单个修复

```bash
git fetch upstream
git cherry-pick -x <sha>
```

冲突按映射解：`orca → occ`，`Orca/ORCA → OCC`，路径同理。
