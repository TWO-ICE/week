import { Client } from '@notionhq/client'; // 导入 Notion 客户端
import moment from 'moment'; // 导入 moment.js，用于日期处理
import fs from 'fs'; // 导入文件系统模块，用于文件操作
import path from 'path'; // 导入路径模块，用于处理文件路径
import dotEnv from 'dotenv'; // 导入 dotenv 模块，用于加载环境变量

// 如果不是在 GitHub Actions 环境中，则加载 .env 文件中的环境变量
if (!process.env.GITHUB_ACTIONS) {
  dotEnv.config();
}

// 创建 Notion 客户端实例，使用环境变量中的 Notion 令牌进行身份验证
const notion = new Client({ auth: process.env.NOTION_TOKEN });
// 从环境变量中获取 Notion 数据库 ID
const databaseId = process.env.NOTION_DATABASE_ID;

// 配置对象，定义查询的天数、文件保存目录和文件名
const CONFIG = {
  days: 7, // 查询过去 7 天的数据
  dir: './src/pages/posts', // 保存 Markdown 文件的目录
  filename: '本周见闻' // 文件名的前缀
}

// 获取当前时间
const curTime = moment(Date.now());
// 格式化当前日期为 'YYYY-MM-DD'
const today = curTime.format('YYYY-MM-DD');
// 计算开始日期，即当前日期减去 CONFIG.days 天
const startDay = moment(curTime).subtract(CONFIG.days, 'days').format('YYYY-MM-DD')

// 格式化字符串，去除不必要的字符并处理 URL
function formatStr(str) {
  const reg1 = /[<>'"]/g // 匹配不需要的字符
  const reg2 = /([^\n\r\t\s]*?)((http|https):\/\/[\w\-]+\.[\w\-]+[^\s]*)/g // 匹配 URL

  // 如果字符串存在且不为空
  if (!!str && str.trim()) {
    // 替换不需要的字符
    str = str.replace(reg1, '')
    // 将 URL 格式化为 <URL> 的形式
    const url = str.replace(reg2, (a, b, c) => (b + '<' + c + '>'))
    return url
  }
  return str // 如果字符串为空，直接返回
}

// 主函数
async function main() {
  try {
    // 查询 Notion 数据库，获取指定日期范围内的数据
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        and: [
          {
            property: 'Published', // 日期属性
            date: {
              on_or_after: startDay // 开始日期
            }
          },
          {
            property: 'Published',
            date: {
              before: today // 结束日期
            }
          }
        ],
        sorts: [
          {
            property: "Published", // 按日期排序
            direction: "ascending" // 升序
          }
        ],
      }
    });

    // 如果没有查询到数据，输出提示信息并返回
    if (!response.results.length) {
      console.log('no data')
      return
    }

    // 生成文件名的中间部分
    let mid = (`${startDay}_${today}`).replace(/-/g, '')
    // Markdown 文件的头部内容
    let mdHead = `---\ndate: ${today.replace(/-/g, '/')}\ntoc: true\n---\n\n`
    let mdContent = '' // Markdown 内容
    let secData = {} // 存储分类数据
    let mdImg = '' // 存储图片内容

    // 设置 Markdown 图片格式的函数
    function setMdImg(img, txt) {
      let desc = txt ? `<small>${txt}</small>\n\n` : '' // 图片描述
      return `<img src="${img}" width="800" />\n\n${desc}` // 返回格式化的图片 HTML
    }

    let index = 0; // 索引计数器
    // 遍历查询结果
    for (const page of response.results) {
      const cover = page.cover?.external?.url || page.cover?.file.url // 获取封面图片 URL

      const props = page.properties // 获取页面属性
      const title = props.title?.title[0].plain_text // 获取标题

      // 获取内容
      const content = props.Description?.rich_text.map(item => item.plain_text).join('') || '';
      const img = props.img?.files[0]?.file?.url || props.img?.files[0]?.external?.url || ''; // 获取图片 URL
      const imgDesc = props.imgDesc?.rich_text[0]?.plain_text || ''; // 获取图片描述
      const slug = props.Slug?.rich_text.map(item => item.plain_text).join('') || ''; // 获取 slug 字段

      // 基础 URL
      const baseUrl = 'https://inbox.ebeb.fun/';
      // 拼接完整链接
      const mdlink = `${baseUrl}${slug}`;

      const _content = content; // 处理后的内容
      const targetStr = formatStr(_content); // 格式化内容
      const tag = (props.Tags.multi_select && props.Tags.multi_select[0]?.name) || props.Tags.select?.name; // 获取标签，支持多选和单选
      const oneImg = cover ? `![](${cover})` : ''; // 如果有封面，生成 Markdown 图片格式

      // 如果有标签
      if (tag) {
        // 如果该标签不存在于 secData 中，则初始化
        if (!secData[tag]) {
          secData[tag] = [];
          secData[tag].index = 0; // 初始化索引
        }
        let idx = secData[tag].index++; // 获取当前索引并自增
        // 生成一条消息，确保每条消息都包含链接
        const oneMsg = `**${idx + 1}、${title.trim()}**\n\n${targetStr}\n\n[链接](${mdlink})\n\n${img ? `![图片](${img})\n\n` : ''}`;
        secData[tag].push(oneMsg); // 将消息添加到对应标签的数组中
      }

      // 如果有图片，设置图片内容
      if (img) {
        mdImg = setMdImg(img, imgDesc);
      }

      index += 1; // 索引自增
    }

    // 将分类数据转换为 Markdown 内容
    Object.keys(secData).map(key => {
      mdContent += `## ${key}\n${secData[key].join('')}`;
    });

    // 读取指定目录下的文件，过滤掉隐藏文件
    const existingFiles = fs.readdirSync(CONFIG.dir).filter(file => !file.startsWith('.'));
    // 查找是否已有文件包含中间部分
    const existingFile = existingFiles.find(file => file.includes(mid));

    let filePath = '';
    // 如果找到已有文件，使用该文件路径
    if (existingFile) {
      filePath = path.join(CONFIG.dir, existingFile);
    } else {
      // 如果没有找到，生成新的文件名
      const fileCount = existingFiles.length;
      const fileName = `${(fileCount < 10 ? '0' + fileCount : fileCount) + '-' + (CONFIG.filename || today)}-${mid}.md`;
      filePath = path.join(CONFIG.dir, fileName);
    }

    // 生成文件内容
    const fileContent = `${mdHead + mdImg + mdContent}`; // 生成文件内容
    // 将内容写入文件
    fs.writeFileSync(filePath, fileContent);
  } catch (error) {
    // 捕获错误并输出
    console.error("Error:", error);
    process.exit(1); // 退出进程
  }
}

// 调用主函数
main();
