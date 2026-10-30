# 密友邮局 1.8.0 · 数据库开发说明

状态：设计已确认，SQL 已本地生成；未执行、未部署、未提交。
目标项目：`cflewtmxgekfpusicnfx`（Momo 共享 Supabase 项目）。
前置：`cloud/friends_v3.sql` 与 `cloud/friends_actions.sql` / v6 已应用。

## 文件

```text
cloud/friends_letters.sql
cloud/friends_letters_preflight.sql
cloud/friends_letters_preflight_report.sql
cloud/friend_link_lifecycles.sql
cloud/friend_link_lifecycles_preflight.sql

D:\momo-local-supabase\supabase\migrations\0009_friend_link_lifecycles.sql
```

该文件只新增：

- `friend_letters` 表
- 信件相关索引
- 6 个信件 RPC
- 表权限和函数授权

不修改：

- `momo_states` / `wowo_states`
- `friend_links` / `friend_requests`
- `friend_events` 字段
- 现有投喂、活动、出游、运动逻辑

## 表设计

`friend_letters` 保存发送者/收件人快照、风格、正文、信纸、信封、贴纸、回复引用、已读时间、爱心/收藏时间、客户端幂等 token。

关键点：

- `link_id` 使用 `ON DELETE SET NULL`，不使用 CASCADE；
- sender/recipient 的 app + account_id 为非空快照；
- 不对 sender/recipient 加账号级联删除，避免关系/账号变化时历史信被删；
- `reply_to_id` 使用 `ON DELETE SET NULL`；
- `client_token` 与 sender 组成唯一索引，重试幂等；
- `read_at` 只用于收件人未读数；不向寄件人暴露为已读回执。

## RPC

```text
friend_letter_send(
  p_token, p_style, p_body, p_paper_style, p_envelope_style,
  p_sticker, p_reply_to, p_client_token
)

friend_letter_list(
  p_token, p_box, p_limit, p_before, p_before_id
)

friend_letter_get(p_token, p_id)
friend_letter_read(p_token, p_id)
friend_letter_react(p_token, p_id, p_kind)
friend_letter_unread(p_token)
```

`friend_letter_list` 使用 `(created_at, id)` 复合游标：

- 按 `created_at desc, id desc` 排序；
- 返回 `nextBefore` 和 `nextBeforeId`；
- 下一页必须同时传两个值；
- 只传时间会跳过同一时间戳的信，前端不得这样调用。

所有函数：

- `SECURITY DEFINER`
- `search_path = public, extensions, pg_temp`
- `REVOKE ALL FROM public`
- 只 GRANT 给 `anon, authenticated`

历史读取（list/get/read/unread）只校验 token 身份 + 原始参与者，不要求 active link。
发送/回复/爱心/收藏要求 active link。

## 频率与幂等

- 以 `hash sender app:account` 取 `pg_advisory_xact_lock`；
- 同 sender 30 秒最多 1 封；
- 每天最多 30 封，按 **北京时间（Asia/Shanghai）自然日** 计算；
  - 当天起点：`date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'`；
  - 北京时间每天 00:00 重置；
  - 不依赖数据库服务器默认时区；
- 同 `client_token` 重试返回已有信，不重复插事件；
- 锁在事务内释放，异常时不会留下半封信。

## 事件

发送成功后：

```text
friend_events.type = letter_received
```

只写消息通知，不写 state。旧客户端会忽略未知 type；新客户端处理后可调用现有 `friend_event_ack`。

## 权限

```sql
alter table public.friend_letters enable row level security;
revoke all on table public.friend_letters from anon, authenticated;
```

不建立 policy；所有访问走 RPC。客户端不能直接 select/update/delete。

## 上线前最终审查修复

1. `friend_letter_read` 改为直接按“当前账号是收件人”查询。
   - 避免第三方或寄件人通过 `not_recipient` 判断某封陌生信是否存在。
2. `friend_letter_list` 改为 `(created_at, id)` 复合游标。
   - 返回 `nextBefore` + `nextBeforeId`；
   - 解决同一时间戳分页时漏信或重复显示；
   - 下一页必须同时传两个游标。
3. 修正 `regexp_replace` 的 SQL E-string 转义。
4. 复查 `friend_events` 插入字段：
   - `link_id / target_app / target_account_id / type / payload`
   - 与现有表字段一致，无新增列。

## 测试计划

### 权限

- A 发信，B 读取成功；
- 第三方 C 读取失败；
- anon 直读表失败；
- 无 token 调用所有信 RPC 失败。

### 发送/幂等/频率

- 2000 字成功，2001 字失败；
- 非法风格/素材失败；
- 30 秒内第二封失败；
- 每日第 31 封失败；
- 同一 `client_token` 重试返回同一封信；
- 并发同 token 只产生一封信；
- 重试不重复插入 `friend_events`。

### 回复/互动/已读

- 回复同 link 成功；
- 回复不同 link、回复自己寄出的信失败；
- 收件人可爱心/收藏，寄件人不可；
- 寄件人可见爱心/收藏，不可见已读；
- 收件人标记已读成功；
- 对方无法通过返回字段判断已读状态。

### 解绑/重绑

- 0009 迁移后，解绑只把当前 link 标记为 unbound，不删除该行；
- 重绑为同一账号对插入新的 friend_links 行，必须使用新的 link ID；
- 旧信保留原 link_id，不迁移、不改写；
- 旧信 linkStatus 继续为 unbound，canReply/canReact 为 false；
- 新信只绑定重绑后的新 link；
- 旧信不能作为新 link 的 replyTo；
- link 删除后历史信仍可按参与者读取。

### 分页

- 同一 `created_at` 多封信不重复、不漏；
- 下一页同时传 `before` + `before_id`；
- 空页 `nextBefore`/`nextBeforeId` 为 null。

## 关系生命周期迁移 0009

正式文件：

```text
cloud/friend_link_lifecycles.sql
cloud/friend_link_lifecycles_preflight.sql
```

本地已验证的等价迁移：

```text
D:\momo-local-supabase\supabase\migrations\0009_friend_link_lifecycles.sql
```

状态：

- 本地 0009：已应用并验证；
- 正式生命周期 SQL：已生成，**未执行、未部署**；
- 正式项目必须先备份，再执行 preflight 和迁移。

### 模型

```text
friend_links 一行 = 一段关系生命周期
同一 Momo/Wowo 账号对可以有多行历史 link
```

### 约束

删除：

```text
UNIQUE (momo_account_id, wowo_account_id)
```

保留：

```text
friend_links_momo_active_uidx
friend_links_wowo_active_uidx
```

两个 active 部分唯一索引继续保证每个账号最多一个 active link。

### friend_request

- 双方账号使用固定顺序 advisory lock；
- 锁后重新检查 active 和 pending；
- 重绑插入新的 friend_links 行，不使用 `ON CONFLICT ... DO UPDATE`；
- 只把 active 部分唯一索引冲突翻译为 `already_linked` / `target_linked`；
- 其他 `unique_violation` 继续抛出，不伪装成业务错误。

### friend_unbind

- 读取当前 active link；
- 对 link 双方账号使用与 friend_request 相同的排序 advisory lock；
- 只更新该 active link 为 unbound；
- 不删除旧 link。

### 执行顺序

```text
1. friends_letters_preflight.sql
2. friends_letters.sql
3. friend_link_lifecycles_preflight.sql
4. friend_link_lifecycles.sql
```

生命周期 preflight 必须检查：

- 账号对唯一约束现状；
- 两个 active 部分唯一索引；
- `friend_request` / `friend_unbind` 函数现状；
- 重复 active/pending 冲突；
- `friend_letters.link_id` 与 `friend_links` 关联；
- RLS、表权限和现有数据量。

如果 `friend_letters` 尚不存在，生命周期 preflight 会安全返回：

```text
friend_letters_total = 0
8. letters by link status = table absent
SUMMARY = STOP
```

这是“尚未执行 friends_letters.sql”的预期前置状态，不应继续执行生命周期迁移。

如果 preflight 返回 `STOP`，禁止执行生命周期迁移。

### 数据保护

- 不更新现有 `friend_letters.link_id`；
- 不更新现有 `friend_links.id` 或状态；
- 不新增测试账号或关系；
- 不执行迁移、解绑或重绑；
- 现有 56 封信和 10 条 link 保持原样。

### 已读/未读

当前行为保持不变：

- `friend_letter_read` 对历史 unbound 信仍可写 read_at；
- `friend_letter_unread` 仍统计 unbound 历史未读。

如果产品要求“绝对只读”包含 read_at，需要另行修改 read/unread，不在 0009 最小迁移中处理。

## 未解决/上线前确认

- Supabase 目标项目当前是否已存在同名表（待核实）。
- 账号删除时信件保留策略（当前信件不级联账号删除）。
- 解绑后是否允许把历史信标记已读（当前允许）。
- 素材白名单后续如果增加，需要同步修改 SQL check 与 RPC。
- 每日限制已固定为北京时间自然日，不依赖数据库服务器时区。
- 首版不做图片、手绘、定时寄信。
- 当前环境没有 PostgreSQL 解析器；SQL 尚未实际执行，部署前需在 Supabase SQL Editor 验证。
