import { Client } from '@notionhq/client'; // 导入Notion客户端，用于与Notion API交互
import moment from 'moment'; // 导入moment库，用于日期处理和格式化
import fs from 'fs'; // 导入文件系统模块，用于读写文件
import path from 'path'; // 导入路径模块，用于处理文件路径
import dotEnv from 'dotenv' // 导入dotenv库，用于加载环境变量

if (!process.env.GITHUB_ACTIONS) { // 判断是否在GitHub Actions环境中运行
  dotEnv.config(); // 如果不是在GitHub Actions中运行，则加载.env文件中的环境变量
}

const notion = new Client({ auth: process.env.NOTION_TOKEN }); // 创建Notion客户端实例，使用环境变量中的令牌进行认证
const databaseId = process.env.NOTION_DATABASE_ID; // 从环境变量获取Notion数据库ID

const CONFIG ={ // 定义配置对象
  days: 7, // 配置获取过去7天的数据
  dir:'./src/pages/posts', // 配置输出目录
  filename:'本周见闻' // 配置输出文件名前缀
}

const curTime = moment(Date.now()); // 获取当前时间，并创建moment对象
const today = curTime.format('YYYY-MM-DD'); // 格式化当前日期为YYYY-MM-DD格式
const startDay = moment(curTime).subtract(CONFIG.days, 'days').format('YYYY-MM-DD') // 计算开始日期（当前日期减去配置的天数）

function formatStr(str) { // 定义字符串格式化函数
  const reg1 = /[<>'"]/g // 定义正则表达式，用于移除HTML特殊字符
  const reg2 = /([^\n\r\t\s]*?)((http|https):\/\/[\w\-]+\.[\w\-]+[^\s]*)/g // 定义正则表达式，用于识别URL

  if (!!str && str.trim()) { // 如果字符串存在且非空
    str = str.replace(reg1, '') // 移除特殊字符
    const url = str.replace(reg2, (a, b, c)=> (b + '<' + c + '>')) // 将URL格式化为Markdown链接格式
    return url // 返回处理后的字符串
  }
  return str // 如果字符串为空，则直接返回
}

async function main() { // 主函数，使用async定义为异步函数
  try { // 开始try-catch块
    const response = await notion.databases.query({ // 查询Notion数据库
      database_id: databaseId, // 指定数据库ID
      filter: { // 设置筛选条件
        and: [ // 使用AND逻辑组合条件
          {
            property: 'date', // 基于date属性筛选
            date: {
              on_or_after: startDay // 日期大于等于开始日期
            }
          },
          {
            property: 'date', // 基于date属性筛选
            date: {
              before: today // 日期小于今天
            }
          },
          {
            property: 'type', // 基于type属性筛选
            select: {
              equals: 'Post' // 只选择type为Post的条目
            }
          },
          {
            property: 'status', // 基于status属性筛选
            select: {
              equals: 'Published' // 只选择status为Published的条目
            }
          }
        ],
        sorts: [ // 设置排序
          {
            property: "date", // 按date属性排序
            direction: "ascending" // 升序排列
          }
        ],
      }
    });

    if(!response.results.length){ // 如果查询结果为空
      console.log('no data') // 打印"无数据"信息
      return // 结束函数执行
    }

    let mid = (`${startDay}_${today}`).replace(/-/g,'') // 创建中间字符串，用于文件名（去除日期中的横线）
    let mdHead = `---\ndate: ${today.replace(/-/g,'/')}\ntoc: true\n---\n\n` // 创建Markdown头部（包含YAML前置数据）
    let mdContent = '' // 初始化Markdown内容为空字符串
    let secData = {} // 初始化分类数据对象
    let mdImg = '' // 初始化Markdown图片字符串
    function setMdImg(img){ // 定义设置Markdown图片的函数，移除了txt参数
      return `<img src="${img}" width="800" />\n\n` // 返回HTML格式的图片标签，不再包含描述
    }

    let index = 0; // 初始化索引计数器
    for (const page of response.results) { // 遍历查询结果中的每一页

      const cover = page.cover?.external?.url || page.cover?.file?.url // 获取封面图片URL（优先使用外部URL）

      const props = page.properties // 获取页面属性
      const title = props.title?.title[0].plain_text // 获取标题文本

      // 适配新的字段名称
      const content = props.summary?.rich_text.map(item => item.plain_text).join('') || '' // 获取summary内容，合并所有文本块
      const img = props.img?.files[0]?.file?.url || props.img?.files[0]?.external?.url || '' // 获取图片URL
      const url = props.URL?.url || '' // 获取URL
      const slug = props.slug?.rich_text[0]?.plain_text || '' // 获取slug

      const _content = content // 保留原始内容
      const targetStr = formatStr(_content) // 格式化内容
      const category = props.category.select?.name // 获取分类（单选）
      const oneImg = cover ? `![](${cover})`:'' // 如果有封面图，则创建Markdown图片语法

      // 添加项目地址和项目介绍
      const projectUrl = url ? `\n\n**项目地址**：${url}` : ''
      const projectIntro = slug ? `\n\n**项目介绍**：https://inbox.ebeb.fun/article/${slug}` : ''

      if (category) { // 如果有分类
        if (!secData[category]) { // 如果该分类的数据不存在
          secData[category] = [] // 初始化为空数组
          secData[category].index = 0 // 设置索引为0
        }
        let idx = secData[category].index++ // 获取并递增索引
        const oneMsg =`**${idx+1}、${title.trim()}**\n\n${targetStr}${projectUrl}${projectIntro}\n\n${oneImg}\n\n` // 创建一条消息的Markdown格式
        secData[category].push(oneMsg) // 将消息添加到对应分类的数组中
      }

      if (img) { // 如果有图片
        mdImg = setMdImg(img) // 设置Markdown图片，不再传递描述参数
      }

      index+=1; // 递增索引
    }

    Object.keys(secData).map(key=>{ // 遍历所有分类
      mdContent+=`## ${key}\n${secData[key].join('')}` // 为每个分类创建二级标题，并连接所有消息
    })

    const existingFiles = fs.readdirSync(CONFIG.dir).filter(file => !file.startsWith('.')) // 读取目录中所有文件，过滤掉隐藏文件
    const existingFile = existingFiles.find(file => file.includes(mid)); // 查找包含特定日期范围的已存在文件

    let filePath = '' // 初始化文件路径
    if (existingFile) { // 如果找到了已存在的文件
      filePath = path.join(CONFIG.dir, existingFile); // 使用已存在文件的路径
    } else { // 如果没有找到已存在的文件
      const fileCount = existingFiles.length; // 获取目录中的文件数量
      const fileName = `${(fileCount < 10 ? '0' + fileCount : fileCount) + '-' + (CONFIG.filename || today)}-${mid}.md`; // 创建新文件名
      filePath = path.join(CONFIG.dir, fileName); // 创建完整文件路径
    }

    const fileContent = `${mdHead + mdImg + mdContent}`; // 组合完整的文件内容
    fs.writeFileSync(filePath, fileContent); // 将内容写入文件
  } catch (error) { // 捕获可能的错误
    console.error("Error:", error); // 打印错误信息
    process.exit(1); // 以错误状态码退出程序
  }
}

main() // 调用主函数执行程序
