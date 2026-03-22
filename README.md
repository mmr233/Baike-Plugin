# Baike-Plugin

百科查询、内容总结、群聊总结插件。

## 功能

- `搜索 xxx` 或 `xxx是谁 / xxx是什么` 进行百科查询
- `总结 + 引用消息` 总结文本、图片、视频、语音、合并转发
- 群内直接发送 `总结` 获取群聊总结
- 群内发送 `总结 @成员` 获取指定成员总结
- 支持锅巴面板配置
- 支持帮助 HTML 渲染
- 支持定时群总结

## 目录

```text
Baike-Plugin/
├─ apps/
├─ model/
├─ utils/
├─ resources/
├─ config/
├─ lib/
├─ index.js
├─ guoba.support.js
└─ package.json
```

## 安装

将插件目录放到 `Yunzai/plugins/Baike-Plugin` 后执行：

```bash
pnpm install --filter=baike-plugin
```

## 帮助命令

- `#百科帮助`
- `#百科查询帮助`

## 说明

- 主要配置文件位于 `config/config/config.json`
- 默认配置模板位于 `config/default/config.json`
- 首次使用前请先在 `config/config/config.json` 或锅巴面板里填写你自己的接口地址和 API Key
- `cron` 修改后需要重载插件或重启 Yunzai
