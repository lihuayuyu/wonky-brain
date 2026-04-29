// /api/youtube.js
// Vercel Serverless Function：抓 YouTube 頻道 RSS Feed
// 用法：/api/youtube?channel=UCxxxxxxxxx

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { channel } = req.query;
  
  if (!channel) {
    return res.status(400).json({ error: 'Missing channel parameter' });
  }

  // 驗證 channel ID 格式
  if (!/^UC[a-zA-Z0-9_-]{22}$/.test(channel)) {
    return res.status(400).json({ error: 'Invalid channel ID format', got: channel });
  }

  try {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`;
    
    const response = await fetch(rssUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WonkyBrainBot/1.0)',
        'Accept': 'application/atom+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(500).json({ 
        error: 'Failed to fetch RSS feed',
        status: response.status,
        statusText: response.statusText,
        url: rssUrl
      });
    }

    const xmlText = await response.text();
    
    if (!xmlText || xmlText.length < 100) {
      return res.status(500).json({ 
        error: 'Empty or invalid RSS response',
        length: xmlText.length,
        sample: xmlText.substring(0, 200)
      });
    }
    
    const videos = parseYouTubeRSS(xmlText);
    
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    
    return res.status(200).json({ 
      videos,
      count: videos.length,
      cached_at: new Date().toISOString()
    });

  } catch (error) {
    return res.status(500).json({ 
      error: 'Function error',
      message: error.message,
      stack: error.stack
    });
  }
}

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
        title: decodeHtmlEntities(title),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        published,
        description: description ? decodeHtmlEntities(description).substring(0, 200) : ''
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

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
