<div align="center">

# [mmr233](https://github.com/mmr233)

</div>

## 注意事项

> 请先看完下面内容再使用本插件
> 需要你已经具备正常使用 Yunzai 和修改插件配置的基础能力
> 搜索、总结、语音识别和视频分析需要在 Baike 中配置模型接口
> 默认模板配置里不再附带可直接使用的密钥

如果你连 `config/config/config.json` 和锅巴面板都不想看，那这个插件大概率不适合你。

---

## 功能说明

- 全面适配 [TRSS Yunzai v3.1.3](https://github.com/TimeRainStarSky/Yunzai)
- 兼容 [Miao-Yunzai v3.1.3](https://github.com/yoimiya-kokomi/Miao-Yunzai)
- 支持百科搜索、引用消息总结、图片/视频/语音总结、群聊总结、@成员总结
- 支持锅巴面板配置管理
- 支持帮助 HTML 渲染
- 支持定时群总结

---

## 主要能力

- `搜索xxx` 或 `搜索 xxx` 可直接查询资料；`xxx是谁 / xxx是什么 / xxx是啥` 便捷问法默认关闭，可在锅巴开启
- `总结 + 引用消息` 可统一总结文本、图片、视频、语音、合并转发
- 群里直接发送 `总结` 可分析最近群聊
- 群里发送 `总结 @成员` 可只分析指定成员发言
- 群聊总结采用“内容分析 + 人物分析”双路结构化请求，正常仅调用两次；字段缺失时只补修对应部分
- 可选接入 Iris-Sign-Plugin 的 Bot 主人和赞助身份，为用户画像增加差异化称呼；关闭功能、未安装 Iris 或读取失败均不影响正常总结
- 搜索结果支持来源整理、显示上限和合并转发来源截图
- 总结结果支持 `HTML 图片 / 合并转发 / 文本` 三种发送方式并可自动降级

---

## 锅巴配置说明

- 搜索模型、总结模型、视频模型、音频模型都能在锅巴里单独配置
- 缓存时长、缓存容量、发送方式、HTML 卡片主题与夜晚时段、来源显示上限和截图数量都能直接调
- 定时群总结支持直接配置每日执行时间、目标群和消息条数
- 锅巴保存后会自动刷新定时任务，无需手动重启
- 运行中的真实配置文件在 `config/config/config.json`
- 仓库中的 `config/default/config.json` 只是模板，不包含可直接使用的密钥

---

## 安装指南

#### Yunzai 根目录执行命令安装

- GitHub 源
```bash
git clone --depth=1 https://github.com/mmr233/Baike-Plugin.git ./plugins/Baike-Plugin/
```

- 安装依赖
```bash
pnpm install --filter=baike-plugin
```

- 填写你自己的接口配置
```text
plugins/Baike-Plugin/config/config/config.json
```

## 使用说明

> 使用 `#百科帮助` 或 `#百科查询帮助` 获取完整帮助

| 分类 | 示例 |
|------|------|
| 搜索 | `搜索胡桃` `搜索 往生堂` |
| 引用总结 | `总结 + 引用消息` |
| 媒体总结 | `总结 + 图片/视频/语音` |
| 群聊总结 | `总结` |
| 成员总结 | `总结 @某人` |
| 插件帮助 | `#百科帮助` `#百科查询帮助` |
| 更新 | `#百科更新` `#百科强制更新` `#百科更新日志` |

---

## 目录结构

```text
Baike-Plugin/
├─ apps/                  # 命令入口
├─ model/                 # 配置、服务、锅巴适配
├─ utils/                 # 文本与 HTML 工具
├─ resources/             # 帮助页模板和公共样式
├─ config/                # 默认配置与运行配置
├─ lib/                   # 动态加载器
├─ index.js
├─ guoba.support.js
└─ package.json
```

---

## 免责声明

> 1. 本插件仅供学习交流使用，严禁用于违法或滥用场景
> 2. 搜索与总结结果来自你自行配置的模型接口，结果仅供参考，请自行判断准确性
> 3. 请勿把你自己的 API Key、私有接口地址和运行配置直接公开到公共仓库

---

## 致谢

| Nickname | Contribution |
| -------- | ------------ |
| [TRSS Yunzai](https://github.com/TimeRainStarSky/Yunzai) | TRSS Yunzai 主框架 |
| [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) | Miao-Yunzai 兼容参考 |
| [Guoba-Plugin](https://github.com/guoba-yunzai/guoba-plugin) | 锅巴面板支持 |
