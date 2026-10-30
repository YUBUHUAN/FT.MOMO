# 密友邮局 1.8.0 · Supabase 部署与回滚说明

状态：部署前演练准备；未执行、未连接 Supabase。
目标：Momo 共享项目 `cflewtmxgekfpusicnfx`。
前置：`cloud/friends_v3.sql`、`cloud/friends_actions.sql` / v6 已存在。

## 0. 文件与验收哈希

```text
cloud/friends_letters_preflight.sql
SHA256 970DD9C5D14E4388C6DEF142F97E43D5BE89E8DC1B0D450B30A3001D1C534B77

cloud/friends_letters_preflight_report.sql
SHA256 B549885C187A65A4617C7C9A17CA2283FDFA69F56238AC2DA880F85353BF1923

cloud/friends_letters.sql
SHA256 44B9BEF8A5C37A6A051AAA3280A7D4FD20A655932A33A7865F6F5C8D9F60C995

cloud/friend_link_lifecycles_preflight.sql
SHA256 158650843ADAC5707D2FAD50DB0F9790453F5936CE8983CB128CB85267C0A8F5

cloud/friend_link_lifecycles.sql
SHA256 2B60CC6A8F86DE0DC8E012CACE702EF35198A4547666AFA041B145D0FB25456B

D:\momo-local-supabase\supabase\migrations\0009_friend_link_lifecycles.sql
本地已验证的等价迁移；不作正式执行文件。
```

哈希以执行前重新计算为准。

不要在本轮执行任何 SQL。

---

## 1. Supabase SQL Editor 操作说明

### 第一步：只读 preflight

1. 打开 Supabase Dashboard。
2. 选择目标项目。
3. 进入 **SQL Editor → New query**。
4. 只粘贴并运行：

```text
cloud/friends_letters_preflight.sql
```

5. 该文件只包含 SELECT 元数据查询，必须没有 CREATE/ALTER/DROP/GRANT/REVOKE/INSERT/UPDATE/DELETE。
6. 保存结果截图或导出结果。

### 第二步：根据 preflight 结果放行或停止

必须满足：

- `friend_letters` 不存在；
- 没有同名索引；
- 没有同名 `friend_letter_*` 函数；
- `friend_identity(text)` 存在；
- `friend_active_link_v2(text)` 存在；
- `friend_events(text)`、`friend_event_ack(text, uuid)` 存在；
- `friend_events` 字段包含：
  - `id`
  - `link_id`
  - `target_app`
  - `target_account_id`
  - `type`
  - `payload`
  - `created_at`
  - `read_at`
- `friend_links` 包含 link 生命周期字段。

任意一项不符合：**停止，不运行正式迁移**。

### 第三步：正式迁移

只有 preflight 全部通过，且已在测试项目完成演练后，才在目标 SQL Editor 运行：

```text
cloud/friends_letters.sql
```

不要将 preflight 与 migration 粘贴在同一个查询中。
不要在同一个 Editor 标签里同时保留只读检查和 DDL。

正式迁移包含：

- `begin;`
- `friend_letters` 表
- 索引
- RLS/revoke
- 6 个 RPC
- revoke/grant
- `commit;`

如果中途报错，事务应停留在 aborted 状态；不要手工补执行半截语句，先检查对象和错误。

---

## 2. 测试项目部署步骤

当前只确认了正式共享项目；**是否已有独立 Supabase 测试项目：待核实**。
不要直接在生产项目做“测试性发信”。

### 2.1 测试环境选择

优先顺序：

1. 独立的 Supabase 测试项目；
2. 本地 Supabase/PostgreSQL 测试实例；
3. 至少一个可丢弃的数据库。

如果没有测试项目，先建立测试项目，不要在生产项目直接演练。

### 2.2 测试项目前置

在测试项目确认：

- `momo_accounts` / `momo_sessions` / `momo_states`
- `wowo_accounts` / `wowo_sessions` / `wowo_states`
- `friend_requests` / `friend_links`
- `friend_events` / `friend_activities`

即先完成现有 `friends_v3.sql` 与 `friends_actions.sql` / v6 的测试项目部署。

### 2.3 执行顺序

1. 运行 preflight；
2. 保存 preflight 结果；
3. 运行 `friends_letters.sql`；
4. 再次运行 preflight；
5. 验证对象：
   - `friend_letters` 存在；
   - 5 个索引存在；
   - 6 个函数存在；
   - 表 RLS 开启；
   - anon/authenticated 没有表级权限；
6. 创建/准备两个测试账号：
   - 一个 Momo 账号；
   - 一个 Wowo 账号；
   - 双方互相绑定为 active link；
7. 用两个账号的 token 做功能测试；
8. 测试完成后执行回滚；
9. 回滚后再次 preflight，确认测试对象清理。

### 2.4 功能性测试

#### 发送/幂等

- A 给 B 发信；
- B 离线后仍能在数据库看到；
- 同 `client_token` 重试只产生一封信；
- 同 token 重试不重复插 `friend_events`；
- 2001 字失败；
- 非法 style/paper/envelope/sticker 失败。

#### 频率

- 30 秒内第二封失败；
- 第 30 封成功，第 31 封失败；
- 北京时间 23:59:59 与次日 00:00:00 边界正确；
- 并发两个发送请求时，最多一个进入 30 秒窗口；
- 同一发送者不同 link 仍共享 30 秒/每日限额。

#### 回复/互动

- 回复同 link 成功；
- 回复旧 link/不同 link 失败；
- 回复自己寄出的信失败；
- 收件人可爱心/收藏；
- 寄件人不可爱心/收藏；
- 寄件人可见爱心/收藏标记；
- 寄件人看不到已读状态。

#### 解绑/重绑

- 解绑后双方仍可 list/get/read/unread；
- 解绑后 send/reply/react 全部失败；
- 重新绑定后旧信不迁移；
- 旧信不能在新 link 下回复；
- link 删除后，历史信仍可按原始参与者读取。

#### 分页

- 同一 `created_at` 多封信；
- 第一页返回 `nextBefore` 与 `nextBeforeId`；
- 第二页同时传两个值；
- 不重复、不漏信；
- 空页两个游标都为空。

#### 权限

- 第三方读信失败；
- anon 直读表失败；
- 无 token 调 RPC 失败；
- 寄件人调 `friend_letter_read` 失败且不泄露信件是否存在。

### 2.5 每日限额确认

SQL 使用：

```sql
created_at >= (
  date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai')
  AT TIME ZONE 'Asia/Shanghai'
)
```

- 按北京时间自然日；
- 每天 00:00 重置；
- 每天最多 30 封；
- 30 秒限制不变；
- 同一发送者的所有发送先经过 `pg_advisory_xact_lock`，限额检查与插入在同一事务内串行；
- 重复 `client_token` 在限额检查前返回已有信，不重复计数。

---

## 3. 完整回滚方案

### 3.1 测试项目完整回滚

前提：测试信件可以删除，或已备份。

```sql
begin;

drop function if exists public.friend_letter_send(
  text, text, text, text, text, text, uuid, uuid
);
drop function if exists public.friend_letter_list(
  text, text, int, timestamptz, uuid
);
drop function if exists public.friend_letter_get(text, uuid);
drop function if exists public.friend_letter_read(text, uuid);
drop function if exists public.friend_letter_react(text, uuid, text);
drop function if exists public.friend_letter_unread(text);

drop table if exists public.friend_letters;

commit;
```

说明：

- 先删函数，再删表；
- 索引和约束随表删除；
- 不使用 `CASCADE`，避免误删其他对象；
- 该回滚会删除测试信件。

### 3.2 有数据时的保守回滚

如果信件数据需要保留：

```sql
begin;

drop function if exists public.friend_letter_send(
  text, text, text, text, text, text, uuid, uuid
);
drop function if exists public.friend_letter_list(
  text, text, int, timestamptz, uuid
);
drop function if exists public.friend_letter_get(text, uuid);
drop function if exists public.friend_letter_read(text, uuid);
drop function if exists public.friend_letter_react(text, uuid, text);
drop function if exists public.friend_letter_unread(text);

alter table public.friend_letters
  rename to friend_letters_backup_20261030;

commit;
```

这样：

- 前端 RPC 立刻不可用；
- 信件数据保留在备份表；
- 需要恢复时重新应用 migration，再把备份数据迁回；
- 不要在未备份时直接 `drop table`。

### 3.3 迁移失败时

- `friends_letters.sql` 使用 `begin/commit`；
- 任一语句报错后事务 aborted；
- 先检查 `friend_letters`、索引、函数是否部分存在；
- 不要在 unknown 状态下重复运行；
- 必要时按 3.1 清理后重试。

### 3.4 回滚后验证

- preflight 显示 `friend_letters` 不存在；
- `friend_letter_*` 函数不存在；
- 同名索引不存在；
- 现有 `friend_events` / `friend_links` / 活动数据未被删除；
- Momo/Wowo 现有好友、投喂、出游、运动功能正常。

---

## 4. 对 Momo 1.7.1.1 的影响边界

本迁移（`friends_letters.sql`）：

- 只新增 `friend_letters` 表；
- 只新增 5 个索引；
- 只新增 6 个 RPC；
- 不改 `momo_states` / `wowo_states`；
- 不改 `friend_events` 表结构；
- 不改现有好友、投喂、活动、运动函数；
- 不删除任何现有对象。

关系生命周期由单独的 0009 迁移处理；0009 只改 `friend_links` 约束和 `friend_request` / `friend_unbind` 函数，不改信件数据。

因此不改变 Momo 1.7.1.1 的已有功能路径。

上线前仍应通过 preflight 确认没有同名对象冲突。

---

## 5. 关系生命周期迁移

### 5.1 文件

```text
cloud/friend_link_lifecycles_preflight.sql
cloud/friend_link_lifecycles.sql
```

正式文件是本地已验证迁移的功能等价版本：

```text
D:\momo-local-supabase\supabase\migrations\0009_friend_link_lifecycles.sql
```

状态：已生成，未执行、未部署。

### 5.2 前置确认

正式执行前必须：

1. 备份正式数据库；
2. 已执行 `friends_letters.sql`；
3. 运行 `friend_link_lifecycles_preflight.sql`；
4. preflight 摘要为 `READY`；
5. 记录 `friend_links`、`friend_letters` 和 active link 数量。

Preflight 检查：

- `friend_links` 原账号对唯一约束；
- 两个 active 部分唯一索引；
- `friend_request` / `friend_unbind` 函数现状；
- 重复账号对和重复 active 冲突；
- `friend_letters.link_id` 与 `friend_links` 关联；
- RLS、表权限；
- 现有数据量。

Preflight 在 `friend_letters` 不存在时不会报错，而是返回：

```text
friend_letters_total = 0
8. letters by link status = table absent
SUMMARY = STOP
```

这表示 `friends_letters.sql` 尚未执行，应先完成信件表迁移，不应继续生命周期迁移。

### 5.3 执行顺序

1. 备份正式数据库；
2. 运行 `friends_letters_preflight.sql`；
3. 执行 `friends_letters.sql`；
4. 运行 `friend_link_lifecycles_preflight.sql`；
5. 确认摘要为 `READY`；
6. 执行 `friend_link_lifecycles.sql`；
7. 只读验证约束、索引、函数；
8. 用测试账号验证初次绑定、解绑、重绑；
9. 确认旧信 link_id 不变；
10. 确认重绑生成新 link ID；
11. 确认旧信 canReply/canReact false。

### 5.4 回滚限制

生命周期迁移删除账号对唯一约束后，如果已经产生同一账号对的多行历史 link，不能直接重新添加：

```text
UNIQUE (momo_account_id, wowo_account_id)
```

回滚只能使用迁移前正式数据库备份恢复，不能简单反向 DDL。

### 5.5 数据影响

- 不修改现有信件行；
- 不修改现有 link ID/status；
- 不新增账号；
- 不执行解绑/重绑作为迁移的一部分；
- 不连接正式云端执行测试。

### 5.6 可重复执行与风险

- `DROP CONSTRAINT IF EXISTS`；
- `CREATE UNIQUE INDEX IF NOT EXISTS`；
- `CREATE OR REPLACE FUNCTION`；
- 函数替换保持签名和原有 ACL；
- 重复执行不会主动改写现有 link/letter 数据。

不可逆点：

- 账号对唯一约束被删除；
- 一旦产生同账号对多行历史 link，恢复旧约束必须依赖备份恢复。

---

## 6. 放行条件

只有同时满足才可进入正式部署：

- 正式数据库备份已完成并校验；
- `friends_letters_preflight.sql` 确认目标表/对象状态符合预期；
- `friend_link_lifecycles_preflight.sql` 摘要为 `READY`；
- SQL SHA256 与验收值一致；
- 测试项目迁移/功能/回滚演练通过；
- 测试项目再次 preflight 显示回滚干净；
- 产品确认北京时间每日限额；
- 备份/回滚窗口已安排。

当前状态：未执行、未连接 Supabase、未部署。
