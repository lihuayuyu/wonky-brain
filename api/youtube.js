// /api/youtube.js
// Vercel Serverless Function：抓 YouTube 頻道 RSS Feed
// 用法：/api/youtube?channel=UCxxxxxxxxx

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const { channel } = req.query;
  
  if (!channel) {
    return res.status(400).json({ error: 'Missing channel parameter' });
  }

  // 驗證 channel ID 格式（防止亂用）
  if (!/^UC[a-zA-Z0-9_-]{22}$/.test(channel)) {
    return res.status(400).json({ error: 'Invalid channel ID format' });
  }

  try {
    // 抓 YouTube RSS Feed
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`;
    const response = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      return res.status(500).json({ error: 'Failed to fetch RSS feed' });
    }

    const xmlText = await response.text();
    
    // 解析 XML 取出影片資料
    const videos = parseYouTubeRSS(xmlText);
    
    // 設定快取（1 小時）
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    
    return res.status(200).json({ 
      videos,
      count: videos.length,
      cached_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching YouTube RSS:', error);
    return res.status(500).json({ error: error.message });
  }
}

// 解析 YouTube RSS XML 為 JSON
function parseYouTubeRSS(xml) {
  const videos = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    
    const videoId = extractTag(entry, 'yt:videoId');
    const title = extractTag(entry, 'title');
    const published = extractTag(entry, 'published');
    const thumbnail = extractAttribute(entry, 'media:thumbnail', 'url');
    const description = extractTag(entry, 'media:description');
    
    if (videoId && title) {
      videos.push({
        id: videoId,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        published,
        description: description?.substring(0, 200) || ''
      });
    }
  }
  
  return videos;
}

function extractTag(text, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function extractAttribute(text, tag, attr) {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`);
  const match = text.match(regex);
  return match ? match[1] : null;
}
