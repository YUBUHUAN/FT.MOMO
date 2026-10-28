# Momo × Wowo 好友绑定初始化

好友绑定使用 **Momo 的 Supabase 项目** 作为共享项目。Wowo 的账号表仍然独立，只是也放在这个项目里。

在 **Momo 项目** 的 SQL Editor 里按顺序运行：

1. `cloud/wowo_schema.sql`
   - 创建 `wowo_accounts` / `wowo_sessions` / `wowo_states`
   - 创建 Wowo 原有 RPC
2. `cloud/friends.sql`
   - 给两边账号加好友码
   - 创建 `friend_requests` / `friend_links`
   - 创建好友 RPC

运行完成后：

- 打开 Momo 的手帐，进入「密友」，会生成 `M-XXXXXX` 好友码。
- 打开 Wowo 的手帐，进入「密友」，会生成 `W-XXXXXX` 好友码。
- 双方都输入对方好友码并发送申请后，才会绑定。
- 单方只发申请时，对方只看到「有人申请」，看不到你的昵称/头像。

注意：旧 Wowo 项目不会自动迁移账号。旧 Wowo 项目只保留为备份；旧账号需要迁移或重新注册。当前 Wowo 刚上线，建议直接在新共享项目重新注册。
