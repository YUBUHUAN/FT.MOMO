# 第三方组件

墨墨的代码本身没有 npm / NuGet 第三方依赖，但发行包里携带了以下运行时：

| 组件 | 版本 | 许可 | 用途 |
|---|---|---|---|
| Node.js | 24.x（`desktop-native/node/node.exe`） | MIT | 同步服务端 |
| .NET Runtime / WindowsDesktop | 10.0.x（仅便携版 `dotnet/`） | MIT | WPF 桌宠 |
| 系统字体 | Windows 自带 | 系统许可 | KaiTi（手写体）、Microsoft YaHei UI、Segoe UI Emoji |
| 角色立绘 | 用户提供 | 归用户所有 | 桌面形象与头像 |

Node.js: https://github.com/nodejs/node/blob/main/LICENSE  
.NET: https://github.com/dotnet/runtime/blob/main/LICENSE.TXT

`web/` 与 `desktop-native/` 未引入第三方前端框架或图标库；界面图标使用系统 emoji 与内联绘制的形状。
