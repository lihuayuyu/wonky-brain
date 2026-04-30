// /api/notion.js
// Vercel Serverless Function：從 Notion 讀取文章資料
//
// API 用法：
//   /api/notion?type=list&category=部落格        → 取得部落格列表
//   /api/notion?type=list&category=遊戲攻略      → 取得遊戲攻略列表
//   /api/notion?type=post&slug=iphone-15-review  → 取得單篇文章內容

const NOTION_API_URL = 'https://api.notion.com/v1';
const DATABASE_ID = '35221fd0c20080bb975bd2bbf8e66d26';
const NOTION_VERSION = '2022-06-28';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 從 Vercel 環境變數讀取金鑰（不寫在程式碼裡）
  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  
  if (!NOTION_TOKEN) {
    return res.status(500).json({ 
      error: 'NOTION_TOKEN environment variable is not set in Vercel' 
    });
  }

  const { type, category, slug } = req.query;

  try {
    if (type === 'list') {
      // 抓某分類的所有已發布文章
      const articles = await fetchArticleList(NOTION_TOKEN, category);
      
      // 設定 5 分鐘快取（讓網站快、減少 Notion API 呼叫）
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
      
      return res.status(200).json({ articles });
    }
    
    if (type === 'post' && slug) {
      // 抓單篇文章的完整內容
      const post = await fetchSinglePost(NOTION_TOKEN, slug);
      
      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }
      
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
      
      return res.status(200).json({ post });
    }
    
    return res.status(400).json({ error: 'Invalid request. Use ?type=list or ?type=post&slug=xxx' });
    
  } catch (error) {
    console.error('Notion API error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch from Notion',
      message: error.message 
    });
  }
}

// 取得文章列表
async function fetchArticleList(token, category) {
  const filter = {
    and: [
      {
        property: '狀態',
        select: { equals: '已發布' }
      }
    ]
  };
  
  if (category) {
    filter.and.push({
      property: '分類',
      select: { equals: category }
    });
  }

  const response = await fetch(`${NOTION_API_URL}/databases/${DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION
    },
    body: JSON.stringify({
      filter,
      sorts: [{ property: '發布日期', direction: 'descending' }],
      page_size: 100
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Notion API ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  
  return data.results.map(page => parsePageToArticle(page));
}

// 取得單篇文章
async function fetchSinglePost(token, slug) {
  // 用 slug 篩選找到對應的頁面
  const queryResponse = await fetch(`${NOTION_API_URL}/databases/${DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION
    },
    body: JSON.stringify({
      filter: {
        and: [
          { property: '狀態', select: { equals: '已發布' } },
          { property: 'Slug', rich_text: { equals: slug } }
        ]
      }
    })
  });

  if (!queryResponse.ok) {
    throw new Error(`Notion query failed: ${queryResponse.status}`);
  }

  const queryData = await queryResponse.json();
  
  if (!queryData.results || queryData.results.length === 0) {
    return null;
  }

  const page = queryData.results[0];
  const article = parsePageToArticle(page);
  
  // 抓頁面的 block 內容（文章本文）
  const blocksResponse = await fetch(`${NOTION_API_URL}/blocks/${page.id}/children?page_size=100`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION
    }
  });

  if (blocksResponse.ok) {
    const blocksData = await blocksResponse.json();
    article.blocks = blocksData.results;
  } else {
    article.blocks = [];
  }

  return article;
}

// 把 Notion 頁面物件轉成簡化的文章物件
function parsePageToArticle(page) {
  const props = page.properties;
  
  return {
    id: page.id,
    title: getTextFromProperty(props['標題']),
    slug: getTextFromProperty(props['Slug']),
    category: getSelectFromProperty(props['分類']),
    position: getSelectFromProperty(props['位置']),
    status: getSelectFromProperty(props['狀態']),
    date: getDateFromProperty(props['發布日期']),
    tag: getSelectFromProperty(props['標籤']),
    hashtags: parseHashtags(getTextFromProperty(props['Hashtag'])),
    excerpt: getTextFromProperty(props['摘要']),
    youtubeId: extractYoutubeId(getTextFromProperty(props['YouTube 影片'])),
    cover: getCoverFromPage(page)
  };
}

function getTextFromProperty(prop) {
  if (!prop) return '';
  if (prop.title) return prop.title.map(t => t.plain_text).join('');
  if (prop.rich_text) return prop.rich_text.map(t => t.plain_text).join('');
  return '';
}

function getSelectFromProperty(prop) {
  if (!prop || !prop.select) return '';
  return prop.select.name || '';
}

function getDateFromProperty(prop) {
  if (!prop || !prop.date) return '';
  return prop.date.start || '';
}

function getCoverFromPage(page) {
  if (!page.cover) return null;
  if (page.cover.type === 'external') return page.cover.external.url;
  if (page.cover.type === 'file') return page.cover.file.url;
  return null;
}

function extractYoutubeId(input) {
  if (!input) return '';
  // 已經是 ID（11 字元英數）
  if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();
  // 從網址抓
  const match = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : '';
}

// 解析 hashtag 字串（用逗號分隔）
function parseHashtags(text) {
  if (!text) return [];
  return text
    .split(/[,，、]/)
    .map(t => t.trim().replace(/^#/, ''))
    .filter(t => t.length > 0)
    .slice(0, 8); // 最多 8 個避免太長
}
